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
  // Cartesia: an empty voice means "auto-resolve each account's own clone" — do NOT
  // default it to an Edge voice name (that would be sent as an invalid Cartesia id).
  const voiceDefault = engine === "kokoro" ? "am_michael" : engine === "cartesia" ? "" : "en-US-AndrewNeural";
  const voice = flags.voice || doc.voice || voiceDefault;
  doc.voice = voice; // reflect the voice actually used in the props
  // for Cartesia we also need the language + an Edge voice to fall back to on quota/errors
  const ttsLang = doc.lang || "en";
  const fallbackVoice = doc.fallbackVoice || (engine === "cartesia" ? "en-US-AndrewNeural" : voice);
  console.log(`  engine: ${engine}  voice: ${voice}${engine === "cartesia" ? `  lang: ${ttsLang}  fallback: ${fallbackVoice}` : ""}`);

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

  // B-roll per video. Rendering now runs on cloud Linux (16GB) and scenes play
  // sequentially (only one clip decodes at a time), so the old Windows-compositor
  // cap of 3 is gone. Cover the WHOLE video — story/psych scenes have no bullets,
  // so B-roll IS their visual; without this they go blank after the first few.
  // One clip per keyworded scene, capped for safety on unusually long videos.
  const MAX_BROLL = Math.min(doc.scenes.length, 14);
  let brollCount = 0;

  // ---- Pass 1: voiceover. For Cartesia we keep ONE voice across the whole video:
  // if any Cartesia call fails (out of credits / error) we drop the entire video to
  // Edge and restart this pass, so it's never a mix of the clone + Edge mid-way.
  let ttsEngine = engine;
  let ttsVoice = voice;
  for (let i = 0; i < doc.scenes.length; i++) {
    const scene = doc.scenes[i];
    if (!scene.vo) {
      if (!scene.durationInFrames) scene.durationInFrames = 120;
      continue;
    }

    process.stdout.write(`  [${i + 1}/${doc.scenes.length}] ${scene.type} … `);
    const wordCount = scene.vo.trim().split(/\s+/).length;
    const expectWords = wordCount > 1;
    let buffer, words, ext = "mp3";

    if (ttsEngine === "cartesia") {
      // strict → throws instead of silently falling back, so we can switch the
      // WHOLE video (not just this scene) to Edge and keep the voice consistent.
      // Retry transient errors (rate limit / network); switch to Edge only on a
      // permanent failure (credits exhausted / bad key) or repeated failure.
      let got = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          got = await synth(scene.vo, ttsVoice, "cartesia", { lang: ttsLang, strict: true });
          break;
        } catch (e) {
          const permanent = /\b(40[0-3]|quota|credit|insufficient|invalid|unauthor)/i.test(e.message);
          if (permanent || attempt === 3) {
            console.log(`\n  ⚠ Cartesia unavailable (${e.message}) — using Edge (${fallbackVoice}) for the whole video`);
            ttsEngine = "edge";
            ttsVoice = fallbackVoice;
            break;
          }
          process.stdout.write(`cartesia retry ${attempt}… `);
        }
      }
      if (!got) {
        i = -1; // switched to Edge → restart the voiceover pass from scene 0
        continue;
      }
      ({ buffer, words, ext } = got);
    } else {
      // Edge occasionally returns a corrupt/empty buffer or drops word timings —
      // retry until we get BOTH a valid buffer AND word boundaries.
      for (let attempt = 1; attempt <= 5; attempt++) {
        ({ buffer, words, ext } = await synth(scene.vo, ttsVoice, ttsEngine, { lang: ttsLang, fallbackVoice }));
        const okAudio = buffer && buffer.length > 3000;
        const okWords = !expectWords || words.length > 0;
        if (okAudio && okWords) break;
        process.stdout.write(`retry ${attempt}… `);
        buffer = null;
      }
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
    console.log("");
  }

  // ---- Pass 2: B-roll (separate so a Cartesia→Edge restart never re-fetches it).
  // --no-broll skips fetching (fast Short rebuilds reuse motion graphics + captions).
  if (canFetch && !flags["no-broll"]) {
    for (let i = 0; i < doc.scenes.length; i++) {
      const scene = doc.scenes[i];
      if (!scene.keywords?.length || scene.broll || brollCount >= MAX_BROLL) continue;
      const brollRel = path.posix.join("broll", base, `${i}.mp4`);
      const ok = await fetchClip(scene.keywords, path.join(ROOT, "public", brollRel));
      if (!ok) continue;
      const normed = await normalizeClip(path.join(ROOT, "public", brollRel));
      if (normed) {
        scene.broll = brollRel;
        brollCount++;
        console.log(`  [${i + 1}/${doc.scenes.length}] b-roll ✓`);
      } else {
        console.log(`  [${i + 1}/${doc.scenes.length}] b-roll skipped (transcode failed)`);
      }
    }
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  // `engine` / `fallbackVoice` are build-time hints, not render props — keep them
  // out of the props JSON so they never trip Remotion's schema validation.
  delete doc.engine;
  delete doc.fallbackVoice;
  await fs.writeFile(outPath, JSON.stringify(doc, null, 2));

  const total = doc.scenes.reduce((s, sc) => s + sc.durationInFrames, 0);
  console.log(`\n✓ ${base}: ${(total / FPS).toFixed(1)}s total → ${path.relative(ROOT, outPath)}`);
  console.log(`  Render: npx remotion render AINews out/${base}.mp4 --props=${path.relative(ROOT, outPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
