import type { Handler } from "./_lib";
import { admin, userIdFromToken, json, log, decryptToken, isAuthError, isThrottleError } from "./_lib";
import { IG, igGet } from "./_instagram";

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
    .select("id,external_id,account_id,social_accounts!inner(id,user_id,platform,external_id)")
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

  const { data: secret, error: secErr } = await db
    .from("account_secrets").select("access_token").eq("account_id", account.id).maybeSingle();
  if (secErr) return json(500, { message: `Could not read the stored token: ${secErr.message}` });
  if (!secret?.access_token) return json(409, { message: "That account needs reconnecting." });

  try {
    const token = decryptToken(secret.access_token);
    const m = await igGet(`/${row.external_id}`, {
      fields: `${IG.MEDIA_FIELDS},insights.metric(${IG.MEDIA_INSIGHT_METRICS})`,
    }, token);

    const ins: Record<string, number> = {};
    for (const d of m.insights?.data ?? []) {
      const v = d.values?.[0]?.value;
      if (typeof v === "number") ins[d.name] = v;
    }

    // null, never 0. See migration 0009: this endpoint is most often called on a
    // post too new for Instagram to have counted, and "reached 0 people" is the
    // most damaging thing it could say at that moment.
    const fresh = {
      views: ins.views ?? ins.reach ?? null,
      reach: ins.reach ?? null,
      likes: typeof m.like_count === "number" ? m.like_count : null,
      comments: typeof m.comments_count === "number" ? m.comments_count : null,
      shares: ins.shares ?? null,
      saves: ins.saved ?? null,
    };

    const { error: upErr } = await db.from("content").update(fresh).eq("id", row.id);
    if (upErr) return json(500, { message: `Fetched it, but could not save: ${upErr.message}` });

    log("refresh_post.ok", { uid, account: account.id, post: row.external_id });
    return json(200, { ...fresh, refreshed_at: new Date().toISOString() });
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
