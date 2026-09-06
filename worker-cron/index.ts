/**
 * The hourly sync, as a Cloudflare Cron Trigger.
 *
 * Pages Functions cannot be scheduled — only a Worker can — so this is a
 * separate deployment from the Pages project that serves the app. It is
 * deliberately thin: it imports `run` from netlify/functions/sync-cron.ts and
 * calls it. The pacing (hourly, least-recently-synced first), the time budget,
 * and the rule that a run syncing 0 of 450 accounts is a FAILURE rather than a
 * 200 are all decisions that belong in one place. Reimplementing them here
 * would let the two platforms drift, and the drift would be silent.
 *
 * Netlify capped a scheduled function at 30 seconds and forbade background
 * functions, which is why the body stops early and relies on the trailing
 * re-fetch to self-heal. Cloudflare's limits are more generous, but the budget
 * is left as it is: raising it is a behavioural change that deserves its own
 * reasoning and its own test, not a side effect of changing host.
 *
 * SECRETS
 * This Worker holds the service-role key and TOKEN_ENC_KEY. It has no fetch
 * handler and no route, so it is unreachable over HTTP — the only way in is the
 * schedule. That is why sync-cron is absent from the /api route table: exposing
 * it there would put an unauthenticated sync of every user's accounts on the
 * public internet.
 */
import { run as syncAll } from "../netlify/functions/sync-cron";
import { run as refreshTokens } from "../netlify/functions/token-refresh";

export default {
  async scheduled(event: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    /*
     * Two schedules, one Worker. `event.cron` says which fired, so the hourly
     * sync and the four-hourly token refresh stay independent rather than one
     * being bolted onto the other's cadence.
     *
     * A token left to lapse cannot be recovered without the user re-authorising,
     * which is why the refresh has its own schedule and its own failure log.
     */
    const isRefresh = event.cron === "0 */4 * * *";
    const job = isRefresh ? "token-refresh" : "sync-cron";
    const work = isRefresh ? refreshTokens : syncAll;

    ctx.waitUntil((async () => {
      const started = Date.now();
      try {
        const res = await work({} as never);
        console.log(JSON.stringify({
          t: new Date().toISOString(), event: "cron.invoked", job, cron: event.cron,
          status: (res as { statusCode?: number })?.statusCode ?? null,
          body: (res as { body?: string })?.body ?? null,
          ms: Date.now() - started,
        }));
      } catch (e) {
        // A throw here is otherwise invisible: nothing watches a cron run.
        console.log(JSON.stringify({
          t: new Date().toISOString(), event: "cron.threw", job,
          detail: e instanceof Error ? e.message : String(e),
        }));
        throw e;
      }
    })());
  },
};
