#!/usr/bin/env node
/**
 * Probe the live LinkedIn API with a Company Page administrator's token.
 *
 *   LI_TOKEN=... node verify/probe-live-linkedin.mjs [--org 12345] [--try-batch]
 *
 * WHY THIS EXISTS
 * The LinkedIn integration is written entirely against documentation, and has
 * already been found wrong without a single call: the query encoding, and the
 * field name of the page-admin lookup, which the documentation itself spells two
 * ways. The Instagram probe found three of four daily metrics wrong the same way.
 * This makes the calls `syncLinkedIn` and `audienceLinkedIn` make, in the same
 * shapes, and prints what comes back, before the sync is allowed to store a row.
 *
 * Mirrors the LI block in netlify/functions/_linkedin.ts as LITERALS on purpose:
 * this script exists to test whether those values are right, so importing them
 * would let a wrong value agree with itself.
 *
 * GETTING A TOKEN
 * LinkedIn Developer Portal -> the PulseBoard app -> Auth -> OAuth 2.0 tools ->
 * create a token with r_organization_social and rw_organization_admin, signed in
 * as a SUPER ADMIN of the page (Drinkat's). rw_organization_admin is restricted
 * to members with the ADMINISTRATOR role; an Analyst's token gets 403.
 *
 * COST
 * Development tier allows 100 calls per member per day and 500 per app. This
 * spends about 12, and prints the count. It does not make the geo/industry
 * BATCH_GET calls unless --try-batch is passed: development tier forbids them,
 * and a refused call still counts. Pass it ONCE, to learn which status LinkedIn
 * uses for the refusal.
 *
 * Read-only throughout: every request is a GET. A token is a credential; use the
 * env var, not an argument, so it stays out of shell history.
 */

const TOKEN = process.env.LI_TOKEN ?? "";
if (!TOKEN) {
  console.error("usage: LI_TOKEN=... node verify/probe-live-linkedin.mjs [--org 12345] [--try-batch]");
  process.exit(2);
}
const argv = process.argv.slice(2);
const argOrg = argv.includes("--org") ? argv[argv.indexOf("--org") + 1] : null;
const TRY_BATCH = argv.includes("--try-batch");

const REST = "https://api.linkedin.com/rest";
const V2 = "https://api.linkedin.com/v2";
const VERSION = process.env.LINKEDIN_API_VERSION ?? "202608";
const INDUSTRY_TAXONOMY = "V2_7";
const enc = encodeURIComponent;
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const midnight = (d) => Date.parse(`${d}T00:00:00Z`);

let calls = 0, pass = 0, fail = 0;
const notes = [];

/** Values are sent as given: Rest.li structure raw, URNs pre-encoded, as liGet does. */
async function get(label, base, path, params = {}, { optional = false, raw = false } = {}) {
  const query = Object.entries(params).map(([k, v]) => `${enc(k)}=${v}`).join("&");
  const url = base + path + (query ? (path.includes("?") ? "&" : "?") + query : "");
  calls++;
  let res, text;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(base === REST ? { "LinkedIn-Version": VERSION } : {}),
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    text = await res.text();
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${label}\n        network: ${e.message}`);
    return null;
  }
  let body = null;
  try { body = JSON.parse(text); } catch { /* shown raw below */ }
  if (!res.ok) {
    const msg = `HTTP ${res.status}: ${(body?.message ?? text).slice(0, 240)}`;
    if (optional) { notes.push(`${label}: ${msg}`); console.log(`  n/a   ${label}\n        ${msg}`); }
    else { fail++; console.log(`  FAIL  ${label}\n        ${msg}\n        ${url}`); }
    return { status: res.status, body: null };
  }
  pass++;
  console.log(`  ok    ${label}`);
  if (raw) console.log(indent(JSON.stringify(body, null, 2).slice(0, 1500)));
  return { status: res.status, body };
}
const indent = (s) => s.split("\n").map((l) => `        ${l}`).join("\n");

console.log(`\nProbing ${REST} with LinkedIn-Version ${VERSION}\n`);

/* ---- 1. which page, and the field name the docs disagree on --------------- */
console.log("1. PAGES THIS MEMBER ADMINISTERS");
const acl = await get("organizationAcls q=roleAssignee (ADMINISTRATOR, APPROVED)", REST, "/organizationAcls",
  { q: "roleAssignee", role: "ADMINISTRATOR", state: "APPROVED" }, { raw: true });
const el0 = acl?.body?.elements?.[0];
let orgUrn = argOrg ? `urn:li:organization:${argOrg}` : null;
if (el0) {
  const field = ["organization", "organizationTarget", "organizationalTarget"].find((f) => f in el0);
  console.log(`        the page URN is in the field: ${field ?? "NONE OF THE THREE"}  (keys: ${Object.keys(el0).join(", ")})`);
  if (!field) notes.push(`*** organizationAcls element has none of organization/organizationTarget/organizationalTarget; administeredOrganizations() will find no page. Keys: ${Object.keys(el0).join(", ")}`);
  else notes.push(`organizationAcls names the page field "${field}". administeredOrganizations reads all three; it can now be narrowed to this one.`);
  orgUrn ??= el0[field];
} else if (acl?.body) {
  notes.push("*** this member administers no page: an Analyst or Content admin token, or the wrong LinkedIn account");
}
if (!orgUrn) { console.log("\nNo page to probe. Pass --org <id> or use a super admin's token.\n"); process.exit(1); }
const orgId = orgUrn.split(":").pop();
console.log(`        probing ${orgUrn}`);

const org = await get("organizations/{id}", REST, `/organizations/${orgId}`);
if (org?.body) console.log(`        ${org.body.localizedName ?? "?"} (vanity: ${org.body.vanityName ?? "?"})`);

/* ---- 2. follower total ------------------------------------------------------ */
console.log("\n2. FOLLOWER TOTAL");
const net = await get("networkSizes/{urn} COMPANY_FOLLOWED_BY_MEMBER", REST, `/networkSizes/${enc(orgUrn)}`,
  { edgeType: "COMPANY_FOLLOWED_BY_MEMBER" }, { raw: true });
const total = net?.body?.firstDegreeSize;
if (net?.body && typeof total !== "number") notes.push("*** networkSizes returned no firstDegreeSize; the sync stores no follower total");

/* ---- 3. the daily series: exclusive end, trailing edge, reach -------------- */
console.log("\n3. DAILY PAGE STATISTICS (last 14 days, as the sync asks)");
const today = iso(Date.now());
const from = iso(Date.now() - 14 * DAY);
const daily = await get("organizationalEntityShareStatistics DAY", REST, "/organizationalEntityShareStatistics", {
  q: "organizationalEntity",
  organizationalEntity: enc(orgUrn),
  timeIntervals: `(timeRange:(start:${midnight(from)},end:${midnight(today) + DAY}),timeGranularityType:DAY)`,
});
const days = daily?.body?.elements ?? [];
if (daily?.body) {
  const dates = days.map((e) => iso(e.timeRange?.start));
  console.log(`        ${days.length} day(s): ${dates[0] ?? "-"} .. ${dates.at(-1) ?? "-"}   (asked ${from} .. ${today})`);
  if (days[0]) console.log(indent(JSON.stringify(days.at(-1), null, 2)));
  const last = dates.at(-1);
  if (last) {
    const lag = Math.round((midnight(today) - midnight(last)) / DAY);
    notes.push(`daily statistics end ${lag} day(s) before today (docs: two). The sync marks recent days provisional; check that covers this.`);
  }
  const startsAtMidnightUtc = days.every((e) => new Date(e.timeRange?.start).getUTCHours() === 0);
  if (!startsAtMidnightUtc) notes.push("*** timeRange.start is NOT midnight UTC; liDayKey assumes it is, so days may file one out");
  if (days.length && !days.some((e) => "uniqueImpressionsCount" in (e.totalShareStatistics ?? {}))) {
    notes.push("*** no uniqueImpressionsCount on the daily series; the sync's reach column will be empty for LinkedIn");
  }
}

/* ---- 4. follower movement: gross or net? ----------------------------------- */
console.log("\n4. FOLLOWER GAINS WITH A TIME RANGE (the gross-or-net question)");
const gains = await get("organizationalEntityFollowerStatistics with timeIntervals", REST, "/organizationalEntityFollowerStatistics", {
  q: "organizationalEntity",
  organizationalEntity: enc(orgUrn),
  timeIntervals: `(timeRange:(start:${midnight(from)},end:${midnight(today) + DAY}),timeGranularityType:DAY)`,
});
const gainRows = gains?.body?.elements ?? [];
if (gains?.body) {
  console.log(`        ${gainRows.length} day(s)`);
  for (const g of gainRows.slice(-5)) {
    console.log(`        ${iso(g.timeRange?.start)}  organic=${g.followerGains?.organicFollowerGain}  paid=${g.followerGains?.paidFollowerGain}`);
  }
  if (gainRows.some((g) => (g.followerGains?.organicFollowerGain ?? 0) < 0)) {
    notes.push("followerGains has a NEGATIVE day: gains are NET of unfollows. They must not go in the gross `follows` column.");
  } else {
    notes.push(`followerGains is never negative over ${gainRows.length} days. Not yet proof of gross: record today's networkSizes (${total ?? "?"}), run again tomorrow, and compare the change with that day's gain. If the change is ever below the gain, gains are gross.`);
  }
}

/* ---- 5. demographics: lifetime, no time range ------------------------------ */
console.log("\n5. FOLLOWER DEMOGRAPHICS (lifetime, NO timeIntervals)");
const facets = await get("organizationalEntityFollowerStatistics lifetime", REST, "/organizationalEntityFollowerStatistics", {
  q: "organizationalEntity", organizationalEntity: enc(orgUrn),
});
const f0 = facets?.body?.elements?.[0] ?? {};
const ids = { geo: new Set(), industry: new Set() };
for (const [field, key] of [
  ["followerCountsByIndustry", "industry"], ["followerCountsBySeniority", "seniority"],
  ["followerCountsByFunction", "function"], ["followerCountsByStaffCountRange", "staffCountRange"],
  ["followerCountsByGeoCountry", "geo"], ["followerCountsByGeo", "geo"],
  ["followerCountsByAssociationType", "associationType"],
]) {
  const rows = f0[field];
  if (!Array.isArray(rows)) { console.log(`        ${field}: ABSENT`); continue; }
  const sum = rows.reduce((s, r) => s + (r.followerCounts?.organicFollowerCount ?? 0), 0);
  console.log(`        ${field}: ${rows.length} bucket(s), organic total ${sum}${rows.length >= 100 ? "  (capped at 100)" : ""}`);
  if (field === "followerCountsByIndustry") rows.forEach((r) => ids.industry.add(String(r.industry).split(":").pop()));
  if (key === "geo") rows.forEach((r) => ids.geo.add(String(r.geo).split(":").pop()));
  if (rows[0] && !(key in rows[0])) notes.push(`*** ${field} rows carry no "${key}" field; LI_FACETS names the wrong value field. Keys: ${Object.keys(rows[0]).join(", ")}`);
}
if (facets?.body) notes.push(`Compare each facet above against the page's Analytics -> Followers tab. networkSizes says ${total ?? "?"} followers; a facet total well below it is the top-100 cap or unclassified followers, not a defect.`);

/* ---- 6. taxonomies ------------------------------------------------------------ */
console.log("\n6. TAXONOMIES");
for (const path of ["/seniorities", "/functions"]) {
  const t = await get(`v2${path} GET_ALL`, V2, path, { count: "100", "locale.language": "en", "locale.country": "US" });
  if (t?.body) console.log(`        ${t.body.elements?.length ?? 0} value(s); first: ${JSON.stringify(t.body.elements?.[0]?.name ?? null)}`);
}
if (TRY_BATCH) {
  const g = await get("v2/geo BATCH_GET (development tier forbids)", V2, "/geo",
    { ids: `List(${[...ids.geo].slice(0, 5).join(",")})` }, { optional: true });
  const i = await get("v2/industries BATCH_GET (development tier forbids)", V2,
    `/industryTaxonomyVersions/${INDUSTRY_TAXONOMY}/industries?${[...ids.industry].slice(0, 5).map((x) => `ids=${x}`).join("&")}`,
    { "locale.language": "en", "locale.country": "US" }, { optional: true });
  for (const [name, r] of [["geo", g], ["industries", i]]) {
    if (r?.status === 403) notes.push(`${name} BATCH_GET refused with 403. The sync treats a taxonomy 403 as unavailable, not as an expired token: correct.`);
    else if (r?.status === 429) notes.push(`*** ${name} BATCH_GET refused with 429. That is classified as a THROTTLE and stops the run; keep LINKEDIN_API_TIER=development so it is never attempted.`);
    else if (r?.body) notes.push(`${name} BATCH_GET ANSWERED on this tier. Either the app is already on standard, or the documented restriction is not enforced; set LINKEDIN_API_TIER=standard only if the former.`);
  }
} else {
  console.log("        geo / industry BATCH_GET skipped (pass --try-batch once to learn the refusal status)");
}

/* ---- 7. posts and per-post statistics --------------------------------------- */
console.log("\n7. POSTS");
const posts = await get("posts q=author", REST, "/posts", {
  q: "author", author: enc(orgUrn), count: "100", sortBy: "CREATED",
});
const list = (posts?.body?.elements ?? []).filter((p) => p.id);
if (posts?.body) {
  console.log(`        ${list.length} post(s)`);
  if (list[0]) console.log(`        newest: ${list[0].id}  published ${list[0].publishedAt ? iso(list[0].publishedAt) : "?"}  content keys: ${Object.keys(list[0].content ?? {}).join(",") || "(none)"}`);
  if (!list.length) notes.push("no posts listed. If the page does have posts, the author finder or its encoding is wrong.");
}
for (const [kind, param] of [["share", "shares"], ["ugcPost", "ugcPosts"]]) {
  // The finder takes each URN type in its own parameter; see syncLinkedIn.
  const ofKind = list.filter((p) => String(p.id).startsWith(`urn:li:${kind}:`)).slice(0, 20);
  if (!ofKind.length) { console.log(`        no ${kind} posts listed`); continue; }
  const per = await get(`organizationalEntityShareStatistics ${param}=List(...)`, REST, "/organizationalEntityShareStatistics", {
    q: "organizationalEntity", organizationalEntity: enc(orgUrn),
    [param]: `List(${ofKind.map((p) => enc(p.id)).join(",")})`,
  });
  const rows = per?.body?.elements ?? [];
  if (!per?.body) continue;
  console.log(`        statistics for ${rows.length} of ${ofKind.length} ${kind} post(s) asked (absent = zero, per LinkedIn)`);
  if (rows[0]) console.log(indent(JSON.stringify(rows[0], null, 2)));
  if (rows.some((r) => !(r.share ?? r.ugcPost))) notes.push(`*** some ${param} rows carry neither share nor ugcPost; the sync cannot match them to a post`);
  if (rows.some((r) => "uniqueImpressionsCount" in (r.totalShareStatistics ?? {}))) notes.push(`per-post uniqueImpressionsCount IS present for ${kind}s; reach could be stored per post after all`);
  if (rows.some((r) => (r.totalShareStatistics?.likeCount ?? 0) < 0)) notes.push("a negative likeCount appeared, as documented; liLikes keeps it");
  if (ofKind.length >= 3 && rows.length === 0) notes.push(`*** none of ${ofKind.length} ${kind} posts came back. Possible if none had impressions; otherwise the ${param} parameter is wrong and the sync is recording zeros`);
}

/* ---- summary ----------------------------------------------------------------- */
console.log(`\n${"-".repeat(60)}`);
console.log(`${pass} ok, ${fail} failed, ${calls} call(s) spent of this member's 100 for today`);
if (notes.length) {
  console.log("\nWorth reading:");
  for (const n of notes) console.log(`  - ${n}`);
}
console.log(`
A FAIL above is a name or a shape in the LI block of netlify/functions/_linkedin.ts.
Record what this run settles in docs/LINKEDIN-PLAN.md Phase 3 and, for any number
that disagrees with the page's own Analytics tab, docs/DATA-INTEGRITY.md.
`);
process.exit(fail > 0 ? 1 : 0);
