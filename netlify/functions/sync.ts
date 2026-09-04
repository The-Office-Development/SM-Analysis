import type { Handler } from "@netlify/functions";
import { admin, userIdFromToken, json, isAuthError, isThrottleError, log, type Db } from "./_lib";
import { syncAccount, type AccountRow } from "./_sync";

/** Minimum gap between syncs of one account, enforced server-side.
 *  The UI disables its button while a sync runs; a script does not. */
const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export async function runAccount(db: Db, acc: AccountRow, userId: string | null) {
  const started = new Date().toISOString();
  try {
    const res = await syncAccount(db, acc);
    await db.from("sync_log").insert({
      account_id: acc.id, user_id: userId, started_at: started,
      finished_at: new Date().toISOString(), ok: true,
      calls: res.calls, rows_written: res.rowsWritten,
    });
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
    await db.from("sync_log").insert({
      account_id: acc.id, user_id: userId, started_at: started,
      finished_at: new Date().toISOString(), ok: false,
      error_code: code, error_message: message.slice(0, 500),
    });
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
  const due = (accounts as any[]).filter(
    (a) => !a.last_synced_at || now - Date.parse(a.last_synced_at) > MIN_SYNC_INTERVAL_MS
  );
  if (!due.length) {
    return json(200, { message: "Already up to date — synced within the last 15 minutes.", ok: 0, total: accounts.length });
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
