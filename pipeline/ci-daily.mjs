/**
 * CI daily runner (Linux equivalent of run-daily.ps1). Loops every enabled +
 * authorized channel, renders and uploads, scheduling each release at its own
 * regional peak via YouTube publishAt. Upload times are interpreted as IST
 * (Asia/Kolkata, UTC+5:30) — matching the machine the pipeline was built on.
 *
 *   node pipeline/ci-daily.mjs            # all enabled channels
 *   node pipeline/ci-daily.mjs <channel>  # just one
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { loadChannels, uploadTimeOf } from "./channels.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const only = (process.argv[2] || "").trim();

/** today's HH:MM (interpreted as IST) as an RFC3339 UTC instant; "" if already past */
function publishIso(hhmm) {
  try {
    const [h, m] = String(hhmm).split(":").map(Number);
    if (Number.isNaN(h)) return "";
    const IST = 5.5 * 3600 * 1000;
    const now = new Date();
    const ist = new Date(now.getTime() + IST); // IST wall-clock (read via getUTC*)
    const target = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, m, 0) - IST);
    if (target.getTime() <= now.getTime()) return ""; // already past → upload now
    return target.toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    return "";
  }
}

const exists = (p) => fs.access(p).then(() => true).catch(() => false);
async function hasToken(id) {
  const per = path.join(ROOT, "pipeline", "channels", id, "youtube.token.json");
  const legacy = path.join(ROOT, "pipeline", "youtube.token.json");
  return (await exists(per)) || (id === "the-inference" && (await exists(legacy)));
}

// free space: delete rendered media older than 3 days (non-fatal)
try {
  execSync("node pipeline/cleanup.mjs", { cwd: ROOT, stdio: "inherit" });
} catch (e) {
  console.log("cleanup skipped:", e.message);
}

const all = loadChannels();
const targets = only ? all.filter((c) => c.id === only) : all.filter((c) => c.enabled !== false);
if (!targets.length) {
  console.error(only ? `no such channel: ${only}` : "no enabled channels");
  process.exit(1);
}

let fail = 0;
for (const ch of targets) {
  if (!(await hasToken(ch.id))) {
    console.log(`channel '${ch.id}' not authorized — skipping`);
    continue;
  }
  const at = publishIso(uploadTimeOf(ch));
  const atFlag = at ? ` --at=${at}` : "";
  console.log(`\n=== ${ch.id} === ${at ? `(scheduled release ${at})` : "(upload now)"}`);
  try {
    execSync(`node pipeline/agent.mjs --render --upload --channel=${ch.id}${atFlag}`, { cwd: ROOT, stdio: "inherit" });
    console.log(`channel '${ch.id}' done`);
  } catch (e) {
    fail = 1;
    console.error(`channel '${ch.id}' FAILED: ${e.message}`);
  }
}
console.log(`\nrun finished (fail=${fail})`);
process.exit(fail);
