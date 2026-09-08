import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildXlsx, S } from "../build-lib/xlsx.js";
import { buildWorkbook } from "../build-lib/xlsxReport.js";

/**
 * The workbook is written byte by byte here rather than by a library, so the
 * container itself needs testing and not only its contents. A malformed ZIP or a
 * bad CRC does not degrade: the file simply refuses to open, in front of whoever
 * the client sent it to.
 */

const day = (d, extra) => ({
  account_id: "a", platform: "instagram", date: `2026-08-${String(d).padStart(2, "0")}`,
  followers: 1000 + d, reach: 500, impressions: null, views: 400, engagements: 40,
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

/** Unpack with the system unzip, which is a genuinely independent reader. */
function unpack(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "pb-xlsx-"));
  const file = join(dir, "book.xlsx");
  writeFileSync(file, Buffer.from(bytes));
  // -t verifies every CRC. A wrong one fails here rather than in Excel.
  execFileSync("unzip", ["-t", file], { stdio: "pipe" });
  execFileSync("unzip", ["-o", "-q", file, "-d", join(dir, "out")], { stdio: "pipe" });
  return join(dir, "out");
}

const read = (dir, rel) => readFileSync(join(dir, rel), "utf8");

test("the archive is valid and every CRC checks out", () => {
  // If this throws, the file opens nowhere. It is the one failure the person
  // receiving it cannot work around.
  const dir = unpack(buildWorkbook(input()));
  assert.ok(readdirSync(dir).length > 0);
});

test("the parts a reader requires are all present", () => {
  const dir = unpack(buildWorkbook(input()));
  for (const part of [
    "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml",
  ]) {
    assert.ok(read(dir, part).length > 0, `missing part: ${part}`);
  }
});

test("an unknown figure is an EMPTY CELL, not a zero and not text", () => {
  const dir = unpack(buildWorkbook(input({
    metrics: [day(1, { reach: null, views: null, engagements: null, followers: null })],
    content: [post(1, { views: null, reach: null, likes: null })],
  })));
  const daily = read(dir, "xl/worksheets/sheet3.xml");
  assert.ok(!/null/i.test(daily), "the text 'null' must never reach a cell");
  // An empty cell is <c .../> with no <v>. A zero would be <v>0</v>.
  assert.ok(!/<v>0<\/v>/.test(daily), "an unreported metric must not become a zero");
});

test("captions are escaped, so one post cannot make the file unopenable", () => {
  const dir = unpack(buildWorkbook(input({
    content: [post(1, { title: 'Ampersand & <tag> "quoted"' })],
  })));
  const posts = read(dir, "xl/worksheets/sheet4.xml");
  assert.ok(posts.includes("Ampersand &amp; &lt;tag&gt;"), "XML metacharacters must be escaped");
});

test("a control character in a caption is stripped rather than breaking the file", () => {
  // XML 1.0 forbids these, and a reader rejects the WHOLE document rather than
  // the cell, so one stray byte in one caption would lose the entire report.
  const dirty = "Before" + String.fromCharCode(7) + "after";
  const dir = unpack(buildWorkbook(input({ content: [post(1, { title: dirty })] })));
  const posts = read(dir, "xl/worksheets/sheet4.xml");
  assert.ok(posts.includes("Beforeafter"), "the caption survives without the control byte");
  assert.ok(!posts.includes(String.fromCharCode(7)), "and the byte itself is gone");
});

test("Arabic survives the round trip", () => {
  const dir = unpack(buildWorkbook(input({ content: [post(1, { title: "مقطع من ورشة العمل" })] })));
  assert.ok(read(dir, "xl/worksheets/sheet4.xml").includes("مقطع من ورشة العمل"));
});

test("the analysis Instagram does not do has its own sheet", () => {
  const dir = unpack(buildWorkbook(input()));
  const wb = read(dir, "xl/workbook.xml");
  for (const name of ["Summary", "Beyond Instagram", "Daily", "Posts", "Notes"]) {
    assert.ok(wb.includes(`name="${name}"`), `missing sheet: ${name}`);
  }
});

test("a thin account gets a stated absence, never a confident ranking", () => {
  // One post cannot support a timing recommendation. The sheet must SAY so
  // rather than omit the section: an omission reads as "no pattern", a stated
  // absence reads as "not enough evidence".
  const sheet = read(unpack(buildWorkbook(input())), "xl/worksheets/sheet2.xml");
  assert.ok(/could be measured/.test(sheet),
    "the workbook must say why the timing analysis is missing");
});

test("a cell keeps the style it was given", () => {
  const dir = unpack(buildXlsx([{
    name: "S", cols: [10],
    rows: [[{ v: "Head", s: S.HEADER }], [{ v: 42, s: S.NUMBER }]],
    freeze: 1,
  }]));
  const xml = read(dir, "xl/worksheets/sheet1.xml");
  assert.ok(xml.includes(`s="${S.HEADER}"`), "the header style must survive to the file");
  assert.ok(xml.includes(`s="${S.NUMBER}"`));
  assert.ok(xml.includes('state="frozen"'), "the header row must stay visible while scrolling");
});

test("a sheet name a reader would reject is repaired, not passed through", () => {
  const dir = unpack(buildXlsx([{ name: "A/B:C*D?E[F]", cols: [10], rows: [["x"]] }]));
  const wb = read(dir, "xl/workbook.xml");
  for (const bad of ["/", ":", "*", "?", "[", "]"]) {
    assert.ok(!wb.includes(`name="A${bad}`), `illegal character survived: ${bad}`);
  }
});
