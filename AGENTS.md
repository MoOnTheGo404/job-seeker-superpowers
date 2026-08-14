# Working in this repo

## Non-negotiable product rule

Never invent, guess, or pattern-derive an email address (no `first.last@company.com`
construction). An address may only be surfaced if it was actually found on a public page, and it
must carry the URL it came from in `email_source_url`. When nothing verifiable exists, return
`email_status: "not_found"` and fall back to a LinkedIn people-search link.

## Layout

- `src/routes/` — file-based TanStack Router routes
- `src/lib/*.server.ts` — server-only modules; never import these into client components
- `src/lib/recruiters.functions.ts` — the three server functions (`analyzeJob`, `discoverContacts`,
  `draftOutreach`)
- `src/integrations/supabase/` — Supabase clients and auth middleware
- `supabase/migrations/` — SQL schema

## Conventions

- Server functions go through `requireSupabaseAuth`, which puts `supabase` and `userId` on the
  handler context. Use that client so row-level security applies — don't reach for a service-role
  key.
- Anything hitting the network from the server (`fetch`, AI calls) belongs in a `*.server.ts`
  module and should be imported dynamically inside the handler.
- Run `npm run typecheck` and `npm run lint` before committing.
