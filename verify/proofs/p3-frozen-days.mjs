// Replicates backfillStart()/enumerateDays() from netlify/functions/_sync.ts verbatim.
const MAX_BACKFILL = 30;
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };
function backfillStart(latest, today) {
  const t = today, earliest = addDays(t, -(MAX_BACKFILL - 1));
  let start = latest ? addDays(latest, 1) : earliest;
  if (start < earliest) start = earliest;
  if (start > t) start = t;
  return start;
}
const enumerateDays = (s, e) => { const out=[]; let d=s; for (let i=0;i<400 && d<=e;i++){out.push(d); d=addDays(d,1);} return out; };

// Simulate a daily cron: each day, sync once, record which days get (re)written.
let latest = null;
const writes = {};            // date -> [day it was last written]
for (const day of ["2026-08-20","2026-08-21","2026-08-22","2026-08-23"]) {
  const start = backfillStart(latest, day);
  const fetched = enumerateDays(start, day);
  for (const d of fetched) (writes[d] ??= []).push(day);
  latest = fetched[fetched.length - 1];
  console.log(`cron on ${day}: start=${start} -> refetches ${fetched.length} day(s): ${fetched.join(", ")}`);
}
console.log("\nHow many times each day's value was written:");
for (const d of ["2026-08-20","2026-08-21","2026-08-22","2026-08-23"])
  console.log(`  ${d}: written on ${(writes[d]||[]).join(", ") || "never"}  (${(writes[d]||[]).length}x)`);
