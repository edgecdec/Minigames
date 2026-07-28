import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Red Guy — https://www.youtube.com/@IAmRedGuy */
const CHANNEL_ID = "UC7jSG7DIpkSNcypXtNWK5nQ";
const UPSTREAM = `https://mixerno.space/api/youtube-channel-counter/user/${CHANNEL_ID}`;

/**
 * Cached live subscriber count.
 *
 * Server-side proxy rather than a direct browser fetch, for three reasons: the
 * upstream sends no CORS headers, the cache means N viewers cause 1 upstream
 * call per REFRESH_MS instead of N, and a flaky third party can't break the page.
 */
const REFRESH_MS = 15_000;

interface Snapshot {
  subscribers: number;
  views: number | null;
  videos: number | null;
  fetchedAt: number;
}

let cache: Snapshot | null = null;
let inFlight: Promise<Snapshot | null> | null = null;

function pick(counts: Array<{ value: string; count: number }>, key: string): number | null {
  const hit = counts.find((c) => c.value === key);
  return typeof hit?.count === "number" ? hit.count : null;
}

async function fetchUpstream(): Promise<Snapshot | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(UPSTREAM, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (minigames.edgecdec.com)" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const counts = Array.isArray(data?.counts) ? data.counts : [];

    // `subscribers` is the interpolated live figure; `apisubscribers` is the
    // last real API reading. Prefer the live one, fall back to the API value.
    const subs = pick(counts, "subscribers") ?? pick(counts, "apisubscribers");
    if (typeof subs !== "number" || !Number.isFinite(subs) || subs < 0) return null;

    return {
      subscribers: Math.round(subs),
      views: pick(counts, "views") ?? pick(counts, "apiviews"),
      videos: pick(counts, "videos"),
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const fresh = cache && Date.now() - cache.fetchedAt < REFRESH_MS;

  if (!fresh) {
    // Collapse concurrent misses into one upstream request.
    inFlight ??= fetchUpstream().finally(() => {
      inFlight = null;
    });
    const next = await inFlight;
    if (next) cache = next;
  }

  if (!cache) {
    return NextResponse.json(
      { error: "Subscriber count unavailable", subscribers: null },
      { status: 503 },
    );
  }

  return NextResponse.json({
    subscribers: cache.subscribers,
    views: cache.views,
    videos: cache.videos,
    fetchedAt: cache.fetchedAt,
    // True when we're serving a cached copy because upstream just failed.
    stale: Date.now() - cache.fetchedAt > REFRESH_MS * 4,
    channelUrl: "https://www.youtube.com/@IAmRedGuy",
  });
}
