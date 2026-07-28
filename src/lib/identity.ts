import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Anonymous, cookie-based identity — no accounts, no email, no passwords.
 *
 * The cookie holds a random UUID plus an HMAC, so a client can't forge someone
 * else's id to overwrite their score. It is only used to key one leaderboard
 * row per player.
 */
const COOKIE = "minigames_id";
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function secret(): string {
  // Falls back to the webhook secret (always set in production) so a missing
  // SESSION_SECRET can't silently degrade to a shared, guessable key.
  const s = process.env.SESSION_SECRET || process.env.WEBHOOK_SECRET;
  if (!s) {
    throw new Error("SESSION_SECRET (or WEBHOOK_SECRET) must be set");
  }
  return s;
}

export function sign(userId: string): string {
  const mac = crypto
    .createHmac("sha256", secret())
    .update(userId)
    .digest("hex")
    .slice(0, 32);
  return `${userId}.${mac}`;
}

export function verify(token: string | undefined | null): string | null {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", secret())
    .update(userId)
    .digest("hex")
    .slice(0, 32);
  if (mac.length !== expected.length) return null;
  try {
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
      ? userId
      : null;
  } catch {
    return null;
  }
}

/** Existing verified id, or a fresh one plus the token to set as a cookie. */
export async function getOrCreateUserId(): Promise<{
  userId: string;
  freshToken: string | null;
}> {
  const jar = await cookies();
  const verified = verify(jar.get(COOKIE)?.value);
  if (verified) return { userId: verified, freshToken: null };
  const userId = crypto.randomUUID();
  return { userId, freshToken: sign(userId) };
}

/** Read-only lookup — does not mint an id for a first-time visitor. */
export async function getUserIdIfPresent(): Promise<string | null> {
  const jar = await cookies();
  return verify(jar.get(COOKIE)?.value);
}

export const cookieName = COOKIE;
export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
};
