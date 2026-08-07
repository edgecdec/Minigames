/**
 * Territory rules. Run with: npx tsx src/games/territory/logic.test.ts
 *
 * The flood-fill claim is the part worth testing hardest: it is the only place
 * where a plausible-looking implementation can silently claim the whole board.
 */
import {
  COLS,
  DIRS,
  ENEMY_SLOWDOWN,
  MAPS,
  OPEN,
  ROWS,
  SPAWN_PROTECT_TICKS,
  WALL,
  buildGrid,
  cellsOf,
  closeLoop,
  createGame,
  dirForKey,
  enclosedCells,
  idx,
  key,
  ownerOf,
  pickSpawns,
  queueTurn,
  resetPlayer,
  resolveOutcome,
  sharePercent,
  step,
  type TerritoryState,
} from "./logic";

let pass = 0;
let fail = 0;
const t = (name: string, cond: boolean, extra: unknown = "") => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name, extra === "" ? "" : JSON.stringify(extra));
  }
};

/** Deterministic games: spawns land in fixed, known places. */
const fixedRng = () => 0.5;

/** Put a player somewhere with a known trail, for hand-built scenarios. */
function place(state: TerritoryState, i: number, at: { x: number; y: number }) {
  state.players[i].at = { ...at };
}

/** Paint a rectangle of ownership directly, bypassing the game rules. */
function paint(
  state: TerritoryState,
  i: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const mark = ownerOf(i);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      state.grid[idx(x, y)] = mark;
      state.players[i].owned.add(key({ x, y }));
    }
  }
}

// ---------- keys ----------
t("arrow keys map", dirForKey("ArrowUp") === DIRS.up);
t("wasd maps", dirForKey("d") === DIRS.right);
t("uppercase WASD maps", dirForKey("W") === DIRS.up);
t("unknown key is undefined", dirForKey("q") === undefined);

// ---------- maps ----------
for (const m of MAPS) {
  const g = buildGrid(m);
  t(`${m.name}: grid is the right size`, g.length === COLS * ROWS, g.length);
  t(`${m.name}: only walls and open`, g.every((v) => v === WALL || v === OPEN));
  // A map that is entirely wall would be unplayable, and one with no wall at all
  // is only correct for the deliberately empty map.
  const walls = g.filter((v) => v === WALL).length;
  t(`${m.name}: leaves room to play`, walls < g.length / 2, walls);
}
t("Open Field really is open", buildGrid(MAPS[0]).every((v) => v === OPEN));
t("other maps have walls", buildGrid(MAPS[1]).some((v) => v === WALL));
{
  // A short/ragged layout must not corrupt the grid — it pads instead.
  const ragged = buildGrid({ name: "ragged", rows: ["###"] });
  t("a ragged map still fills the grid", ragged.length === COLS * ROWS);
  t("its first row is walled where given",
    ragged[idx(0, 0)] === WALL && ragged[idx(2, 0)] === WALL);
  t("and open where absent", ragged[idx(3, 0)] === OPEN && ragged[idx(0, 5)] === OPEN);
}

// ---------- spawns ----------
{
  const grid = buildGrid(MAPS[0]);
  const spawns = pickSpawns(8, grid, Math.random);
  t("one spawn per player", spawns.length === 8);
  t("all spawns in bounds",
    spawns.every((s) => s.x > 0 && s.x < COLS - 1 && s.y > 0 && s.y < ROWS - 1),
    spawns);
  t("spawns are distinct", new Set(spawns.map(key)).size === 8, spawns);
}
{
  // A degenerate rng returning one value must STILL produce usable spawns. The
  // relaxing gap loop used to bottom out at 0 and stack every player on one cell,
  // so the second player's starting block erased the first's.
  const grid = buildGrid(MAPS[0]);
  const spawns = pickSpawns(4, grid, () => 0.5);
  t("a constant rng still yields distinct spawns",
    new Set(spawns.map(key)).size === 4, spawns);
  t("and their blocks don't overlap",
    spawns.every((a, i) =>
      spawns.every((b, j) =>
        i === j || Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) >= 3)),
    spawns);
  const g = createGame(["a", "b", "c", "d"], { rng: () => 0.5, phase: "playing" });
  t("so every player really starts with a full block",
    ["a", "b", "c", "d"].every((id) => cellsOf(g, id) === 9),
    ["a", "b", "c", "d"].map((id) => cellsOf(g, id)));
}
{
  // Never spawn inside rock: the whole 3x3 block has to be clear.
  const walled = buildGrid(MAPS[1]);
  const spawns = pickSpawns(8, walled, Math.random);
  t("no spawn lands on a wall",
    spawns.every((s) => walled[idx(s.x, s.y)] !== WALL), spawns);
  t("no spawn's block touches a wall",
    spawns.every((s) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (walled[idx(s.x + dx, s.y + dy)] === WALL) return false;
        }
      }
      return true;
    }), spawns);
}

// ---------- opening state ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  t("both players exist", g.players.length === 2);
  t("each starts with a 3x3 block", cellsOf(g, "a") === 9 && cellsOf(g, "b") === 9,
    [cellsOf(g, "a"), cellsOf(g, "b")]);
  t("nobody starts with a trail", g.players.every((p) => p.trail.length === 0));
  t("the grid agrees with the owned sets",
    g.grid.filter((v) => v === ownerOf(0)).length === cellsOf(g, "a"));
  t("a round timer is set", g.ticksLeft > 0, g.ticksLeft);
  t("no winner yet", g.winner === null && g.standings === null);
  t("player count is capped", createGame(new Array(20).fill(0).map((_, i) => `p${i}`)).players.length === 8);
  t("an unknown map falls back to the first",
    createGame(["a"], { mapName: "nope" }).mapName === MAPS[0].name);
  t("a named map is honoured",
    createGame(["a"], { mapName: MAPS[1].name }).mapName === MAPS[1].name);
}

// ---------- turning ----------
{
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  g.players[0].dir = DIRS.right;
  queueTurn(g, "a", DIRS.left);
  t("a reversal is ignored", g.players[0].queued.length === 0);
  queueTurn(g, "a", DIRS.right);
  t("the same direction is ignored", g.players[0].queued.length === 0);
  queueTurn(g, "a", DIRS.up);
  t("a real turn queues", g.players[0].queued.length === 1);
  queueTurn(g, "a", DIRS.left);
  t("a second turn queues", g.players[0].queued.length === 2);
  queueTurn(g, "a", DIRS.down);
  t("the queue is bounded at 2", g.players[0].queued.length === 2);
  // A reversal relative to the QUEUED direction, not the current one — this is
  // what stops two keys in one tick folding you onto your own trail.
  const h = createGame(["a"], { rng: fixedRng, phase: "playing" });
  h.players[0].dir = DIRS.right;
  h.players[0].queued = [];
  queueTurn(h, "a", DIRS.up);
  queueTurn(h, "a", DIRS.down);
  t("a reversal of the QUEUED dir is ignored", h.players[0].queued.length === 1,
    h.players[0].queued);
  t("turning an unknown player is a no-op", queueTurn(h, "ghost", DIRS.up) === h);
}

// ---------- the flood fill ----------
{
  // A ring of boundary with a hole in the middle: the hole is enclosed.
  const grid = new Array<number>(COLS * ROWS).fill(OPEN);
  for (let x = 10; x <= 20; x++) {
    grid[idx(x, 10)] = 1;
    grid[idx(x, 20)] = 1;
  }
  for (let y = 10; y <= 20; y++) {
    grid[idx(10, y)] = 1;
    grid[idx(20, y)] = 1;
  }
  const inside = enclosedCells(grid, (i) => grid[i] === 1);
  t("a closed ring encloses its interior", inside.length === 9 * 9, inside.length);
  t("the enclosed cells are the interior",
    inside.every((i) => {
      const x = i % COLS;
      const y = (i - x) / COLS;
      return x > 10 && x < 20 && y > 10 && y < 20;
    }));

  // Break the ring: nothing is enclosed any more. This is the assertion that
  // catches a fill which "works" by claiming everything not already owned.
  const leaky = grid.slice();
  leaky[idx(15, 10)] = OPEN;
  t("a broken ring encloses nothing",
    enclosedCells(leaky, (i) => leaky[i] === 1).length === 0);
}
{
  // An empty board must enclose nothing at all.
  const empty = new Array<number>(COLS * ROWS).fill(OPEN);
  t("an empty board encloses nothing",
    enclosedCells(empty, (i) => empty[i] === 1).length === 0);
  // And a fully-owned board leaves nothing to enclose.
  const full = new Array<number>(COLS * ROWS).fill(1);
  t("a full board encloses nothing", enclosedCells(full, (i) => full[i] === 1).length === 0);
}
{
  // A pocket sealed by a MIX of wall and player land still counts as enclosed —
  // this is what makes designed maps work rather than being a special case.
  const grid = new Array<number>(COLS * ROWS).fill(OPEN);
  for (let x = 5; x <= 9; x++) grid[idx(x, 5)] = WALL;
  for (let x = 5; x <= 9; x++) grid[idx(x, 9)] = 1;
  for (let y = 5; y <= 9; y++) grid[idx(5, y)] = WALL;
  for (let y = 5; y <= 9; y++) grid[idx(9, y)] = 1;
  const inside = enclosedCells(grid, (i) => grid[i] === 1 || grid[i] === WALL);
  t("wall + land seals a pocket", inside.length === 3 * 3, inside.length);
}

// ---------- closing a loop ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  // Hand-build: a owns a column, and trails out and back to enclose a pocket.
  g.players[0].owned.clear();
  g.grid.fill(OPEN);
  paint(g, 0, 5, 5, 5, 9);           // vertical wall of own land at x=5
  g.players[0].trail = [
    { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 },
    { x: 7, y: 8 }, { x: 7, y: 9 }, { x: 6, y: 9 },
  ];
  const before = cellsOf(g, "a");
  const gained = closeLoop(g, 0);
  t("closing claims the trail itself", g.grid[idx(7, 7)] === ownerOf(0));
  t("and the pocket it encircles", g.grid[idx(6, 7)] === ownerOf(0),
    g.grid[idx(6, 7)]);
  t("the gain is reported", gained === cellsOf(g, "a") - before, [gained, before]);
  t("the trail is cleared", g.players[0].trail.length === 0);
  t("everClaimed accumulates", g.players[0].everClaimed === gained);
  t("nothing outside the loop was taken", g.grid[idx(20, 20)] === OPEN);
  t("the owned set matches the grid",
    g.grid.filter((v) => v === ownerOf(0)).length === cellsOf(g, "a"));
}
{
  // Closing over an OPPONENT's land takes it off them — and their count must drop,
  // or the two bookkeeping systems drift apart.
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  g.grid.fill(OPEN);
  g.players.forEach((p) => p.owned.clear());
  paint(g, 0, 5, 5, 5, 9);
  paint(g, 1, 6, 7, 6, 7);           // b owns a single cell inside the pocket
  const bBefore = cellsOf(g, "b");
  g.players[0].trail = [
    { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 },
    { x: 7, y: 8 }, { x: 7, y: 9 }, { x: 6, y: 9 },
  ];
  closeLoop(g, 0);
  t("an enclosed enemy cell changes hands", g.grid[idx(6, 7)] === ownerOf(0));
  t("and the victim's count drops", cellsOf(g, "b") === bBefore - 1,
    [bBefore, cellsOf(g, "b")]);
  t("the victim's owned set no longer lists it",
    !g.players[1].owned.has(key({ x: 6, y: 7 })));
}
{
  // Walls inside an enclosed region stay walls.
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  g.grid.fill(OPEN);
  g.players[0].owned.clear();
  g.grid[idx(6, 7)] = WALL;
  paint(g, 0, 5, 5, 5, 9);
  g.players[0].trail = [
    { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 },
    { x: 7, y: 8 }, { x: 7, y: 9 }, { x: 6, y: 9 },
  ];
  closeLoop(g, 0);
  t("an enclosed wall is NOT claimed", g.grid[idx(6, 7)] === WALL);
  t("but the open cells around it are", g.grid[idx(6, 6)] === ownerOf(0));
}

// ---------- movement and claiming, through step() ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  // Skip protection so collisions are live.
  g.tick = SPAWN_PROTECT_TICKS;
  const start = { ...g.players[0].at };
  g.players[0].dir = DIRS.right;
  // Walk off own land: a trail must start.
  step(g);
  step(g);
  t("leaving own land starts a trail", g.players[0].trail.length > 0,
    g.players[0].trail.length);
  t("the player actually moved", g.players[0].at.x !== start.x);
}
{
  // A wall stops you rather than killing you.
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  g.tick = SPAWN_PROTECT_TICKS;
  place(g, 0, { x: 10, y: 10 });
  g.grid[idx(11, 10)] = WALL;
  g.players[0].dir = DIRS.right;
  g.players[0].queued = [];
  const resets = g.players[0].timesReset;
  step(g);
  t("a wall blocks movement", g.players[0].at.x === 10, g.players[0].at);
  t("and does NOT reset the player", g.players[0].timesReset === resets);
}
{
  // The board edge behaves the same way.
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  g.tick = SPAWN_PROTECT_TICKS;
  place(g, 0, { x: COLS - 1, y: 10 });
  g.players[0].dir = DIRS.right;
  g.players[0].queued = [];
  const resets = g.players[0].timesReset;
  step(g);
  t("the edge blocks movement", g.players[0].at.x === COLS - 1);
  t("and does not reset", g.players[0].timesReset === resets);
}
{
  // Crossing your OWN trail resets you.
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  g.tick = SPAWN_PROTECT_TICKS;
  place(g, 0, { x: 20, y: 20 });
  g.players[0].trail = [{ x: 21, y: 20 }];
  g.players[0].dir = DIRS.right;
  g.players[0].queued = [];
  const resets = g.players[0].timesReset;
  step(g);
  t("crossing your own trail resets you", g.players[0].timesReset === resets + 1);
  t("and clears the trail", g.players[0].trail.length === 0);
}

// ---------- enemy ground is slower ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  g.tick = SPAWN_PROTECT_TICKS;
  g.grid.fill(OPEN);
  g.players.forEach((p) => p.owned.clear());
  paint(g, 1, 10, 10, 20, 20);       // b owns a block
  place(g, 0, { x: 9, y: 15 });      // a is just outside it
  g.players[0].dir = DIRS.right;
  g.players[0].queued = [];

  step(g);                            // steps onto open? no — onto b's land at x=10
  t("a moved onto enemy ground", g.players[0].at.x === 10, g.players[0].at);
  t("and is now stalled", g.players[0].stallTicks === ENEMY_SLOWDOWN - 1,
    g.players[0].stallTicks);

  const at = { ...g.players[0].at };
  for (let i = 0; i < ENEMY_SLOWDOWN - 1; i++) step(g);
  t("the stall holds them in place",
    g.players[0].at.x === at.x && g.players[0].at.y === at.y, g.players[0].at);
  step(g);
  t("then they move again", g.players[0].at.x === at.x + 1, g.players[0].at);
}
{
  // With raiding off, enemy land is impassable instead of slow.
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing", raidingAllowed: false });
  g.tick = SPAWN_PROTECT_TICKS;
  g.grid.fill(OPEN);
  g.players.forEach((p) => p.owned.clear());
  paint(g, 1, 10, 10, 20, 20);
  place(g, 0, { x: 9, y: 15 });
  g.players[0].dir = DIRS.right;
  g.players[0].queued = [];
  step(g);
  t("raiding off: enemy land is impassable", g.players[0].at.x === 9, g.players[0].at);
  t("and no stall is applied", g.players[0].stallTicks === 0);
}

// ---------- cutting a trail resets the victim ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  g.tick = SPAWN_PROTECT_TICKS;
  g.grid.fill(OPEN);
  g.players.forEach((p) => p.owned.clear());
  paint(g, 0, 2, 2, 4, 4);
  paint(g, 1, 30, 30, 32, 32);
  // b is out on an excursion with a trail; a is about to run into it.
  g.players[1].trail = [{ x: 15, y: 15 }, { x: 15, y: 16 }];
  place(g, 1, { x: 15, y: 16 });
  place(g, 0, { x: 14, y: 15 });
  g.players[0].dir = DIRS.right;
  g.players[0].queued = [];
  g.players[1].dir = DIRS.down;
  g.players[1].queued = [];
  const bCellsBefore = cellsOf(g, "b");
  step(g);
  t("hitting a trail resets its owner", g.players[1].timesReset === 1);
  t("the victim's trail is gone", g.players[1].trail.length === 0);
  t("the victim is back to a spawn block", cellsOf(g, "b") === 9,
    [bCellsBefore, cellsOf(g, "b")]);
  t("the attacker is untouched", g.players[0].timesReset === 0);
}
{
  // Spawn protection must prevent that entirely.
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  g.tick = 0;
  g.grid.fill(OPEN);
  g.players.forEach((p) => p.owned.clear());
  g.players[1].trail = [{ x: 15, y: 15 }];
  place(g, 1, { x: 15, y: 15 });
  place(g, 0, { x: 14, y: 15 });
  g.players[0].dir = DIRS.right;
  g.players[0].queued = [];
  step(g);
  t("protected players can't be reset", g.players[1].timesReset === 0);
  t("protection is reported", SPAWN_PROTECT_TICKS > 0);
}
{
  // Mutual cut in one tick: BOTH go home. Applying resets as they are found would
  // let the lower index win by accident.
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  g.tick = SPAWN_PROTECT_TICKS;
  g.grid.fill(OPEN);
  g.players.forEach((p) => p.owned.clear());
  place(g, 0, { x: 10, y: 10 });
  place(g, 1, { x: 11, y: 10 });
  // Movement happens before collisions, so each trail must cover the cell the
  // OTHER head is about to step onto.
  g.players[0].trail = [{ x: 11, y: 9 }];
  g.players[1].trail = [{ x: 10, y: 9 }];
  g.players[0].dir = DIRS.up;
  g.players[1].dir = DIRS.up;
  g.players.forEach((p) => (p.queued = []));
  step(g);
  t("a mutual cut resets both",
    g.players[0].timesReset === 1 && g.players[1].timesReset === 1,
    [g.players[0].timesReset, g.players[1].timesReset]);
}

// ---------- reset semantics ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  paint(g, 0, 20, 20, 29, 29);       // a is big
  const bigger = cellsOf(g, "a");
  t("a had a lot of land", bigger > 50, bigger);
  resetPlayer(g, 0, Math.random);
  t("a reset wipes their land to one block", cellsOf(g, "a") === 9, cellsOf(g, "a"));
  t("the grid no longer shows the old land",
    g.grid.filter((v) => v === ownerOf(0)).length === 9);
  t("timesReset is counted", g.players[0].timesReset === 1);
  t("resetAtTick is stamped for the UI", g.players[0].resetAtTick !== null);
  t("the other player is unaffected", cellsOf(g, "b") === 9);
  t("owned set and grid agree after a reset",
    g.grid.filter((v) => v === ownerOf(0)).length === cellsOf(g, "a"));
}

// ---------- the round ends on the timer ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  g.ticksLeft = 1;
  paint(g, 0, 20, 20, 25, 25);       // a holds more
  step(g);
  t("the round ends when the timer runs out", g.phase === "over", g.phase);
  t("standings are recorded", (g.standings ?? []).length === 2);
  t("standings are sorted by cells",
    (g.standings ?? [])[0].cells >= (g.standings ?? [])[1].cells);
  t("the leader wins", g.winner === "a", String(g.winner));
  t("a further step does nothing", step(g).tick === g.tick);
}
{
  // A tie for first must NOT crown anybody: the room counts wins off `winner`.
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  resolveOutcome(g);
  t("equal land is a draw", g.winner === null,
    (g.standings ?? []).map((s) => s.cells));
}
{
  // A single player is trivially the winner.
  const solo = createGame(["a"], { rng: fixedRng, phase: "playing" });
  resolveOutcome(solo);
  t("one player wins by default", solo.winner === "a");
}

// ---------- share percentage ----------
{
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  t("share is a sane percentage", sharePercent(g, "a") > 0 && sharePercent(g, "a") < 5,
    sharePercent(g, "a"));
  t("an unknown player holds nothing", sharePercent(g, "ghost") === 0);
  // On a walled map the denominator must exclude rock, or the numbers never reach
  // 100 even when someone owns everything claimable.
  const walled = createGame(["a"], { rng: fixedRng, phase: "playing", mapName: MAPS[1].name });
  for (let i = 0; i < walled.grid.length; i++) {
    if (walled.grid[i] !== WALL) {
      walled.grid[i] = ownerOf(0);
      const x = i % COLS;
      walled.players[0].owned.add(key({ x, y: (i - x) / COLS }));
    }
  }
  t("owning all open ground is 100%", Math.round(sharePercent(walled, "a")) === 100,
    sharePercent(walled, "a"));
}

// ---------- a long random game stays consistent ----------
{
  // The invariant that catches almost everything: the grid and the owned sets must
  // never disagree, and nobody may own a wall.
  const ids = ["a", "b", "c", "d"];
  const g = createGame(ids, { phase: "playing", mapName: MAPS[2].name });
  g.tick = SPAWN_PROTECT_TICKS;
  const dirs = [DIRS.up, DIRS.down, DIRS.left, DIRS.right];
  let consistent = true;
  let ownedWall = false;
  for (let n = 0; n < 4000 && g.phase === "playing"; n++) {
    // Random inputs, which is how real players find the edge cases.
    if (n % 3 === 0) {
      const p = ids[n % ids.length];
      queueTurn(g, p, dirs[(n * 7) % 4]);
    }
    step(g);
    if (n % 50 === 0) {
      g.players.forEach((p, i) => {
        const onGrid = g.grid.filter((v) => v === ownerOf(i)).length;
        if (onGrid !== p.owned.size) consistent = false;
        for (const k of p.owned) {
          const [x, y] = k.split(",").map(Number);
          if (g.grid[idx(x, y)] === WALL) ownedWall = true;
        }
      });
    }
  }
  t("grid and owned sets never diverge over a long game", consistent);
  t("nobody ever owns a wall", !ownedWall);
  t("the game terminated", g.phase === "over", g.phase);
  t("total claims never exceed the claimable board",
    g.players.reduce((n, p) => n + p.owned.size, 0) <=
      g.grid.filter((v) => v !== WALL).length);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
