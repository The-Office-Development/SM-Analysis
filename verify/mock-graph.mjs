/**
 * Mock of the Meta Graph API v19.0 at the network boundary only.
 * Installs a globalThis.fetch router; the real _sync.ts runs unmodified against it.
 *
 * Response shapes follow Meta's documented IG Graph API responses, including the
 * `end_time` convention for period=day metrics: the value for calendar day D is
 * returned with end_time = (D+1)T07:00:00+0000 (midnight America/Los_Angeles).
 */

const IG_ID = "17841400000000000";

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
export const todayIso = () => iso(new Date());

/** Meta's end_time for the data of calendar day `dayIso`. */
const endTimeFor = (dayIso) => `${addDays(dayIso, 1)}T07:00:00+0000`;

/** Build a period=day metric row for days [startIso..endIso] using fn(dayIso, index). */
function dailyMetric(name, startIso, endIso, fn) {
  const values = [];
  let d = startIso, i = 0;
  while (d <= endIso) {
    values.push({ value: fn(d, i), end_time: endTimeFor(d) });
    d = addDays(d, 1); i++;
  }
  return { name, period: "day", values, title: name, description: `mock ${name}`, id: `${IG_ID}/insights/${name}/day` };
}

const metaError = (message, code, subcode) => ({
  error: { message, type: "OAuthException", code, ...(subcode ? { error_subcode: subcode } : {}), fbtrace_id: "AbCdEfMockTrace" },
});

/* --------------------------------------------------------------------------
 * SCENARIO A — "populated": normal IG business account, 1234 followers, posts.
 * ------------------------------------------------------------------------ */
function scenarioA(win) {
  const { start, end } = win;
  const media = [
    { id: "17900000000000001", caption: "Sunset over the harbour. Shot on the 35mm, no filter, straight out of camera. Swipe for the wide angle version.", media_type: "CAROUSEL_ALBUM", permalink: "https://www.instagram.com/p/CxAAAAAAAA1/", timestamp: `${addDays(end, -2)}T18:12:41+0000`, like_count: 412, comments_count: 37, insights: { data: [ { name: "reach", period: "lifetime", values: [{ value: 8421 }] }, { name: "saved", period: "lifetime", values: [{ value: 96 }] }, { name: "shares", period: "lifetime", values: [{ value: 41 }] } ] } },
    { id: "17900000000000002", caption: "3 things I wish I knew before going full time.", media_type: "VIDEO", permalink: "https://www.instagram.com/reel/CxAAAAAAAA2/", timestamp: `${addDays(end, -5)}T09:03:12+0000`, like_count: 1893, comments_count: 214, insights: { data: [ { name: "reach", period: "lifetime", values: [{ value: 31204 }] }, { name: "saved", period: "lifetime", values: [{ value: 742 }] }, { name: "shares", period: "lifetime", values: [{ value: 388 }] }, { name: "plays", period: "lifetime", values: [{ value: 44120 }] } ] } },
    { id: "17900000000000003", caption: "New drop is live ✨", media_type: "IMAGE", permalink: "https://www.instagram.com/p/CxAAAAAAAA3/", timestamp: `${addDays(end, -9)}T12:45:00+0000`, like_count: 233, comments_count: 12, insights: { data: [ { name: "reach", period: "lifetime", values: [{ value: 5110 }] }, { name: "saved", period: "lifetime", values: [{ value: 28 }] }, { name: "shares", period: "lifetime", values: [{ value: 9 }] } ] } },
    { id: "17900000000000004", caption: null, media_type: "IMAGE", permalink: "https://www.instagram.com/p/CxAAAAAAAA4/", timestamp: `${addDays(end, -14)}T07:20:11+0000`, like_count: 87, comments_count: 3, insights: { data: [ { name: "reach", period: "lifetime", values: [{ value: 2044 }] }, { name: "saved", period: "lifetime", values: [{ value: 5 }] }, { name: "shares", period: "lifetime", values: [{ value: 1 }] } ] } },
    { id: "17900000000000005", caption: "Behind the scenes of the shoot — full breakdown on the blog, link in bio. This caption is intentionally quite long so that the 120 character truncation in the parser is actually exercised end to end.", media_type: "VIDEO", permalink: "https://www.instagram.com/reel/CxAAAAAAAA5/", timestamp: `${addDays(end, -21)}T16:00:00+0000`, like_count: 655, comments_count: 44, insights: { data: [ { name: "reach", period: "lifetime", values: [{ value: 12880 }] }, { name: "saved", period: "lifetime", values: [{ value: 190 }] }, { name: "shares", period: "lifetime", values: [{ value: 77 }] }, { name: "plays", period: "lifetime", values: [{ value: 17330 }] } ] } },
    { id: "17900000000000006", caption: "Q&A answers below 👇", media_type: "CAROUSEL_ALBUM", permalink: "https://www.instagram.com/p/CxAAAAAAAA6/", timestamp: `${addDays(end, -27)}T11:11:11+0000`, like_count: 301, comments_count: 58, insights: { data: [ { name: "reach", period: "lifetime", values: [{ value: 6702 }] }, { name: "saved", period: "lifetime", values: [{ value: 61 }] }, { name: "shares", period: "lifetime", values: [{ value: 22 }] } ] } },
  ];

  return {
    profile: { followers_count: 1234, media_count: 47, id: IG_ID },
    reachImpressions: {
      data: [
        dailyMetric("reach", start, end, (_d, i) => 900 + ((i * 137) % 700)),
        dailyMetric("impressions", start, end, (_d, i) => 1400 + ((i * 211) % 1100)),
      ],
      paging: { previous: "https://graph.facebook.com/v19.0/…", next: "https://graph.facebook.com/v19.0/…" },
    },
    totalInteractions: { data: [dailyMetric("total_interactions", start, end, (_d, i) => 40 + ((i * 29) % 150))] },
    followerCount: { data: [dailyMetric("follower_count", start, end, (_d, i) => (i % 7 === 3 ? -2 : 1 + (i % 9)))] },
    media: { data: media, paging: { cursors: { before: "QVFI", after: "QVFI" } } },
    demographics: {
      age: { data: [{ name: "follower_demographics", period: "lifetime", title: "Follower demographics", description: "…", total_value: { breakdowns: [{ dimension_keys: ["age"], results: [
        { dimension_values: ["13-17"], value: 41 }, { dimension_values: ["18-24"], value: 388 }, { dimension_values: ["25-34"], value: 502 },
        { dimension_values: ["35-44"], value: 197 }, { dimension_values: ["45-54"], value: 74 }, { dimension_values: ["55-64"], value: 22 }, { dimension_values: ["65+"], value: 10 } ] }] }, id: `${IG_ID}/insights/follower_demographics/lifetime` }] },
      gender: { data: [{ name: "follower_demographics", period: "lifetime", total_value: { breakdowns: [{ dimension_keys: ["gender"], results: [
        { dimension_values: ["F"], value: 743 }, { dimension_values: ["M"], value: 468 }, { dimension_values: ["U"], value: 23 } ] }] }, id: `${IG_ID}/insights/follower_demographics/lifetime` }] },
      country: { data: [{ name: "follower_demographics", period: "lifetime", total_value: { breakdowns: [{ dimension_keys: ["country"], results: [
        { dimension_values: ["US"], value: 401 }, { dimension_values: ["GB"], value: 155 }, { dimension_values: ["EG"], value: 132 },
        { dimension_values: ["SA"], value: 98 }, { dimension_values: ["AE"], value: 77 }, { dimension_values: ["DE"], value: 61 },
        { dimension_values: ["IN"], value: 55 }, { dimension_values: ["ZZ"], value: 12 } ] }] }, id: `${IG_ID}/insights/follower_demographics/lifetime` }] },
    },
    onlineFollowers: {
      data: [{ name: "online_followers", period: "lifetime", values: Array.from({ length: 7 }, (_, k) => {
        const day = addDays(end, -(6 - k));
        const map = {};
        for (let h = 0; h < 24; h++) map[String(h)] = Math.max(0, Math.round(60 + 90 * Math.sin((h - 6) / 24 * Math.PI * 2) + ((h * 13 + k * 7) % 25)));
        return { value: map, end_time: `${addDays(day, 1)}T07:00:00+0000` };
      }), id: `${IG_ID}/insights/online_followers/lifetime` }],
    },
  };
}

/* --------------------------------------------------------------------------
 * SCENARIO B — "empty": THE USER'S ACTUAL ACCOUNT.
 * 12 followers, media_count 0, no posts. Meta returns zero-valued series for
 * reach/impressions, an empty data array for metrics with no history, and the
 * documented (#10) permission error for follower_demographics on accounts with
 * fewer than 100 followers.
 * ------------------------------------------------------------------------ */
function scenarioB(win) {
  const { start, end } = win;
  return {
    profile: { followers_count: 12, media_count: 0, id: IG_ID },
    reachImpressions: {
      data: [
        dailyMetric("reach", start, end, () => 0),
        dailyMetric("impressions", start, end, () => 0),
      ],
    },
    totalInteractions: { data: [] },
    followerCount: { data: [] },
    media: { data: [] },
    demographics: {
      age: metaError("(#10) Application does not have permission for this action", 10, 2108006),
      gender: metaError("(#10) Application does not have permission for this action", 10, 2108006),
      country: metaError("(#10) Application does not have permission for this action", 10, 2108006),
    },
    onlineFollowers: { data: [] },
  };
}

/* --------------------------------------------------------------------------
 * SCENARIO C — extra probe: same populated profile, but a viral month where the
 * follower_count deltas sum to far more than the CURRENT total. Exists purely to
 * characterise reconstructFollowers().
 * ------------------------------------------------------------------------ */
function scenarioC(win) {
  const a = scenarioA(win);
  return {
    ...a,
    profile: { followers_count: 1234, media_count: 47, id: IG_ID },
    followerCount: { data: [dailyMetric("follower_count", win.start, win.end, (_d, i) => 40 + ((i * 17) % 60))] },
  };
}

/* --------------------------------------------------------------------------
 * SCENARIO D — extra probe: Meta rejects the very first (profile) call, which
 * is what a policy-blocked / permission-stripped account looks like.
 * ------------------------------------------------------------------------ */
function scenarioD(win) {
  const b = scenarioB(win);
  return { ...b, profile: metaError("(#10) To use 'GET /instagram-business-account', your use of this endpoint must be reviewed and approved by Meta.", 10, 2108006) };
}

export const SCENARIOS = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD };

/**
 * Install globalThis.fetch. Returns { calls, restore }.
 */
export function installMockGraph(scenarioKey, { log = console.log } = {}) {
  const end = todayIso();
  const start = addDays(end, -29); // MAX_BACKFILL=30 on a first sync
  const fx = SCENARIOS[scenarioKey]({ start, end });

  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const u = new URL(url);
    const q = u.searchParams;
    const redacted = url.replace(/access_token=[^&]*/, "access_token=<TOKEN>");
    const path = u.pathname;
    let label = "UNMATCHED";
    let body;

    const metric = q.get("metric") ?? "";

    if (/^\/v19\.0\/\d+$/.test(path) && (q.get("fields") ?? "").includes("followers_count")) {
      label = "IG profile"; body = fx.profile;
    } else if (path.endsWith("/insights") && metric === "reach,impressions") {
      label = "IG daily reach+impressions"; body = fx.reachImpressions;
    } else if (path.endsWith("/insights") && metric === "total_interactions") {
      label = "IG daily total_interactions"; body = fx.totalInteractions;
    } else if (path.endsWith("/insights") && metric === "follower_count") {
      label = "IG daily follower_count"; body = fx.followerCount;
    } else if (path.endsWith("/insights") && metric === "follower_demographics") {
      const bd = q.get("breakdown") ?? "?";
      label = `IG follower_demographics[${bd}]`; body = fx.demographics[bd] ?? { data: [] };
    } else if (path.endsWith("/insights") && metric === "online_followers") {
      label = "IG online_followers"; body = fx.onlineFollowers;
    } else if (path.endsWith("/media")) {
      label = "IG media"; body = fx.media;
    } else {
      body = metaError("Unsupported get request in mock", 100);
    }

    calls.push({ url: redacted, label, method: init?.method ?? "GET" });
    log(`  HTTP ${init?.method ?? "GET"} [${label}] ${redacted}`);
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };

  return { calls, window: { start, end }, fixtures: fx, restore: () => { globalThis.fetch = original; } };
}
