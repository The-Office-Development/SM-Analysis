import type { Handler } from "@netlify/functions";
import crypto from "node:crypto";
import { admin, env, json, log, type Db } from "./_lib";

/**
 * Meta data-deletion callback.  POST /api/meta-data-deletion
 *
 * Required for App Review. Meta POSTs a signed_request identifying the user; we
 * must delete their data and reply with JSON containing a status URL and a
 * confirmation code. Returning HTML, or acknowledging without deleting, fails
 * review — and the latter is an enforcement risk in its own right.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { message: "Use POST." });

  const signed = parseFormField(event.body ?? "", "signed_request");
  const payload = signed ? verifySignedRequest(signed, env.META_APP_SECRET) : null;
  if (!payload?.user_id) {
    log("deletion.bad_signed_request", {});
    return json(400, { message: "Invalid signed_request." });
  }

  const db = admin();
  const code = crypto.randomBytes(12).toString("hex");
  const deleted = await deleteEverythingForMetaUser(db, String(payload.user_id));

  await db.from("deletion_requests").insert({
    confirmation_code: code,
    provider: "meta",
    external_user_id: String(payload.user_id),
    completed_at: new Date().toISOString(),
    accounts_deleted: deleted,
    status: deleted > 0 ? "completed" : "not_found",
  });

  log("deletion.completed", { provider: "meta", accounts: deleted, code });
  // Meta reads exactly these two fields.
  return json(200, {
    url: `${env.SITE_URL}/data-deletion?code=${code}`,
    confirmation_code: code,
  });
};

/** Deletes every account, token and metric tied to a Meta user id. */
export async function deleteEverythingForMetaUser(db: Db, externalUserId: string): Promise<number> {
  const { data: identities } = await db
    .from("provider_identities")
    .select("id")
    .eq("provider", "meta")
    .eq("external_user_id", externalUserId);
  if (!identities?.length) return 0;

  let deleted = 0;
  for (const identity of identities) {
    const { data: accounts } = await db.from("social_accounts").select("id").eq("identity_id", identity.id);
    for (const a of accounts ?? []) {
      await db.from("account_secrets").delete().eq("account_id", a.id);
      await db.from("metrics_daily").delete().eq("account_id", a.id);
      await db.from("content").delete().eq("account_id", a.id);
      await db.from("audience_snapshots").delete().eq("account_id", a.id);
      await db.from("social_accounts").delete().eq("id", a.id);
      deleted++;
    }
    await db.from("provider_identities").delete().eq("id", identity.id);
  }
  return deleted;
}

function parseFormField(body: string, field: string): string | null {
  // Meta posts application/x-www-form-urlencoded.
  const params = new URLSearchParams(body);
  return params.get(field);
}

/** signed_request = base64url(HMAC-SHA256(payload, app_secret)) + "." + base64url(payload) */
export function verifySignedRequest(signed: string, appSecret: string): Record<string, unknown> | null {
  if (!appSecret) return null;
  const [sigPart, payloadPart] = signed.split(".");
  if (!sigPart || !payloadPart) return null;
  const expected = crypto.createHmac("sha256", appSecret).update(payloadPart).digest();
  const got = Buffer.from(sigPart, "base64url");
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch { return null; }
}
