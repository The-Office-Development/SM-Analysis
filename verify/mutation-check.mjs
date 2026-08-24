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
  { name: "TikTok and Meta share one refresh window", file: TOKENS,
    find: "const window = id.provider === \"tiktok\" ? RENEW_WITHIN_MS_TIKTOK : RENEW_WITHIN_MS;",
    replace: "const window = RENEW_WITHIN_MS;" },
  { name: "signed_request signature not verified", file: DELETION,
    find: "if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected))\n        return null;",
    replace: "if (false)\n        return null;" },
  { name: "deletion acknowledges without deleting", file: DELETION,
    find: "await db.from(\"account_secrets\").delete().eq(\"account_id\", a.id);",
    replace: "" },
];

function runSuite() {
  try {
    execFileSync("node", ["--test", "verify/tests/sync.test.mjs", "verify/tests/security.test.mjs", "verify/tests/csv.test.mjs", "verify/tests/tokens.test.mjs", "verify/tests/deletion.test.mjs"], { stdio: "pipe" });
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
