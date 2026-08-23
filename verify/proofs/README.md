# Data-integrity proofs

Each script runs the **real, unmodified** `syncAccount()` (and, for p2, the real frontend
`bestTimes()`) against a mock platform API in which the correct answer is known in advance, then
prints what the code actually stored next to what was true. They are demonstrations of the defects
described in [`docs/DATA-INTEGRITY.md`](../../docs/DATA-INTEGRITY.md), and they should become
regression tests once those defects are fixed.

```bash
bash verify/run-all.sh              # once, to produce verify/build/ and verify/build-fe/
node verify/proofs/p1-date-shift.mjs
node verify/proofs/p2-best-time.mjs
node verify/proofs/p3-frozen-days.mjs
```

- **p1-date-shift** — plants a known reach value on each calendar day for accounts in several
  timezones, then reports which stored rows carry the wrong day's number.
- **p2-best-time** — plants an audience that peaks Saturday 20:00 local, then reports what the
  Planner advises.
- **p3-frozen-days** — replicates `backfillStart()` across four consecutive cron runs and reports
  how many times each day's value is written.

p1 and p2 model Meta's documented `end_time` convention (end of period = local midnight at the
start of the following day, rendered in `+0000`). **Validate that assumption against one real
Graph API response before acting on p1/p2** — the defect is real if and only if the convention
holds as documented. p3 depends on no external convention and is unconditional.
