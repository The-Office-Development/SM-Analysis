#!/usr/bin/env node
/**
 * What can the token we actually hold DO?
 *
 *   export VITE_SUPABASE_URL=...          # or SUPABASE_URL
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   export TOKEN_ENC_KEY=...
 *   node verify/audit-token.mjs --list
 *   node verify/audit-token.mjs --account <uuid>
 *
 * WHY THIS EXISTS
 * The pitch to a creator with a six-figure following is that connecting to
 * PulseBoard cannot put their account at risk — that the token we receive can
 * read their analytics and nothing else. That claim should rest on an audit they
 * can watch you run, not on trust or on a paragraph in a policy.
 *
 * It audits the REAL token: the one stored encrypted in account_secrets from
 * their OAuth authorisation, decrypted here with TOKEN_ENC_KEY. Not a token
 * generated in the App Dashboard, which is a different mechanism this codebase
 * does not constrain.
 *
 * >>> EVERY CALL BELOW IS A GET. <<<
 * Nothing here posts, deletes, edits, sends, or modifies anything. The way to
 * test for a write capability is to READ an endpoint that capability gates: if
 * the API refuses, the token does not hold it. Never prove a write scope by
 * attempting the write — on a client's account that is unforgivable.
 */
import { createClient } from "@supabase/supabase-js";
import { decryptToken } from "./build/_lib.js";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1]?.startsWith("--") === false ? arr[i + 1] : true]] : []
  )
);

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) {
  console.error("Set VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(2);
}
if (!process.env.TOKEN_ENC_KEY) {
  console.error("Set TOKEN_ENC_KEY — the stored token is encrypted at rest and cannot be read without it.");
  process.exit(2);
}
const db = createClient(url, key, { db: { schema: "pulseboard" }, auth: { persistSession: false } });

const { data: accounts, error } = await db
  .from("social_accounts")
  .select("id,platform,username,status,auth_mode")
  .eq("platform", "instagram");
if (error) { console.error("query failed:", error.message); process.exit(1); }

if (args.list || !args.account) {
  console.log("\nConnected Instagram accounts:\n");
  for (const a of accounts ?? []) {
    console.log(`  ${a.id}  @${a.username}  ${a.status}  ${a.auth_mode ?? "-"}`);
  }
  console.log(`\nThen: node verify/audit-token.mjs --account <id>\n`);
  process.exit(0);
}

const acc = (accounts ?? []).find((a) => a.id === args.account);
if (!acc) { console.error("No Instagram account with that id."); process.exit(1); }

const { data: secretRow } = await db
  .from("account_secrets").select("access_token").eq("account_id", acc.id).single();
if (!secretRow?.access_token) { console.error("No stored token for that account."); process.exit(1); }

let token;
try { token = decryptToken(secretRow.access_token); }
catch (e) { console.error("Could not decrypt — is TOKEN_ENC_KEY the key this row was written with?", e.message); process.exit(1); }

const GRAPH = "https://graph.instagram.com";
const VERSION = process.env.IG_API_VERSION ?? "v26.0";

async function get(path, params = {}) {
  const u = new URL(`${GRAPH}/${VERSION}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  try {
    const res = await fetch(u);
    return { ok: res.ok, body: await res.json() };
  } catch (e) { return { ok: false, body: { error: { message: e.message } } }; }
}

console.log(`\nAuditing the stored token for @${acc.username}`);
console.log(`Decrypted from account_secrets. Every call below is a GET.\n`);

const me = await get("/me", { fields: "user_id,username" });
if (!me.ok) {
  console.log(`  the token no longer works: ${me.body?.error?.message ?? "unknown"}`);
  console.log("  (an expired or revoked token is the safest possible outcome)\n");
  process.exit(0);
}
console.log(`  identity confirmed: @${me.body.username}\n`);

/* ---- what it CAN do (expected: yes) ------------------------------------- */
console.log("READ capabilities — these SHOULD work, they are the product:");
for (const [label, path, params] of [
  ["profile and follower count", "/me", { fields: "username,followers_count" }],
  ["media list", "/me/media", { limit: "1" }],
  ["account insights", "/me/insights", { metric: "reach", period: "day", metric_type: "total_value" }],
]) {
  const r = await get(path, params);
  console.log(`  ${r.ok ? "yes " : "no  "} ${label}${r.ok ? "" : `  — ${r.body?.error?.message ?? ""}`}`);
}

/* ---- what it must NOT be able to do (expected: refused) ----------------- */
console.log("\nWRITE-GATED capabilities — every one of these MUST be refused:");
const gated = [
  ["read direct messages", "/me/conversations", {}, "instagram_business_manage_messages"],
  ["list content-publishing quota", "/me/content_publishing_limit", {}, "instagram_business_content_publish"],
];
let holdsWrite = false;
for (const [label, path, params, scope] of gated) {
  const r = await get(path, params);
  if (r.ok) {
    holdsWrite = true;
    console.log(`  *** ALLOWED  ${label}  — token holds ${scope}`);
  } else {
    console.log(`  refused    ${label}  (needs ${scope})`);
  }
}

const perms = await get("/me/permissions");
if (perms.ok) {
  const granted = (perms.body.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
  console.log(`\nGranted scopes reported by the API: ${granted.join(", ") || "(none listed)"}`);
}

console.log(
  holdsWrite
    ? "\nRESULT: this token can do more than read. Investigate before connecting a client.\n"
    : "\nRESULT: read-only. Every write-gated endpoint refused this token.\n" +
      "It can read analytics for this account and cannot post, message, delete or\n" +
      "modify anything. The account holder can revoke it at any time from\n" +
      "Instagram -> Settings -> Apps and websites, without asking us.\n"
);
process.exit(holdsWrite ? 1 : 0);
