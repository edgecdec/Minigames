# Multiplayer socket tests

These drive **real socket.io clients** against a **real server**, which is the
only way to test things the pure-logic suites structurally cannot reach: turn
timing, the server-owned clock, host authority, and surviving a restart.

The `logic.ts` unit tests still catch rule bugs faster and should stay the first
line of defence. These exist for the wiring around them.

## Running them

```sh
# needs a server you start yourself
PORT=3070 node test/multiplayer/duel-rules.test.mjs
PORT=3050 node test/multiplayer/pause.test.mjs

# these start and stop the server themselves — do NOT have one running
PORT=3080 node test/multiplayer/persistence.test.mjs
PORT=3081 node test/multiplayer/persistence-edges.test.mjs
```

For the first two, start a server first:

```sh
SESSION_SECRET=localtestsecret NODE_ENV=production PORT=3070 node server.js
```

`SESSION_SECRET` must match the value the suites sign their identity cookies
with (`localtestsecret`), or every client joins as a different anonymous player
and nothing reclaims its seat.

## What each covers

| File | Covers |
|---|---|
| `duel-rules.test.mjs` | Double It Duel: wrong answers keep the turn, misses fund nobody, the first-rotation clock cap and its lifting |
| `pause.test.mjs` | Host pause/resume across all three games, and that a paused room refuses game events |
| `persistence.test.mjs` | Full restart: SIGINT → snapshot → boot → restore → reclaim seats → resume → keep playing |
| `persistence-edges.test.mjs` | Lobby-only rooms aren't saved, finished games restore as finished, stale snapshots are dropped, Snake's tick freezes and resumes |

## Writing more of these — read this first

Every false failure I hit while building these was the harness, not the product.
The suites are shaped to prevent each one:

- **Own the server, don't assume one.** The persistence suites `spawn` it with an
  explicit `cwd`. An inherited working directory silently pointed `node
  server.js` at the wrong place, and the resulting "the room vanished" looked
  exactly like a persistence bug.
- **Wait for the port, not a fixed sleep.** And on shutdown wait for the port to
  be *released*, not just for the exit event. A lingering process meant the next
  phase quietly talked to the previous server and reported nonsense.
- **Refuse to start on an occupied port.** Adopting whatever is already listening
  is the single most misleading thing a suite can do.
- **Every phase stops the server it started.** One case leaking a server poisoned
  the next.
- **Don't disconnect clients before triggering a drain.** The sweeper can reap a
  room as empty first, so nothing gets saved. A real deploy kills the *server*
  while clients stay connected — test that.
- **Never assert on a live clock as if it were static.** The player on turn is
  burning time as you read it. Compare only players who aren't on the clock, or
  compare turn boundaries.
- **Assertions must be case-insensitive.** MUI uppercases headings in CSS, so
  `inner_text` returns `BEST RUNS`, not `Best runs`.
