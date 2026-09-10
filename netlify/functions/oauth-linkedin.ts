import type { Handler } from "./_lib";
import { userIdFromToken, signState, newNonce, setNonceCookie, backToApp, log, admin } from "./_lib";
import { LI } from "./_linkedin";

/**
 * Bump when the consent wording or the requested scopes change.
 *
 * This one matters more than the others. LinkedIn has no read-only scope for
 * page reporting, so connecting a Company Page grants `rw_organization_admin` —
 * a permission that CAN post as the page. The client is agreeing to something
 * materially different from the Instagram connection, and the consent record has
 * to show which wording they saw when they agreed to it.
 */
const CONSENT_VERSION = "2026-09-1";

/**
 * Starts the LinkedIn Company Page flow.
 * POST /api/oauth-linkedin   body { token: <supabase access token> }  -> { url }
 *
 * Company Pages only. LinkedIn's member analytics need `r_member_social` to list
 * a person's posts, and LinkedIn states that permission is closed and not
 * accepting requests, so a personal profile could only ever be a partial
 * connection. See docs/LINKEDIN.md.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Use POST." };

  let token: string | undefined;
  try { token = JSON.parse(event.body || "{}").token; } catch { /* handled below */ }

  const userId = await userIdFromToken(token ?? event.headers.authorization);
  if (!userId) return backToApp("error", "not_signed_in");

  const clientId = process.env.LINKEDIN_CLIENT_ID ?? "";
  if (!clientId) return backToApp("error", "linkedin_not_configured");

  const redirectUri = `${process.env.VITE_SITE_URL ?? process.env.URL ?? ""}/api/oauth-linkedin-callback`;

  await admin().from("consents").insert({
    user_id: userId,
    purpose: "connect_linkedin",
    version: CONSENT_VERSION,
    evidence: {
      ip: event.headers["x-nf-client-connection-ip"] ?? event.headers["client-ip"] ?? null,
      user_agent: event.headers["user-agent"] ?? null,
      scopes: LI.SCOPES.join(","),
      auth_mode: "linkedin_organization",
      // Recorded explicitly, because "we only ever read" is a claim about our
      // behaviour and not about what the token can do. If this is ever
      // questioned, the consent row should show we knew and said so.
      grants_write_capable_scope: LI.SCOPES.some((s) => s.startsWith("rw_")),
    },
  });

  const nonce = newNonce();
  const state = signState({ uid: userId, provider: "linkedin", n: nonce });

  /*
   * LinkedIn requires `scope` to be SPACE separated, where Meta accepts commas.
   * A comma-separated list is not rejected outright; it is read as one unknown
   * scope, and the consent screen then shows the client nothing recognisable.
   */
  const url = new URL(LI.AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", LI.SCOPES.join(" "));

  log("oauth.start", { provider: "linkedin", uid: userId, mode: "organization" });
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "Set-Cookie": setNonceCookie(nonce) },
    body: JSON.stringify({ url: url.toString() }),
  };
};
