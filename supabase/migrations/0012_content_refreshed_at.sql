-- When a post's numbers were last fetched on demand.
--
-- Two purposes, one column.
--
-- It rate-limits /api/refresh-post. Without a limit a tight loop against that
-- endpoint burns Cloudflare Worker invocations, and on the free plan the 100,000
-- per day is an ACCOUNT-wide budget shared with every other project on the same
-- Cloudflare account. Exhausting it takes unrelated sites' functions down with
-- it, so the blast radius of an abusive client reaches past this product.
--
-- And it tells the reader how fresh the figure in front of them is, which the
-- page could not otherwise say. "Reach 0" means something very different when it
-- was checked a second ago versus at last night's sync.

alter table pulseboard.content add column if not exists refreshed_at timestamptz;

comment on column pulseboard.content.refreshed_at is
  'Last on-demand refresh via /api/refresh-post. NULL means never refreshed
   individually, which is not the same as stale: the scheduled sync updates these
   rows too and does not touch this column.';
