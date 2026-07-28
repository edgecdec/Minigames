# Minigames

A collection of small browser minigames.

Planned to live at [minigames.edgecdec.com](https://minigames.edgecdec.com).

## Status

Empty scaffold — nothing built yet.

## Intended setup

Follows the same pattern as the other games in this account
([WorldCupPredictions](https://github.com/edgecdec/WorldCupPredictions),
[TopTenGame](https://github.com/edgecdec/TopTenGame),
[SuperConnections](https://github.com/edgecdec/SuperConnections)):

- Next.js 15 (App Router, React 19) + TypeScript
- MUI v7 + Emotion for styling
- SQLite via `better-sqlite3`
- Custom `server.js` wrapping Next.js, with a GitHub webhook handler
- Deployed on a VPS under pm2, auto-deploying on push to `main` via `deploy_webhook.sh`
- Port **3008** (3001, 3002, 3003, 3006, 3007 are already in use by other apps)
