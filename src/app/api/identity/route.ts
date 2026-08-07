import { NextResponse } from "next/server";
import { cookieName, cookieOptions, getOrCreateUserId } from "@/lib/identity";

export const dynamic = "force-dynamic";

/**
 * POST /api/identity — make sure this browser has a durable signed id.
 *
 * Exists because the identity cookie used to be minted only when a score was
 * submitted, so anyone who went straight to /multiplayer had none. The room
 * layer then fell back to a throwaway anon id, which is per-socket by design —
 * meaning the SAME browser opening the invite link twice was seated as two
 * different players, and the room waited on a person who didn't exist.
 *
 * A websocket handshake can't set a cookie, so this has to happen over HTTP
 * before connecting. Returns nothing about the id itself: the client never needs
 * to know it, and sending it would invite a client-supplied id being trusted.
 */
export async function POST() {
  const { freshToken } = await getOrCreateUserId();
  const res = NextResponse.json({ ok: true });
  if (freshToken) res.cookies.set(cookieName, freshToken, cookieOptions);
  return res;
}
