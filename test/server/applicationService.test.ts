import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import * as svc from '../../src/server/services/applicantService.js';
import * as appSvc from '../../src/server/services/applicationService.js';
import { ApplicationServiceError } from '../../src/server/services/applicationService.js';
import { loadKnowledgeBase } from '../../src/shared/visa-kb/loader.js';
import { getCategory } from '../../src/shared/visa-kb/queries.js';
import { cleanupTempDb, makeTempDbPath } from '../helpers/tempDb.js';

let db: DatabaseSync;
let dbPath: string;

beforeEach(() => {
  dbPath = makeTempDbPath();
  db = openDatabase(dbPath);
  runMigrations(db);
});
afterEach(() => {
  db.close();
  cleanupTempDb(dbPath);
});

/** A fully-populated, entirely synthetic applicant built through the real DB API
 *  (mirrors test/helpers/applicationFixtures.ts's syntheticApplicant() values). */
function createSyntheticApplicant(): string {
  const applicant = svc.createApplicant(db, {
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
  });
  svc.addReference(db, applicant.id, {
    kind: 'in_country_host',
    name: 'Host Person',
    relationship: 'friend',
    organization: null,
    phone: '+911234567890',
    email: 'host@example.com',
    address: 'New Delhi, India',
  });
  return applicant.id;
}

/** Inserts a minimal `documents` row directly (bypassing the Phase 3 OCR pipeline,
 *  which is out of scope here) so `listDocuments`/`getDocument` — the real
 *  document-storage read path `assembleDocumentCoverage` calls — see it. The
 *  `originalName` is chosen to token-match the KB document id via
 *  `documentRules.ts`'s `matchDocument` Rule B. */
function insertDocument(applicantId: string, docId: string): void {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO documents
       (id, applicant_id, kind, original_name, mime_type, byte_size, sha256, storage_path, status, created_at, updated_at)
     VALUES (?, ?, 'unknown', ?, 'application/pdf', 100, ?, ?, 'uploaded', ?, ?)`,
  ).run(id, applicantId, `${docId}.pdf`, `sha-${id}`, `/tmp/${id}`, now, now);
}

describe('applicationService', () => {
  it('createApplication pins kb_version and defaults status to draft', () => {
    const applicantId = createSyntheticApplicant();
    const result = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    });
    expect(result.kbVersion).toBe(loadKnowledgeBase().meta.kbVersion);
    expect(result.status).toBe('draft');
    expect(result.applicantId).toBe(applicantId);
  });

  it('getApplication returns a real plan for the created application', () => {
    const applicantId = createSyntheticApplicant();
    const created = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    });
    const result = appSvc.getApplication(db, created.id);
    expect(result).not.toBeNull();
    expect(result?.plan.category?.id).toBe('regular.tourist');
    expect(result?.plan.eligibility.status).toBe('eligible');
  });

  it('setApplicationFieldValue reflects in the plan', () => {
    const applicantId = createSyntheticApplicant();
    const created = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.business',
    });
    const result = appSvc.setApplicationFieldValue(db, created.id, 'application.indiaCompanyName', {
      value: 'ACME',
    });
    expect(result).not.toBeNull();
    const section = result?.plan.sections.find((s) => s.id === 'business_details');
    const field = section?.fields.find((f) => f.id === 'india_company_name');
    expect(field?.present).toBe(true);
    expect(field?.value).toBe('ACME');
  });

  it('a verify-only call does not clear the value', () => {
    const applicantId = createSyntheticApplicant();
    const created = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.business',
    });
    appSvc.setApplicationFieldValue(db, created.id, 'application.indiaCompanyName', { value: 'ACME' });
    const result = appSvc.setApplicationFieldValue(db, created.id, 'application.indiaCompanyName', {
      verified: true,
    });
    const section = result?.plan.sections.find((s) => s.id === 'business_details');
    const field = section?.fields.find((f) => f.id === 'india_company_name');
    expect(field?.value).toBe('ACME');
    expect(field?.verified).toBe(true);
  });

  it('throws invalid_field for a malformed field path', () => {
    const applicantId = createSyntheticApplicant();
    const created = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    });
    expect(() =>
      appSvc.setApplicationFieldValue(db, created.id, 'Bad.Path', { value: 'x' }),
    ).toThrow(ApplicationServiceError);
    try {
      appSvc.setApplicationFieldValue(db, created.id, 'Bad.Path', { value: 'x' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationServiceError);
      expect((err as ApplicationServiceError).code).toBe('invalid_field');
    }
  });

  it('two applications for the same applicant are independent', () => {
    const applicantId = createSyntheticApplicant();
    const first = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    });
    const second = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    });
    appSvc.setApplicationFieldValue(db, first.id, 'application.purpose', { value: 'recreation' });

    const secondResult = appSvc.getApplication(db, second.id);
    const section = secondResult?.plan.sections.find((s) => s.id === 'visa_details');
    const field = section?.fields.find((f) => f.id === 'purpose');
    expect(field?.present).toBe(false);
  });

  it('createApplication throws invalid_category for a bogus category', () => {
    const applicantId = createSyntheticApplicant();
    expect(() =>
      appSvc.createApplication(db, applicantId, {
        applicationMode: 'regular',
        categoryId: 'bogus.category',
      }),
    ).toThrow(ApplicationServiceError);
    try {
      appSvc.createApplication(db, applicantId, { applicationMode: 'regular', categoryId: 'bogus.category' });
      expect.unreachable();
    } catch (err) {
      expect((err as ApplicationServiceError).code).toBe('invalid_category');
    }
  });

  it('createApplication throws mode_mismatch when mode and category disagree', () => {
    const applicantId = createSyntheticApplicant();
    try {
      appSvc.createApplication(db, applicantId, { applicationMode: 'evisa', categoryId: 'regular.tourist' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationServiceError);
      expect((err as ApplicationServiceError).code).toBe('mode_mismatch');
    }
  });

  it('createApplication throws no_applicant for an unknown applicant id', () => {
    try {
      appSvc.createApplication(db, 'not-a-real-id', { applicationMode: 'regular', categoryId: 'regular.tourist' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationServiceError);
      expect((err as ApplicationServiceError).code).toBe('no_applicant');
    }
  });

  it('deleteApplication cascades application_field_values', () => {
    const applicantId = createSyntheticApplicant();
    const created = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    });
    appSvc.setApplicationFieldValue(db, created.id, 'application.purpose', { value: 'recreation' });

    const deleted = appSvc.deleteApplication(db, created.id);
    expect(deleted).toBe(true);

    const rows = db
      .prepare('SELECT * FROM application_field_values WHERE application_id = ?')
      .all(created.id);
    expect(rows).toEqual([]);
    expect(appSvc.getApplication(db, created.id)).toBeNull();
  });

  it('a stale kb_version surfaces as an info warning', () => {
    const applicantId = createSyntheticApplicant();
    const created = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    });
    db.prepare('UPDATE visa_applications SET kb_version = ? WHERE id = ?').run('stale-version', created.id);

    const result = appSvc.getApplication(db, created.id);
    const kb = loadKnowledgeBase();
    const infoWarning = result?.plan.warnings.find((w) => w.severity === 'info');
    expect(infoWarning).toBeDefined();
    expect(infoWarning?.text).toBe(
      `plan computed against KB stale-version; current KB is ${kb.meta.kbVersion}`,
    );
  });

  it('updateApplication recomputes status from draft to ready', () => {
    const applicantId = createSyntheticApplicant();
    const created = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    });

    const noop = appSvc.updateApplication(db, created.id, {});
    expect(noop?.application.status).toBe('draft');

    appSvc.setApplicationFieldValue(db, created.id, 'application.purpose', { value: 'recreation' });
    appSvc.setApplicationFieldValue(db, created.id, 'application.portOfArrival', { value: 'Delhi' });
    appSvc.setApplicationFieldValue(db, created.id, 'application.intendedArrivalDate', {
      value: '2027-01-15',
    });
    appSvc.setApplicationFieldValue(db, created.id, 'application.visitedIndiaBefore', { value: 'false' });

    const kb = loadKnowledgeBase();
    const category = getCategory('regular.tourist', kb)!;
    for (const doc of category.requiredDocuments) {
      insertDocument(applicantId, doc.id);
    }

    const ready = appSvc.updateApplication(db, created.id, {});
    expect(ready?.plan.missing).toEqual([]);
    expect(ready?.plan.readyForAutomation.ready).toBe(true);
    expect(ready?.application.status).toBe('ready');
  });

  it('archived status is never overwritten by the recompute', () => {
    const applicantId = createSyntheticApplicant();
    const created = appSvc.createApplication(db, applicantId, {
      applicationMode: 'regular',
      categoryId: 'regular.tourist',
    });
    db.prepare('UPDATE visa_applications SET status = ? WHERE id = ?').run('archived', created.id);

    const result = appSvc.updateApplication(db, created.id, {});
    expect(result?.application.status).toBe('archived');
  });
});
