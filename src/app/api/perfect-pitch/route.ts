import { NextResponse } from "next/server";
import { BOARD_LIMIT, getBoard, getMyEntry, submitScore } from "@/lib/db";
import {
  cookieName,
  cookieOptions,
  getOrCreateUserId,
} from "@/lib/identity";
import { cleanName } from "@/lib/names";
import { rateLimit } from "@/lib/rateLimit";
import {
  type GuessInput,
  RunError,
  claimRunForSubmission,
  recordGuess,
  resumeRun,
  startRun,
} from "@/games/perfect-pitch/queries";
import { BOARD_SCALE, SLUG } from "@/games/perfect-pitch/shared";

export const dynamic = "force-dynamic";

/**
 * Perfect Pitch runs, scored server-side.
 *
 * Every other game posts a finished score and is believed, which is fine when
 * cheating means writing a bot. Here the answer is a single number, so a
 * posted score would be one console edit away from 50/50. Instead the server
 * draws the targets, hands out one tone at a time, and does the arithmetic.
 *
 * The client is still told each target frequency — it has to be, to make a
 * sound — so this doesn't make cheating impossible. It makes it require
 * faking five separate exchanges, with timing and a movement path that have to
 * agree with each other.
 */

/** Bigger than the shared 512-byte cap: a guess carries a movement path. */
const MAX_BODY_BYTES = 8 * 1024;
/** Enough to describe a search; anything more is someone probing. */
const MAX_TRAJECTORY_POINTS = 64;

/** Runs started per minute, per player. Generous for a human, not a script. */
const START_LIMIT = 12;

type Action = "start" | "resume" | "guess" | "submit";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** Trims and sanity-checks a client-supplied movement path. */
function cleanTrajectory(raw: unknown): { t: number; cents: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { t: number; cents: number }[] = [];
  for (const point of raw.slice(0, MAX_TRAJECTORY_POINTS)) {
    if (typeof point !== "object" || point === null) continue;
    const { t, cents } = point as Record<string, unknown>;
    if (typeof t !== "number" || typeof cents !== "number") continue;
    if (!Number.isFinite(t) || !Number.isFinite(cents)) continue;
    out.push({ t, cents });
  }
  return out;
}

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return bad("Body too large", 413);
  }

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return bad("Body too large", 413);
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return bad("Invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON");
  }

  const action = body.action as Action;

  // Identity signing needs a configured secret. Rather than a bare 500, say so
  // and tell the client to fall back to offline play — an unranked game is a
  // much better outcome than a broken one.
  let userId: string;
  let freshToken: string | null;
  try {
    ({ userId, freshToken } = await getOrCreateUserId());
  } catch {
    return NextResponse.json(
      {
        error: "Online play is unavailable on this server",
        offline: true,
      },
      { status: 503 },
    );
  }

  const withCookie = (payload: unknown, status = 200) => {
    const res = NextResponse.json(payload, { status });
    if (freshToken) res.cookies.set(cookieName, freshToken, cookieOptions);
    return res;
  };

  try {
    switch (action) {
      case "start": {
        const limit = rateLimit(`pp:start:${userId}`, START_LIMIT);
        if (!limit.ok) {
          return NextResponse.json(
            { error: "Slow down a moment" },
            {
              status: 429,
              headers: { "Retry-After": String(limit.retryAfterSec) },
            },
          );
        }
        const { runId, round } = startRun(userId);
        return withCookie({ runId, round, answered: 0 });
      }

      case "resume":
        return withCookie(resumeRun(body.runId, userId));

      case "guess": {
        if (typeof body.roundIndex !== "number") {
          return bad("Missing round index");
        }
        const input: GuessInput = {
          roundIndex: body.roundIndex,
          guessCents: Number(body.guessCents),
          listenMs: Number(body.listenMs),
          huntMs: Number(body.huntMs),
          pointerType:
            typeof body.pointerType === "string" ? body.pointerType : undefined,
          trajectory: cleanTrajectory(body.trajectory),
        };
        return withCookie(recordGuess(body.runId, userId, input));
      }

      case "submit": {
        const name = cleanName(body.name);
        if (!name.ok) return bad(name.error ?? "Invalid name");

        const limit = rateLimit(`pp:submit:${userId}`);
        if (!limit.ok) {
          return NextResponse.json(
            { error: "Too many submissions - slow down" },
            {
              status: 429,
              headers: { "Retry-After": String(limit.retryAfterSec) },
            },
          );
        }

        const claim = claimRunForSubmission(body.runId, userId);
        if (!claim.verified) {
          return withCookie(
            {
              accepted: false,
              verified: false,
              flags: claim.flags,
              error: "This run didn't pass the plausibility checks",
              entries: getBoard(SLUG, userId, BOARD_LIMIT),
              me: getMyEntry(SLUG, userId),
            },
            200,
          );
        }

        // Stored x100 so the shared integer score column keeps the decimals
        // that separate two good players.
        const { accepted, best } = submitScore(
          SLUG,
          userId,
          name.name,
          Math.round(claim.totalScore * BOARD_SCALE),
        );

        return withCookie({
          accepted,
          verified: true,
          best,
          name: name.name,
          entries: getBoard(SLUG, userId, BOARD_LIMIT),
          me: getMyEntry(SLUG, userId),
        });
      }

      default:
        return bad("Unknown action");
    }
  } catch (err) {
    if (err instanceof RunError) return bad(err.message, err.status);
    console.error("perfect-pitch route:", err);
    return NextResponse.json(
      { error: "Online play is unavailable right now", offline: true },
      { status: 503 },
    );
  }
}
