import { type Db, env, encryptToken, decryptToken, graphGet, log, GRAPH } from "./_lib";

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
/** A lock older than this is considered abandoned by a crashed invocation. */
const LOCK_STALE_MS = 5 * 60 * 1000;

export interface Identity {
  id: string; user_id: string; provider: string; external_user_id: string;
  access_token: string; refresh_token: string | null; expires_at: string | null;
  refresh_lock_at: string | null;
}

export function needsRefresh(id: Identity, now = Date.now()): boolean {
  if (!id.expires_at) return false;                    // no stated expiry to act on
  const window = id.provider === "tiktok" ? RENEW_WITHIN_MS_TIKTOK : RENEW_WITHIN_MS;
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

/** Refresh one identity if it needs it and we can claim the lock. */
export async function refreshIdentity(db: Db, id: Identity): Promise<"skipped" | "refreshed" | "locked" | "failed"> {
  if (!needsRefresh(id)) return "skipped";
  if (!(await acquireRefreshLock(db, id.id))) return "locked";
  try {
    if (id.provider === "meta") await refreshMeta(db, id);
    else if (id.provider === "tiktok") await refreshTiktok(db, id);
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
