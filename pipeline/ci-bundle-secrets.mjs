/**
 * Bundle your local secret files into copy-paste-ready GitHub Secret values.
 * Writes pipeline/github-secrets.local.txt (gitignored). Open it, paste each
 * value into GitHub → Settings → Secrets and variables → Actions, then DELETE it.
 *
 *   node pipeline/ci-bundle-secrets.mjs
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (rel) => {
  try {
    return (await fs.readFile(path.join(ROOT, rel), "utf8")).trim();
  } catch {
    return "";
  }
};

// collect every YouTube client/token json (shared + per-channel) into one map
async function ytBundle() {
  const map = {};
  const addJson = async (rel) => {
    const c = await read(rel);
    if (!c) return;
    try {
      map[rel] = JSON.parse(c);
    } catch {
      console.warn("skip (not JSON):", rel);
    }
  };
  await addJson("pipeline/youtube.client.json");
  await addJson("pipeline/youtube.token.json");
  let ids = [];
  try {
    ids = await fs.readdir(path.join(ROOT, "pipeline", "channels"));
  } catch {}
  for (const id of ids) {
    await addJson(`pipeline/channels/${id}/youtube.client.json`);
    await addJson(`pipeline/channels/${id}/youtube.token.json`);
  }
  return map;
}

const out = [];
const kv = (name, val) => {
  out.push(`==================== ${name} ====================`);
  out.push(val || "(EMPTY — file not found)");
  out.push("");
};

kv("GEMINI_KEY", await read("pipeline/gemini.key"));
kv("NEMOTRON_KEY", await read("pipeline/nemotron.key"));
kv("TAVILY_KEY", await read("pipeline/tavily.key"));
kv("PEXELS_KEY", await read("pipeline/pexels.key"));
kv("YT_CREDENTIALS", JSON.stringify(await ytBundle()));

const header =
  "GitHub Secrets — paste each block's value under its name at:\n" +
  "  GitHub repo → Settings → Secrets and variables → Actions → New repository secret\n" +
  "Then DELETE this file (it is gitignored, but don't leave secrets lying around).\n\n";

const dst = path.join(ROOT, "pipeline", "github-secrets.local.txt");
await fs.writeFile(dst, header + out.join("\n"));
console.log("✓ wrote pipeline/github-secrets.local.txt");
console.log("  Open it, add each secret to GitHub, then delete the file.");
