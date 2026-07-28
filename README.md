# Minigames

A collection of small browser minigames.

Planned to live at [minigames.edgecdec.com](https://minigames.edgecdec.com).

## Status

Live, with nine games. Each is registered in `src/games/registry.ts`, which the
menu and nav read — nothing is hand-listed.

Most games keep their scores in the browser and opt into a shared global
leaderboard with one line of config. Perfect Pitch is the exception: its rounds
are issued and scored by the server, because a game whose answer *is* a number
can't accept a score the client calculated.

## Local development

```sh
npm install
npm run dev          # http://localhost:3008
```

The database creates and migrates itself on first run — there's no setup step.

Working on anything leaderboard-related needs a signing secret, or every
submission returns 500:

```sh
SESSION_SECRET=local-dev npm run dev
```

## Tests

Game rules live in `logic.ts` files as pure functions, so they run without a
browser:

```sh
npx tsx src/games/perfect-pitch/logic.test.ts
```

`src/games/perfect-pitch/protocol.test.ts` is the exception — it drives the
real HTTP API and needs a server already running. Point it at a deployment with
`PP_BASE=https://... npx tsx src/games/perfect-pitch/protocol.test.ts`.

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
