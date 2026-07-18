/**
 * CI: recreate the secret files from GitHub Secrets (env vars) at runtime.
 * Nothing secret is ever committed — this rebuilds the .key files and the
 * per-channel YouTube client/token JSONs so the pipeline can run on a fresh runner.
 *
 * Env (set from GitHub Secrets in the workflow):
 *   GEMINI_KEY, NEMOTRON_KEY, TAVILY_KEY, PEXELS_KEY  — plain one-line keys
 *   YT_CREDENTIALS — JSON map of { "<repo-relative path>": <file contents> }
 *                    e.g. { "pipeline/youtube.token.json": {...},
 *                           "pipeline/channels/current-affairs/youtube.client.json": {...} }
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function write(rel, content) {
  if (!content || !String(content).trim()) return;
  const p = path.join(ROOT, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  console.log("restored", rel);
}

await write("pipeline/gemini.key", (process.env.GEMINI_KEY || "").trim());
await write("pipeline/nemotron.key", (process.env.NEMOTRON_KEY || "").trim());
await write("pipeline/tavily.key", (process.env.TAVILY_KEY || "").trim());
await write("pipeline/pexels.key", (process.env.PEXELS_KEY || "").trim());
// Cartesia TTS — per-language keys (own free credits each) + optional shared key
await write("pipeline/cartesia.kn.key", (process.env.CARTESIA_KN_KEY || "").trim());
await write("pipeline/cartesia.hi.key", (process.env.CARTESIA_HI_KEY || "").trim());
await write("pipeline/cartesia.key", (process.env.CARTESIA_KEY || "").trim());

const bundle = process.env.YT_CREDENTIALS;
if (bundle && bundle.trim()) {
  let map;
  try {
    map = JSON.parse(bundle);
  } catch (e) {
    console.error("YT_CREDENTIALS is not valid JSON:", e.message);
    process.exit(1);
  }
  for (const [rel, val] of Object.entries(map)) await write(rel, val);
} else {
  console.warn("WARNING: YT_CREDENTIALS not set — no channel can upload.");
}
console.log("✓ secrets restored");
