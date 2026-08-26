import { GraphError, isThrottleError, log } from "./_lib";

/* ===========================================================================
 * Instagram API with Instagram Login.
 *
 * Chosen over Instagram API with Facebook Login because it does NOT require the
 * professional account to be linked to a Facebook Page. On the Facebook path a
 * creator without a linked Page cannot connect at all, and it needs `pages_*`
 * scopes this product never uses.
 *
 * >>> EVERY ENDPOINT, SCOPE AND FIELD BELOW IS IN THIS ONE BLOCK ON PURPOSE. <<<
 * They were assembled from secondary sources because Meta's developer site was
 * unreachable when this was written. VERIFY EACH AGAINST THE OFFICIAL DOCS AND
 * ONE LIVE RESPONSE BEFORE CONNECTING A CLIENT ACCOUNT. If a name is wrong, it
 * is wrong only here.
 * ======================================================================== */
export const IG = {
  /** Where the user is sent to authorise. */
  AUTHORIZE: "https://www.instagram.com/oauth/authorize",
  /** Short-lived token exchange (form POST, uses the app secret). */
  TOKEN: "https://api.instagram.com/oauth/access_token",
  /** API host for everything else. */
  GRAPH: "https://graph.instagram.com",
  /** Short-lived -> long-lived (60 days). */
  EXCHANGE_GRANT: "ig_exchange_token",
  /** Long-lived -> refreshed long-lived. */
  REFRESH_GRANT: "ig_refresh_token",
  /** Read-only. No pages_*, no business_management, no publishing. */
  SCOPES: ["instagram_business_basic", "instagram_business_manage_insights"],
  /** Profile fields. */
  ME_FIELDS: "user_id,username,name,profile_picture_url,followers_count,media_count",
  /** Daily account metrics. Requested separately so one bad name cannot kill the rest. */
  DAILY_METRICS: ["reach", "views", "follower_count", "total_interactions"],
  /** Demographic breakdowns (needs ~100 followers; capped at top 45 segments). */
  DEMOGRAPHIC_BREAKDOWNS: ["age", "gender", "country"],
  MEDIA_FIELDS: "id,caption,media_type,permalink,timestamp,like_count,comments_count",
  MEDIA_INSIGHT_METRICS: "reach,saved,shares,views",
} as const;

export const IG_VERSION = process.env.IG_API_VERSION ?? "v23.0";

function base(): string { return `${IG.GRAPH}/${IG_VERSION}`; }

/** The URL the client is sent to. No Facebook in the loop. */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL(IG.AUTHORIZE);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG.SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

export interface IgTokens { accessToken: string; userId: string; expiresAt: string | null; }

/** Authorization code -> short-lived token -> long-lived (60 day) token. */
export async function exchangeCode(
  clientId: string, clientSecret: string, redirectUri: string, code: string
): Promise<IgTokens> {
  const shortRes = await fetch(IG.TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      grant_type: "authorization_code", redirect_uri: redirectUri, code,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const short = await shortRes.json();
  if (!short.access_token) {
    throw new GraphError(short.error_message || short.error?.message || "ig_token_exchange_failed");
  }

  const longRes = await fetch(`${IG.GRAPH}/access_token?` + new URLSearchParams({
    grant_type: IG.EXCHANGE_GRANT,
    client_secret: clientSecret,
    access_token: short.access_token,
  }), { signal: AbortSignal.timeout(8000) });
  const long = await longRes.json();

  const accessToken: string = long.access_token || short.access_token;
  const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null;
  return { accessToken, userId: String(short.user_id ?? long.user_id ?? ""), expiresAt };
}

/**
 * Refresh a long-lived token. Instagram Login tokens last 60 days and are
 * refreshed by presenting the token itself — there is no separate refresh token,
 * so a token allowed to lapse cannot be recovered without the user re-authorising.
 */
export async function refreshLongLivedToken(token: string): Promise<{ accessToken: string; expiresAt: string | null }> {
  const res = await fetch(`${IG.GRAPH}/refresh_access_token?` + new URLSearchParams({
    grant_type: IG.REFRESH_GRANT, access_token: token,
  }), { signal: AbortSignal.timeout(8000) });
  const body = await res.json();
  if (!body.access_token) throw new GraphError(body.error?.message || "ig_refresh_failed");
  return {
    accessToken: body.access_token,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
  };
}

/**
 * One Instagram Login API GET. Same failure discipline as the Graph helper:
 * typed errors, retries on throttling, and never a silent empty result that a
 * caller could persist as zero.
 */
export async function igGet(
  path: string, params: Record<string, string>, token: string,
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<any> {
  const { timeoutMs = 8000, retries = 2 } = opts;
  const backoff = Number(process.env.GRAPH_BACKOFF_BASE_MS ?? 2000);
  const url = `${base()}${path}?${new URLSearchParams(params)}`;

  let lastErr: GraphError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(backoff * 2 ** (attempt - 1), backoff * 4)));
    let res: Response;
    try {
      // Instagram Login tokens are presented as a bearer token; appsecret_proof
      // is a Facebook Login concept and does not apply here.
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      lastErr = new GraphError(e instanceof Error ? e.message : "network error", { retryable: true });
      continue;
    }

    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }

    if (body?.error) {
      const err = new GraphError(body.error.message || "ig error", {
        code: Number(body.error.code), subcode: Number(body.error.error_subcode), status: res.status,
      });
      err.retryable = isThrottleError(err);
      if (!err.retryable) throw err;
      lastErr = err;
      continue;
    }
    if (!res.ok) {
      const err = new GraphError(`HTTP ${res.status}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
      if (!err.retryable) throw err;
      lastErr = err;
      continue;
    }
    return body;
  }
  throw lastErr ?? new GraphError("ig request failed");
}

export function logIgConfig() {
  log("ig.config", { version: IG_VERSION, scopes: IG.SCOPES.join(",") });
}
