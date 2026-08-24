# dev-pulse

A zero-config PR activity dashboard for a small allowlisted GitHub team. Users sign in with GitHub; the app automatically discovers every visible, non-archived repository. There are no PAT forms, watchlists, account profiles, or database.

## Architecture

- **Frontend**: React + Vite + TypeScript + TanStack Query
- **Backend**: Vercel Functions under `api/`
- **Data source**: GitHub GraphQL API, proxied by `api/github/graphql.ts`
- **Auth**: GitHub OAuth App
  - `api/auth/login.ts` starts OAuth with a high-entropy state cookie
  - `api/auth/callback.ts` exchanges the code, verifies `ALLOWED_GITHUB_USERS`, and creates the session
  - The OAuth token is AES-256-GCM encrypted inside an `HttpOnly`, `Secure`, `SameSite=Lax` cookie
  - Client code uses a non-secret `session:<login>` cache identity; it must never receive the OAuth token
- **Scope**: `viewer.repositories` discovers repositories visible to the signed-in account. Archived repositories are excluded. PR searches are chunked into 20 repo qualifiers per GraphQL search.
- **State**:
  - Server state: TanStack Query with a persisted response cache
  - Identity/credential state: encrypted server session cookie
  - No user configuration or credentials in localStorage
- **Deployment**: Vite static build plus Vercel Functions. No database.

## Required environment

```text
APP_URL
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SESSION_SECRET       # at least 32 characters
ALLOWED_GITHUB_USERS # comma-separated; empty fails closed
```

## Core features

1. **Open PR board** — open PRs across automatically discovered repos: review state, CI, age
2. **Review activity** — PRs awaiting the viewer's review and review turnaround
3. **Stats & trends** — merge frequency, PR cycle time, team throughput
4. **Stale PR alerts** — highlight PRs with no activity past the threshold
5. **Mine** — all PRs authored by the viewer, including repos outside the discovered scope

## Conventions

- Components never call GitHub directly; browser GraphQL requests go through `src/api/github.ts` to the same-origin proxy.
- The proxy is read-only: reject GraphQL mutations and requests without a valid session.
- Never put OAuth tokens in client responses, logs, localStorage, query keys, or URLs.
- Keep access fail-closed: an absent or malformed allowlist grants nobody access.
- Respect GitHub rate limits: chunk repo searches, cache results, back off on `403`/`RATE_LIMITED`, and surface quota.
- Components are function components, colocated by feature under `src/features/<feature>/`.
- Follow the Vercel React best-practices and web-design-guidelines skills in `.agents/skills/`.

## Commands

```bash
npm run dev           # Vite frontend only
npx vercel dev        # frontend + Vercel Functions, with local env configured
npm run build         # production frontend build (also typechecks API)
npm run typecheck     # app, Vite config, and Vercel API
npm run test          # Vitest
npm run lint          # oxlint
npm run lint:fix      # oxlint with autofixes
npm run format        # prettier --write
npm run format:check  # CI formatting gate
npm run check         # format:check + lint + typecheck + test
```

## Lint & format

- **oxlint** owns correctness/suspicious/perf linting. Intentional exceptions need a reason.
- **Prettier** owns formatting: no semicolons, single quotes, 100 columns.
- CI runs format, lint, typecheck, tests, and build on pull requests and pushes to `main`.

## Security invariants

- OAuth access tokens exist only at GitHub and inside the encrypted server session cookie.
- Only allowlisted GitHub users can establish a session.
- The GraphQL proxy accepts queries only, never mutations.
- No third-party analytics that could observe repository data or request payloads.
