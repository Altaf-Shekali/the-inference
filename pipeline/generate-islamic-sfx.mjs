/**
 * Procedural Audio Synthesizer for Islamic Reminders.
 *
 * Generates clean, organic 44.1kHz 16-bit PCM WAV sound effects:
 * - bead.wav: Soft organic wooden bead tap / click for counting
 * - shimmer.wav: Gentle transition chime / soft bell chord
 * - complete.wav: Warm, peaceful resonant completion chime
 * - rain.wav: Soothing low-pass filtered ambient rain
 *
 * Zero external dependencies.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(DIR, "..", "public", "islamic");

function createWavBuffer(samples, sampleRate = 44100) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);

  // RIFF chunk descriptor
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write("WAVE", 8);

  // fmt sub-chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // audioFormat (1 = PCM)
  buffer.writeUInt16LE(1, 22); // numChannels (1 = mono)
  buffer.writeUInt32LE(sampleRate, 24); // sampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // byteRate (sampleRate * numChannels * bitsPerSample/8)
  buffer.writeUInt16LE(2, 32); // blockAlign
  buffer.writeUInt16LE(16, 34); // bitsPerSample

  // data sub-chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  // Write 16-bit signed PCM samples
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(Math.round(val), 44 + i * 2);
  }

  return buffer;
}

// 1. Soft Wooden Bead Tap (~60ms)
function generateBeadTap(sampleRate = 44100) {
  const duration = 0.07; // 70ms
  const count = Math.floor(sampleRate * duration);
  const samples = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    // Rapid exponential decay
    const envelope = Math.exp(-t * 85);
    // Wood acoustic harmonics: ~720Hz primary + ~1440Hz overtone
    const osc1 = Math.sin(2 * Math.PI * 720 * t);
    const osc2 = Math.sin(2 * Math.PI * 1440 * t) * 0.35;
    // Tiny click noise burst in first 3ms
    const noise = t < 0.004 ? (Math.random() * 2 - 1) * 0.5 : 0;

    samples[i] = (osc1 + osc2 + noise) * envelope * 0.7;
  }
  return createWavBuffer(samples, sampleRate);
}

// 2. Gentle Transition Shimmer (~1.5s)
function generateShimmer(sampleRate = 44100) {
  const duration = 1.4;
  const count = Math.floor(sampleRate * duration);
  const samples = new Float32Array(count);

  // Peaceful pentatonic frequencies (G4, C5, D5, G5)
  const freqs = [392.0, 523.25, 587.33, 783.99];

  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    // Smooth attack (60ms) and slow release
    const attack = Math.min(1, t / 0.06);
    const decay = Math.exp(-t * 2.8);
    const envelope = attack * decay;

    let sum = 0;
    freqs.forEach((f, idx) => {
      const phase = t * 2 * Math.PI * f;
      // Slight detune for warmth
      const detune = Math.sin(t * 4) * 0.002;
      sum += Math.sin(phase * (1 + detune)) * (1 / (idx + 1));
    });

    samples[i] = sum * envelope * 0.35;
  }
  return createWavBuffer(samples, sampleRate);
}

// 3. Resonant Completion Chime (~2.5s)
function generateCompleteChime(sampleRate = 44100) {
  const duration = 2.4;
  const count = Math.floor(sampleRate * duration);
  const samples = new Float32Array(count);

  // Serene C Major triad harmonics (C5 = 523Hz, E5 = 659Hz, G5 = 784Hz, C6 = 1046Hz)
  const freqs = [523.25, 659.25, 783.99, 1046.5];

  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.08);
    const decay = Math.exp(-t * 1.6);
    const envelope = attack * decay;

    let sum = 0;
    freqs.forEach((f, idx) => {
      sum += Math.sin(2 * Math.PI * f * t) * (1 / (idx * 0.8 + 1));
    });

    samples[i] = sum * envelope * 0.4;
  }
  return createWavBuffer(samples, sampleRate);
}

// 4. Subtle Ambient Rain Bed (~6s seamless loop)
function generateAmbientRain(sampleRate = 44100) {
  const duration = 6.0;
  const count = Math.floor(sampleRate * duration);
  const samples = new Float32Array(count);

  // Filtered noise simulating soothing rain
  let lastOut = 0;
  for (let i = 0; i < count; i++) {
    const white = Math.random() * 2 - 1;
    // Simple low-pass filter (RC filter approximation)
    lastOut = lastOut + 0.06 * (white - lastOut);

    // Subtle gentle swell
    const swell = 0.85 + 0.15 * Math.sin((i / count) * 2 * Math.PI * 3);

    // Fade in and out at boundaries for seamless loop
    const t = i / count;
    const fade = Math.sin(t * Math.PI);

    samples[i] = lastOut * swell * fade * 0.22;
  }
  return createWavBuffer(samples, sampleRate);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const beadBuf = generateBeadTap();
  await fs.writeFile(path.join(OUT_DIR, "bead.wav"), beadBuf);
  console.log("✓ Generated public/islamic/bead.wav");

  const shimmerBuf = generateShimmer();
  await fs.writeFile(path.join(OUT_DIR, "shimmer.wav"), shimmerBuf);
  console.log("✓ Generated public/islamic/shimmer.wav");

  const completeBuf = generateCompleteChime();
  await fs.writeFile(path.join(OUT_DIR, "complete.wav"), completeBuf);
  console.log("✓ Generated public/islamic/complete.wav");

  const rainBuf = generateAmbientRain();
  await fs.writeFile(path.join(OUT_DIR, "rain.wav"), rainBuf);
  console.log("✓ Generated public/islamic/rain.wav");

  console.log("\nAll Islamic sound effects synthesized successfully!");
}

main().catch(console.error);
