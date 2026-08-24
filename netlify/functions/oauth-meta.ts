import type { Handler } from "@netlify/functions";
import { env, userIdFromToken, signState, newNonce, setNonceCookie, redirect, backToApp, GRAPH_VERSION, log, admin } from "./_lib";

/**
 * Starts the Meta (Facebook + Instagram) OAuth flow.
 * POST /api/oauth-meta   body { token: <supabase access token> }  -> { url }
 *
 * The Supabase token is POSTed rather than placed in the URL: as a query
 * parameter it lands in browser history, in Netlify's request logs, and in any
 * TLS-terminating proxy along the way, and it is a live session for this tenant.
 */
/** Bump when the consent wording or the requested scopes change. */
const CONSENT_VERSION = "2026-08-1";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Use POST." };

  let token: string | undefined;
  try { token = JSON.parse(event.body || "{}").token; } catch { /* handled below */ }

  const userId = await userIdFromToken(token ?? event.headers.authorization);
  if (!userId) return backToApp("error", "not_signed_in");
  if (!env.META_APP_ID) return backToApp("error", "meta_not_configured");

  const redirectUri = `${env.SITE_URL}/api/oauth-meta-callback`;

  // Read-only scopes only. `business_management` is write-capable and nothing in
  // the sync uses it; requesting it would turn a token leak from a data exposure
  // into business-asset compromise across the client's Meta estate.
  // `public_profile` is granted by default and does not need requesting.
  const scope = [
    "pages_show_list",
    "pages_read_engagement",
    "read_insights",
    "instagram_basic",
    "instagram_manage_insights",
  ].join(",");

  // Consent is the lawful basis under Jordan's PDPL, so the moment it is given
  // is recorded rather than assumed. Withdrawal is the Disconnect action.
  await admin().from("consents").insert({
    user_id: userId,
    purpose: "connect_meta",
    version: CONSENT_VERSION,
    evidence: {
      ip: event.headers["x-nf-client-connection-ip"] ?? event.headers["client-ip"] ?? null,
      user_agent: event.headers["user-agent"] ?? null,
      scopes: scope,
    },
  });

  const nonce = newNonce();
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", signState({ uid: userId, provider: "meta", n: nonce }));
  url.searchParams.set("scope", scope);
  url.searchParams.set("response_type", "code");

  log("oauth.start", { provider: "meta", uid: userId });
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "Set-Cookie": setNonceCookie(nonce) },
    body: JSON.stringify({ url: url.toString() }),
  };
};

/** Kept so an accidental GET does not silently 404 into the SPA fallback. */
export const _redirectHelper = redirect;
