import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Every value the code writes into a constrained column must be allowed by the
 * database.
 *
 * LinkedIn shipped writing platform 'linkedin', provider 'linkedin' and auth_mode
 * 'linkedin_organization' into three columns whose check constraints allowed
 * none of them. Every test passed, because the fake database enforces no
 * constraints, and the first real connection would have been refused. Found only
 * by reading the live catalog (migration 0018).
 *
 * This reads the constraint definitions from schema.sql and the migrations in
 * order, keeps the LAST definition of each, and compares it with the values the
 * code writes.
 */
const sqlFiles = [
  "supabase/schema.sql",
  ...readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort().map((f) => `supabase/migrations/${f}`),
];

/** The allowed list from the last `check (<column> in (...))` for a table. */
function allowed(table, column) {
  let latest = null;
  for (const file of sqlFiles) {
    const sql = readFileSync(file, "utf8").replace(/--.*$/gm, "");
    // Inline in a create table for this table.
    const create = new RegExp(`create table if not exists pulseboard\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i").exec(sql);
    if (create) {
      const inline = new RegExp(`\\b${column}\\b[^,\\n]*check \\(${column} in \\(([^)]*)\\)\\)`, "i").exec(create[1]);
      if (inline) latest = inline[1];
    }
    // Named, via alter table ... add constraint ... check (col in (...)).
    const re = new RegExp(`alter table pulseboard\\.${table}\\s+add constraint \\w+\\s+check \\(${column} in \\(([^)]*)\\)\\)`, "gi");
    for (const m of sql.matchAll(re)) latest = m[1];
  }
  assert.ok(latest, `no check constraint found for ${table}.${column}`);
  return new Set([...latest.matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

const functions = readdirSync("netlify/functions").filter((f) => f.endsWith(".ts"))
  .map((f) => readFileSync(`netlify/functions/${f}`, "utf8")).join("\n");

test("every platform the product offers can be stored", () => {
  const platforms = allowed("social_accounts", "platform");
  const order = /PLATFORM_ORDER[^=]*=\s*\[([^\]]*)\]/.exec(readFileSync("src/lib/platformNames.ts", "utf8"))[1];
  for (const p of [...order.matchAll(/"([a-z]+)"/g)].map((m) => m[1])) {
    assert.ok(platforms.has(p), `social_accounts.platform refuses "${p}"`);
  }
});

test("every auth_mode the callbacks write can be stored", () => {
  const modes = allowed("social_accounts", "auth_mode");
  const written = new Set([...functions.matchAll(/auth_mode: "([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(written.size > 0, "found the auth_mode writes");
  for (const m of written) assert.ok(modes.has(m), `social_accounts.auth_mode refuses "${m}"`);
});

test("every identity provider the callbacks write can be stored", () => {
  const providers = allowed("provider_identities", "provider");
  const written = new Set([...functions.matchAll(/provider: "([a-z]+)",\s*\n\s*external_user_id/g)].map((m) => m[1]));
  assert.ok(written.has("instagram") && written.has("linkedin"), "found the identity upserts");
  for (const p of written) assert.ok(providers.has(p), `provider_identities.provider refuses "${p}"`);
});
