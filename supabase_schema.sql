-- =============================================================================
-- sentimentchrome — Supabase schema
-- Run this in: Supabase dashboard → SQL Editor → New query → Run
-- =============================================================================

-- Enable UUID generation (usually already enabled in Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- context_forms
-- One row per child+contact. Upserted each time the child fills in the form.
-- Stores the 5-question answers and platform. Never stores contact names.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_forms (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id                text        NOT NULL,
  contact_hash            text        NOT NULL,
  platform                text,
  relationship            text,               -- q1: close_friend / classmate / family / teacher / romantic / new_person
  communication_style     text,               -- q2: very_casual / friendly / polite / formal
  child_uses_tone_tags    text,               -- q3: yes / sometimes / no
  recipient_uses_tone_tags text,              -- q4: yes / sometimes / no / not_sure
  conversation_mood       text,               -- q5: normal / frustrated / tense / responding
  saved_at                timestamptz NOT NULL,
  created_at              timestamptz DEFAULT now(),
  UNIQUE (child_id, contact_hash)
);

-- -----------------------------------------------------------------------------
-- events
-- One row per yellow/red tone detection. Full message text is NEVER stored —
-- only the short flagged_phrase snippet.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                  uuid        PRIMARY KEY,  -- client-generated for idempotency
  child_id            text        NOT NULL,
  contact_hash        text,                     -- links to context_forms row
  tone                text        NOT NULL CHECK (tone IN ('yellow', 'red')),
  confidence          float       CHECK (confidence >= 0 AND confidence <= 1),
  label               text,
  flagged_phrase      text,                     -- verbatim snippet, max ~100 chars
  suggestion          text,                     -- the kinder rewrite that was offered
  suggestion_accepted boolean,                  -- null = closed without action, true = accepted, false = dismissed
  tone_tags_detected  boolean,
  created_at          timestamptz DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- Currently open (no auth yet). Tighten once the invite-code auth is wired up.
-- -----------------------------------------------------------------------------
ALTER TABLE context_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;

-- Allow the extension (anon key) to write rows
CREATE POLICY "anon_insert_context"  ON context_forms FOR INSERT  WITH CHECK (true);
CREATE POLICY "anon_upsert_context"  ON context_forms FOR UPDATE  USING (true);
CREATE POLICY "anon_insert_event"    ON events         FOR INSERT  WITH CHECK (true);
CREATE POLICY "anon_update_event"    ON events         FOR UPDATE  USING (true);

-- Allow reads for the parent dashboard (tighten with JWT claims later)
CREATE POLICY "anon_select_context"  ON context_forms FOR SELECT  USING (true);
CREATE POLICY "anon_select_event"    ON events         FOR SELECT  USING (true);

-- -----------------------------------------------------------------------------
-- Helpful indexes for the parent dashboard queries
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_events_child_id    ON events (child_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_tone        ON events (tone);
CREATE INDEX IF NOT EXISTS idx_context_child_hash ON context_forms (child_id, contact_hash);
