-- ===========================================================================
-- 0004 — AI usage accounting
--
-- /api/ai had no cap of any kind and spends the organisation's Anthropic budget.
-- At roughly $0.09 a request, one scripted caller is tens of thousands of
-- dollars a day, and exhausting the budget takes the assistant down for every
-- tenant at once.
-- ===========================================================================

create table if not exists pulseboard.ai_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  input_tokens int not null default 0,
  output_tokens int not null default 0
);
alter table pulseboard.ai_usage enable row level security;
drop policy if exists "ai usage owner read" on pulseboard.ai_usage;
create policy "ai usage owner read" on pulseboard.ai_usage
  for select using (auth.uid() = user_id);
grant select on pulseboard.ai_usage to authenticated;
create index if not exists idx_ai_usage_user_time on pulseboard.ai_usage (user_id, created_at desc);
