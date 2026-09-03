#!/usr/bin/env node
/**
 * Probe the live Instagram API with a dashboard-generated token.
 *
 *   node verify/probe-live.mjs <access_token>
 *   IG_TOKEN=... node verify/probe-live.mjs
 *
 * WHY THIS EXISTS
 * Every test in this repo runs against a mock built from Meta's *documented*
 * conventions. No line of this code has ever seen a real Instagram response, and
 * the last documentation pass found three of the four daily metrics wrong. That
 * is the single largest open risk in the project.
 *
 * This settles it without deploying anything. Meta's App Dashboard hands out a
 * long-lived token directly (Instagram -> API setup with Instagram business
 * login -> Generate token), so the API contract can be checked before Netlify,
 * before OAuth, before a client is watching.
 *
 * It makes exactly the calls `syncInstagramLogin` makes, in the same shapes,
 * with the same names from the IG block. Read-only throughout: it fetches and
 * prints, and writes nothing anywhere.
 *
 * A token is a credential. Prefer the env var, and remember shell history keeps
 * whatever you type as an argument.
 */

const TOKEN = process.argv[2] ?? process.env.IG_TOKEN ?? "";
if (!TOKEN) {
  console.error("usage: node verify/probe-live.mjs <access_token>   (or set IG_TOKEN)");
  process.exit(2);
}

// Mirrors of the IG block in netlify/functions/_instagram.ts. Kept as literals
// on purpose: this script exists to test whether those values are right, so
// importing them would let a wrong value agree with itself.
const GRAPH = "https://graph.instagram.com";
const VERSION = process.env.IG_API_VERSION ?? "v26.0";
const ME_FIELDS = "user_id,username,name,profile_picture_url,followers_count,media_count";
const MEDIA_FIELDS = "id,caption,media_type,permalink,timestamp,like_count,comments_count";
const MEDIA_INSIGHT_METRICS = "reach,saved,shares,views";

const DAY = 86400;
const nowSec = Math.floor(Date.now() / 1000);
// A settled window: yesterday back seven days. Avoids today, which is still
// accumulating and would look wrong for reasons that are not defects.
const until = nowSec - DAY * 1;
const since = until - DAY * 6;

let pass = 0, fail = 0;
const notes = [];

async function call(label, path, params, { optional = false } = {}) {
  const u = new URL(`${GRAPH}/${VERSION}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);

  let res, body;
  try {
    res = await fetch(u);
    body = await res.json();
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${label}\n        network: ${e.message}`);
    return null;
  }

  if (!res.ok || body.error) {
    const e = body.error ?? {};
    const msg = e.message ?? `HTTP ${res.status}`;
    if (optional) {
      notes.push(`${label}: ${msg}`);
      console.log(`  n/a   ${label}\n        ${msg}`);
    } else {
      fail++;
      console.log(`  FAIL  ${label}\n        ${msg}${e.code ? `  (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : ""}`);
    }
    return null;
  }

  pass++;
  console.log(`  ok    ${label}`);
  return body;
}

const j = (o) => JSON.stringify(o);

console.log(`\nProbing ${GRAPH}/${VERSION}`);
console.log(`Settled window: ${new Date(since * 1000).toISOString().slice(0, 10)} .. ${new Date(until * 1000).toISOString().slice(0, 10)}\n`);

console.log("PROFILE");
const prof = await call("GET /me", "/me", { fields: ME_FIELDS });
if (prof) {
  console.log(`        ${prof.username ?? "?"} · followers=${prof.followers_count ?? "?"} · media=${prof.media_count ?? "?"}`);
  for (const f of ME_FIELDS.split(",")) {
    if (!(f in prof)) notes.push(`/me did not return the field "${f}" — check ME_FIELDS`);
  }
}

console.log("\nACCOUNT INSIGHTS — the daily series");
// reach is the ONLY account metric documented to support time_series. If this
// call fails or comes back without end_time, dayKeyFromEndTime has nothing to
// derive the account's UTC offset from and every day could file one day out.
const reach = await call("reach (metric_type=time_series)", "/me/insights", {
  metric: "reach", period: "day", metric_type: "time_series",
  since: String(since), until: String(until),
});
if (reach) {
  const v = reach.data?.[0]?.values ?? [];
  console.log(`        ${v.length} day(s) returned`);
  if (v[0]) console.log(`        first: ${j(v[0])}`);
  if (!v[0]?.end_time) {
    notes.push("reach values carry no end_time — offsetFrom() cannot learn the account's UTC offset, and dayKeyFromEndTime depends on it");
  }
}

console.log("\nACCOUNT INSIGHTS — total_value, one call per day in the sync");
const oneDaySince = String(until - DAY), oneDayUntil = String(until);
for (const metric of ["views", "total_interactions"]) {
  const r = await call(`${metric} (metric_type=total_value)`, "/me/insights", {
    metric, period: "day", metric_type: "total_value",
    since: oneDaySince, until: oneDayUntil,
  }, { optional: true });
  if (r) console.log(`        total_value = ${j(r.data?.[0]?.total_value)}`);
}

const fu = await call("follows_and_unfollows (breakdown=follow_type)", "/me/insights", {
  metric: "follows_and_unfollows", period: "day", metric_type: "total_value",
  breakdown: "follow_type", since: oneDaySince, until: oneDayUntil,
}, { optional: true });
if (fu) console.log(`        ${j(fu.data?.[0]?.total_value)?.slice(0, 300)}`);

console.log("\nMETRICS THE DOCS SAY ARE GONE (expected to fail — a pass means the docs are wrong)");
for (const metric of ["follower_count", "online_followers"]) {
  const r = await call(metric, "/me/insights", {
    metric, period: "day", since: oneDaySince, until: oneDayUntil,
  }, { optional: true });
  if (r) notes.push(`*** ${metric} ANSWERED. It is documented as removed. Re-open that finding: ${j(r.data?.[0])?.slice(0, 200)}`);
}

console.log("\nMEDIA");
const media = await call("GET /me/media + insights", "/me/media", {
  fields: `${MEDIA_FIELDS},insights.metric(${MEDIA_INSIGHT_METRICS})`, limit: "5",
});
if (media) {
  const items = media.data ?? [];
  console.log(`        ${items.length} item(s)`);
  if (items[0]) {
    const m = items[0];
    console.log(`        newest: ${m.media_type} ${m.timestamp} likes=${m.like_count} comments=${m.comments_count}`);
    const ins = (m.insights?.data ?? []).map((x) => `${x.name}=${x.values?.[0]?.value}`);
    console.log(`        insights: ${ins.length ? ins.join(" ") : "NONE RETURNED"}`);
    if (!ins.length) notes.push("media returned no insights — check MEDIA_INSIGHT_METRICS names");
  }
}

console.log("\nDEMOGRAPHICS (needs ~100 followers; empty below that is normal)");
for (const breakdown of ["age", "gender", "country"]) {
  const r = await call(`follower_demographics / ${breakdown}`, "/me/insights", {
    metric: "follower_demographics", period: "lifetime", timeframe: "this_month",
    metric_type: "total_value", breakdown,
  }, { optional: true });
  if (r) {
    const n = r.data?.[0]?.total_value?.breakdowns?.[0]?.results?.length ?? 0;
    console.log(`        ${n} segment(s)`);
  }
}

console.log(`\n${"─".repeat(60)}`);
console.log(`${pass} ok, ${fail} failed`);
if (notes.length) {
  console.log("\nWorth reading:");
  for (const n of notes) console.log(`  · ${n}`);
}
console.log(`
Anything above marked FAIL or n/a is a name in the IG block at the top of
netlify/functions/_instagram.ts. That is the only place these strings live, so
a wrong one is wrong only there.

"n/a" on views / total_interactions / follows_and_unfollows is survivable — the
sync stores those as unknown rather than zero. A FAIL on /me or on reach is not:
reach is the only daily series, and its end_time is what tells the sync which
calendar day a number belongs to.
`);

process.exit(fail > 0 ? 1 : 0);
