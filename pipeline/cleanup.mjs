/**
 * Storage cleanup — deletes rendered MEDIA older than N days (default 3). The
 * videos are already on YouTube, so local copies are disposable. The small
 * script/meta JSON in pipeline/scripts/ is kept as history.
 *
 *   node pipeline/cleanup.mjs            # delete media older than 3 days
 *   node pipeline/cleanup.mjs --days=7   # keep a week
 *   node pipeline/cleanup.mjs --dry      # show what would be deleted, delete nothing
 *
 * Runs automatically at the start of each daily run (run-daily.ps1).
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");
const VO = path.join(ROOT, "public", "vo");
const BROLL = path.join(ROOT, "public", "broll");

const arg = (n, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const days = Number(arg("days", 3)) || 3;
const dry = process.argv.includes("--dry");
const cutoff = Date.now() - days * 864e5;
const LOG_KEEP_DAYS = 14; // keep daily-*.log longer for debugging

// Only touch pipeline-generated media: bases are always date-prefixed
// (YYYY-MM-DD-...). This spares hand-made renders (Kaval promos, test stills, etc.).
const DATED = /^\d{4}-\d{2}-\d{2}-/;

let count = 0;
let bytes = 0;

async function dirBytes(p) {
  let total = 0;
  for (const e of await fs.readdir(p, { withFileTypes: true }).catch(() => [])) {
    const c = path.join(p, e.name);
    const st = await fs.stat(c).catch(() => null);
    if (!st) continue;
    total += e.isDirectory() ? await dirBytes(c) : st.size;
  }
  return total;
}

async function sweep(dir) {
  const rel = path.relative(ROOT, dir);
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const isDailyLog = dir === OUT && e.name.startsWith("daily-") && e.name.endsWith(".log");
    // only pipeline output (date-prefixed) or the pipeline's own daily logs
    if (!DATED.test(e.name) && !isDailyLog) continue;
    const p = path.join(dir, e.name);
    const st = await fs.stat(p).catch(() => null);
    if (!st || st.mtimeMs >= cutoff) continue;
    // keep the daily logs for two weeks for debugging
    if (isDailyLog && st.mtimeMs >= Date.now() - LOG_KEEP_DAYS * 864e5) continue;
    const size = e.isDirectory() ? await dirBytes(p) : st.size;
    const age = Math.floor((Date.now() - st.mtimeMs) / 864e5);
    console.log(`${dry ? "[dry] " : ""}delete ${rel}/${e.name}  (${(size / 1e6).toFixed(1)} MB, ${age}d old)`);
    if (!dry) await fs.rm(p, { recursive: true, force: true });
    count++;
    bytes += size;
  }
}

for (const d of [OUT, VO, BROLL]) await sweep(d);
console.log(`\n${dry ? "[dry] would free" : "freed"} ${(bytes / 1e6).toFixed(1)} MB across ${count} item(s) (older than ${days} days).`);
