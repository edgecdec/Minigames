/**
 * Territory rules. Run with: npx tsx src/games/territory/logic.test.ts
 *
 * The flood fill is the part worth testing hardest: it is the only place where a
 * plausible-looking implementation can silently claim the whole board.
 *
 * These were rewritten when the game moved from trails to permanent claiming.
 * The old suite tested trail cutting, loop closing and respawning, none of which
 * exist any more — keeping them passing would have meant keeping the machinery.
 */
import {
  DIRS,
  ENEMY_SLOWDOWN,
  MAPS,
  OPEN,
  SPAWN_BLOCK,
  SPAWN_PROTECT_TICKS,
  WALL,
  absorbEnclosed,
  buildGrid,
  cellsOf,
  createGame,
  dirForKey,
  enclosedCells,
  findMap,
  idxIn,
  key,
  openCells,
  ownerOf,
  pickSpawns,
  queueTurn,
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

const fixedRng = () => 0.5;
const at = (s: TerritoryState, i: number) => s.players[i].at;
const gridAt = (s: TerritoryState, x: number, y: number) => s.grid[idxIn(s.cols, x, y)];

/** Put a player somewhere, facing a direction, with no queued turns. */
function place(s: TerritoryState, i: number, x: number, y: number, dir = DIRS.right) {
  s.players[i].at = { x, y };
  s.players[i].dir = dir;
  s.players[i].queued = [];
}

/** Paint a rectangle of ownership directly, bypassing the rules. */
function paint(s: TerritoryState, i: number, x0: number, y0: number, x1: number, y1: number) {
  const mark = ownerOf(i);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) s.grid[idxIn(s.cols, x, y)] = mark;
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
  t(`${m.name}: grid matches its own dimensions`, g.length === m.cols * m.rows, g.length);
  t(`${m.name}: only walls and open`, g.every((v) => v === WALL || v === OPEN));
  const playable = g.filter((v) => v === OPEN).length;
  // A silhouette is allowed to be mostly wall, but it must still be a board.
  t(`${m.name}: has room to play`, playable > 400, playable);
  t(`${m.name}: declares who it fits`, /\d/.test(m.bestFor), m.bestFor);
}
t("Open Field really is open", buildGrid(MAPS[0]).every((v) => v === OPEN));
t("shaped maps have walls", MAPS.filter((m) => buildGrid(m).some((v) => v === WALL)).length >= 4);
t("there are bigger boards for bigger lobbies",
  MAPS.some((m) => m.cols > 40 && m.rows > 40), MAPS.map((m) => `${m.cols}x${m.rows}`));
t("an unknown map name falls back to the first", findMap("nope").name === MAPS[0].name);
t("a known map name resolves", findMap("Cat").name === "Cat");
{
  // The silhouettes must be CONNECTED: an unreachable pocket can never be filled,
  // so the board would never end by being full.
  for (const name of ["Cat", "Dog", "Spiral Vault"]) {
    const m = findMap(name);
    const g = buildGrid(m);
    // Flood the open area from the first open cell and check we reach all of it.
    const first = g.findIndex((v) => v === OPEN);
    const seen = new Uint8Array(g.length);
    const stack = [first];
    seen[first] = 1;
    let reached = 0;
    while (stack.length) {
      const i = stack.pop()!;
      reached++;
      const x = i % m.cols;
      const y = (i - x) / m.cols;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || nx >= m.cols || ny < 0 || ny >= m.rows) return;
        const ni = idxIn(m.cols, nx, ny);
        if (seen[ni] || g[ni] === WALL) return;
        seen[ni] = 1;
        stack.push(ni);
      };
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    const open = g.filter((v) => v === OPEN).length;
    t(`${name}: every playable cell is reachable`, reached === open, `${reached}/${open}`);
  }
}
{
  // `art` must win over `mask`, and a ragged layout must pad rather than corrupt.
  const ragged = buildGrid({ name: "r", cols: 10, rows: 4, bestFor: "2", art: ["###"] });
  t("a ragged art map still fills its grid", ragged.length === 40);
  t("walls where given", ragged[idxIn(10, 0, 0)] === WALL && ragged[idxIn(10, 2, 0)] === WALL);
  t("open where absent", ragged[idxIn(10, 3, 0)] === OPEN && ragged[idxIn(10, 0, 3)] === OPEN);
}

// ---------- spawns ----------
for (const m of MAPS) {
  const g = buildGrid(m);
  const spawns = pickSpawns(8, g, m.cols, m.rows, Math.random);
  t(`${m.name}: one spawn per player`, spawns.length === 8);
  t(`${m.name}: no spawn block touches a wall`,
    spawns.every((s) => {
      for (let dy = -SPAWN_BLOCK; dy <= SPAWN_BLOCK; dy++) {
        for (let dx = -SPAWN_BLOCK; dx <= SPAWN_BLOCK; dx++) {
          const x = s.x + dx;
          const y = s.y + dy;
          if (x < 0 || x >= m.cols || y < 0 || y >= m.rows) return false;
          if (g[idxIn(m.cols, x, y)] === WALL) return false;
        }
      }
      return true;
    }), spawns);
  t(`${m.name}: spawns are distinct`, new Set(spawns.map(key)).size === 8, spawns);
}
{
  // A degenerate rng must STILL produce non-overlapping spawns. The gap loop used
  // to relax to 0, so two players landed on one cell and the second block erased
  // the first — that player started the round holding nothing.
  const g = createGame(["a", "b", "c", "d"], { rng: () => 0.5, phase: "playing" });
  t("a constant rng still gives everyone a full block",
    ["a", "b", "c", "d"].every((id) => cellsOf(g, id) === 9),
    ["a", "b", "c", "d"].map((id) => cellsOf(g, id)));
}

// ---------- opening state ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  t("both players exist", g.players.length === 2);
  t("each starts with a 3x3 block", cellsOf(g, "a") === 9 && cellsOf(g, "b") === 9,
    [cellsOf(g, "a"), cellsOf(g, "b")]);
  t("a round timer is set", g.ticksLeft > 0, g.ticksLeft);
  t("no winner or reason yet", g.winner === null && g.endReason === null);
  t("the board carries its own dimensions", g.cols === MAPS[0].cols && g.rows === MAPS[0].rows);
  t("player count is capped",
    createGame(new Array(20).fill(0).map((_, i) => `p${i}`)).players.length === 8);
  t("a bigger map produces a bigger grid",
    createGame(["a"], { mapName: "The Arena" }).grid.length >
      createGame(["a"], { mapName: "Open Field" }).grid.length);
}

// ---------- turning: REVERSING IS ALLOWED ----------
{
  // Snake forbids reversal because backing into your own body kills you. Nothing
  // here can hurt you from behind, and refusing the input made the controls feel
  // broken — you pressed left, nothing happened, and you kept walking into a wall.
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  g.players[0].dir = DIRS.right;
  g.players[0].queued = [];
  queueTurn(g, "a", DIRS.left);
  t("REVERSING is accepted", g.players[0].queued.length === 1, g.players[0].queued);

  const h = createGame(["a"], { rng: fixedRng, phase: "playing" });
  h.players[0].dir = DIRS.right;
  h.players[0].queued = [];
  queueTurn(h, "a", DIRS.right);
  t("the same direction is still a no-op", h.players[0].queued.length === 0);
  queueTurn(h, "a", DIRS.up);
  queueTurn(h, "a", DIRS.down);
  t("a reversal of a QUEUED turn is accepted too", h.players[0].queued.length === 2,
    h.players[0].queued);
  queueTurn(h, "a", DIRS.left);
  t("the queue is bounded at 2", h.players[0].queued.length === 2);
  t("turning an unknown player is a no-op", queueTurn(h, "ghost", DIRS.up) === h);
}
{
  // And it must actually take effect: walk right, turn back, end up left of start.
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  place(g, 0, 20, 20, DIRS.right);
  step(g);
  const after = at(g, 0).x;
  queueTurn(g, "a", DIRS.left);
  step(g);
  step(g);
  t("a reversal really moves you back", at(g, 0).x < after, [after, at(g, 0).x]);
}

// ---------- the flood fill ----------
{
  const cols = 40;
  const rows = 40;
  const grid = new Array<number>(cols * rows).fill(OPEN);
  for (let x = 10; x <= 20; x++) {
    grid[idxIn(cols, x, 10)] = 1;
    grid[idxIn(cols, x, 20)] = 1;
  }
  for (let y = 10; y <= 20; y++) {
    grid[idxIn(cols, 10, y)] = 1;
    grid[idxIn(cols, 20, y)] = 1;
  }
  const inside = enclosedCells(grid, cols, rows, (i) => grid[i] === 1);
  t("a closed ring encloses its interior", inside.length === 9 * 9, inside.length);

  // Break the ring and NOTHING is enclosed. This is the assertion that catches a
  // fill which "works" by claiming everything it doesn't already own.
  const leaky = grid.slice();
  leaky[idxIn(cols, 15, 10)] = OPEN;
  t("a broken ring encloses nothing",
    enclosedCells(leaky, cols, rows, (i) => leaky[i] === 1).length === 0);

  const empty = new Array<number>(cols * rows).fill(OPEN);
  t("an empty board encloses nothing",
    enclosedCells(empty, cols, rows, (i) => empty[i] === 1).length === 0);
  const full = new Array<number>(cols * rows).fill(1);
  t("a full board leaves nothing to enclose",
    enclosedCells(full, cols, rows, (i) => full[i] === 1).length === 0);
}
{
  // WALLS CONDUCT THE FILL rather than blocking it, and are never claimed.
  //
  // The fill seeds from the board border. On a silhouette every border cell is
  // wall, so a fill that treated walls as boundary never started: the whole
  // playable area read as "enclosed" and the first player to move instantly
  // claimed the entire board and ended the round. Real bug, found by a socket
  // trace — the pure-logic path never exercised a shaped map's border.
  //
  // The trade-off is deliberate: a nook you could previously close off using the
  // map's own rock as one side no longer counts. You must ring it with YOUR OWN
  // land. That is the rule the game wants anyway — the map shouldn't do your
  // enclosing for you.
  const cols = 30;
  const rows = 30;
  const grid = new Array<number>(cols * rows).fill(OPEN);
  for (let x = 5; x <= 9; x++) grid[idxIn(cols, x, 5)] = WALL;
  for (let x = 5; x <= 9; x++) grid[idxIn(cols, x, 9)] = 1;
  for (let y = 5; y <= 9; y++) grid[idxIn(cols, 5, y)] = WALL;
  for (let y = 5; y <= 9; y++) grid[idxIn(cols, 9, y)] = 1;
  const inside = enclosedCells(grid, cols, rows, (i) => grid[i] === 1 || grid[i] === WALL);
  t("a half-wall ring does NOT seal — the fill comes in through the rock",
    inside.length === 0, inside.length);
}
{
  // ...and the case that actually matters: on a fully walled-in silhouette, a ring
  // of your OWN land still seals normally.
  const m = findMap("Cat");
  const grid = buildGrid(m);
  const border: number[] = [];
  for (let x = 0; x < m.cols; x++) border.push(idxIn(m.cols, x, 0));
  t("the Cat's border really is all wall", border.every((i) => grid[i] === WALL));

  const MARK = 1;
  for (let x = 20; x <= 30; x++) {
    grid[idxIn(m.cols, x, 25)] = MARK;
    grid[idxIn(m.cols, x, 35)] = MARK;
  }
  for (let y = 25; y <= 35; y++) {
    grid[idxIn(m.cols, 20, y)] = MARK;
    grid[idxIn(m.cols, 30, y)] = MARK;
  }
  const inside = enclosedCells(grid, m.cols, m.rows, (i) => grid[i] === MARK || grid[i] === WALL);
  t("a land ring still seals on a fully walled silhouette", inside.length === 9 * 9,
    inside.length);
  t("and never returns a wall", inside.every((i) => grid[i] !== WALL));
}
{
  // The regression itself: on a shaped map, one player moving must NOT claim the
  // whole board. This is what the instant-end bug looked like.
  const g = createGame(["a", "b"], { phase: "playing", mapName: "Cat", roundSeconds: 60 });
  const openBefore = openCells(g);
  t("the Cat starts with plenty of open ground", openBefore > 1_000, openBefore);
  for (let i = 0; i < 10; i++) step(g);
  t("ten ticks do NOT fill the board", openCells(g) > openBefore - 100,
    `${openBefore} -> ${openCells(g)}`);
  t("and the round is still going", g.phase === "playing", `${g.phase}/${g.endReason}`);
  t("nobody owns the whole map", cellsOf(g, "a") < openBefore / 2, cellsOf(g, "a"));
}

// ---------- enclosure is the only way to LOSE ground ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  g.grid.fill(OPEN);
  // a rings a region that contains one of b's cells.
  for (let x = 10; x <= 20; x++) {
    g.grid[idxIn(g.cols, x, 10)] = ownerOf(0);
    g.grid[idxIn(g.cols, x, 20)] = ownerOf(0);
  }
  for (let y = 10; y <= 20; y++) {
    g.grid[idxIn(g.cols, 10, y)] = ownerOf(0);
    g.grid[idxIn(g.cols, 20, y)] = ownerOf(0);
  }
  g.grid[idxIn(g.cols, 15, 15)] = ownerOf(1);
  const bBefore = cellsOf(g, "b");
  const gained = absorbEnclosed(g, 0);

  t("sealing a region absorbs its interior", gained === 9 * 9, gained);
  t("including an enclosed enemy cell", gridAt(g, 15, 15) === ownerOf(0));
  t("so the victim loses it", cellsOf(g, "b") === bBefore - 1, [bBefore, cellsOf(g, "b")]);
  t("the enclosed stat is recorded", g.players[0].enclosed === gained);
  t("nothing outside the ring was taken", gridAt(g, 30, 30) === OPEN);
}
{
  // Walls inside a sealed region stay walls.
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  g.grid.fill(OPEN);
  g.grid[idxIn(g.cols, 15, 15)] = WALL;
  for (let x = 10; x <= 20; x++) {
    g.grid[idxIn(g.cols, x, 10)] = ownerOf(0);
    g.grid[idxIn(g.cols, x, 20)] = ownerOf(0);
  }
  for (let y = 10; y <= 20; y++) {
    g.grid[idxIn(g.cols, 10, y)] = ownerOf(0);
    g.grid[idxIn(g.cols, 20, y)] = ownerOf(0);
  }
  absorbEnclosed(g, 0);
  t("an enclosed wall is NOT claimed", gridAt(g, 15, 15) === WALL);
  t("but the cells around it are", gridAt(g, 14, 15) === ownerOf(0));
}

// ---------- claiming as you walk ----------
{
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  // Clear the grid first: place() teleports the player but leaves their spawn
  // block behind, so counting against the opening 9 would compare two unrelated
  // things. Start from an empty board and one owned cell under their feet.
  g.grid.fill(OPEN);
  g.players[0].everClaimed = 0;
  place(g, 0, 20, 20, DIRS.right);
  g.grid[idxIn(g.cols, 20, 20)] = ownerOf(0);
  const before = cellsOf(g, "a");
  step(g);
  t("stepping onto open ground claims it", gridAt(g, 21, 20) === ownerOf(0));
  t("the count went up", cellsOf(g, "a") === before + 1, [before, cellsOf(g, "a")]);
  t("everClaimed tracks it", g.players[0].everClaimed === 1, g.players[0].everClaimed);
}
{
  // A claimed cell is PERMANENT: walking back over your own ground changes nothing
  // and cannot cost you anything.
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  place(g, 0, 20, 20, DIRS.right);
  step(g);
  step(g);
  const held = cellsOf(g, "a");
  queueTurn(g, "a", DIRS.left);
  step(g);
  step(g);
  step(g);
  t("re-walking your own ground costs nothing", cellsOf(g, "a") === held,
    [held, cellsOf(g, "a")]);
  t("and there is no reset to trip over", g.phase === "playing");
}
{
  // Walls and edges stop you, they don't kill you.
  const g = createGame(["a"], { rng: fixedRng, phase: "playing" });
  place(g, 0, 10, 10, DIRS.right);
  g.grid[idxIn(g.cols, 11, 10)] = WALL;
  step(g);
  t("a wall blocks movement", at(g, 0).x === 10, at(g, 0));
  place(g, 0, g.cols - 1, 10, DIRS.right);
  step(g);
  t("the edge blocks movement", at(g, 0).x === g.cols - 1);
  t("neither ends the game", g.phase === "playing");
}

// ---------- raiding ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing", raidingAllowed: true });
  g.tick = SPAWN_PROTECT_TICKS;
  g.grid.fill(OPEN);
  paint(g, 1, 10, 10, 20, 20);
  place(g, 0, 9, 15, DIRS.right);
  step(g);
  t("raiding on: you take an enemy cell", gridAt(g, 10, 15) === ownerOf(0));
  t("and you are slowed for it", g.players[0].stallTicks === ENEMY_SLOWDOWN - 1,
    g.players[0].stallTicks);
  const held = { ...at(g, 0) };
  for (let i = 0; i < ENEMY_SLOWDOWN - 1; i++) step(g);
  t("the stall holds you in place", at(g, 0).x === held.x && at(g, 0).y === held.y, at(g, 0));
  step(g);
  t("then you move again", at(g, 0).x === held.x + 1, at(g, 0));
}
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing", raidingAllowed: false });
  g.tick = SPAWN_PROTECT_TICKS;
  g.grid.fill(OPEN);
  paint(g, 1, 10, 10, 20, 20);
  place(g, 0, 9, 15, DIRS.right);
  // Park the defender so they don't wander onto open ground and grow their own
  // count — b legitimately gaining cells by WALKING would look like a leak here.
  place(g, 1, 15, 15, DIRS.right);
  g.players[1].stallTicks = 9_999;
  const bBefore = cellsOf(g, "b");
  const cellsInsideB = () => {
    let n = 0;
    for (let y = 10; y <= 20; y++) {
      for (let x = 10; x <= 20; x++) if (gridAt(g, x, y) === ownerOf(0)) n++;
    }
    return n;
  };
  step(g);
  t("raiding off: enemy land is solid", at(g, 0).x === 9, at(g, 0));
  t("the enemy loses nothing", cellsOf(g, "b") === bBefore, [bBefore, cellsOf(g, "b")]);
  t("and no stall is applied", g.players[0].stallTicks === 0);
  // Keep hammering the border: repeated attempts must never get through.
  for (let i = 0; i < 20; i++) step(g);
  t("still solid after twenty attempts", cellsOf(g, "b") === bBefore,
    [bBefore, cellsOf(g, "b")]);
  t("the raider never took a single cell inside", cellsInsideB() === 0, cellsInsideB());
  t("and never got in", at(g, 0).x <= 9, at(g, 0));
}
{
  // Raiding off, walking over your OWN ground must not be blocked by the same
  // check — the guard is `owner !== mark`, and getting that wrong would freeze a
  // player inside their own territory.
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing", raidingAllowed: false });
  g.grid.fill(OPEN);
  paint(g, 0, 10, 10, 20, 20);
  place(g, 0, 12, 15, DIRS.right);
  step(g);
  t("raiding off: you can still move through your OWN land", at(g, 0).x === 13, at(g, 0));
  queueTurn(g, "a", DIRS.left);
  step(g);
  step(g);
  t("and turn around inside it", at(g, 0).x < 13, at(g, 0));
}

// ---------- the board filling up ends the round ----------
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  // Fill everything except one cell, then let a step take it.
  g.grid.fill(ownerOf(0));
  paint(g, 1, 0, 0, 5, 5);
  g.grid[idxIn(g.cols, 20, 20)] = OPEN;
  t("one cell left", openCells(g) === 1, openCells(g));
  place(g, 0, 19, 20, DIRS.right);
  step(g);
  t("filling the last cell ends the round", g.phase === "over", g.phase);
  t("and says why", g.endReason === "full", String(g.endReason));
  t("standings are recorded", (g.standings ?? []).length === 2);
  t("the leader wins", g.winner === "a", String(g.winner));
  t("a further step does nothing", step(g).tick === g.tick);
}
{
  // The clock is still a backstop for a stalemate.
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  g.ticksLeft = 1;
  paint(g, 0, 20, 20, 25, 25);
  step(g);
  t("running out of time ends the round", g.phase === "over", g.phase);
  t("with the time reason", g.endReason === "time", String(g.endReason));
  t("standings sorted by held ground",
    (g.standings ?? []).every((s, i, arr) => i === 0 || arr[i - 1].cells >= s.cells));
}
{
  const g = createGame(["a", "b"], { rng: fixedRng, phase: "playing" });
  resolveOutcome(g);
  t("equal land is a draw", g.winner === null, (g.standings ?? []).map((s) => s.cells));
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
  // On a shaped map the denominator must exclude rock, or the number can never
  // reach 100 even when someone owns every playable cell.
  const cat = createGame(["a"], { rng: fixedRng, phase: "playing", mapName: "Cat" });
  for (let i = 0; i < cat.grid.length; i++) {
    if (cat.grid[i] !== WALL) cat.grid[i] = ownerOf(0);
  }
  t("owning all playable ground is 100%", Math.round(sharePercent(cat, "a")) === 100,
    sharePercent(cat, "a"));
}

// ---------- a long random game stays consistent, on every map ----------
for (const m of MAPS) {
  const ids = ["a", "b", "c", "d"];
  const g = createGame(ids, { phase: "playing", mapName: m.name, roundSeconds: 60 });
  g.tick = SPAWN_PROTECT_TICKS;
  const dirs = [DIRS.up, DIRS.down, DIRS.left, DIRS.right];
  let ownedWall = false;
  let overCount = false;
  for (let n = 0; n < 3000 && g.phase === "playing"; n++) {
    if (n % 3 === 0) queueTurn(g, ids[n % ids.length], dirs[(n * 7) % 4]);
    step(g);
    if (n % 100 === 0) {
      for (let i = 0; i < g.grid.length; i++) {
        // A wall must never be owned by anyone.
        if (buildGrid(m)[i] === WALL && g.grid[i] !== WALL) ownedWall = true;
      }
      const held = ids.reduce((sum, id) => sum + cellsOf(g, id), 0);
      if (held > g.grid.filter((v) => v !== WALL).length) overCount = true;
    }
  }
  t(`${m.name}: walls are never claimed`, !ownedWall);
  t(`${m.name}: claims never exceed the playable board`, !overCount);
  t(`${m.name}: the round terminated`, g.phase === "over", `${g.phase}/${g.ticksLeft}`);
  t(`${m.name}: an end reason is set`, g.endReason !== null, String(g.endReason));
}

// ---------- ties share a place ----------
{
  // Inventing an order between equal players is a lie about the result, so equal
  // scores share a rank and the next distinct score skips: 1, T2, T2, 4.
  const g = createGame(["a", "b", "c", "d"], { rng: fixedRng, phase: "playing" });
  g.grid.fill(OPEN);
  paint(g, 0, 0, 0, 9, 9);       // a: 100
  paint(g, 1, 0, 20, 4, 24);     // b: 25
  paint(g, 2, 20, 20, 24, 24);   // c: 25
  paint(g, 3, 30, 30, 31, 31);   // d: 4
  resolveOutcome(g);
  const st = g.standings ?? [];
  t("a leads outright", st[0].userId === "a" && st[0].rank === 1 && !st[0].tied,
    JSON.stringify(st.map((r) => [r.userId, r.cells, r.rank, r.tied])));
  t("the two equal players SHARE second",
    st[1].rank === 2 && st[2].rank === 2 && st[1].tied && st[2].tied,
    JSON.stringify(st.map((r) => [r.userId, r.rank, r.tied])));
  t("and the next place SKIPS to 4, not 3", st[3].rank === 4 && !st[3].tied,
    JSON.stringify(st.map((r) => [r.userId, r.rank])));
  t("the outright leader still wins", g.winner === "a", String(g.winner));
}
{
  // Everyone equal: all share first, and nobody wins.
  const g = createGame(["a", "b", "c"], { rng: fixedRng, phase: "playing" });
  resolveOutcome(g);
  const st = g.standings ?? [];
  t("all-equal shares first", st.every((r) => r.rank === 1 && r.tied),
    JSON.stringify(st.map((r) => [r.cells, r.rank])));
  t("a tie at the top crowns nobody", g.winner === null, String(g.winner));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
