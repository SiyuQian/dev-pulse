# dev-pulse

A pure-frontend PR activity dashboard for teams. Statically hosted; each user authenticates with their own GitHub PAT stored in localStorage. No backend, no database.

## Architecture

- **Stack**: React + Vite + TypeScript + TanStack Query
- **Data source**: GitHub API called directly from the browser
  - GraphQL (`https://api.github.com/graphql`) preferred for PR lists/reviews — far fewer requests than REST
  - REST only where GraphQL is awkward (e.g. rate-limit probing)
- **Auth**: user-supplied fine-grained PAT, kept in `localStorage` only. It must never be sent anywhere except `api.github.com`, never logged, never placed in URLs.
- **Accounts**: multiple GitHub accounts, each a *profile* with its own PAT and its own watchlist. One is active at a time and drives every view; the switcher lives in the top bar. Profiles are stored in `devpulse:profiles:v2`, tokens separately in `devpulse:tokens:v2` keyed by profile id, so nothing that serialises a profile can carry a token.
- **State**:
  - Server state: TanStack Query (caching, polling/refetch intervals, rate-limit-aware retry). Query keys carry a fingerprint of the active token so accounts never share a cache entry.
  - Config (profiles, watched repos/users, preferences): localStorage, versioned schema with migration
- **Config sharing**: watchlist config (NOT the PAT) can be encoded into a URL fragment (`#config=...`, base64 JSON) for one-click import by teammates. Use the fragment, not query params, so it never hits any server logs.
- **Deployment**: static build (`vite build`) → Vercel / Cloudflare Pages. No server code.

## Core features

1. **Open PR board** — open PRs across watched repos/authors: review state, CI status, age, draft/ready
2. **Review activity** — PRs awaiting my review, who is reviewing whom, review turnaround
3. **Stats & trends** — merge frequency, PR cycle time, team throughput charts
4. **Stale PR alerts** — highlight PRs with no activity past a threshold

## Conventions

- All GitHub API access goes through `src/api/` — components never call fetch directly
- Query keys are centralized; include the watchlist hash so config changes invalidate correctly
- Respect GitHub rate limits: batch via GraphQL, back off on `403`/`RATE_LIMITED`, surface remaining quota in the UI
- localStorage access only through a typed `src/storage/` module with schema versioning + migration
- Components: function components, colocated by feature under `src/features/<feature>/`
- Follow the Vercel React best-practices and web-design-guidelines skills in `.agents/skills/`

## Commands

```bash
npm run dev        # local dev server
npm run build      # production build (also typechecks)
npm run test       # vitest
npm run lint       # eslint
```

## Security invariants

- PAT never leaves the browser except to `api.github.com`
- PAT never appears in shared config URLs, exports, or error reports
- No third-party analytics that could see request payloads
