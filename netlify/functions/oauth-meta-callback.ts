import type { Handler } from "@netlify/functions";
import { env, verifyState, admin, saveAccount, backToApp } from "./_lib";

const GRAPH = "https://graph.facebook.com/v19.0";

/** Meta OAuth redirect target — exchanges the code and stores Pages + IG accounts. */
export const handler: Handler = async (event) => {
  const q = event.queryStringParameters ?? {};
  if (q.error) return backToApp("error", q.error_description || q.error);

  const state = verifyState(q.state);
  if (!state) return backToApp("error", "bad_state");
  const code = q.code;
  if (!code) return backToApp("error", "missing_code");

  try {
    const redirectUri = `${env.SITE_URL}/api/oauth-meta-callback`;

    // 1. short-lived token
    const shortRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: redirectUri, code,
    }));
    const short = await shortRes.json();
    if (!short.access_token) return backToApp("error", short.error?.message || "token_exchange_failed");

    // 2. long-lived token
    const longRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token", client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET, fb_exchange_token: short.access_token,
    }));
    const long = await longRes.json();
    const userToken: string = long.access_token || short.access_token;
    const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null;

    // 3. pages + linked Instagram business accounts
    const pagesRes = await fetch(`${GRAPH}/me/accounts?` + new URLSearchParams({
      fields: "id,name,access_token,instagram_business_account{id,username,profile_picture_url}",
      access_token: userToken,
    }));
    const pages = await pagesRes.json();
    if (!pages.data?.length) return backToApp("error", "no_pages_found");

    const db = admin();
    let connected = 0;
    let igConnected = false;
    for (const page of pages.data) {
      await saveAccount(db, state.uid,
        { platform: "facebook", external_id: page.id, username: page.name, display_name: page.name },
        { access_token: page.access_token, expires_at: expiresAt, extra: { kind: "page" } });
      connected++;

      const ig = page.instagram_business_account;
      if (ig?.id) {
        await saveAccount(db, state.uid,
          { platform: "instagram", external_id: ig.id, username: ig.username ?? page.name, avatar_url: ig.profile_picture_url ?? null },
          { access_token: page.access_token, expires_at: expiresAt, extra: { kind: "ig_business", page_id: page.id } });
        connected++;
        igConnected = true;
      }
    }
    // Report Instagram only when an IG business account was actually linked — two
    // Pages with no Instagram is still just Facebook.
    return backToApp("connected", igConnected ? "meta" : "facebook");
  } catch (e) {
    return backToApp("error", e instanceof Error ? e.message : "meta_callback_failed");
  }
};
