/**
 * Fallback auth: exchange a pasted authorization code (or the full redirected
 * URL) for a refresh token — used when the loopback redirect can't reach us.
 *
 *   node pipeline/yt-code.mjs "<paste the http://localhost:53682/?code=... URL or just the code>"
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadClient } from "./youtube.mjs";
import { channelTokenWritePath } from "./channels.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REDIRECT = "http://localhost:53682";

async function main() {
  const args = process.argv.slice(2);
  const channel = args.find((a) => a.startsWith("--channel="))?.slice(10) || "the-inference";
  const arg = args.filter((a) => !a.startsWith("--channel=")).join(" ").trim();
  if (!arg) {
    console.error('Usage: node pipeline/yt-code.mjs "<redirected URL or code>" [--channel=<id>]');
    process.exit(1);
  }
  let code = arg;
  const m = arg.match(/[?&]code=([^&\s]+)/);
  if (m) code = decodeURIComponent(m[1]);

  const c = loadClient(channel);
  if (!c) throw new Error(`Missing OAuth client for '${channel}'`);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) {
    throw new Error(`exchange failed ${r.status}: ${JSON.stringify(j)}`);
  }
  const tokenPath = channelTokenWritePath(channel);
  await fs.writeFile(tokenPath, JSON.stringify({ refresh_token: j.refresh_token }, null, 2));
  console.log(`✓ Authorized channel "${channel}". Saved ${path.relative(path.join(DIR, ".."), tokenPath)}.`);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
