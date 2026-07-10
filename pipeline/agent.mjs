/**
 * Autonomous idea→script agent. Powered by NVIDIA Nemotron + web search.
 *
 *   node pipeline/agent.mjs            # auto-rotate pillar by day, write a script
 *   node pipeline/agent.mjs tools      # force a pillar (ainews|tools|trend|business)
 *   node pipeline/agent.mjs --render   # also build voiceover/B-roll + render the video
 *
 * Flow:  ① discover (search → Nemotron picks a fresh topic, dedup vs used-topics)
 *        ② research (search + fetch sources → notes)
 *        ③ script   (Nemotron writes scenes+vo+keywords matching the template schema)
 * Output: pipeline/scripts/<date>-<slug>.json (+ .meta.json), then optional render.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { chat, chatJSON, hasKey, modelName } from "./llm.mjs";
import { search, fetchText } from "./search.mjs";
import { hasGemini, geminiTranslate, geminiNarrative, storyPersona, psychPersona, geminiQuiz } from "./gemini.mjs";
import { getChannel, channelUsedTopicsPath } from "./channels.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = path.join(ROOT, "pipeline", "scripts");
const CHANNEL = "The Inference"; // default channel name; used in the SPEC templates

// content pillars rotated across the week — the niche
const PILLARS = {
  ainews: {
    topicTag: "AI News",
    template: "wire",
    accent: "#3B9EFF",
    discover: "biggest AI news this week breakthrough announcement model release",
    guidance: "A breaking-AI-news analysis. Explain what happened, the key numbers, and why it matters.",
  },
  tools: {
    topicTag: "Tool Breakdown",
    template: "studio",
    accent: "#34D399",
    discover: "best new AI tools this week launch review",
    guidance:
      "An AI tool breakdown. Use `tool` scenes (name/category/oneLiner/features/price/verdict) and a `compare` ranking scene.",
  },
  trend: {
    topicTag: "Tech Trend",
    template: "horizon",
    accent: "#F43F5E",
    discover: "emerging technology trend 2026 analysis future",
    guidance: "A technology-trend analysis. Use data (stat/bars) and explain where it's heading.",
  },
  business: {
    topicTag: "Business",
    template: "ledger",
    accent: "#F5B301",
    discover: "tech company business news startup funding earnings this week",
    guidance: "A business/market breakdown of a tech company or deal. Lead with money and the data behind it.",
  },
};
const ORDER = ["ainews", "tools", "trend", "business"];

// Storytelling niche — real true-story categories (a channel with niche:"story"
// rotates these instead of the tech-news PILLARS). Same shape as PILLARS so the
// discovery/research code is shared; the SCRIPT is written by Gemini as an author.
const STORY_CATS = {
  crime: { topicTag: "ನಿಜ ಅಪರಾಧ", accent: "#F43F5E", template: "horizon", discover: "famous true crime case real shocking investigation twist", guidance: "A real, documented crime case with a clear arc: the crime, the mystery, the investigation, the twist, the outcome." },
  scam: { topicTag: "ಹಗರಣ", accent: "#F5B301", template: "ledger", discover: "famous real scam con fraud story how it unravelled", guidance: "A real scam or con: the scheme, how victims were fooled, how it collapsed, the lesson." },
  survival: { topicTag: "ಬದುಕುಳಿದ ಕಥೆ", accent: "#34D399", template: "studio", discover: "incredible real survival story against all odds rescue", guidance: "A real survival, escape or rescue against the odds: the danger, the struggle, the will to live, the rescue." },
  success: { topicTag: "ಯಶೋಗಾಥೆ", accent: "#3B9EFF", template: "wire", discover: "inspiring real rags to riches self made success story", guidance: "A real rags-to-riches or against-the-odds success: the struggle, the turning point, the triumph." },
  history: { topicTag: "ಇತಿಹಾಸದ ರಹಸ್ಯ", accent: "#A78BFA", template: "horizon", discover: "fascinating historical mystery real untold event", guidance: "A real historical event or mystery with intrigue: the setting, the mystery, the discovery, the meaning." },
  human: { topicTag: "ಸ್ಫೂರ್ತಿ ಕಥೆ", accent: "#F472B6", template: "studio", discover: "deeply moving real human story courage twist of fate", guidance: "A real, emotionally moving human story: an ordinary person, an extraordinary moment, the emotional core." },
};
const STORY_ORDER = ["crime", "scam", "survival", "success", "history", "human"];

// Psychology-storytelling niche — one real psychological truth, revealed as a
// story (Hindi channel). Tags in Hindi; Gemini writes it in the psych persona.
const PSYCH_CATS = {
  bias: { topicTag: "दिमागी जाल", accent: "#A78BFA", template: "horizon", discover: "fascinating cognitive bias psychology how it controls decisions", guidance: "A cognitive bias / mental shortcut and how it secretly controls our decisions." },
  behavior: { topicTag: "मानव व्यवहार", accent: "#3B9EFF", template: "studio", discover: "surprising psychology fact why humans behave the way they do", guidance: "A surprising truth about why humans behave the way they do." },
  relationships: { topicTag: "रिश्तों का मनोविज्ञान", accent: "#F472B6", template: "studio", discover: "psychology of love attraction trust human connection fact", guidance: "The psychology behind love, attraction, trust and human connection." },
  dark: { topicTag: "डार्क साइकोलॉजी", accent: "#F43F5E", template: "horizon", discover: "dark psychology persuasion manipulation influence tactic explained", guidance: "A persuasion / dark-psychology tactic and how to recognize it — framed ethically, as awareness." },
  mind: { topicTag: "मन की शक्ति", accent: "#34D399", template: "wire", discover: "mindset habit self improvement how the brain rewires psychology", guidance: "How the mind, habits and mindset quietly shape success and well-being." },
  social: { topicTag: "सामाजिक मनोविज्ञान", accent: "#F5B301", template: "ledger", discover: "famous social psychology experiment crowd behavior fascinating", guidance: "A social-psychology insight or famous experiment about how groups shape us." },
};
const PSYCH_ORDER = ["bias", "behavior", "relationships", "dark", "mind", "social"];

// Languages for localized channels. Non-English forces the Edge engine (it has
// native hi/kn neural voices; Kokoro doesn't). The Remotion template renders
// Devanagari/Kannada via the Noto font fallback.
const LANGS = {
  en: { name: "English", voice: "en-US-AndrewNeural" },
  hi: { name: "Hindi", script: "Devanagari", voice: "hi-IN-MadhurNeural" },
  // Nemotron is weak in Kannada → write English, then Gemini translates (translate:true)
  kn: { name: "Kannada", script: "Kannada", voice: "kn-IN-GaganNeural", translate: true },
};

/** gather the user-visible strings from a script + meta for translation */
function collectTranslatable(script, meta) {
  const items = [];
  const pushObj = (obj, key) => {
    if (obj && typeof obj[key] === "string" && obj[key].trim()) items.push({ obj, key });
  };
  const pushArr = (arr) => {
    if (Array.isArray(arr)) arr.forEach((v, i) => typeof v === "string" && v.trim() && items.push({ arr, i }));
  };
  // "name"/item.name and "value"/"price" are kept in English (brands, numbers)
  const KEYS = ["vo", "kicker", "headline", "sub", "heading", "label", "quote", "attribution", "cta", "category", "oneLiner", "verdict", "title"];
  for (const s of script.scenes || []) {
    for (const k of KEYS) pushObj(s, k);
    pushArr(s.bullets);
    pushArr(s.features);
    if (Array.isArray(s.items)) for (const it of s.items) pushObj(it, "note");
    if (Array.isArray(s.data)) for (const d of s.data) pushObj(d, "label");
  }
  pushObj(meta, "title");
  pushObj(meta, "description");
  if (meta.thumbnail) for (const k of ["bigText", "subText"]) pushObj(meta.thumbnail, k);
  return items;
}

// evergreen tags merged into every video's meta (on top of the model's
// topic-specific tags) for better discoverability
const BASE_TAGS = {
  ainews: ["AI news", "artificial intelligence", "AI 2026", "tech news", "AI updates", "machine learning", "AI explained", "OpenAI", "AI breakthrough", "tech analysis", "AI today"],
  tools: ["AI tools", "best AI tools", "AI software", "AI app review", "productivity tools", "AI tools 2026", "tech tools", "AI for business", "new AI tools"],
  trend: ["technology trends", "future tech", "tech 2026", "emerging technology", "innovation", "tech explained", "future technology", "tech trends 2026"],
  business: ["business news", "tech business", "startups", "market analysis", "tech economy", "finance news", "business breakdown", "tech stocks", "company breakdown"],
};

const SCRIPT_SPEC = `
Return ONE JSON object: { "script": {...}, "meta": {...} }.

"script" MUST match this shape exactly:
{
  "channelName": "${CHANNEL}",
  "topicTag": "<the pillar tag>",
  "accent": "<the pillar hex color>",
  "source": "<comma-separated real sources you used>",
  "voice": "en-US-AndrewNeural",
  "music": "",
  "showCaptions": false,
  "scenes": [ ...9 to 12 scenes... ]
}

⚠️ EVERY scene MUST include a "vo" field — the spoken narration. This is the single most
important field; never omit it. OMIT durationInFrames (it is derived from the narration).

Allowed scene types (each needs "type" + a "vo" narration string):
- {"type":"hook","kicker":"...","headline":"...","sub":"...","keywords":["broll term","..."]}
- {"type":"headlines","heading":"...","items":[{"source":"Outlet","title":"..."} x3]}
- {"type":"stat","value":"$852B","label":"...","source":"..."}
- {"type":"bars","title":"...","unit":"B","data":[{"label":"...","value":42} x3-4],"source":"..."}
- {"type":"point","heading":"...","bullets":["...","...","..."],"keywords":["broll term"]}
- {"type":"quote","quote":"...","attribution":"...","keywords":["broll term"]}
- {"type":"tool","name":"...","category":"...","oneLiner":"...","features":["...","..."],"price":"...","verdict":"...","keywords":["broll term"]}
- {"type":"compare","title":"...","items":[{"name":"...","note":"..."} x3-5]}
- {"type":"outro","headline":"...","cta":"Subscribe to ${CHANNEL}","keywords":["broll term"]}

RULES:
- Start with "hook", end with "outro".
- Put numbers in "stat"/"bars". Add "keywords" (2-3 visual B-roll search terms) ONLY to hook/point/quote/tool/outro; NOT to stat/bars/headlines/compare (those are clean graphics).
- Wrap the 1-2 most important words per text line in **double asterisks** to highlight them.
- PACING (critical): each "vo" is ONE short, punchy sentence — MAX ~16 words. Never write 2-3 long sentences in one scene; split into more scenes instead. Aim for fast 4-7 second beats. More short scenes beats fewer long ones.
- "vo" is spoken narration: natural, energetic, spell acronyms phonetically ("A-I","I-P-O","C-E-O").
- Be ACCURATE — only use facts present in the research notes. No invented numbers.

"meta" MUST be: { "title":"<clickable YouTube title>", "description":"<2-3 sentences + a line of #hashtags>", "tags":["...", 12-18 SPECIFIC tags: real names/companies/products/topics from the video, plus search phrases viewers would type], "thumbnail":{"badge":"<pillar tag>","bigText":"<3-5 punchy words>","subText":"<short>","accent":"<pillar hex>","channelName":"${CHANNEL}"} }
`;

// A standalone SHORT — its own punchy 25-35s script, NOT a cut of the long-form.
const SHORT_SPEC = `
Return ONE JSON object: { "script": {...}, "meta": {...} }.

This is a YouTube SHORT — a punchy, fast vertical video of about 25-35 SECONDS total.

"script" MUST match this shape exactly:
{
  "channelName": "${CHANNEL}",
  "topicTag": "<the pillar tag>",
  "accent": "<the pillar hex color>",
  "source": "<comma-separated real sources you used>",
  "voice": "en-US-AndrewNeural",
  "music": "",
  "showCaptions": true,
  "scenes": [ ...EXACTLY 4 to 5 scenes... ]
}

⚠️ EVERY scene MUST include a "vo" field — the spoken narration. OMIT durationInFrames.

Allowed scene types (each needs "type" + a "vo"):
- {"type":"hook","kicker":"...","headline":"...","sub":"...","keywords":["broll term"]}
- {"type":"stat","value":"$852B","label":"...","source":"..."}
- {"type":"point","heading":"...","bullets":["...","..."],"keywords":["broll term"]}
- {"type":"outro","headline":"...","cta":"Follow ${CHANNEL}","keywords":["broll term"]}

RULES:
- EXACTLY 4-5 scenes. Start with "hook", end with "outro"; 2-3 stat/point scenes between.
- TOTAL spoken time ~25-35 seconds. Each "vo" is ONE punchy sentence, MAX ~12 words.
- The HOOK must grab attention in the first 2 seconds — bold claim, number, or question.
- Wrap the 1-2 most important words per line in **double asterisks**.
- "vo" is spoken narration: energetic, acronyms phonetic ("A-I","I-P-O","C-E-O").
- Be ACCURATE — only facts present in the research notes. No invented numbers.

"meta" MUST be: { "title":"<punchy Shorts title>", "description":"<1-2 sentences + #Shorts and a few #hashtags>", "tags":["...", 10-15 SPECIFIC tags], "thumbnail":{"badge":"<pillar tag>","bigText":"<3-4 punchy words>","subText":"<short>","accent":"<pillar hex>","channelName":"${CHANNEL}"} }
`;

// DEEP, EXPERT TOOL BREAKDOWN (the English "tools" pillar) — written as an analyst
// who knows the tool inside-out, grounded in the research notes. Does NOT claim
// personal hands-on use (many tools are unreleased / limited-access). Fixes the
// "sounds like an ad" problem via real how-it-works + honest limits + verdict.
const TOOLS_SPEC = `
Return ONE JSON object: { "script": {...}, "meta": {...} }.

This is a DEEP, EXPERT TOOL BREAKDOWN — written as someone who understands the tool inside-out and explains, clearly and honestly, WHAT it is, HOW it works, what it's genuinely good at, and where it falls short. Authoritative and insightful, like a sharp tech analyst who has studied it thoroughly. NOT an ad, NOT a news announcement.

⚠️ CRITICAL: Do NOT claim to have personally USED, TRIED, TESTED, set up, or "played with" the tool. Many of these tools are unreleased or limited-access, so any "I used it" claim is false and destroys credibility. Never use first person about hands-on experience. Instead, demonstrate DEEP UNDERSTANDING by explaining precisely what it is and how it works.

⚠️ Every factual claim (how it works, features, price, strengths, limitations, numbers) MUST come from the RESEARCH NOTES. Do NOT invent specifics. Where the notes are thin, speak generally rather than fabricate.

"script" MUST match this shape:
{
  "channelName": "${CHANNEL}",
  "topicTag": "Tool Breakdown",
  "accent": "#34D399",
  "source": "<the real sources you used>",
  "voice": "en-US-AvaMultilingualNeural",
  "music": "",
  "showCaptions": false,
  "scenes": [ 9 to 11 scenes, EACH with a "vo" ]
}

Build the breakdown in THIS order (every scene needs "vo" = clear, knowledgeable spoken narration):
1. {"type":"hook","kicker":"Tool Breakdown","headline":"<the PROBLEM, not the tool>","sub":"<name the tool as the answer>","keywords":["broll term"]}  — open on the pain it solves, not hype
2. {"type":"point","heading":"What it actually is","bullets":["<plain, precise one-liner>","<who made it / who it's really for>"],"keywords":["broll term"]}  — honest, zero marketing words
3. {"type":"point","heading":"How it works","bullets":["Step 1 - ...","Step 2 - ...","Step 3 - ..."],"keywords":["broll term"]}  — the actual workflow / mechanism, start to result. This is the CORE: show you understand it deeply.
4. {"type":"point","heading":"What stands out","bullets":["<capability -> why it matters>","<capability -> why>"],"keywords":["broll term"]}
5. {"type":"point","heading":"What you can do with it","bullets":["<a concrete real-world use case>"],"keywords":["broll term"]}  — OR {"type":"stat","value":"<real number>","label":"<what it means>"} if the notes give one
6. {"type":"stat","value":"<price, or 'Free tier'>","label":"Is it worth it? <honest value take - what you get for the money>"}  — a DEDICATED pricing + value beat (use {"type":"point","heading":"What it costs","bullets":[...]} if there are multiple plans)
7. {"type":"point","heading":"What makes it strong","bullets":["<genuine strength>","<genuine strength>"],"keywords":["broll term"]}
8. {"type":"point","heading":"Where it falls short","bullets":["<a REAL limitation>","<who it's NOT for>"],"keywords":["broll term"]}  — MANDATORY honesty: name at least one real weakness
9. {"type":"tool","name":"<tool name>","category":"<category>","oneLiner":"<what it does>","features":["...","..."],"price":"<free tier / real pricing>","verdict":"<one-line honest verdict>"}  — the summary card
10. {"type":"outro","headline":"Worth it if ... / Skip it if ...","cta":"Subscribe to ${CHANNEL}","keywords":["broll term"]}  — a REAL recommendation: who should use it AND who should skip it

NON-NEGOTIABLE (this is what stops it sounding like an ad):
- The "How it works" step-by-step scene (proves deep understanding).
- The honest "Where it falls short" scene with a real limitation.
- An outro verdict that also says who should SKIP it.

WRITING:
- "vo" is spoken: authoritative, clear and engaging — like an expert who knows it deeply and is explaining it so the viewer truly understands. 1-4 sentences per scene. TOTAL narration ~320-450 words.
- NEVER say "I used / I tried / I tested / when I set it up / it tripped me up" or imply hands-on use. Use explanatory framing: "Here's how it works...", "Where it struggles is...", "What makes it clever is...", "In practice, this means...".
- Wrap the 1-2 most important words per line in **double asterisks**.
- Acronyms spoken phonetically ("A-I","A-P-I"). "keywords" are ENGLISH stock-footage search terms for the beat's mood.

"meta" MUST be: { "title":"<clear, curiosity-driven title, e.g. '<Tool>: how it actually works' or 'Everything you need to know about <Tool>' — NOT 'I used...'>", "description":"<2-3 honest sentences + a line of #hashtags>", "tags":[12-18 specific tags: tool name, category, 'explained','how it works','review', alternatives], "thumbnail":{"badge":"Tool Breakdown","bigText":"<3-5 punchy words>","subText":"<short>","accent":"#34D399","channelName":"${CHANNEL}"} }
`;

async function loadUsed(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return [];
  }
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

// Nemotron invents type names and nests fields — coerce its output to the schema.
const VALID_TYPES = new Set(["hook", "headlines", "stat", "bars", "point", "quote", "tool", "compare", "outro"]);
const TYPE_ALIASES = {
  headline: "headlines", news: "headlines", newscards: "headlines",
  statistic: "stat", stats: "stat", number: "stat", metric: "stat",
  bar: "bars", barchart: "bars", chart: "bars", graph: "bars",
  bullet: "point", points: "point", section: "point", list: "point",
  comparison: "compare", ranking: "compare", versus: "compare",
  cta: "outro", ending: "outro", conclusion: "outro", intro: "hook", title: "hook",
};

/** coerce anything (object/array/null) to a clean plain string */
const toStr = (v) => {
  if (typeof v === "string") return v.replace(/\[object Object\]/g, "").trim();
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(toStr).filter(Boolean).join(" ");
  if (typeof v === "object")
    return toStr(v.vo ?? v.text ?? v.narration ?? v.content ?? v.value ?? Object.values(v).find((x) => typeof x === "string") ?? "");
  return String(v);
};

/** force the model's scenes to match the template schema; drop unsalvageable ones */
function normalizeScenes(scenes) {
  const out = [];
  for (const raw of Array.isArray(scenes) ? scenes : []) {
    const s = { ...raw };
    let t = String(s.type || "").toLowerCase().trim();
    t = TYPE_ALIASES[t] || t;
    if (!VALID_TYPES.has(t)) continue;
    s.type = t;
    s.vo = toStr(s.vo);
    for (const k of ["headline", "sub", "kicker", "heading", "title", "label", "quote", "attribution", "value", "name", "category", "oneLiner", "price", "verdict", "cta", "source", "unit"])
      if (s[k] != null) s[k] = toStr(s[k]);
    // kicker/category render raw (not through the **highlight** parser) — strip any markup
    if (s.kicker) s.kicker = s.kicker.replace(/\*+/g, "").trim();
    if (s.category) s.category = s.category.replace(/\*+/g, "").trim();
    if (Array.isArray(s.keywords)) s.keywords = s.keywords.map(toStr).filter(Boolean);
    if (Array.isArray(s.bullets)) s.bullets = s.bullets.map(toStr).filter(Boolean);
    if (Array.isArray(s.features)) s.features = s.features.map(toStr).filter(Boolean);
    if (t === "bars" && Array.isArray(s.data))
      s.data = s.data.map((d) => ({ label: toStr(d.label), value: Number(d.value) || 0 })).filter((d) => d.label);
    if ((t === "headlines" || t === "compare") && Array.isArray(s.items))
      s.items = s.items.map((it) =>
        t === "headlines" ? { source: toStr(it.source), title: toStr(it.title) } : { name: toStr(it.name), note: toStr(it.note) },
      );
    out.push(s);
  }
  return out;
}

/** Current-affairs QUIZ pipeline — separate from news/story: generate + fact-check
 *  MCQs, render QuizLong + QuizShort (silent), upload both. */
async function runQuiz({ channel, channelName, dateStr, doRender, doUpload, publishAt, doShort, doLong }) {
  const fileExists = (p) => fs.access(p).then(() => true).catch(() => false);
  // Which formats? --short = short only, --long = long only, neither = both (the
  // daily cron passes neither, so scheduled runs still make both).
  const renderLong = doLong || (!doShort && !doLong);
  const renderShort = doShort || (!doShort && !doLong);
  console.log(`Agent: Quiz  |  ${channelName}  |  ${dateStr}  |  ${renderLong && renderShort ? "long + short" : renderLong ? "long only" : "short only"}`);
  console.log("① generating current-affairs quiz (grounded + fact-checked)…");
  const longQs = await geminiQuiz(25);
  if (longQs.length < 5) throw new Error(`quiz generation returned too few questions (${longQs.length})`);
  const shortQs = longQs.slice(0, 8);
  console.log(`   ${longQs.length} questions (long) · ${shortQs.length} (short)`);

  const human = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  const accent = "#3B82F6";
  // sound effects: use whatever's in public/quiz/ (WAVs are generated by
  // pipeline/make-quiz-sounds.mjs; drop your own .mp3 to override).
  const pickSound = async (base) => {
    for (const ext of [".wav", ".mp3"]) {
      if (await fileExists(path.join(ROOT, "public", "quiz", base + ext))) return `quiz/${base}${ext}`;
    }
    return "";
  };
  const tick = await pickSound("tick"); // countdown blip, looped 1/sec
  const ding = await pickSound("reveal"); // "answer revealed" chime
  const music = await pickSound("bg"); // ambient bed
  const subscribeText = `New here? Subscribe to ${channelName} for a daily current affairs quiz.`;
  const ANSWER_SECONDS = 7; // seconds to answer each question (countdown)
  const REVEAL_SECONDS = 4; // seconds to see the correct answer before the next question
  const mkProps = (qs) => ({ title: "Daily Current Affairs Quiz", date: human, channelName, accent, subscribeText, music, tick, ding, answerSeconds: ANSWER_SECONDS, revealSeconds: REVEAL_SECONDS, questions: qs });

  const meta = {
    title: `Daily Current Affairs Quiz - ${human} | GK MCQs for UPSC SSC Banking`,
    description: `Today's current affairs + GK quiz for competitive exams (UPSC, SSC, Banking, Railways). ${longQs.length} questions, 3 seconds each - comment your score!\n\n#currentaffairs #gk #quiz #upsc #ssc #dailycurrentaffairs`,
    tags: ["current affairs", "current affairs quiz", "daily current affairs", "gk quiz", "gk mcq", "general knowledge", "upsc", "ssc", "banking exam", "railway exam", "competitive exams", "today current affairs", "quiz"],
    categoryId: "27",
    thumbnail: { badge: "QUIZ", bigText: "Daily Current Affairs", subText: `${human} · ${longQs.length} Questions`, accent, channelName },
    channel: channel.id,
    lang: "en",
  };

  const base = `${dateStr}-current-affairs-quiz`;
  await fs.mkdir(SCRIPTS, { recursive: true });
  await fs.writeFile(path.join(SCRIPTS, `${base}.meta.json`), JSON.stringify(meta, null, 2));
  await fs.mkdir(path.join(ROOT, "out"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "out", `${base}.props.json`), JSON.stringify(mkProps(longQs), null, 2));
  await fs.writeFile(path.join(ROOT, "out", `${base}.short.props.json`), JSON.stringify(mkProps(shortQs), null, 2));
  console.log(`✓ script: pipeline/scripts/${base}.meta.json`);

  if (!doRender) return;
  if (renderLong) {
    console.log("\n② rendering QuizLong (16:9)…");
    execSync(`npx remotion render QuizLong out/${base}.mp4 --props=out/${base}.props.json --concurrency=1`, { cwd: ROOT, stdio: "inherit" });
  }
  if (renderShort) {
    console.log("\n② rendering QuizShort (9:16)…");
    execSync(`npx remotion render QuizShort out/${base}.short.mp4 --props=out/${base}.short.props.json --concurrency=1`, { cwd: ROOT, stdio: "inherit" });
  }
  console.log(`\n✓ done: ${[renderLong && `out/${base}.mp4`, renderShort && `out/${base}.short.mp4`].filter(Boolean).join(" + ")}`);

  if (doUpload) {
    const atFlag = publishAt ? ` --at=${publishAt}` : "";
    const privacyFlag = publishAt ? "" : channel.privacy === "public" ? " --public" : channel.privacy === "unlisted" ? " --unlisted" : "";
    console.log(`\n③ uploading quiz (${renderLong && renderShort ? "long + short" : renderLong ? "long" : "short"})…`);
    if (renderLong) execSync(`node pipeline/publish.mjs "${base}" --channel=${channel.id}${privacyFlag}${atFlag}`, { cwd: ROOT, stdio: "inherit" });
    if (renderShort) execSync(`node pipeline/publish.mjs "${base}" --short --channel=${channel.id}${privacyFlag}${atFlag}`, { cwd: ROOT, stdio: "inherit" });
  }
}

async function main() {
  if (!hasKey()) {
    console.error("No Nemotron key. Add it to pipeline/nemotron.key (one line) and retry.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  // npm strips flags after the script name off argv (unless separated by `--`)
  // but re-exposes them as npm_config_<name> env vars. Honor both so that e.g.
  // `npm run daily --channel=x --upload` works even without the `--` separator.
  const npmFlag = (name) => process.env[`npm_config_${name}`];
  const boolFlag = (name) => args.includes(`--${name}`) || npmFlag(name) === "true";
  const doRender = boolFlag("render");
  const doUpload = boolFlag("upload");
  const doShort = boolFlag("short");
  const doLong = boolFlag("long"); // quiz: render long only (non-quiz niches: ignored)
  // robustly read --name=value (avoids off-by-one on the flag length), falling
  // back to the npm_config_<name> env var when npm ate the flag.
  const flagVal = (name) => {
    const a = args.find((x) => x.startsWith(`${name}=`));
    if (a) return a.slice(name.length + 1);
    return npmFlag(name.replace(/^--/, "")) || undefined;
  };
  const topic = flagVal("--topic");
  const engine = flagVal("--engine");
  const publishAt = flagVal("--at"); // RFC3339 UTC — schedule the public release

  // resolve the channel (defaults to "the-inference"); its config drives name,
  // language, pillars, voice and privacy unless a flag overrides.
  const channel = getChannel(flagVal("--channel") || "the-inference");
  const channelName = channel.spokenName || channel.name; // in-video/narration name (native script if set)
  const voice = flagVal("--voice") || channel.voice || "";
  const lang = flagVal("--lang") || channel.lang || "en";
  const L = LANGS[lang] || LANGS.en;

  // niche selects the category set + the writer:
  //   ainews → Nemotron tech-news pillars; story → Gemini true-story author;
  //   psych  → Gemini psychology-as-storytelling.
  const niche = channel.niche || "ainews";
  const isGemini = niche === "story" || niche === "psych";
  const CATS = niche === "psych" ? PSYCH_CATS : niche === "story" ? STORY_CATS : PILLARS;
  const defOrder = niche === "psych" ? PSYCH_ORDER : niche === "story" ? STORY_ORDER : ORDER;
  const order = channel.pillars?.filter((p) => CATS[p]).length ? channel.pillars.filter((p) => CATS[p]) : defOrder;
  const forced = args.find((a) => CATS[a]);

  const today = new Date();
  const dayIdx = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 864e5);
  const pillarId = forced || order[dayIdx % order.length];
  const pillar = CATS[pillarId];

  if (isGemini && !hasGemini()) {
    console.error(`The "${niche}" niche needs Gemini — add pipeline/gemini.key.`);
    process.exit(1);
  }
  const dateStr = today.toISOString().slice(0, 10);

  // Quiz niche has its own pipeline (grounded MCQs → silent render → upload both).
  if (niche === "quiz") {
    if (!hasGemini()) {
      console.error("Quiz niche needs Gemini — add pipeline/gemini.key.");
      process.exit(1);
    }
    await runQuiz({ channel, channelName, dateStr, doRender, doUpload, publishAt, doShort, doLong });
    return;
  }

  console.log(`Agent: ${modelName()}  |  ${channelName}  |  ${doShort ? "SHORT  |  " : ""}${lang !== "en" ? L.name + "  |  " : ""}${niche === "ainews" ? "pillar" : niche}: ${pillarId} (${pillar.topicTag})  |  ${dateStr}`);

  const usedPath = channelUsedTopicsPath(channel.id);
  const used = await loadUsed(usedPath);
  const recentTitles = used.slice(-25).map((u) => u.title);

  // ① DISCOVER (or use a user-supplied topic)
  let hits, pick;
  if (topic) {
    console.log(`① custom topic: ${topic}`);
    hits = await search(topic, 8).catch(() => []);
    pick = { slug: slugify(topic), title: topic, angle: "", queries: [topic] };
  } else {
    console.log(isGemini ? (niche === "psych" ? "① finding a psychology topic…" : "① finding a real story…") : "① discovering trending topics…");
    hits = await search(pillar.discover, 10);
    const candidates = hits.map((h, i) => `${i + 1}. ${h.title} — ${h.url}`).join("\n");
    const covered = `Already covered (DO NOT repeat):\n${recentTitles.join("\n") || "(none)"}`;
    const pickSys =
      niche === "psych"
        ? "You select ONE fascinating, specific psychological concept, effect or experiment to reveal as a story. Reply with JSON only."
        : niche === "story"
          ? "You select the single most compelling, well-documented TRUE story (a real event that actually happened) for a storytelling channel. Reply with JSON only."
          : "You pick fresh, specific, high-retention video topics for a faceless YouTube channel. Reply with JSON only.";
    const pickUser =
      niche === "psych"
        ? `Psychology category: ${pillar.topicTag}. ${pillar.guidance}\n\nRelated results:\n${candidates}\n\n${covered}\n\nPick ONE specific, REAL psychological concept/effect/experiment that makes a fascinating, relatable video for an Indian audience. Reply JSON: {"slug":"kebab-topic","title":"the concept in a few words","angle":"the hook in one sentence","queries":["3 web search queries to gather the real facts/studies behind it"]}`
        : niche === "story"
          ? `Story category: ${pillar.topicTag}. ${pillar.guidance}\n\nCandidate real stories:\n${candidates}\n\n${covered}\n\nPick ONE specific, REAL, well-documented story that makes a gripping video and resonates with an Indian audience. Reply JSON: {"slug":"kebab-topic","title":"the story in a few words","angle":"the hook in one sentence","queries":["3 web search queries to gather the facts of THIS specific story"]}`
          : `Pillar: ${pillar.topicTag}. ${pillar.guidance}\n\nCandidate headlines:\n${candidates}\n\n${covered}\n\nPick the single best FRESH topic. Reply JSON: {"slug":"kebab-topic","title":"working title","angle":"one sentence angle","queries":["3 specific research search queries"]}`;
    pick = await chatJSON([
      { role: "system", content: pickSys },
      { role: "user", content: pickUser },
    ]);
    console.log(`   topic: ${pick.title}`);
  }

  // ② RESEARCH
  // Tool Breakdown: research it like a hands-on reviewer would — how to use it,
  // honest reviews, pricing — so the script has real workflow + pros/cons, not PR.
  if (pillarId === "tools") {
    pick.queries = [`${pick.title} step by step tutorial how to use`, `${pick.title} honest review pros and cons limitations`, `${pick.title} pricing plans`];
  }
  console.log("② researching…");
  const notes = [];
  for (const q of (pick.queries || []).slice(0, 4)) {
    const res = await search(q, 4);
    for (const r of res.slice(0, 2)) {
      const body = r.content || (await fetchText(r.url, 2500));
      if (body) notes.push(`SOURCE: ${r.title} (${r.url})\n${body.slice(0, 2000)}`);
    }
  }
  // grounding guard: if fetches failed (e.g. search rate-limited), at least
  // anchor the script to the CURRENT discovery headlines instead of stale
  // training-data knowledge.
  if (notes.length === 0) {
    console.warn("   ⚠ 0 sources fetched (search likely rate-limited). Anchoring to current headlines.");
    console.warn("     For reliable daily grounding, add a free Tavily key: pipeline/tavily.key");
    notes.push("CURRENT HEADLINES:\n" + hits.map((h) => `- ${h.title} (${h.url})`).join("\n"));
  }
  console.log(`   gathered ${notes.length} sources`);

  // ③ SCRIPT
  // Kannada news is written in English then Gemini-localized; story channels are
  // written directly by Gemini as an author (no Nemotron, no translate step).
  const useTranslate = !isGemini && lang !== "en" && L.translate && hasGemini();
  let script, meta;
  if (isGemini) {
    const persona = niche === "psych" ? psychPersona(L.name) : storyPersona(L.name);
    const kind = niche === "psych" ? "concept" : "true-story";
    console.log(`③ writing the ${L.name} ${niche === "psych" ? "psychology story" : "story"} with Gemini (author style)…`);
    const out = await geminiNarrative({
      persona,
      kind,
      langName: L.name,
      facts: notes.join("\n\n---\n\n"),
      category: pillar,
      channelName,
      voice: voice || L.voice,
      short: doShort,
    });
    script = out.script || {};
    meta = out.meta || {};
  } else {
    if (lang !== "en" && L.translate && !hasGemini())
      console.warn(`   ⚠ ${L.name} is best via Gemini — add pipeline/gemini.key. Falling back to direct Nemotron ${L.name} (lower quality).`);
    const langDirective =
      lang === "en" || useTranslate
        ? ""
        : `\n\n⚠️ LANGUAGE — CRITICAL: Write ALL "vo" narration AND every on-screen text field (headline, sub, kicker, heading, bullets, title, label, quote, attribution, name, oneLiner, verdict, cta, items, AND meta.title/meta.description/thumbnail text) in ${L.name}, using ${L.script} script. Write natural, native ${L.name} — NOT transliteration, NOT English in ${L.script} letters. Keep brand/product names, numbers, currency and source URLs in their original form. Spell out acronyms phonetically for a ${L.name} listener.`;
    console.log(`③ writing ${doShort ? "SHORT " : ""}${lang !== "en" ? L.name + " " : ""}script with Nemotron…`);
    const out = await chatJSON(
      [
        {
          role: "system",
          content:
            pillarId === "tools"
              ? `You are a sharp tech analyst for ${channelName} who understands tools deeply and explains what they are, how they work, and their honest strengths and limitations. You NEVER claim to have personally used, tried, or tested a tool. Output ONLY JSON.`
              : `You are a scriptwriter for ${channelName}, a faceless AI/tech channel. Output ONLY JSON.`,
        },
        {
          role: "user",
          content: `Make a ${doShort ? "SHORT (vertical, ~30s)" : "video"} for pillar "${pillar.topicTag}" (accent ${pillar.accent}).\nTopic: ${pick.title}\nAngle: ${pick.angle}\n\nRESEARCH NOTES:\n${notes.join("\n\n---\n\n").slice(0, 12000)}\n\n${(doShort ? SHORT_SPEC : pillarId === "tools" ? TOOLS_SPEC : SCRIPT_SPEC).split(CHANNEL).join(channelName)}${langDirective}`,
        },
      ],
      // Indic scripts (Devanagari/Kannada) tokenize ~2-3x heavier than English,
      // so give non-English generations a much bigger budget or the JSON truncates.
      { maxTokens: doShort ? (lang === "en" ? 2500 : 5000) : lang === "en" ? 6000 : 11000 },
    );
    script = out.script || out;
    meta = out.meta || {};
  }
  // enforce the invariants regardless of what the model returned
  script.channelName = channelName;
  script.topicTag = pillar.topicTag;
  script.template = pillar.template;
  script.accent = pillar.accent;
  // non-English forces Edge (it has the hi/kn neural voices); Kokoro is English-only here
  if (lang !== "en" && engine === "kokoro") console.warn(`   (Kokoro has no ${L.name} voice — using Edge)`);
  script.lang = lang;
  script.engine = lang === "en" ? engine || "edge" : "edge";
  script.voice = voice || (lang !== "en" ? L.voice : script.engine === "kokoro" ? "am_michael" : "en-US-AndrewNeural");
  script.music = "";
  script.showCaptions = isGemini || doShort; // Shorts + story/psych videos burn captions on

  // coerce the model's output to the template schema (fix bad types, nested vo, etc.)
  script.scenes = normalizeScenes(script.scenes);
  if (script.scenes.length < 3) {
    throw new Error("model returned no usable scenes after normalization");
  }

  // GUARANTEE narration — Nemotron frequently omits `vo` (or nests it). Repair in one pass.
  if (script.scenes.some((s) => !s.vo || !s.vo.trim())) {
    console.log("   (repairing: adding missing voiceover narration…)");
    const skeleton = script.scenes.map((s, i) => ({
      i,
      type: s.type,
      text: s.headline || s.title || s.value || s.quote || s.heading || s.name || s.cta || "",
    }));
    try {
      const voArr = await chatJSON(
        [
          { role: "system", content: "You write spoken video narration. Reply with JSON only." },
          {
            role: "user",
            content: `Write voiceover for these ${skeleton.length} scenes of a ${pillar.topicTag} video titled "${pick.title}". Each: 1-3 punchy spoken sentences, acronyms phonetic ("A-I","I-P-O"). Use only facts from the notes. Return a JSON array of EXACTLY ${skeleton.length} strings, in scene order.\n\nScenes:\n${JSON.stringify(skeleton)}\n\nNOTES:\n${notes.join("\n").slice(0, 6000)}`,
          },
        ],
        { maxTokens: 3000 },
      );
      if (Array.isArray(voArr) && voArr.length === script.scenes.length) {
        script.scenes.forEach((s, i) => {
          if (!s.vo || !s.vo.trim()) s.vo = toStr(voArr[i]);
        });
      }
    } catch (e) {
      console.warn(`   vo repair failed (${e.message}) — using scene text as fallback`);
    }
    // last-resort fallback so the build never produces a silent scene
    script.scenes.forEach((s) => {
      if (!s.vo || !String(s.vo).trim())
        s.vo = s.headline || s.title || s.label || s.quote || s.heading || s.sub || s.cta || s.oneLiner || "";
    });
  }

  // enrich tags: model's topic-specific tags + evergreen pillar tags, deduped,
  // capped to YouTube's ~500-char total budget
  {
    const merged = [];
    const seen = new Set();
    for (const tag of [...(Array.isArray(meta.tags) ? meta.tags : []), ...(BASE_TAGS[pillarId] || [])]) {
      const tt = String(tag).trim();
      const k = tt.toLowerCase();
      if (tt && !seen.has(k)) {
        seen.add(k);
        merged.push(tt);
      }
    }
    let len = 0;
    const capped = [];
    for (const tt of merged) {
      if (len + tt.length + 1 > 480) break;
      capped.push(tt);
      len += tt.length + 1;
    }
    meta.tags = capped;
    if (!meta.title) meta.title = pick.title;

    // strip markdown from plain-text fields (YouTube title/description + the
    // thumbnail text don't render **highlight** markup — it'd show literally)
    const stripMd = (s) => String(s ?? "").replace(/\*+/g, "").replace(/`/g, "").trim();
    meta.title = stripMd(meta.title);
    if (meta.description) meta.description = stripMd(meta.description);
    if (meta.thumbnail) {
      for (const k of ["badge", "bigText", "subText"]) {
        if (meta.thumbnail[k]) meta.thumbnail[k] = stripMd(meta.thumbnail[k]);
      }
      meta.thumbnail.channelName = channelName;
    }
    meta.channel = channel.id; // which channel this belongs to (dashboard + upload routing)
    meta.lang = lang;
  }

  // localize: Nemotron wrote English; Gemini translates the visible strings.
  if (useTranslate) {
    try {
      const items = collectTranslatable(script, meta);
      console.log(`   translating ${items.length} fields to ${L.name} with Gemini…`);
      const texts = items.map((it) => (it.arr ? it.arr[it.i] : it.obj[it.key]));
      const tr = await geminiTranslate(texts, L.name);
      items.forEach((it, i) => (it.arr ? (it.arr[it.i] = tr[i]) : (it.obj[it.key] = tr[i])));
    } catch (e) {
      console.warn(`   ⚠ Gemini translate failed (${e.message}) — keeping English text`);
    }
  }

  // Mid-video subscribe reminder — in the channel's language, naming its topics +
  // channel. Inserted AFTER translate so its (already-localized) text isn't re-translated.
  {
    const t = channel.topics || "our videos";
    const SUB = {
      en: { h: "New here? Subscribe", cta: `Subscribe to ${channelName}`, vo: `And if you're watching ${channelName} for the first time, and you're into ${t}, do hit subscribe — we drop a fresh one every day.` },
      hi: { h: "यहाँ नए हैं? सब्सक्राइब करें", cta: `${channelName} को सब्सक्राइब करें`, vo: `और अगर आप ${channelName} को पहली बार देख रहे हैं, और आपको ${t} में दिलचस्पी है, तो अभी सब्सक्राइब कर दीजिए — हर दिन एक नई वीडियो।` },
      kn: { h: "ಹೊಸಬರೇ? ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ", cta: `${channelName} ಚಾನೆಲ್ ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ`, vo: `ಮತ್ತು ನೀವು ${channelName} ಅನ್ನು ಮೊದಲ ಬಾರಿ ನೋಡುತ್ತಿದ್ದರೆ, ${t} ನಿಮಗೆ ಇಷ್ಟವಾದರೆ, ಈಗಲೇ ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ — ಪ್ರತಿದಿನ ಒಂದು ಹೊಸ ವಿಡಿಯೋ.` },
    };
    const m = SUB[lang] || SUB.en;
    const scene = { type: "outro", headline: m.h, cta: m.cta, vo: m.vo, keywords: ["subscribe youtube notification bell"] };
    const mid = Math.max(1, Math.floor(script.scenes.length / 2));
    script.scenes.splice(mid, 0, scene); // drop it into the middle
  }

  // suffix by channel (non-default) or language so videos never collide across channels
  const suffix = channel.id !== "the-inference" ? `-${channel.id}` : lang !== "en" ? `-${lang}` : "";
  const base = `${dateStr}-${slugify(pick.slug || pick.title)}${suffix}`;
  await fs.mkdir(SCRIPTS, { recursive: true });
  const scriptPath = path.join(SCRIPTS, `${base}.json`);
  await fs.writeFile(scriptPath, JSON.stringify(script, null, 2));
  await fs.writeFile(path.join(SCRIPTS, `${base}.meta.json`), JSON.stringify(meta, null, 2));

  used.push({ date: dateStr, pillar: pillarId, slug: base, title: pick.title });
  await fs.mkdir(path.dirname(usedPath), { recursive: true });
  await fs.writeFile(usedPath, JSON.stringify(used, null, 2));

  console.log(`\n✓ script: pipeline/scripts/${base}.json (${script.scenes.length} scenes)`);
  console.log(`  title: ${meta.title || pick.title}`);

  if (doRender) {
    // Short → vertical AINewsShort comp + .short artifacts; long-form → 16:9 AINews.
    const comp = doShort ? "AINewsShort" : "AINews";
    const outName = doShort ? `${base}.short.mp4` : `${base}.mp4`;
    const propsFile = path.join(ROOT, "out", doShort ? `${base}.short.props.json` : `${base}.props.json`);
    const buildArgs = doShort ? ` "${propsFile}" --base=${base}.short --captions` : "";

    console.log(`\n④ building ${doShort ? "short " : ""}voiceover + B-roll…`);
    execSync(`node pipeline/build.mjs "${scriptPath}"${buildArgs}`, { cwd: ROOT, stdio: "inherit" });
    console.log(`\n④ rendering ${doShort ? "Short (9:16)" : "video"}…`);
    const renderCmd = `npx remotion render ${comp} out/${outName} --props=out/${path.basename(propsFile)}`;
    try {
      // footage present → force single worker (multi-worker video decoding
      // crashes the Windows compositor). The graphics-only fallback below uses
      // the faster config concurrency.
      execSync(`${renderCmd} --concurrency=1`, { cwd: ROOT, stdio: "inherit" });
    } catch {
      // B-roll video decoding can crash the Windows compositor. Never lose the
      // video over it: strip footage and re-render graphics-only (rock solid).
      console.warn("\n⚠ render failed (likely B-roll/compositor) — retrying graphics-only…");
      const props = JSON.parse(await fs.readFile(propsFile, "utf8"));
      props.scenes.forEach((s) => {
        delete s.broll;
        delete s.bgImage;
      });
      await fs.writeFile(propsFile, JSON.stringify(props, null, 2));
      execSync(renderCmd, { cwd: ROOT, stdio: "inherit" });
    }
    console.log(`\n✓ done: out/${outName}`);

    if (doUpload) {
      // --at schedules a public release at peak time; else use the channel's privacy
      const atFlag = publishAt ? ` --at=${publishAt}` : "";
      const privacyFlag = publishAt ? "" : channel.privacy === "public" ? " --public" : channel.privacy === "unlisted" ? " --unlisted" : "";
      console.log(`\n⑤ uploading ${doShort ? "Short " : ""}to YouTube (${publishAt ? `scheduled ${publishAt}` : channel.privacy || "private"})…`);
      execSync(`node pipeline/publish.mjs "${base}"${doShort ? " --short" : ""} --channel=${channel.id}${privacyFlag}${atFlag}`, { cwd: ROOT, stdio: "inherit" });
    }
  } else {
    console.log(`\n  Next: npm run vo pipeline/scripts/${base}.json  &&  npx remotion render AINews out/${base}.mp4 --props=out/${base}.props.json`);
  }
}

main().catch((e) => {
  console.error("Agent failed:", e.message);
  process.exit(1);
});
