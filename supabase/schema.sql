-- Orbit database setup. Paste this whole file into Supabase > SQL Editor > Run.
-- Safe to run again.

-- 1. One library per person. Each row holds that person's sets, cards, streak and profile.
create table if not exists public.libraries (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.libraries enable row level security;

drop policy if exists "libraries_select_own" on public.libraries;
drop policy if exists "libraries_insert_own" on public.libraries;
drop policy if exists "libraries_update_own" on public.libraries;
drop policy if exists "libraries_delete_own" on public.libraries;

create policy "libraries_select_own" on public.libraries
  for select to authenticated using (auth.uid() = user_id);
create policy "libraries_insert_own" on public.libraries
  for insert to authenticated with check (auth.uid() = user_id);
create policy "libraries_update_own" on public.libraries
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "libraries_delete_own" on public.libraries
  for delete to authenticated using (auth.uid() = user_id);

-- 2. Daily AI usage counter, so one account cannot use up the free AI quota.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default ((now() at time zone 'utc')::date),
  count   int  not null default 0,
  primary key (user_id, day)
);

-- Row level security on with no policies: nobody can read or write this table directly.
alter table public.ai_usage enable row level security;

create or replace function public.bump_ai_usage()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.ai_usage (user_id, day, count)
  values (auth.uid(), (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into n;
  return n;
end;
$$;

revoke all on function public.bump_ai_usage() from public, anon;
grant execute on function public.bump_ai_usage() to authenticated;
