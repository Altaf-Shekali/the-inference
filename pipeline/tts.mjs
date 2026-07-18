import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Synthesize speech with a selectable engine. Returns the audio buffer, word
 * timings (seconds), and the file extension to save it under.
 *
 *   engine "edge"   → free Microsoft Edge neural voices (cloud, word-accurate timings)
 *   engine "kokoro" → local Kokoro ONNX voices (Apache-2.0, commercial-safe, offline)
 *
 * If Kokoro is requested but not installed, it falls back to Edge so a render
 * never fails over engine choice.
 *
 * @returns {Promise<{buffer: Buffer, words: {word,start,end}[], ext: string}>}
 */
export async function synth(text, voice = "en-US-AndrewNeural", engine = "edge", opts = {}) {
  if (engine === "cartesia") {
    // strict: throw on failure so the CALLER can drop the whole video to Edge
    // (keeps one consistent voice per video instead of mixing mid-way).
    if (opts.strict) return synthCartesia(text, voice, opts.lang || "en");
    try {
      return await synthCartesia(text, voice, opts.lang || "en");
    } catch (e) {
      console.warn(`  ⚠ Cartesia failed (${e.message}) — falling back to Edge`);
      return synthEdge(text, opts.fallbackVoice || "en-US-AndrewNeural");
    }
  }
  if (engine === "kokoro") {
    if (!kokoroAvailable()) {
      console.warn("  ⚠ Kokoro not installed — falling back to Edge TTS");
      return synthEdge(text, "en-US-AndrewNeural");
    }
    return synthKokoro(text, voice);
  }
  return synthEdge(text, voice);
}

// ------------------------------------------------------------- Cartesia (cloud)
// Sonic voices — natural/expressive, supports kn + hi. Per-language API keys so
// each channel can draw on its own free credits: cartesia.<lang>.key (or the env
// CARTESIA_<LANG>_KEY), falling back to the shared cartesia.key / CARTESIA_KEY.
const CARTESIA_VERSION = "2026-03-01";
const CARTESIA_MODEL = process.env.CARTESIA_MODEL || readLocal("cartesia.model") || "sonic-3.5";

function readLocal(f) {
  try {
    return readFileSync(path.join(HERE, f), "utf8").trim();
  } catch {
    return "";
  }
}

export function cartesiaKey(lang = "") {
  const L = String(lang).toUpperCase();
  return (
    process.env[`CARTESIA_${L}_KEY`] ||
    readLocal(`cartesia.${lang}.key`) ||
    process.env.CARTESIA_KEY ||
    readLocal("cartesia.key") ||
    ""
  ).trim();
}

async function synthCartesia(text, voiceId, lang) {
  const key = cartesiaKey(lang);
  if (!key) throw new Error(`no cartesia key for '${lang}' (add pipeline/cartesia.${lang}.key)`);
  if (!voiceId) throw new Error("no cartesia voice id (set the channel's cartesiaVoice)");
  const sampleRate = 44100;
  const r = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: CARTESIA_MODEL,
      transcript: sanitize(text),
      voice: { mode: "id", id: voiceId },
      language: lang,
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: sampleRate },
    }),
  });
  if (!r.ok) throw new Error(`cartesia ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const buffer = Buffer.from(await r.arrayBuffer());
  // WAV pcm_s16le (mono): audio seconds = data bytes / (sampleRate * 2). The 44-byte
  // header is negligible; Cartesia gives no word timings so we estimate them.
  const duration = Math.max(0.1, (buffer.length - 44) / (sampleRate * 2));
  return { buffer, words: estimateWords(text, duration), ext: "wav" };
}

// ---------------------------------------------------------------- Edge (cloud)
async function synthEdge(text, voice = "en-US-AndrewNeural") {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
  });

  // Edge TTS embeds the text in SSML (XML). Unescaped &, <, > break the XML
  // and produce a CORRUPT/empty audio stream — replace them with speech-safe
  // equivalents. (& → "and" reads naturally for narration.)
  const safe = sanitize(text);

  const { audioStream, metadataStream } = tts.toStream(safe);

  const chunks = [];
  audioStream.on("data", (c) => chunks.push(c));

  const words = [];
  metadataStream.on("data", (m) => {
    const obj = JSON.parse(Buffer.isBuffer(m) ? m.toString() : m);
    for (const item of obj?.Metadata ?? []) {
      if (item.Type === "WordBoundary") {
        const start = item.Data.Offset / 1e7; // 100ns ticks → seconds
        const end = (item.Data.Offset + item.Data.Duration) / 1e7;
        words.push({ word: item.Data.text.Text, start, end });
      }
    }
  });

  await new Promise((resolve, reject) => {
    audioStream.on("end", resolve);
    audioStream.on("error", reject);
  });

  return { buffer: Buffer.concat(chunks), words, ext: "mp3" };
}

// -------------------------------------------------------------- Kokoro (local)
const PY = process.platform === "win32"
  ? path.join(HERE, ".venv-tts", "Scripts", "python.exe")
  : path.join(HERE, ".venv-tts", "bin", "python");
const KSCRIPT = path.join(HERE, "tts-kokoro.py");
const KMODEL = path.join(HERE, "kokoro", "kokoro-v1.0.onnx");

/** is the local Kokoro engine set up (venv + model present)? */
export function kokoroAvailable() {
  return existsSync(PY) && existsSync(KSCRIPT) && existsSync(KMODEL);
}

/** Kokoro gives no word timestamps, so estimate them by spreading the words
 *  across the real audio duration, weighted by word length (longer ≈ longer). */
function estimateWords(text, duration) {
  const toks = text.split(/\s+/).filter(Boolean);
  const weights = toks.map((w) => Math.max(1, w.replace(/[^A-Za-z0-9]/g, "").length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return toks.map((word, i) => {
    const d = (duration * weights[i]) / total;
    const cue = { word, start: t, end: t + d };
    t += d;
    return cue;
  });
}

function synthKokoro(text, voice = "am_michael") {
  const stem = path.join(os.tmpdir(), `kok-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const txt = `${stem}.txt`;
  const wav = `${stem}.wav`;
  writeFileSync(txt, sanitize(text), "utf8");
  try {
    const r = spawnSync(PY, [KSCRIPT, "--voice", voice, "--text-file", txt, "--out", wav], {
      encoding: "utf8",
      maxBuffer: 1 << 24,
    });
    if (r.status !== 0) throw new Error(`kokoro exit ${r.status}: ${(r.stderr || r.stdout || "").trim().slice(-300)}`);
    const meta = JSON.parse((r.stdout || "").trim().split(/\r?\n/).pop());
    if (meta.error) throw new Error(meta.error);
    return { buffer: readFileSync(wav), words: estimateWords(text, meta.duration), ext: "wav" };
  } finally {
    for (const f of [txt, wav]) {
      try {
        unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
}

// strip markup the engines would read literally / that breaks Edge's SSML
function sanitize(text) {
  return text
    .replace(/\*+/g, "")
    .replace(/`/g, "")
    .replace(/&/g, " and ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Selectable voices. Edge = cloud neural; Kokoro = local Apache-2.0 (offline). */
export const VOICES = {
  // Edge
  andrew: "en-US-AndrewNeural",
  ava: "en-US-AvaNeural",
  // Kokoro (am_=US male, af_=US female, bm_=UK male)
  k_michael: "am_michael",
  k_adam: "am_adam",
  k_heart: "af_heart",
  k_george: "bm_george",
};
