import type { Handler } from "@netlify/functions";
import { admin, env, json, log } from "./_lib";
import { verifySignedRequest } from "./meta-data-deletion";

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
  const payload = signed ? verifySignedRequest(signed, env.META_APP_SECRET) : null;
  if (!payload?.user_id) return json(400, { message: "Invalid signed_request." });

  const db = admin();
  const { data: identities } = await db
    .from("provider_identities")
    .select("id")
    .eq("provider", "meta")
    .eq("external_user_id", String(payload.user_id));

  let stopped = 0;
  for (const identity of identities ?? []) {
    const { data: accounts } = await db.from("social_accounts").select("id").eq("identity_id", identity.id);
    for (const a of accounts ?? []) {
      // Drop the credential immediately; keep the account row marked revoked so
      // the client can see what happened and reconnect deliberately.
      await db.from("account_secrets").delete().eq("account_id", a.id);
      await db.from("social_accounts").update({ status: "revoked" }).eq("id", a.id);
      stopped++;
    }
    await db.from("provider_identities").delete().eq("id", identity.id);
  }

  log("deauthorize.handled", { provider: "meta", accounts: stopped });
  return json(200, { ok: true, accounts: stopped });
};
