create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled prompt',
  text text not null default '',
  refined text not null default '',
  category text not null default 'Other',
  source_url text not null default '',
  source_title text not null default '',
  use_count integer not null default 0 check (use_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  prompt_id text references public.prompts(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.prompts enable row level security;
alter table public.usage_events enable row level security;

drop policy if exists "Profiles are readable by owner" on public.profiles;
create policy "Profiles are readable by owner"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Profiles are insertable by owner" on public.profiles;
create policy "Profiles are insertable by owner"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "Profiles are updateable by owner" on public.profiles;
create policy "Profiles are updateable by owner"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Prompts are readable by owner" on public.prompts;
create policy "Prompts are readable by owner"
on public.prompts for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Prompts are insertable by owner" on public.prompts;
create policy "Prompts are insertable by owner"
on public.prompts for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Prompts are updateable by owner" on public.prompts;
create policy "Prompts are updateable by owner"
on public.prompts for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Prompts are deletable by owner" on public.prompts;
create policy "Prompts are deletable by owner"
on public.prompts for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Usage events are readable by owner" on public.usage_events;
create policy "Usage events are readable by owner"
on public.usage_events for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Usage events are insertable by owner" on public.usage_events;
create policy "Usage events are insertable by owner"
on public.usage_events for insert
to authenticated
with check ((select auth.uid()) = user_id);

create index if not exists prompts_user_updated_idx on public.prompts (user_id, updated_at desc);
create index if not exists prompts_user_category_idx on public.prompts (user_id, category);
create index if not exists usage_events_user_created_idx on public.usage_events (user_id, created_at desc);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.prompts to authenticated;
grant select, insert on public.usage_events to authenticated;
