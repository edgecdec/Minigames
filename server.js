const { createServer } = require("http");
const { parse } = require("url");
const crypto = require("crypto");
const { exec } = require("child_process");
const next = require("next");
const { initialize } = require("./src/lib/migrate.js");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = process.env.PORT || 3008;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const APP_DIR = __dirname;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Constant-time compare of the GitHub HMAC signature. Using timingSafeEqual
// rather than === so the comparison can't be probed byte-by-byte.
function signatureMatches(signature, body) {
  const digest =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  if (signature.length !== digest.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

/**
 * Bring the database schema up to date before serving anything.
 *
 * Running here rather than on first request means a contributor's new table
 * exists the moment the deploy restarts pm2 — nobody logs into the box, and
 * nobody has to tell the other contributors to do anything.
 *
 * A failure is loud in the log but NOT fatal. Most games need no database at
 * all, and this repo's deploy is built around never being able to take the
 * site down; a bad migration should cost you the leaderboard, not Snake.
 */
function migrateDatabase() {
  try {
    const { applied, backupPath } = initialize();
    if (applied.length > 0) {
      console.log(`> Applied ${applied.length} migration(s): ${applied.join(", ")}`);
      if (backupPath) console.log(`> Pre-migration snapshot: ${backupPath}`);
    }
  } catch (err) {
    globalThis.__minigamesDbError = err.message;
    console.error("=".repeat(72));
    console.error("DATABASE MIGRATION FAILED - database-backed features are off");
    console.error(err);
    console.error("=".repeat(72));
  }
}

/**
 * Leaderboards sign an anonymous id cookie, and identity.js refuses to fall
 * back to a guessable key. Without a secret the failure is nasty to diagnose:
 * a first-time visitor sees a working (empty) board, then every submission
 * 500s, and once any cookie exists the board itself 500s too. Say so at boot,
 * where it's actually visible.
 */
function checkLeaderboardConfig() {
  if (process.env.SESSION_SECRET || process.env.WEBHOOK_SECRET) return;
  console.warn("=".repeat(72));
  // ASCII only: this goes to a pm2 log and a Windows console, neither of
  // which reliably renders anything fancier.
  console.warn("SESSION_SECRET is not set - global leaderboards will NOT work.");
  console.warn("Scores can't be submitted and the board 500s for anyone with");
  console.warn("a saved cookie. Set SESSION_SECRET (any value locally):");
  console.warn("    SESSION_SECRET=local-dev npm run dev");
  console.warn("Everything else on the site works normally.");
  console.warn("=".repeat(72));
}

/**
 * Multiplayer lives on the SAME HTTP server and port as the site — one process,
 * one host, exactly like TopTenGame. Rooms are held in memory by
 * src/lib/rooms.js, so running more than one instance (pm2 cluster mode, or a
 * second box behind a load balancer) would silently split players who typed the
 * same room code into separate room universes. Keep pm2 in fork mode.
 */
function attachMultiplayer(httpServer) {
  try {
    const { Server } = require("socket.io");
    const rooms = require("./src/lib/rooms.js");
    const codenames = require("./src/games/codenames/server.js");
    const snakeDuel = require("./src/games/snake-duel/server.js");
    const doubleItDuel = require("./src/games/double-it-duel/server.js");
    const territory = require("./src/games/territory/server.js");

    rooms.registerGame(codenames.slug, codenames);
    rooms.registerGame(snakeDuel.slug, snakeDuel);
    rooms.registerGame(doubleItDuel.slug, doubleItDuel);
    rooms.registerGame(territory.slug, territory);

    const io = new Server(httpServer, {
      // Same origin as the site, so no CORS allowance is needed.
      serveClient: false,
      // Rooms are in-memory; a long-lived socket is the point. Fail fast enough
      // that a dead tab frees its seat, slow enough to survive a phone waking.
      pingTimeout: 20_000,
    });

    io.on("connection", (socket) => {
      socket.on("error", (err) => console.error("[socket]", err && err.message));
    });

    rooms.attach(io, { verifyIdentity: verifySocketIdentity });
    console.log(`> Multiplayer ready (${rooms.listGames().join(", ")})`);

    // Bring back any rooms saved by the last shutdown. Done AFTER registerGame
    // so a restored room's game handlers already exist.
    try {
      const { restored, dropped } = rooms.restoreRooms();
      if (restored > 0) {
        console.log(`> Restored ${restored} paused room(s) from the last restart`);
      }
      if (dropped > 0) {
        console.log(`> Dropped ${dropped} stale room snapshot(s)`);
      }
    } catch (err) {
      // A restore failure costs the old lobbies, nothing more — new rooms still
      // work, so this must never stop the server from coming up.
      console.error("[rooms] restore failed:", err.message);
    }

    installShutdownHandler(rooms, io);
  } catch (err) {
    // The single-player games are the bulk of the site and must still serve.
    console.error("=".repeat(72));
    console.error("MULTIPLAYER FAILED TO START - single-player games are unaffected");
    console.error(err);
    console.error("=".repeat(72));
  }
}

/**
 * Save live rooms when pm2 stops us.
 *
 * `pm2 restart` sends SIGINT and then SIGKILL if we linger, so this has to be
 * quick — a synchronous SQLite write, no awaiting anything. Without it every
 * deploy destroyed every active lobby, and the client's auto-rejoin reported
 * "No room called ABCD", which reads to a player as if they mistyped the code.
 */
function installShutdownHandler(rooms, io) {
  let draining = false;

  const drain = (signal) => {
    // pm2 can deliver more than one signal; a second pass would write over the
    // snapshot with rooms we have already torn down.
    if (draining) return;
    draining = true;
    try {
      const { saved } = rooms.drainRooms(io);
      console.log(`> ${signal}: paused and saved ${saved} room(s)`);
    } catch (err) {
      console.error("[rooms] drain failed:", err.message);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => drain("SIGINT"));
  process.on("SIGTERM", () => drain("SIGTERM"));
}

/**
 * Resolve a socket's player id from the same signed cookie the leaderboard
 * uses, so a player is the same person in a room as on the boards.
 *
 * Returns null when there's no valid cookie; the room layer then issues a
 * throwaway id. That keeps a first-time visitor able to play without us minting
 * a durable identity over a websocket, where we can't set a cookie anyway.
 */
function verifySocketIdentity(cookieHeader) {
  try {
    const { parseCookie } = require("./src/lib/rooms.js");
    const token = parseCookie(cookieHeader, "minigames_id");
    if (!token) return null;

    const secret = process.env.SESSION_SECRET || process.env.WEBHOOK_SECRET;
    if (!secret) return null;

    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;
    const userId = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const expected = crypto
      .createHmac("sha256", secret)
      .update(userId)
      .digest("hex")
      .slice(0, 32);
    if (mac.length !== expected.length) return null;
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? userId : null;
  } catch {
    return null;
  }
}

app.prepare().then(() => {
  migrateDatabase();
  checkLeaderboardConfig();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);

    if (parsedUrl.pathname === "/api/webhook" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const signature = req.headers["x-hub-signature-256"];
        if (!signature) {
          console.log("Webhook: no signature header");
          res.statusCode = 401;
          return res.end("No signature");
        }
        // No dev fallback secret: an unset WEBHOOK_SECRET must fail closed,
        // never deploy on an unverifiable payload.
        if (!WEBHOOK_SECRET) {
          console.log("Webhook: WEBHOOK_SECRET not set");
          res.statusCode = 500;
          return res.end("Server misconfigured");
        }
        if (!signatureMatches(signature, body)) {
          res.statusCode = 403;
          return res.end("Forbidden");
        }
        // Only deploy for pushes to main. GitHub sends ping on webhook
        // creation and we don't want that to trigger a build.
        const event = req.headers["x-github-event"];
        if (event === "ping") {
          res.statusCode = 200;
          return res.end("pong");
        }
        if (event !== "push") {
          res.statusCode = 200;
          return res.end("Ignored event");
        }
        let ref = null;
        try {
          ref = JSON.parse(body).ref;
        } catch {
          res.statusCode = 400;
          return res.end("Bad payload");
        }
        if (ref !== "refs/heads/main") {
          console.log(`Webhook: ignoring push to ${ref}`);
          res.statusCode = 200;
          return res.end("Ignored ref");
        }

        console.log("Webhook verified. Deploying...");
        res.statusCode = 200;
        res.end("Deploying");
        exec(
          `nohup bash ${APP_DIR}/deploy_webhook.sh > /dev/null 2>&1 &`,
          (err) => {
            if (err) console.error(`exec error: ${err}`);
          },
        );
      });
      return;
    }

    handle(req, res, parsedUrl);
  });

  attachMultiplayer(server);

  server.listen(port, () => {
    console.log(`> Minigames running on http://localhost:${port}`);
  });
});
