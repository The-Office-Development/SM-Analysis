import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * /.well-known/security.txt, Meta DPA question 3.1-21 ("a publicly available
 * way to report vulnerabilities"). Measured absent on 2026-09-19: the URL
 * answered 200, but with the app's HTML, because the SPA fallback serves every
 * unknown path. RFC 9116 makes an expired file invalid, so this fails a month
 * before it lapses rather than on the day.
 */
const txt = readFileSync("public/.well-known/security.txt", "utf8");
const field = (name) => txt.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();

test("security.txt names a contact", () => {
  assert.match(field("Contact") ?? "", /^(mailto:|https:\/\/)/);
});

test("security.txt has not expired, and will not within a month", () => {
  const exp = Date.parse(field("Expires") ?? "");
  assert.ok(Number.isFinite(exp), "Expires is required by RFC 9116");
  assert.ok(exp - Date.now() > 30 * 86_400_000, `security.txt expires ${field("Expires")}: renew it`);
  assert.ok(exp - Date.now() < 366 * 86_400_000, "RFC 9116 recommends an expiry under a year away");
});
