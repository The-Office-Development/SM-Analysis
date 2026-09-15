-- Everything Instagram reports for a story, not the six we happened to ask for.
--
-- Verified against Meta's IG Media Insights reference on 2026-09-15, metric by
-- metric, including each one's media-type list. A STORY supports:
--
--   views, total_views, reach, replies, navigation, shares, reposts,
--   total_interactions, profile_visits, profile_activity, follows, link_clicks,
--   facebook_views   (and `impressions`, deprecated for media created after
--                     2 July 2024, so deliberately never requested)
--
-- and does NOT support likes, saves or comments: those three are FEED and REELS
-- only, which is why a story's like/save/comment columns are null and must stay
-- null rather than become 0.
--
-- The sync asked for six of the thirteen and stored five: total_interactions was
-- requested and thrown away. The three that answer "did this story do anything?"
-- for a creator — profile_visits, follows, link_clicks — were never requested at
-- all. These columns are what lets them be stored.
--
-- Every column is NULLABLE, like every other metric column: null means Instagram
-- did not report it (a story under five views reports nothing at all, error #10),
-- and a story is stored the moment it is seen precisely so its figures can fill
-- in later.
--
-- navigation_breakdown holds the story_navigation_action_type split
-- (TAP_FORWARD, TAP_BACK, TAP_EXIT, SWIPE_FORWARD) as {"tap_forward": n, ...}.
-- jsonb rather than four columns: it is one measurement of one thing, and the
-- next platform's equivalent will not have these four names.

alter table pulseboard.content add column if not exists total_views bigint;
alter table pulseboard.content add column if not exists reposts bigint;
alter table pulseboard.content add column if not exists interactions bigint;
alter table pulseboard.content add column if not exists profile_visits bigint;
alter table pulseboard.content add column if not exists profile_activity bigint;
alter table pulseboard.content add column if not exists follows bigint;
alter table pulseboard.content add column if not exists link_clicks bigint;
alter table pulseboard.content add column if not exists facebook_views bigint;
alter table pulseboard.content add column if not exists navigation_breakdown jsonb;

comment on column pulseboard.content.interactions is
  'total_interactions: Meta''s own engagement total for the media. Stored rather
   than discarded; for a story it is the only combined figure Instagram gives,
   since likes, saves and comments do not exist there.';
comment on column pulseboard.content.navigation_breakdown is
  'story_navigation_action_type split of `navigation`: tap_forward, tap_back,
   tap_exit, swipe_forward. Null means Meta did not report the breakdown.';

insert into pulseboard.schema_migrations (version) values ('0019_story_metrics')
  on conflict (version) do nothing;
