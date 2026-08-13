/**
 * Gemini client — used to translate scripts into languages where Nemotron is
 * weak (e.g. Kannada). Google's models have strong Indic-language quality.
 *
 * Setup: put your key in pipeline/gemini.key (one line) or env GEMINI_API_KEY /
 * GOOGLE_API_KEY. Override the model in pipeline/gemini.model (default below).
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

const readLocal = (f) => {
  try {
    return readFileSync(path.join(DIR, f), "utf8").trim();
  } catch {
    return "";
  }
};

// Cache the key after the first successful read — when the repo lives on a flaky
// network share, a mid-run file-read blip must not kill generation #2 of a run.
let KEY_CACHE = "";
const loadKey = () => {
  if (KEY_CACHE) return KEY_CACHE;
  KEY_CACHE = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || readLocal("gemini.key") || "").trim();
  return KEY_CACHE;
};
const MODEL = process.env.GEMINI_MODEL || readLocal("gemini.model") || "gemini-2.5-flash";

export const hasGemini = () => loadKey().length > 0;

/** first balanced JSON array/object in a string — string-aware, so braces and
 *  brackets inside dialogue/text values never confuse the depth counter */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("no JSON in Gemini output");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error("unbalanced JSON in Gemini output");
}

/** pull out every complete top-level {...} object, even from a truncated/malformed
 *  array (a partial last object is simply skipped). String-aware so braces inside
 *  quotes don't confuse the depth counter. */
function salvageObjects(text) {
  const objs = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") { if (depth++ === 0) start = i; }
    else if (ch === "}" && depth > 0 && --depth === 0 && start >= 0) {
      try { objs.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip a broken object */ }
      start = -1;
    }
  }
  return objs;
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

/** call `makeFetch` (a thunk returning a fresh fetch promise), retrying on 429
 *  (rate limit), 5xx AND network-level fetch failures ("fetch failed" on a flaky
 *  hotspot/link) with backoff. Returns the final Response, or throws the last
 *  network error only after all tries are exhausted. */
async function withRetry(makeFetch, { tries = 3, base = 20000 } = {}) {
  let r;
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      r = await makeFetch();
      lastErr = null;
      if (r.status !== 429 && r.status < 500) return r;
      if (process.env.QUIZ_DEBUG) console.error(`[gemini] ${r.status} — retrying in ${(base * (i + 1)) / 1000}s`);
    } catch (e) {
      lastErr = e; // network drop — wait and retry
      if (process.env.QUIZ_DEBUG) console.error(`[gemini] ${e.message} — retrying in ${(base * (i + 1)) / 1000}s`);
    }
    if (i < tries - 1) await sleep(base * (i + 1)); // 20s, 40s
  }
  if (lastErr) throw lastErr;
  return r;
}

async function generate(prompt, { temperature = 0.3, system = null, maxOutputTokens = null } = {}) {
  const key = loadKey();
  if (!key) throw new Error("No Gemini key — add pipeline/gemini.key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const generationConfig = { temperature, responseMimeType: "application/json" };
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const r = await withRetry(() =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    throw new Error(`Gemini ${r.status} (${MODEL}): ${body}${r.status === 404 ? " — set the model in pipeline/gemini.model" : ""}`);
  }
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/** Nemotron-compatible JSON chat backed by Gemini — a fallback for when the
 *  Nemotron API is unreachable. Takes OpenAI-style messages, returns parsed JSON. */
export async function geminiChatJSON(messages, { maxTokens } = {}) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || null;
  const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");
  // This is the last-resort fallback (Nemotron already failed) — a malformed
  // sample here must not be the final failure, so resample before giving up.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return extractJson(await generate(user, { temperature: 0.6, system, maxOutputTokens: maxTokens || 6000 }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Daily current-affairs + static-GK MCQ set for competitive exams — grounded in
 *  this week's real news, then fact-checked. Returns a clean questions[] array. */
export async function geminiQuiz(count = 12) {
  const gk = Math.max(1, Math.round(count * 0.2));
  const ca = count - gk;
  // Gather THIS WEEK's real current-affairs facts. Gemini's grounded search is the
  // nicest (synthesized + cited) but its free-tier quota is tiny and frequently
  // rate-limited, so when it comes up short we fall back to plain web search
  // (Tavily/DuckDuckGo — a SEPARATE quota) and read the top current-affairs pages.
  const monthYear = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  let facts = "";
  try {
    const g = await geminiGroundedSearch(
      `The most important current affairs from this past month (${monthYear}) for Indian competitive exams (UPSC, SSC, banking, railways) — a broad monthly roundup, not just the last few days: national news, international, economy, appointments, awards, sports, science, defence, government schemes. Give concrete facts with names, dates and numbers, covering the full month so far.`,
    );
    facts = (g.answer || "").trim();
  } catch {
    /* grounding unavailable — web fallback below */
  }
  if (facts.length < 600) {
    try {
      const { search, fetchText } = await import("./search.mjs");
      const hits = await search(
        `India current affairs ${monthYear} monthly compilation for competitive exams: appointments, awards, schemes, economy, sports, defence, international`,
        6,
      );
      // prefer the clean per-article snippet (raw page content is full of nav junk)
      let web = hits
        .map((h) => {
          const c = (h.snippet || h.content || "").trim();
          return c ? `${h.title}: ${c.slice(0, 1500)}` : "";
        })
        .filter(Boolean)
        .join("\n\n");
      // if snippets were thin (e.g. DuckDuckGo gives titles only), read a few pages
      for (const h of hits.slice(0, 3)) {
        if (web.length > 6000) break;
        const t = await fetchText(h.url, 3000);
        if (t) web += `\n\n${h.title}:\n${t}`;
      }
      if (web.trim().length > facts.length) facts = web.trim();
    } catch {
      /* keep whatever we have (may be empty → GK-heavy) */
    }
  }
  if (process.env.QUIZ_DEBUG) console.error("[quiz] facts gathered:", facts.length, "chars");

  const clean = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .filter((q) => q && typeof q.q === "string" && Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3)
      .map((q) => ({ q: q.q, options: q.options.map(String), correct: q.correct, explanation: String(q.explanation || ""), tag: q.tag === "gk" ? "gk" : "current" }));

  const prompt =
    `You are an expert quiz-setter for Indian competitive exams. Write EXACTLY ${count} multiple-choice questions: ${ca} on CURRENT AFFAIRS from the facts below, and ${gk} on timeless STATIC GK (history, geography, polity, economy, science).\n` +
    `Rules: exam-appropriate difficulty; each has a clear stem, exactly 4 options, ONE correct answer, and a one-line explanation. NEVER invent facts — if unsure of a current-affairs detail, use static GK instead. The correct answer MUST be genuinely correct.\n\n` +
    `THIS MONTH'S CURRENT AFFAIRS FACTS:\n${facts.slice(0, 8000)}\n\n` +
    `Return ONLY JSON: {"questions":[{"q":"...","options":["..","..","..",".."],"correct":<0-3>,"explanation":"...","tag":"current"|"gk"}]}`;
  // 25 MCQs + explanations need plenty of room; if the JSON is still truncated,
  // salvage every complete question object rather than losing the whole batch.
  const rawGen = await generate(prompt, { temperature: 0.5, maxOutputTokens: 16384 });
  let questions;
  try {
    questions = clean(extractJson(rawGen).questions);
  } catch {
    questions = clean(salvageObjects(rawGen));
  }
  if (!questions.length) questions = clean(salvageObjects(rawGen));
  if (process.env.QUIZ_DEBUG) { const t = {}; questions.forEach((q) => (t[q.tag] = (t[q.tag] || 0) + 1)); console.error("[quiz] facts chars:", facts.length, "| after generation:", JSON.stringify(t)); }

  // fact-check pass — verify answers, fix wrong ones. CRITICAL: current-affairs
  // questions are checked AGAINST the grounded FACTS (the source of truth), not the
  // model's memory — otherwise every recent event gets dropped as "unverifiable".
  if (questions.length) {
    try {
      const v = extractJson(
        await generate(
          `You are a fact-checker for an exam quiz containing two kinds of questions: tag "current" (current affairs) and tag "gk" (timeless static GK).\n` +
            `- For "current" questions: the FACTS below are the SOURCE OF TRUTH — verify against them, NOT your own memory. If the marked answer matches the facts, keep it. If it contradicts the facts, fix "correct". Only DROP a "current" question if its subject is entirely absent from the facts. NEVER drop a current-affairs question just because it looks recent or unfamiliar.\n` +
            `- For "gk" questions: verify with your own knowledge; fix "correct" if wrong; drop only if clearly wrong.\n` +
            `Preserve each question's "tag" and keep as many questions as possible. Keep the same JSON shape.\n` +
            `Return ONLY JSON {"questions":[...]}\n\n` +
            `FACTS:\n${facts.slice(0, 8000)}\n\n` +
            `QUESTIONS:\n${JSON.stringify({ questions })}`,
          { temperature: 0.1, maxOutputTokens: 16384 },
        ),
      );
      const checked = clean(v.questions);
      if (process.env.QUIZ_DEBUG) { const t = {}; checked.forEach((q) => (t[q.tag] = (t[q.tag] || 0) + 1)); console.error("[quiz] after fact-check:", JSON.stringify(t), "| kept?", checked.length >= Math.max(Math.min(5, questions.length), Math.round(questions.length * 0.6))); }
      // accept the checked set only if it kept most questions — never let it decimate
      // the grounded current-affairs mix; otherwise keep the generated set.
      if (checked.length >= Math.max(Math.min(5, questions.length), Math.round(questions.length * 0.6))) questions = checked;
    } catch {
      /* keep the unverified set */
    }
  }
  return questions.slice(0, count);
}

/**
 * Web search via Gemini + Google Search grounding — a synthesized, cited answer.
 * Works where Tavily/DuckDuckGo are network-blocked (goes via googleapis).
 */
export async function geminiGroundedSearch(query) {
  const key = loadKey();
  if (!key) throw new Error("no gemini key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const r = await withRetry(() =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Research this and report the key current facts with specifics (names, numbers, dates, steps). Be concise and factual.\nQuery: ${query}` }] }],
        tools: [{ google_search: {} }],
      }),
      signal: AbortSignal.timeout(25000),
    }),
  );
  if (!r.ok) throw new Error(`gemini search ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const j = await r.json();
  const cand = j.candidates?.[0];
  const answer = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join("\n").trim();
  const sources = (cand?.groundingMetadata?.groundingChunks || [])
    .map((c) => ({ title: c.web?.title || "", url: c.web?.uri || "" }))
    .filter((s) => s.title || s.url);
  return { answer, sources };
}

/**
 * Translate an array of strings into `targetLang`, preserving **highlight**
 * markers and leaving brand names / numbers / acronyms in English. Returns an
 * array of the same length/order (falls back to the original for any gap).
 */
export async function geminiTranslate(texts, targetLang) {
  if (!texts.length) return [];
  const prompt =
    `Translate each item in this JSON array from English to ${targetLang}.\n` +
    `Rules:\n` +
    `- Return ONLY a JSON array of strings, the SAME length and order as the input.\n` +
    `- Natural, native, idiomatic ${targetLang} — never transliteration.\n` +
    `- Preserve any **double asterisks** around the translated equivalent of the emphasized words.\n` +
    `- Keep brand/product/company names, numbers, currency, percentages, URLs, and acronyms ` +
    `(AI, IPO, CEO, GPU…) in their original English/Latin form.\n\n` +
    `Input:\n${JSON.stringify(texts)}`;
  const out = extractJson(await generate(prompt));
  const arr = Array.isArray(out) ? out : out.translations || out.result || [];
  return texts.map((orig, i) => (typeof arr[i] === "string" && arr[i].trim() ? arr[i] : orig));
}

// ---- author personas (language-aware) — written to sound like a real human
// author narrating aloud, NEVER like AI. -------------------------------------

/** viral true-story creator persona */
export function storyPersona(langName) {
  const dna = langName === "Kannada" ? "ಡಿಎನ್ಎ" : "डीएनए";
  const usa = langName === "Kannada" ? "ಅಮೆರಿಕಾ" : "अमेरिका";
  return `You are a VIRAL ${langName} story-YouTuber — the kind whose true-story videos blow up because people literally cannot stop watching. You tell REAL stories in ${langName} with the energy of today's top creators: killer hooks, chill confident delivery, and a modern, conversational vibe.

Your writing is narrated ALOUD over video. It must feel like a charismatic young creator telling a jaw-dropping true story STRAIGHT to the viewer — NEVER like AI, never a dry literary essay, never translationese.

Craft rules:
- NARRATION STYLE = viral story-YouTuber: hooky, chill, fast, conversational, talking straight to the viewer. That's the DELIVERY.
- WORD CHOICE = blend TWO registers in ${langName}: modern Gen-Z / casual words the young audience uses, MIXED with a few evocative, literary, soulful words that carry emotional weight. So it feels current AND deep — never shallow slang-only, never a dry classic. Think a young creator with a poet's vocabulary.
- THE HOOK IS EVERYTHING: open on a shocking line, a "you won't believe this", a cliffhanger, or a question that makes them NEED to keep watching. NEVER a slow "long ago there was…" open.
- Talk TO the viewer (direct address). Build suspense with curiosity gaps between beats ("but what happened next changed everything…"). Vary rhythm: short punchy lines for tension, one flowing line to breathe.
- Deliver the twist with impact; land an ending that gives a feeling — goosebumps, a lesson, a "share this with someone" moment.
- Keep names, places and facts accurate to the research. Add atmosphere, but NEVER invent events that did not happen.
- ZERO English/Latin letters anywhere. Write EVERYTHING in ${langName} script — including modern/slang words and every name, place, brand and abbreviation/acronym: transliterate them into ${langName} (e.g. DNA -> ${dna}, USA -> ${usa}). The voice mispronounces Latin letters, so not one Latin character may appear in the narration or on-screen text.
- No markdown, no bullet-point feel, no emojis in the narration.`;
}

/** viral psychology-creator persona */
export function psychPersona(langName) {
  const dna = langName === "Kannada" ? "ಡಿಎನ್ಎ" : "डीएनए";
  const ai = langName === "Kannada" ? "ಎಐ" : "एआई";
  return `You are a VIRAL ${langName} psychology creator — the kind of relatable young YouTuber who makes mind-blowing psychology facts feel like juicy gossip you HAVE to share. Each video takes ONE real psychological truth (a bias, a hidden pattern of the mind, a behaviour) and reveals it with hooks and personality.

Your writing is narrated ALOUD over video. It must feel like a fun, sharp friend talking STRAIGHT to the viewer — chill, curious, a little dramatic — NEVER like AI, never a textbook, never a dry lecture, never translationese.

Craft rules:
- Natural, native, SPOKEN ${langName} — how people actually talk today. Conversational, playful, with a modern (Gen-Z / casual) flavor where it fits.
- THE HOOK IS EVERYTHING: open so the viewer instantly feels "wait, this is literally ME" — a bold claim, a callout, a spicy question. NEVER a slow "today we'll learn about…" open.
- Talk TO the viewer directly. Use ONE super-relatable everyday moment to set it up, then hit them with the psychology behind it — with a curiosity gap so they stay ("and the reason why is kinda scary…").
- Be ACCURATE to real psychology / behavioural science. Use the researched facts; name the real effect or experiment if there is one. Relatable scenarios are fine, but NEVER fabricate studies or fake statistics.
- End on a punchy insight or question that makes them think (and comment/share).
${
  langName === "Hindi"
    ? `- Write EVERYTHING (narration + on-screen text) in ROMANIZED Hindi — Latin script, natural Hinglish, the way top Hindi YouTubers caption (e.g. "Kya aap jaante hain ki aapka dimaag aapko dhoka deta hai?"). Gen-Z reads Roman Hindi far more easily than Devanagari. Keep everyday English words as-is (AI, stress, brain, mind). Use NO Devanagari.`
    : `- ZERO English/Latin letters anywhere. Write EVERYTHING in ${langName} script — transliterate modern/slang/English words and every name, brand, technical term and acronym into ${langName} (e.g. DNA -> ${dna}, AI -> ${ai}). Not one Latin character in the narration or on-screen text.`
}
- No markdown, no emojis in the narration.`;
}

/**
 * Gemini writes a full narrated video script + meta in `langName`, in the given
 * author persona. kind "true-story" = a real event; kind "concept" = a
 * psychological truth revealed as a story. Returns { script, meta }.
 */
export async function geminiNarrative({ persona, kind, langName, facts, category, channelName, voice, short = false }) {
  const beats = short ? "4-6" : "7-11";
  const midBeats = short ? "2-4" : "5-9";
  const words = short ? "90-120" : "320-480";
  const isConcept = kind === "concept";
  const opener = isConcept
    ? `Reveal this psychological truth like a VIRAL creator — open with a scroll-stopping hook, then keep it chill, engaging and conversational, entirely in ${langName}. It must be ACCURATE psychology; you may use ONE relatable everyday scenario, but NEVER fabricate studies or statistics.`
    : `Tell this TRUE story like a VIRAL story-YouTuber — open with a hook that stops the scroll, then keep it gripping, chill and conversational, entirely in ${langName}. It must be a REAL event that actually happened; use ONLY the facts below (add atmosphere, not fake events).`;
  const factsLabel = isConcept ? "RESEARCH (real psychology facts/studies to ground it)" : "RESEARCH (sources & facts)";
  // Language/region discovery tags so the video reaches the right audience.
  const reach =
    langName === "Kannada"
      ? {
          hashtags: "#kannada #kannadastories #karnataka #kannadakathegalu #kannadayoutuber",
          tags: '"kannada","kannada stories","kannada kathegalu","karnataka","kannada channel","kannada youtube","ಕನ್ನಡ","ಕನ್ನಡ ಕಥೆಗಳು"',
        }
      : langName === "Hindi"
        ? {
            hashtags: "#hindi #hindikahani #hindistories #psychologyfacts #india",
            tags: '"hindi","hindi kahani","hindi stories","hindi facts","psychology in hindi","manovigyan","india","हिंदी"',
          }
        : { hashtags: "", tags: "" };
  // Hindi Gen-Z reads Roman Hindi far more easily than Devanagari → write Hindi in
  // Latin (natural Hinglish); Cartesia's Riya voice pronounces it correctly. Kannada
  // (and anything else) stays in its native script.
  const roman = langName === "Hindi";
  const disp = roman ? "Romanized Hindi (Latin script, natural Hinglish)" : langName + " script";
  const user =
    `Make a ${short ? "~40 second vertical Short" : "2-3 minute"} narrated video.\n` +
    `${opener}\n` +
    `VIBE: hook them in the very first line; keep beats punchy with curiosity gaps between them; end on a line that makes them comment or share. Chill, engaging, modern creator energy — never a dry lecture.\n` +
    `Category: ${category.topicTag}. ${category.guidance}\n` +
    `Prefer angles that resonate with an Indian audience.\n\n` +
    `${factsLabel}:\n${String(facts).slice(0, 12000)}\n\n` +
    `Return ONE JSON object: { "script": {...}, "meta": {...} }.\n\n` +
    `"script" = {\n` +
    `  "channelName":"${channelName}", "topicTag":"${category.topicTag}", "accent":"${category.accent}",\n` +
    `  "source":"<the real sources, comma-separated>", "voice":"${voice}", "music":"", "showCaptions":${short},\n` +
    `  "scenes":[ ${beats} scenes ]\n}\n` +
    `EVERY scene MUST have a "vo" = the spoken narration for that beat, written in ${disp}. Scene types:\n` +
    `- {"type":"hook","kicker":"${category.topicTag}","headline":"<a scroll-stopping 3-6 word hook in ${disp}>","sub":"<a one-line teaser (in ${disp}) that opens a curiosity gap>","keywords":["english stock-footage term"]}\n` +
    `- {"type":"point","heading":"<short evocative line in ${disp}, 2-6 words>","bullets":[],"keywords":["english stock-footage term"]}  // a beat; bullets EMPTY, the vo carries it\n` +
    `- {"type":"quote","quote":"<a striking line, in ${disp}>","attribution":"<who / context>"}  // use once at the peak\n` +
    `- {"type":"outro","headline":"<closing line in ${disp}>","cta":"<a short subscribe line in ${disp} naming ${channelName}>","keywords":["english stock-footage term"]}\n\n` +
    `RULES:\n` +
    `- Start with "hook", end with "outro"; ${midBeats} "point" beats in between that unfold IN ORDER; optionally one "quote" at the peak.\n` +
    `- The HOOK scene MUST have its own spoken "vo" (the punchy opening hook line, spoken aloud) — NEVER leave the hook silent; it is the single most important line of narration.\n` +
    `- Each "vo" is 1-4 natural spoken ${langName} sentences, written in ${disp}. TOTAL narration ~${words} words.\n` +
    `- "keywords" are ENGLISH stock-footage search terms matching the mood (e.g. "lonely person window","busy city crowd","brain neurons","old letters"). 2-3 words each.\n` +
    `- On-screen text (headline/heading/sub/quote) is short and punchy, in ${disp}.\n` +
    (roman
      ? `- CRITICAL: write BOTH the spoken "vo" AND all on-screen text in ROMANIZED Hindi — Latin script, natural Hinglish, e.g. "Kya aap jaante hain ki aapka dimaag aapko har roz dhoka deta hai?". This is what the Gen-Z audience reads easily and how top Hindi creators caption. Keep everyday English words as-is (AI, stress, brain, mind). Use NO Devanagari anywhere.\n`
      : `- CRITICAL: every "vo" and every on-screen field must be 100% ${langName} script with ZERO Latin/English letters. Transliterate ALL names, places, brands, numbers-as-words and abbreviations/acronyms (DNA, USA, AI, CEO, GPS…) into ${langName}. The TTS voice mispronounces Latin text, so a single Latin character is a failure. (Only "keywords" and the JSON keys stay English.)\n`) +
    (roman
      ? `- "cta" is a short Roman-Hindi subscribe line naming ${channelName} (e.g. "${channelName} ko subscribe karo").\n\n`
      : `- "cta" must be written in ${langName} too (e.g. "${channelName} ${langName === "Kannada" ? "ಚಾನೆಲ್ ಅನ್ನು ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ" : "को सब्सक्राइब करें"}"), since it is shown on screen.\n\n`) +
    (roman ? `` : `- METADATA (title/description/tags) is NOT narration — the description's hashtag line and the tags array SHOULD use Latin/English for discovery; the no-Latin rule above applies ONLY to the spoken "vo" and on-screen scene text.\n`) +
    `- For reach, the description MUST end with a hashtag line STARTING with these exact tags: ${reach.hashtags} — then add 3-5 topic-specific hashtags. And "tags" MUST include these reach tags: ${reach.tags} — plus 8-12 specific topic tags.\n\n` +
    `"meta" = { "title":"<a clickable, VIRAL-style title in ${disp} — curiosity, a bold claim, or a number that makes people click>", "description":"<2-3 sentences in ${disp}, then a final line of hashtags beginning with ${reach.hashtags} + topic hashtags>", "tags":[the reach tags above + 8-12 specific topic tags], "thumbnail":{"badge":"${category.topicTag}","bigText":"<3-5 punchy words in ${disp}>","subText":"<short, in ${disp}>","accent":"${category.accent}","channelName":"${channelName}"} }`;

  // Literary/dramatic prose occasionally breaks JSON escaping (an unescaped quote
  // in a dramatic line) — one bad sample used to fail the whole channel for the
  // day. Resample instead of dying on the first malformed response.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = extractJson(await generate(user, { temperature: 0.92, system: persona, maxOutputTokens: 8192 }));
      return { script: out.script || out, meta: out.meta || {} };
    } catch (e) {
      lastErr = e;
      console.warn(`   narrative attempt ${attempt} failed (${e.message}) — retrying`);
    }
  }
  throw lastErr;
}

/**
 * JOB factor — Gemini writes a Kannada job-notification "slide deck" script
 * (introCard → table → facts slides → outro) for the Jobs composition, plus meta.
 * HIGH-STAKES accuracy: viewers may act on this (deadlines, fees) — every value
 * must come from the researched notification; unknown fields are OMITTED, never
 * guessed. Returns { script, meta }.
 */
export async function geminiJobs({ facts, category, channelName, sourceUrl = "", todayStr = "", covered = [] }) {
  const system =
    `You are the CREATOR of "${channelName}", a Kannada YouTube channel reporting job notifications and exam information for Karnataka job seekers. You speak in FIRST PERSON as the channel's host, in his exact narration style (transcribed from his real videos):\n\n` +
    `SIGNATURE STYLE — match this voice precisely:\n` +
    `- Intro = greeting + HOOK, nothing else: "ಎಲ್ಲರಿಗೂ ನಮಸ್ಕಾರ ಸ್ನೇಹಿತರೆ" then go STRAIGHT into what this video covers — the notification and its single most attractive fact (posts count / salary / no-exam / last date). NO subscribe ask, NO bell icon, NO "watch fully" line in the intro; those belong ONLY in the outro.\n` +
    `- Address the audience as "ಫ್ರೆಂಡ್ಸ್" SPARINGLY — only 2-3 times in the WHOLE video (in the greeting, maybe once in the middle, and in the sign-off). NEVER tack it onto the end of every sentence; most sentences have no "ಫ್ರೆಂಡ್ಸ್" at all, and when used, vary its position naturally.\n` +
    `- Sections flow NATURALLY into each other like normal speech — vary the transitions (or use none at all; the slide heading already announces the section). "...ನೋಡಿಕೊಂಡುಬಿಡೋಣ" may appear ONCE in the whole video at most — NEVER as a formula on every section.\n` +
    `- Spoken-Kannada connectors: "ಈ ಒಂದು ಹುದ್ದೆಗೆ...", and unpack facts with "ಅಂದ್ರೆ..." (e.g. "ಅಂದ್ರೆ 10ನೇ ತರಗತಿ ಪಾಸ್ ಆದವರು ಕೂಡ ಈ ಒಂದು ಹುದ್ದೆಗೆ ಅರ್ಜಿಯನ್ನು ಸಲ್ಲಿಸಬಹುದು").\n` +
    `- Reassure who can apply: "ಕರ್ನಾಟಕದ ಯಾವುದೇ ಜಿಲ್ಲೆಯವರು ಕೂಡ ಅರ್ಜಿಯನ್ನು ಸಲ್ಲಿಸಬಹುದು" (when true per the notification).\n` +
    `- English terms are spoken as Kannada-script transliterations, exactly as he does: ಅಫೀಷಿಯಲ್ ವೆಬ್‌ಸೈಟ್, ಆನ್‌ಲೈನ್, ಡಿಸ್ಕ್ರಿಪ್ಷನ್, ಪಿಡಿಎಫ್, ಲಿಂಕ್, ಅಪ್ಲಿಕೇಶನ್, ರಿಟನ್ ಟೆಸ್ಟ್, ಫಿಸಿಕಲ್ ಟೆಸ್ಟ್, ಮೆಡಿಕಲ್ ಟೆಸ್ಟ್, ಏಜ್ ರಿಲ್ಯಾಕ್ಸೇಶನ್.\n` +
    `- First person about the channel's help: "ಆ ಲಿಂಕ್ ಅನ್ನ ನಾನು ಡಿಸ್ಕ್ರಿಪ್ಷನ್ ನಲ್ಲಿ ಕೊಟ್ಟಿರುತ್ತೀನಿ", "ಹೆಚ್ಚಿನ ವಿವರಗಳನ್ನ ಅಫೀಷಿಯಲ್ ವೆಬ್‌ಸೈಟ್ ನ ಪಿಡಿಎಫ್ ನಲ್ಲಿ ನೋಡಿಕೋಬಹುದು."\n` +
    `- Sign-off: "ವಿಡಿಯೋವನ್ನ ಪೂರ್ತಿಯಾಗಿ ನೋಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು ಫ್ರೆಂಡ್ಸ್" + subscribe/bell reminder + "ಥ್ಯಾಂಕ್ ಯು."\n\n` +
    `The tone is a warm, trustworthy neighbourhood announcer — helpful and direct, never hype, never storytelling. Viewers make real decisions (deadlines, fees) based on you, so accuracy is everything. Output ONLY JSON.`;
  const user =
    `Make a narrated Kannada video reporting THIS job/exam information. Category: ${category.topicTag} — ${category.guidance}\n` +
    `${todayStr ? `TODAY'S DATE IS ${todayStr}.\n` : ""}\n` +
    `RESEARCHED NOTIFICATION (the ONLY source of truth):\n${String(facts).slice(0, 12000)}\n\n` +
    `⚠️ REJECT FIRST — before writing anything, check the research against these FOUR gates. If ANY gate fails, return ONLY: { "reject": true, "reason": "<why>" } — do NOT write a script for it:\n` +
    `1. RELEVANCE: this must be a Karnataka state government notification, a central-government notification open to Karnataka applicants, or a well-known all-India exam — NOT another state's exclusive state-service exam (e.g. UPPSC/Uttar Pradesh, MPPSC/Madhya Pradesh, WBPSC/West Bengal are all OUT OF SCOPE for this channel).\n` +
    `2. STILL OPEN: ${todayStr ? `the application/exam window must be confirmed open on or after ${todayStr}` : "the application/exam window must be confirmed currently open"} — if the research shows it already closed, REJECT. This includes ADMIT CARD / HALL TICKET notifications: an admit card being "released" does NOT by itself prove the exam is still upcoming — old "admit card out" pages stay indexed and get surfaced by search long after the exam was actually held. Before accepting one, the research must state the ACTUAL EXAM DATE (or a still-pending next stage like result/interview date), and that date must be on or after ${todayStr || "today"}. If the research never states a concrete date, or states one that has clearly already passed, REJECT — do not assume something is current just because it appeared in search results. Whenever genuinely uncertain whether it's still open, REJECT rather than risk publishing stale info (a "channel reporting a closed opportunity" has no value — don't publish it as news either, just reject and let the caller pick something else).\n` +
    `3. SPECIFIC & REAL: the research must describe ONE concrete, identifiable notification (not a vague roundup of "9000+ jobs" or a mismatched blend of multiple different notifications) — if the research is confused, contradictory, or clearly about a DIFFERENT notification than what was asked for, REJECT rather than guessing or blending.\n` +
    `4. DUPLICATE: this channel already covered these notifications recently (NEVER repeat one, and treat a different post-category/sub-post from the SAME parent recruitment drive/department as covered too, even if worded slightly differently — e.g. "...233 Group-C Posts" vs "...233 Posts" is the SAME notification):\n${covered.length ? covered.join("\n") : "(none)"}\nIf the research describes a notification that is the same as, or a sub-post/reworded version of, anything in that list, REJECT — this check has caught real repeats before, so treat it as seriously as the other gates.\n\n` +
    `Only if ALL four gates pass, return ONE JSON object: { "script": {...}, "meta": {...} }.\n\n` +
    `"script" = { "channelName":"${channelName}", "topicTag":"${category.onScreenTag}", "accent":"#D9A514", "source":"<the real source(s)>", "music":"", "showCaptions":false, "scenes":[...] }\n\n` +
    `Scene types (EVERY scene needs "vo" = the spoken Kannada narration for that slide):\n` +
    `- {"type":"introCard","title":"<Kannada headline of the opportunity>","highlights":[{"label":"<ಸಂಬಳ/ಸ್ಥಳ/ಹುದ್ದೆಗಳು/ಕೊನೆಯ ದಿನಾಂಕ...>","value":"<short value>"} x3-4]}  — open the video; highlights are the 3-4 MOST decision-relevant facts\n` +
    `- {"type":"table","heading":"<Kannada heading>","columns":["<col1>","<col2>"],"rows":[{"cells":["<name>","<count>"],"bold":false},...,{"cells":["ಒಟ್ಟು","<total>"],"bold":true}]}  — use for post-wise vacancies (or fee by category / important dates as label→value rows)\n` +
    `- {"type":"facts","heading":"<Kannada heading>","bullets":["<fact with the key value wrapped in **double asterisks**>", ...]}  — eligibility, dates, fee, selection process, how to apply\n` +
    `- {"type":"outro","headline":"<short Kannada closing>","cta":"${channelName} ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ","disclaimer":"ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಅಧಿಕೃತ ವೆಬ್‌ಸೈಟ್‌ನಲ್ಲಿ ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ"}\n\n` +
    `STRUCTURE: introCard first, outro last. In between: a "table" for post-wise vacancies when there are 2+ posts, then "facts" slides IN THIS ORDER when the data exists — ವಿದ್ಯಾರ್ಹತೆ (eligibility incl. age limit), ಪ್ರಮುಖ ದಿನಾಂಕಗಳು (dates), ಅರ್ಜಿ ಶುಲ್ಕ (fee), ಆಯ್ಕೆ ಪ್ರಕ್ರಿಯೆ (selection), ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ವಿಧಾನ (how to apply). 5 to 8 scenes total.\n\n` +
    `ACCURACY (non-negotiable — this is job information people act on):\n` +
    `- EVERY number, date, fee, post name and count MUST come from the researched notification above. NEVER estimate, infer, or fill a gap with a typical value.\n` +
    `- If a field (e.g. fee, age limit) is NOT in the research, OMIT that slide/bullet entirely — do not guess, do not write "ಸುಮಾರು" values.\n` +
    `- If the research is ambiguous about a critical value, say plainly in the vo that viewers should confirm it on the official website.\n\n` +
    `LANGUAGE:\n` +
    `- "vo" is SPOKEN Kannada: natural announcer style, 1-3 sentences per slide, ~200-320 words total. Write numbers/dates in the vo as Kannada words or Kannada-script forms the TTS reads correctly (e.g. "ಇನ್ನೂರು ರೂಪಾಯಿ", "ಆಗಸ್ಟ್ ಹದಿನೈದು"). NO Latin letters in the vo — transliterate abbreviations (ಎಸ್‌ಸಿ, ಎಸ್‌ಟಿ, ಕೆಪಿಎಸ್‌ಸಿ).\n` +
    `- Speaking the official website in the vo is fine, but write it FULLY in Kannada script with "ಡಾಟ್" for every "." (e.g. kea.kar.nic.in → "ಕೆಇಎ ಡಾಟ್ ಕರ್ ಡಾಟ್ ಎನ್‌ಐಸಿ ಡಾಟ್ ಇನ್") — NEVER Latin letters, NEVER "ಚುಕ್ಕೆ" for the dot. The raw URL itself goes in on-screen bullets and the description, and add "ಆ ಲಿಂಕ್ ಅನ್ನ ನಾನು ಡಿಸ್ಕ್ರಿಪ್ಷನ್ ನಲ್ಲಿ ಕೊಟ್ಟಿರುತ್ತೀನಿ".\n` +
    `- ON-SCREEN text (title/headings/highlights/cells/bullets) is Kannada, but KEEP standard digits (33, ₹200, 18-35) and essential short English terms job seekers expect (10th, 12th, SC/ST, Exam, Online) — exactly how Karnataka job channels write slides.\n` +
    `- The intro vo = short greeting ("ಎಲ್ಲರಿಗೂ ನಮಸ್ಕಾರ ಸ್ನೇಹಿತರೆ") + straight into the HOOK: which notification this is and its single most attractive fact. NO subscribe/bell ask in the intro. The outro vo = the SIGNATURE SIGN-OFF (thanks for watching + subscribe/bell + ಥ್ಯಾಂಕ್ ಯು) AND reminds viewers to verify on the official website before applying.\n\n` +
    `"meta" = { "title":"<SEARCHABLE English/Roman title with year + post count, e.g. 'Dharwad District Court Recruitment 2026 - 33 Peon & Typist Posts'>", "description":"<2-3 Kannada sentences summarising the notification, then${sourceUrl ? ` the official link: ${sourceUrl},` : " the official website name,"} then the line 'ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಅಧಿಕೃತ ವೆಬ್‌ಸೈಟ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.', then a hashtag line starting with EXACTLY these (the channel's signature set): #kannada #karnataka #karnatakajobs #kannadajobs #10thpassjob #sarkarinaukri — plus 3-4 notification-specific hashtags (e.g. #kpsc #policejobs)>", "tags":["karnataka jobs","kannada jobs","govt jobs karnataka","ಸರ್ಕಾರಿ ಉದ್ಯೋಗ","ಉದ್ಯೋಗ ಮಾಹಿತಿ", plus 8-10 SPECIFIC tags for this posting], "thumbnail":{"badge":"${category.onScreenTag}","bigText":"<3-5 punchy Kannada words — the most attractive fact>","subText":"<short: salary or last date>","accent":"#D9A514","channelName":"${channelName}"} }`;

  // One malformed sample used to fail the whole channel for the day — resample.
  let lastErr;
  let draft;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = extractJson(await generate(user, { temperature: 0.4, system, maxOutputTokens: 8192 }));
      if (out?.reject) return { reject: true, reason: out.reason || "rejected by writer" };
      draft = { script: out.script || out, meta: out.meta || {} };
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`   jobs-writer attempt ${attempt} failed (${e.message}) — retrying`);
    }
  }
  if (!draft) throw lastErr;
  if (!draft.script?.scenes?.length) return { reject: true, reason: "writer returned no usable scenes" };

  // FACT-CHECK PASS — high-stakes content (viewers act on dates/fees/vacancies),
  // so verify the draft against the research rather than trusting one-shot
  // generation. Catches exactly the "fee deadline before apply deadline" class
  // of error: facts blended/confused across multiple source pages.
  try {
    const verifyUser =
      `You are a strict fact-checker for a job-notification video. Compare the DRAFT below against the RESEARCH (the only source of truth).\n\n` +
      `RESEARCH:\n${String(facts).slice(0, 10000)}\n\n` +
      `DRAFT (JSON — script.scenes[].vo carries the spoken facts; meta has the title/description):\n${JSON.stringify(draft)}\n\n` +
      `Check EVERY number, date and fee mentioned. Rules:\n` +
      `- If a value is NOT stated in the research, or contradicts it, FIX it using the research, or if the research doesn't clearly support any value, REMOVE that specific claim (delete the bullet/sentence, don't guess).\n` +
      `- Check internal consistency too — e.g. a fee-payment deadline before the application deadline is almost always wrong unless the research explicitly confirms it; if inconsistent and the research doesn't clearly resolve it, remove the less-certain one rather than leave a contradiction.\n` +
      `- Keep everything else (style, phrasing, structure) EXACTLY as in the draft — this is a fact-correction pass only, not a rewrite.\n` +
      `- If the draft is already fully accurate, return it unchanged.\n\n` +
      `Return ONE JSON object with the SAME shape as the draft: { "script": {...}, "meta": {...} }`;
    const checked = extractJson(await generate(verifyUser, { temperature: 0.1, maxOutputTokens: 8192 }));
    if (checked?.script?.scenes?.length >= 3) return { script: checked.script, meta: checked.meta || draft.meta };
  } catch (e) {
    console.warn(`   jobs fact-check failed (${e.message}) — keeping unverified draft`);
  }
  return draft;
}

/**
 * JOB factor — evergreen "how to get this job" roadmap guide, used as the
 * fallback when no live, currently-open notification could be found for the
 * day. Same slide-deck shape as geminiJobs, but framed as preparation
 * guidance (eligibility, when notifications typically come out, exam
 * pattern, syllabus, resources) instead of an "apply now" report — grounded
 * in the research, never fabricated, with no urgency/deadline framing since
 * there is no live notification behind it.
 */
export async function geminiJobsRoadmap({ facts, target, channelName, todayStr = "" }) {
  const system =
    `You are the CREATOR of "${channelName}", a Kannada YouTube channel helping Karnataka job seekers. Today there is no fresh notification to report, so instead you're making a PREPARATION ROADMAP video: how to get into "${target.title}". You speak in FIRST PERSON, in the SAME warm, direct, trustworthy-announcer voice as the channel's regular notification videos:\n` +
    `- Intro = greeting ("ಎಲ್ಲರಿಗೂ ನಮಸ್ಕಾರ ಸ್ನೇಹಿತರೆ") then straight into the hook: which job/exam this roadmap is for and why it's worth preparing for now.\n` +
    `- Address the audience as "ಫ್ರೆಂಡ್ಸ್" sparingly, natural spoken-Kannada connectors ("ಅಂದ್ರೆ...", "ಈ ಒಂದು ಹುದ್ದೆಗೆ..."), English terms transliterated to Kannada script.\n` +
    `- This is GUIDANCE, not a live notification — never say "last date is..." or "apply now"; instead say things like "ಸಾಮಾನ್ಯವಾಗಿ ಈ ಅಧಿಸೂಚನೆ <month/season> ನಲ್ಲಿ ಬರುತ್ತೆ" (notifications typically come out around X) and repeatedly steer viewers to verify the CURRENT notification on the official website.\n` +
    `Output ONLY JSON.`;
  const user =
    `Make a narrated Kannada "preparation roadmap" video for: ${target.title}\n` +
    `${todayStr ? `TODAY'S DATE IS ${todayStr}.\n` : ""}\n` +
    `RESEARCH (the ONLY source of truth for facts):\n${String(facts).slice(0, 12000)}\n\n` +
    `⚠️ REJECT FIRST: if the research is too thin/vague to describe REAL eligibility criteria, exam pattern or syllabus for this specific job (e.g. only generic listicle noise, nothing concrete), return ONLY { "reject": true, "reason": "<why>" } rather than inventing details.\n\n` +
    `Only if there's enough real material, return ONE JSON object: { "script": {...}, "meta": {...} }.\n\n` +
    `"script" = { "channelName":"${channelName}", "topicTag":"ಹುದ್ದೆ ಮಾರ್ಗದರ್ಶಿ", "accent":"#D9A514", "source":"<the real source(s)>", "music":"", "showCaptions":false, "scenes":[...] }\n\n` +
    `Scene types (EVERY scene needs "vo" = spoken Kannada narration):\n` +
    `- {"type":"introCard","title":"<Kannada headline, e.g. 'KPSC KAS ಹುದ್ದೆಗೆ ಹೇಗೆ ತಯಾರಿ ಮಾಡುವುದು?'>","highlights":[{"label":"<ಇಲಾಖೆ/ಸಂಬಳ/ಶಿಕ್ಷಣ ಅರ್ಹತೆ/ಅಧಿಸೂಚನೆ ಸಮಯ...>","value":"<short value>"} x3-4]}\n` +
    `- {"type":"facts","heading":"<Kannada heading>","bullets":["<fact, key value in **double asterisks**>", ...]}  — use several of these, IN THIS ORDER when the research supports it: ವಿದ್ಯಾರ್ಹತೆ (eligibility, age limit), ಅಧಿಸೂಚನೆ ಯಾವಾಗ ಬರುತ್ತೆ (typical notification month/season, based on past years — phrase as "ಸಾಮಾನ್ಯವಾಗಿ", never a fixed claimed date), ಪರೀಕ್ಷಾ ಮಾದರಿ (exam pattern/stages), ಸಿಲಬಸ್ ಮುಖ್ಯಾಂಶಗಳು (syllabus highlights), ತಯಾರಿ ಸಂಪನ್ಮೂಲಗಳು (preparation resources — official study material, previous papers, trusted sources)\n` +
    `- {"type":"table","heading":"<Kannada heading>","columns":["<col1>","<col2>"],"rows":[{"cells":["<stage/subject>","<detail>"],"bold":false},...]}  — OPTIONAL, use for exam-stage breakdown or subject-wise syllabus if it fits a table better than bullets\n` +
    `- {"type":"outro","headline":"<short Kannada closing>","cta":"${channelName} ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ","disclaimer":"ಪ್ರಸ್ತುತ ಅಧಿಸೂಚನೆಗಾಗಿ ಅಧಿಕೃತ ವೆಬ್‌ಸೈಟ್ ಅನ್ನು ನಿಯಮಿತವಾಗಿ ಪರಿಶೀಲಿಸಿ"}\n\n` +
    `STRUCTURE: introCard first, outro last, 4-7 "facts"/"table" scenes between covering as many of the topics above as the research actually supports. 5 to 8 scenes total, ~200-320 words of vo total.\n\n` +
    `ACCURACY (non-negotiable):\n` +
    `- Every eligibility/pattern/syllabus/resource claim MUST come from the research. NEVER invent a specific date, fee or vacancy count — this is a roadmap about a job CATEGORY, not a report on one live notification.\n` +
    `- If the research mentions a specific past notification's dates, use it only as an illustrative "ಕಳೆದ ಬಾರಿ..." (last time) reference if useful, never phrase it as if it's the current opening.\n` +
    `- Explicitly tell viewers (at least once, naturally, e.g. in the outro or a closing bullet) to check the official website for the CURRENT notification, since this video is general preparation guidance, not a live alert.\n\n` +
    `LANGUAGE: same rules as the channel's regular videos — "vo" is natural spoken Kannada with transliterated English terms, no Latin letters in vo; on-screen text can keep standard digits/short English terms (10th, 12th, SC/ST, Exam, Online).\n\n` +
    `"meta" = { "title":"<SEARCHABLE English/Roman title, e.g. 'KPSC KAS Recruitment 2026 — Eligibility, Exam Pattern & Syllabus Roadmap'>", "description":"<2-3 Kannada sentences summarising what this roadmap covers, then the line 'ಪ್ರಸ್ತುತ ಅಧಿಸೂಚನೆಗಾಗಿ ಅಧಿಕೃತ ವೆಬ್‌ಸೈಟ್ ಪರಿಶೀಲಿಸಿ.', then a hashtag line starting with EXACTLY: #kannada #karnataka #karnatakajobs #kannadajobs #10thpassjob #sarkarinaukri — plus 3-4 topic-specific hashtags>", "tags":["karnataka jobs","kannada jobs","govt jobs karnataka","ಸರ್ಕಾರಿ ಉದ್ಯೋಗ","ಉದ್ಯೋಗ ಮಾಹಿತಿ", plus 8-10 SPECIFIC tags for this job/exam], "thumbnail":{"badge":"ಹುದ್ದೆ ಮಾರ್ಗದರ್ಶಿ","bigText":"<3-5 punchy Kannada words>","subText":"<short: e.g. 'ಪೂರ್ತಿ ಮಾರ್ಗದರ್ಶಿ'>","accent":"#D9A514","channelName":"${channelName}"} }`;

  let lastErr;
  let draft;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = extractJson(await generate(user, { temperature: 0.45, system, maxOutputTokens: 8192 }));
      if (out?.reject) return { reject: true, reason: out.reason || "rejected by writer" };
      draft = { script: out.script || out, meta: out.meta || {} };
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`   jobs-roadmap-writer attempt ${attempt} failed (${e.message}) — retrying`);
    }
  }
  if (!draft) throw lastErr;
  if (!draft.script?.scenes?.length) return { reject: true, reason: "writer returned no usable scenes" };
  return draft;
}

/**
 * SCHEME factor — Gemini writes a Kannada "government scheme explainer" slide
 * deck (introCard → facts/table → outro): eligibility, benefit, documents,
 * how to apply, for a state or central welfare scheme. HIGH-STAKES like
 * geminiJobs (viewers make real financial/application decisions), with an
 * EXTRA gate government scheme content specifically needs: confirming the
 * scheme is still ACTIVE — schemes get renamed, merged or discontinued after
 * policy/government changes, and old scheme pages stay indexed regardless.
 * Returns { script, meta } or { reject, reason }.
 */
export async function geminiSchemes({ facts, target, channelName, todayStr = "" }) {
  const system =
    `You are the CREATOR of "${channelName}", a Kannada YouTube channel explaining government welfare schemes to ordinary Karnataka citizens — eligibility, benefits, and how to apply. You speak in FIRST PERSON, warm and trustworthy, like a helpful neighbourhood government-office clerk who wants people to actually get what they're entitled to:\n` +
    `- Intro = greeting ("ಎಲ್ಲರಿಗೂ ನಮಸ್ಕಾರ") then straight into the hook: which scheme this is and its single most attractive benefit (amount / free service / who qualifies).\n` +
    `- Natural spoken Kannada, English terms transliterated to Kannada script (ಸ್ಕೀಮ್, ಆನ್‌ಲೈನ್, ಅಪ್ಲಿಕೇಶನ್, ಡಾಕ್ಯುಮೆಂಟ್, ಪೋರ್ಟಲ್, ಆಧಾರ್, ಬ್ಯಾಂಕ್ ಅಕೌಂಟ್).\n` +
    `- Never hype, never exaggerate the benefit — viewers make real decisions off this. Output ONLY JSON.`;
  const user =
    `Make a narrated Kannada "government scheme explainer" video for: ${target.title}\n` +
    `${todayStr ? `TODAY'S DATE IS ${todayStr}.\n` : ""}\n` +
    `RESEARCH (the ONLY source of truth):\n${String(facts).slice(0, 12000)}\n\n` +
    `⚠️ REJECT FIRST — check against these gates. If ANY fails, return ONLY { "reject": true, "reason": "<why>" }:\n` +
    `1. STILL ACTIVE: the research must confirm this scheme is CURRENTLY active/running, not discontinued, renamed, merged into another scheme, or superseded — government schemes DO get scrapped or replaced after policy changes, and old pages about them stay indexed forever. If the research is ambiguous about current status, or suggests it may have been discontinued/replaced, REJECT rather than risk publishing outdated scheme info.\n` +
    `2. SPECIFIC & REAL: the research must describe ONE concrete, identifiable scheme with real eligibility/benefit details — not a vague listicle blending multiple schemes together. If confused or contradictory, REJECT rather than guess.\n` +
    `3. ENOUGH SUBSTANCE: if the research is too thin to state real eligibility criteria and benefit details, REJECT rather than invent them.\n\n` +
    `Only if all gates pass, return ONE JSON object: { "script": {...}, "meta": {...} }.\n\n` +
    `"script" = { "channelName":"${channelName}", "topicTag":"ಸರ್ಕಾರಿ ಯೋಜನೆ", "accent":"#2E8B57", "source":"<the real source(s)>", "music":"", "showCaptions":false, "scenes":[...] }\n\n` +
    `Scene types (EVERY scene needs "vo" = spoken Kannada narration):\n` +
    `- {"type":"introCard","title":"<Kannada headline naming the scheme>","highlights":[{"label":"<ಲಾಭ/ಫಲಾನುಭವಿ/ಇಲಾಖೆ/ಸ್ಥಿತಿ...>","value":"<short value>"} x3-4]}\n` +
    `- {"type":"facts","heading":"<Kannada heading>","bullets":["<fact, key value in **double asterisks**>", ...]}  — use several, IN THIS ORDER when the research supports it: ಅರ್ಹತೆ (eligibility criteria), ಸೌಲಭ್ಯ/ಲಾಭ (benefit amount or service), ಅಗತ್ಯ ದಾಖಲೆಗಳು (required documents), ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ವಿಧಾನ (how to apply — portal name/URL, offline option if any)\n` +
    `- {"type":"table","heading":"<Kannada heading>","columns":["<col1>","<col2>"],"rows":[{"cells":["<item>","<detail>"],"bold":false},...]}  — OPTIONAL, use if benefit tiers/categories fit a table better than bullets\n` +
    `- {"type":"outro","headline":"<short Kannada closing>","cta":"${channelName} ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ","disclaimer":"ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಅಧಿಕೃತ ಪೋರ್ಟಲ್‌ನಲ್ಲಿ ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ"}\n\n` +
    `STRUCTURE: introCard first, outro last, 3-6 "facts"/"table" scenes between. 5 to 8 scenes total, ~200-320 words of vo.\n\n` +
    `ACCURACY (non-negotiable — this is a channel viewers may apply for benefits based on):\n` +
    `- EVERY eligibility rule, benefit amount and document requirement MUST come from the research. NEVER estimate or fill a gap with a typical/plausible value.\n` +
    `- If a field is NOT in the research, OMIT that slide/bullet entirely.\n` +
    `- CONFLICTING SOURCES: low-quality SEO "scheme info" blogs are a known source of stale/wrong numbers for this content type. If sources in the research disagree on a figure (benefit amount, eligibility cutoff, document list), prefer whichever source is the scheme's OFFICIAL government portal (a .gov.in / .kar.nic.in / karnataka.gov.in / sevasindhu domain, or explicitly named as the official site) over any blog or news aggregator. If you can't tell which source is official, or the official source itself is missing/unclear on that figure, OMIT the figure rather than pick either conflicting value.\n` +
    `- Always tell viewers (in the outro, naturally) to confirm current details on the official portal before applying — scheme rules/amounts can be revised.\n\n` +
    `LANGUAGE: "vo" is natural spoken Kannada, no Latin letters, numbers/dates as Kannada words or TTS-safe Kannada-script forms. On-screen text keeps standard digits and short English terms (Aadhaar, Online, BPL) as Karnataka govt-info channels do.\n\n` +
    `"meta" = { "title":"<SEARCHABLE English/Roman title, e.g. 'Gruha Lakshmi Scheme 2026 — Eligibility, Benefits & How to Apply'>", "description":"<2-3 Kannada sentences summarising the scheme, then the line 'ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಅಧಿಕೃತ ಪೋರ್ಟಲ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.', then a hashtag line starting with EXACTLY: #kannada #karnataka #karnatakascheme #kannadascheme #sarkariyojane — plus 3-4 scheme-specific hashtags>", "tags":["karnataka scheme","government scheme","ಸರ್ಕಾರಿ ಯೋಜನೆ","ಕನ್ನಡ", plus 8-10 SPECIFIC tags for this scheme], "thumbnail":{"badge":"ಸರ್ಕಾರಿ ಯೋಜನೆ","bigText":"<3-5 punchy Kannada words>","subText":"<short: e.g. benefit amount>","accent":"#2E8B57","channelName":"${channelName}"} }`;

  let lastErr;
  let draft;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = extractJson(await generate(user, { temperature: 0.4, system, maxOutputTokens: 8192 }));
      if (out?.reject) return { reject: true, reason: out.reason || "rejected by writer" };
      draft = { script: out.script || out, meta: out.meta || {} };
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`   schemes-writer attempt ${attempt} failed (${e.message}) — retrying`);
    }
  }
  if (!draft) throw lastErr;
  if (!draft.script?.scenes?.length) return { reject: true, reason: "writer returned no usable scenes" };

  // FACT-CHECK PASS — same rigor as geminiJobs: verify every number/eligibility
  // rule against the research rather than trust one-shot generation.
  try {
    const verifyUser =
      `You are a strict fact-checker for a government-scheme explainer video. Compare the DRAFT below against the RESEARCH (the only source of truth).\n\n` +
      `RESEARCH:\n${String(facts).slice(0, 10000)}\n\n` +
      `DRAFT (JSON — script.scenes[].vo carries the spoken facts; meta has the title/description):\n${JSON.stringify(draft)}\n\n` +
      `Check EVERY eligibility rule, benefit amount and document requirement. Rules:\n` +
      `- If a value is NOT stated in the research, or contradicts it, FIX it using the research, or if the research doesn't clearly support any value, REMOVE that specific claim.\n` +
      `- Keep everything else (style, phrasing, structure) EXACTLY as in the draft — this is a fact-correction pass only.\n` +
      `- If the draft is already fully accurate, return it unchanged.\n\n` +
      `Return ONE JSON object with the SAME shape as the draft: { "script": {...}, "meta": {...} }`;
    const checked = extractJson(await generate(verifyUser, { temperature: 0.1, maxOutputTokens: 8192 }));
    if (checked?.script?.scenes?.length >= 3) return { script: checked.script, meta: checked.meta || draft.meta };
  } catch (e) {
    console.warn(`   schemes fact-check failed (${e.message}) — keeping unverified draft`);
  }
  return draft;
}

// ---- SERIALIZED HINDI DRAMA (Pocket FM / KukuFM style) ----------------------
// Roman Hindi (Hinglish) micro-drama series: 6 parts, hard cliffhanger per part.
// The persona carries ORIGINAL reference excerpts (written for this channel, not
// copied from any platform) so the model matches the exact addictive style.

const DRAMA_STYLE_REFERENCE = `
REFERENCE EXCERPTS — this is the EXACT style, rhythm and quality bar (original samples; match the craft, never reuse these plots):

[HOOK — how a part opens]
"Shaadi ke mandap par, poore khandaan ke saamne, Aarav ko thappad maara gaya. 'Yeh waiter hai waiter! Iske paas toh khud ki gaadi tak nahi!' Poora hall hans pada. Aarav ne bas apni muthi bheench li... kyunki sirf woh jaanta tha — jis aadmi ka yeh log mazaak uda rahe hain, wahi is sheher ki sabse badi company ka maalik hai. Aur kal subah 9 baje... inhi logon ki kismat uske ek signature se badalne wali thi."

[SCENE — how tension is dramatized, not summarized]
"Meera ki saans ruk gayi. Conference room ka darwaza khula... aur andar aaya woh hi ladka jise usne kal raat bhikari samajh kar 100 rupaye diye the. Wahi phati jacket. Wahi purani chappal. Lekin aaj... poora board room khada ho gaya. 'Good morning, Sir,' CEO ne jhuk kar kaha. Meera ke haath se file gir gayi."

[DIALOGUE — short, cutting, filmy]
"'Tum? YEH company tumhari hai?' Meera ki aawaaz kaanp rahi thi.
Aarav muskuraya. 'Nahi. Yeh company... aur woh bank jisme tumhare papa kaam karte hain... dono meri hain.'
'Toh kal raat tumne mujhe bataya kyun nahi?'
'Kyunki kal raat,' Aarav uske paas aaya, 'pehli baar kisi ne mujhse mera naam nahi... mera haal poocha tha.'"

[CLIFFHANGER — how every part ENDS (no resolution, cut at the sharpest moment)]
"Meera ne darwaza khola... aur uske haath se phone chhoot gaya. Saamne wahi aadmi khada tha jise duniya chhe mahine pehle mar chuka maan chuki thi. 'Surprise,' usne muskura kar kaha. 'Ab khel shuru hota hai.'"
`;

export function dramaPersona() {
  return `You are the head writer of a wildly addictive Hindi micro-drama channel — the kind of serialized stories that top Pocket FM / KukuFM charts and vertical-drama apps. You write in ROMAN HINDI (Hinglish, Latin script) for narration by a young female voice.

Your craft rules (non-negotiable):
- SHOW, don't summarize. Never write "phir usne yeh kiya, phir woh hua" — dramatize every beat as a living scene with action, dialogue and reaction. Summary-style narration is a FAILURE.
- Dialogue is your weapon: short, cutting, filmy lines in quotes — the voice actor performs them. At least a third of each episode is dialogue.
- Emotion through concrete detail: a trembling hand, a dropped file, a held breath — not "woh bahut dukhi thi".
- A turn every 30-45 seconds: a reveal, a humiliation, a rescue, a betrayal, a flashback punch. Never let two flat minutes pass.
- The audience must ALWAYS know something a character doesn't (dramatic irony) — that's the addiction engine.
- Every part ends EXACTLY on the sharpest cliffhanger moment — mid-confrontation, mid-reveal, door opening. NEVER resolve it, never soften it with a closing summary line.
- Natural Hinglish: everyday English words stay English (CEO, office, contract, board meeting, phone). No Devanagari anywhere.
- Original characters and plots every series. Tropes are shared property; specific existing stories are not — never imitate a named show.
${DRAMA_STYLE_REFERENCE}
Output ONLY JSON.`;
}

/** Create a new series: concept, characters, and a part-by-part arc plan. */
export async function geminiDramaConcept({ trope, guidance, totalParts = 6, avoidTitles = [] }) {
  const user =
    `Create a NEW ${totalParts}-part serialized Hindi micro-drama for the trope: ${trope} — ${guidance}\n` +
    `${avoidTitles.length ? `Already made (do NOT resemble): ${avoidTitles.join("; ")}\n` : ""}` +
    `Design it like a chart-topping Pocket FM serial: a killer premise with a secret the AUDIENCE knows early, escalating humiliations/reversals, and a finale payoff worth 6 parts of waiting.\n\n` +
    `Return ONE JSON object:\n` +
    `{ "title":"<short, thumbnail-ready Roman-Hindi series title, e.g. 'Secret CEO Ki Dulhan'>",\n` +
    `  "slug":"<kebab-case-series-slug>",\n` +
    `  "logline":"<2 sentences: the hook of the whole series>",\n` +
    `  "characters":"<compact sheet: each main character - name, role, secret, want>",\n` +
    `  "arc":[ EXACTLY ${totalParts} strings — one per part: "Part N: the beats of that part, ending with its exact cliffhanger" ] }`;
  // Gemini 2.5 thinking tokens share this budget — keep generous headroom.
  // Creative dialogue occasionally breaks JSON escaping — resample on parse failure.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return extractJson(await generate(user, { temperature: 0.95, system: dramaPersona(), maxOutputTokens: 12000 }));
    } catch (e) {
      lastErr = e;
      console.warn(`   concept attempt ${attempt} failed (${e.message}) — retrying`);
    }
  }
  throw lastErr;
}

/**
 * Write ONE episode of the current series + a Shorts teaser + updated state.
 * Scenes use the AINews template shape (hook/point/quote/outro with vo+keywords)
 * so the existing build/render pipeline works unchanged.
 */
export async function geminiDramaEpisode({ series, part, channelName }) {
  const isFirst = part === 1;
  const isLast = part === series.totalParts;
  const user =
    `Write PART ${part} of ${series.totalParts} of the serialized drama "${series.title}".\n\n` +
    `SERIES BIBLE:\nLogline: ${series.logline}\nCharacters:\n${series.characters}\n\nFULL ARC PLAN:\n${series.arc.join("\n")}\n\n` +
    `STORY SO FAR (through Part ${part - 1}): ${isFirst ? "(this is Part 1 — nothing yet)" : series.soFar}\n` +
    `${!isFirst ? `LAST PART ENDED ON THIS CLIFFHANGER (continue from EXACTLY here after the recap): ${series.cliffhanger}\n` : ""}\n` +
    `EPISODE REQUIREMENTS:\n` +
    `- Follow the arc plan for Part ${part} (adapt freely for drama, but hit its planned cliffhanger).\n` +
    `- ${isFirst ? `COLD OPEN: the series' most explosive hook in the first two lines.` : `Open with a 25-35 second dramatic recap ("Ab tak aapne dekha...") that makes NEW viewers desperate to watch earlier parts, then continue the scene from the cliffhanger.`}\n` +
    `- ${isLast ? `This is the FINALE: deliver the full payoff the series promised, punish/redeem who deserves it, land an emotional final beat — then a 1-line tease that a NEW story starts tomorrow.` : `End EXACTLY on Part ${part}'s cliffhanger + a spoken CTA: "Part ${part + 1} miss mat karna — subscribe kar lo abhi."`}\n` +
    `- Narration total ~750-950 Roman-Hindi words. EVERY scene needs "vo".\n\n` +
    `Return ONE JSON object: { "script":{...}, "short":{...}, "meta":{...}, "state":{...} }\n\n` +
    `"script" = { "channelName":"${channelName}", "scenes":[ 10-14 scenes ] } — scene types:\n` +
    `- {"type":"hook","kicker":"Part ${part}","headline":"<3-6 word Roman-Hindi punch>","sub":"<one-line tease>","keywords":["cinematic broll term"],"vo":"..."}  (first scene)\n` +
    `- {"type":"point","heading":"<2-5 word Roman-Hindi beat title>","bullets":[],"keywords":["cinematic broll term"],"vo":"<the scene: narration + dialogue>"}  (most scenes; bullets stay EMPTY)\n` +
    `- {"type":"quote","quote":"<the most chilling line of the episode>","attribution":"<character name>","keywords":["cinematic broll term"],"vo":"..."}  (use once at the peak)\n` +
    `- {"type":"outro","headline":"<cliffhanger text on screen>","cta":"Part ${part + 1} — kal | Subscribe","keywords":["cinematic broll term"],"vo":"<the cliffhanger + CTA>"}  (last scene)\n` +
    `- "keywords" = ENGLISH stock-footage terms matching each scene's mood ("luxury office night","rain window sad","wedding hall drama","city lights car"). 2-3 words.\n\n` +
    `"short" = { "scenes":[ 4 scenes, same types, TOTAL ~60-80 words ] } — a Shorts teaser: THE single most dramatic moment of this part, cut to end mid-tension with vo CTA "poora part channel par hai".\n\n` +
    `"meta" = { "title":"${series.title} - Part ${part} | <curiosity subtitle in Roman Hindi, max 45 chars>", "description":"<2-3 Roman-Hindi sentences selling THIS part, no spoilers of its ending>", "tags":[14-18 tags: hindi kahani, hindi story, suspense story hindi, pocket fm style story, audio story hindi, drama story, plus series/trope-specific], "thumbnail":{"badge":"PART ${part}","bigText":"<3-4 word Roman-Hindi shock line>","subText":"<short tease>","accent":"#E11D48","channelName":"${channelName}"} }\n\n` +
    `"state" = { "soFar":"<updated 120-180 word summary of the story through THIS part — written for the writer of the next part>", "cliffhanger":"<the EXACT cliffhanger moment this part ended on, 1-2 sentences>" }`;
  // Big response (full episode + teaser + meta + state) AND Gemini 2.5 spends
  // "thinking" tokens from the same budget — 8192 truncated mid-JSON.
  // Dialogue-heavy fiction occasionally breaks JSON escaping — resample on failure.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return extractJson(await generate(user, { temperature: 0.9, system: dramaPersona(), maxOutputTokens: 20000 }));
    } catch (e) {
      lastErr = e;
      console.warn(`   episode attempt ${attempt} failed (${e.message}) — retrying`);
    }
  }
  throw lastErr;
}
