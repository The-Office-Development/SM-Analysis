-- Remember which story metrics Instagram will actually serve this account.
--
-- Measured on a live story, 2026-09-15: asking for all thirteen documented story
-- metrics was REFUSED for @malekismaiil, and the capture fell back to the six
-- proven ones. An insights request is all-or-nothing, so one metric this account
-- cannot have costs the whole call, and the four that matter most to a creator
-- (profile_visits, follows, link_clicks, profile_activity) were lost with it.
--
-- The capture now steps down a ladder, full -> plus -> core, and records the rung
-- that answered here along with Meta's own refusal message. Two reasons to store
-- it rather than rediscover it every run:
--   1. a story is re-read every 15 minutes for 24 hours, and a wasted first
--      attempt each time is a wasted call each time;
--   2. the refusal message names the metric Meta objects to, and that text is
--      the only evidence of WHY these figures are missing once the log rotates.
--
-- Shape: {"metrics": "reach,views,...", "detail": "(#100) ...", "checked_at": "..."}.
-- Null means never narrowed: ask for everything.

alter table pulseboard.social_accounts add column if not exists story_metrics jsonb;

comment on column pulseboard.social_accounts.story_metrics is
  'Which story insight metric list this account answers, and why it was narrowed.
   Null = try the full documented list. Set by the story capture, not by hand.';

insert into pulseboard.schema_migrations (version) values ('0020_story_metric_set')
  on conflict (version) do nothing;
