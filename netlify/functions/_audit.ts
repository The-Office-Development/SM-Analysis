import type { Handler, Db } from "./_lib";
import { admin, log, writeFailed, verifyState, readCookie, STATE_COOKIE } from "./_lib";

/**
 * The security audit log (migration 0023). Meta DPA 3.1-22.
 *
 * Two rules:
 *  1. **Never block the action being recorded.** A lost audit row is logged to
 *     the function log and the action proceeds. An audit failure that stopped a
 *     client disconnecting would turn a logging outage into a rights failure.
 *  2. **Never put platform data or credentials in a row.** An event records who,
 *     what, when and whether it worked. Detail keys that look like credentials
 *     are dropped outright, not redacted, since the row is kept 90 days.
 */

export type AuditOutcome = "success" | "failure";

export interface AuditFields {
  user_id?: string | null;
  platform?: string | null;
  account_id?: string | null;
  platform_user_id?: string | null;
  detail?: Record<string, unknown>;
}

const CREDENTIAL_KEY = /token|secret|proof|authorization|password|code_verifier|signed_request/i;

export function cleanDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!detail) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) if (!CREDENTIAL_KEY.test(k)) out[k] = v;
  return Object.keys(out).length ? out : null;
}

export async function audit(db: Db, event: string, outcome: AuditOutcome, f: AuditFields = {}): Promise<void> {
  try {
    const { error } = await db.from("audit_log").insert({
      event,
      outcome,
      user_id: f.user_id ?? null,
      platform: f.platform ?? null,
      account_id: f.account_id ?? null,
      platform_user_id: f.platform_user_id ?? null,
      detail: cleanDetail(f.detail),
    });
    writeFailed("audit.write_failed", error, { event });
  } catch (e) {
    log("audit.write_failed", { event, detail: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Wrap an OAuth callback so EVERY way out of it is recorded: the success
 * redirect, each of its error redirects, and a throw.
 *
 * The callbacks have up to eight exits each. Instrumenting them one by one is
 * how an exit gets missed; reading the outcome off the redirect the user is
 * actually sent to cannot miss one, because that redirect IS the outcome.
 *
 * The user id comes from the signed state, verified against the browser's
 * nonce cookie exactly as the callback does. A forged or expired state yields
 * no user id rather than a claimed one.
 */
export function auditedCallback(provider: string, handle: Handler): Handler {
  return async (event) => {
    const q = event.queryStringParameters ?? {};
    // The callback verifies the state itself and owns every error that follows.
    // If verification throws here (a missing secret), record no user and let
    // the callback meet the same error and answer it its own way.
    let user_id: string | null = null;
    try { user_id = verifyState(q.state, readCookie(event.headers?.cookie, STATE_COOKIE))?.uid ?? null; }
    catch { user_id = null; }
    let res;
    try {
      res = await handle(event);
    } catch (e) {
      await audit(admin(), "connect", "failure", {
        user_id, platform: provider, detail: { reason: "threw", message: e instanceof Error ? e.message.slice(0, 200) : "error" },
      });
      throw e;
    }
    const location = String((res as any)?.headers?.Location ?? (res as any)?.headers?.location ?? "");
    const params = new URL(location || "https://x.invalid/").searchParams;
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      await audit(admin(), "connect", "success", { user_id, platform: provider, detail: { connected } });
    } else if (error) {
      // "denied" is the person pressing Cancel on the platform's screen: a
      // failure to connect, recorded as one, but not a fault of anyone's.
      await audit(admin(), "connect", "failure", { user_id, platform: provider, detail: { reason: error } });
    }
    return res;
  };
}

/* ------------------------------------------------------------------------ *
 * Retention and the weekly review (Meta DPA 3.1-22.d and .e).
 * Both run inside the four-hourly token-refresh job: no extra Cron Trigger,
 * and the free plan's triggers are a shared, account-wide allowance.
 * ------------------------------------------------------------------------ */

export const AUDIT_RETENTION_DAYS = 90;
export const REVIEW_EVERY_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;

type AuditRow = { event: string; outcome: string; detail?: Record<string, any> | null; at?: string };

/**
 * Events that need a person, whatever else is going on. Deliberately narrow:
 * a client pressing Cancel on a consent screen is a failed connect, and paging
 * someone for it would teach them to ignore the page.
 *
 *  - any failed disconnect, account deletion, deletion request or deauthorize:
 *    each is a data subject's right not honoured, and each promised them
 *    something (a deletion, "we have been alerted") that now needs a human;
 *  - a Meta deletion or deauthorize request that matched nobody: the one
 *    path never tested live, where a wrong id lookup would quietly delete
 *    nothing.
 */
export function isAlarming(r: AuditRow): boolean {
  const rights = ["disconnect", "account.delete", "platform.deletion_request", "platform.deauthorize"];
  if (r.outcome === "failure" && rights.includes(r.event)) return true;
  if (r.event === "platform.deletion_request" && r.detail?.status === "not_found") return true;
  if (r.event === "platform.deauthorize" && r.detail?.matched === false) return true;
  return false;
}

/** Remove rows past retention. The table's own trigger refuses anything younger. */
export async function purgeAudit(db: Db, now = Date.now()): Promise<boolean> {
  const cutoff = new Date(now - AUDIT_RETENTION_DAYS * DAY_MS).toISOString();
  const { error } = await db.from("audit_log").delete().lt("at", cutoff);
  return !writeFailed("audit.purge_failed", error, { cutoff });
}

/**
 * Once a week: count the week's events and alarms, and record that the review
 * ran. The record matters as much as the counting: Meta asks whether logs are
 * reviewed at least weekly, and /api/health turns red if this stops happening.
 */
export async function weeklyReview(db: Db, now = Date.now()): Promise<"reviewed" | "not_due" | "failed"> {
  const { data: last, error: lastErr } = await db
    .from("audit_log").select("at").eq("event", "audit.weekly_review")
    .order("at", { ascending: false }).limit(1);
  if (writeFailed("audit.review_read_failed", lastErr, {})) return "failed";
  const lastAt = (last as AuditRow[] | null)?.[0]?.at;
  if (lastAt && now - Date.parse(lastAt) < REVIEW_EVERY_MS) return "not_due";

  const since = new Date(now - REVIEW_EVERY_MS).toISOString();
  const { data: rows, error } = await db
    .from("audit_log").select("event,outcome,detail,at").gte("at", since).limit(10_000);
  if (writeFailed("audit.review_read_failed", error, {})) return "failed";

  const week = (rows ?? []) as AuditRow[];
  const counts: Record<string, number> = {};
  for (const r of week) counts[`${r.event}:${r.outcome}`] = (counts[`${r.event}:${r.outcome}`] ?? 0) + 1;
  const alarming = week.filter(isAlarming).length;
  await audit(db, "audit.weekly_review", "success", { detail: { since, events: week.length, counts, alarming } });
  log("audit.weekly_review", { events: week.length, alarming });
  return "reviewed";
}
