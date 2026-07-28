# Agent rules — Minigames

Applies to **every** AI agent working in this repo (Claude, Gemini, Copilot, Cursor,
Codex, or a human following along). If you are an agent and you read only one file,
read this one.

`CLAUDE.md` and `GEMINI.md` are pointers to this file. Keep the rules here, not there.

---

## The one rule that matters

**Push code into shared components. A new game should be almost entirely game logic.**

This is a *collection* site. Many small games by many different people. If each game
reimplements its own layout, score display, storage, and buttons, the site stops looking
like one product and every new game costs 5× more than it should.

Before you write a component inside `src/games/<slug>/`, check whether it belongs in
`src/components/` instead. If two games would want it, it goes in `src/components/`.

**If you find yourself copy-pasting from another game, stop and extract it instead.**
Extracting a shared component and updating the existing callers is always in scope —
you do not need to ask first.

---

## Layout

```
src/
  app/
    page.tsx              # the menu — reads registry, do not hand-list games
    <slug>/page.tsx       # thin wrapper: metadata + <GameShell> + the game
  components/             # SHARED. Anything two+ games could use.
    GameShell.tsx         # back link, title, controls hint, centered slot
    ScoreBar.tsx          # row of stat readouts
    GameCard.tsx          # menu tile
  games/
    registry.ts           # SINGLE SOURCE OF TRUTH for the game list
    <slug>/
      logic.ts            # pure rules — no DOM, no React
      <Name>Game.tsx      # the playable component
  lib/
    useLocalStorage.ts    # SSR-safe storage + useBestScore
  theme.ts                # MUI theme. Use theme tokens, not hex literals.
```

## Adding a game

1. `src/games/<slug>/logic.ts` — pure functions, no DOM, no React.
2. `src/games/<slug>/<Name>Game.tsx` — `"use client"`, renders the game.
3. `src/app/<slug>/page.tsx` — copy an existing one; it should stay ~15 lines.
4. Add an entry to `GAMES` in `src/games/registry.ts`.

The menu picks it up automatically. Never hardcode a game in the menu.

## Hard requirements

- **Separate pure logic from rendering.** Game rules go in `logic.ts` as pure functions
  taking and returning state. This is what makes them testable without a browser —
  see the Snake tests. Do not bury rules inside `useEffect`.
- **Inject randomness.** Take `rng: () => number = Math.random` as a parameter rather
  than calling `Math.random()` inline, so tests can make outcomes deterministic.
- **Use `useBestScore(slug)`** from `src/lib/useLocalStorage.ts` for high scores. Do not
  touch `localStorage` directly — the hook already handles SSR and private-mode failures.
- **Use `<GameShell>` and `<ScoreBar>`.** Do not rebuild page chrome or stat rows.
- **Use theme tokens** (`primary.main`, `text.secondary`, `background.paper`). Raw hex is
  acceptable only inside `<canvas>` drawing code, where MUI cannot reach.
- **`e.preventDefault()` on arrow keys and Space**, or the page scrolls while you play.
- **Support touch.** Everything must be playable on a phone: swipe or tap, no hover-only
  interactions, and canvases need `touchAction: "none"`.
- **No new dependencies without asking.** The stack is Next.js 15, React 19, MUI v7,
  better-sqlite3. Notably there is **no socket.io** — multiplayer needs a real decision
  first, not a quiet `npm install`.
- **Everything client-side by default.** These games need no server, no accounts, no DB.
  Reach for SQLite only when state genuinely must outlive the browser or be shared
  between players.

## Verifying your work

Never claim a game works without checking. Minimum bar:

```sh
npx tsc --noEmit                 # must be clean
npm run build                    # must succeed
```

Then actually exercise the logic. Prefer testing `logic.ts` directly over clicking
around, and cover the mean cases: reversals, fast double inputs, boundaries, terminal
states. Real bugs the Snake tests caught:

- two keypresses in one tick folding the snake into itself
- the tail tip counting as a collision when it actually vacates that tick

For UI-level checks against the deployed site, Nova Act is available (see
`.ralph/DEPLOY.local.md`).

## Deployment

Push to `main` auto-deploys via a GitHub webhook. A failed build leaves the previous
version running, so the site cannot be taken down by a bad commit — but do not lean on
that: build locally first.

Server details, ports, and secrets are in `.ralph/*.local.md`, which is **gitignored**.
This repo is **public** — never commit hostnames, IPs, secrets, or an inventory of the
other apps on the box.
