-- Audience breakdowns that are not age, gender or country.
--
-- WHY A NEW COLUMN AND NOT A REUSE OF THE EXISTING ONES
--
-- `audience_snapshots` was shaped by Instagram: age, gender, countries, devices,
-- active_hours. LinkedIn reports none of the first two for a Company Page and
-- instead breaks followers down PROFESSIONALLY — industry, seniority, job
-- function, company size, association type — plus a second, coarser geography
-- (market areas such as "San Francisco Bay Area") alongside countries.
--
-- There were three options and only one of them is honest:
--
--   1. Force LinkedIn into `age`/`gender`. Those columns would then hold
--      something that is not an age and not a gender, and every consumer —
--      exports, the AI assistant's grounding snapshot, the report sheet —
--      would present it under the wrong label.
--   2. Add five typed columns. That writes LinkedIn's 2026 taxonomy into the
--      schema, and the next platform adds five more. The audit's own lesson is
--      that platform shapes change faster than migrations get written.
--   3. One open map, keyed by dimension name. The UI renders what is there and
--      nothing needs a migration when a platform adds a facet.
--
-- (3), with the deliberate exception of COUNTRY, which stays in `countries`
-- because it means the same thing on every platform and the Top locations panel
-- should keep working without knowing who reported it.
--
-- SHAPE
--
--   { "industry":     { "Software Development": 0.31, ... },
--     "seniority":    { "Senior": 0.22, ... },
--     "function":     { "Engineering": 0.18, ... },
--     "company_size": { "2–10 employees": 0.09, ... },
--     "association":  { "Employee": 0.04 },
--     "regions":      { "Amman Governorate, Jordan": 0.4, ... } }
--
-- Values are shares of what the platform returned for that facet, on the same
-- 0..1 convention as `age` and `gender`. LinkedIn caps each facet at its top 100
-- values and no longer returns a follower total on that endpoint, so a share is
-- a share OF THE RETURNED SET and cannot be reconciled against the page's own
-- follower count. That limit is the platform's, and it is recorded in
-- docs/LINKEDIN-PLAN.md rather than papered over here.
--
-- An empty object is the default and means the platform reported no such
-- breakdown — the same "unknown, not zero" rule as the metric columns.

alter table pulseboard.audience_snapshots
  add column if not exists dimensions jsonb not null default '{}';

comment on column pulseboard.audience_snapshots.dimensions is
  'Platform-specific audience breakdowns that are not age, gender or country,
   keyed by dimension name (industry, seniority, function, company_size,
   association, regions). Values are shares of the values the platform returned
   for that facet, not of the account''s followers. Empty means not reported.';
