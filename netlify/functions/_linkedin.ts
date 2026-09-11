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
   * Paths that become MUTATIONS when sent with a method other than GET.
   *
   * Documentation, not a blocklist. `/posts` is on it and is also the finder the
   * sync depends on: `GET /posts?q=author` lists a page's posts, `POST /posts`
   * publishes one. A path-based refusal therefore blocks a legitimate read while
   * catching nothing, which is exactly what it did until a test caught it.
   *
   * `rw_organization_admin` makes these possible; nothing in this codebase makes
   * them happen, and that is enforced by asserting liGet issues only GETs.
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

  /**
   * The legacy base the standardized-data taxonomies live on.
   *
   * NOT `/rest`. The follower facets come back as URNs — `urn:li:industry:4` —
   * and every endpoint that turns one into a word is published under `/v2`,
   * which predates versioned APIs and takes no `LinkedIn-Version` header. Read
   * from learn.microsoft.com on 2026-09-12; sending the version header at a
   * legacy path is the kind of thing that fails with a message about something
   * else entirely, so the two bases are kept apart here rather than guessed at
   * the call site.
   */
  V2: "https://api.linkedin.com/v2",
  /** Resolves urn:li:geo — both the country facet and the market-area facet. */
  GEO: "/geo",
  /** Resolves urn:li:industry. Hierarchical, 400+ nodes, so BATCH_GET by id. */
  INDUSTRIES: "/industryTaxonomyVersions",
  /**
   * Pinned, deliberately, exactly as `VERSION` is.
   *
   * `DEFAULT` is documented as pointing at the latest taxonomy, which means the
   * NAME behind an id can move under us without a deploy. A stored snapshot
   * keyed by label would then silently disagree with an older one, and nothing
   * would report it. Supported: V1_0, V2_5, V2_6, V2_7, DEFAULT.
   */
  INDUSTRY_TAXONOMY: process.env.LINKEDIN_INDUSTRY_TAXONOMY ?? "V2_7",
  /** Small, enumerable taxonomies — one GET_ALL each rather than a call per id. */
  SENIORITIES: "/seniorities",
  FUNCTIONS: "/functions",
  /** GET_ALL defaults to ten rows; both taxonomies fit comfortably under this. */
  TAXONOMY_PAGE: 100,

  /**
   * Each facet is capped at its top 100 values.
   *
   * "The results for any individual facet are limited to the top 100 results."
   * A distribution built from the response is therefore a share OF WHAT CAME
   * BACK, not of the page's followers, and this endpoint no longer returns
   * `totalFollowerCounts` to check it against. Recorded here because the
   * difference is invisible in the data and only shows up as a client asking
   * why the percentages do not match their own page.
   */
  FACET_LIMIT: 100,
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
  /**
   * Which API to talk to. Defaults to the versioned `/rest`; the standardized
   * data taxonomies that turn a URN into a word live on `LI.V2`, which takes no
   * version header. Carried through the throttle retry below.
   */
  base?: string;
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
  /*
   * There is deliberately NO path check here any more.
   *
   * There was one, refusing anything in WRITE_ENDPOINTS, and it was wrong: it is
   * the METHOD that makes a request a mutation, not the path. `/posts` is both
   * the endpoint that creates a post AND the finder that lists them, and this
   * helper only ever issues GET — so the guard blocked the one call the sync
   * most needs and could never have blocked an actual write, because a write
   * would not come through here.
   *
   * The mock-based sync test found it on its first run, storing zero posts. The
   * list stays as documentation of what a mutation would look like, and the real
   * guarantee is the test asserting this function issues nothing but GETs.
   */
  const base = opts.base ?? LI.REST;
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${opts.token}`,
      /*
       * The version header belongs to /rest only. /v2 predates versioning, and
       * sending it there is at best ignored and at worst answered with an error
       * about the version rather than about the request.
       */
      ...(base === LI.REST ? { "LinkedIn-Version": LI.VERSION } : {}),
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

/* ===========================================================================
 * Follower demographics — the professional facets.
 *
 * Read from learn.microsoft.com on 2026-09-12, directly rather than through a
 * summary, and the reading corrected the plan in four places. They are recorded
 * as comments here because each one is a way to produce a confidently wrong
 * number, which is the failure mode this project fears most.
 * ======================================================================== */

/** One facet bucket's counts. Both fields are present; only one may be used. */
export interface LiFollowerCounts {
  organicFollowerCount?: number;
  paidFollowerCount?: number;
}

/**
 * The seven facets, and which field of each row carries its value.
 *
 * The plan this was built from named five. There are seven: it omitted
 * `followerCountsByAssociationType` and, more importantly, treated geography as
 * one facet when LinkedIn returns TWO at different granularities —
 * `followerCountsByGeoCountry` (countries) and `followerCountsByGeo` (market
 * areas, e.g. "San Francisco Bay Area"). Merging them would double-count every
 * follower, since a follower appears in both.
 *
 * The value field is NOT uniformly named. It is `industry`, `seniority`,
 * `function`, `staffCountRange`, `associationType` or `geo` depending on the
 * facet, which is exactly the sort of detail that is wrong when written from
 * memory — so it lives in one table beside the field it belongs to.
 */
export const LI_FACETS = [
  { field: "followerCountsByIndustry", value: "industry", kind: "industry", into: "industry" },
  { field: "followerCountsBySeniority", value: "seniority", kind: "seniority", into: "seniority" },
  { field: "followerCountsByFunction", value: "function", kind: "function", into: "function" },
  { field: "followerCountsByStaffCountRange", value: "staffCountRange", kind: "enum", into: "company_size" },
  { field: "followerCountsByAssociationType", value: "associationType", kind: "enum", into: "association" },
  { field: "followerCountsByGeoCountry", value: "geo", kind: "geo", into: "countries" },
  { field: "followerCountsByGeo", value: "geo", kind: "geo", into: "regions" },
] as const;

export type LiFacetKind = (typeof LI_FACETS)[number]["kind"];

/**
 * How many followers a facet bucket holds.
 *
 * **`organicFollowerCount` alone, and this is not an oversight.** LinkedIn:
 * "Professional Demographic results are rolled up as a total of both organic and
 * paid followers in the `organicFollowerCount` field. Do not refer to the
 * `paidFollowerCount` field for professional demographic statistics."
 *
 * The field is named for one thing and holds another. Adding the two — which is
 * what the names invite, and what any reviewer would assume is a fix — counts
 * every paid follower twice. There is a mutation for this.
 */
export const liDemographicCount = (fc: LiFollowerCounts | undefined): number | null =>
  liNum(fc?.organicFollowerCount);

/** The numeric tail of a URN: `urn:li:industry:4` -> `"4"`. */
export const urnTail = (urn: string): string | null => {
  const tail = String(urn).split(":").pop();
  return tail && /^\d+$/.test(tail) ? tail : null;
};

/**
 * A LinkedIn SCREAMING_SNAKE enum as something a client can read.
 *
 * Presentation only — it renames what LinkedIn sent, it never invents a value
 * it did not send. `SIZE_2_TO_10` is documented; the `_OR_MORE` form is the
 * obvious counterpart and falls through harmlessly to the raw token if LinkedIn
 * spells it differently, which is the point of the final return.
 */
export function liEnumLabel(raw: string): string {
  const m = /^SIZE_(\d+)(?:_TO_(\d+)|_OR_MORE)?$/.exec(raw);
  if (m) {
    if (m[2]) return `${m[1]}–${m[2]} employees`;
    if (raw.endsWith("_OR_MORE")) return `${m[1]}+ employees`;
    return m[1] === "1" ? "1 employee" : `${m[1]} employees`;
  }
  // EMPLOYEE -> Employee. Title case, nothing more.
  return raw.charAt(0) + raw.slice(1).toLowerCase().replace(/_/g, " ");
}

/** `{ localized: { en_US: "Finance" } }`, the MultiLocaleString shape. */
const localized = (name: unknown): string | null => {
  const loc = (name as { localized?: Record<string, string> } | undefined)?.localized;
  if (!loc) return null;
  return loc.en_US ?? Object.values(loc)[0] ?? null;
};

/**
 * Resolve `urn:li:geo:*`, in one BATCH_GET.
 *
 * `GET /v2/geo?ids=List(1,2)` -> `results: { "1": { defaultLocalizedName: { value } } }`.
 * Note this is Bing Maps data under Microsoft's terms, which is a licensing fact
 * to carry rather than a technical one.
 */
export async function liResolveGeo(
  ids: string[], token: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const data = await liGet<{ results?: Record<string, { defaultLocalizedName?: { value?: string } }> }>(
    LI.GEO, { ids: `List(${ids.join(",")})` }, { token, base: LI.V2 },
  );
  for (const [id, row] of Object.entries(data.results ?? {})) {
    const v = row?.defaultLocalizedName?.value;
    if (typeof v === "string" && v) out.set(id, v);
  }
  return out;
}

/** Resolve `urn:li:industry:*` against the PINNED taxonomy version. */
export async function liResolveIndustries(
  ids: string[], token: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  /*
   * BATCH_GET takes repeated `ids` parameters rather than List(...) — a
   * different convention from /v2/geo on the same API, which is why both are
   * written out here instead of sharing one helper that would have to be right
   * about which is which.
   */
  const url = `${LI.INDUSTRIES}/${LI.INDUSTRY_TAXONOMY}/industries?${ids.map((i) => `ids=${i}`).join("&")}`;
  const data = await liGet<{ results?: Record<string, { name?: unknown }> }>(
    url, { "locale.language": "en", "locale.country": "US" }, { token, base: LI.V2 },
  );
  for (const [id, row] of Object.entries(data.results ?? {})) {
    const v = localized(row?.name);
    if (v) out.set(id, v);
  }
  return out;
}

/**
 * Resolve a small enumerable taxonomy — seniorities or functions — in one call.
 *
 * GET_ALL pages at ten by default, which would quietly truncate `functions` and
 * leave two thirds of a client's chart labelled Unknown. `count` is asked for
 * explicitly; anything still missing stays unresolved rather than guessed.
 */
export async function liResolveTaxonomy(
  path: string, token: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const data = await liGet<{ elements?: { id?: number; name?: unknown }[] }>(
    path, { count: String(LI.TAXONOMY_PAGE), "locale.language": "en", "locale.country": "US" },
    { token, base: LI.V2 },
  );
  for (const el of data.elements ?? []) {
    const v = localized(el?.name);
    if (v && el?.id !== undefined) out.set(String(el.id), v);
  }
  return out;
}
