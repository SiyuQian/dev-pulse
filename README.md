# dev-pulse

A zero-config PR activity dashboard for a small GitHub team. Sign in once to see open pull requests, review queues, stale work, and team trends across every visible, non-archived repository.

## How it works

1. Sign in with GitHub.
2. dev-pulse verifies that your login is on the server-side allowlist.
3. It automatically discovers repositories visible to that GitHub account.
4. The existing dashboard views load without PATs or watchlists.

GitHub credentials are encrypted in an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie. The browser sends fixed read-only GraphQL operations through a same-origin Vercel Function; it never receives or stores the OAuth access token.

## Features

- **Automatic scope** — all visible, non-archived repositories, discovered after sign-in
- **Open PR board** — review state, CI status, age, author, and requested reviewers
- **Review activity** — PRs waiting on your review and review turnaround
- **Stats & trends** — merge frequency, PR cycle time, and throughput
- **Stale PR alerts** — PRs with no activity past the configured threshold
- **Allowlisted access** — only configured GitHub logins can establish a session

## Develop

```bash
npm ci
npm run dev      # frontend only; API calls require Vercel dev or a deployed preview
npm run check    # format, lint, typecheck, and tests
npm run build    # verified production frontend build in dist/
```

To exercise OAuth and API routes locally, provide the environment variables below and run `npx vercel dev`.

## Deploy to Vercel

### 1. Register a GitHub OAuth App

Create an OAuth App in GitHub Developer settings with:

- **Homepage URL:** `https://dev-pulse.siyu.co.nz`
- **Authorization callback URL:** `https://dev-pulse.siyu.co.nz/api/auth/callback`

### 2. Configure Vercel environment variables

Set these for Production and Preview as appropriate:

```text
APP_URL=https://dev-pulse.siyu.co.nz
GITHUB_CLIENT_ID=<oauth-app-client-id>
GITHUB_CLIENT_SECRET=<oauth-app-client-secret>
SESSION_SECRET=<at-least-32-random-characters>
ALLOWED_GITHUB_USERS=SiyuQian,SiyuAI
```

Generate `SESSION_SECRET` with a cryptographically secure password generator or:

```bash
openssl rand -base64 48
```

Keep only the GitHub logins that should access the dashboard. An empty allowlist fails closed: nobody can sign in.

### 3. Deploy

Vercel builds the Vite frontend and automatically deploys files under `api/` as Functions. No database is required.

## Security invariants

- OAuth access tokens never enter client JavaScript, localStorage, URLs, or logs.
- Session contents use AES-256-GCM authenticated encryption.
- Only allowlisted GitHub logins receive a session.
- The GraphQL proxy requires a valid same-origin session and rejects mutations.
- Automatic repository scope comes from the signed-in user's own GitHub permissions.
- No database or shared service-account PAT is used.

## Tech

React · Vite · TypeScript · TanStack Query · Vercel Functions · GitHub OAuth · GitHub GraphQL API
