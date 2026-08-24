import type { Handler } from "@netlify/functions";
import {
  env, verifyState, readCookie, clearNonceCookie, STATE_COOKIE, admin, saveAccount,
  backToApp, graphGet, encryptToken, log, GRAPH, AccountOwnedByAnotherTenant,
} from "./_lib";

/** Meta OAuth redirect target — exchanges the code and stores Pages + IG accounts. */
export const handler: Handler = async (event) => {
  const q = event.queryStringParameters ?? {};
  const clear = { "Set-Cookie": clearNonceCookie() };

  if (q.error) {
    // Provider text is logged, never reflected into the redirect URL.
    log("oauth.provider_error", { provider: "meta", error: q.error, description: q.error_description });
    return backToApp("error", "permission_declined", clear);
  }

  const nonce = readCookie(event.headers.cookie, STATE_COOKIE);
  const state = verifyState(q.state, nonce);
  if (!state) {
    log("oauth.bad_state", { provider: "meta", had_cookie: Boolean(nonce) });
    return backToApp("error", "bad_state", clear);
  }
  const code = q.code;
  if (!code) return backToApp("error", "missing_code", clear);

  try {
    const redirectUri = `${env.SITE_URL}/api/oauth-meta-callback`;

    // 1. short-lived token (client_secret authenticates this call; no proof needed)
    const shortRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: redirectUri, code,
    }), { signal: AbortSignal.timeout(8000) });
    const short = await shortRes.json();
    if (!short.access_token) {
      log("oauth.token_exchange_failed", { provider: "meta", detail: short.error?.message });
      return backToApp("error", "token_exchange_failed", clear);
    }

    // 2. long-lived user token
    const longRes = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token", client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET, fb_exchange_token: short.access_token,
    }), { signal: AbortSignal.timeout(8000) });
    const long = await longRes.json();
    const userToken: string = long.access_token || short.access_token;
    const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null;

    const db = admin();

    // 3. Persist the USER token. Revocation, refresh and Page re-discovery are all
    //    impossible without it, and previously only per-Page tokens were stored.
    const me = await graphGet("/me", { fields: "id" }, userToken);
    const { data: identity, error: idErr } = await db
      .from("provider_identities")
      .upsert({
        user_id: state.uid,
        provider: "meta",
        external_user_id: String(me.id),
        access_token: encryptToken(userToken),
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider,external_user_id" })
      .select("id")
      .single();
    if (idErr) throw idErr;

    // 4. Pages + linked Instagram business accounts, following paging.next so a
    //    user with more Pages than one page of results does not silently connect
    //    only the first slice while the UI reports success.
    const pages: any[] = [];
    let after: string | undefined;
    do {
      const params: Record<string, string> = {
        fields: "id,name,access_token,instagram_business_account{id,username,profile_picture_url}",
        limit: "100",
      };
      if (after) params.after = after;
      const page = await graphGet("/me/accounts", params, userToken);
      pages.push(...(page.data ?? []));
      after = page.paging?.cursors?.after && page.paging?.next ? page.paging.cursors.after : undefined;
    } while (after && pages.length < 500);

    if (!pages.length) return backToApp("error", "no_pages_found", clear);

    let igConnected = false;
    let conflicts = 0;
    for (const page of pages) {
      try {
        const fbId = await saveAccount(db, state.uid,
          { platform: "facebook", external_id: page.id, username: page.name, display_name: page.name },
          { access_token: page.access_token, expires_at: expiresAt, extra: { kind: "page" } });
        await db.from("social_accounts").update({ identity_id: identity.id }).eq("id", fbId);

        const ig = page.instagram_business_account;
        if (ig?.id) {
          const igId = await saveAccount(db, state.uid,
            { platform: "instagram", external_id: ig.id, username: ig.username ?? page.name, avatar_url: ig.profile_picture_url ?? null },
            { access_token: page.access_token, expires_at: expiresAt, extra: { kind: "ig_business", page_id: page.id } });
          await db.from("social_accounts").update({ identity_id: identity.id }).eq("id", igId);
          igConnected = true;
        }
      } catch (e) {
        if (e instanceof AccountOwnedByAnotherTenant) { conflicts++; continue; }
        throw e;
      }
    }

    log("oauth.connected", { provider: "meta", uid: state.uid, pages: pages.length, ig: igConnected, conflicts });
    if (conflicts && !igConnected) return backToApp("error", "already_connected_elsewhere", clear);
    // Report Instagram only when an IG business account was actually linked — two
    // Pages with no Instagram is still just Facebook.
    return backToApp("connected", igConnected ? "meta" : "facebook", clear);
  } catch (e) {
    log("oauth.callback_failed", { provider: "meta", detail: e instanceof Error ? e.message : String(e) });
    return backToApp("error", "meta_callback_failed", clear);
  }
};
