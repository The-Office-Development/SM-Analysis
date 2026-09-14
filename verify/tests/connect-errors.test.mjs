import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * The connect flow tells a person what went wrong, in words.
 *
 * Two defects, both found by testing onboarding rather than by review:
 *  - the START endpoints answered errors with a 302, which fetch follows into
 *    the Connections page's HTML, so every cause became "Could not start the
 *    connection";
 *  - the page printed the raw code: "Connection failed: linkedin_no_admin_page".
 */
process.env.OAUTH_STATE_SECRET = "test-state-secret-value";

test("a start endpoint answers an error as JSON the page can read, not a redirect", async () => {
  for (const name of ["oauth-linkedin", "oauth-instagram"]) {
    const { handler } = await import(`../build/${name}.js`);
    const res = await handler({ httpMethod: "POST", body: "{}", headers: {} });
    assert.equal(res.statusCode, 401, `${name}: not signed in is a 401`);
    assert.equal(JSON.parse(res.body).code, "not_signed_in", `${name}: with a code, not an HTML page`);
  }
});

test("every error code any connect endpoint can produce has a sentence for the user", () => {
  const src = readdirSync("netlify/functions").filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(`netlify/functions/${f}`, "utf8")).join("\n");
  const codes = new Set([
    ...[...src.matchAll(/backToApp\("error", "([a-z_]+)"/g)].map((m) => m[1]),
    ...[...src.matchAll(/startError\(\d+, "([a-z_]+)"\)/g)].map((m) => m[1]),
  ]);
  const messages = readFileSync("src/lib/connectErrors.ts", "utf8");
  assert.ok(codes.size >= 10, "found the codes");
  for (const c of codes) assert.ok(new RegExp(`\\b${c}:`).test(messages), `no user-facing sentence for "${c}"`);
});
