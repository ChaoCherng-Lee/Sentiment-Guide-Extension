-- The parts of Supabase that the migrations rely on, so they can run in a
-- plain Postgres (PGlite) for tests: the auth schema, auth.uid()/auth.jwt()
-- reading the request's JWT claims, and the anon / authenticated roles with
-- Supabase's default grants on the public schema.

create schema auth;

create table auth.users (
  id           uuid primary key,
  email        text,
  is_anonymous boolean not null default false
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create role anon nologin;
create role authenticated nologin;
-- The Edge Functions' role: bypasses row level security
create role service_role nologin bypassrls;
grant usage on schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

grant usage on schema public, auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
