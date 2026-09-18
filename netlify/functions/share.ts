import type { Handler } from "./_lib";
import crypto from "node:crypto";
import { admin, userIdFromToken, json, env } from "./_lib";

/**
 * Report share links.
 *   POST /api/share   (Authorization: Bearer <token>)
 *       body { snapshot, expires_in_days? }  -> { slug, url, expires_at }
 *   GET  /api/share?slug=...   (no auth)
 *       -> returns { snapshot }   (served via service role, read-only)
 *
 * The public GET is why the read path lives in a function: report_shares has
 * no anon RLS policy, so only the service-role key can read a shared snapshot.
 *
 * 🔴 **That is also why expiry is enforced HERE and cannot be a policy.** This
 * path reads with the service-role key, which bypasses RLS entirely, so a
 * policy saying `expires_at > now()` would never be consulted on the one path
 * that serves the public. The check below is the whole enforcement.
 *
 * Revocation is a delete by the owner, done from the browser under RLS. There
 * is no revoked flag: a row that still holds the payload is a row that can
 * still leak it.
 */
export const handler: Handler = async (event) => {
  const db = admin();

  if (event.httpMethod === "GET") {
    const slug = event.queryStringParameters?.slug;
    if (!slug) return json(400, { message: "Missing slug." });
    const { data, error } = await db
      .from("report_shares")
      .select("payload,expires_at")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return json(500, { message: error.message });
    if (!data) return json(404, { message: "Not found." });
    /*
     * Expired is a different answer from missing, and the person holding the
     * link is usually a sponsor or a client rather than the account owner.
     * "Not found" would read as a broken product; "expired" tells them what to
     * ask for. The payload is not returned either way.
     */
    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return json(410, { message: "This link has expired.", code: "expired" });
    }
    return json(200, { snapshot: data.payload });
  }

  if (event.httpMethod === "POST") {
    const uid = await userIdFromToken(event.headers.authorization);
    if (!uid) return json(401, { message: "Not signed in." });

    let body: { snapshot?: unknown; expires_in_days?: unknown };
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { message: "Bad JSON." }); }

    const snapshot = body.snapshot as { v?: number } | undefined;
    if (!snapshot || typeof snapshot !== "object" || snapshot.v !== 1)
      return json(400, { message: "Invalid report payload." });

    /*
     * Null means never, and it stays the default. Every link created before
     * 2026-09-19 is permanent, and quietly starting to expire links that people
     * have already sent would break reports in front of the sponsors they were
     * sent to. The caller chooses; the UI offers 7, 30 and 90 days.
     */
    const days = body.expires_in_days;
    let expiresAt: string | null = null;
    if (days != null) {
      // `!= null` on purpose: 0 is a legitimate-looking value and must be
      // rejected as out of range, not silently treated as "no expiry".
      if (typeof days !== "number" || !Number.isFinite(days) || days < 1 || days > 365)
        return json(400, { message: "An expiry must be between 1 and 365 days." });
      expiresAt = new Date(Date.now() + Math.round(days) * 86_400_000).toISOString();
    }

    const slug = crypto.randomBytes(9).toString("base64url"); // ~12 url-safe chars
    const { error } = await db.from("report_shares")
      .insert({ slug, user_id: uid, payload: snapshot, expires_at: expiresAt });
    if (error) return json(500, { message: error.message });

    const base = env.SITE_URL || "";
    return json(200, { slug, url: `${base}/r/${slug}`, expires_at: expiresAt });
  }

  return json(405, { message: "Method not allowed." });
};
