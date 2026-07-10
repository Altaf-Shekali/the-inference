/**
 * TTS build step — turns a "script" JSON (scenes with `vo` text) into a
 * render-ready props JSON, generating per-scene voiceover and captions.
 *
 * Usage:
 *   node pipeline/build.mjs <script.json> [out.json]
 *   node pipeline/build.mjs pipeline/scripts/news.json out/news.props.json
 *
 * For each scene that has a `vo` field it:
 *   1. synthesizes the voiceover mp3 → public/vo/<base>-<i>.mp3
 *   2. derives word-timed caption cues (in frames)
 *   3. sets durationInFrames from the actual audio length (+ padding)
 *
 * Scenes without `vo` keep their hand-set durationInFrames.
 * Then render:  npx remotion render AINews out/video.mp4 --props=out/news.props.json
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { synth } from "./tts.mjs";
import { fetchClip, hasPexelsKey } from "./footage.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 30;
const LEAD = 0.25; // silence before speech (s)
const TAIL = 0.6; // breathing room after speech (s)
const MAX_WORDS_PER_CUE = 5;

const sec2frame = (s) => Math.round(s * FPS);

/** Transcode a downloaded clip to constant 30fps + fixed 1920x1080 so the
 * Remotion compositor never hits "Output changed" (VFR / mid-stream size
 * changes in some stock clips crash OffthreadVideo). Returns true on success. */
async function normalizeClip(absPath) {
  const tmp = absPath + ".norm.mp4";
  try {
    // 720p (not 1080p): B-roll sits behind a dark scrim, so 720 is plenty and
    // roughly halves the compositor's per-frame memory (avoids OOM on multi-clip videos).
    execSync(
      `npx remotion ffmpeg -y -i "${absPath}" -vf scale=1280:720 -r 30 -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 24 -an "${tmp}"`,
      { cwd: ROOT, stdio: "ignore" },
    );
    await fs.rename(tmp, absPath);
    return true;
  } catch {
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    return false;
  }
}

/** if a file exists under public/, return its public-relative path, else "" */
async function detectAsset(rel) {
  try {
    await fs.access(path.join(ROOT, "public", rel));
    return rel;
  } catch {
    return "";
  }
}

/** group word timings into short caption cues with per-word timings
 * (scene-relative frames) — powers kinetic word-by-word captions */
function buildCues(words, leadSec) {
  const cues = [];
  for (let i = 0; i < words.length; i += MAX_WORDS_PER_CUE) {
    const chunk = words.slice(i, i + MAX_WORDS_PER_CUE);
    const wordCues = chunk.map((w) => ({
      text: w.word,
      from: sec2frame(leadSec + w.start),
      to: sec2frame(leadSec + w.end),
    }));
    cues.push({
      text: chunk.map((w) => w.word).join(" "),
      from: wordCues[0].from,
      to: wordCues[wordCues.length - 1].to,
      words: wordCues,
    });
  }
  // make each cue last until the next one starts (no flicker gaps)
  for (let i = 0; i < cues.length - 1; i++) cues[i].to = cues[i + 1].from;
  return cues;
}

async function main() {
  // positional: <script.json> [out.json]
  // flags: --voice=<edge voice>  --base=<artifact base>  --captions  --no-broll
  const argv = process.argv.slice(2);
  const flags = {};
  const pos = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    } else pos.push(a);
  }
  const inPath = pos[0];
  if (!inPath) {
    console.error("Usage: node pipeline/build.mjs <script.json> [out.json] [--voice=..] [--base=..] [--captions] [--no-broll]");
    process.exit(1);
  }
  // `base` controls where the vo audio + default props are written. Override it
  // (e.g. <base>.short) to build a variant WITHOUT clobbering the original's audio.
  const base = flags.base || path.basename(inPath).replace(/\.json$/i, "");
  const outPath = pos[1] || path.join(ROOT, "out", `${base}.props.json`);

  const doc = JSON.parse(await fs.readFile(inPath, "utf8"));
  const engine = flags.engine || doc.engine || "edge";
  const voice = flags.voice || doc.voice || (engine === "kokoro" ? "am_michael" : "en-US-AndrewNeural");
  doc.voice = voice; // reflect the voice actually used in the props
  console.log(`  engine: ${engine}  voice: ${voice}`);

  // defaults so the output always validates against aiNewsSchema
  doc.showCaptions ??= false;
  if (flags.captions) doc.showCaptions = true; // Shorts burn captions on
  doc.source ??= "";

  // auto-detect audio (your own .mp3 takes priority; else generated .wav)
  const pick = async (...rels) => {
    for (const r of rels) {
      const found = await detectAsset(r);
      if (found) return found;
    }
    return "";
  };
  // Background music: OFF unless a track is present. Drop public/music/bed.mp3
  // (or run `npm run sound` to generate one) to add a bed later.
  doc.music = doc.music || (await pick("music/bed.mp3", "music/bed.wav"));
  if (doc.music) console.log(`  music bed: ${doc.music}`);

  // SFX: intentionally OFF. They read as gimmicky here. To re-enable later,
  // set an `sfx` map in the script JSON, e.g. {"whoosh":"sfx/whoosh.wav"}.
  doc.sfx = doc.sfx || {};

  const voDir = path.join(ROOT, "public", "vo", base);
  const brollDir = path.join(ROOT, "public", "broll", base);
  await fs.mkdir(voDir, { recursive: true });
  await fs.mkdir(brollDir, { recursive: true });

  const canFetch = hasPexelsKey();
  if (!canFetch) {
    console.log("  (no PEXELS_API_KEY — B-roll will fall back to motion graphics)");
  }

  // Cap B-roll clips per video: decoding many videos at once destabilizes the
  // Windows compositor (OOM/crash). 3 footage scenes + motion-graphics for the
  // rest keeps the cinematic mix while staying renderable.
  const MAX_BROLL = 3;
  let brollCount = 0;

  for (let i = 0; i < doc.scenes.length; i++) {
    const scene = doc.scenes[i];
    if (!scene.vo) {
      if (!scene.durationInFrames) scene.durationInFrames = 120;
      continue;
    }

    process.stdout.write(`  [${i + 1}/${doc.scenes.length}] ${scene.type} … `);
    // Edge TTS occasionally returns a CORRUPT/empty buffer or drops word timings
    // (esp. the first call on a cold connection). Retry until we get BOTH a
    // valid (non-trivial) audio buffer AND word boundaries.
    const wordCount = scene.vo.trim().split(/\s+/).length;
    const expectWords = wordCount > 1;
    let buffer, words, ext = "mp3";
    for (let attempt = 1; attempt <= 5; attempt++) {
      ({ buffer, words, ext } = await synth(scene.vo, voice, engine));
      const okAudio = buffer && buffer.length > 3000; // a real ~3s clip is >15KB
      const okWords = !expectWords || words.length > 0;
      if (okAudio && okWords) break;
      process.stdout.write(`retry ${attempt}… `);
      buffer = null;
    }

    if (buffer && buffer.length > 3000) {
      const rel = path.posix.join("vo", base, `${i}.${ext}`);
      await fs.writeFile(path.join(ROOT, "public", rel), buffer);
      const spokenEnd = words.length ? words[words.length - 1].end : Math.max(2, wordCount / 2.6);
      scene.audio = rel;
      scene.captions = buildCues(words, LEAD);
      scene.durationInFrames = sec2frame(LEAD + spokenEnd + TAIL);
      process.stdout.write(`${(scene.durationInFrames / FPS).toFixed(1)}s, ${words.length} words`);
    } else {
      // TTS kept failing — keep the video RENDERABLE: silent scene, estimated length
      delete scene.audio;
      delete scene.captions;
      scene.durationInFrames = sec2frame(LEAD + Math.max(2, wordCount / 2.6) + TAIL);
      process.stdout.write(`⚠ TTS failed — silent ${(scene.durationInFrames / FPS).toFixed(1)}s`);
    }

    // auto-source B-roll if the scene asked for it (up to MAX_BROLL per video).
    // --no-broll skips fetching (used for fast Short rebuilds — motion graphics
    // + burned captions carry the vertical cut without re-spending Pexels quota).
    if (canFetch && !flags["no-broll"] && scene.keywords?.length && !scene.broll && brollCount < MAX_BROLL) {
      const brollRel = path.posix.join("broll", base, `${i}.mp4`);
      const ok = await fetchClip(scene.keywords, path.join(ROOT, "public", brollRel));
      if (ok) {
        const normed = await normalizeClip(path.join(ROOT, "public", brollRel));
        if (normed) {
          scene.broll = brollRel;
          brollCount++;
          process.stdout.write(`, b-roll ✓`);
        } else {
          process.stdout.write(`, b-roll skipped (transcode failed)`);
        }
      }
    }
    console.log("");
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  // `engine` is a build-time hint, not a render prop — keep it out of the props
  // JSON so it never trips Remotion's schema validation.
  delete doc.engine;
  await fs.writeFile(outPath, JSON.stringify(doc, null, 2));

  const total = doc.scenes.reduce((s, sc) => s + sc.durationInFrames, 0);
  console.log(`\n✓ ${base}: ${(total / FPS).toFixed(1)}s total → ${path.relative(ROOT, outPath)}`);
  console.log(`  Render: npx remotion render AINews out/${base}.mp4 --props=${path.relative(ROOT, outPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
