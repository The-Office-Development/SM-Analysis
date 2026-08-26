import type { Handler } from "@netlify/functions";
import { userIdFromToken, signState, newNonce, setNonceCookie, backToApp, log, admin } from "./_lib";
import { authorizeUrl, IG } from "./_instagram";

/** Bump when the consent wording or the requested scopes change. */
const CONSENT_VERSION = "2026-08-1";

/**
 * Starts the Instagram Login flow.
 * POST /api/oauth-instagram   body { token: <supabase access token> }  -> { url }
 *
 * Unlike the Facebook Login path, this needs no linked Facebook Page — the
 * client authorises Instagram directly.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Use POST." };

  let token: string | undefined;
  try { token = JSON.parse(event.body || "{}").token; } catch { /* handled below */ }

  const userId = await userIdFromToken(token ?? event.headers.authorization);
  if (!userId) return backToApp("error", "not_signed_in");

  const clientId = process.env.INSTAGRAM_APP_ID ?? "";
  if (!clientId) return backToApp("error", "instagram_not_configured");

  const redirectUri = `${process.env.VITE_SITE_URL ?? process.env.URL ?? ""}/api/oauth-instagram-callback`;

  await admin().from("consents").insert({
    user_id: userId,
    purpose: "connect_instagram",
    version: CONSENT_VERSION,
    evidence: {
      ip: event.headers["x-nf-client-connection-ip"] ?? event.headers["client-ip"] ?? null,
      user_agent: event.headers["user-agent"] ?? null,
      scopes: IG.SCOPES.join(","),
      auth_mode: "instagram_login",
    },
  });

  const nonce = newNonce();
  const url = authorizeUrl(clientId, redirectUri, signState({ uid: userId, provider: "instagram", n: nonce }));

  log("oauth.start", { provider: "instagram", uid: userId, mode: "instagram_login" });
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "Set-Cookie": setNonceCookie(nonce) },
    body: JSON.stringify({ url }),
  };
};
