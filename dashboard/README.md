# Sentiment Guide — parent dashboard

A static web app where a parent signs in, links their child's extension with
a pairing code, and sees a weekly summary. **It shows counts only** — the
database holds no message text, contacts or rewrites (see
`../supabase/migrations/`).

What a parent sees, good news first:

- this week in plain sentences ("Took 3 of 4 suggestions this week")
- suggestions taken, messages flagged (vs last week), how many were red
- flagged messages per week, yellow and red, for 12 weeks
- the share of suggestions taken per week
- flagged messages by app and by kind, for the last 4 weeks

Every chart has hover details and a "Show as a table" view.

## Try it without a project

```
npm install
npm run dev          # then open http://localhost:5173/?demo
```

`?demo` shows made-up data, clearly labelled.

## Set up for real

1. Create a Supabase project. Under **Authentication → Sign In / Providers**,
   turn on **Email** (parents) and **Anonymous sign-ins** (children's
   extensions).
2. Apply the database: `supabase link` then `supabase db push` from the repo
   root (runs `supabase/migrations/` in order). To delete old events every
   night, enable the `pg_cron` extension first.
3. Copy `.env.example` to `.env` here and fill in the project URL and anon
   key. Put the same values in the extension's `.env` (as
   `WXT_SUPABASE_URL` / `WXT_SUPABASE_ANON_KEY`) and rebuild it.
4. `npm run build` and serve `dist/` from any static host (Vercel, Netlify,
   GitHub Pages). Add the site's address to Supabase **Authentication → URL
   Configuration** so confirmation emails link back to it.

The anon key is public by design: the database rules let a signed-in parent
read only the counts of children linked to them.

## Before using it with real families

The plan asks for these first: agree the consent model and how long data is
kept with the supervisor, decide who hosts the database, check the
Australian Privacy Act (and the Children's Online Privacy Code), plus
COPPA/GDPR if users could be outside Australia, and get ethics approval for
any study.
