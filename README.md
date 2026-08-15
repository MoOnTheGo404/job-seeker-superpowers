# ReachPoint

Turn any job posting into a shortlist of real recruiters and hiring managers — with their
LinkedIn profiles, publicly published email addresses, and a short outreach message you can
actually send.

Paste a job link or description and ReachPoint will:

1. Extract the company, role, and real company domain from the posting.
2. Search the public web for recruiters, talent partners, and hiring managers at that company.
3. Surface an email **only** when it is published on a public page — always with the source link.
4. Draft a short, specific outreach message for email or LinkedIn.

## Ground rules

Email addresses are never guessed or pattern-derived. Every address the app shows comes with the
public URL it was found on, stored alongside it as `email_source_url`. If no published address
exists, the app says so and points you at LinkedIn instead.

## Stack

- **Frontend/SSR:** TanStack Start (React 19) on Vite, Tailwind CSS v4, shadcn/ui
- **Backend:** Supabase (Postgres, Auth, row-level security)
- **AI:** Google Gemini via `@google/genai` (free tier)

## Development

Requires Node.js 20+.

```sh
npm install
cp .env.example .env    # then fill in the values
npm run dev
```

The dev server runs on http://localhost:8080.

### Environment variables

See [.env.example](.env.example). At minimum you need the Supabase project variables and
`GEMINI_API_KEY`. `SERPER_API_KEY` is optional but strongly recommended — without it,
recruiter discovery falls back to scraping public search engines, which throttle heavily and
return far worse results.

### Useful scripts

| Command             | What it does                      |
| ------------------- | --------------------------------- |
| `npm run dev`       | Start the dev server on port 8080 |
| `npm run build`     | Production build                  |
| `npm run typecheck` | Type-check without emitting       |
| `npm test`          | Run unit tests (Vitest)           |
| `npm run lint`      | Lint with ESLint                  |
| `npm run format`    | Format with Prettier              |

## Database

Schema lives in [supabase/migrations](supabase/migrations). Tables: `profiles`, `job_targets`,
`contacts`, `outreach` — each with row-level security scoping rows to their owning user.
