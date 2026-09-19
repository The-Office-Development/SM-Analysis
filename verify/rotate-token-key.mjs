/**
 * Re-encrypt every stored platform token under a new TOKEN_ENC_KEY.
 *
 * The containment step for a leaked encryption key
 * (docs/security/INFORMATION-SECURITY-POLICY.md §8). Written 2026-09-19, when
 * the policy's incident plan was found to promise a rotation nothing could do.
 *
 * Procedure (no connection breaks at any point):
 *   1. Generate a key:  openssl rand -base64 32
 *   2. In Cloudflare, for the Pages app AND the cron Worker, set
 *        TOKEN_ENC_KEY          = the NEW key
 *        TOKEN_ENC_KEY_PREVIOUS = the OLD key
 *      and redeploy both. Reads now fall back to the old key; writes use the new.
 *   3. npm test (builds verify/build), then from the repo root:
 *        TOKEN_ENC_KEY=<new> TOKEN_ENC_KEY_PREVIOUS=<old> node verify/rotate-token-key.mjs
 *      Dry run: counts what would change. Add --apply to write.
 *   4. When it reports every token readable under the new key alone, delete
 *      TOKEN_ENC_KEY_PREVIOUS from both, and redeploy both.
 *
 * Keys are read from the environment only, never from a file or an argument,
 * so they do not land in shell history or in this repository. Supabase
 * credentials come from .env as for every other script here.
 */
import { readFileSync, existsSync } from "node:fs";

const apply = process.argv.includes("--apply");
if (!process.env.TOKEN_ENC_KEY || !process.env.TOKEN_ENC_KEY_PREVIOUS) {
  console.error("Set TOKEN_ENC_KEY (new) and TOKEN_ENC_KEY_PREVIOUS (old) in the environment.");
  process.exit(2);
}
if (process.env.TOKEN_ENC_KEY === process.env.TOKEN_ENC_KEY_PREVIOUS) {
  console.error("The new and previous keys are the same: nothing to rotate.");
  process.exit(2);
}
if (!existsSync("verify/build/_lib.js")) {
  console.error("verify/build is missing. Run `npm test` first, from the repo root.");
  process.exit(2);
}
const lib = await import("./build/_lib.js");

const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "pulseboard", "Content-Profile": "pulseboard", "content-type": "application/json" };
const get = async (path) => { const r = await fetch(`${url}/rest/v1/${path}`, { headers }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return r.json(); };
const patch = async (path, body) => { const r = await fetch(`${url}/rest/v1/${path}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(body) }); return r.ok ? null : `${r.status} ${await r.text()}`; };

const TABLES = [
  { table: "account_secrets", id: "account_id" },
  { table: "provider_identities", id: "id" },
];

let toChange = 0, changed = 0, failed = 0, unreadable = 0;
for (const { table, id } of TABLES) {
  const rows = await get(`${table}?select=${id},access_token,refresh_token`);
  for (const row of rows) {
    const update = {};
    for (const col of ["access_token", "refresh_token"]) {
      const v = row[col];
      if (!v || !lib.needsReencrypt(v)) continue;
      let plain;
      try { plain = lib.decryptToken(v); }            // current key, then previous
      catch { unreadable++; console.log(`  UNREADABLE with either key: ${table}.${col} for ${row[id]}`); continue; }
      update[col] = lib.encryptToken(plain);          // always the current (new) key
    }
    if (!Object.keys(update).length) continue;
    toChange++;
    if (!apply) continue;
    const err = await patch(`${table}?${id}=eq.${row[id]}`, update);
    if (err) { failed++; console.log(`  WRITE FAILED ${table} ${row[id]}: ${err}`); } else changed++;
  }
}

console.log(`${apply ? "Applied" : "Dry run"}: ${toChange} row(s) need re-encrypting` + (apply ? `, ${changed} rewritten, ${failed} failed` : "") + `, ${unreadable} unreadable.`);

if (apply) {
  // The proof step: every token must now open with the NEW key alone.
  delete process.env.TOKEN_ENC_KEY_PREVIOUS;
  let stillOld = 0;
  for (const { table, id } of TABLES) {
    for (const row of await get(`${table}?select=${id},access_token,refresh_token`)) {
      for (const col of ["access_token", "refresh_token"]) if (row[col] && lib.needsReencrypt(row[col])) stillOld++;
    }
  }
  console.log(stillOld === 0
    ? "Every stored token opens with the new key alone. Now remove TOKEN_ENC_KEY_PREVIOUS from the app and the Worker, and redeploy both."
    : `${stillOld} token(s) still need the previous key. Do NOT remove TOKEN_ENC_KEY_PREVIOUS yet.`);
  process.exit(failed || unreadable || stillOld ? 1 : 0);
}
process.exit(unreadable ? 1 : 0);
