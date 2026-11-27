-- =============================================================================
-- Sentiment Guide can now check text boxes on any website, not just WhatsApp,
-- Instagram and Gmail. Flags from those are shared as platform 'web'
-- ("Other websites" on the dashboard) — still no site name or address.
-- =============================================================================

alter table public.events
  drop constraint events_platform_check,
  add constraint events_platform_check
    check (platform in ('whatsapp', 'instagram', 'gmail', 'web'));
