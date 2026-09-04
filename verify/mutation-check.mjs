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
  { name: "unset account timezone silently inherits the platform's boundary", file: SYNC,
    find: "  return (typeof m === \"number\" && Number.isFinite(m) ? m : DEFAULT_TZ_OFFSET_MINUTES) / 60;",
    replace: "  return (typeof m === \"number\" && Number.isFinite(m) ? m : 0) / 60;" },
];

function runSuite() {
  try {
    execFileSync("node", ["--test", "verify/tests/sync.test.mjs", "verify/tests/security.test.mjs", "verify/tests/csv.test.mjs", "verify/tests/tokens.test.mjs", "verify/tests/deletion.test.mjs", "verify/tests/instagram-login.test.mjs"], { stdio: "pipe" });
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
