-- Plan 12.2 (Spec NFR-6): opt-in, anonymous diagnostics.
-- One row per install per day of counts. No message text, no site names, no
-- user or install id. Anyone with the anon key can add a row; nobody can
-- read rows through the API (the team reads them in the dashboard / SQL).

create table if not exists public.diagnostics (
  id         bigint generated always as identity primary key,
  day        date        not null,
  edition    text        not null check (edition in ('consumer', 'family')),
  version    text        not null check (char_length(version) <= 20),
  counts     jsonb       not null,
  created_at timestamptz not null default now()
);

-- Counts: an object of at most 100 short, fixed-vocabulary names → small whole numbers
create or replace function public.diagnostics_counts_ok(c jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(c) = 'object'
     and (select count(*) from jsonb_object_keys(c)) <= 100
     and not exists (
       select 1 from jsonb_each(c) as e(k, v)
       where k !~ '^[a-z0-9_.-]{1,60}$'
          or jsonb_typeof(v) <> 'number'
          or (v::text)::numeric < 0
          or (v::text)::numeric > 100000
          or (v::text)::numeric <> floor((v::text)::numeric)
     )
$$;

alter table public.diagnostics
  add constraint diagnostics_counts_valid check (public.diagnostics_counts_ok(counts)),
  add constraint diagnostics_day_recent   check (day between current_date - 8 and current_date + 1);

alter table public.diagnostics enable row level security;

drop policy if exists "anyone can add diagnostics" on public.diagnostics;
create policy "anyone can add diagnostics" on public.diagnostics
  for insert to anon, authenticated
  with check (true);

revoke all on public.diagnostics from anon, authenticated;
grant insert (day, edition, version, counts) on public.diagnostics to anon, authenticated;
