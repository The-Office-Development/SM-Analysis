/**
 * Mutation check — does the suite actually detect a defect?
 *
 * The pre-launch audit measured the previous harness at 0/13: thirteen defects
 * injected into real source all survived, eleven with byte-identical output.
 * This injects defects into the COMPILED output, runs the suite, and requires
 * each one to be caught. It is the acceptance gate for the tests themselves.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SYNC = "verify/build/_sync.js";
const LIB = "verify/build/_lib.js";
const TOKENS = "verify/build/_tokens.js";
const DELETION = "verify/build/meta-data-deletion.js";
const INSTA = "verify/build/_instagram.js";
const INSIGHTS = "verify/build-lib/insights.js";
const FORMAT = "verify/build-lib/format.js";
const CSVREPORT = "verify/build-lib/csvReport.js";
const XLSX = "verify/build-lib/xlsx.js";

const mutations = [
  { name: "reach inflated 10x", file: SYNC,
    find: "byDate[date] = v.value;", replace: "byDate[date] = v.value * 10;" },
  { name: "every day filed 5 days late", file: SYNC,
    find: "return new Date(localNextMidnight.getTime() - 86_400_000).toISOString().slice(0, 10);",
    replace: "return new Date(localNextMidnight.getTime() + 4 * 86400000).toISOString().slice(0, 10);" },
  { name: "trailing re-fetch disabled (days freeze again)", file: SYNC,
    find: "const TRAILING_REFETCH = 7;", replace: "const TRAILING_REFETCH = 1;" },
  { name: "unknown metrics fabricated as zero", file: SYNC,
    find: "const pick = (fresh, key) => (fresh !== null ? fresh : (p?.[key] ?? null));",
    replace: "const pick = (fresh, key) => (fresh !== null ? fresh : (p?.[key] ?? 0));" },
  { name: "rows written under another tenant's account", file: SYNC,
    find: "account_id: acc.id,\n            platform: acc.platform,",
    replace: "account_id: 'SOMEONE-ELSES-ACCOUNT',\n            platform: acc.platform," },
  { name: "throttling swallowed instead of re-thrown", file: SYNC,
    find: "if (isThrottleError(e) || isAuthError(e))\n            throw e;",
    replace: "if (false)\n            throw e;" },
  { name: "OAuth state accepted without the browser cookie", file: LIB,
    find: "if (!data.n || !cookieNonce || !safeEqual(String(data.n), cookieNonce))\n            return null;",
    replace: "if (false)\n            return null;" },
  { name: "cross-tenant account attachment allowed", file: LIB,
    find: "if (owner)\n        throw new AccountOwnedByAnotherTenant(", replace: "if (false)\n        throw new AccountOwnedByAnotherTenant(" },
  { name: "tokens stored in the clear", file: LIB,
    find: "return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString(\"base64\");",
    replace: "return plain;" },
  { name: "auth errors classified by message text again", file: LIB,
    find: "return e instanceof GraphError && e.code !== undefined && AUTH_CODES.has(e.code);",
    replace: "return e instanceof GraphError && /token|expired|oauth|session/i.test(e.message);" },
  { name: "rotated refresh token discarded", file: TOKENS,
    find: "refresh_token: body.refresh_token ? encryptToken(body.refresh_token) : id.refresh_token,",
    replace: "refresh_token: id.refresh_token," },
  { name: "refresh lock removed (concurrent refresh kills the token)", file: TOKENS,
    find: "if (!(await acquireRefreshLock(db, id.id)))\n        return \"locked\";",
    replace: "if (false)\n        return \"locked\";" },
  { name: "all providers share one refresh window", file: TOKENS,
    find: "const window = id.provider === \"tiktok\" ? RENEW_WITHIN_MS_TIKTOK",
    replace: "const window = RENEW_WITHIN_MS; const _unused = id.provider === \"tiktok\" ? RENEW_WITHIN_MS_TIKTOK" },
  { name: "signed_request signature not verified", file: DELETION,
    find: "if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected))\n        return null;",
    replace: "if (false)\n        return null;" },
  { name: "deletion acknowledges without deleting", file: DELETION,
    find: "await db.from(\"account_secrets\").delete().eq(\"account_id\", a.id);",
    replace: "" },
  { name: "deploy previews allowed to touch the production database", file: LIB,
    find: "if ((context === \"deploy-preview\" || context === \"branch-deploy\") && !process.env.ALLOW_NONPROD_DB) {",
    replace: "if (false) {" },
  { name: "net follower change treats unreported churn as zero", file: INSIGHTS,
    find: "net: bothKnown ? gained - lost : null,",
    replace: "net: (gained ?? 0) - (lost ?? 0)," },
  { name: "churn rate treats unreported unfollows as zero", file: INSIGHTS,
    find: "churnRate: bothKnown && gained > 0 ? lost / gained : null,",
    replace: "churnRate: gained && gained > 0 ? (lost ?? 0) / gained : null," },
  { name: "follows_and_unfollows dimension read as audience type, not direction", file: SYNC,
    find: 'if (key.includes("NON_FOLLOWER") || key.includes("NON-FOLLOWER"))',
    replace: 'if (key.includes("UNFOLLOW"))' },
  { name: "token scope audit proves a write scope by attempting the write", file: INSTA,
    find: 'const res = await fetch(u, { signal: AbortSignal.timeout(8000) });',
    replace: 'const res = await fetch(u, { method: "POST", signal: AbortSignal.timeout(8000) });' },
  { name: "call budget removed, letting a run overrun and lose its writes", file: SYNC,
    find: "if (c.calls >= callBudget())",
    replace: "if (false)" },
  { name: "day loop walks oldest-first, so truncation loses the newest days", file: SYNC,
    find: "const date = dates[dates.length - 1 - n];",
    replace: "const date = dates[n];" },
  /*
   * Expressed against backfillTurn rather than against the branch, because at the
   * default 30-day floor a dig finishes in two runs and deleting the guard
   * changes nothing observable. It is the deep backfill the guard protects —
   * Meta allows two years — so the defect is only visible where the turn is
   * computed. Returning a constant that is never 3 is exactly "never yield".
   */
  { name: "backfill never yields, so recent days freeze for the whole dig", file: SYNC,
    find: "    return Math.floor(Math.max(0, days) / Math.max(1, budget)) % 4;",
    replace: "    return 0;" },
  /*
   * The backfill turn taken from the wall clock again.
   *
   * This is the defect that was live: every run inside the same quarter-hour
   * computed the identical window, so a client pressing Sync during onboarding
   * repeated the previous fetch each time, and the suite itself failed for
   * fifteen minutes in every hour.
   */
  { name: "backfill turn keyed on the clock, so repeated syncs repeat work", file: SYNC,
    find: "    const days = Math.round((Date.parse(earliest) - Date.parse(floor)) / 86_400_000);\n    return Math.floor(Math.max(0, days) / Math.max(1, budget)) % 4;",
    replace: "    return Math.floor(Date.now() / (15 * 60 * 1000)) % 4;" },
  { name: "trailing window stops rotating, so the far end is never refreshed", file: SYNC,
    find: "const from = (ticks % slices) * slice;",
    replace: "const from = 0;" },
  { name: "media truncated at the first page", file: SYNC,
    find: "if (!after || !body.paging?.next)",
    replace: "if (true)" },
  { name: "stories not captured at all", file: SYNC,
    find: "return { days, posts: [...posts, ...stories] };",
    replace: "return { days, posts };" },
  { name: "a story's absent likes stored as zero, sinking it in every ranking", file: SYNC,
    find: "likes: null, comments: null, saves: null,",
    replace: "likes: 0, comments: 0, saves: 0," },
  { name: "an unreported post metric stored as zero instead of null", file: SYNC,
    find: "reach: ins.reach ?? null,",
    replace: "reach: ins.reach ?? 0," },
  { name: "a day with no post to derive engagement from stored as zero", file: SYNC,
    find: "engagements[d] = d in reach.byDate ? byDate[d] ?? null : null;",
    replace: "engagements[d] = d in reach.byDate ? byDate[d] ?? 0 : null;" },
  { name: "discovery rate derived from only one half of the split", file: INSIGHTS,
    find: "discoveryRate: bothKnown && attributed > 0 ? nonFollowers / attributed : null,",
    replace: "discoveryRate: attributed > 0 ? (nonFollowers ?? 0) / attributed : null," },
  { name: "Instagram Login requests a write-capable scope", file: INSTA,
    find: 'SCOPES: ["instagram_business_basic", "instagram_business_manage_insights"],',
    replace: 'SCOPES: ["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_content_publish"],' },
  { name: "short-lived Instagram token stored instead of long-lived", file: INSTA,
    find: "const accessToken = long.access_token || short.access_token;",
    replace: "const accessToken = short.access_token;" },
  // The follower series is cumulative, so it is only as right as the ONE total it
  // is derived from. Both of these restore ways of getting that total wrong.
  { name: "follower series anchored on today's count for an old window", file: SYNC,
    find: "const resolved = anchor ?? (reachesToday && liveTotal !== null ? { date: end, total: liveTotal } : null);",
    replace: "const resolved = (liveTotal !== null ? { date: end, total: liveTotal } : null);" },
  { name: "backfill overlap removed (no stored day anchors the chunk)", file: SYNC,
    find: "        const end = earliest;",
    replace: "        const end = addDays(earliest, -1);" },
  // Restores the defect found on the first live call: the account's calendar day
  // taken from the platform's own bucketing. A Jordanian account came back on US
  // Pacific midnight, so every daily figure covered 10:00-10:00 Amman under a
  // label that said otherwise. Both Instagram paths, because one insights
  // reference governs both and the defect was in both.
  { name: "day boundary taken from the platform instead of the account", file: SYNC,
    find: `    const offset = accountOffsetHours(acc);
    const metaOffset = offsetFrom(reachJson, ctx);`,
    replace: `    const offset = offsetFrom(reachJson, ctx);
    const metaOffset = offset;` },
  // 0008. Both restore a way of reporting a number that looks right and is not.
  { name: "churn discarded — only the net follower change kept", file: SYNC,
    find: "    const follows = seriesFromRaw(followRaw, (j) => followDirections(j).follows);",
    replace: "    const follows = seriesFromRaw(followRaw, () => null);" },
  { name: "UNKNOWN folded into follower reach, inflating the discovery split", file: SYNC,
    find: `            if (key.includes("NON_FOLLOWER") || key.includes("NON-FOLLOWER"))
                nonFollowers = (nonFollowers ?? 0) + value;
            else if (key.includes("FOLLOWER"))
                followers = (followers ?? 0) + value;`,
    replace: `            if (key.includes("NON_FOLLOWER") || key.includes("NON-FOLLOWER"))
                nonFollowers = (nonFollowers ?? 0) + value;
            else
                followers = (followers ?? 0) + value;` },
  { name: "unset account timezone silently inherits the platform's boundary", file: SYNC,
    find: "  return (typeof m === \"number\" && Number.isFinite(m) ? m : DEFAULT_TZ_OFFSET_MINUTES) / 60;",
    replace: "  return (typeof m === \"number\" && Number.isFinite(m) ? m : 0) / 60;" },
  /*
   * An unknown read time invented as "just now".
   *
   * This is the fabricated-zero defect wearing a different hat, and it damages
   * the same way. The freshness line exists so a client comparing this dashboard
   * against the Instagram app can tell a timing gap from an error. A line that
   * claims a figure was read seconds ago when nobody knows when it was read
   * makes the product confidently wrong at precisely the moment it is being
   * checked, which is worse than saying nothing at all.
   */
  /*
   * The deep layer states conclusions, not measurements, and a client cannot
   * check a conclusion against their phone. Every mutation below turns a guarded
   * analysis into a confident one, which is the exact failure this layer risks.
   */
  { name: "a timing recommendation made on a single post", file: INSIGHTS,
    find: "lift: xs && xs.length >= TIMING_MIN_POSTS ? median(xs) : null,",
    replace: "lift: xs && xs.length >= 1 ? median(xs) : null," },
  { name: "one viral post allowed to carry a whole time slot", file: INSIGHTS,
    find: "lift: xs && xs.length >= TIMING_MIN_POSTS ? median(xs) : null,",
    replace: "lift: xs && xs.length >= TIMING_MIN_POSTS ? xs.reduce((a, v) => a + v, 0) / xs.length : null," },
  { name: "publish times read as UTC instead of the account's own", file: INSIGHTS,
    find: "const d = new Date(ms + tzOffsetMinutes * 60_000);",
    replace: "const d = new Date(ms);" },
  { name: "typical follower loss taken as the mean, hiding every spike", file: INSIGHTS,
    find: "const typical = median(losses);",
    replace: "const typical = losses.reduce((a, v) => a + v, 0) / losses.length;" },
  { name: "reach divided by a follower count from AFTER the post", file: INSIGHTS,
    find: "            if (f.date <= day)",
    replace: "            if (true)" },
  /*
   * The export is read without the interface around it, by the person the client
   * is negotiating with. Both mutations below put a number in front of a sponsor
   * that nobody measured.
   */
  { name: "unreported metrics exported as the literal string from the value", file: CSVREPORT,
    find: 'typeof v === "number" && Number.isFinite(v) ? String(v) : "";',
    replace: 'String(v);' },
  { name: "a rate invented where the denominator is unknown", file: CSVREPORT,
    find: 'typeof v === "number" && Number.isFinite(v) ? v.toFixed(dp) : "";',
    replace: 'Number(v).toFixed(dp);' },
  { name: "an unknown figure written into the workbook as a zero", file: XLSX,
    find: 'if (cell.v === null || cell.v === undefined || cell.v === "")',
    replace: 'if (false)' },
  { name: "unknown read time invented as 'just now'", file: FORMAT,
    find: `    if (!iso)
        return null;`,
    replace: `    if (!iso)
        return "just now";` },
];

function runSuite() {
  try {
    execFileSync("node", ["--test", "verify/tests/sync.test.mjs", "verify/tests/security.test.mjs", "verify/tests/csv.test.mjs", "verify/tests/tokens.test.mjs", "verify/tests/deletion.test.mjs", "verify/tests/instagram-login.test.mjs", "verify/tests/insights.test.mjs", "verify/tests/freshness.test.mjs", "verify/tests/deep-insights.test.mjs", "verify/tests/xlsx.test.mjs"], { stdio: "pipe" });
    return true;   // suite passed
  } catch { return false; } // suite failed
}

if (!runSuite()) {
  console.error("The suite does not pass on unmodified code — fix that before measuring mutations.");
  process.exit(2);
}

let caught = 0, missed = 0, stale = 0;
for (const m of mutations) {
  const original = readFileSync(m.file, "utf8");
  if (!original.includes(m.find)) {
    console.log(`  ?  ${m.name}  (pattern no longer matches the build — update this mutation)`);
    stale++;
    continue;
  }
  writeFileSync(m.file, original.replace(m.find, m.replace));
  const survived = runSuite();
  writeFileSync(m.file, original);
  if (survived) { console.log(`  SURVIVED  ${m.name}`); missed++; }
  else { console.log(`  caught    ${m.name}`); caught++; }
}

const scored = caught + missed;
console.log(`\nmutation score: ${caught}/${scored} caught` + (stale ? `  (${stale} stale pattern(s))` : ""));
if (missed > 0 || stale > 0) {
  console.error("\nA surviving mutation means the suite cannot detect that defect.");
  process.exit(1);
}
