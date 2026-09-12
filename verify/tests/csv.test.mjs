import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeCsvField } from "../build-lib/csv.js";

test("a caption that starts a formula is neutralised", () => {
  // Quoting alone does not stop Excel evaluating these.
  for (const payload of ['=1+1', '+1', '-1+1', '@SUM(A1)', '=HYPERLINK("http://evil","clickme")']) {
    const out = escapeCsvField(payload);
    assert.ok(out.startsWith(`"'`), `not neutralised: ${payload} -> ${out}`);
  }
});

test("ordinary captions are untouched apart from quoting", () => {
  assert.equal(escapeCsvField("Summer campaign"), '"Summer campaign"');
  assert.equal(escapeCsvField('He said "hi"'), '"He said ""hi"""');
  assert.equal(escapeCsvField("2 - 3 tips"), '"2 - 3 tips"');
});

/* ---- the exported file --------------------------------------------------- */

import { buildCsv } from "../build-lib/csvReport.js";

/**
 * This file leaves the building.
 *
 * It is what a creator forwards to a sponsor, and the only part of the product
 * read without the interface around it to explain anything. A wrong cell here is
 * not a rendering bug; it is a figure in somebody's commercial negotiation.
 */

const day = (d, extra) => ({
  account_id: "a", platform: "instagram", date: `2026-08-${String(d).padStart(2, "0")}`,
  followers: 1000, reach: 500, impressions: null, views: 400, engagements: 40,
  follows: null, unfollows: null, reach_followers: null, reach_non_followers: null,
  provisional: false, ...extra,
});

const post = (i, extra) => ({
  id: `p${i}`, account_id: "a", platform: "instagram", external_id: `x${i}`,
  title: `Post ${i}`, media_type: "Reel", permalink: "https://example.test/p",
  published_at: "2026-08-04T09:00:00Z",
  views: 100, likes: 10, comments: 1, shares: 1, saves: 1,
  reach: 90, avg_watch_seconds: null, retention_pct: null, checked_at: null, ...extra,
});

const input = (over = {}) => ({
  range: 30, scope: "all", accounts: [{ username: "creator" }],
  metrics: [day(1), day(2)], content: [post(1)],
  platformName: () => "Instagram", ...over,
});

test("an unreported metric is a BLANK cell, never the word null and never 0", () => {
  // The previous version interpolated the value straight into the row, so every
  // unreported metric arrived in the client's spreadsheet as the text "null":
  // it breaks SUM, sorts as text, and reads as a broken product to a sponsor.
  const csv = buildCsv(input({
    metrics: [day(1, { reach: null, views: null, engagements: null, followers: null })],
    content: [post(1, { views: null, likes: null, reach: null })],
  }));
  assert.ok(!/null/i.test(csv), "the string 'null' must never appear in an exported cell");
  assert.ok(!/,0,/.test(csv.split("DAILY")[1] ?? ""), "and an unknown must not become a zero");
});

test("a caption that is a formula is still neutralised inside the file", () => {
  const csv = buildCsv(input({ content: [post(1, { title: '=HYPERLINK("http://evil","x")' })] }));
  assert.ok(csv.includes(`"'=HYPERLINK`), "captions reach the sponsor's spreadsheet; they are hostile input");
});

test("the file states where the numbers came from and what a blank means", () => {
  // Read without the app around it, the file has to carry its own context, or a
  // sponsor comparing against a screenshot concludes somebody is lying.
  const csv = buildCsv(input());
  /*
   * This asserted the literal string "Instagram's official API". The claim it
   * was really making is that the file names its source, and it does — but an
   * all-platforms export now says "the platforms' official APIs", because
   * attributing a four-platform report to Instagram alone was false. The scoped
   * wording is covered by its own test below.
   */
  assert.ok(/official API/.test(csv), "the file must name where the figures came from");
  assert.ok(/does not mean zero/.test(csv), "a blank must be explained inside the file itself");
  assert.ok(/Asia\/Amman/.test(csv), "and the calendar the dates are on must be stated");
});

test("the file says what produced it and when", () => {
  // The CSV is the format most likely to be opened far from where it came from,
  // so it is the one that most needs to identify itself. It is also the only
  // route back to a sponsor who has never heard of this product.
  const csv = buildCsv(input());
  assert.ok(/Prepared with PulseBoard/.test(csv));
  assert.ok(/The Office Development/.test(csv), "the footer names the entity that produced the software");
  assert.ok(/Generated 20\d\d-\d\d-\d\d \d\d:\d\d/.test(csv), "the generation time must be stated");
});

test("an account named the same on two platforms is not repeated", () => {
  // Joining unfiltered put "northwind / northwind / northwind" at the top of a
  // report going to a sponsor. Repetition in the first line somebody reads looks
  // like a bug, whatever the figures underneath say.
  const csv = buildCsv(input({
    accounts: [{ username: "northwind" }, { username: "northwind" }, { display_name: "Northwind Co" }],
  }));
  assert.ok(!/northwind \/ northwind/.test(csv), "duplicate account names must collapse");
  assert.ok(/northwind \/ Northwind Co/.test(csv), "genuinely different names are still both shown");
});

test("the export never sells itself at the platform's expense", () => {
  // A CSV forwarded to a sponsor should read as evidence, not as a pitch. The
  // figures make the case; telling the reader what another product lacks does
  // not, and it invites the reader to go and check the comparison.
  const csv = buildCsv(input()).toLowerCase();
  for (const phrase of [
    "does not appear", "none of the following appears", "no native tool",
    "only shows", "beyond instagram", "unlike instagram", "nowhere else",
  ]) {
    assert.ok(!csv.includes(phrase), `sales copy in the export: "${phrase}"`);
  }
});

test("every section a reader needs is present", () => {
  const csv = buildCsv(input());
  for (const heading of ["SUMMARY", "DAILY", "POSTS", "WHAT THESE MEAN"]) {
    assert.ok(csv.includes(heading), `missing section: ${heading}`);
  }
});

test("the daily section carries one row per stored day, oldest first", () => {
  const csv = buildCsv(input({ metrics: [day(3), day(1), day(2)] }));
  const block = csv.split("DAILY")[1].split("POSTS")[0];
  const dates = [...block.matchAll(/"(2026-08-\d\d)"/g)].map((m) => m[1]);
  assert.deepEqual(dates, ["2026-08-01", "2026-08-02", "2026-08-03"]);
});

test("it opens correctly on the machine it is sent to", () => {
  const csv = buildCsv(input());
  // Without a BOM Excel reads UTF-8 as the local codepage and every Arabic
  // caption on these accounts becomes mojibake.
  assert.equal(csv.charCodeAt(0), 0xfeff, "a UTF-8 byte-order mark must lead the file");
  assert.ok(csv.includes("\r\n"), "Excel expects CRLF between rows");
});

test("a rate is not invented from a denominator that does not exist", () => {
  const csv = buildCsv(input({
    content: [post(1, { reach: null, likes: 5, comments: null, shares: null, saves: null })],
  }));
  const posts = csv.split("POSTS")[1];
  assert.ok(!/Infinity|NaN/.test(posts), `a missing denominator leaked into the file: ${posts}`);

  // And, the failure that actually reaches a sponsor: a rate of 0.00 where none
  // was measurable. "0.00% engagement" on a post whose reach Instagram simply
  // never reported is a confident, damaging, invented number — the same defect
  // as a fabricated zero in the sync, one export further downstream.
  const header = posts.split("\r\n").find((l) => l.includes("Engagement rate"));
  const row = posts.split("\r\n").find((l) => l.includes("Post 1"));
  const col = header.split(",").findIndex((h) => h.includes("Engagement rate"));
  assert.equal(row.split(",")[col], "",
    `an unmeasurable rate must be blank, got "${row.split(",")[col]}"`);
});

/* ---- whose report is this? ----------------------------------------------- */

test("a scoped export names only the account it is about", async () => {
  /*
   * The identity line is what a sponsor reads to know whose numbers these are,
   * and it listed every connected handle regardless of scope — so a report
   * headed "Scope: LinkedIn" was also headed with the Instagram and TikTok
   * handles, two accounts the document says nothing about.
   */
  const accounts = [
    { username: "northwind.co", platform: "facebook" },
    { username: "northwind", platform: "instagram" },
    { username: "northwind-co", platform: "linkedin" },
  ];
  const base = {
    range: 30, accounts, connectedPlatforms: ["facebook", "instagram", "linkedin"],
    content: [], audience: [], platformName: (p) => p,
    metrics: [day(1, { platform: "linkedin" }), day(2, { platform: "linkedin" })],
  };

  const scoped = buildCsv({ ...base, scope: "linkedin" });
  assert.ok(scoped.includes("northwind-co"), "the LinkedIn handle must be named");
  assert.ok(!scoped.includes('"northwind.co /'), "the Facebook handle must not be");
  assert.ok(!/northwind"/.test(scoped.split("\n").find((l) => l.startsWith('"Account"')) ?? ""),
    "nor the Instagram one");

  // Unscoped still names them all: that report really is about all of them.
  const all = buildCsv({ ...base, scope: "all" });
  const line = all.split("\n").find((l) => l.startsWith('"Account"')) ?? "";
  for (const h of ["northwind.co", "northwind", "northwind-co"]) {
    assert.ok(line.includes(h), `all-platforms report names ${h}`);
  }
});

test("a scoped export never names a platform it is not about", async () => {
  /*
   * The exports were written when Instagram was the only platform that mattered
   * and said "Instagram" in eighteen places — "Not reported by Instagram",
   * "When these numbers were last taken from Instagram", and at the foot of
   * every sheet "Prepared by PulseBoard from Instagram's official API". In a
   * file scoped to a LinkedIn Company Page every one of those is false, and this
   * is the document that goes to a sponsor.
   */
  const csv = buildCsv({
    range: 30, scope: "linkedin", connectedPlatforms: ["instagram", "linkedin"],
    accounts: [{ username: "northwind-co", platform: "linkedin" }],
    metrics: [day(1, { platform: "linkedin", views: null, follows: null, unfollows: null }),
              day(2, { platform: "linkedin", views: null, follows: null, unfollows: null })],
    content: [], audience: [], platformName: (p) => (p === "linkedin" ? "LinkedIn" : "Instagram"),
  });

  assert.ok(!csv.includes("Instagram"),
    `a LinkedIn export must not mention Instagram:\n${csv.split("\n").filter((l) => l.includes("Instagram")).join("\n")}`);
  assert.ok(csv.includes("LinkedIn"), "and it must name the platform it IS about");
});

test("an all-platforms export does not claim to come from one platform", async () => {
  const csv = buildCsv({
    range: 30, scope: "all", connectedPlatforms: ["instagram", "linkedin"],
    accounts: [{ username: "a", platform: "instagram" }],
    metrics: [day(1), day(2)], content: [], audience: [],
    platformName: (p) => (p === "linkedin" ? "LinkedIn" : "Instagram"),
  });
  // "the platforms' official APIs", not one named platform's.
  assert.ok(!/from Instagram's official API/.test(csv),
    "an all-platforms report must not attribute itself to a single platform");
});
