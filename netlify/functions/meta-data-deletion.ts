import type { Handler } from "./_lib";
import crypto from "node:crypto";
import { admin, env, json, log, writeFailed, deletionStatus, type Db, type WriteError } from "./_lib";

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
  const { deleted, failed } = await deleteEverythingForMetaUser(db, String(payload.user_id));

  /*
   * The recorded status is what actually happened, not what was attempted.
   *
   * This row is the only place the truth can be told. Meta's callback response
   * has exactly two fields, `url` and `confirmation_code` — there is no failure
   * channel and no "partial" — but Meta does require the confirmation URL to
   * carry "a human-readable explanation of the status of their request,
   * including a legitimate justification for any refusal to delete". So the page
   * behind that URL is the failure channel, and it can only say "failed" if this
   * row can hold it. `failed` needs migration 0017.
   */
  const status = deletionStatus(deleted > 0, failed);
  const { error: recErr } = await db.from("deletion_requests").insert({
    confirmation_code: code,
    provider: "meta",
    external_user_id: String(payload.user_id),
    completed_at: new Date().toISOString(),
    accounts_deleted: deleted,
    status,
  });
  writeFailed("deletion.record_write_failed", recErr, { provider: "meta", code, accounts: deleted, status });

  if (failed > 0) {
    // An operator has to finish this by hand, and has 30 days to do it. Nothing
    // here can retry on the subject's behalf.
    log("deletion.incomplete", {
      provider: "meta", code, accounts: deleted, failed_writes: failed,
      detail: "some rows for this subject could not be deleted. The confirmation page reports "
        + "this as failed. Complete the erasure manually and update the request row.",
    });
  } else {
    log("deletion.completed", { provider: "meta", accounts: deleted, code });
  }

  /*
   * Still a 200 with a code, even when the erasure failed.
   *
   * Not an acknowledgement that it worked — the status behind the code says
   * plainly that it did not. Meta documents no error shape here, and answering
   * with a 500 would leave the subject with no confirmation code and no status
   * URL at all, which is strictly worse for the person the right belongs to:
   * they would have nothing to quote and nowhere to look.
   */
  // Meta reads exactly these two fields.
  return json(200, {
    url: `${env.SITE_URL}/data-deletion?code=${code}`,
    confirmation_code: code,
  });
};

/**
 * Deletes every account, token and metric tied to a Meta user id.
 *
 * Returns BOTH counts. `deleted` alone cannot distinguish an erasure that
 * worked from one where every delete was refused — the loop reaches the end
 * either way — and the caller has to tell those apart before it records a
 * status and issues a confirmation code.
 */
export async function deleteEverythingForMetaUser(
  db: Db, externalUserId: string,
): Promise<{ deleted: number; failed: number }> {
  const { data: identities } = await db
    .from("provider_identities")
    .select("id")
    .eq("provider", "meta")
    .eq("external_user_id", externalUserId);
  if (!identities?.length) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;
  for (const identity of identities) {
    const { data: accounts } = await db.from("social_accounts").select("id").eq("identity_id", identity.id);
    for (const a of accounts ?? []) {
      /*
       * A delete that fails is worse here than anywhere else in this codebase:
       * the endpoint answers Meta with a confirmation code either way, so the
       * request is closed while the data is still present. That is an App
       * Review failure and a PDPL one. Nothing here can retry on the subject's
       * behalf, but it must not pass in silence.
       */
      const gone = (table: string, res: { error?: WriteError | null }) => {
        if (writeFailed("deletion.delete_failed", res.error, { provider: "meta", account: a.id, table })) failed++;
      };
      gone("account_secrets", await db.from("account_secrets").delete().eq("account_id", a.id));
      gone("metrics_daily", await db.from("metrics_daily").delete().eq("account_id", a.id));
      gone("content", await db.from("content").delete().eq("account_id", a.id));
      gone("audience_snapshots", await db.from("audience_snapshots").delete().eq("account_id", a.id));
      gone("social_accounts", await db.from("social_accounts").delete().eq("id", a.id));
      deleted++;
    }
    const { error: idErr } = await db.from("provider_identities").delete().eq("id", identity.id);
    if (writeFailed("deletion.delete_failed", idErr, { provider: "meta", identity: identity.id, table: "provider_identities" })) failed++;
  }
  return { deleted, failed };
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
