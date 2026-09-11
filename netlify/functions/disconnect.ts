import type { Handler } from "./_lib";
import {
  admin, userIdFromToken, json, decryptToken, appsecretProof, log, GRAPH, type Db,
} from "./_lib";

/**
 * POST /api/disconnect   (Authorization: Bearer <supabase token>)  body { account_id }
 *
 * Previously "Disconnect" set status='revoked' on our own row and stopped. The
 * token stayed live and stored, the collected data stayed, and the platform still
 * listed the app as authorised — so a client who believed they had disconnected
 * had in fact done nothing. This actually revokes, then deletes.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { message: "Use POST." });
  const uid = await userIdFromToken(event.headers.authorization);
  if (!uid) return json(401, { message: "Not signed in." });

  let accountId: string | undefined;
  try { accountId = JSON.parse(event.body || "{}").account_id; }
  catch { return json(400, { message: "Bad JSON." }); }
  if (!accountId) return json(400, { message: "Missing account_id." });

  const db = admin();
  const { data: acc } = await db
    .from("social_accounts")
    .select("id,user_id,platform,username,identity_id")
    .eq("id", accountId)
    .maybeSingle();
  // Same response whether it does not exist or belongs to someone else.
  if (!acc || acc.user_id !== uid) return json(404, { message: "Account not found." });

  // Revoke the app's platform access only when this is the last account still
  // using that identity — several Pages commonly share one authorisation.
  let revoked = false;
  if (acc.identity_id) {
    const { data: siblings } = await db
      .from("social_accounts")
      .select("id")
      .eq("identity_id", acc.identity_id)
      .neq("id", acc.id);
    if (!siblings?.length) {
      revoked = await revokeIdentity(db, acc.identity_id, acc.platform);
      await db.from("provider_identities").delete().eq("id", acc.identity_id);
    }
  }

  // Delete the credential first: if anything below fails, the worst outcome is
  // orphaned metrics, never a live token we no longer show the user.
  await db.from("account_secrets").delete().eq("account_id", acc.id);
  await db.from("metrics_daily").delete().eq("account_id", acc.id);
  await db.from("content").delete().eq("account_id", acc.id);
  await db.from("audience_snapshots").delete().eq("account_id", acc.id);
  await db.from("social_accounts").delete().eq("id", acc.id);

  log("account.disconnected", { uid, account: acc.id, platform: acc.platform, revoked });
  return json(200, {
    message: revoked
      ? `${acc.username} disconnected. Access revoked and stored data deleted.`
      : acc.platform === "linkedin"
        // Named rather than left vague. "Disconnected" with no further detail
        // invites a client to assume the app no longer has access, when what
        // actually happened is that we deleted our copy and cannot reach
        // LinkedIn to withdraw the grant on their behalf.
        ? `${acc.username} disconnected and its stored data deleted. LinkedIn does not let us `
          + `withdraw the permission for you — remove PulseBoard yourself under Settings and `
          + `Privacy, Data privacy, Permitted services.`
        : `${acc.username} disconnected and its stored data deleted.`,
    revoked,
  });
};

/** Tell the platform to drop the authorisation, using the long-lived user token. */
async function revokeIdentity(db: Db, identityId: string, platform: string): Promise<boolean> {
  const { data: idRow } = await db
    .from("provider_identities")
    .select("provider,external_user_id,access_token")
    .eq("id", identityId)
    .maybeSingle();
  if (!idRow?.access_token) return false;

  try {
    const token = decryptToken(idRow.access_token as string);
    if (idRow.provider === "meta") {
      const qs = new URLSearchParams(appsecretProof(token));
      const res = await fetch(`${GRAPH}/${idRow.external_user_id}/permissions?${qs}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    }
    if (idRow.provider === "linkedin") {
      /*
       * LinkedIn publishes no token-revocation endpoint in the OAuth flow it
       * documents for this app, and inventing a URL to POST a live credential at
       * would be worse than not trying.
       *
       * So this returns false deliberately, and the caller's message is already
       * written for that case: it says the account was disconnected and its data
       * deleted, and does NOT claim access was revoked. Our copy of the token is
       * destroyed with the rest of the row either way.
       *
       * What the client should be told, and what the interface now tells them,
       * is that removing the app is done on LinkedIn's side:
       * Settings & Privacy -> Data privacy -> Permitted services.
       */
      log("account.revoke_unavailable", {
        platform,
        detail: "LinkedIn documents no revocation endpoint for this flow; the stored "
          + "token is deleted and the client is told to remove the app in LinkedIn settings.",
      });
      return false;
    }
    if (idRow.provider === "tiktok") {
      const res = await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY ?? "",
          client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "",
          token,
        }),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    }
  } catch (e) {
    // A failed revoke must not block deletion of our copy of the data.
    log("account.revoke_failed", { platform, detail: e instanceof Error ? e.message : String(e) });
  }
  return false;
}
