import type { Handler } from "./_lib";
import { admin, userIdFromToken, json, log, decryptToken, isAuthError, isThrottleError } from "./_lib";
import { IG, igGet, insightValues, storyLadderFrom, storyFigures, STORY_METRIC_LADDER_VERSION } from "./_instagram";

/**
 * POST /api/refresh-post   { "id": "<content row id>" }
 *
 * Fetch ONE post's current numbers from Instagram, right now.
 *
 * WHY THIS IS NOT THE SYNC
 * The daily-metrics sync costs roughly five API calls per day of history, which
 * is what forces DAY_BUDGET and the multi-run backfill; it can never be
 * real-time. A single post is one call. They are different shapes of work and
 * deliberately do not share a path — making the whole sync live is impossible,
 * making one post live is trivial.
 *
 * The question it serves has a deadline: someone published an hour ago and wants
 * to know whether to keep it. An hourly cron does not answer that.
 *
 * HONESTY CONSTRAINT
 * Instagram reports nothing for a post's first minutes and keeps counting for
 * days, so "refreshed" does not mean "final" and a metric it declines to return
 * is written as null, never 0. This is the endpoint most likely to be called
 * against a post too young to have numbers, which makes it the one where a
 * fabricated zero would do the most damage.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { message: "Use POST." });

  const uid = await userIdFromToken(event.headers.authorization);
  if (!uid) return json(401, { message: "Not signed in." });

  let id = "";
  try { id = String(JSON.parse(event.body ?? "{}").id ?? ""); } catch { /* handled below */ }
  if (!id) return json(400, { message: "Which post?" });

  const db = admin();

  /*
   * Ownership is checked by joining through social_accounts on THIS user's id.
   * A content row id is guessable, and without this join any signed-in user
   * could refresh — and therefore read — any other tenant's post.
   */
  const { data: row, error: rowErr } = await db
    .from("content")
    .select("id,external_id,account_id,refreshed_at,media_type,expires_at,social_accounts!inner(id,user_id,platform,external_id,story_metrics)")
    .eq("id", id)
    .eq("social_accounts.user_id", uid)
    .maybeSingle();

  if (rowErr) {
    log("refresh_post.lookup_failed", { uid, detail: rowErr.message });
    return json(500, { message: "Could not look that post up." });
  }
  if (!row) return json(404, { message: "That post is not one of yours." });

  const account = (row as any).social_accounts;
  if (account.platform !== "instagram") {
    return json(400, { message: "Refreshing one post is only supported for Instagram so far." });
  }

  /*
   * An expired story cannot be re-read: Instagram stops serving it after 24
   * hours, so every attempt is a guaranteed failure that still spends a Worker
   * invocation. Its stored figures are the final ones, and saying so is the
   * useful answer.
   */
  const story = (row as any).media_type === "Story";
  const expiresAt = (row as any).expires_at ? Date.parse((row as any).expires_at) : NaN;
  if (story && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    return json(409, { code: "story_expired", message: "This story has expired, so its figures are final." });
  }

  /*
   * A cooldown, per post.
   *
   * Instagram throttling would only inconvenience the caller, but every hit here
   * also spends a Cloudflare Worker invocation, and on the free plan that daily
   * budget is ACCOUNT-wide — shared with every other project on the same
   * Cloudflare account. An abusive or looping client could take unrelated sites'
   * functions down with it, so the limit protects more than this product.
   *
   * Thirty seconds is chosen against what Instagram actually does: it updates a
   * post's figures far more slowly than that, so a shorter gap would spend calls
   * to return the same numbers.
   */
  const COOLDOWN_MS = 30_000;
  const last = (row as any).refreshed_at ? Date.parse((row as any).refreshed_at) : 0;
  const waited = Date.now() - last;
  if (last && waited < COOLDOWN_MS) {
    return json(429, {
      message: `Just checked. Try again in ${Math.ceil((COOLDOWN_MS - waited) / 1000)}s — `
        + `Instagram updates these more slowly than that anyway.`,
    });
  }

  const { data: secret, error: secErr } = await db
    .from("account_secrets").select("access_token").eq("account_id", account.id).maybeSingle();
  if (secErr) return json(500, { message: `Could not read the stored token: ${secErr.message}` });
  if (!secret?.access_token) return json(409, { message: "That account needs reconnecting." });

  try {
    const token = decryptToken(secret.access_token);

    // null, never 0. See migration 0009: this endpoint is most often called on a
    // post too new for Instagram to have counted, and "reached 0 people" is the
    // most damaging thing it could say at that moment.
    let fresh: Record<string, number | null>;
    if (story) {
      /*
       * A story is asked for STORY metrics, down the same ladder the sync uses.
       *
       * This used to send a story the feed list (`reach,saved,shares,views`).
       * `saved` is not a story metric and an insights request is all-or-nothing,
       * so every story refresh failed: silently when the page opened, and as
       * "Instagram did not answer" on Check now, during the 24 hours in which
       * the figures matter most.
       *
       * A refusal steps down a rung. Error #10 (fewer than five viewers) is a
       * refusal too, and if no rung answers there is simply nothing new yet.
       */
      const pref = account.story_metrics;
      const preferred = pref?.v === STORY_METRIC_LADDER_VERSION && typeof pref?.metrics === "string" ? pref.metrics : null;
      let ins: Record<string, number> | null = null;
      for (const metrics of storyLadderFrom(preferred)) {
        try {
          const answer = await igGet(`/${row.external_id}/insights`, { metric: metrics }, token);
          ins = insightValues(answer?.data);
          break;
        } catch (e) {
          // A dead token or a throttle is not a narrower list's problem.
          if (isAuthError(e) || isThrottleError(e)) throw e;
        }
      }
      // storyFigures writes null for likes, comments and saves, which a story
      // never has. Those are dropped below with every other null, so a stored
      // value is never touched by this path.
      fresh = ins ? storyFigures(ins) : {};
    } else {
      const m = await igGet(`/${row.external_id}`, {
        fields: `${IG.MEDIA_FIELDS},insights.metric(${IG.MEDIA_INSIGHT_METRICS})`,
      }, token);
      const ins = insightValues(m.insights?.data);
      fresh = {
        views: ins.views ?? ins.reach ?? null,
        reach: ins.reach ?? null,
        likes: typeof m.like_count === "number" ? m.like_count : null,
        comments: typeof m.comments_count === "number" ? m.comments_count : null,
        shares: ins.shares ?? null,
        saves: ins.saved ?? null,
      };
    }

    const refreshedAt = new Date().toISOString();
    /*
     * Only the figures Instagram actually returned this time.
     *
     * `fresh` is null wherever this call got nothing back, and writing it whole
     * put null over a real stored number — a client pressing "Check now" on a
     * post whose insights were momentarily refused would watch its reach vanish.
     * A lifetime counter never legitimately goes from a number back to unknown.
     */
    const known = Object.fromEntries(Object.entries(fresh).filter(([, v]) => v !== null));
    const gotAny = Object.keys(known).length > 0;
    const { error: upErr } = await db.from("content")
      // refreshed_at rate-limits this endpoint and is always stamped. checked_at
      // is the freshness the client is SHOWN, so it moves only when figures
      // actually came back: "checked just now" over numbers nobody re-read
      // would be a false claim about how current they are.
      .update(gotAny
        ? { ...known, refreshed_at: refreshedAt, checked_at: refreshedAt }
        : { refreshed_at: refreshedAt })
      .eq("id", row.id);
    if (upErr) return json(500, { message: `Fetched it, but could not save: ${upErr.message}` });

    log("refresh_post.ok", { uid, account: account.id, post: row.external_id, story, figures: Object.keys(known).length });
    /*
     * The response carries ONLY the figures read this time.
     *
     * It used to return `fresh` whole, nulls included, and the page spreads the
     * response over the stored post. So the database kept a real reach while the
     * screen showed it vanish, which is the exact defect the filter above was
     * written to stop, reintroduced one layer up. And the page refreshes on
     * open, so nobody had to press anything for it to happen.
     */
    return json(200, gotAny
      ? { ...known, refreshed_at: refreshedAt }
      : { refreshed_at: null, note: "Instagram has nothing new for this yet. The figures shown are the latest it reported." });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Classify by the platform's own error rather than by words in the message,
    // for the same reason the sync does: a metric-deprecation error containing
    // the word "token" once flagged healthy accounts as expired.
    if (isAuthError(e)) return json(409, { message: "That account needs reconnecting." });
    if (isThrottleError(e)) return json(429, { message: "Instagram is rate limiting us. Try again shortly." });
    log("refresh_post.failed", { uid, account: account.id, detail: message });
    return json(502, { message: "Instagram did not answer. Try again shortly." });
  }
};
