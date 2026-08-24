import type { Handler } from "@netlify/functions";
import { env, userIdFromToken, signState, newNonce, setNonceCookie, backToApp, log, admin } from "./_lib";

/**
 * Starts the TikTok Login Kit (v2) OAuth flow.
 * POST /api/oauth-tiktok   body { token: <supabase access token> }  -> { url }
 * The Supabase token is POSTed, not put in the URL — see oauth-meta.ts.
 */
/** Bump when the consent wording or the requested scopes change. */
const CONSENT_VERSION = "2026-08-1";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Use POST." };

  let token: string | undefined;
  try { token = JSON.parse(event.body || "{}").token; } catch { /* handled below */ }

  const userId = await userIdFromToken(token ?? event.headers.authorization);
  if (!userId) return backToApp("error", "not_signed_in");
  if (!env.TIKTOK_CLIENT_KEY) return backToApp("error", "tiktok_not_configured");

  const redirectUri = `${env.SITE_URL}/api/oauth-tiktok-callback`;
  const scope = ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"].join(",");

  // Consent is the lawful basis under Jordan's PDPL, so the moment it is given
  // is recorded rather than assumed. Withdrawal is the Disconnect action.
  await admin().from("consents").insert({
    user_id: userId,
    purpose: "connect_tiktok",
    version: CONSENT_VERSION,
    evidence: {
      ip: event.headers["x-nf-client-connection-ip"] ?? event.headers["client-ip"] ?? null,
      user_agent: event.headers["user-agent"] ?? null,
      scopes: scope,
    },
  });

  const nonce = newNonce();
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY);
  url.searchParams.set("scope", scope);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", signState({ uid: userId, provider: "tiktok", n: nonce }));

  log("oauth.start", { provider: "tiktok", uid: userId });
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "Set-Cookie": setNonceCookie(nonce) },
    body: JSON.stringify({ url: url.toString() }),
  };
};
