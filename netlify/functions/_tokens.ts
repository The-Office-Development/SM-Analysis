import { type Db, env, encryptToken, decryptToken, graphGet, log, GRAPH } from "./_lib";
import { refreshLongLivedToken } from "./_instagram";

/**
 * Token refresh.
 *
 * Refresh tokens were stored and never read: TikTok access tokens expire after
 * 24 hours, so a connection died daily and the client was asked to walk the whole
 * OAuth flow again. Meta long-lived user tokens lapse after about 60 days, taking
 * revocation and Page re-discovery with them.
 */

/** Refresh anything expiring within this window. */
const RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;      // Meta: 7 days of headroom
const RENEW_WITHIN_MS_TIKTOK = 6 * 60 * 60 * 1000;    // TikTok: 6 hours of a 24h life
/**
 * Instagram Login tokens last 60 days and are refreshed by presenting the token
 * itself — there is no separate refresh token. A token allowed to lapse cannot
 * be recovered at all: the client has to re-authorise. Renew early.
 */
const RENEW_WITHIN_MS_INSTAGRAM = 14 * 24 * 60 * 60 * 1000;
/** LinkedIn: ten days of WARNING, not of headroom. See flagLinkedInExpiry. */
const RENEW_WITHIN_MS_LINKEDIN = 10 * 24 * 60 * 60 * 1000;
/** A lock older than this is considered abandoned by a crashed invocation. */
const LOCK_STALE_MS = 5 * 60 * 1000;

export interface Identity {
  id: string; user_id: string; provider: string; external_user_id: string;
  access_token: string; refresh_token: string | null; expires_at: string | null;
  refresh_lock_at: string | null;
}

export function needsRefresh(id: Identity, now = Date.now()): boolean {
  if (!id.expires_at) return false;                    // no stated expiry to act on
  const window = id.provider === "tiktok" ? RENEW_WITHIN_MS_TIKTOK
    : id.provider === "instagram" ? RENEW_WITHIN_MS_INSTAGRAM
    // LinkedIn cannot be refreshed from a server at all (see flagLinkedInExpiry),
    // so the "window" is how much WARNING the client gets, not how long we have
    // to act. Ten days is enough for somebody to notice an email, be away, and
    // still have time to click one button before the account goes dark.
    : id.provider === "linkedin" ? RENEW_WITHIN_MS_LINKEDIN
    : RENEW_WITHIN_MS;
  return Date.parse(id.expires_at) - now < window;
}

/**
 * Claim the right to refresh this identity. The update is conditional on the
 * lock still being free (or stale), and PostgREST returns the rows it actually
 * changed — so a second caller racing us gets nothing back and stands down.
 */
export async function acquireRefreshLock(db: Db, identityId: string, now = Date.now()): Promise<boolean> {
  const stale = new Date(now - LOCK_STALE_MS).toISOString();
  const { data } = await db
    .from("provider_identities")
    .update({ refresh_lock_at: new Date(now).toISOString() })
    .eq("id", identityId)
    .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${stale}`)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

export async function releaseRefreshLock(db: Db, identityId: string) {
  await db.from("provider_identities").update({ refresh_lock_at: null }).eq("id", identityId);
}

/** Re-exchange a Meta long-lived user token, then refresh the Page tokens. */
async function refreshMeta(db: Db, id: Identity): Promise<boolean> {
  const current = decryptToken(id.access_token);
  const res = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: current,
  }), { signal: AbortSignal.timeout(8000) });
  const body = await res.json();
  if (!body.access_token) throw new Error(body.error?.message || "meta_refresh_failed");

  const expiresAt = body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null;
  await db.from("provider_identities").update({
    access_token: encryptToken(body.access_token),
    expires_at: expiresAt,
    last_refresh_at: new Date().toISOString(),
    refresh_failures: 0,
  }).eq("id", id.id);

  // Page tokens are derived from the user token; re-read them so a rotated or
  // newly-permitted Page does not go stale.
  try {
    const pages = await graphGet("/me/accounts", { fields: "id,access_token", limit: "100" }, body.access_token);
    for (const p of pages.data ?? []) {
      const { data: accts } = await db
        .from("social_accounts").select("id").eq("identity_id", id.id).eq("external_id", p.id);
      for (const a of accts ?? []) {
        await db.from("account_secrets")
          .update({ access_token: encryptToken(p.access_token), expires_at: expiresAt })
          .eq("account_id", a.id);
      }
    }
  } catch (e) {
    log("token.page_refresh_failed", { identity: id.id, detail: e instanceof Error ? e.message : String(e) });
  }
  return true;
}

/**
 * Refresh a TikTok token. TikTok ROTATES the refresh token, so the new one must
 * be persisted — keeping the old one silently breaks the next refresh.
 */
async function refreshTiktok(db: Db, id: Identity): Promise<boolean> {
  if (!id.refresh_token) throw new Error("no_refresh_token");
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: decryptToken(id.refresh_token),
    }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(body.error_description || body.error || "tiktok_refresh_failed");

  const expiresAt = body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null;
  await db.from("provider_identities").update({
    access_token: encryptToken(body.access_token),
    // Persist the ROTATED refresh token, falling back to the existing one only
    // if the provider did not issue a new one.
    refresh_token: body.refresh_token ? encryptToken(body.refresh_token) : id.refresh_token,
    expires_at: expiresAt,
    last_refresh_at: new Date().toISOString(),
    refresh_failures: 0,
  }).eq("id", id.id);

  // The account rows carry their own copy of the access token.
  const { data: accts } = await db.from("social_accounts").select("id").eq("identity_id", id.id);
  for (const a of accts ?? []) {
    await db.from("account_secrets")
      .update({ access_token: encryptToken(body.access_token), expires_at: expiresAt })
      .eq("account_id", a.id);
  }
  return true;
}

/** Refresh an Instagram Login token by presenting the token itself. */
async function refreshInstagram(db: Db, id: Identity): Promise<boolean> {
  const { accessToken, expiresAt } = await refreshLongLivedToken(decryptToken(id.access_token));
  await db.from("provider_identities").update({
    access_token: encryptToken(accessToken),
    expires_at: expiresAt,
    last_refresh_at: new Date().toISOString(),
    refresh_failures: 0,
  }).eq("id", id.id);

  const { data: accts } = await db.from("social_accounts").select("id").eq("identity_id", id.id);
  for (const a of accts ?? []) {
    await db.from("account_secrets")
      .update({ access_token: encryptToken(accessToken), expires_at: expiresAt })
      .eq("account_id", a.id);
  }
  return true;
}

/** Refresh one identity if it needs it and we can claim the lock. */
export async function refreshIdentity(db: Db, id: Identity): Promise<"skipped" | "refreshed" | "locked" | "failed"> {
  if (!needsRefresh(id)) return "skipped";
  if (!(await acquireRefreshLock(db, id.id))) return "locked";
  try {
    if (id.provider === "meta") await refreshMeta(db, id);
    else if (id.provider === "instagram") await refreshInstagram(db, id);
    else if (id.provider === "tiktok") await refreshTiktok(db, id);
    else if (id.provider === "linkedin") return await flagLinkedInExpiry(db, id);
    else return "skipped";
    log("token.refreshed", { identity: id.id, provider: id.provider });
    return "refreshed";
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await db.from("provider_identities")
      .update({ refresh_failures: (0) + 1, last_refresh_at: new Date().toISOString() })
      .eq("id", id.id);
    log("token.refresh_failed", { identity: id.id, provider: id.provider, detail });
    return "failed";
  } finally {
    await releaseRefreshLock(db, id.id);
  }
}

/**
 * LinkedIn cannot be refreshed from a server, and pretending otherwise would be
 * worse than doing nothing.
 *
 * Every other platform here hands back a new token for an old one, which is why
 * this module is a cron job. LinkedIn does not, and says so plainly: "To refresh
 * an access token, go through the authorization process again to fetch a new
 * token", and separately, "Programmatic refresh tokens are available for a
 * limited set of partners." We are not one of those partners, so there is no
 * server-side path — the member's BROWSER has to make the round trip.
 *
 * The one mercy is that the round trip is silent while the token is still alive:
 * the consent screen is skipped "provided the member is still logged into
 * linkedin.com and the member's current access token has not expired". Miss that
 * window and the client sees the full consent screen again, which for a Company
 * Page means an admin has to be found and walked through it.
 *
 * So this function does the only honest thing a cron can do: it marks the
 * account as needing attention EARLY, while a single click still fixes it, and
 * it returns "skipped" because nothing was refreshed. Reporting a refresh that
 * did not happen would let a token lapse silently and present the client with an
 * empty dashboard and no explanation.
 *
 * Tokens last 60 days: "Currently, all access tokens are issued with a 60-day
 * lifespan."
 */
export async function flagLinkedInExpiry(
  db: Db, id: Identity,
): Promise<"skipped" | "refreshed" | "locked" | "failed"> {
  const expiresAt = id.expires_at ? Date.parse(id.expires_at) : NaN;
  const daysLeft = Number.isFinite(expiresAt)
    ? Math.floor((expiresAt - Date.now()) / 86_400_000) : null;

  // `needs_reauth` is what the Connections page reads to put a reconnect prompt
  // in front of the client. Set on the ACCOUNT rather than the identity because
  // that is the thing they recognise: a page with a name, not a token.
  await db.from("social_accounts")
    .update({ needs_reauth: true })
    .eq("identity_id", id.id);

  log("token_refresh.linkedin_needs_browser", {
    identity: id.id, provider: id.provider, days_left: daysLeft,
    detail: "LinkedIn issues no programmatic refresh to this app. The client must "
      + "reconnect from a browser while the token is still valid, which skips the "
      + "consent screen. After expiry they see full consent again.",
  });
  return "skipped";
}
