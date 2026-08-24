import type { Handler } from "@netlify/functions";
import { schedule } from "@netlify/functions";
import { admin, log } from "./_lib";
import { runAccount } from "./sync";
import type { AccountRow } from "./_sync";

/**
 * Scheduled sync for ALL users' connected accounts.
 *
 * Netlify caps a scheduled function at 30 seconds and it cannot be a background
 * function, so this cannot drain the whole estate in one invocation — the old
 * single daily pass died after roughly eight accounts and reported HTTP 200.
 * Instead it runs hourly, takes the accounts least recently synced first, and
 * stops while it still has time to record what it did. Every account is reached
 * within a few hours, and the trailing-window re-fetch in _sync.ts means a
 * missed run self-heals rather than leaving a permanent hole.
 */
const TIME_BUDGET_MS = 22_000;
const BATCH = 200;

const run: Handler = async () => {
  const startedAt = Date.now();
  const db = admin();
  const { data: accounts, error } = await db
    .from("social_accounts")
    .select("id,platform,external_id,username,user_id,last_synced_at")
    .eq("status", "connected")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (error) {
    log("cron.query_failed", { detail: error.message });
    return { statusCode: 500, body: error.message };
  }

  let ok = 0, failed = 0, attempted = 0;
  for (const acc of (accounts ?? []) as (AccountRow & { user_id: string })[]) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    attempted++;
    const r = await runAccount(db, acc, acc.user_id);
    if (r.ok) ok++;
    else {
      failed++;
      if (r.code === "throttled") { log("cron.throttled_stop", { attempted }); break; }
    }
  }

  const remaining = (accounts?.length ?? 0) - attempted;
  log("cron.finished", { attempted, ok, failed, remaining, ms: Date.now() - startedAt });
  // A run that syncs nothing is a failure, not a success. Returning 200 on 0/450
  // is why an expired API version went unnoticed for three months.
  const healthy = attempted === 0 || ok > 0;
  return { statusCode: healthy ? 200 : 500, body: JSON.stringify({ attempted, ok, failed, remaining }) };
};

export const handler = schedule("0 * * * *", run);
