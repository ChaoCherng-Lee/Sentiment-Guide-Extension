-- =============================================================================
-- Plan 5.1 — Supabase Auth, parent–child pairing and strict database rules.
--
-- Replaces the prototype schema, whose rules let anyone with the anon key
-- read or write any row. The prototype tables are dropped, not migrated: their
-- rows were written without accounts, so they can't be tied to anyone safely.
--
-- Who is who:
-- - a parent signs up with email (Supabase Auth)
-- - a child's extension signs in anonymously (Supabase anonymous sign-in)
-- - a parent creates a 6-digit pairing code (single use, 15 minutes); the
--   child enters it, which links the two accounts in `links`
--
-- Rules (RLS):
-- - a child can only insert rows where child_id = auth.uid()
-- - a parent can only read rows of children linked to them
-- - nobody can update or delete except the owner
-- =============================================================================

drop table if exists public.events cascade;
drop table if exists public.context_forms cascade;

-- -----------------------------------------------------------------------------
-- Pairing
-- -----------------------------------------------------------------------------

create table public.links (
  parent_id  uuid        not null references auth.users (id) on delete cascade,
  child_id   uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, child_id),
  check (parent_id <> child_id)
);

-- Only reachable through the functions below — no table access at all
create table public.pairing_codes (
  code       text        primary key check (code ~ '^[0-9]{6}$'),
  parent_id  uuid        not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at    timestamptz
);

-- Failed code entries, to stop anyone guessing codes
create table public.pairing_attempts (
  child_id     uuid        not null,
  attempted_at timestamptz not null default now()
);
create index pairing_attempts_child on public.pairing_attempts (child_id, attempted_at);

-- -----------------------------------------------------------------------------
-- Data the child's extension uploads (trimmed further in 5.2)
-- -----------------------------------------------------------------------------

create table public.events (
  id                  uuid        primary key,            -- client-generated, so retries don't duplicate
  child_id            uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  contact_hash        text,
  tone                text        not null check (tone in ('yellow', 'red')),
  confidence          real        check (confidence between 0 and 1),
  label               text,
  flagged_phrase      text,
  suggestion          text,
  suggestion_accepted boolean,
  tone_tags_detected  boolean,
  created_at          timestamptz not null default now()
);
create index events_child_created on public.events (child_id, created_at desc);

create table public.context_forms (
  child_id                 uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  contact_hash             text        not null,
  platform                 text,
  relationship             text,
  communication_style      text,
  child_uses_tone_tags     text,
  recipient_uses_tone_tags text,
  conversation_mood        text,
  saved_at                 timestamptz not null,
  primary key (child_id, contact_hash)
);

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

alter table public.links            enable row level security;
alter table public.pairing_codes    enable row level security;
alter table public.pairing_attempts enable row level security;
alter table public.events           enable row level security;
alter table public.context_forms    enable row level security;

-- Signed-out visitors (anon key, no session) get nothing
revoke all on public.links, public.pairing_codes, public.pairing_attempts, public.events, public.context_forms from anon;
revoke all on public.pairing_codes, public.pairing_attempts from authenticated;

/** True when the signed-in user is a parent linked to `child`. */
create function public.is_parent_of(child uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.links l where l.parent_id = (select auth.uid()) and l.child_id = child)
$$;

-- links: both sides can see and remove their own link; created only by redeem_pairing_code()
create policy links_select on public.links for select to authenticated
  using (parent_id = (select auth.uid()) or child_id = (select auth.uid()));
create policy links_delete on public.links for delete to authenticated
  using (parent_id = (select auth.uid()) or child_id = (select auth.uid()));

-- events and context_forms: written, changed and deleted only by the child
-- they belong to; read by that child and their linked parents
create policy events_insert on public.events for insert to authenticated
  with check (child_id = (select auth.uid()));
create policy events_select on public.events for select to authenticated
  using (child_id = (select auth.uid()) or public.is_parent_of(child_id));
create policy events_update on public.events for update to authenticated
  using (child_id = (select auth.uid())) with check (child_id = (select auth.uid()));
create policy events_delete on public.events for delete to authenticated
  using (child_id = (select auth.uid()));

create policy context_insert on public.context_forms for insert to authenticated
  with check (child_id = (select auth.uid()));
create policy context_select on public.context_forms for select to authenticated
  using (child_id = (select auth.uid()) or public.is_parent_of(child_id));
create policy context_update on public.context_forms for update to authenticated
  using (child_id = (select auth.uid())) with check (child_id = (select auth.uid()));
create policy context_delete on public.context_forms for delete to authenticated
  using (child_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Pairing functions
-- -----------------------------------------------------------------------------

/**
 * Parent: a new single-use 6-digit code, valid for 15 minutes. Replaces any
 * code the parent made before. Email accounts only — not anonymous ones.
 */
create function public.create_pairing_code() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me       uuid := auth.uid();
  new_code text;
begin
  if me is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Only a parent signed in with email can create a pairing code';
  end if;
  delete from public.pairing_codes p where p.parent_id = me or p.expires_at < now();
  loop
    -- 6 random digits from gen_random_uuid(), which uses a strong random source
    new_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
    begin
      insert into public.pairing_codes (code, parent_id) values (new_code, me);
      exit;
    exception when unique_violation then
      -- taken by another parent right now; pick again
    end;
  end loop;
  return new_code;
end
$$;

/**
 * Child: use a parent's code. Returns 'ok', 'invalid' (wrong, used or
 * expired) or 'too_many' (5 wrong tries in the last hour). A status rather
 * than an error, so a wrong try is still counted.
 */
create function public.redeem_pairing_code(p_code text) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  parent uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if (select count(*) from public.pairing_attempts a
      where a.child_id = me and a.attempted_at > now() - interval '1 hour') >= 5 then
    return 'too_many';
  end if;

  select p.parent_id into parent from public.pairing_codes p
  where p.code = p_code and p.used_at is null and p.expires_at > now()
  for update;

  if parent is null or parent = me then
    insert into public.pairing_attempts (child_id) values (me);
    return 'invalid';
  end if;

  update public.pairing_codes set used_at = now() where code = p_code;
  insert into public.links (parent_id, child_id) values (parent, me) on conflict do nothing;
  return 'ok';
end
$$;

revoke all on function public.create_pairing_code(), public.redeem_pairing_code(text), public.is_parent_of(uuid) from public, anon;
grant execute on function public.create_pairing_code(), public.redeem_pairing_code(text), public.is_parent_of(uuid) to authenticated;
