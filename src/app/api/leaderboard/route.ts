import { NextResponse } from "next/server";
import { BOARD_LIMIT, getBoard, getMyEntry, submitScore } from "@/lib/db";
import {
  cookieName,
  cookieOptions,
  getOrCreateUserId,
  getUserIdIfPresent,
} from "@/lib/identity";
import { MAX_BODY_BYTES, cleanName, cleanScore } from "@/lib/names";
import { rateLimit } from "@/lib/rateLimit";
import { getGameForBoard } from "@/games/registry";

export const dynamic = "force-dynamic";

/** GET /api/leaderboard?game=snake — top scores plus the caller's standing. */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("game") ?? "";
  // Accepts a game slug or a declared board variant (e.g. "double-it:5x").
  if (!getGameForBoard(slug)) {
    return NextResponse.json({ error: "Unknown game" }, { status: 400 });
  }

  // Read-only: don't mint an id (and a Set-Cookie) just for viewing a board.
  const userId = await getUserIdIfPresent();

  return NextResponse.json({
    game: slug,
    entries: getBoard(slug, userId, BOARD_LIMIT),
    me: userId ? getMyEntry(slug, userId) : null,
  });
}

/** POST /api/leaderboard — body: { game, name, score } */
export async function POST(req: Request) {
  // Reject oversized bodies before parsing. Content-Length can lie, so the
  // text is length-checked again below.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Body too large" }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { game, name, score } = body as Record<string, unknown>;

  const slug = typeof game === "string" ? game : "";
  const meta = getGameForBoard(slug);
  if (!meta) {
    return NextResponse.json({ error: "Unknown game" }, { status: 400 });
  }

  // Some games score their runs on the server and own their own submit
  // endpoint. Accepting a client-supplied score for one of those here would
  // hand back exactly the hole that endpoint exists to close.
  if (meta.serverScored) {
    return NextResponse.json(
      { error: "This game submits its scores through its own endpoint" },
      { status: 403 },
    );
  }

  const nameResult = cleanName(name);
  if (!nameResult.ok) {
    return NextResponse.json({ error: nameResult.error }, { status: 400 });
  }

  const scoreResult = cleanScore(score);
  if (!scoreResult.ok) {
    return NextResponse.json({ error: scoreResult.error }, { status: 400 });
  }

  const { userId, freshToken } = await getOrCreateUserId();

  const limit = rateLimit(`submit:${userId}`);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many submissions — slow down" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const { accepted, best } = submitScore(
    slug,
    userId,
    nameResult.name,
    scoreResult.score,
  );

  const res = NextResponse.json({
    accepted,
    best,
    // Echo the stored name so the client shows what was actually saved.
    name: nameResult.name,
    entries: getBoard(slug, userId, BOARD_LIMIT),
    me: getMyEntry(slug, userId),
  });

  if (freshToken) res.cookies.set(cookieName, freshToken, cookieOptions);
  return res;
}
