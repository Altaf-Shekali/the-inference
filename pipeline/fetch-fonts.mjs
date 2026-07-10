/**
 * One-time, ONLINE font fetch — makes renders fully self-contained/offline.
 *
 * `@remotion/google-fonts` does NOT bundle the font binaries; it injects
 * @font-face rules that pull the woff2 from fonts.gstatic.com AT RENDER TIME.
 * So every render (incl. the daily autonomous one, or any free CI runner)
 * needs live network, and dies with a NetworkError if Google is unreachable.
 *
 * This downloads the exact weights the AINews templates use into
 * public/fonts/, where src/AINews/fonts.ts serves them via staticFile().
 * Run once on a machine WITH internet:  npm run fonts
 *
 * The weight lists MUST stay in sync with src/AINews/templates.tsx,
 * src/AINews/Thumbnail.tsx, and src/AINews/fonts.ts.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "..", "public", "fonts");

// Latin display fonts + Indic script fonts (for hi/kn videos). The Indic fonts
// are fetched from their own subset block (Google serves one per script).
const FAMILIES = [
  { family: "Poppins", weights: [400, 500, 700, 800], subset: "latin" },
  { family: "Oswald", weights: [400, 500, 700], subset: "latin" },
  { family: "Sora", weights: [400, 600, 800], subset: "latin" },
  { family: "Archivo", weights: [400, 600, 800], subset: "latin" },
  { family: "Noto Sans Devanagari", weights: [400, 600, 700, 800], subset: "devanagari" },
  { family: "Noto Sans Kannada", weights: [400, 600, 700, 800], subset: "kannada" },
];

// woff2 filename for a family (spaces stripped so staticFile paths stay simple)
const fileName = (family, weight) => `${family.replace(/ /g, "")}-${weight}.woff2`;

// A real browser UA makes the CSS2 API return woff2 (not ttf) with the
// per-subset blocks we parse below.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function cssFor(family, weights) {
  const fam = family.replace(/ /g, "+");
  const url =
    `https://fonts.googleapis.com/css2?family=${fam}:wght@${weights.join(";")}` +
    `&display=swap`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`css ${r.status} ${r.statusText} for ${family}`);
  return r.text();
}

/** map weight -> woff2 url, keeping only the requested subset block */
function pickSubset(css, subset) {
  const out = {};
  const re = /\/\*\s*(\S+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1] !== subset) continue;
    const body = m[2];
    const w = (body.match(/font-weight:\s*(\d+)/) || [])[1];
    const url = (body.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
    if (w && url) out[w] = url;
  }
  return out;
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  let ok = 0;
  let missing = 0;
  for (const { family, weights, subset } of FAMILIES) {
    const map = pickSubset(await cssFor(family, weights), subset);
    for (const w of weights) {
      const url = map[String(w)];
      if (!url) {
        console.warn(`  ! ${family} ${w}: no ${subset} woff2 found`);
        missing++;
        continue;
      }
      await download(url, path.join(OUT, fileName(family, w)));
      console.log(`  ✓ ${fileName(family, w)}`);
      ok++;
    }
  }
  console.log(`\n✓ ${ok} font files → public/fonts/${missing ? `  (${missing} missing!)` : ""}`);
  if (missing) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
