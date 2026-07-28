const { createServer } = require("http");
const { parse } = require("url");
const crypto = require("crypto");
const { exec } = require("child_process");
const next = require("next");

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

app.prepare().then(() => {
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
