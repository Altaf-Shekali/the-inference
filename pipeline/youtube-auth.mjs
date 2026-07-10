/**
 * One-time YouTube OAuth: authorize your channel and save a refresh token.
 *
 *   npm run yt-auth
 *
 * Needs pipeline/youtube.client.json (OAuth "Desktop app" client). Opens a
 * local loopback server, prints a Google consent URL — approve it in your
 * browser, and the refresh token is saved to pipeline/youtube.token.json.
 */
import http from "http";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadClient } from "./youtube.mjs";
import { channelTokenWritePath, getChannel } from "./channels.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 53682;
// which channel are we authorizing?  npm run yt-auth -- --channel=<id>
// Also accept a bare `npm run yt-auth --channel=<id>` (no `--`): npm eats that flag
// off argv but exposes it as process.env.npm_config_channel, so fall back to it.
const CHANNEL =
  process.argv.slice(2).find((a) => a.startsWith("--channel="))?.slice(10) ||
  process.env.npm_config_channel ||
  "the-inference";
console.log(`Authorizing channel: ${CHANNEL}`);
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube";

async function main() {
  const c = loadClient(CHANNEL);
  if (!c) {
    console.error(`Missing OAuth client for '${CHANNEL}' — add pipeline/channels/${CHANNEL}/youtube.client.json (or the shared pipeline/youtube.client.json).`);
    process.exit(1);
  }

  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: c.id,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
    });

  console.log(`\nAuthorizing channel: ${getChannel(CHANNEL).name} (${CHANNEL})`);
  console.log("\n1) Open this URL in your browser and approve access:\n");
  console.log(authUrl + "\n");
  console.log("   (If Google warns the app is unverified: Advanced → Go to … → Allow.)\n");
  console.log("Waiting for authorization…");

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      const c2 = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.end(c2 ? "Authorized — you can close this tab and return to the terminal." : `Error: ${err || "no code"}`);
      server.close();
      c2 ? resolve(c2) : reject(new Error(err || "no code"));
    });
    server.listen(PORT);
    setTimeout(() => { server.close(); reject(new Error("timed out waiting for authorization")); }, 300000);
  });

  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
  });
  if (!tok.ok) throw new Error(`token exchange ${tok.status}: ${await tok.text()}`);
  const j = await tok.json();
  if (!j.refresh_token) throw new Error("No refresh_token returned (revoke prior access at myaccount.google.com/permissions and retry).");

  const tokenPath = channelTokenWritePath(CHANNEL);
  await fs.writeFile(tokenPath, JSON.stringify({ refresh_token: j.refresh_token }, null, 2));
  console.log(`\n✓ Authorized channel "${CHANNEL}". Saved ${path.relative(path.join(DIR, ".."), tokenPath)}.`);
}

main().catch((e) => {
  console.error("\nAuth failed:", e.message);
  process.exit(1);
});
