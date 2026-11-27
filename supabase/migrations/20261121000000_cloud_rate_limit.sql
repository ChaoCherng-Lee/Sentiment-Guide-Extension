-- Rate limit for the private cloud check (Plan 8.3, Spec NFR-5): hits per
-- key per hour. Keys are "t:<install id>" (an anonymous, random id) or
-- "r:<one-way hash of a network address>" for new installs. No message text
-- or anything about a person is stored here.
--
-- Only the tone-check Edge Function uses it, with the service role. Row level
-- security is on with no policies, so the anon and signed-in roles can't
-- read or write it, and only the service role may call the function.

create table if not exists public.cloud_rate (
  key          text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key, window_start)
);

alter table public.cloud_rate enable row level security;
revoke all on public.cloud_rate from anon, authenticated;

-- Count one hit for p_key this hour; true while still within p_max.
create or replace function public.cloud_rate_hit(p_key text, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := date_trunc('hour', now());
  n integer;
begin
  insert into public.cloud_rate as r (key, window_start, hits)
  values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into n;

  -- Now and then, forget windows older than a day
  if random() < 0.01 then
    delete from public.cloud_rate where window_start < w - interval '1 day';
  end if;

  return n <= p_max;
end;
$$;

revoke all on function public.cloud_rate_hit(text, integer) from public, anon, authenticated;
grant execute on function public.cloud_rate_hit(text, integer) to service_role;
