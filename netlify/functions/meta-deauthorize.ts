import type { Handler } from "./_lib";
import { admin, json, log, writeFailed } from "./_lib";
import { verifyMetaFamilyRequest } from "./meta-data-deletion";

/**
 * Meta deauthorize callback.  POST /api/meta-deauthorize
 *
 * Fires when a user removes the app from their Facebook settings. Without it the
 * sync keeps presenting a revoked account as connected and keeps calling the API
 * with a token the user believes they withdrew — repeated failed calls against a
 * withdrawn authorisation are exactly the pattern that draws platform attention.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { message: "Use POST." });

  const signed = new URLSearchParams(event.body ?? "").get("signed_request");
  // Either of our Meta apps; see verifyMetaFamilyRequest for why both.
  const { payload, provider } = verifyMetaFamilyRequest(signed);
  if (!payload?.user_id || !provider) return json(400, { message: "Invalid signed_request." });

  const db = admin();
  const { data: identities } = await db
    .from("provider_identities")
    .select("id")
    .eq("provider", provider)
    .eq("external_user_id", String(payload.user_id));

  let stopped = 0;
  for (const identity of identities ?? []) {
    const { data: accounts } = await db.from("social_accounts").select("id").eq("identity_id", identity.id);
    for (const a of accounts ?? []) {
      // Drop the credential immediately; keep the account row marked revoked so
      // the client can see what happened and reconnect deliberately.
      //
      // Both writes are checked. A credential we failed to drop is one the user
      // believes they withdrew, and the sync will keep presenting the account as
      // connected — the exact pattern this callback exists to stop.
      const { error: secErr } = await db.from("account_secrets").delete().eq("account_id", a.id);
      writeFailed("deauthorize.write_failed", secErr, { account: a.id, table: "account_secrets" });
      const { error: accErr } = await db.from("social_accounts").update({ status: "revoked" }).eq("id", a.id);
      writeFailed("deauthorize.write_failed", accErr, { account: a.id, table: "social_accounts" });
      stopped++;
    }
    const { error: idErr } = await db.from("provider_identities").delete().eq("id", identity.id);
    writeFailed("deauthorize.write_failed", idErr, { identity: identity.id, table: "provider_identities" });
  }

  if (!identities?.length) log("deauthorize.no_identity_match", { provider, external_user_id: String(payload.user_id) });
  log("deauthorize.handled", { provider, accounts: stopped });
  return json(200, { ok: true, accounts: stopped });
};
