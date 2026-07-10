/**
 * Generate royalty-free sound assets procedurally — no API, no copyright,
 * no manual sourcing. Produces:
 *   public/music/bed.wav   — calm ambient tech pad (loops under narration)
 *   public/sfx/whoosh.wav  — transition whoosh played at each cut
 *   public/sfx/impact.wav  — low hit for stat / data reveals
 *
 * Run once:  npm run sound   (re-run to regenerate). Swap in real tracks
 * anytime by dropping your own bed.mp3 / whoosh.mp3 in the same folders.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SR = 44100;

/** write 16-bit PCM WAV from interleaved Float32 samples */
async function writeWav(absPath, data, channels) {
  const dataSize = data.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    buf.writeInt16LE((s * 32767) | 0, off);
    off += 2;
  }
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, buf);
}

const TAU = Math.PI * 2;

/** transition whoosh — band-limited noise that swells and sweeps */
function whoosh(dur = 0.5) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.pow(Math.sin(Math.PI * t), 1.5); // swell in/out
    const cutoff = 0.02 + 0.5 * Math.sin(Math.PI * t); // filter sweep
    const noise = Math.random() * 2 - 1;
    lp += cutoff * (noise - lp);
    out[i] = lp * env * 0.7;
  }
  return out;
}

/** riser — building noise + rising tone, for intros / big reveals */
function riser(dur = 0.8) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let lp = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.pow(t, 1.4) * (t > 0.94 ? (1 - t) / 0.06 : 1); // build, tiny tail
    const freq = 200 + 1300 * t * t; // sweep up
    phase += (TAU * freq) / SR;
    const cutoff = 0.05 + 0.6 * t;
    const noise = Math.random() * 2 - 1;
    lp += cutoff * (noise - lp);
    out[i] = (lp * 0.7 + Math.sin(phase) * 0.3) * env * 0.6;
  }
  return out;
}

/** boom — deep pitched sine drop + click, for data reveals */
function boom(dur = 0.45) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const freq = 120 * Math.exp(-4 * t) + 40; // drop 160→~40 Hz
    phase += (TAU * freq) / SR;
    const click = i < SR * 0.018 ? (Math.random() * 2 - 1) * Math.exp(-i / (SR * 0.004)) : 0;
    const env = Math.exp(-5 * t);
    out[i] = (Math.sin(phase) * env + click * 0.4) * 0.85;
  }
  return out;
}

/** tick — very short blip for list items appearing */
function tick(dur = 0.06) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.exp(-30 * t);
    const noise = Math.random() * 2 - 1;
    const high = Math.sin((TAU * 2600 * i) / SR);
    out[i] = (noise * 0.6 + high * 0.4) * env * 0.5;
  }
  return out;
}

/** ding — bright bell tone for news / notifications / outro */
function ding(dur = 0.5) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  const f = 1318.51; // E6
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-5 * t);
    const s =
      Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 2 * t) + 0.3 * Math.sin(TAU * f * 3 * t);
    out[i] = (s / 1.8) * env * 0.45;
  }
  return out;
}

/** click — snappy pitched click for tool / UI moments */
function click(dur = 0.09) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.exp(-22 * t);
    phase += (TAU * 760) / SR;
    const noise = i < SR * 0.01 ? (Math.random() * 2 - 1) * 0.6 : 0;
    out[i] = (Math.sin(phase) * 0.7 + noise) * env * 0.5;
  }
  return out;
}

/** ambient pad bed — stacked open fifths with slow swells, stereo */
function bed(dur = 32) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n * 2);
  const freqs = [130.81, 196.0, 261.63, 392.0]; // C3 G3 C4 G4 — calm, stable
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < freqs.length; k++) {
      const f = freqs[k];
      const lfo = 0.6 + 0.4 * Math.sin(TAU * 0.05 * t + k); // per-voice swell
      s += Math.sin(TAU * f * t) * lfo;
      s += Math.sin(TAU * f * 1.003 * t) * lfo * 0.5; // detune for width
    }
    s /= freqs.length * 1.5;
    const master = 0.4 * (0.7 + 0.3 * Math.sin(TAU * 0.03 * t)); // long master swell
    const sample = s * master;
    lpL += 0.08 * (sample - lpL); // gentle lowpass, warm
    lpR += 0.075 * (sample - lpR); // slightly different → stereo width
    out[i * 2] = lpL;
    out[i * 2 + 1] = lpR;
  }
  return out;
}

async function main() {
  const sfxDir = path.join(ROOT, "public", "sfx");
  const lib = { whoosh: whoosh(), riser: riser(), boom: boom(), tick: tick(), ding: ding(), click: click() };
  for (const [name, data] of Object.entries(lib)) {
    await writeWav(path.join(sfxDir, `${name}.wav`), data, 1);
  }
  await writeWav(path.join(ROOT, "public", "music", "bed.wav"), bed(), 2);
  console.log(`✓ generated SFX library: ${Object.keys(lib).join(", ")} + music bed`);
  console.log("  (swap in your own <name>.mp3 anytime — the build prefers .mp3 over generated .wav)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
