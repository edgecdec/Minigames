/**
 * The two copies of the Land Grab maps must agree cell-for-cell.
 *
 * `server.js` is CommonJS loaded outside the webpack build, so the map shapes are
 * deliberately duplicated from `logic.ts`. That duplication is the dangerous kind:
 * a client drawing walls in one place while the server enforces them in another
 * looks like teleporting or invisible obstacles, not like a code bug.
 *
 * Needs no server — it imports both modules directly.
 *   npx tsx test/multiplayer/territory-map-parity.test.mjs
 *
 * The Spiral Vault caught two real defects this way: a half-cell centre that
 * produced no walls at all, and rings wider than the board degenerating into
 * unbroken lines that sealed off part of the map.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { MAPS: TS, buildGrid, WALL } = await import(
  path.join(REPO, "src/games/territory/logic.ts")
);
const srv = (await import(path.join(REPO, "src/games/territory/server.js"))).default;
const room = { players: new Map([["a",{id:"a",connected:true}],["b",{id:"b",connected:true}]]) };
let allOk = true;
for (const m of TS) {
  const base = srv.createState(room);
  // Ask the server for this map via its own settings path.
  let state = base;
  srv.onEvent({
    room, state, isHost: true, userId: "a",
    setState: (s) => { state = s; }, broadcast(){}, emitToPlayer(){},
  }, "settings", { mapName: m.name });
  const tsGrid = buildGrid(m);
  const sameDims = state.cols === m.cols && state.rows === m.rows;
  let diffs = 0;
  if (sameDims) {
    for (let i = 0; i < tsGrid.length; i++) {
      const tsWall = tsGrid[i] === WALL;
      const svWall = state.grid[i] === WALL;
      if (tsWall !== svWall) diffs++;
    }
  }
  const ok = sameDims && diffs === 0;
  if (!ok) allOk = false;
  console.log(`${ok ? "OK  " : "DIFF"} ${m.name}: dims ${state.cols}x${state.rows} vs ${m.cols}x${m.rows}, wall diffs=${diffs}`);
}
console.log(allOk ? "\nAll maps identical in both copies" : "\nMISMATCH");
process.exit(allOk ? 0 : 1);
