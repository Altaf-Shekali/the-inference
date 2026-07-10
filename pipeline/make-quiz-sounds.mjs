/**
 * Generate the quiz sound effects (16-bit PCM WAV) into public/quiz/:
 *   tick.wav   — a 1.000s countdown blip (looped → one tick per second)
 *   reveal.wav — a rising two-note "answer revealed" chime
 *   bg.wav     — a soft 8s ambient pad (loops seamlessly, kept very quiet)
 *
 * Pure Node, no dependencies, fully license-clean (synthesised here).
 * Re-run any time:  node pipeline/make-quiz-sounds.mjs
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "..", "public", "quiz");
const SR = 44100;

/** encode a mono Float32 sample array [-1,1] as a WAV Buffer */
function wav(samples) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    b.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return b;
}

// tick: a short percussive blip at the very start of a 1.000s clip → loops to 1/sec
function makeTick() {
  const len = SR;
  const a = new Float32Array(len);
  const dur = Math.floor(SR * 0.045);
  for (let i = 0; i < dur; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 70);
    a[i] = (Math.sin(2 * Math.PI * 1500 * t) * 0.7 + Math.sin(2 * Math.PI * 2400 * t) * 0.3) * env * 0.55;
  }
  return a;
}

// reveal: a rising two-note chime (E5 → B5) with a soft bell envelope
function makeReveal() {
  const len = Math.floor(SR * 0.9);
  const a = new Float32Array(len);
  const note = (f, start, dur, amp) => {
    const s0 = Math.floor(start * SR);
    for (let i = 0; i < SR * dur; i++) {
      const t = i / SR;
      const idx = s0 + i;
      if (idx >= len) break;
      const env = Math.min(1, t * 50) * Math.exp(-t * 3.2);
      a[idx] += (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * 2 * f * t)) * env * amp;
    }
  };
  note(659.25, 0.0, 0.55, 0.32); // E5
  note(987.77, 0.13, 0.7, 0.32); // B5
  return a;
}

// bg: a soft C-E-G pad with gentle tremolo. Frequencies are multiples of 1/8 Hz
// so every partial completes whole cycles in 8s → the loop is seamless (no click).
function makeBg() {
  const len = SR * 8;
  const a = new Float32Array(len);
  const freqs = [130.75, 164.75, 196.0]; // ≈ C3, E3, G3, snapped for seamless looping
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let s = 0;
    for (const f of freqs) s += Math.sin(2 * Math.PI * f * t);
    const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.125 * t); // 0.125Hz → whole cycle in 8s
    a[i] = (s / freqs.length) * 0.14 * trem;
  }
  return a;
}

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, "tick.wav"), wav(makeTick()));
await fs.writeFile(path.join(OUT, "reveal.wav"), wav(makeReveal()));
await fs.writeFile(path.join(OUT, "bg.wav"), wav(makeBg()));
console.log("✓ wrote tick.wav, reveal.wav, bg.wav to public/quiz/");
