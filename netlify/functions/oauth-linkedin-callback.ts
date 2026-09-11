import type { Handler } from "./_lib";
import {
  verifyState, readCookie, clearNonceCookie, STATE_COOKIE, admin, saveAccount,
  backToApp, encryptToken, log, AccountOwnedByAnotherTenant,
} from "./_lib";
import { LI, liGet, administeredOrganizations } from "./_linkedin";

/** LinkedIn redirect target. Company Pages only; see oauth-linkedin.ts. */
export const handler: Handler = async (event) => {
  const q = event.queryStringParameters ?? {};
  const clear = { "Set-Cookie": clearNonceCookie() };

  if (q.error) {
    log("oauth.provider_error", { provider: "linkedin", error: q.error, description: q.error_description });
    return backToApp("error", "permission_declined", clear);
  }

  // The nonce check is not optional. A signature alone lets an attacker replay
  // their own state into a victim's browser and attach the victim's page to the
  // attacker's tenant — the account-takeover this closed on the Meta path.
  const nonce = readCookie(event.headers.cookie, STATE_COOKIE);
  const state = verifyState(q.state, nonce);
  if (!state) {
    log("oauth.bad_state", { provider: "linkedin", had_cookie: Boolean(nonce) });
    return backToApp("error", "bad_state", clear);
  }
  const code = q.code;
  if (!code) return backToApp("error", "missing_code", clear);

  try {
    const redirectUri = `${process.env.VITE_SITE_URL ?? process.env.URL ?? ""}/api/oauth-linkedin-callback`;
    const clientId = process.env.LINKEDIN_CLIENT_ID ?? "";
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) return backToApp("error", "linkedin_not_configured", clear);

    /*
     * The exchange is a form POST, not JSON. LinkedIn answers a wrong secret and
     * a mismatched redirect_uri with the same generic invalid_request, so the
     * same diagnostic discipline applies as on the Meta path: log what is public
     * and never the secret itself.
     */
    const res = await fetch(LI.TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !body.access_token) {
      log("oauth.exchange_failed", {
        provider: "linkedin", status: res.status,
        client_id: clientId,
        cred_len: clientSecret.length,
        redirect_uri: redirectUri,
        detail: String(body.error_description ?? body.error ?? "").slice(0, 200),
      });
      return backToApp("error", "linkedin_exchange_failed", clear);
    }

    const accessToken = String(body.access_token);
    /*
     * LinkedIn tokens are ~60 days and the refresh token is NOT issued by
     * default — it is granted only to approved applications. Store whatever came
     * back rather than assuming; token-refresh must handle its absence by
     * telling the client to reconnect rather than failing silently.
     */
    const expiresAt = typeof body.expires_in === "number"
      ? new Date(Date.now() + body.expires_in * 1000).toISOString()
      : null;
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;

    /*
     * Which page are we connecting?
     *
     * Reporting needs the ADMINISTRATOR role specifically; CONTENT_ADMIN and
     * DIRECT_SPONSORED_CONTENT_POSTER can read posts and then get 403 from every
     * statistics endpoint. Filtering here means a client who picks the wrong
     * page is told now, rather than seeing an empty dashboard after the first
     * sync and concluding the product is broken.
     */
    const orgs = await administeredOrganizations(accessToken);
    if (!orgs.length) {
      log("oauth.no_admin_org", { provider: "linkedin", uid: state.uid });
      return backToApp("error", "linkedin_no_admin_page", clear);
    }

    /*
     * One page per connection, and the first administered page is taken.
     *
     * A client with several pages needs to choose, and that is a UI this does
     * not have yet. Taking the first is a decision, not an accident: it is
     * recorded in the log with the full list so a wrong pick is diagnosable, and
     * `available_orgs` is stored so a picker can be added without another
     * authorisation round trip.
     */
    const chosen = orgs[0];
    const orgId = chosen.urn.split(":").pop() ?? "";
    if (!orgId) throw new Error("no_linkedin_organization_id");
    if (orgs.length > 1) {
      log("oauth.multiple_orgs", {
        provider: "linkedin", uid: state.uid, chose: chosen.urn, of: orgs.length,
      });
    }

    const profile = await liGet<{ localizedName?: string; vanityName?: string; logoV2?: unknown }>(
      `${LI.ORGANIZATION}/${orgId}`, {}, { token: accessToken },
    ).catch(() => ({} as { localizedName?: string; vanityName?: string }));

    const db = admin();
    const { data: identity, error: idErr } = await db
      .from("provider_identities")
      .upsert({
        user_id: state.uid,
        provider: "linkedin",
        external_user_id: orgId,
        access_token: encryptToken(accessToken),
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider,external_user_id" })
      .select("id")
      .single();
    if (idErr) throw idErr;

    const accountId = await saveAccount(db, state.uid,
      {
        platform: "linkedin",
        external_id: orgId,
        username: profile.vanityName ?? profile.localizedName ?? `organization-${orgId}`,
        display_name: profile.localizedName ?? null,
        avatar_url: null,
      },
      {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        extra: {
          kind: "li_organization",
          urn: chosen.urn,
          available_orgs: orgs.map((o) => o.urn),
        },
      });

    /*
     * Recorded, not audited.
     *
     * The Instagram callback probes what Meta actually issued, because Meta
     * grants what the account previously allowed and a token can exceed the
     * request. LinkedIn issues exactly the scopes asked for, so there is nothing
     * to discover — but `rw_organization_admin` IS write-capable, and the same
     * column should say so. A client looking at their Connections page must see
     * the same warning here as there.
     */
    const writeScopes = LI.SCOPES.filter((s) => s.startsWith("rw_") || s.startsWith("w_"));
    await db.from("social_accounts")
      .update({
        identity_id: identity.id,
        auth_mode: "linkedin_organization",
        write_scopes: writeScopes,
        scopes_checked_at: new Date().toISOString(),
        // Cleared here, because this IS the reconnection the flag was asking for.
        // Leaving it set would keep nagging a client who has just done the thing.
        needs_reauth: false,
      })
      .eq("id", accountId);

    log("oauth.connected", {
      provider: "linkedin", uid: state.uid, mode: "organization",
      org: chosen.urn, write_scopes: writeScopes.length,
    });
    return backToApp("connected", "linkedin", clear);
  } catch (e) {
    if (e instanceof AccountOwnedByAnotherTenant) return backToApp("error", "already_connected_elsewhere", clear);
    log("oauth.callback_failed", { provider: "linkedin", detail: e instanceof Error ? e.message : String(e) });
    return backToApp("error", "linkedin_callback_failed", clear);
  }
};
