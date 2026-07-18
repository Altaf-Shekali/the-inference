/**
 * Channel registry — one "channel" = one YouTube destination with its own
 * language, name, pillars, topic history, and OAuth token.
 *
 * Registry: pipeline/channels.json (array of channel configs).
 * Per-channel data lives under pipeline/channels/<id>/ :
 *   - youtube.token.json   (its own YouTube authorization)
 *   - used-topics.json     (independent topic history / dedup)
 *
 * If channels.json is missing, the pipeline behaves as a single default channel
 * ("The Inference", English) using the legacy pipeline/youtube.token.json and
 * pipeline/used-topics.json — so existing setups keep working untouched.
 */
import { promises as fs, existsSync, readFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url)); // pipeline/
const REG = path.join(DIR, "channels.json");
const CH_DIR = path.join(DIR, "channels");

// Target regions → suggested peak-viewership UPLOAD time, in THIS machine's local
// clock (IST, UTC+5:30). The render is triggered 1 hour before uploadTime, and
// YouTube's scheduled publish releases it at that instant (converted to UTC).
//   US 22:30 IST = 17:00 UTC = 1:00 PM ET / 10:00 AM PT  (high-CPM US afternoon)
//   IN 20:00 IST = India prime evening
export const REGIONS = {
  IN: { label: "India (IST prime evening)", uploadTime: "20:00" },
  US: { label: "US / worldwide (high CPM)", uploadTime: "22:30" },
};

export const DEFAULT_CHANNEL = {
  id: "the-inference",
  name: "The Inference",
  spokenName: "", // "" = use name; set to native script (e.g. "ಜವಾರಿ ಆತ್ಮ") so TTS reads the channel name correctly
  lang: "en",
  niche: "ainews", // "ainews" = tech-news pillars; "story" = true-story storytelling
  pillars: ["ainews", "tools", "trend", "business"],
  engine: "", // "" = auto (edge); "cartesia" = Cartesia Sonic (needs cartesiaVoice + cartesia.<lang>.key)
  voice: "", // "" = language default. With engine "cartesia" this is the Edge FALLBACK voice.
  cartesiaVoice: "", // Cartesia voice UUID (from `node pipeline/cartesia-voices.mjs <lang>`)
  region: "IN",
  uploadTime: "", // "" = use the region's suggested time
  renderTime: "", // "" = render 1h before uploadTime; else a fixed local HH:MM (e.g. idle morning)
  topics: "", // phrase (in the channel's language) used in the mid-video subscribe reminder
  privacy: "private",
  enabled: true,
};

const normalize = (c) => {
  const m = { ...DEFAULT_CHANNEL, ...c };
  m.uploadTime = m.uploadTime || REGIONS[m.region]?.uploadTime || "19:30";
  return m;
};

/** the effective local upload time for a channel ("HH:MM") */
export const uploadTimeOf = (c) => c.uploadTime || REGIONS[c.region]?.uploadTime || "19:30";

/** all channels (or a single implicit default if no registry yet) */
export function loadChannels() {
  try {
    const arr = JSON.parse(readFileSync(REG, "utf8"));
    return Array.isArray(arr) && arr.length ? arr.map(normalize) : [DEFAULT_CHANNEL];
  } catch {
    return [DEFAULT_CHANNEL];
  }
}

/** one channel by id (falls back to the first/default) */
export function getChannel(id) {
  const chs = loadChannels();
  return (id && chs.find((c) => c.id === id)) || chs[0];
}

export const channelDir = (id) => path.join(CH_DIR, id);

/** where to READ a channel's token (per-channel dir; legacy only for the default) */
export function channelTokenPath(id) {
  const p = path.join(CH_DIR, id, "youtube.token.json");
  if (existsSync(p)) return p;
  if (id === DEFAULT_CHANNEL.id) {
    const legacy = path.join(DIR, "youtube.token.json");
    if (existsSync(legacy)) return legacy;
  }
  return p;
}

/** where auth WRITES a channel's token (always the per-channel dir) */
export function channelTokenWritePath(id) {
  mkdirSync(path.join(CH_DIR, id), { recursive: true });
  return path.join(CH_DIR, id, "youtube.token.json");
}

/** a channel's topic history (per-channel dir; legacy only for the default) */
export function channelUsedTopicsPath(id) {
  const p = path.join(CH_DIR, id, "used-topics.json");
  if (existsSync(p)) return p;
  if (id === DEFAULT_CHANNEL.id) {
    const legacy = path.join(DIR, "used-topics.json");
    if (existsSync(legacy)) return legacy;
  }
  return p;
}

export async function saveChannels(arr) {
  await fs.writeFile(REG, JSON.stringify(arr, null, 2));
}

/** add or update a channel; ensures its data dir exists */
export async function addChannel(cfg) {
  if (!cfg?.id) throw new Error("channel needs an id");
  const chs = loadChannels();
  const i = chs.findIndex((c) => c.id === cfg.id);
  const merged = normalize({ ...(i >= 0 ? chs[i] : {}), ...cfg });
  if (i >= 0) chs[i] = merged;
  else chs.push(merged);
  mkdirSync(channelDir(merged.id), { recursive: true });
  await saveChannels(chs);
  return merged;
}

/** remove a channel from the registry (its data dir is left on disk) */
export async function removeChannel(id) {
  const chs = loadChannels().filter((c) => c.id !== id);
  await saveChannels(chs);
  return chs;
}
