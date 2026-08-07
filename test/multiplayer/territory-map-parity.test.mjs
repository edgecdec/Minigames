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
const { MAPS: TS, buildGrid, WALL, RESPAWN_OPTIONS, ENEMY_SLOWDOWN_OPTIONS } = await import(
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

// ---------------------------------------------------------------- kill rules
//
// server.js does not export step(), so the catch RULE itself is covered by the
// logic tests (which drove it through four scenarios after it was wrong in three
// separate ways). What this asserts is the observable contract the client depends
// on, and that the settings allow-lists in the two copies are identical — a
// divergence there means a client offering a value the server silently rejects.
console.log("\n=== kill rules, server copy ===");
let killOk = true;
const kt = (name, cond, extra = "") => {
  if (!cond) { killOk = false; console.log("FAIL:", name, JSON.stringify(extra)); }
  else console.log("OK  ", name);
};

{
  const room = { players: new Map([["a", { id: "a", connected: true }], ["b", { id: "b", connected: true }]]) };
  const state = srv.createState(room);
  const pub = srv.publicState(room, state);
  kt("players expose alive", pub.players.every((p) => typeof p.alive === "boolean"));
  kt("players expose a respawn countdown", pub.players.every((p) => typeof p.respawnIn === "number"));
  kt("players expose the telegraphed respawn point",
    pub.players.every((p) => p.respawnAt === null || typeof p.respawnAt.x === "number"));
  kt("players expose kills and deaths",
    pub.players.every((p) => p.kills === 0 && p.deaths === 0));
  kt("the respawn delay is published", typeof pub.respawnTicks === "number", pub.respawnTicks);
  kt("respawn options are offered", Array.isArray(pub.options.respawnSeconds),
    pub.options.respawnSeconds);
  kt("spawn protection is gone", pub.protectedTicks === undefined);
  kt("the options match logic.ts",
    JSON.stringify(pub.options.respawnSeconds) === JSON.stringify([...RESPAWN_OPTIONS]),
    [pub.options.respawnSeconds, [...RESPAWN_OPTIONS]]);
  kt("enemy slowdown options match",
    JSON.stringify(pub.options.enemySlowdown) === JSON.stringify([...ENEMY_SLOWDOWN_OPTIONS]),
    [pub.options.enemySlowdown, [...ENEMY_SLOWDOWN_OPTIONS]]);
}

console.log(killOk ? "\nServer contract matches logic.ts" : "\nCONTRACT MISMATCH");
process.exit(allOk && killOk ? 0 : 1);
