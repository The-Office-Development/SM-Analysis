import type { Handler } from "@netlify/functions";
import {
  verifyState, readCookie, clearNonceCookie, STATE_COOKIE, admin, saveAccount,
  backToApp, encryptToken, log, AccountOwnedByAnotherTenant,
} from "./_lib";
import { exchangeCode, igGet, IG } from "./_instagram";

/** Instagram Login redirect target. */
export const handler: Handler = async (event) => {
  const q = event.queryStringParameters ?? {};
  const clear = { "Set-Cookie": clearNonceCookie() };

  if (q.error) {
    log("oauth.provider_error", { provider: "instagram", error: q.error, description: q.error_description });
    return backToApp("error", "permission_declined", clear);
  }

  const nonce = readCookie(event.headers.cookie, STATE_COOKIE);
  const state = verifyState(q.state, nonce);
  if (!state) {
    log("oauth.bad_state", { provider: "instagram", had_cookie: Boolean(nonce) });
    return backToApp("error", "bad_state", clear);
  }
  const code = q.code;
  if (!code) return backToApp("error", "missing_code", clear);

  try {
    const redirectUri = `${process.env.VITE_SITE_URL ?? process.env.URL ?? ""}/api/oauth-instagram-callback`;

    /*
     * Diagnostic for the code exchange, which is the step with the least
     * informative errors in the whole flow. Meta answers a wrong client_secret,
     * a mismatched redirect_uri and a reused code with variations on the SAME
     * message, so the log has to distinguish them instead.
     *
     * Nothing secret is recorded. client_id is public — it travels in the
     * authorize URL the browser follows — and redirect_uri is public for the
     * same reason. The secret appears only as a LENGTH, which is enough to tell
     * "unset" from "set" from "someone pasted the wrong one", and useless to an
     * attacker. Never log the value itself.
     */
    log("oauth.exchange_attempt", {
      provider: "instagram",
      client_id: process.env.INSTAGRAM_APP_ID ?? "<unset>",
      secret_len: (process.env.INSTAGRAM_APP_SECRET ?? "").length,
      redirect_uri: redirectUri,
    });

    const tokens = await exchangeCode(
      process.env.INSTAGRAM_APP_ID ?? "",
      process.env.INSTAGRAM_APP_SECRET ?? "",
      redirectUri,
      code
    );

    const me = await igGet("/me", { fields: IG.ME_FIELDS }, tokens.accessToken);
    const externalId = String(me.user_id ?? tokens.userId);
    if (!externalId) throw new Error("no_instagram_user_id");

    const db = admin();
    const { data: identity, error: idErr } = await db
      .from("provider_identities")
      .upsert({
        user_id: state.uid,
        provider: "instagram",
        external_user_id: externalId,
        access_token: encryptToken(tokens.accessToken),
        expires_at: tokens.expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider,external_user_id" })
      .select("id")
      .single();
    if (idErr) throw idErr;

    const accountId = await saveAccount(db, state.uid,
      {
        platform: "instagram",
        external_id: externalId,
        username: me.username ?? "instagram",
        display_name: me.name ?? null,
        avatar_url: me.profile_picture_url ?? null,
      },
      { access_token: tokens.accessToken, expires_at: tokens.expiresAt, extra: { kind: "ig_login" } });

    await db.from("social_accounts")
      .update({ identity_id: identity.id, auth_mode: "instagram_login" })
      .eq("id", accountId);

    log("oauth.connected", { provider: "instagram", uid: state.uid, mode: "instagram_login" });
    return backToApp("connected", "instagram", clear);
  } catch (e) {
    if (e instanceof AccountOwnedByAnotherTenant) return backToApp("error", "already_connected_elsewhere", clear);
    log("oauth.callback_failed", { provider: "instagram", detail: e instanceof Error ? e.message : String(e) });
    return backToApp("error", "instagram_callback_failed", clear);
  }
};
