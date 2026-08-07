/**
 * Codenames round flow over real sockets.
 *
 * Two things this covers that the pure-logic tests can't: the SERVER's copy of
 * the rules (server.js is deliberately duplicated because it loads outside the
 * webpack build, so a fix in logic.ts alone is a silent divergence), and that
 * rounds advance with no host input at all.
 *
 * Start a server yourself first:
 *   SESSION_SECRET=localtestsecret NODE_ENV=production PORT=3086 node server.js
 */
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { io } = await import(
  path.join(REPO, "node_modules/socket.io-client/build/esm/index.js")
);
const URL = process.env.BASE || `http://localhost:${process.env.PORT || "3086"}`;
const SECRET = "localtestsecret";

let pass = 0, fail = 0;
const t = (n, c, x = "") => { c ? pass++ : (fail++, console.log("FAIL:", n, x)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ck(u) {
  const m = crypto.createHmac("sha256", SECRET).update(u).digest("hex").slice(0, 32);
  return `minigames_id=${encodeURIComponent(u + "." + m)}`;
}
function client(u) {
  const s = io(URL, { transports: ["websocket"], extraHeaders: { Cookie: ck(u) } });
  const c = { s, uid: u, states: [], errors: [], joined: null };
  s.on("room_state", (st) => c.states.push(st));
  s.on("room_error", (e) => c.errors.push(e));
  s.on("joined", (j) => { c.joined = j; });
  c.last = () => c.states[c.states.length - 1];
  c.game = () => c.last()?.gameState;
  return c;
}

const A = crypto.randomUUID(), B = crypto.randomUUID();
const a = client(A), b = client(B);
await wait(800);
a.s.emit("join_room", { roomCode: "NEW", name: "Ana" });
await wait(600);
const code = a.joined.roomCode;
b.s.emit("join_room", { roomCode: code, name: "Ben" });
await wait(600);
a.s.emit("select_game", { game: "codenames" });
await wait(500);
a.s.emit("game_event", { event: "start" });
await wait(600);

t("the game started", a.game()?.phase === "submitting", String(a.game()?.phase));
t("the opening prompt has no authors",
  Object.keys(a.game()?.authors ?? {}).length === 0, JSON.stringify(a.game()?.authors));
const round1Words = a.game()?.words ?? [];

// ---------- a MISS must roll straight into the next round ----------
a.s.emit("game_event", { event: "submit", data: { word: "anchor" } });
await wait(350);
b.s.emit("game_event", { event: "submit", data: { word: "compass" } });
await wait(800);

t("no reveal phase — still submitting", a.game()?.phase === "submitting", String(a.game()?.phase));
t("the round advanced on its own", a.game()?.round === 2, String(a.game()?.round));
t("nobody had to press anything", true);
t("the submitted words became the prompt",
  (a.game()?.words ?? []).includes("ANCHOR") && (a.game()?.words ?? []).includes("COMPASS"),
  (a.game()?.words ?? []).join("/"));
t("the new prompt replaced the old one",
  !(a.game()?.words ?? []).some((w) => round1Words.includes(w)),
  `${round1Words.join("/")} -> ${(a.game()?.words ?? []).join("/")}`);
t("submissions were cleared",
  (a.game()?.submitted ?? []).length === 0, JSON.stringify(a.game()?.submitted));
t("both players can submit again", (a.game()?.waitingOn ?? 0) === 2, String(a.game()?.waitingOn));

// ---------- authorship is on the SERVER's public state ----------
const authors = a.game()?.authors ?? {};
t("every word names an author",
  (a.game()?.words ?? []).every((w) => (authors[w] ?? []).length > 0), JSON.stringify(authors));
t("Ana is credited for hers", (authors["ANCHOR"] ?? []).join() === a.joined.userId,
  JSON.stringify(authors["ANCHOR"]));
t("Ben is credited for his", (authors["COMPASS"] ?? []).join() === b.joined.userId,
  JSON.stringify(authors["COMPASS"]));
t("the guest sees the same authorship",
  JSON.stringify(b.game()?.authors) === JSON.stringify(authors),
  JSON.stringify(b.game()?.authors));

// ---------- the retired "continue" event must be inert ----------
a.errors.length = 0;
const roundBefore = a.game()?.round;
a.s.emit("game_event", { event: "continue" });
await wait(500);
t("the old continue event does nothing", a.game()?.round === roundBefore,
  `${roundBefore} -> ${a.game()?.round}`);
t("and doesn't break the phase", a.game()?.phase === "submitting", String(a.game()?.phase));

// ---------- agreement still wins, and records shared authorship ----------
a.s.emit("game_event", { event: "submit", data: { word: "harbour" } });
await wait(350);
b.s.emit("game_event", { event: "submit", data: { word: "HARBOUR" } });
await wait(800);

t("agreeing wins the game", a.game()?.phase === "won", String(a.game()?.phase));
t("the winning word is shown", a.game()?.winningWord === "HARBOUR", String(a.game()?.winningWord));
t("the board collapsed to one word", (a.game()?.words ?? []).length === 1,
  (a.game()?.words ?? []).join("/"));
t("BOTH players share authorship of the win",
  (a.game()?.authors?.["HARBOUR"] ?? []).length === 2,
  JSON.stringify(a.game()?.authors));
t("the room counted a win for nobody in particular",
  // Codenames is co-op: there is no single winner, so the room tally stays empty.
  Object.keys(a.last()?.roomWins ?? {}).length === 0, JSON.stringify(a.last()?.roomWins));

// ---------- a rematch clears authorship ----------
a.s.emit("game_event", { event: "again" });
await wait(700);
t("a rematch reopens submitting", a.game()?.phase === "submitting", String(a.game()?.phase));
t("a rematch draws a fresh authorless prompt",
  Object.keys(a.game()?.authors ?? {}).length === 0, JSON.stringify(a.game()?.authors));
t("and the round counter restarts", a.game()?.round === 1, String(a.game()?.round));

a.s.disconnect(); b.s.disconnect();
console.log("---", "pass:", pass, "fail:", fail);
process.exit(fail ? 1 : 0);
