/**
 * A LinkedIn that knows the truth.
 *
 * The same idea as `mock-graph.mjs`, and for the same reason: a test that only
 * checks the sync did not crash will pass while it writes wrong numbers. This
 * mock computes each day's TRUE value from a formula the test can evaluate
 * independently, so an assertion compares the stored figure against an oracle
 * rather than against whatever the code happened to produce.
 *
 * It also reproduces the parts of LinkedIn's shape most likely to be got wrong,
 * because those are the only parts worth mocking:
 *
 *   - `timeRange.start` in milliseconds, with an EXCLUSIVE end. Meta's end_time
 *     is the opposite convention and mixing them files every figure a day out.
 *   - `uniqueImpressionsCount` present on the daily rows and ABSENT from the
 *     per-share rows, which is why a LinkedIn post must store null reach.
 *   - A share with no activity OMITTED from the per-share response, which
 *     LinkedIn documents as meaning zero — the one place in this codebase where
 *     absence legitimately becomes a number.
 *   - A negative likeCount, which LinkedIn documents and which must survive.
 */

const DAY = 86_400_000;

export const addDays = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * The true value of a metric on a day. Deterministic and cheap to recompute, so
 * a test can assert against it without duplicating the sync's logic.
 */
export const trueValue = (metric, iso) => {
  const d = Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
  const base = {
    impressionCount: 400,
    uniqueImpressionsCount: 300,
    likeCount: 20,
    commentCount: 5,
    shareCount: 2,
    clickCount: 11,
  }[metric] ?? 0;
  // A per-day wobble, so a bug that pins every day to the same figure is caught.
  return base + (d % 7) * (metric === "impressionCount" ? 13 : 1);
};

/** Engagements as the sync should compute them: likes + comments + shares. */
export const trueEngagements = (iso) =>
  trueValue("likeCount", iso) + trueValue("commentCount", iso) + trueValue("shareCount", iso);

/**
 * Follower demographics, and the trap they carry.
 *
 * `organicFollowerCount` holds organic AND paid rolled together — LinkedIn says
 * so in terms, and says not to read `paidFollowerCount` for these facets. Every
 * bucket below therefore carries a NON-ZERO paid figure that must not appear in
 * any stored share: if the sync adds the two, every percentage moves, and this
 * data is chosen so that it moves detectably rather than by a rounding error.
 *
 * `urn:li:industry:777` is deliberately missing from the taxonomy the mock
 * serves, so the "unresolved" path is exercised on every run rather than only
 * when LinkedIn happens to add an industry.
 */
export const DEMOGRAPHICS = {
  followerCountsByIndustry: { key: "industry", rows: [
    { value: "urn:li:industry:4", organic: 120, paid: 30 },
    { value: "urn:li:industry:96", organic: 60, paid: 9 },
    { value: "urn:li:industry:777", organic: 20, paid: 4 },
  ] },
  followerCountsBySeniority: { key: "seniority", rows: [
    { value: "urn:li:seniority:2", organic: 40, paid: 7 },
    { value: "urn:li:seniority:9", organic: 60, paid: 3 },
  ] },
  followerCountsByFunction: { key: "function", rows: [
    { value: "urn:li:function:22", organic: 30, paid: 5 },
    { value: "urn:li:function:21", organic: 70, paid: 11 },
  ] },
  followerCountsByStaffCountRange: { key: "staffCountRange", rows: [
    { value: "SIZE_1", organic: 25, paid: 2 },
    { value: "SIZE_2_TO_10", organic: 75, paid: 8 },
  ] },
  followerCountsByAssociationType: { key: "associationType", rows: [
    { value: "EMPLOYEE", organic: 100, paid: 6 },
  ] },
  followerCountsByGeoCountry: { key: "geo", rows: [
    { value: "urn:li:geo:102713980", organic: 66, paid: 12 },
    { value: "urn:li:geo:103644278", organic: 34, paid: 4 },
  ] },
  followerCountsByGeo: { key: "geo", rows: [
    { value: "urn:li:geo:90009626", organic: 84, paid: 9 },
    { value: "urn:li:geo:90009633", organic: 16, paid: 1 },
  ] },
};

/** What each URN resolves to. The taxonomy endpoints serve exactly this. */
export const URN_NAMES = {
  geo: { "102713980": "Jordan", "103644278": "United States",
         "90009626": "Amman Governorate, Jordan", "90009633": "Greater London" },
  industry: { "4": "Software Development", "96": "Retail Groceries" },  // 777 absent, on purpose
  seniority: { "2": "Training", "9": "Partner" },
  function: { "22": "Quality Assurance", "21": "Purchasing" },
};

/** The share a facet value should end up with, computed from ORGANIC ONLY. */
export const trueShare = (facet, value) => {
  const rows = DEMOGRAPHICS[facet].rows;
  const total = rows.reduce((s, r) => s + r.organic, 0);
  return rows.find((r) => r.value === value).organic / total;
};

export const ORG_ID = "5515715";
export const MEMBER_ID = "yrZCpj2Z12";
/** Base daily counts per member metric; the day of the month is added to each. */
export const MEMBER_METRIC = { IMPRESSION: 300, REACTION: 20, COMMENT: 4, RESHARE: 2 };
export const ORG_URN = `urn:li:organization:${ORG_ID}`;
export const FOLLOWERS = 8421;

/**
 * Install a fetch that answers like LinkedIn.
 *
 * `opts.days` is [from, to] inclusive. `opts.posts` is how many posts the page
 * has. `opts.silentPosts` is how many of those are omitted from the per-share
 * response, i.e. how many genuinely have zero activity.
 */
export function installLinkedInMock(opts = {}) {
  const [from, to] = opts.days ?? ["2026-08-01", "2026-08-07"];
  const postCount = opts.posts ?? 3;
  const silent = opts.silentPosts ?? 0;
  // { geo: 403 } answers that taxonomy with an error, as development tier does to a BATCH_GET.
  const refuse = opts.refuse ?? {};
  // How many of the posts are ugcPosts rather than shares; LinkedIn lists both.
  const ugcCount = opts.ugcPosts ?? 0;
  // Answer the per-post statistics call with this HTTP status instead of data.
  const failPostStats = opts.failPostStats ?? 0;
  // How many of the FIRST posts were published more than six months ago.
  const oldPosts = opts.oldPosts ?? 0;
  // Index -> what else the finder returns for that post, as LinkedIn does.
  const sponsored = new Set(opts.sponsoredPosts ?? []);   // adContext.isDsc
  const dark = new Set(opts.darkPosts ?? []);             // distribution.feedDistribution NONE
  const drafts = new Set(opts.draftPosts ?? []);          // lifecycleState DRAFT
  // Serve posts this many per page, with a `next` link while more remain.
  const pageSize = opts.postsPageSize ?? Infinity;
  // A personal profile: follower total, and whether the member has any posts.
  const memberFollowers = opts.memberFollowers ?? 512;
  const memberHasPosts = opts.memberHasPosts ?? false;
  // The page lookup: false answers "administers nothing".
  const adminsPage = opts.adminsPage ?? true;
  const calls = [];
  const real = globalThis.fetch;

  // The LAST `ugcCount` posts are ugcPosts; the rest are shares.
  const postUrn = (i) => i >= postCount - ugcCount
    ? `urn:li:ugcPost:70000000000000000${i}`
    : `urn:li:share:70000000000000000${i}`;

  globalThis.fetch = async (url) => {
    const rawUrl = String(url);
    /*
     * Reject what LinkedIn's Rest.li 2.0 parser cannot read: an unencoded URN,
     * the List(...) / (key:value) parentheses percent-encoded, or anything
     * encoded twice. Every sample on LinkedIn's pages keeps the parentheses raw;
     * some encode the `:` and `,` inside and some do not, so those are allowed.
     * This mock used to decode whatever arrived, so a client that encoded
     * everything passed every test while every real call would have failed.
     */
    const rawQuery = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1) : "";
    if (rawUrl.includes("urn:li:") || /%28|%29/i.test(rawQuery) || /%25/.test(rawUrl)) {
      calls.push(rawUrl);
      return new Response(JSON.stringify({ message: `malformed Rest.li request: ${rawUrl}`, status: 400 }), { status: 400 });
    }
    const u = new URL(rawUrl);
    calls.push(u.toString());
    const path = u.pathname.replace("/rest", "");
    const json = (body) => new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    });

    /* ---- a personal profile ---------------------------------------------- */
    if (path === "/v2/me") {
      return json({ id: MEMBER_ID, localizedFirstName: "Bader", localizedLastName: "Hamad", vanityName: "bader-hamad" });
    }
    if (path === "/memberFollowersCount") {
      if (u.searchParams.get("q") !== "me") return json({ elements: [] });
      return json({ elements: [{ memberFollowersCount: memberFollowers }], paging: { count: 10, start: 0, total: 1, links: [] } });
    }
    if (path === "/memberCreatorPostAnalytics") {
      // A member with no posts: LinkedIn's answer is modelled as no elements,
      // which the sync must store as unknown, not as zero.
      if (!memberHasPosts) return json({ elements: [], paging: { count: 10, start: 0, links: [] } });
      const metric = u.searchParams.get("queryType");
      const dr = u.searchParams.get("dateRange") ?? "";
      const s = /start:\(year:(\d+),month:(\d+),day:(\d+)\)/.exec(dr);
      const e = /end:\(year:(\d+),month:(\d+),day:(\d+)\)/.exec(dr);
      const iso = (m) => `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      const elements = [];
      for (let d = iso(s); d < iso(e); d = addDays(d, 1)) {
        const [y, mo, da] = d.split("-").map(Number);
        const [y2, mo2, da2] = addDays(d, 1).split("-").map(Number);
        elements.push({
          count: MEMBER_METRIC[metric] + da,
          metricType: metric,
          dateRange: { start: { year: y, month: mo, day: da }, end: { year: y2, month: mo2, day: da2 } },
        });
      }
      return json({ elements, paging: { count: 10, start: 0, links: [] } });
    }

    if (path === "/organizationAcls") {
      if (!adminsPage) return json({ elements: [] });
      return json({ elements: [
        // The documentation's two samples name this field differently; the mock
        // uses one of each so the reader is tested against both.
        { organization: ORG_URN, role: "ADMINISTRATOR", state: "APPROVED" },
        // A page the member can post to but NOT report on. The sync must ignore
        // it, because the statistics endpoints answer 403 for this role.
        { organizationTarget: "urn:li:organization:999", role: "CONTENT_ADMIN", state: "APPROVED" },
      ] });
    }

    if (path.startsWith("/organizations/")) {
      return json({ id: Number(ORG_ID), localizedName: "Drinkat", vanityName: "drinkat" });
    }

    if (path.startsWith("/networkSizes/")) {
      return json({ firstDegreeSize: FOLLOWERS });
    }

    if (path === "/posts") {
      const all = Array.from({ length: postCount }, (_, i) => ({
        ...(sponsored.has(i) ? { adContext: { isDsc: true, dscStatus: "ACTIVE" } } : {}),
        distribution: { feedDistribution: dark.has(i) ? "NONE" : "MAIN_FEED" },
        lifecycleState: drafts.has(i) ? "DRAFT" : "PUBLISHED",
        id: postUrn(i),
        commentary: `Post ${i}\n  with a newline and   spaces`,
        publishedAt: Date.parse(`${addDays(from, i < oldPosts ? -300 : i)}T09:00:00Z`),
        createdAt: Date.parse(`${addDays(from, i < oldPosts ? -300 : i)}T09:00:00Z`),
        content: i === 1 ? { media: { id: "urn:li:video:abc" } } : {},
      }));
      // Newest first, as sortBy=CREATED returns them.
      all.sort((a, b) => b.createdAt - a.createdAt);
      const start = Number(u.searchParams.get("start") ?? 0);
      const elements = all.slice(start, start + pageSize);
      const more = start + elements.length < all.length;
      return json({ elements, paging: { start, count: elements.length, links: more ? [{ rel: "next", href: "/rest/posts?start=" + (start + elements.length) }] : [] } });
    }

    /*
     * Follower statistics. The endpoint answers TWO different questions and the
     * mock refuses to blur them, because the blur is the defect:
     *
     *   - no `timeIntervals`  -> lifetime, segmented by facet
     *   - with `timeIntervals` -> aggregate gains, NO facets at all
     *
     * LinkedIn: "Time-bound follower counts are aggregated and not segmented by
     * facet." A sync that asks for a range and expects demographics gets a 200
     * and an empty page, which is indistinguishable from a page whose followers
     * have no recorded industry — so the mock reproduces exactly that.
     */
    if (path === "/organizationalEntityFollowerStatistics") {
      if (u.searchParams.has("timeIntervals")) {
        return json({ elements: [{
          organizationalEntity: ORG_URN,
          timeRange: { start: Date.parse(`${from}T00:00:00Z`), end: Date.parse(`${addDays(from, 1)}T00:00:00Z`) },
          followerGains: { organicFollowerGain: 12, paidFollowerGain: 3 },
        }] });
      }
      const element = { organizationalEntity: ORG_URN };
      for (const [field, { key, rows }] of Object.entries(DEMOGRAPHICS)) {
        element[field] = rows.map((r) => ({
          [key]: r.value,
          followerCounts: { organicFollowerCount: r.organic, paidFollowerCount: r.paid },
        }));
      }
      return json({ elements: [element], paging: { count: 1, start: 0 } });
    }

    /* ---- the standardized-data taxonomies, on the legacy /v2 base -------- */
    if (path === "/v2/geo" && refuse.geo) {
      return new Response(JSON.stringify({ message: "Not enough permissions", status: refuse.geo }), { status: refuse.geo });
    }
    if (path.startsWith("/v2/industryTaxonomyVersions/") && refuse.industry) {
      return new Response(JSON.stringify({ message: "Not enough permissions", status: refuse.industry }), { status: refuse.industry });
    }
    if (path === "/v2/geo") {
      const ids = /List\(([^)]*)\)/.exec(u.searchParams.get("ids") ?? "")?.[1]?.split(",") ?? [];
      const results = {};
      for (const id of ids) {
        const name = URN_NAMES.geo[id];
        if (name) results[id] = { defaultLocalizedName: { locale: { country: "US", language: "en" }, value: name } };
      }
      return json({ statuses: {}, results, errors: {} });
    }

    if (path.startsWith("/v2/industryTaxonomyVersions/")) {
      const results = {};
      for (const id of u.searchParams.getAll("ids")) {
        const name = URN_NAMES.industry[id];
        // An id the taxonomy does not know is simply absent from `results`,
        // which is how a real BATCH_GET reports one.
        if (name) results[id] = { id: Number(id), name: { localized: { en_US: name } }, childrenIndustries: [] };
      }
      return json({ results, statuses: {}, errors: {} });
    }

    if (path === "/v2/seniorities" || path === "/v2/functions") {
      const which = path === "/v2/seniorities" ? URN_NAMES.seniority : URN_NAMES.function;
      const elements = Object.entries(which).map(([id, name]) => ({
        id: Number(id), $URN: `urn:li:${path === "/v2/seniorities" ? "seniority" : "function"}:${id}`,
        name: { localized: { en_US: name } },
      }));
      return json({ elements, paging: { count: elements.length, start: 0, links: [] } });
    }

    if (path === "/organizationalEntityShareStatistics") {
      // Per-post when `shares` or `ugcPosts` is present; otherwise the daily series.
      const perParam = u.searchParams.has("shares") ? "shares" : u.searchParams.has("ugcPosts") ? "ugcPosts" : null;
      if (perParam) {
        if (failPostStats) {
          return new Response(JSON.stringify({ message: "Internal error", status: failPostStats }), { status: failPostStats });
        }
        // Answer only for the ids asked, under the field that matches the
        // parameter, as LinkedIn does. A ugcPost asked for as a share is simply
        // not in the response.
        const asked = new Set(/List\(([^)]*)\)/.exec(u.searchParams.get(perParam) ?? "")?.[1]?.split(",") ?? []);
        const field = perParam === "shares" ? "share" : "ugcPost";
        const elements = [];
        for (let i = 0; i < postCount - silent; i++) {
          if (!asked.has(postUrn(i)) || !postUrn(i).startsWith(`urn:li:${field}:`)) continue;
          elements.push({
            organizationalEntity: ORG_URN,
            [field]: postUrn(i),
            totalShareStatistics: {
              impressionCount: 1000 + i * 10,
              likeCount: i === 0 ? -3 : 40 + i,   // LinkedIn documents negatives
              commentCount: 6 + i,
              shareCount: 1 + i,
              clickCount: 70 + i,
              // NOTE: no uniqueImpressionsCount. LinkedIn does not return reach
              // per share, and the sync must store null rather than borrow
              // impressions.
            },
          });
        }
        return json({ elements, paging: { start: 0, count: elements.length } });
      }

      /*
       * Honour the window that was ASKED for, not the one the test configured.
       *
       * The mock used to return [from, to] whatever the query said, which made
       * it blind to the defect it most needed to catch: LinkedIn's range end is
       * EXCLUSIVE, so a sync that passes the last wanted day as `end` silently
       * loses that day. A mutation removing the +1 survived against the old mock
       * because nothing downstream could tell the difference. An API that ignores
       * its own parameters is not a model of the API.
       */
      const iv = decodeURIComponent(u.searchParams.get("timeIntervals") ?? "");
      const qStart = Number(/start:(\d+)/.exec(iv)?.[1] ?? NaN);
      const qEnd = Number(/end:(\d+)/.exec(iv)?.[1] ?? NaN);

      const elements = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const t = Date.parse(`${d}T00:00:00Z`);
        // Inclusive of start, exclusive of end — LinkedIn's own convention.
        if (Number.isFinite(qStart) && t < qStart) continue;
        if (Number.isFinite(qEnd) && t >= qEnd) continue;
        elements.push({
          organizationalEntity: ORG_URN,
          timeRange: { start: Date.parse(`${d}T00:00:00Z`), end: Date.parse(`${addDays(d, 1)}T00:00:00Z`) },
          totalShareStatistics: {
            impressionCount: trueValue("impressionCount", d),
            uniqueImpressionsCount: trueValue("uniqueImpressionsCount", d),
            likeCount: trueValue("likeCount", d),
            commentCount: trueValue("commentCount", d),
            shareCount: trueValue("shareCount", d),
            clickCount: trueValue("clickCount", d),
          },
        });
      }
      return json({ elements, paging: { start: 0, count: elements.length } });
    }

    return new Response(JSON.stringify({ message: `unexpected path ${path}` }), { status: 404 });
  };

  return { calls, restore: () => { globalThis.fetch = real; } };
}
