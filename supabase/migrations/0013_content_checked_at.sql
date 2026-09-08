-- When a post's numbers were last read from the platform, by ANY route.
--
-- WHY A SECOND COLUMN AND NOT A REUSE OF refreshed_at
--
-- 0012 added `refreshed_at`, and its own comment records the hole this closes:
-- "NULL means never refreshed individually, which is not the same as stale: the
-- scheduled sync updates these rows too and does not touch this column."
--
-- So a post's figures could be four minutes old and the page had no way to say
-- so. It could only report freshness for posts somebody had manually pressed
-- "Check now" on, which is the small minority, and stayed silent about the rest.
--
-- That silence is the friction this exists to remove. A creator publishes, sees
-- 1.5k views in the Instagram app, opens this dashboard, sees a different
-- number, and has nothing on screen to explain it. The number is not wrong; it
-- was read at a different moment. Without a timestamp the client cannot tell
-- those apart, and will reasonably assume the product is broken.
--
-- refreshed_at CANNOT be reused for this, because it also enforces the 30-second
-- cooldown on /api/refresh-post. Stamping it from the sync would mean a sync
-- that ran ten seconds ago refuses the client's own "Check now" with "just
-- checked" — punishing them for the cron's timing. The two facts are different
-- facts and get different columns:
--
--   checked_at    -- last read from the platform, sync or manual. Freshness.
--   refreshed_at  -- last MANUAL refresh. Rate limiting only.
--
-- Backfilled to NULL rather than to now(): claiming existing rows were checked
-- at migration time would be inventing a fact, and an unknown freshness must
-- read as unknown. The next sync stamps every row it touches.

alter table pulseboard.content add column if not exists checked_at timestamptz;

comment on column pulseboard.content.checked_at is
  'When these figures were last read from the platform, by the scheduled sync or
   by an on-demand refresh. NULL means never stamped (rows predating migration
   0013); the next sync fills it. Displayed to the client so a difference against
   the platform reads as a timing gap rather than as a wrong number.';
