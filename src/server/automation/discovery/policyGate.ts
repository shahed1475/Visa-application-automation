// Runtime policy-acknowledgement gate for real-portal connections.
//
// DESIGN NOTE (do not remove): this module must NOT import anything under
// `src/server/automation/adapters/`. The India host pattern below is a
// DELIBERATE duplicate of `indiaPortalMap.matchesUrl` — the gate is a
// low-level guard that discovery and automation both call, and pulling the
// adapter in here would invert the dependency direction (arch guard).
//
// The ack record lives in `app_settings` (migration 1) as a single row:
//   key   = 'portal_policy_ack:' + portalId
//   value = ISO-8601 timestamp of the acknowledgement
// No schema change in this task (Task 2 introduces a dedicated table).

import type { DatabaseSync } from 'node:sqlite';

/** Real India visa-portal hostnames that require a ToS ack before any live
 *  connection. Host-anchored: `(?:^|\.)` requires the token to start the
 *  hostname or follow a dot; `$` pins it to the end. Tested against
 *  `new URL(url).hostname` ONLY — never the path or query. Mirrors
 *  `indiaPortalMap.matchesUrl` (duplicated deliberately — see note above). */
const REAL_INDIA_HOST = /(?:^|\.)(?:indianvisaonline\.gov\.in|ivacbd\.com)$/i;

const ACK_KEY_PREFIX = 'portal_policy_ack:';

export interface PortalPolicyStatus {
  portalId: string;
  acknowledgedAt: string | null;
}

/** True when `url`'s hostname is one of the known real India portal hosts. */
export function isRealIndiaHost(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return REAL_INDIA_HOST.test(hostname);
}

/** Read the operator's ToS acknowledgement for a portal (null if none). */
export function getPolicyAck(db: DatabaseSync, portalId: string): PortalPolicyStatus {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(ACK_KEY_PREFIX + portalId) as { value: string } | undefined;
  return { portalId, acknowledgedAt: row?.value ?? null };
}

/** Record (or refresh) the operator's ToS acknowledgement for a portal. */
export function recordPolicyAck(db: DatabaseSync, portalId: string): PortalPolicyStatus {
  const acknowledgedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(ACK_KEY_PREFIX + portalId, acknowledgedAt);
  return { portalId, acknowledgedAt };
}

export class ToSNotAcknowledgedError extends Error {
  constructor(readonly portalId: string) {
    super(
      `Portal Terms of Service not acknowledged for portal '${portalId}'. ` +
        'The operator must review and acknowledge the India portal Terms before a live connection.',
    );
    this.name = 'ToSNotAcknowledgedError';
  }
}

/**
 * Guard called by discovery and automation before any live connection.
 * Throws `ToSNotAcknowledgedError` when the target is the real India portal
 * (`adapterId === 'india'` && `isRealIndiaHost(portalUrl)`) and no ack has been
 * recorded for `portalId`. No-op otherwise (generic adapter, fixture host, or
 * already acknowledged).
 */
export function assertPolicyAck(
  db: DatabaseSync,
  portalId: string,
  adapterId: string,
  portalUrl: string,
): void {
  if (adapterId !== 'india' || !isRealIndiaHost(portalUrl)) return;
  if (getPolicyAck(db, portalId).acknowledgedAt === null) {
    throw new ToSNotAcknowledgedError(portalId);
  }
}
