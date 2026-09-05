import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import pino from 'pino';
import { buildServer } from '../../src/server/app.js';
import { loggerOptions } from '../../src/server/logger.js';
import { loadKnowledgeBase } from '../../src/shared/visa-kb/loader.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let app: FastifyInstance;
let dbPath: string;

beforeEach(async () => {
  dbPath = makeTempDbPath();
  app = await buildServer({ dbPath });
});
afterEach(async () => {
  await app.close();
  cleanupTempDb(dbPath);
});

/** A fully-populated, entirely synthetic applicant (mirrors
 *  applicationService.test.ts's createSyntheticApplicant()) whose profile makes
 *  regular.tourist eligible: adult, BGD nationality, future passport expiry, married. */
async function createEligibleApplicant(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/applicants',
    payload: {
      displayName: 'RANA MITHU',
      identity: {
        surname: 'RANA',
        givenNames: 'MITHU',
        fullNameAsInPassport: 'RANA MITHU',
        dateOfBirth: '1990-05-20',
        sex: 'M',
        placeOfBirth: 'Dhaka',
        nationality: 'BGD',
        otherNationalities: 'None',
        religion: 'Islam',
        education: 'Bachelor of Commerce',
        nationalId: 'BGD1234567890',
        visibleMarks: 'None',
        nationalityAtBirth: 'BGD',
      },
      passport: {
        documentType: 'ordinary',
        number: 'BG1234567',
        issuingState: 'BGD',
        issueDate: '2020-01-01',
        expiryDate: '2030-01-01',
        placeOfIssue: 'Dhaka',
        issuingAuthority: 'Department of Immigration and Passports, Dhaka',
      },
      contact: {
        email: 'rana.mithu@example.com',
        phone: '+8801700000000',
        altPhone: '+8801800000000',
      },
      address: {
        line1: 'House 12, Road 4, Dhanmondi',
        line2: 'Block C',
        city: 'Dhaka',
        region: 'Dhaka Division',
        postalCode: '1209',
        country: 'BGD',
      },
      family: {
        fatherName: 'Rana Karim',
        fatherNationality: 'BGD',
        fatherPrevNationality: 'BGD',
        fatherPlaceOfBirth: 'Dhaka',
        motherName: 'Rana Begum',
        motherNationality: 'BGD',
        motherPrevNationality: 'BGD',
        motherPlaceOfBirth: 'Dhaka',
        maritalStatus: 'married',
        spouseName: 'Mithu Sultana',
        spouseNationality: 'BGD',
        spousePrevNationality: 'BGD',
        spousePlaceOfBirth: 'Dhaka',
        pakistanAncestry: 'no',
      },
      occupation: {
        occupation: 'Software Engineer',
        employerName: 'Dhaka Software House Ltd.',
        employerAddress: 'Gulshan Avenue, Dhaka',
        designation: 'Senior Engineer',
        militaryPolice: 'no',
      },
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().applicant.id as string;
}

async function createApplication(applicantId: string, body: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/applicants/${applicantId}/applications`,
    payload: { applicationMode: 'regular', categoryId: 'regular.tourist', ...body },
  });
}

describe('POST /api/applicants/:id/applications', () => {
  it('creates a draft application with the current kbVersion', async () => {
    const applicantId = await createEligibleApplicant();
    const res = await createApplication(applicantId);
    expect(res.statusCode).toBe(201);
    const { application } = res.json();
    expect(application.status).toBe('draft');
    expect(application.kbVersion).toBe(loadKnowledgeBase().meta.kbVersion);
  });

  it('404s for an unknown applicant id', async () => {
    const res = await createApplication(randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('400s INVALID_CATEGORY for a bogus category', async () => {
    const applicantId = await createEligibleApplicant();
    const res = await createApplication(applicantId, { categoryId: 'bogus.category' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_CATEGORY');
  });

  it('409s MODE_MISMATCH when mode and category disagree', async () => {
    const applicantId = await createEligibleApplicant();
    const res = await createApplication(applicantId, { applicationMode: 'evisa' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODE_MISMATCH');
  });
});

describe('GET /api/applicants/:id/applications', () => {
  it('lists applications for the applicant', async () => {
    const applicantId = await createEligibleApplicant();
    const created = (await createApplication(applicantId)).json().application;
    const res = await app.inject({
      method: 'GET',
      url: `/api/applicants/${applicantId}/applications`,
    });
    expect(res.statusCode).toBe(200);
    const { applications } = res.json();
    expect(Array.isArray(applications)).toBe(true);
    expect(applications.some((a: { id: string }) => a.id === created.id)).toBe(true);
  });
});

describe('GET /api/applications/:id', () => {
  it('returns application + plan, category resolved', async () => {
    const applicantId = await createEligibleApplicant();
    const created = (await createApplication(applicantId)).json().application;
    const res = await app.inject({ method: 'GET', url: `/api/applications/${created.id}` });
    expect(res.statusCode).toBe(200);
    const { application, plan } = res.json();
    expect(application.id).toBe(created.id);
    expect(plan.category?.id).toBe('regular.tourist');
  });

  it('404s for an unknown application id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/applications/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('PUT /api/applications/:id', () => {
  it('applies a selection patch and recomputes the plan', async () => {
    const applicantId = await createEligibleApplicant();
    const created = (await createApplication(applicantId)).json().application;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/applications/${created.id}`,
      payload: { intendedArrivalDate: '2027-06-01' },
    });
    expect(res.statusCode).toBe(200);
    const { application, plan } = res.json();
    expect(application.intendedArrivalDate).toBe('2027-06-01');
    // Note: the visa_details/intended_arrival_date FORM field's `appliesTo` is
    // `application.intendedArrivalDate`, which is only ever resolved from the
    // application_field_values table (see buildApplicationPlan.ts's resolveValue) --
    // never from the visa_applications row's own selection column. So a selection
    // PUT does not flip that field's `present`; it does update `plan.selection`
    // (echoed straight from the patched row), which is what we assert here.
    expect(plan.selection.intendedArrivalDate).toBe('2027-06-01');
  });

  it('404s for an unknown application id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/applications/${randomUUID()}`,
      payload: { intendedArrivalDate: '2027-06-01' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('PUT /api/applications/:id/field-values', () => {
  it('sets an application field value and the plan reflects it', async () => {
    const applicantId = await createEligibleApplicant();
    const created = (await createApplication(applicantId)).json().application;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/applications/${created.id}/field-values`,
      payload: { fieldPath: 'application.purpose', value: 'recreation' },
    });
    expect(res.statusCode).toBe(200);
    const { plan } = res.json();
    const section = plan.sections.find((s: { id: string }) => s.id === 'visa_details');
    const field = section?.fields.find((f: { id: string }) => f.id === 'purpose');
    expect(field?.present).toBe(true);
    expect(field?.value).toBe('recreation');
  });

  it('400s VALIDATION_ERROR for a malformed field path', async () => {
    const applicantId = await createEligibleApplicant();
    const created = (await createApplication(applicantId)).json().application;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/applications/${created.id}/field-values`,
      payload: { fieldPath: 'Bad.Path' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('404s for an unknown application id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/applications/${randomUUID()}/field-values`,
      payload: { fieldPath: 'application.purpose', value: 'recreation' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/applications/:id', () => {
  it('deletes then GET returns 404', async () => {
    const applicantId = await createEligibleApplicant();
    const created = (await createApplication(applicantId)).json().application;
    const del = await app.inject({ method: 'DELETE', url: `/api/applications/${created.id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: true });
    const get = await app.inject({ method: 'GET', url: `/api/applications/${created.id}` });
    expect(get.statusCode).toBe(404);
  });

  it('404s for an unknown application id', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/applications/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('privacy — request body is never logged', () => {
  it('PUT field-values leaks no marker value into the log stream', async () => {
    const captured: string[] = [];
    const stream = {
      write(chunk: string) {
        captured.push(chunk);
      },
    };
    const testLogger = pino(
      { ...loggerOptions, level: 'info', transport: undefined },
      stream,
    ) as unknown as FastifyBaseLogger;

    const capDbPath = makeTempDbPath();
    const capApp = await buildServer({ dbPath: capDbPath, loggerInstance: testLogger });
    try {
      const ap = await capApp.inject({
        method: 'POST',
        url: '/api/applicants',
        payload: { displayName: 'Cap Tester' },
      });
      const applicantId = ap.json().applicant.id as string;
      const create = await capApp.inject({
        method: 'POST',
        url: `/api/applicants/${applicantId}/applications`,
        payload: { applicationMode: 'regular', categoryId: 'regular.tourist' },
      });
      const applicationId = create.json().application.id as string;

      await capApp.inject({
        method: 'PUT',
        url: `/api/applications/${applicationId}/field-values`,
        payload: { fieldPath: 'application.purpose', value: 'MARKER_VALUE_DO_NOT_LOG_ME' },
      });

      const log = captured.join('');
      expect(log.length).toBeGreaterThan(0);
      expect(log).not.toContain('MARKER_VALUE_DO_NOT_LOG_ME');
    } finally {
      await capApp.close();
      cleanupTempDb(capDbPath);
    }
  });
});
