/**
 * List Cartesia voices for a language so you can pick a voice id for a channel.
 *
 *   node pipeline/cartesia-voices.mjs kn      # Kannada voices
 *   node pipeline/cartesia-voices.mjs hi      # Hindi voices
 *
 * Uses the key from pipeline/cartesia.<lang>.key (or cartesia.key / CARTESIA_KEY).
 * Copy an id into the channel's "cartesiaVoice" (dashboard or channels.json).
 */
import { cartesiaKey } from "./tts.mjs";

const lang = (process.argv[2] || "en").trim();
const key = cartesiaKey(lang);
if (!key) {
  console.error(`No Cartesia key for '${lang}'. Add pipeline/cartesia.${lang}.key (or pipeline/cartesia.key).`);
  process.exit(1);
}

const r = await fetch(`https://api.cartesia.ai/voices?language=${encodeURIComponent(lang)}&limit=100`, {
  headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": "2026-03-01" },
});
if (!r.ok) {
  console.error(`Cartesia ${r.status}: ${(await r.text()).slice(0, 300)}`);
  process.exit(1);
}
const data = await r.json();
const voices = Array.isArray(data) ? data : data.data || data.voices || [];
const forLang = voices.filter((v) => !v.language || v.language.startsWith(lang));

if (!forLang.length) {
  console.log(`No voices returned for '${lang}'. Browse the full library at https://play.cartesia.ai/voices`);
  process.exit(0);
}
console.log(`\n${forLang.length} Cartesia voice(s) for '${lang}':\n`);
for (const v of forLang) {
  console.log(`  ${v.id}`);
  console.log(`     ${v.name}${v.gender ? " · " + v.gender : ""}${v.description ? " — " + v.description.slice(0, 80) : ""}\n`);
}
console.log('Set one as a channel\'s "cartesiaVoice" (dashboard → Channels, or pipeline/channels.json).');
