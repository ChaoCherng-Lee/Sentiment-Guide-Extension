-- =============================================================================
-- Plan 5.2 — data minimisation, deletion and retention.
--
-- A parent sees counts, not conversations. An event keeps only: tone, a
-- category from a fixed list, confidence, whether the suggestion was taken,
-- the platform and the time.
-- Gone: the rewrite (effectively the whole message), the flagged words, the
-- free-text label, the contact hash, and the per-contact context answers.
-- =============================================================================

alter table public.events
  drop column contact_hash,
  drop column label,
  drop column flagged_phrase,
  drop column suggestion,
  drop column tone_tags_detected,
  add column category text not null default 'other'
    check (category in ('insult', 'mean_joke', 'sarcasm', 'dismissive', 'harsh_tone', 'threat', 'exclusion', 'other')),
  add column platform text not null default 'whatsapp'
    check (platform in ('whatsapp', 'instagram', 'gmail'));

-- Context answers were per contact; nothing per contact is shared any more
drop table public.context_forms;

/**
 * Child: "Unlink and delete my data" — removes every event and every link
 * for the signed-in child. Runs with the caller's rights, so the row rules
 * apply: it can only ever touch the caller's own rows.
 */
create function public.delete_my_data() returns void
language sql volatile security invoker set search_path = ''
as $$
  delete from public.events where child_id = (select auth.uid());
  delete from public.links  where child_id = (select auth.uid());
$$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

/** Retention: events older than 90 days are deleted. Returns how many. */
create function public.purge_old_events() returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.events where created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.purge_old_events() from public, anon, authenticated;

-- Run it every night at 03:00 UTC (Supabase: enable the pg_cron extension
-- first). Skipped where pg_cron isn't available, e.g. the PGlite tests.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-old-events', '0 3 * * *', 'select public.purge_old_events()');
  end if;
end
$$;
