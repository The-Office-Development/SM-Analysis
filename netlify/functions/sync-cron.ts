import type { Handler } from "./_lib";
import { admin, log, writeFailed, type Db } from "./_lib";
import { runAccount, linkedInNotDue } from "./sync";
import type { AccountRow } from "./_sync";

/**
 * Scheduled sync for ALL users' connected accounts.
 *
 * One invocation cannot drain the whole estate: the old single daily pass died
 * after roughly eight accounts and reported HTTP 200. So the Worker fires every
 * minute (worker-cron/wrangler.toml), and each firing takes the one account
 * that has waited longest for its turn, if its turn is due. The trailing-window
 * re-fetch in _sync.ts means a missed run self-heals rather than leaving a
 * permanent hole. (This comment said "hourly, least recently synced first"
 * until 2026-09-19; both halves had stopped being true.)
 */
const TIME_BUDGET_MS = 22_000;

/**
 * ONE account per invocation, measured rather than chosen.
 *
 * On 2026-09-18 the Worker's own log showed every run syncing the first
 * account and then failing the second with "Too many subrequests by single
 * Worker invocation": Cloudflare's free plan gives an invocation 50 outbound
 * requests, and one Instagram account spends about 27 calls plus its database
 * reads and writes. The second account's sync_log insert hit the same wall, so
 * the table showed no failures while half of all runs failed, and the run still
 * returned 200.
 *
 * So the cron fires every minute and each firing, with its own fresh 50, takes
 * one account that is due. Per-account cadence is 15 minutes up to 15
 * accounts, then one minute per account after that. On a plan with a higher
 * subrequest limit, raise SYNC_ACCOUNTS_PER_RUN rather than the schedule.
 */
const PER_RUN = Math.max(1, Number(process.env.SYNC_ACCOUNTS_PER_RUN ?? 1));
/** An account is due when its last turn is older than this. */
export const DUE_AFTER_MS = 15 * 60_000;
/** How far down the queue to look for one account that is actually runnable. */
const CANDIDATES = 10;

type CronAccount = AccountRow & { user_id: string };
type RunOne = (db: Db, acc: CronAccount, userId: string) => Promise<{ ok: boolean; code?: string }>;

/**
 * The queue itself, with the runner injected so it can be tested without
 * calling Instagram. `run` below is the only production caller.
 */
export async function runDue(db: Db, runOne: RunOne, now = Date.now()) {
  const startedAt = Date.now();
  const dueBefore = new Date(now - DUE_AFTER_MS).toISOString();
  /*
   * Ordered by the TURN, not by last_synced_at. last_synced_at moves only on
   * success, so an account that fails every time would stay at the front and,
   * with one account per run, take every slot there is.
   */
  const { data: accounts, error } = await db
    .from("social_accounts")
    .select("id,platform,external_id,username,user_id,last_synced_at,tz_offset_minutes,sync_turn_at")
    .eq("status", "connected")
    .or(`sync_turn_at.is.null,sync_turn_at.lt.${dueBefore}`)
    .order("sync_turn_at", { ascending: true, nullsFirst: true })
    .limit(CANDIDATES);

  if (error) {
    log("cron.query_failed", { detail: error.message });
    return { statusCode: 500, body: error.message };
  }

  let ok = 0, failed = 0, attempted = 0, skipped = 0, unclaimable = 0;
  for (const acc of (accounts ?? []) as CronAccount[]) {
    if (attempted >= PER_RUN) break;
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    /*
     * Take the turn BEFORE running. A run that dies part-way (the subrequest
     * cap, a Worker kill) never reaches its own bookkeeping, and an account
     * whose turn was never recorded would be first in line again next minute.
     *
     * And take it as a compare-and-set: the update only matches while the
     * account is still due, and returns the rows it changed. Two invocations
     * that read the queue at the same moment would otherwise both run the same
     * account; that happened live at 23:45 on 2026-09-18, when the old and new
     * schedules overlapped during a deploy. Any run longer than a minute would
     * overlap the next firing the same way.
     */
    const { data: claimed, error: turnErr } = await db
      .from("social_accounts")
      .update({ sync_turn_at: new Date(now).toISOString() })
      .eq("id", acc.id)
      .or(`sync_turn_at.is.null,sync_turn_at.lt.${dueBefore}`)
      .select("id");
    if (writeFailed("cron.turn_write_failed", turnErr, { account: acc.id })) { unclaimable++; continue; }
    // Another invocation took it between our read and this write.
    if (!claimed?.length) { log("cron.turn_lost", { account: acc.id }); continue; }

    // LinkedIn's per-member daily call limit. The page has had its turn, so it
    // is not looked at again for fifteen minutes, but it is not an attempt.
    if (await linkedInNotDue(db, acc)) { skipped++; continue; }
    attempted++;
    const r = await runOne(db, acc, acc.user_id);
    if (r.ok) ok++;
    else {
      failed++;
      if (r.code === "throttled") { log("cron.throttled_stop", { attempted }); break; }
    }
  }

  log("cron.finished", { attempted, ok, failed, skipped, unclaimable, due: accounts?.length ?? 0, ms: Date.now() - startedAt });
  // A run that syncs nothing is a failure, not a success. Returning 200 on 0/450
  // is why an expired API version went unnoticed for three months. "Nothing
  // was due" is healthy; "accounts were due and none could even be claimed"
  // is the database refusing writes, and must not read as an idle minute.
  const healthy = ok > 0 || (attempted === 0 && unclaimable === 0);
  return { statusCode: healthy ? 200 : 500, body: JSON.stringify({ due: accounts?.length ?? 0, attempted, ok, failed, skipped, unclaimable }) };
}

export const run: Handler = async () => runDue(admin(), runAccount);

/*
 * The Netlify entry point. `run` is exported separately so Cloudflare's Cron
 * Trigger in worker-cron/ can invoke exactly the same body — the hourly pacing,
 * the time budget and the "0 of 450 is a failure, not a 200" check are decisions
 * that must not be reimplemented per platform.
 */
/*
 * Scheduled every "0 * * * *". The schedule now lives with the Cron Trigger
 * in worker-cron/wrangler.toml; this module exports only the work, so the
 * cadence is declared in one place and the body cannot be invoked over HTTP.
 */
