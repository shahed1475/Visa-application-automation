import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixturePortal, type FixturePortal } from '../helpers/fixturePortal.js';

// Phase 7 Task 7: the fixture portal must deterministically produce every §10
// failure mode via query flags, so the Task 11 matrix can prove the safety
// controls. These self-tests assert the raw HTML / status each flag yields.

let portal: FixturePortal;

beforeAll(async () => {
  portal = await startFixturePortal();
});
afterAll(async () => {
  await portal.close();
});

async function get(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${portal.url}${path}`);
  return { status: res.status, body: await res.text() };
}

describe('fixture portal v3 — deterministic failure scenarios', () => {
  it('a plain request is unaffected (no flag = no scenario)', async () => {
    const { status, body } = await get('/personal');
    expect(status).toBe(200);
    expect(body).toContain('id="surname"');
    expect(body).toContain('class="next"');
    expect(body).toContain('id="given-names"');
  });

  it('?selector=changed renames the target control id', async () => {
    const { body } = await get('/personal?selector=changed');
    expect(body).not.toContain('id="surname"');
    expect(body).toContain('id="surname-renamed"');
  });

  it('?selector=fallback drops the id but keeps a stable name attribute', async () => {
    const { body } = await get('/personal?selector=fallback');
    expect(body).not.toContain('id="surname"');
    expect(body).toContain('name="surname"');
  });

  it('?field=missing removes a mapped control entirely', async () => {
    const { body } = await get('/personal?field=missing');
    expect(body).not.toContain('id="given-names"');
    // the rest of the page is intact
    expect(body).toContain('id="surname"');
  });

  it('?option=placeholder prepends an empty placeholder option to the purpose select', async () => {
    const { body } = await get('/visa-details?option=placeholder');
    expect(body).toMatch(/<select id="purpose"><option value="">/);
  });

  it('?option=disabled leads with a placeholder and marks the target option disabled', async () => {
    const { body } = await get('/visa-details?option=disabled');
    expect(body).toMatch(/<select id="purpose"><option value="">/);
    expect(body).toContain('<option value="business" disabled>Business</option>');
  });

  it('?option=removed leads with a placeholder and strips the target option', async () => {
    const { body } = await get('/visa-details?option=removed');
    expect(body).toMatch(/<select id="purpose"><option value="">/);
    expect(body).not.toContain('value="business"');
    expect(body).toContain('value="recreation"');
  });

  it('?option=duplicate adds a second option with the same visible label, different value', async () => {
    const { body } = await get('/visa-details?option=duplicate');
    expect(body).toContain('<option value="business">Business</option>');
    expect(body).toContain('<option value="business-2">Business</option>');
  });

  it('?session=expired returns 401 with a sign-in marker and no form controls', async () => {
    const { status, body } = await get('/personal?session=expired');
    expect(status).toBe(401);
    expect(body).toMatch(/session expired/i);
    expect(body).toMatch(/sign in/i);
    expect(body).not.toContain('id="surname"');
  });

  it('?nav=changed renames the next control so a.next / button.next no longer matches', async () => {
    const { body } = await get('/personal?nav=changed');
    expect(body).not.toContain('class="next"');
    expect(body).toContain('class="proceed"');
  });

  it('/dates serves a native date input and a text date input', async () => {
    const { status, body } = await get('/dates');
    expect(status).toBe(200);
    expect(body).toContain('id="arrival-date" type="date"');
    expect(body).toMatch(/id="passport-expiry"[^>]*type="text"/);
  });

  it('the existing ?challenge= and ?prefill= behaviour is unchanged', async () => {
    expect((await get('/challenge?challenge=otp')).body).toContain('Enter the OTP');
    expect((await get('/personal?prefill=match')).body).toContain('value="RANA"');
    expect((await get('/personal?prefill=conflict')).body).toContain('value="SOMEONE-ELSE"');
  });
});
