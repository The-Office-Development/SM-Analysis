import type { Handler } from "./_lib";
import { admin, userIdFromToken, json, isAuthError, isThrottleError, log, type Db } from "./_lib";
import { syncAccount, MAX_BACKFILL, type AccountRow } from "./_sync";

/**
 * Minimum gap between manual syncs of one account, enforced server-side. The UI
 * disables its button while a sync runs; a script does not.
 *
 * TWO MINUTES, not fifteen.
 *
 * Fifteen was chosen when the scheduled sync ran hourly, and it made sense then:
 * the button skipped up to an hour of waiting. Once the cron moved to every
 * fifteen minutes the two numbers collided, and the button silently became
 * useless — an account is essentially never more than fifteen minutes stale, so
 * every press answered "Already up to date" and did nothing.
 *
 * The throttle only needs to stop a script hammering the endpoint. Two minutes
 * does that while leaving the button its actual purpose: someone who has just
 * posted should not be told to wait for a timer.
 */
const MIN_SYNC_INTERVAL_MS = Math.max(30_000, Number(process.env.SYNC_MIN_INTERVAL_MS ?? 120_000));

export async function runAccount(db: Db, acc: AccountRow, userId: string | null) {
  const started = new Date().toISOString();
  try {
    const res = await syncAccount(db, acc);
    /*
     * A failed audit-log write must be visible.
     *
     * These inserts discarded their error, so sync_log could stop recording
     * entirely while every sync reported success — which is exactly what
     * happened: runs were visible in the platform logs and absent from the
     * table, and the table is what the operator actually reads. A log that can
     * fail silently is worse than no log, because it is trusted.
     */
    const { error: logErr } = await db.from("sync_log").insert({
      account_id: acc.id, user_id: userId, started_at: started,
      finished_at: new Date().toISOString(), ok: true,
      calls: res.calls, rows_written: res.rowsWritten,
    });
    if (logErr) log("sync.log_write_failed", { account: acc.id, detail: logErr.message });
    log("sync.ok", { account: acc.id, platform: acc.platform, ...res });
    return { ok: true as const };
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    const code = isAuthError(e) ? "auth" : isThrottleError(e) ? "throttled" : "error";
    // Classify by the platform's own error code, not by matching words in the
    // message: a metric-deprecation error containing the word "token" used to
    // flag a healthy account as expired and send the client round OAuth again.
    if (code === "auth") {
      await db.from("social_accounts").update({ status: "expired" }).eq("id", acc.id);
    }
    const { error: logErr } = await db.from("sync_log").insert({
      account_id: acc.id, user_id: userId, started_at: started,
      finished_at: new Date().toISOString(), ok: false,
      error_code: code, error_message: message.slice(0, 500),
    });
    if (logErr) log("sync.log_write_failed", { account: acc.id, detail: logErr.message });
    log("sync.failed", { account: acc.id, platform: acc.platform, code, detail: message });
    return { ok: false as const, code };
  }
}

/**
 * POST /api/sync   (Authorization: Bearer <supabase token>)
 * Pulls the latest metrics + content for every connected account of the user.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { message: "Use POST." });
  const uid = await userIdFromToken(event.headers.authorization);
  if (!uid) return json(401, { message: "Not signed in." });

  const db = admin();
  const { data: accounts, error } = await db
    .from("social_accounts")
    .select("id,platform,external_id,username,last_synced_at,tz_offset_minutes")
    .eq("user_id", uid)
    .eq("status", "connected")
    .limit(200);
  if (error) return json(500, { message: error.message });
  if (!accounts?.length) return json(200, { message: "No connected accounts to sync." });

  const now = Date.now();

  /*
   * An account still filling its backfill window is NOT "up to date".
   *
   * DAY_BUDGET means a first sync reaches only part of the way back, so a full
   * window needs several runs. Throttling those to one per fifteen minutes turns
   * a 30-day backfill into three quarters of an hour of clicking and a 90-day one
   * into over two hours — and it does so at precisely the moment a new client is
   * watching their dashboard for the first time.
   *
   * So the interval governs steady-state syncs only. An account whose earliest
   * stored day has not yet reached the backfill floor may run again immediately,
   * which lets the operator click through the fill and stops on its own once the
   * window is complete.
   */
  const floor = new Date(now - (MAX_BACKFILL - 1) * 86400000).toISOString().slice(0, 10);
  const backfilling = new Set<string>();
  for (const a of accounts as any[]) {
    const { data: first } = await db
      .from("metrics_daily").select("date")
      .eq("account_id", a.id).order("date", { ascending: true }).limit(1);
    if (!first?.length || first[0].date > floor) backfilling.add(a.id);
  }

  const due = (accounts as any[]).filter(
    (a) => !a.last_synced_at
      || now - Date.parse(a.last_synced_at) > MIN_SYNC_INTERVAL_MS
      || backfilling.has(a.id)
  );
  if (!due.length) {
    return json(200, {
      message: `Just refreshed. Everything here is less than ${Math.round(MIN_SYNC_INTERVAL_MS / 60000)} minutes old, and it updates itself every 15 minutes.`,
      ok: 0, total: accounts.length,
    });
  }

  let ok = 0;
  const needReconnect: string[] = [];
  let throttled = false;
  for (const acc of due as AccountRow[]) {
    const r = await runAccount(db, acc, uid);
    if (r.ok) ok++;
    else if (r.code === "auth") needReconnect.push(`${acc.platform}:${acc.username}`);
    else if (r.code === "throttled") { throttled = true; break; }
  }

  const message = throttled
    ? `Synced ${ok}. The platform is rate limiting us — the rest will catch up on the next run.`
    : needReconnect.length
      ? `Synced ${ok}/${due.length}. Reconnect needed: ${needReconnect.join(", ")}`
      : `Synced ${ok} account${ok === 1 ? "" : "s"}.`;
  return json(200, { message, ok, total: due.length });
};
