-- Capture stories before they evaporate.
--
-- Stories were never synced at all: no endpoint call, no columns, nothing. They
-- are the one PERISHABLE thing this product touches. A post's numbers can be
-- backfilled two years later (API-VERIFICATION.md 6.7); a story and its insights
-- are gone 24 hours after publishing and cannot be recovered at any price. Every
-- hour without capture is data permanently lost for every connected account.
--
-- Stories live in `content` rather than a table of their own. They share the
-- shape that matters — one item, published at a time, with reach and views — and
-- reusing the table means they appear in Content and in exports immediately
-- rather than after a second UI is built. `media_type = 'Story'` distinguishes
-- them.
--
-- Two columns are added because stories carry metrics posts do not:
--   replies     direct replies to the story
--   navigation  taps forward, back, and exits — how people MOVED through it
-- Both nullable, like every metric column after 0009: null means the platform
-- did not report it, never zero.

alter table pulseboard.content add column if not exists replies    bigint;
alter table pulseboard.content add column if not exists navigation bigint;

-- When this story stops being retrievable. Null for posts, which do not expire.
-- Recorded so a capture job can tell "this story ended and these are its final
-- numbers" from "this story is still live and still accumulating".
alter table pulseboard.content add column if not exists expires_at timestamptz;

comment on column pulseboard.content.replies is
  'Story replies. Null means unreported, never zero. Posts leave this null.';
comment on column pulseboard.content.navigation is
  'Story navigation taps (forward, back, exit). Null means unreported.';
comment on column pulseboard.content.expires_at is
  'When a story stops being retrievable. Null for posts. After this passes the
   stored row is the ONLY remaining record — the platform will not serve it again.';
