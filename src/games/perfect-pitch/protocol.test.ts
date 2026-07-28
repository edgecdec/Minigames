/**
 * Exercises the Perfect Pitch protocol as a hostile client would.
 *
 * Unlike the other .test.ts files here, this one needs a RUNNING SERVER — it
 * talks to the real API over HTTP, because what's being tested is the server's
 * refusal to be talked out of things, not a pure function.
 *
 *   SESSION_SECRET=local-dev npm run dev      # in one terminal
 *   npx tsx src/games/perfect-pitch/protocol.test.ts
 *
 * Point it somewhere else with PP_BASE=https://... to smoke-test a deploy.
 *
 * It imports the real mask functions, so it also proves the client and the
 * server agree on the encoding rather than each being self-consistently wrong.
 */
import { roundKey, unmaskCents } from "./mask";
import {
  RANGE_CENTS,
  centsAtHz,
  hzAtCents,
} from "./logic";

const BASE = process.env.PP_BASE ?? "http://localhost:3008";
const API = `${BASE}/api/perfect-pitch`;

let cookie = "";
async function call(payload: Record<string, unknown>) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, data };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
}

interface Wire {
  i: number;
  s: string;
  m: number;
  n: number[];
  sc: number;
}

const decode = (runId: string, r: Wire) =>
  unmaskCents(r.m, roundKey(runId, r.s, r.i));

/** A believable search: sweep, overshoot, come back, settle. */
function humanPath(start: number, end: number) {
  const pts = [{ t: 0, cents: start }];
  const over = end + 150;
  for (let i = 1; i <= 10; i++)
    pts.push({ t: 120 * i, cents: start + ((over - start) * i) / 10 });
  for (let i = 1; i <= 5; i++)
    pts.push({ t: 1200 + 80 * i, cents: over - (170 * i) / 5 });
  pts.push({ t: 1700, cents: end });
  return pts;
}

async function main() {
  // --- 1. start ---------------------------------------------------------------
  const started = await call({ action: "start" });
  check(
    "start returns a run and one round",
    started.status === 200 && !!started.data.runId && started.data.round?.i === 0,
  );
  const runId = started.data.runId as string;
  let round = started.data.round as Wire;

  // --- 2. the payload doesn't hand over the answer ----------------------------
  {
    const trueCents = decode(runId, round);
    const trueHz = hzAtCents(trueCents);
    const raw = JSON.stringify(started.data);
    const numbers = [...raw.matchAll(/-?\d+\.?\d*/g)].map((m) => Number(m[0]));

    const plaintext = numbers.filter(
      (n) => Math.abs(n - trueHz) < 1 || Math.abs(n - trueCents) < 1,
    );
    check(
      "no plaintext target anywhere in the response",
      plaintext.length === 0,
      `target ${trueHz.toFixed(1)} Hz / ${trueCents.toFixed(0)} cents`,
    );
    check(
      "the masked value isn't readable as cents",
      round.m > RANGE_CENTS * 1000,
      `m=${round.m}`,
    );
    check(
      "decoys are indistinguishable from the real one",
      round.n.length === 3 && round.n.every((d) => d > RANGE_CENTS * 1000),
    );
    check(
      "the real value is not identifiable by position or size",
      !round.n.includes(round.m),
    );
    check("only the start position is sent in the clear", round.sc >= 0 && round.sc <= RANGE_CENTS);
  }

  // --- 3. answering too fast is refused --------------------------------------
  const tooFast = await call({
    action: "guess", runId, roundIndex: 0, guessCents: round.sc + 100,
    listenMs: 100, huntMs: 50, trajectory: humanPath(round.sc, round.sc + 100),
  });
  check("a sub-second answer is rejected", tooFast.status === 400, tooFast.data.error);

  // --- 4. a normal round ------------------------------------------------------
  await sleep(900);
  const guess1 = round.sc + 250;
  const r1 = await call({
    action: "guess", runId, roundIndex: 0, guessCents: guess1,
    listenMs: 4000, huntMs: 1700, pointerType: "mouse",
    trajectory: humanPath(round.sc, guess1),
  });
  check("a plausible guess is scored", r1.status === 200 && typeof r1.data.result?.score === "number",
    `score ${r1.data.result?.score?.toFixed(2)}`);
  check("the server returns the next round", r1.data.next?.i === 1);

  // The server's own arithmetic must agree with what we decoded.
  {
    const expected = guess1 - decode(runId, round);
    check("server scoring matches the decoded target", Math.abs(r1.data.result.cents - expected) < 0.01,
      `server ${r1.data.result.cents.toFixed(3)} vs ${expected.toFixed(3)}`);
    check("the reveal names the target only after the round",
      Math.abs(centsAtHz(r1.data.result.targetHz) - decode(runId, round)) < 0.01);
  }

  // --- 5. a retry must not consume the next round -----------------------------
  await sleep(900);
  const retry = await call({
    action: "guess", runId, roundIndex: 0, guessCents: guess1, listenMs: 4000, huntMs: 1700,
    trajectory: humanPath(round.sc, guess1),
  });
  check("re-answering round 0 is refused", retry.status === 409, retry.data.error);

  // --- 6. can't submit an unfinished run -------------------------------------
  const early = await call({ action: "submit", runId, name: "Cheater" });
  check("an unfinished run can't be submitted", early.status === 409, early.data.error);

  // --- 7. finish the run ------------------------------------------------------
  round = r1.data.next as Wire;
  let total = r1.data.totalScore as number;
  while (round) {
    await sleep(900);
    const g = round.sc + 200;
    const res = await call({
      action: "guess", runId, roundIndex: round.i, guessCents: g,
      listenMs: 4000, huntMs: 1700, pointerType: "mouse",
      trajectory: humanPath(round.sc, g),
    });
    if (res.status !== 200) { check("finishing the run", false, JSON.stringify(res.data)); break; }
    total = res.data.totalScore;
    round = res.data.next as Wire;
  }
  check("the run completes after five rounds", round === null, `total ${total.toFixed(2)} / 50`);

  // --- 8. submit --------------------------------------------------------------
  const submitted = await call({ action: "submit", runId, name: "Protocol Test" });
  check("a finished run posts to the board", submitted.status === 200 && submitted.data.verified === true,
    `accepted=${submitted.data.accepted} best=${submitted.data.best}`);
  check("the board stores score x100", submitted.data.best === Math.round(total * 100));

  // --- 9. double submission ---------------------------------------------------
  const again = await call({ action: "submit", runId, name: "Protocol Test" });
  check("the same run can't be banked twice", again.status === 409, again.data.error);

  // --- 10. another player's run ------------------------------------------------
  const saved = cookie;
  cookie = "";
  await call({ action: "start" });
  const stolen = await call({ action: "guess", runId, roundIndex: 0, guessCents: 100, listenMs: 1, huntMs: 1 });
  check("a different player can't touch someone else's run", stolen.status === 404, stolen.data.error);
  cookie = saved;

  // --- 11. a forged trajectory --------------------------------------------------
  cookie = "";
  const cheat = await call({ action: "start" });
  const cheatRound = cheat.data.round as Wire;
  await sleep(900);
  const forged = await call({
    action: "guess", runId: cheat.data.runId, roundIndex: 0,
    guessCents: cheatRound.sc + 500, listenMs: 4000, huntMs: 1700,
    trajectory: humanPath(cheatRound.sc, cheatRound.sc + 10),
  });
  check("a guess whose path doesn't match it is still scored", forged.status === 200);

  // --- 12. the mask does NOT stop a determined attacker (and we say so) --------
  cookie = "";
  const bot = await call({ action: "start" });
  const botRun = bot.data.runId as string;
  let botRound = bot.data.round as Wire;
  let botTotal = 0;
  while (botRound) {
    await sleep(900);
    // Unmask it, exactly as anyone reading mask.ts could.
    const exact = decode(botRun, botRound);
    const res = await call({
      action: "guess", runId: botRun, roundIndex: botRound.i, guessCents: exact,
      listenMs: 4000, huntMs: 1700, trajectory: humanPath(botRound.sc, exact),
    });
    botTotal = res.data.totalScore;
    botRound = res.data.next as Wire;
  }
  check("unmasking still yields a perfect score", Math.abs(botTotal - 50) < 0.01,
    `total ${botTotal.toFixed(3)} - obfuscation is not the defence`);
  const botSubmit = await call({ action: "submit", runId: botRun, name: "Botty" });
  check("...but the statistics still refuse it a ranked place", botSubmit.data.verified === false,
    `flags: ${(botSubmit.data.flags ?? []).join(", ")}`);

  // --- 13. the shared endpoint must not offer a way around all of this -------
  {
    const res = await fetch(`${BASE}/api/leaderboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: "perfect-pitch", name: "Bypass", score: 5000 }),
    });
    check(
      "the generic leaderboard endpoint refuses this game",
      res.status === 403,
      `HTTP ${res.status} - otherwise every check above is bypassable`,
    );
  }

  console.log("");
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILURES:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main();
