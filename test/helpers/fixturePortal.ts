import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

export type ChallengeVariant = 'otp' | 'captcha' | 'ok';

export interface FixturePortal {
  url: string;
  submitCount: number;
  requests: { method: string; url: string }[];
  /** Controls what `/challenge` renders for subsequent requests. */
  setChallenge(v: ChallengeVariant): void;
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
] as const;

const CHALLENGE_MARKUP: Record<ChallengeVariant, string> = {
  otp: '<label for="otp">Enter the OTP</label><input id="otp" type="text">',
  captcha: '<div class="g-recaptcha"></div>',
  ok: '<p>Verified &mdash; you may continue.</p>',
};

function isChallengeVariant(v: string | null): v is ChallengeVariant {
  return v === 'otp' || v === 'captcha' || v === 'ok';
}

export async function startFixturePortal(): Promise<FixturePortal> {
  const pages = new Map<string, string>();
  for (const name of PAGE_NAMES) {
    pages.set(
      name,
      readFileSync(new URL('../fixtures/india-portal/' + name + '.html', import.meta.url), 'utf8'),
    );
  }

  const state = { challenge: 'otp' as ChallengeVariant, submitCount: 0 };
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

    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
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
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
