# Minigames

A collection of small browser minigames.

Planned to live at [minigames.edgecdec.com](https://minigames.edgecdec.com).

## Status

Scaffold + deploy pipeline in place. No games built yet.

## Local development

```sh
npm install
npm run dev          # http://localhost:3008
```

## Setup

Follows the same pattern as the other games in this account
([WorldCupPredictions](https://github.com/edgecdec/WorldCupPredictions),
[TopTenGame](https://github.com/edgecdec/TopTenGame),
[SuperConnections](https://github.com/edgecdec/SuperConnections)):

- Next.js 15 (App Router, React 19) + TypeScript
- MUI v7 + Emotion for styling
- SQLite via `better-sqlite3`
- Custom `server.js` wrapping Next.js, with a GitHub webhook handler
- Deployed on a VPS under pm2, auto-deploying on push to `main` via `deploy_webhook.sh`
- Port **3008**

## Deploy

Push to `main` triggers a repo webhook → `POST /api/webhook` → `server.js` verifies the
GitHub HMAC signature → runs `deploy_webhook.sh`, which fetches, installs (only when
`package.json` changed), builds, verifies the build produced chunks, then restarts pm2.

A failed build leaves the previous pm2 process running, so a bad commit can't take the
site down. Requires `WEBHOOK_SECRET` in the pm2 environment; the handler refuses to
deploy if it is unset.
