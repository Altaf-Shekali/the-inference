/**
 * List Cartesia voices so you can pick a voice id for a channel.
 *
 *   node pipeline/cartesia-voices.mjs kn          # stock Kannada voices
 *   node pipeline/cartesia-voices.mjs hi          # stock Hindi voices
 *   node pipeline/cartesia-voices.mjs kn --mine   # YOUR OWN voices (clones), using the kn key
 *
 * The key comes from pipeline/cartesia.<lang>.key (or cartesia.key / CARTESIA_KEY).
 * A cloned voice lives in the account of the key you pass — list --mine with that
 * account's key. Copy an id into the channel's "cartesiaVoice".
 */
import { cartesiaKey } from "./tts.mjs";

const args = process.argv.slice(2);
const mine = args.includes("--mine") || args.includes("mine");
const lang = (args.find((a) => !a.startsWith("--") && a !== "mine") || "en").trim();
const key = cartesiaKey(lang);
if (!key) {
  console.error(`No Cartesia key for '${lang}'. Add pipeline/cartesia.${lang}.key (or pipeline/cartesia.key).`);
  process.exit(1);
}

const url = mine
  ? "https://api.cartesia.ai/voices?is_owner=true&limit=100"
  : `https://api.cartesia.ai/voices?language=${encodeURIComponent(lang)}&limit=100`;
const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": "2026-03-01" } });
if (!r.ok) {
  console.error(`Cartesia ${r.status}: ${(await r.text()).slice(0, 300)}`);
  process.exit(1);
}
const data = await r.json();
const voices = Array.isArray(data) ? data : data.data || data.voices || [];
const list = mine ? voices.filter((v) => v.is_owner) : voices.filter((v) => !v.language || v.language.startsWith(lang));

if (!list.length) {
  console.log(mine ? "No voices of your own found on this key's account. Clone one at https://play.cartesia.ai/voices" : `No stock voices for '${lang}'. Browse https://play.cartesia.ai/voices`);
  process.exit(0);
}
console.log(`\n${list.length} ${mine ? "voice(s) YOU OWN" : `Cartesia voice(s) for '${lang}'`}:\n`);
for (const v of list) {
  console.log(`  ${v.id}`);
  console.log(`     ${v.name}${v.language ? " · " + v.language : ""}${v.gender ? " · " + v.gender : ""}${v.description ? " — " + v.description.slice(0, 70) : ""}\n`);
}
console.log('Set one as a channel\'s "cartesiaVoice" (dashboard → Channels, or pipeline/channels.json).');
console.log("Note: one cloned voice can speak multiple languages — set the channel's lang, keep the same voice id.");
