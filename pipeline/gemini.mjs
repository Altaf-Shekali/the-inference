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

const loadKey = () =>
  (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || readLocal("gemini.key") || "").trim();
const MODEL = process.env.GEMINI_MODEL || readLocal("gemini.model") || "gemini-2.5-flash";

export const hasGemini = () => loadKey().length > 0;

/** first balanced JSON array/object in a string */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("no JSON in Gemini output");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++;
    else if (body[i] === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
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
 *  (rate limit) and 5xx with backoff. Free-tier per-minute quota resets quickly,
 *  so a short wait recovers instead of silently failing. Returns the final Response. */
async function withRetry(makeFetch, { tries = 3, base = 20000 } = {}) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await makeFetch();
    if (r.status !== 429 && r.status < 500) return r;
    if (i < tries - 1) {
      if (process.env.QUIZ_DEBUG) console.error(`[gemini] ${r.status} — retrying in ${(base * (i + 1)) / 1000}s`);
      await sleep(base * (i + 1)); // 20s, 40s
    }
  }
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
  return extractJson(await generate(user, { temperature: 0.6, system, maxOutputTokens: maxTokens || 6000 }));
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
      `This week's most important current affairs (${monthYear}) for Indian competitive exams (UPSC, SSC, banking, railways): national news, international, economy, appointments, awards, sports, science, defence. Give concrete facts with names, dates and numbers.`,
    );
    facts = (g.answer || "").trim();
  } catch {
    /* grounding unavailable — web fallback below */
  }
  if (facts.length < 600) {
    try {
      const { search, fetchText } = await import("./search.mjs");
      const hits = await search(
        `India current affairs ${monthYear} for competitive exams: appointments, awards, schemes, economy, sports, defence, international`,
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
    `THIS WEEK'S FACTS:\n${facts.slice(0, 8000)}\n\n` +
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

  const out = extractJson(await generate(user, { temperature: 0.92, system: persona, maxOutputTokens: 8192 }));
  return { script: out.script || out, meta: out.meta || {} };
}
