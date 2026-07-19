# dev-pulse

A team PR activity dashboard. See your team's pull requests at a glance — what's open, what's blocked on review, what's gone stale, and how the team is trending.

**No backend.** dev-pulse is a static web app that talks directly to the GitHub API from your browser. Deploy it once, and every teammate uses it with their own GitHub token.

## Features

- **Open PR board** — all open PRs across the repos and people you watch, with review state, CI status, and age
- **Review activity** — PRs waiting on your review, who's reviewing whom, turnaround times
- **Stats & trends** — merge frequency, PR cycle time, and throughput over time
- **Stale PR alerts** — surfacing PRs that have sat untouched too long
- **Watchlists** — manage the repos and users you care about; share your config with teammates via a link (your token is never included)

## Getting started

### Use it

1. Open the deployed dashboard
2. Paste a GitHub **fine-grained personal access token** with read access to the repos you want to watch (Settings → Developer settings → Fine-grained tokens). The token is stored only in your browser's localStorage and sent only to `api.github.com`.
3. Add repos (`owner/name`) and/or GitHub usernames to your watchlist
4. Optionally, click **Share config** to send your watchlist to a teammate as a URL

### Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static production build in dist/
```

### Deploy

The build output in `dist/` is fully static — host it on Vercel, Cloudflare Pages, GitHub Pages, or any static file server. No environment variables or server configuration required.

## Tech

React · Vite · TypeScript · TanStack Query · GitHub GraphQL API

## Security notes

- Your PAT never leaves your browser except in requests to `api.github.com`
- Shared config links contain only the watchlist, never tokens
- Prefer fine-grained tokens scoped to read-only access on the repos you watch
