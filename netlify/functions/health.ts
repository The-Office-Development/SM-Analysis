import type { Handler } from "./_lib";
import crypto from "node:crypto";
import { admin, type Db } from "./_lib";
import { liMinSyncIntervalMs } from "./_linkedin";

/**
 * GET /api/health: is the sync actually running?
 *
 * For an uptime monitor. It exists because of 2026-09-18: half of all scheduled
 * syncs had been failing for at least a week, sync_log recorded none of it (the
 * failure was running out of subrequests, and so was the log write), and every
 * page said "fine". Nothing watched the system, so nothing noticed.
 *
 * It therefore judges by OUTCOMES, never by the log: an account's last
 * SUCCESSFUL sync, and whether the cron is still taking turns. Both are
 * written by the work itself, so a failure that cannot write a log line still
 * shows up here as time passing.
 *
 *   200 {"ok":true}    every connected account synced recently enough
 *   503 {"ok":false}   something is stale, the cron has stopped, or the
 *                      database cannot be read
 *
 * Public, because an uptime monitor cannot sign in, so it says nothing but ok
 * or not. The detail (counts, reasons; never account names or ids) is returned
 * only with `?key=` matching HEALTH_KEY, and never when HEALTH_KEY is unset.
 */

/** An account is stale when its last success is older than this many turns. */
const TURNS_BEFORE_STALE = 3;
/** Never call anything stale sooner than this, whatever the arithmetic says. */
const MIN_STALE_MS = 2 * 3_600_000;
/**
 * The cron takes a turn at least every 15 minutes while anything is connected
 * (an account falls due 15 minutes after its last turn). Twice that without a
 * turn means the Worker is not running.
 */
export const CRON_SILENT_MS = 30 * 60_000;

interface AccountRow {
  platform: string;
  status: string;
  connected_at: string | null;
  last_synced_at: string | null;
  sync_turn_at: string | null;
}

/**
 * How long an account may go without a successful sync before it is stale.
 *
 * One account is taken per minute and each falls due every 15, so with N
 * accounts a turn comes round every max(15, N) minutes. LinkedIn is slower on
 * purpose: its daily call limit spaces pages out (`liMinSyncIntervalMs`).
 */
export function staleAfterMs(platform: string, connected: number): number {
  const turn = platform === "linkedin"
    ? liMinSyncIntervalMs()
    : Math.max(15, connected) * 60_000;
  return Math.max(MIN_STALE_MS, TURNS_BEFORE_STALE * turn);
}

export async function assess(db: Db, now = Date.now()) {
  const { data, error } = await db
    .from("social_accounts")
    .select("platform,status,connected_at,last_synced_at,sync_turn_at");
  if (error) return { ok: false, reasons: ["database unreachable"], detail: null };

  const rows = (data ?? []) as AccountRow[];
  const live = rows.filter((a) => a.status === "connected");
  const ago = (iso: string | null) => (iso ? now - Date.parse(iso) : Infinity);

  const reasons: string[] = [];

  /*
   * Staleness is measured from the last SUCCESS. An account that has never
   * synced is measured from when it was connected, so a new connection gets
   * the same grace as everything else rather than failing the check at once.
   */
  const stale = live.filter((a) => ago(a.last_synced_at ?? a.connected_at) > staleAfterMs(a.platform, live.length));
  if (stale.length) reasons.push(`${stale.length} connected account(s) not synced within their window`);

  // The cron's heartbeat is the newest turn taken by any account.
  const turns = live.map((a) => a.sync_turn_at).filter((t): t is string => Boolean(t));
  const lastTurnMs = turns.length ? Math.min(...turns.map((t) => ago(t))) : Infinity;
  if (live.length && lastTurnMs > CRON_SILENT_MS) reasons.push("the scheduled sync has not taken a turn recently");

  return {
    ok: reasons.length === 0,
    reasons,
    detail: {
      connected: live.length,
      stale: stale.length,
      // A client must reconnect these. It is their action, not a system fault,
      // so it does not turn the check red, but the operator should see it.
      needs_reconnect: rows.filter((a) => a.status === "expired").length,
      cron_last_turn_minutes: Number.isFinite(lastTurnMs) ? Math.round(lastTurnMs / 60_000) : null,
    },
  };
}

function keyMatches(given: string | undefined): boolean {
  const want = process.env.HEALTH_KEY ?? "";
  if (!want || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
    return { statusCode: 405, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ message: "Use GET." }) };
  }
  let result: Awaited<ReturnType<typeof assess>>;
  try { result = await assess(admin()); }
  catch { result = { ok: false, reasons: ["health check could not run"], detail: null }; }

  const body = keyMatches(event.queryStringParameters?.key)
    ? { ok: result.ok, reasons: result.reasons, ...result.detail, checked_at: new Date().toISOString() }
    : { ok: result.ok };
  return {
    statusCode: result.ok ? 200 : 503,
    // A cached "ok" is exactly the failure this endpoint exists to prevent.
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
};
