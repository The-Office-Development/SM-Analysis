import type { Handler } from "./_lib";
import crypto from "node:crypto";
import { admin, userIdFromToken, json, env } from "./_lib";

/**
 * Report share links.
 *   POST /api/share   (Authorization: Bearer <token>)  body { snapshot }
 *       -> stores the snapshot, returns { slug, url }
 *   GET  /api/share?slug=...   (no auth)
 *       -> returns { snapshot }   (served via service role, read-only)
 *
 * The public GET is why the read path lives in a function: report_shares has
 * no anon RLS policy, so only the service-role key can read a shared snapshot.
 */
export const handler: Handler = async (event) => {
  const db = admin();

  if (event.httpMethod === "GET") {
    const slug = event.queryStringParameters?.slug;
    if (!slug) return json(400, { message: "Missing slug." });
    const { data, error } = await db
      .from("report_shares")
      .select("payload")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return json(500, { message: error.message });
    if (!data) return json(404, { message: "Not found." });
    return json(200, { snapshot: data.payload });
  }

  if (event.httpMethod === "POST") {
    const uid = await userIdFromToken(event.headers.authorization);
    if (!uid) return json(401, { message: "Not signed in." });

    let body: { snapshot?: unknown };
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { message: "Bad JSON." }); }

    const snapshot = body.snapshot as { v?: number } | undefined;
    if (!snapshot || typeof snapshot !== "object" || snapshot.v !== 1)
      return json(400, { message: "Invalid report payload." });

    const slug = crypto.randomBytes(9).toString("base64url"); // ~12 url-safe chars
    const { error } = await db.from("report_shares").insert({ slug, user_id: uid, payload: snapshot });
    if (error) return json(500, { message: error.message });

    const base = env.SITE_URL || "";
    return json(200, { slug, url: `${base}/r/${slug}` });
  }

  return json(405, { message: "Method not allowed." });
};
