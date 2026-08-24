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
