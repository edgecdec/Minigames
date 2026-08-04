/**
 * Regression tests for the key-switch leak in useLocalStorage.
 *
 * These exercise the reducer-ish logic directly rather than mounting React:
 * the bug was that a key change only overwrote state when the NEW key already
 * held data, so a never-visited key inherited the previous key's value and the
 * next write persisted it under the wrong name. Any game with per-mode keys hit
 * this — Double It's per-multiplier boards made it visible.
 */

let pass = 0;
let fail = 0;
const t = (name: string, cond: boolean, extra = "") => {
  cond ? pass++ : (fail++, console.log("FAIL:", name, extra));
};

/** Mirrors the load-on-key-change branch of useLocalStorage. */
function loadForKey<T>(store: Record<string, string>, key: string, initial: T): T {
  let next = initial;
  try {
    const raw = key in store ? store[key] : null;
    if (raw !== null) next = JSON.parse(raw) as T;
  } catch {
    /* fall through to initial */
  }
  return next;
}

const store: Record<string, string> = {
  "minigames:leaderboard:double-it:3x": JSON.stringify([{ id: "a", score: 2 }]),
  "minigames:stats:double-it:3x": JSON.stringify({ runs: 1 }),
};

// The core regression: an unvisited key must yield `initial`, NOT the value the
// hook happened to be holding for the previous key.
t(
  "unvisited key falls back to initial, not the previous key's value",
  JSON.stringify(loadForKey(store, "minigames:leaderboard:double-it:8x", [])) === "[]",
);
t(
  "unvisited stats key yields the empty counters",
  JSON.stringify(loadForKey(store, "minigames:stats:double-it:8x", { runs: 0 })) ===
    JSON.stringify({ runs: 0 }),
);

// A populated key still loads its own data.
t(
  "populated key loads its own rows",
  JSON.stringify(loadForKey(store, "minigames:leaderboard:double-it:3x", [])) ===
    JSON.stringify([{ id: "a", score: 2 }]),
);

// Switching away and back must not merge the two.
const threeX = loadForKey<{ id: string; score: number }[]>(
  store,
  "minigames:leaderboard:double-it:3x",
  [],
);
const eightX = loadForKey<{ id: string; score: number }[]>(
  store,
  "minigames:leaderboard:double-it:8x",
  [],
);
t("boards do not share entries", threeX.every((e) => !eightX.some((o) => o.id === e.id)));
t("switching to a fresh mode starts empty", eightX.length === 0);

// Corrupt JSON must fall back rather than throw or leak.
const corrupt = { "minigames:best:x": "{not json" };
t("corrupt value falls back to initial", loadForKey(corrupt, "minigames:best:x", 0) === 0);

// A key holding a legitimately falsy value must still be honoured — a stored 0
// is a real best score, not a missing entry.
const falsy = { "minigames:best:y": JSON.stringify(0) };
const fallbackBest: number = 5;
t(
  "stored zero is loaded, not treated as missing",
  loadForKey(falsy, "minigames:best:y", fallbackBest) === 0,
);

console.log("---", "pass:", pass, "fail:", fail);
if (fail) process.exit(1);
