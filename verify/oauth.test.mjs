/**
 * verify/oauth.test.mjs
 *
 * Runs the REAL, UNMODIFIED netlify/functions/oauth-meta-callback.ts (compiled to
 * verify/build-oauth/) against a faked *network boundary* only.
 *
 * What is faked, and nothing else:
 *   - globalThis.fetch, which serves
 *       * https://graph.facebook.com/v19.0/oauth/access_token   (short + long lived)
 *       * https://graph.facebook.com/v19.0/me/accounts
 *       * https://<project>.supabase.co/rest/v1/<table>          (PostgREST)
 *
 * NOTE ON THE SUPABASE STUB: we do NOT shim @supabase/supabase-js. _lib.admin()
 * builds a REAL supabase-js client (real schema handling, real PostgREST query
 * builder, real Prefer/Accept headers) and we intercept at the HTTP layer, because
 * supabase-js's resolveFetch() closes over `globalThis.fetch` and calls it lazily:
 *     resolveFetch = (custom) => custom ? ... : (...args) => fetch(...args)
 * so replacing globalThis.fetch before/after createClient() both work. This
 * exercises _lib.saveAccount() end to end (upsert -> onConflict -> .select("id")
 * -> .single()) instead of trusting a hand-written fake of the query builder.
 *
 * Usage:  node verify/oauth.test.mjs            (all scenarios)
 *         node verify/oauth.test.mjs happy      (one scenario by name)
 */

import crypto from "node:crypto";

/* ========================================================================== *
 * 1. ENV — must be set BEFORE importing the compiled modules, because
 *    _lib.ts captures process.env into `export const env` at module load.
 * ========================================================================== */
const SUPA_URL = "https://testproj.supabase.co";
const SUPA_HOST = new URL(SUPA_URL).hostname;
const STATE_SECRET = "test-state-secret-0123456789";

process.env.META_APP_ID = "1122334455667788";
process.env.META_APP_SECRET = "meta-app-secret-for-tests";
process.env.OAUTH_STATE_SECRET = STATE_SECRET;
process.env.VITE_SITE_URL = "https://pulseboard.test";
process.env.VITE_SUPABASE_URL = SUPA_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
// make sure the `?? process.env.X` fallbacks in _lib.ts cannot mask a mistake
delete process.env.SUPABASE_URL;
delete process.env.URL;

/* ========================================================================== *
 * 2. NETWORK MOCK
 * ========================================================================== */
const TEST_UID = "11111111-2222-3333-4444-555555555555";

const PAGE_WITH_IG = {
  id: "61592170606417",
  name: "Noor",
  access_token: "PAGE_TOKEN",
  instagram_business_account: {
    id: "17841400000000000",
    username: "noor_nono113",
    profile_picture_url: "https://scontent.cdninstagram.com/v/noor_avatar.jpg",
  },
};

/** Mutable per-scenario knobs read by the mock. */
const scenario = {
  pages: [PAGE_WITH_IG],
  shortToken: { access_token: "SHORT", token_type: "bearer" },
  longToken: { access_token: "LONG", token_type: "bearer", expires_in: 5183944 },
};

/** Everything the code under test did on the wire. */
let graphCalls = [];
let restCalls = [];
let otherCalls = [];

function resetRecorders() {
  graphCalls = [];
  restCalls = [];
  otherCalls = [];
}

const jsonRes = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function handleGraph(u) {
  const qs = Object.fromEntries(u.searchParams.entries());
  const call = { path: u.pathname, qs };
  graphCalls.push(call);

  if (u.pathname === "/v19.0/oauth/access_token") {
    if (qs.grant_type === "fb_exchange_token") {
      call.kind = "long-lived-exchange";
      return jsonRes(scenario.longToken);
    }
    call.kind = "code-exchange";
    return jsonRes(scenario.shortToken);
  }

  if (u.pathname === "/v19.0/me/accounts") {
    call.kind = "me/accounts";
    return jsonRes({ data: scenario.pages });
  }

  call.kind = "UNEXPECTED";
  return jsonRes({ error: { message: "unexpected graph path " + u.pathname } }, 400);
}

/** Deterministic surrogate PKs so we can tell social_accounts rows apart. */
let pkCounter = 0;
const pkFor = new Map();
function fakePk(table, body) {
  const key = `${table}|${body.platform ?? ""}|${body.external_id ?? ""}`;
  if (!pkFor.has(key)) pkFor.set(key, `acc-${String(++pkCounter).padStart(4, "0")}`);
  return pkFor.get(key);
}

async function handleSupabaseRest(u, method, init) {
  const table = u.pathname.replace(/^\/rest\/v1\//, "");
  const hdrs = new Headers(init.headers ?? {});
  const prefer = hdrs.get("Prefer") ?? "";
  const accept = hdrs.get("Accept") ?? "";
  let body = null;
  try {
    body = init.body ? JSON.parse(init.body) : null;
  } catch {
    body = String(init.body);
  }
  const rows = Array.isArray(body) ? body : body == null ? [] : [body];

  const call = {
    method,
    table,
    schema: hdrs.get("Content-Profile") ?? hdrs.get("Accept-Profile") ?? null,
    onConflict: u.searchParams.get("on_conflict"),
    select: u.searchParams.get("select"),
    prefer,
    apikey: hdrs.get("apikey"),
    rows,
  };
  restCalls.push(call);

  const returned = rows.map((r) => ({ id: fakePk(table, r), ...r }));
  call.returned = returned;

  // Mimic PostgREST: representation only when Prefer says so; single-object shape
  // only when the client asked for it via Accept (that's what .single() sets).
  if (!prefer.includes("return=representation")) {
    return new Response(null, { status: 201, headers: { "content-range": "0-0/*" } });
  }
  if (accept.includes("application/vnd.pgrst.object+json")) {
    return jsonRes(returned[0] ?? null, 200);
  }
  return jsonRes(returned, 201);
}

globalThis.fetch = async (input, init = {}) => {
  const href =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init.method ?? "GET").toUpperCase();
  const u = new URL(href);

  if (u.hostname === "graph.facebook.com") return handleGraph(u, method, init);
  if (u.hostname === SUPA_HOST) return handleSupabaseRest(u, method, init);

  otherCalls.push({ method, href });
  throw new Error(`HARNESS: unexpected outbound request ${method} ${href}`);
};

/* ========================================================================== *
 * 3. IMPORT THE REAL COMPILED CODE (after env + fetch are in place)
 * ========================================================================== */
const lib = await import("./build-oauth/_lib.js");
const { handler } = await import("./build-oauth/oauth-meta-callback.js");
const { signState, verifyState, env } = lib;

/* ========================================================================== *
 * 4. STATE HELPERS (real signState; hand-rolled variants for negative tests)
 * ========================================================================== */
const validState = () => signState({ uid: TEST_UID, provider: "meta" });

/** Re-implements signState but lets us backdate `t` (to exercise the 15-min TTL). */
function signStateAt(payload, tMillis) {
  const bodyB64 = Buffer.from(JSON.stringify({ ...payload, t: tMillis })).toString("base64url");
  const sig = crypto.createHmac("sha256", STATE_SECRET).update(bodyB64).digest("base64url");
  return `${bodyB64}.${sig}`;
}

function tamperSameLength(state) {
  const [body, sig] = state.split(".");
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  return `${body}.${flipped}`;
}
function tamperDifferentLength(state) {
  const [body, sig] = state.split(".");
  return `${body}.${sig.slice(0, -1)}`; // 42 chars instead of 43
}

/* ========================================================================== *
 * 5. SCENARIOS
 * ========================================================================== */
const PAGE_NO_IG = { id: "777000111", name: "Side Page", access_token: "PAGE_TOKEN_2" };

const scenarios = {
  happy: {
    title: "valid state + 1 Page with linked IG business account",
    pages: [PAGE_WITH_IG],
    query: () => ({ code: "CODE", state: validState() }),
    expect: "302 -> /connections?connected=meta ; facebook row + instagram row",
  },
  "page-without-ig": {
    title: "valid state + 1 Page, NO linked IG",
    pages: [PAGE_NO_IG],
    query: () => ({ code: "CODE", state: validState() }),
    expect: "302 -> /connections?connected=facebook ; facebook row only",
  },
  "two-pages-no-ig": {
    title: "2 Pages, neither has IG (connected===2)",
    pages: [PAGE_NO_IG, { id: "888000222", name: "Other Page", access_token: "PAGE_TOKEN_3" }],
    query: () => ({ code: "CODE", state: validState() }),
    expect: "?connected=meta even though zero Instagram accounts were linked",
  },
  "no-pages": {
    title: "FAILURE PATH: /me/accounts returns { data: [] } (IG not linked to a Page)",
    pages: [],
    query: () => ({ code: "CODE", state: validState() }),
    expect: "302 -> /connections?error=no_pages_found ; no DB writes",
  },
  "bad-state-same-length": {
    title: "tampered signature, SAME length as the real one",
    pages: [PAGE_WITH_IG],
    query: () => ({ code: "CODE", state: tamperSameLength(validState()) }),
    expect: "302 -> /connections?error=bad_state",
  },
  "bad-state-diff-length": {
    title: "tampered signature, DIFFERENT length (1 char shorter)",
    pages: [PAGE_WITH_IG],
    query: () => ({ code: "CODE", state: tamperDifferentLength(validState()) }),
    expect: "302 -> /connections?error=bad_state  <-- probes timingSafeEqual",
  },
  "bad-state-empty-sig": {
    title: "state with an empty signature ('<body>.')",
    pages: [PAGE_WITH_IG],
    query: () => ({ code: "CODE", state: validState().split(".")[0] + "." }),
    expect: "302 -> /connections?error=bad_state",
  },
  "bad-state-no-dot": {
    title: "state with no '.' separator at all",
    pages: [PAGE_WITH_IG],
    query: () => ({ code: "CODE", state: "totally-bogus" }),
    expect: "302 -> /connections?error=bad_state",
  },
  "expired-state": {
    title: "correctly signed state, but 16 minutes old (TTL is 15 min)",
    pages: [PAGE_WITH_IG],
    query: () => ({
      code: "CODE",
      state: signStateAt({ uid: TEST_UID, provider: "meta" }, Date.now() - 16 * 60 * 1000),
    }),
    expect: "302 -> /connections?error=bad_state",
  },
  "missing-code": {
    title: "valid state but no ?code",
    pages: [PAGE_WITH_IG],
    query: () => ({ state: validState() }),
    expect: "302 -> /connections?error=missing_code",
  },
  "provider-error": {
    title: "user hit Cancel: ?error=access_denied",
    pages: [PAGE_WITH_IG],
    query: () => ({
      error: "access_denied",
      error_description: "Permissions error",
      state: validState(),
    }),
    expect: "302 -> /connections?error=Permissions%20error",
  },
};

/* ========================================================================== *
 * 6. RUNNER
 * ========================================================================== */
function locOf(res) {
  return res?.headers?.Location ?? res?.headers?.location ?? "(no Location header)";
}

async function run(name) {
  const s = scenarios[name];
  resetRecorders();
  scenario.pages = s.pages;

  console.log("\n" + "=".repeat(78));
  console.log(`SCENARIO ${name}: ${s.title}`);
  console.log(`  expect: ${s.expect}`);
  console.log("-".repeat(78));

  const q = s.query();
  console.log("  query:", JSON.stringify(q));

  let res = null;
  let threw = null;
  try {
    res = await handler({ queryStringParameters: q }, {}, () => {});
  } catch (e) {
    threw = e;
  }

  if (threw) {
    console.log(`  !! HANDLER THREW (uncaught, no HTTP response produced)`);
    console.log(`     ${threw.constructor.name}: ${threw.message}`);
    console.log(`     code=${threw.code ?? "(none)"}`);
  } else {
    console.log(`  status  : ${res.statusCode}`);
    console.log(`  Location: ${locOf(res)}`);
  }

  console.log(`  graph calls (${graphCalls.length}):`);
  for (const c of graphCalls) {
    const shown = { ...c.qs };
    if (shown.client_secret) shown.client_secret = "<redacted>";
    console.log(`    - ${c.kind.padEnd(20)} ${c.path}  ${JSON.stringify(shown)}`);
  }

  console.log(`  supabase REST calls (${restCalls.length}):`);
  for (const c of restCalls) {
    console.log(
      `    - ${c.method} ${c.table} schema=${c.schema} on_conflict=${c.onConflict} select=${c.select} prefer="${c.prefer}"`
    );
    for (const r of c.rows) console.log(`        row: ${JSON.stringify(r)}`);
  }
  if (otherCalls.length) console.log(`  UNEXPECTED calls:`, otherCalls);

  // ---- assertions / derived facts -----------------------------------------
  const accRows = restCalls.filter((c) => c.table === "social_accounts").flatMap((c) => c.rows);
  const secRows = restCalls.filter((c) => c.table === "account_secrets").flatMap((c) => c.rows);
  const fbRow = accRows.find((r) => r.platform === "facebook");
  const igRow = accRows.find((r) => r.platform === "instagram");
  const igSecret = igRow
    ? secRows.find(
        (r) =>
          r.account_id ===
          restCalls
            .filter((c) => c.table === "social_accounts")
            .flatMap((c) => c.returned)
            .find((x) => x.platform === "instagram")?.id
      )
    : undefined;

  const facts = [];
  if (!threw) facts.push(`location=${locOf(res)}`);
  facts.push(`fb_row=${fbRow ? "YES" : "no"}`, `ig_row=${igRow ? "YES" : "no"}`);
  if (igSecret) {
    facts.push(`ig_token=${JSON.stringify(igSecret.access_token)}`);
    facts.push(`ig_extra=${JSON.stringify(igSecret.extra)}`);
  }
  const meAccounts = graphCalls.find((c) => c.kind === "me/accounts");
  if (meAccounts) facts.push(`me/accounts_token=${meAccounts.qs.access_token}`);

  console.log(
    `RESULT ${name}: ${threw ? `THREW ${threw.constructor.name}: ${threw.message}` : "ok"} | ${facts.join(" | ")}`
  );

  return { name, res, threw, restCalls: [...restCalls], graphCalls: [...graphCalls] };
}

/* ========================================================================== *
 * 7. DIRECT verifyState() PROBES (unit-level, isolates the crypto bug)
 * ========================================================================== */
function probeVerifyState() {
  console.log("\n" + "=".repeat(78));
  console.log("DIRECT PROBES of _lib.verifyState() (bypassing the handler)");
  console.log("-".repeat(78));
  console.log(`  env.STATE_SECRET  = ${JSON.stringify(env.STATE_SECRET)}`);
  console.log(`  env.SITE_URL      = ${JSON.stringify(env.SITE_URL)}`);
  console.log(`  env.SUPABASE_URL  = ${JSON.stringify(env.SUPABASE_URL)}`);
  console.log(`  env.META_APP_ID   = ${JSON.stringify(env.META_APP_ID)}`);

  const good = validState();
  console.log(`  signState() ->     ${good}`);

  const cases = [
    ["valid (signState output)", good],
    ["tampered, same length", tamperSameLength(good)],
    ["tampered, shorter by 1", tamperDifferentLength(good)],
    ["empty signature", good.split(".")[0] + "."],
    ["no dot", "no-dot-here"],
    ["expired (16 min old)", signStateAt({ uid: TEST_UID, provider: "meta" }, Date.now() - 16 * 60 * 1000)],
    ["undefined", undefined],
  ];
  for (const [label, st] of cases) {
    let out, err;
    try {
      out = verifyState(st);
    } catch (e) {
      err = e;
    }
    console.log(
      `  ${label.padEnd(26)} -> ${err ? `THREW ${err.constructor.name}: ${err.message}` : JSON.stringify(out)}`
    );
  }
}

/* ========================================================================== */
const only = process.argv[2];
probeVerifyState();
const names = only ? [only] : Object.keys(scenarios);
for (const n of names) {
  if (!scenarios[n]) throw new Error(`unknown scenario "${n}"`);
  await run(n);
}
console.log("\ndone.");
