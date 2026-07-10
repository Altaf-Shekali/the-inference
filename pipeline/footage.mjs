/**
 * Auto-source free B-roll from Pexels (free, no card — get a key at
 * https://www.pexels.com/api/ and set it):  PEXELS_API_KEY=xxxx
 *
 * Exposes fetchClip(keywords, destAbsPath) → downloads one landscape HD
 * mp4 matching the keywords, or returns false if no key / nothing found.
 */
import { promises as fs, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER = "PASTE_YOUR_PEXELS_KEY_HERE";

/** Key comes from (1) env var, or (2) the local file pipeline/pexels.key */
function loadKey() {
  if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY.trim();
  try {
    const k = readFileSync(path.join(DIR, "pexels.key"), "utf8").trim();
    if (k && k !== PLACEHOLDER) return k;
  } catch {
    /* file not present — that's fine */
  }
  return "";
}

const KEY = loadKey();

export const hasPexelsKey = () => KEY.length > 0;

async function searchVideoUrl(query) {
  const url =
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}` +
    `&per_page=12&orientation=landscape&size=medium`;
  const r = await fetch(url, { headers: { Authorization: KEY } });
  if (!r.ok) throw new Error(`Pexels ${r.status} ${r.statusText}`);
  const j = await r.json();
  for (const v of j.videos ?? []) {
    // prefer a clean 1080p-ish mp4
    const files = (v.video_files ?? []).filter((f) => f.file_type === "video/mp4");
    const hd =
      files.find((f) => f.width >= 1280 && f.width <= 1920) ||
      files.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    if (hd?.link) return hd.link;
  }
  return null;
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

/** Try each keyword phrase until one returns a clip. */
export async function fetchClip(keywords, destAbsPath) {
  if (!hasPexelsKey()) return false;
  for (const kw of keywords) {
    try {
      const link = await searchVideoUrl(kw);
      if (link) {
        await download(link, destAbsPath);
        return true;
      }
    } catch (e) {
      console.warn(`    pexels "${kw}": ${e.message}`);
    }
  }
  return false;
}
