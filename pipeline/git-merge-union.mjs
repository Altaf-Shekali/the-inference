/**
 * Git merge driver for the append-only JSON state files (uploads.json,
 * used-topics.json). The cloud daily run and local runs both append to these, so
 * a plain merge always conflicts. This unions both sides (deduped by natural key)
 * so `git pull` resolves them automatically — no manual conflict fixing.
 *
 * Registered via .gitattributes (merge=jsonunion) + git config merge.jsonunion.driver.
 * Args (from git): %O = base, %A = ours (also the OUTPUT), %B = theirs, %P = path.
 */
import { readFileSync, writeFileSync } from "fs";

const [, , _base, ours, theirs, pathName = ""] = process.argv;
const load = (f) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};

const o = load(ours);
const t = load(theirs);
// If either side isn't a JSON array, bail so git falls back to a normal conflict.
if (!Array.isArray(o) || !Array.isArray(t)) process.exit(1);

const keyOf = (item) => {
  if (/uploads\.json$/.test(pathName)) return `${item.base}|${item.kind || ""}`;
  if (/used-topics/.test(pathName)) return item.slug || item.title || JSON.stringify(item);
  return JSON.stringify(item);
};

const seen = new Set();
const merged = [];
for (const item of [...t, ...o]) {
  // theirs (cloud) first so it wins on ties; then add local-only entries
  const k = keyOf(item);
  if (seen.has(k)) continue;
  seen.add(k);
  merged.push(item);
}

writeFileSync(ours, JSON.stringify(merged, null, 2) + "\n");
process.exit(0); // 0 = merged cleanly, no conflict
