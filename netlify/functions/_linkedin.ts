import { GraphError, isThrottleError, log } from "./_lib";

/* ===========================================================================
 * LinkedIn — Community Management API, organization (Company Page) path.
 *
 * >>> EVERY ENDPOINT, SCOPE AND FIELD BELOW IS IN THIS ONE BLOCK ON PURPOSE. <<<
 * Same rule as the IG block: if a name is wrong, it is wrong only here.
 *
 * Checked against learn.microsoft.com/en-us/linkedin on 2026-09-10. Citations
 * and the reasoning are in docs/LINKEDIN.md. **NOT verified against a live
 * response.** The Instagram pass found three of four daily metrics wrong after
 * the documentation agreed, so nothing below should be described as working
 * until a real call has returned.
 *
 * WHY THE ORGANIZATION PATH AND NOT THE MEMBER PATH
 *
 * LinkedIn has two entirely separate analytics surfaces and a client is on one
 * or the other:
 *
 *   - MEMBER (a personal profile). `r_member_postAnalytics` reads a member's own
 *     post analytics, but ENUMERATING their posts needs `r_member_social`, which
 *     LinkedIn states is "closed" and "not accepting access requests at this
 *     time". Without a post list there is no Content table and no per-post page.
 *   - ORGANIZATION (a Company Page). Everything works: posts can be listed,
 *     daily statistics exist, per-post statistics exist.
 *
 * A brand is a Company Page, so the organization path is the one that serves the
 * client this is being built for. The member path is deliberately not
 * implemented rather than half-implemented.
 * ======================================================================== */

export const LI = {
  /** Where the client is sent to authorise. */
  AUTHORIZE: "https://www.linkedin.com/oauth/v2/authorization",
  /** Token exchange and refresh (form POST, uses the client secret). */
  TOKEN: "https://www.linkedin.com/oauth/v2/accessToken",
  /** API host. Note /rest, not the legacy /v2. */
  REST: "https://api.linkedin.com/rest",

  /**
   * The version header, required on every request.
   *
   * LinkedIn versions its API by calendar month and SUNSETS each version on
   * roughly an annual cycle — the notice on the current docs says 202508 dies on
   * 17 August 2026. Meta expires a version about every two years, so this is
   * twice the maintenance tax, and it is pinned here so the whole integration
   * moves in one edit rather than drifting endpoint by endpoint.
   */
  VERSION: process.env.LINKEDIN_API_VERSION ?? "202608",
  /** Every /rest call needs this too, or field names come back in v1 shapes. */
  PROTOCOL: "2.0.0",

  /**
   * Scopes.
   *
   * `r_organization_social` is read-only: "Retrieve organizations' posts,
   * comments, and likes."
   *
   * `rw_organization_admin` is NOT. It reads "Manage organization pages and
   * retrieve reporting data", and it is the ONLY route to page statistics —
   * LinkedIn publishes no read-only equivalent for organization reporting.
   *
   * That is a real departure from the rule that got `business_management`
   * dropped from the Meta app, and it is not something to slip in quietly. It
   * means a connected Company Page token could, in principle, post as that page.
   * Mitigations: this codebase never calls a write endpoint, `WRITE_ENDPOINTS`
   * below documents exactly which ones exist so an audit can grep for them, and
   * the consent screen has to say plainly what the client is granting.
   *
   * If LinkedIn ever ships a read-only reporting scope, this drops to it.
   */
  SCOPES: ["r_organization_social", "rw_organization_admin"],

  /**
   * Endpoints this integration must NEVER call, listed so their absence is
   * checkable rather than assumed. `rw_organization_admin` makes them possible;
   * nothing here makes them happen. Guarded by a test.
   */
  WRITE_ENDPOINTS: ["/posts", "/comments", "/reactions"] as string[],

  /** Which organizations this member administers, and in what role. */
  ORG_ACLS: "/organizationAcls",
  /** Only an ADMINISTRATOR can read reporting; anything less returns 403. */
  ADMIN_ROLE: "ADMINISTRATOR",
  /** Page name, logo, vanity name. */
  ORGANIZATION: "/organizations",
  /** Follower total. edgeType spelling changed at v202305; this is the current one. */
  NETWORK_SIZE: "/networkSizes",
  FOLLOWER_EDGE: "COMPANY_FOLLOWED_BY_MEMBER",
  /** Daily and lifetime page statistics. */
  SHARE_STATS: "/organizationalEntityShareStatistics",
  FOLLOWER_STATS: "/organizationalEntityFollowerStatistics",
  /** Listing the page's posts. */
  POSTS: "/posts",
  /** Max the finder accepts per page. */
  POSTS_PAGE: 100,

  /**
   * Statistics only reach back twelve months.
   *
   * "The organizationalEntityShareStatistics endpoint returns share data only
   * within the past 12 months, using a rolling 12-month window." Asking for more
   * is not an error, it simply returns nothing, so the sync must not treat an
   * empty older window as a failure — or as zeros.
   */
  MAX_HISTORY_DAYS: 365,
} as const;

/**
 * What a day of page statistics contains.
 *
 * `uniqueImpressionsCount` is the closest thing LinkedIn has to reach, and it is
 * present on the DAILY and lifetime aggregates. It is absent from the per-share
 * response, which is why a LinkedIn post stores null reach — see below.
 */
export interface LiShareStats {
  impressionCount?: number;
  uniqueImpressionsCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  clickCount?: number;
  engagement?: number;
}

/** Milliseconds since epoch, which is how LinkedIn takes every time range. */
export const liTime = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/**
 * LinkedIn's time ranges end EXCLUSIVE, and Meta's `end_time` is the start of
 * the following day. Two different conventions for the same idea, and mixing
 * them files every figure one day out — the defect `dayKeyFromEndTime` exists to
 * prevent. This converts a LinkedIn `timeRange.start` back to a calendar day.
 */
export function liDayKey(startMs: number): string | null {
  if (!Number.isFinite(startMs)) return null;
  return new Date(startMs).toISOString().slice(0, 10);
}

/**
 * A number, or null when LinkedIn did not report it.
 *
 * The same rule as everywhere else, with one LinkedIn-specific wrinkle that must
 * NOT be generalised: for PER-SHARE queries the docs say "Shares that are not
 * returned in the list of elements can be assumed to have counts of 0". That is
 * an explicit statement that absence means zero, and it is the opposite of
 * Instagram. It applies only to a share missing from a per-share response, and
 * the caller handles that case deliberately. A field missing from a row that WAS
 * returned is still unknown.
 */
export const liNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * `likeCount` can be NEGATIVE, and LinkedIn documents why: "This field can
 * become negative when members who liked a sponsored share later unlike it. The
 * like is not counted since it's not organic, but the unlike is counted as
 * organic."
 *
 * It is stored exactly as reported rather than clamped, for the same reason the
 * engagement funnel prints Meta's negative total_interactions: the figure is the
 * platform's, and quietly flooring it at zero would be inventing one. Charts
 * clamp their GEOMETRY instead.
 */
export const liLikes = liNum;

interface LiGetOptions {
  token: string;
  /** Retries once on a throttle, as igGet does. */
  retry?: boolean;
}

/**
 * One GET against the versioned REST API.
 *
 * Kept parallel to `igGet`: same throttle handling, same rule that an auth error
 * and a throttle are told apart by the platform's own signal rather than by
 * words in a message. LinkedIn signals both by HTTP status, which is cleaner
 * than Meta's subcodes.
 */
export async function liGet<T = any>(
  path: string, params: Record<string, string>, opts: LiGetOptions,
): Promise<T> {
  if (LI.WRITE_ENDPOINTS.includes(path)) {
    // A programming error, caught loudly rather than sent. Reading the posts
    // FINDER uses /posts with q=author, which is a GET; this only guards against
    // a future caller reaching for a mutation through this helper.
    throw new Error(`liGet refuses ${path}: this integration is read-only.`);
  }

  const url = new URL(LI.REST + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "LinkedIn-Version": LI.VERSION,
      "X-Restli-Protocol-Version": LI.PROTOCOL,
      "Content-Type": "application/json",
    },
  });

  if (res.ok) return (await res.json()) as T;

  const body = await res.text().catch(() => "");
  /*
   * 429 is the documented throttle. Development Tier allows only 500 requests
   * per app per day and 100 per member, which is two orders of magnitude tighter
   * than Meta, so this is an expected condition rather than an exceptional one
   * and it must never be swallowed — degrading silently is what turned platform
   * rate limiting into data loss on the Instagram path.
   */
  /*
   * Classified by HTTP STATUS, which LinkedIn uses cleanly, then mapped onto the
   * codes _lib already knows so isAuthError and isThrottleError work unchanged
   * across all four platforms. `status` is carried too, since isThrottleError
   * already treats 429 as a throttle on its own.
   */
  const err = new GraphError(
    `LinkedIn ${res.status}: ${body.slice(0, 300)}`,
    {
      status: res.status,
      code: res.status === 429 ? 4 : (res.status === 401 || res.status === 403) ? 190 : undefined,
      retryable: res.status === 429 || res.status >= 500,
    },
  );

  if (res.status === 429 && opts.retry !== false) {
    log("linkedin.throttled", { path });
    await new Promise((r) => setTimeout(r, 1500));
    return liGet<T>(path, params, { ...opts, retry: false });
  }
  if (isThrottleError(err)) log("linkedin.throttled_final", { path });
  throw err;
}

/**
 * The Company Pages this member can actually report on.
 *
 * Reporting requires the ADMINISTRATOR role specifically — CONTENT_ADMIN and
 * DIRECT_SPONSORED_CONTENT_POSTER can read posts but get 403 from the statistics
 * endpoints. Filtering here means the connect flow can tell a client which of
 * their pages will work BEFORE they pick one, rather than after the first sync
 * returns nothing.
 */
export async function administeredOrganizations(
  token: string,
): Promise<{ urn: string; role: string }[]> {
  const data = await liGet<{ elements?: { organizationalTarget?: string; role?: string; state?: string }[] }>(
    LI.ORG_ACLS, { q: "roleAssignee", role: LI.ADMIN_ROLE, state: "APPROVED" }, { token },
  );
  return (data.elements ?? [])
    .filter((e) => e.organizationalTarget && e.role === LI.ADMIN_ROLE)
    .map((e) => ({ urn: e.organizationalTarget as string, role: e.role as string }));
}
