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

  server.listen(port, () => {
    console.log(`> Minigames running on http://localhost:${port}`);
  });
});
