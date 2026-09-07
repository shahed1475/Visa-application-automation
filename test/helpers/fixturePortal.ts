import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

export type ChallengeVariant = 'otp' | 'captcha' | 'ok';
export type PrefillVariant = 'none' | 'match' | 'conflict';

export interface FixturePortal {
  url: string;
  submitCount: number;
  requests: { method: string; url: string }[];
  /** Controls what `/challenge` renders for subsequent requests. */
  setChallenge(v: ChallengeVariant): void;
  /**
   * Controls whether prefill-supporting pages (`/personal`) come back with their
   * canonical `match` / `conflict` values already in the controls. A `?prefill=`
   * query param overrides this for a single request.
   */
  setPrefill(v: PrefillVariant): void;
  close(): Promise<void>;
}

const PAGE_NAMES = [
  'personal',
  'passport',
  'address',
  'family',
  'occupation',
  'visa-details',
  'references',
  'documents',
  'challenge',
  'review',
  'final-review',
  'previous-visits',
  'additional-information',
  'webforms-personal',
  'nowhere',
  'dates',
] as const;

/** Pages whose known text controls accept prefill injection. */
const PREFILL_SUPPORTING = new Set<string>(['personal']);

/**
 * Canonical prefill values keyed by element id. `match` holds the value the
 * Task 13 plan wants (so the engine sees a prefill-match); `conflict` holds a
 * different value (so the engine raises `value_conflict`). Injected with a
 * per-id regex against the empty control — idempotent and deterministic.
 */
const PREFILL_VALUES: Record<'match' | 'conflict', Record<string, string>> = {
  match: { surname: 'RANA', 'given-names': 'KUMAR' },
  conflict: { surname: 'SOMEONE-ELSE', 'given-names': 'DIFFERENT' },
};

function injectPrefill(html: string, variant: 'match' | 'conflict'): string {
  let out = html;
  for (const [id, value] of Object.entries(PREFILL_VALUES[variant])) {
    // tolerate an optional `name="…"` between the id and the type attribute
    const emptyControl = new RegExp(`(<input id="${id}"[^>]*?) type="text">`);
    out = out.replace(emptyControl, `$1 type="text" value="${value}">`);
  }
  return out;
}

function isPrefillVariant(v: string | null): v is PrefillVariant {
  return v === 'none' || v === 'match' || v === 'conflict';
}

const CHALLENGE_MARKUP: Record<ChallengeVariant, string> = {
  otp: '<label for="otp">Enter the OTP</label><input id="otp" type="text">',
  captcha: '<div class="g-recaptcha"></div>',
  ok: '<p>Verified &mdash; you may continue.</p>',
};

function isChallengeVariant(v: string | null): v is ChallengeVariant {
  return v === 'otp' || v === 'captcha' || v === 'ok';
}

// ---- Phase 7 Task 7: deterministic failure scenarios via query flags -------
//
//   ?selector=changed   a known control's id is renamed (primary selector misses)
//   ?selector=fallback  the id is dropped but a stable name="…" fallback resolves
//   ?field=missing      a mapped control is removed from the DOM
//   ?option=placeholder the purpose <select> leads with <option value="">
//   ?option=disabled    the target option is present but disabled
//   ?option=removed     the target option is absent
//   ?option=duplicate   a second option shares the visible label, distinct value
//   ?session=expired    401 + a sign-in marker instead of the page (any page)
//   ?nav=changed        the .next control is renamed (a.next / button.next misses)
//
// Each transform is a no-op when its target is not on the page, so a flag can be
// passed to any route. `?challenge=` / `?prefill=` are unaffected.

const SESSION_EXPIRED_BODY =
  '<!doctype html><html><head><meta charset="utf-8"><title>Session expired</title></head><body>' +
  '<h1>Session expired</h1><p>Your portal session has ended. <a href="/login">Sign in</a> to continue.</p>' +
  '</body></html>';

function applyScenario(html: string, params: URLSearchParams): { html: string; status: number } {
  if (params.get('session') === 'expired') {
    return { html: SESSION_EXPIRED_BODY, status: 401 };
  }
  let out = html;

  if (params.get('selector') === 'changed') {
    out = out.replace('id="surname" name="surname"', 'id="surname-renamed" name="surname-renamed"');
  } else if (params.get('selector') === 'fallback') {
    out = out.replace('<input id="surname" name="surname"', '<input name="surname"');
  }

  if (params.get('field') === 'missing') {
    out = out.replace(
      '<label for="given-names">Given names</label><input id="given-names" type="text">',
      '',
    );
  }

  const option = params.get('option');
  if (option === 'placeholder' || option === 'disabled' || option === 'removed') {
    // Lead with an empty placeholder so the select rests unselected — otherwise
    // removing/disabling the first option just shifts the default selection and
    // the engine's pre-fill check reads it as a pre-existing value.
    out = out.replace(
      '<select id="purpose">',
      '<select id="purpose"><option value="">— Select —</option>',
    );
  }
  switch (option) {
    case 'disabled':
      out = out.replace(
        '<option value="business">Business</option>',
        '<option value="business" disabled>Business</option>',
      );
      break;
    case 'removed':
      out = out.replace('<option value="business">Business</option>', '');
      break;
    case 'duplicate':
      out = out.replace(
        '<option value="business">Business</option>',
        '<option value="business">Business</option><option value="business-2">Business</option>',
      );
      break;
  }

  if (params.get('nav') === 'changed') {
    out = out.replace(/class="next"/g, 'class="proceed"');
  }

  return { html: out, status: 200 };
}

export async function startFixturePortal(): Promise<FixturePortal> {
  const pages = new Map<string, string>();
  for (const name of PAGE_NAMES) {
    pages.set(
      name,
      readFileSync(new URL('../fixtures/india-portal/' + name + '.html', import.meta.url), 'utf8'),
    );
  }

  const state = {
    challenge: 'otp' as ChallengeVariant,
    prefill: 'none' as PrefillVariant,
    submitCount: 0,
  };
  const requests: { method: string; url: string }[] = [];

  const server = createServer((req, res) => {
    const method = req.method ?? 'GET';
    const rawUrl = req.url ?? '/';
    requests.push({ method, url: rawUrl });
    req.resume();

    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    const pathname = parsed.pathname;

    if (method === 'POST' && pathname === '/__fixture/submit') {
      state.submitCount += 1;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }

    const name = pathname.replace(/^\//, '');
    const html = pages.get(name);
    if (html === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }

    let body = html;
    if (name === 'challenge') {
      const queryVariant = parsed.searchParams.get('challenge');
      const variant = isChallengeVariant(queryVariant) ? queryVariant : state.challenge;
      body = body.replace('<!--CHALLENGE-->', CHALLENGE_MARKUP[variant]);
    }
    if (PREFILL_SUPPORTING.has(name)) {
      const queryVariant = parsed.searchParams.get('prefill');
      const variant = isPrefillVariant(queryVariant) ? queryVariant : state.prefill;
      if (variant !== 'none') body = injectPrefill(body, variant);
    }

    const scenario = applyScenario(body, parsed.searchParams);
    res.writeHead(scenario.status, { 'content-type': 'text/html' });
    res.end(scenario.html);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    get submitCount() {
      return state.submitCount;
    },
    requests,
    setChallenge(v: ChallengeVariant) {
      state.challenge = v;
    },
    setPrefill(v: PrefillVariant) {
      state.prefill = v;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
