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

/** true-story literary author persona */
export function storyPersona(langName) {
  const masters =
    langName === "Kannada"
      ? "ಕುವೆಂಪು (Kuvempu) and ಕೆ.ಪಿ. ಪೂರ್ಣಚಂದ್ರ ತೇಜಸ್ವಿ (K. P. Poornachandra Tejasvi)"
      : langName === "Hindi"
        ? "मुंशी प्रेमचंद (Premchand) and हरिवंश राय बच्चन (Harivansh Rai Bachchan)"
        : "the great literary storytellers of the language";
  return `You are a master ${langName} storyteller and author. You write TRUE stories in ${langName} in the literary spirit of ${masters} — dignified, vivid, humane, and above all NATURAL and SPOKEN.

Your writing is narrated ALOUD over video. It must feel like a real author telling a gripping true story to a friend — warm, vivid, suspenseful — NEVER like AI, never a dry list of facts, never translationese.

Craft rules:
- Natural, native, SPOKEN ${langName}. Vary rhythm: short punchy lines for tension, flowing lines for reflection.
- Open on a gripping moment; unfold beat by beat; hold tension; deliver the twist; land a thoughtful or emotional ending.
- Vivid but accessible imagery. Draw the listener in; address them directly now and then.
- Keep names, places and facts accurate to the research. Add atmosphere, but NEVER invent events that did not happen.
- ZERO English/Latin letters anywhere. Write EVERYTHING in ${langName} script — including every person name, place, organisation, brand and abbreviation/acronym: transliterate them into ${langName} (e.g. DNA -> ಡಿಎನ್ಎ, USA -> ಅಮೆರಿಕಾ, CEO -> ಸಿಇಒ). The text-to-speech voice mispronounces Latin letters, so not one Latin character may appear in the narration or on-screen text.
- No markdown, no bullet-point feel, no emojis in the narration.`;
}

/** psychology-as-storytelling persona */
export function psychPersona(langName) {
  return `You are a spellbinding ${langName} storyteller who makes PSYCHOLOGY irresistible — part warm friend, part sharp observer of human nature, part great teacher. Each video takes ONE real psychological truth (a bias, a hidden pattern of the mind, a behaviour) and reveals it like a story.

Your writing is narrated ALOUD over video. It must feel like a real person talking directly to the viewer — warm, curious, a little dramatic — NEVER like AI, never a textbook, never a dry list, never translationese.

Craft rules:
- Natural, native, SPOKEN ${langName}. Conversational rhythm; short punchy lines for the hook and the reveal, flowing lines for explanation.
- Open by pulling the viewer in so they feel "this is about ME" (e.g. a question, a everyday moment).
- Use ONE clear, relatable everyday scenario to illustrate the concept, then reveal the psychology behind it, simply.
- Be ACCURATE to real psychology / behavioural science. Use the researched facts; name the real effect or experiment if there is one. You may use illustrative everyday scenarios, but NEVER fabricate studies or fake statistics.
- End with a small insight or question that lingers.
- ZERO English/Latin letters anywhere. Write EVERYTHING in ${langName} script — including every name, place, brand, technical term and abbreviation/acronym: transliterate them into ${langName} (e.g. DNA -> ${langName === "Kannada" ? "ಡಿಎನ್ಎ" : "डीएनए"}, AI -> ${langName === "Kannada" ? "ಎಐ" : "एआई"}). The text-to-speech voice mispronounces Latin letters, so not one Latin character may appear in the narration or on-screen text.
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
    ? `Reveal this psychological truth in an engaging STORYTELLING way, entirely in ${langName}. It must be ACCURATE psychology; you may use ONE relatable everyday scenario to illustrate it, but NEVER fabricate studies or statistics.`
    : `Tell this TRUE story as a narrated video, entirely in ${langName}. It must be a REAL event that actually happened; use ONLY the facts below (add atmosphere, not fake events).`;
  const factsLabel = isConcept ? "RESEARCH (real psychology facts/studies to ground it)" : "RESEARCH (sources & facts)";
  const user =
    `Make a ${short ? "~40 second vertical Short" : "2-3 minute"} narrated video.\n` +
    `${opener}\n` +
    `Category: ${category.topicTag}. ${category.guidance}\n` +
    `Prefer angles that resonate with an Indian audience.\n\n` +
    `${factsLabel}:\n${String(facts).slice(0, 12000)}\n\n` +
    `Return ONE JSON object: { "script": {...}, "meta": {...} }.\n\n` +
    `"script" = {\n` +
    `  "channelName":"${channelName}", "topicTag":"${category.topicTag}", "accent":"${category.accent}",\n` +
    `  "source":"<the real sources, comma-separated>", "voice":"${voice}", "music":"", "showCaptions":${short},\n` +
    `  "scenes":[ ${beats} scenes ]\n}\n` +
    `EVERY scene MUST have a "vo" = the spoken ${langName} narration for that beat. Scene types:\n` +
    `- {"type":"hook","kicker":"${category.topicTag}","headline":"<gripping 3-6 word ${langName} title>","sub":"<one-line teaser>","keywords":["english stock-footage term"]}\n` +
    `- {"type":"point","heading":"<short evocative ${langName} line, 2-6 words>","bullets":[],"keywords":["english stock-footage term"]}  // a beat; bullets EMPTY, the vo carries it\n` +
    `- {"type":"quote","quote":"<a striking line, in ${langName}>","attribution":"<who / context>"}  // use once at the peak\n` +
    `- {"type":"outro","headline":"<closing line in ${langName}>","cta":"<a short ${langName} subscribe line naming ${channelName}>","keywords":["english stock-footage term"]}\n\n` +
    `RULES:\n` +
    `- Start with "hook", end with "outro"; ${midBeats} "point" beats in between that unfold IN ORDER; optionally one "quote" at the peak.\n` +
    `- Each "vo" is 1-4 natural spoken ${langName} sentences. TOTAL narration ~${words} ${langName} words.\n` +
    `- "keywords" are ENGLISH stock-footage search terms matching the mood (e.g. "lonely person window","busy city crowd","brain neurons","old letters"). 2-3 words each. This is the ONLY field that may contain Latin/English — it is never spoken or shown.\n` +
    `- On-screen text (headline/heading/sub/quote) is short, evocative ${langName}.\n` +
    `- CRITICAL: every "vo" and every on-screen field must be 100% ${langName} script with ZERO Latin/English letters. Transliterate ALL names, places, brands, numbers-as-words and abbreviations/acronyms (DNA, USA, AI, CEO, GPS…) into ${langName}. The TTS voice mispronounces Latin text, so a single Latin character is a failure. (Only "keywords" and the JSON keys stay English.)\n` +
    `- "cta" must be written in ${langName} too (e.g. "${channelName} ${langName === "Kannada" ? "ಚಾನೆಲ್ ಅನ್ನು ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ" : "को सब्सक्राइब करें"}"), since it is shown on screen.\n\n` +
    `"meta" = { "title":"<clickable ${langName} title>", "description":"<2-3 ${langName} sentences + a line of #hashtags>", "tags":[12-18 tags, ${langName} + English], "thumbnail":{"badge":"${category.topicTag}","bigText":"<3-5 punchy ${langName} words>","subText":"<short ${langName}>","accent":"${category.accent}","channelName":"${channelName}"} }`;

  const out = extractJson(await generate(user, { temperature: 0.92, system: persona, maxOutputTokens: 8192 }));
  return { script: out.script || out, meta: out.meta || {} };
}
