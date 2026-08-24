import type { Handler } from "@netlify/functions";
import {
  env, verifyState, readCookie, clearNonceCookie, STATE_COOKIE, admin, saveAccount,
  backToApp, encryptToken, log, AccountOwnedByAnotherTenant,
} from "./_lib";

/** TikTok OAuth redirect target — exchanges the code and stores the creator account. */
export const handler: Handler = async (event) => {
  const q = event.queryStringParameters ?? {};
  const clear = { "Set-Cookie": clearNonceCookie() };

  if (q.error) {
    log("oauth.provider_error", { provider: "tiktok", error: q.error, description: q.error_description });
    return backToApp("error", "permission_declined", clear);
  }

  const nonce = readCookie(event.headers.cookie, STATE_COOKIE);
  const state = verifyState(q.state, nonce);
  if (!state) {
    log("oauth.bad_state", { provider: "tiktok", had_cookie: Boolean(nonce) });
    return backToApp("error", "bad_state", clear);
  }
  const code = q.code;
  if (!code) return backToApp("error", "missing_code", clear);

  try {
    const redirectUri = `${env.SITE_URL}/api/oauth-tiktok-callback`;

    // 1. exchange code for tokens
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const tok = await tokenRes.json();
    if (!tok.access_token) {
      log("oauth.token_exchange_failed", { provider: "tiktok", detail: tok.error_description || tok.error });
      return backToApp("error", "token_exchange_failed", clear);
    }

    const expiresAt = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null;

    // 2. fetch profile
    const infoRes = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url,username,follower_count",
      { headers: { Authorization: `Bearer ${tok.access_token}` } }
    );
    const info = await infoRes.json();
    const u = info.data?.user ?? {};

    await saveAccount(admin(), state.uid,
      {
        platform: "tiktok",
        external_id: tok.open_id || u.open_id || "tiktok_user",
        username: u.username || u.display_name || "tiktok",
        display_name: u.display_name ?? null,
        avatar_url: u.avatar_url ?? null,
      },
      { access_token: tok.access_token, refresh_token: tok.refresh_token ?? null, expires_at: expiresAt, extra: { scope: tok.scope } });

    // The refresh token is what keeps a TikTok connection alive past 24 hours.
    await admin().from("provider_identities").upsert({
      user_id: state.uid, provider: "tiktok",
      external_user_id: String(tok.open_id || u.open_id || "tiktok_user"),
      access_token: encryptToken(tok.access_token),
      refresh_token: tok.refresh_token ? encryptToken(tok.refresh_token) : null,
      expires_at: expiresAt, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider,external_user_id" });

    log("oauth.connected", { provider: "tiktok", uid: state.uid });
    return backToApp("connected", "tiktok", clear);
  } catch (e) {
    if (e instanceof AccountOwnedByAnotherTenant) return backToApp("error", "already_connected_elsewhere", clear);
    log("oauth.callback_failed", { provider: "tiktok", detail: e instanceof Error ? e.message : String(e) });
    return backToApp("error", "tiktok_callback_failed", clear);
  }
};
