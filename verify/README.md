# Verification

## `verify/tests/` — the suite that counts

```bash
npm test          # typecheck, build, run the suite, then the mutation check
```

Real assertions (`node:test` + `node:assert`), compared against a **known-correct
answer**. `tests/mock-graph.mjs` reports each day's true value, so a test can say
"the stored reach for this date must equal what the platform reported for it"
rather than merely "nothing threw". `tests/fake-supabase.mjs` actually applies
`.eq()` / `.gte()` / `.limit()` filters, so writing rows under another tenant's
`account_id` is observable rather than invisible.

What it locks down:

- the calendar day recovered from `end_time` at every UTC offset, including the
  Americas (offset <= 0), where every day used to be filed one day late
- the trailing re-fetch window, without which each day freezes at whatever few
  hours of activity existed when the cron ran
- a throttled or unavailable metric never being written as a fabricated zero
  over real stored data, and a throttled sync failing loudly instead
- provisional flagging of days that are still settling
- the OAuth state being worthless without the matching browser cookie (the
  account-takeover), plus tampered, truncated and expired states
- an account already owned by another tenant not being attachable
- token encryption at rest, including reading pre-existing plaintext rows
- error classification by the platform's numeric code, not by message text
- CSV formula injection from post captions
- TikTok's `error: {code: "ok"}` success envelope not being read as a failure

## `verify/mutation-check.mjs` — does the suite actually work?

```bash
npm run test:mutation
```

Injects real defects into the compiled output and requires each to be caught.
A surviving mutation means the suite cannot detect that class of defect, and the
check exits non-zero. This exists because the previous harness scored **0/13**:
thirteen injected defects all survived, eleven with byte-identical output. The
current score is **10/10**.

Add a mutation whenever you fix a defect the suite would not otherwise catch.

## `verify/proofs/` — demonstrations of the original defects

Standalone scripts that drive the real sync against mocks with known answers and
print what was stored next to what was true. Kept as documentation of the
defects described in `docs/DATA-INTEGRITY.md`; the regressions themselves are
now covered by `verify/tests/`.

## The older scripts (`ig-sync.test.mjs`, `oauth.test.mjs`, `run-all.sh`, …)

Exploratory printers, not tests. They contain **no assertions**, always exit 0,
and their runners `grep` for a `RESULT` line without inspecting it — which is why
they reported PASS throughout the period the sync was writing wrong numbers.
Useful for eyeballing a scenario by hand; never rely on them as a gate.
