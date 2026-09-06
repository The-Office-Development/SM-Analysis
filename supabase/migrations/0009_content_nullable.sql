-- Let a post's metrics say "not reported".
--
-- Every metric column on `content` was `not null default 0`, so a post whose
-- figures Instagram had not returned was stored as 0 and became
-- indistinguishable from a post that genuinely reached nobody. `metrics_daily`
-- was made nullable during the audit for exactly this reason; `content` was
-- never revisited.
--
-- It matters most for the newest post. Instagram reports nothing for the first
-- minutes to hours after publishing, which is precisely when a creator opens
-- the dashboard to decide whether to keep it. On the old columns that reads as
-- "your post reached 0 people" — the most damaging wrong number this product
-- could show, at the moment of maximum consequence.
--
-- Dropping the defaults is part of the fix, not tidying. A default of 0 would
-- silently refill the column on any insert that omits the field.

alter table pulseboard.content alter column views    drop default;
alter table pulseboard.content alter column likes    drop default;
alter table pulseboard.content alter column comments drop default;
alter table pulseboard.content alter column shares   drop default;
alter table pulseboard.content alter column saves    drop default;
alter table pulseboard.content alter column reach    drop default;

alter table pulseboard.content alter column views    drop not null;
alter table pulseboard.content alter column likes    drop not null;
alter table pulseboard.content alter column comments drop not null;
alter table pulseboard.content alter column shares   drop not null;
alter table pulseboard.content alter column saves    drop not null;
alter table pulseboard.content alter column reach    drop not null;

-- Existing rows are NOT converted. A stored 0 might be a real zero or a
-- fabricated one and there is no way to tell them apart after the fact, so they
-- are left alone; the next sync overwrites each row with honest values. Guessing
-- retroactively would replace one wrong number with a different wrong number.
