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
import { hasGemini, geminiTranslate, geminiNarrative, storyPersona, psychPersona, geminiQuiz, geminiJobs, geminiJobsRoadmap, geminiSchemes, geminiDramaConcept, geminiDramaEpisode } from "./gemini.mjs";
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

// JOB factor categories (niche "jobs") — govtjob is the PRIORITY track (a fresh
// real notification beats everything); the other two are the daily fallback so
// the channel never goes dark when no new government notification exists.
const JOB_CATS = {
  govtjob: {
    topicTag: "Govt Job",
    onScreenTag: "ಸರ್ಕಾರಿ ಉದ್ಯೋಗ",
    discover: "Karnataka government job recruitment notification apply online last date vacancies OR central government SSC UPSC railway banking recruitment notification apply online",
    guidance: "A REAL, currently-open government job notification relevant to Karnataka job seekers — Karnataka state govt (district courts, KPSC, KEA, banking, police, teachers, PSUs) OR central govt open to Karnataka applicants (SSC, UPSC, Railways/RRB, IBPS/SBI, central PSUs). The channel's core focus is Karnataka state govt and central govt jobs specifically.",
  },
  // Fallback when none of the tracks above yield a verified LIVE notification —
  // an evergreen "how to get this job" prep guide instead of skipping the day.
  roadmap: {
    topicTag: "Job Roadmap",
    onScreenTag: "ಹುದ್ದೆ ಮಾರ್ಗದರ್ಶಿ",
    guidance: "An evergreen preparation roadmap for a specific, well-known Karnataka state or central government job/exam — eligibility, typical notification season, exam pattern, syllabus highlights, and trusted preparation resources.",
  },
};

// Fixed rotation of well-known Karnataka + central govt job/exam categories used
// for the "roadmap" fallback track (JOB_CATS.roadmap) — the channel's core focus
// per user direction: Karnataka state govt and central govt jobs.
const ROADMAP_TARGETS = [
  { id: "kpsc-kas", title: "KPSC KAS (Gazetted Probationers) Recruitment", queries: ["KPSC KAS Gazetted Probationers eligibility age limit exam pattern syllabus", "KPSC KAS exam previous notification dates months", "KPSC KAS preparation study material previous papers official"] },
  { id: "karnataka-psi", title: "Karnataka Police Sub-Inspector (PSI) Recruitment", queries: ["Karnataka PSI recruitment eligibility physical exam pattern syllabus", "Karnataka PSI KEA previous notification dates months", "Karnataka PSI preparation study material previous papers official"] },
  { id: "karnataka-pc", title: "Karnataka Police Constable (PC) Recruitment", queries: ["Karnataka Police Constable recruitment eligibility physical exam pattern syllabus", "Karnataka Police Constable KSP previous notification dates months", "Karnataka Police Constable preparation study material official"] },
  { id: "kea-fda-sda", title: "Karnataka FDA/SDA (First & Second Division Assistant) Recruitment", queries: ["Karnataka FDA SDA recruitment KEA eligibility exam pattern syllabus", "Karnataka FDA SDA previous notification dates months", "Karnataka FDA SDA preparation study material official"] },
  { id: "karnataka-teacher", title: "Karnataka Government Teacher (TET/CET) Recruitment", queries: ["Karnataka government teacher recruitment TET CET eligibility exam pattern syllabus", "Karnataka teacher recruitment previous notification dates months", "Karnataka TET CET preparation study material official"] },
  { id: "ssc-cgl", title: "SSC CGL (Combined Graduate Level) Recruitment", queries: ["SSC CGL eligibility age limit exam pattern syllabus tiers", "SSC CGL previous notification dates months calendar", "SSC CGL preparation study material previous papers official"] },
  { id: "upsc-cse", title: "UPSC Civil Services Examination", queries: ["UPSC Civil Services Examination eligibility age limit exam pattern syllabus", "UPSC CSE previous notification dates months calendar", "UPSC CSE preparation study material previous papers official"] },
  { id: "ibps-po", title: "IBPS PO/Clerk Bank Recruitment", queries: ["IBPS PO Clerk eligibility age limit exam pattern syllabus", "IBPS PO Clerk previous notification dates months calendar", "IBPS PO Clerk preparation study material previous papers official"] },
  { id: "rrb-ntpc", title: "RRB NTPC Railway Recruitment", queries: ["RRB NTPC eligibility age limit exam pattern syllabus", "RRB NTPC previous notification dates months calendar", "RRB NTPC preparation study material previous papers official"] },
];

// Mechanical near-duplicate guard for the jobs picker — a plain-text "already
// covered" list handed to an LLM is not reliable enough on its own: the same
// real notification got picked on consecutive days twice (once reworded
// slightly, e.g. "...233 Group-C Posts" vs "...233 Posts"). This is a cheap
// token-overlap pre-check that runs BEFORE spending research/write calls on a
// candidate, catching near-identical rewordings the picker missed. It's a
// safety net alongside (not a replacement for) the picker's own instruction
// and the writer's independent DUPLICATE gate.
const TITLE_STOPWORDS = new Set(["recruitment", "post", "posts", "apply", "online", "notification", "job", "jobs", "group", "for", "the", "and", "vacancy", "vacancies", "in", "of", "at", "to", "last", "date", "govt", "government", "karnataka"]);
function titleTokens(title) {
  return new Set(
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t && !TITLE_STOPWORDS.has(t) && !/^\d{4}$/.test(t)),
  );
}
function titleSimilarity(a, b) {
  const ta = titleTokens(a), tb = titleTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

// SCHEME factor (niche "schemes") — fixed rotation of well-known Karnataka +
// central govt welfare schemes. Karnataka's five guarantees first (broadest,
// most-searched reach), then Karnataka sector schemes, then major central
// schemes. Kept intentionally large (20 real, verifiable schemes) so a true
// round-robin (see runSchemes' lastUsedAt sort) rarely repeats the same
// scheme within a stretch of daily uploads. Each entry researched fresh every
// time (schemes can be revised/discontinued) — see geminiSchemes' "STILL
// ACTIVE" reject gate. The 3rd query per target is anchored to the scheme's
// official portal domain (not a generic blog) to bias research toward
// authoritative sources — the single biggest lever against wrong info, since
// low-quality SEO scheme-info sites are a known source of stale/wrong figures.
const SCHEME_TARGETS = [
  { id: "gruha-lakshmi", title: "Karnataka Gruha Lakshmi Scheme", queries: ["Gruha Lakshmi scheme eligibility documents how to apply", "Gruha Lakshmi scheme current status 2026 active benefit amount", "Gruha Lakshmi scheme site:sevasindhu.karnataka.gov.in OR site:karnataka.gov.in"] },
  { id: "anna-bhagya", title: "Karnataka Anna Bhagya Scheme", queries: ["Anna Bhagya scheme eligibility documents how to apply", "Anna Bhagya scheme current status 2026 active rice quota amount", "Anna Bhagya scheme site:ahara.kar.nic.in OR site:karnataka.gov.in"] },
  { id: "gruha-jyothi", title: "Karnataka Gruha Jyothi Scheme", queries: ["Gruha Jyothi scheme eligibility documents how to apply", "Gruha Jyothi scheme current status 2026 active free units amount", "Gruha Jyothi scheme site:sevasindhu.karnataka.gov.in OR site:karnataka.gov.in"] },
  { id: "yuva-nidhi", title: "Karnataka Yuva Nidhi Scheme", queries: ["Yuva Nidhi scheme eligibility documents how to apply", "Yuva Nidhi scheme current status 2026 active allowance amount", "Yuva Nidhi scheme site:sevasindhu.karnataka.gov.in OR site:karnataka.gov.in"] },
  { id: "shakti", title: "Karnataka Shakti Scheme (free bus travel)", queries: ["Shakti scheme eligibility documents how to apply", "Shakti scheme current status 2026 active free bus travel women", "Shakti scheme site:karnataka.gov.in OR site:ksrtc.in OR site:sevasindhu.karnataka.gov.in"] },
  { id: "karnataka-scholarship", title: "Karnataka Pre/Post-Matric Scholarship (State Scholarship Portal)", queries: ["Karnataka pre-matric post-matric scholarship eligibility documents how to apply", "Karnataka scholarship 2026 last date active status", "Karnataka scholarship site:ssp.karnataka.gov.in"] },
  { id: "krishi-bhagya", title: "Karnataka Krishi Bhagya Yojana (farmer irrigation subsidy)", queries: ["Krishi Bhagya Yojana eligibility documents how to apply farm pond subsidy", "Krishi Bhagya Yojana 2026 current status active subsidy amount", "Krishi Bhagya Yojana site:raitamitra.karnataka.gov.in OR site:karnataka.gov.in"] },
  { id: "sandhya-suraksha", title: "Karnataka Sandhya Suraksha Old-Age Pension Scheme", queries: ["Sandhya Suraksha pension scheme eligibility documents how to apply", "Sandhya Suraksha pension 2026 current status active amount", "Sandhya Suraksha pension site:karnataka.gov.in OR site:sevasindhu.karnataka.gov.in"] },
  { id: "karnataka-widow-pension", title: "Karnataka Vidhava Vetana (Widow Pension) Scheme", queries: ["Karnataka widow pension Vidhava Vetana eligibility documents how to apply", "Karnataka widow pension 2026 current status active amount", "Karnataka widow pension site:karnataka.gov.in OR site:sevasindhu.karnataka.gov.in"] },
  { id: "karnataka-disability-pension", title: "Karnataka Disability Pension Scheme", queries: ["Karnataka disability pension eligibility documents how to apply", "Karnataka disability pension 2026 current status active amount", "Karnataka disability pension site:karnataka.gov.in OR site:sevasindhu.karnataka.gov.in"] },
  { id: "pm-kisan", title: "PM-Kisan Samman Nidhi (central scheme)", queries: ["PM Kisan Samman Nidhi eligibility documents how to apply", "PM Kisan scheme current status 2026 active installment amount", "PM Kisan scheme site:pmkisan.gov.in"] },
  { id: "ayushman-bharat", title: "Ayushman Bharat PM-JAY Health Scheme (central scheme)", queries: ["Ayushman Bharat PM-JAY eligibility documents how to apply", "Ayushman Bharat scheme current status 2026 active coverage amount", "Ayushman Bharat site:pmjay.gov.in OR site:nha.gov.in"] },
  { id: "pmay", title: "PM Awas Yojana Housing Scheme (central scheme)", queries: ["PM Awas Yojana eligibility documents how to apply", "PM Awas Yojana scheme current status 2026 active subsidy amount", "PM Awas Yojana site:pmaymis.gov.in OR site:pmayg.nic.in"] },
  { id: "ujjwala", title: "PM Ujjwala Yojana LPG Scheme (central scheme)", queries: ["PM Ujjwala Yojana eligibility documents how to apply", "Ujjwala Yojana scheme current status 2026 active subsidy amount", "Ujjwala Yojana site:pmuy.gov.in"] },
  { id: "atal-pension-yojana", title: "Atal Pension Yojana (central scheme)", queries: ["Atal Pension Yojana eligibility documents how to apply", "Atal Pension Yojana 2026 current status active pension amount", "Atal Pension Yojana site:npscra.nsdl.co.in OR site:pfrda.org.in"] },
  { id: "pmfby", title: "Pradhan Mantri Fasal Bima Yojana (crop insurance, central scheme)", queries: ["Pradhan Mantri Fasal Bima Yojana eligibility documents how to apply", "PMFBY crop insurance 2026 current status active premium coverage", "PMFBY site:pmfby.gov.in"] },
  { id: "pmegp", title: "PMEGP — Prime Minister's Employment Generation Programme (central scheme)", queries: ["PMEGP eligibility documents how to apply subsidy", "PMEGP scheme 2026 current status active subsidy amount", "PMEGP site:kviconline.gov.in OR site:pmegp.gov.in"] },
  { id: "pm-mudra", title: "PM Mudra Yojana (business loans, central scheme)", queries: ["PM Mudra Yojana eligibility documents how to apply loan limit", "PM Mudra Yojana 2026 current status active loan categories", "PM Mudra Yojana site:mudra.org.in"] },
  { id: "pm-svanidhi", title: "PM SVANidhi (street vendor micro-credit, central scheme)", queries: ["PM SVANidhi eligibility documents how to apply loan amount", "PM SVANidhi scheme 2026 current status active loan tiers", "PM SVANidhi site:pmsvanidhi.mohua.gov.in"] },
  { id: "pmjjby-pmsby", title: "PM Jeevan Jyoti Bima & Suraksha Bima Yojana (insurance, central scheme)", queries: ["PM Jeevan Jyoti Bima Suraksha Bima Yojana eligibility documents how to apply premium", "PMJJBY PMSBY 2026 current status active premium coverage amount", "PMJJBY PMSBY site:jansuraksha.gov.in"] },
];

// Serialized Hindi micro-drama tropes (niche "drama") — one series (~6 parts,
// one part/day) per trope, rotating. The proven Pocket FM / KukuFM formulas.
const DRAMA_TROPES = {
  secretrich: { topicTag: "Secret Rich", guidance: "A hidden billionaire/CEO living as ordinary (waiter, driver, 'poor' spouse) is humiliated by people who don't know who they are — the audience knows. Escalating disrespect → devastating reveal → power reversal." },
  revenge: { topicTag: "Revenge", guidance: "Someone betrayed, cheated or left for dead returns — richer, stronger, unrecognizable — to systematically take everything back from those who destroyed them." },
  contractmarriage: { topicTag: "Contract Marriage", guidance: "A fake/contract marriage between strangers with opposing agendas slowly turns real — while a secret one of them is hiding threatens to burn it all down." },
  betrayal: { topicTag: "Betrayal", guidance: "The person they trusted most — spouse, best friend, sibling — has been lying all along. The discovery, the gaslighting, and the quiet plan to turn the tables." },
  underestimated: { topicTag: "Underestimated", guidance: "The 'useless' one everyone mocks — the ghar-jamai, the dropout, the plain sister — is secretly extraordinary, and circumstances force the reveal one layer at a time." },
};
const DRAMA_ORDER = ["secretrich", "revenge", "contractmarriage", "betrayal", "underestimated"];

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

// Shared "no vague filler" contract, included in every English news/trend/business
// spec — this is what separates a real US/UK-style breakdown from generic AI hype.
const SPECIFICITY_RULES = `
SPECIFICITY (non-negotiable — this is what separates a real breakdown from vague hype):
- EVERY beat must state at least one CONCRETE fact from the research notes: a real number, date, name, company, price, or step in a mechanism. A beat with no concrete fact is not allowed — cut it or find the fact.
- BANNED vague filler — in the "vo", AND in meta.title/meta.description (never write these or close equivalents, including other forms of the same word): "game changer", "revolution/revolutionize/revolutionary", "changes everything", "the future of X", "next level", "this could be huge", "mind-blowing", "insane"/"crazy" used as filler, "a lot of people are saying", "some experts believe" (name the expert or drop the line).
- NEVER leave a placeholder/template artifact in the output (e.g. "[Link to Video]", "[insert X]", "TBD") — every field must be the real, finished content.
- If the research notes don't support a specific claim, say so plainly ("it's not clear yet whether...") instead of padding with hype.
- NEVER invent a mechanism, architecture, or technical detail that isn't in the notes. If the notes don't explain HOW something works, say plainly that the detail isn't public yet — do not guess and present it as fact (not even hedged in a parenthetical).
- Name real people, companies, products, and numbers wherever the research gives them. Generic phrasing ("a major company", "new technology") is a failure.
- NEVER let the "vo" simply restate or narrate the on-screen heading/bullets. Each "vo" must ADD something the viewer cannot read on screen — context, reaction, implication, or a real-world hook. If the "vo" starts with the same words as the heading ("Why This Is Happening:", "What it actually is:"), delete that preface and cut straight to the substance.
- BANNED corporate/press-release language — words and phrases that make the script sound like a company announcement or consulting memo: "paradigm shift", "leverage", "transformative", "embark on", "get ready for a [noun] where", "one question remains", "landscape", "ecosystem", "revolutionize", "game-changing", "on the horizon", "the future of [noun]", "we're witnessing", "as we move into". If a sentence sounds like it could appear in a press release or a McKinsey report, rewrite it as one human telling another something interesting.
- WORD CHOICE drives vocal energy — the TTS voice conveys attitude through individual words, not just sentence structure. Use sharp, opinionated vocabulary that an intense young speaker would naturally say: "actually", "honestly", "literally", "barely", "somehow", "genuinely", "wild", "terrifyingly", "barely", "genius move", "dumb take", "here's the thing", "so here's why". Avoid passive, formal, or neutral words ("it is believed", "one might consider", "it appears that"). Every word should feel like it came out of a real person's mouth.
`;

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

VOICE & VIBE — sound like a top tech YouTuber, NOT a news anchor or press release:
- Talk straight to ONE viewer ("you", "here's the thing", "okay so real quick"). Fast, opinionated, has a clear take on every topic — MKBHD / Fireship energy: clever, confident, never dry or corporate.
- Every scene must answer or imply "so what does this mean for YOU?" — make the viewer feel personally addressed.
- The HOOK decides everything. Open on a bold claim, a "wait, what?" twist, a spicy question, or a jaw-drop number that stops the scroll. NEVER open with "Today we'll look at…", "In this video", or "Let's talk about".
- Have a real take; add attitude. Even "honestly, this is overhyped" or "this is a bigger deal than it sounds" gives the viewer a reason to care.
- Use curiosity gaps between beats to pull them forward ("but here's where it gets interesting…", "and that's not even the wild part").
- Hype the DELIVERY, not fake facts — stay accurate and substantive.
- WORD CHOICE is everything — the voice carries energy through individual words, not sentence length. Use vocabulary that sounds like it came from an intense, smart young person: "literally", "honestly", "barely", "somehow", "actually", "wild", "genius move", "dumb", "terrifyingly". Every word should feel spoken, not written.

RULES:
- Start with "hook", end with "outro".
- Put numbers in "stat"/"bars". Add "keywords" (2-3 visual B-roll search terms) ONLY to hook/point/quote/tool/outro; NOT to stat/bars/headlines/compare (those are clean graphics).
- Wrap the 1-2 most important words per text line in **double asterisks** to highlight them.
- PACING (critical): each "vo" is ONE short, punchy sentence — MAX ~16 words. Never write 2-3 long sentences in one scene; split into more scenes instead. Aim for fast 4-7 second beats. More short scenes beats fewer long ones.
- "vo" is spoken narration: natural, energetic, spell acronyms phonetically ("A-I","I-P-O","C-E-O").
- Never let the "vo" simply restate the on-screen heading or bullets. Each "vo" must ADD something the viewer cannot read on screen.
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

VOICE & VIBE — this is a scroll-stopping Short from a viral tech creator:
- AGGRESSIVE pacing — first word must be the biggest number or boldest claim, zero setup, zero context. Fast, confident, talking straight to the viewer ("you"). Opinionated, never a robotic news read.
- First 1-2 seconds = make-or-break. Open on the BIGGEST number or most surprising fact — no greeting, no "so", no "welcome". NEVER a slow "In this video…" intro.
- Keep a curiosity gap so they watch to the end; the outro lands the payoff + a reason to follow.

${SPECIFICITY_RULES}
RULES:
- EXACTLY 4-5 scenes. Start with "hook", end with "outro"; 2-3 stat/point scenes between.
- TOTAL spoken time ~25-35 seconds. Each "vo" is ONE punchy sentence, MAX ~12 words.
- The HOOK must grab attention in the first 2 seconds — bold claim, number, or question.
- Wrap the 1-2 most important words per line in **double asterisks**.
- "vo" is spoken narration: energetic, acronyms phonetic ("A-I","I-P-O","C-E-O"). Never restate the on-screen heading in the "vo".
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
${SPECIFICITY_RULES}
WRITING:
- "vo" is spoken: sharp, fast, opinionated — like an expert who knows it deeply and gives you the honest take. 1-2 punchy sentences per scene. TOTAL narration ~280-380 words (tighter = better).
- NEVER say "I used / I tried / I tested / when I set it up / it tripped me up" or imply hands-on use. Use explanatory framing: "Here's how it works...", "Where it struggles is...", "What makes it clever is...", "In practice, this means...".
- Every "vo" must say something the on-screen text does NOT. Never narrate the heading or bullets.
- Wrap the 1-2 most important words per line in **double asterisks**.
- Acronyms spoken phonetically ("A-I","A-P-I"). "keywords" are ENGLISH stock-footage search terms for the beat's mood.

"meta" MUST be: { "title":"<clear, curiosity-driven title, e.g. '<Tool>: how it actually works' or 'Everything you need to know about <Tool>' — NOT 'I used...'>", "description":"<2-3 honest sentences + a line of #hashtags>", "tags":[12-18 specific tags: tool name, category, 'explained','how it works','review', alternatives], "thumbnail":{"badge":"Tool Breakdown","bigText":"<3-5 punchy words>","subText":"<short>","accent":"#34D399","channelName":"${CHANNEL}"} }
`;

// BREAKING AI/TECH NEWS — written like a sharp US/UK tech news explainer: concrete
// specifics, real context, the actual mechanism behind the headline, and an honest
// skeptical beat. Never a vague "AI is changing everything" reel.
const NEWS_SPEC = `
Return ONE JSON object: { "script": {...}, "meta": {...} }.

This is a BREAKING TECH NEWS EXPLAINER — the kind a sharp US/UK tech YouTuber makes: specific, well-sourced, a little opinionated, genuinely informative. NOT a vague "AI is changing everything" reel.

"script" MUST match this shape:
{
  "channelName": "${CHANNEL}",
  "topicTag": "AI News",
  "accent": "#3B9EFF",
  "source": "<the real sources you used>",
  "voice": "en-US-AndrewNeural",
  "music": "",
  "showCaptions": false,
  "scenes": [ 9 to 12 scenes, EACH with a "vo" ]
}

Build the explainer in THIS order (every scene needs "vo" = spoken narration):
1. {"type":"hook","kicker":"AI News","headline":"<the single most surprising CONCRETE fact/number>","sub":"<one-line teaser>","keywords":["broll term"]}
2. {"type":"point","heading":"What just happened","bullets":["<who did what, when, the key number(s)>"],"keywords":["broll term"]}  — the concrete news, no fluff
3. {"type":"point","heading":"Why now","bullets":["<what led here / the context a viewer needs>"],"keywords":["broll term"]}
4. {"type":"point","heading":"How it actually works","bullets":["<the real mechanism/technical detail behind the news>"],"keywords":["broll term"]}  — the CORE beat: prove you understand the tech, not just the headline
5. {"type":"stat","value":"<a real number from the notes>","label":"<what it means in plain terms>","source":"..."}
6. {"type":"point","heading":"Why it matters","bullets":["<a concrete implication for users/devs/the industry>"],"keywords":["broll term"]}
7. {"type":"point","heading":"The catch","bullets":["<what's unproven, disputed, or the honest limitation>"],"keywords":["broll term"]}  — MANDATORY: a real skeptical beat, not blind hype
8. {"type":"quote","quote":"<a real quote from a source in the notes>","attribution":"<who>","keywords":["broll term"]}  — OMIT this scene entirely if the notes have no real quote
9. {"type":"outro","headline":"<the one-line takeaway>","cta":"Subscribe to ${CHANNEL}","keywords":["broll term"]}
${SPECIFICITY_RULES}
VOICE & VIBE:
- Talk straight to the viewer, fast and opinionated — like a sharp tech news explainer with a take, not a press release read aloud. Every scene should imply "here's why YOU should care".
- Open on the fact — the number or the name — never "today we're talking about" or "let's dive into".
- Never narrate the heading. If your "vo" starts with "What just happened:" or "Why now:" — delete that label and just say the thing.
- WORD CHOICE drives the voice's energy. Use words an intense young speaker would actually say: "here's why", "actually", "so here's the thing", "honestly", "literally", "barely", "somehow", "wild". Avoid neutral/formal vocabulary.
- Wrap the 1-2 most important words per line in **double asterisks**.
- PACING: each "vo" is ONE short, punchy sentence — MAX ~16 words. More short scenes beats fewer long ones.
- Acronyms spoken phonetically ("A-I","I-P-O","C-E-O").

"meta" MUST be: { "title":"<clickable, SPECIFIC YouTube title using the real name/number, not generic hype>", "description":"<2-3 sentences + a line of #hashtags>", "tags":["...", 12-18 SPECIFIC tags: real names/companies/products from the video], "thumbnail":{"badge":"AI News","bigText":"<3-5 punchy words>","subText":"<short>","accent":"#3B9EFF","channelName":"${CHANNEL}"} }
`;

// TECH TREND DEEP-DIVE — documentary-style analysis (think Cleo Abram / Johnny
// Harris energy): real data across multiple points, named players, a grounded
// forecast. Never vague futurism.
const TREND_SPEC = `
Return ONE JSON object: { "script": {...}, "meta": {...} }.

This is a TECH TREND DEEP-DIVE — the kind of documentary-style explainer top US/UK tech creators make: grounded in real data, naming real companies/products, tracing WHY something is happening and WHERE it's actually heading. NOT vague futurism.

"script" MUST match this shape:
{
  "channelName": "${CHANNEL}",
  "topicTag": "Tech Trend",
  "accent": "#F43F5E",
  "source": "<the real sources you used>",
  "voice": "en-US-AndrewNeural",
  "music": "",
  "showCaptions": false,
  "scenes": [ 9 to 12 scenes, EACH with a "vo" ]
}

Build the deep-dive in THIS order (every scene needs "vo"):
1. {"type":"hook","kicker":"Tech Trend","headline":"<a striking CONCRETE data point or contrarian claim>","sub":"<one-line teaser>","keywords":["broll term"]}
2. {"type":"point","heading":"The pattern","bullets":["<what's actually changing, stated concretely>"],"keywords":["broll term"]}
3. {"type":"bars","title":"...","unit":"...","data":[{"label":"...","value":42} x3-4],"source":"..."}  — real comparative data from the notes (e.g. across years/companies)
4. {"type":"point","heading":"Why this is happening","bullets":["<the underlying driver(s), concretely>"],"keywords":["broll term"]}
5. {"type":"point","heading":"Who's leading","bullets":["<real, named companies/products and what they're doing>"],"keywords":["broll term"]}
6. {"type":"point","heading":"Where it's heading","bullets":["<a grounded near-term forecast tied to evidence in the notes>"],"keywords":["broll term"]}  — mark speculation as speculation
7. {"type":"point","heading":"What could break this","bullets":["<a real risk, headwind, or counter-argument>"],"keywords":["broll term"]}  — MANDATORY honest tension, not one-sided hype
8. {"type":"outro","headline":"<the one-line takeaway>","cta":"Subscribe to ${CHANNEL}","keywords":["broll term"]}
${SPECIFICITY_RULES}
VOICE & VIBE:
- Fast, grounded, connecting the dots for the viewer — like a documentary-style tech explainer who has a real take, not a hype reel. Every scene must imply "and here's what that means for you".
- Name real companies and real numbers. Never vague futurism ("the future of X", "on the horizon").
- Never narrate the heading. The "vo" should add insight, not echo the bullet.
- Use sharp, specific words that sound like a real person talking: "actually", "honestly", "somehow", "barely", "here's the pattern", "so here's why". No neutral/formal vocabulary.
- Wrap the 1-2 most important words per line in **double asterisks**.
- PACING: each "vo" is ONE short, punchy sentence — MAX ~16 words.
- Acronyms spoken phonetically.

"meta" MUST be: { "title":"<clickable, SPECIFIC title>", "description":"<2-3 sentences + a line of #hashtags>", "tags":["...", 12-18 SPECIFIC tags], "thumbnail":{"badge":"Tech Trend","bigText":"<3-5 punchy words>","subText":"<short>","accent":"#F43F5E","channelName":"${CHANNEL}"} }
`;

// BUSINESS/MARKET BREAKDOWN — "How Money Works"/Modern-MBA energy: lead with the
// number, explain the ACTUAL revenue mechanism, name the real risk.
const BUSINESS_SPEC = `
Return ONE JSON object: { "script": {...}, "meta": {...} }.

This is a BUSINESS BREAKDOWN — the kind top US/UK business-explainer channels make: lead with the number, explain exactly how the company/deal actually makes money, and be honest about the risk. NOT a vague "big news for the industry" reel.

"script" MUST match this shape:
{
  "channelName": "${CHANNEL}",
  "topicTag": "Business",
  "accent": "#F5B301",
  "source": "<the real sources you used>",
  "voice": "en-US-AndrewNeural",
  "music": "",
  "showCaptions": false,
  "scenes": [ 9 to 12 scenes, EACH with a "vo" ]
}

Build the breakdown in THIS order (every scene needs "vo"):
1. {"type":"hook","kicker":"Business","headline":"<the eye-catching CONCRETE number — valuation/revenue/funding/loss>","sub":"<one-line teaser>","keywords":["broll term"]}
2. {"type":"point","heading":"The business","bullets":["<what the company/deal actually does, plainly>"],"keywords":["broll term"]}
3. {"type":"stat","value":"<a real financial number>","label":"<what it means>","source":"..."}
4. {"type":"point","heading":"How they actually make money","bullets":["<the real revenue mechanism, concretely>"],"keywords":["broll term"]}  — the CORE beat: prove you understand the business model, not just the headline
5. {"type":"point","heading":"The strategy","bullets":["<why this move/deal, right now>"],"keywords":["broll term"]}
6. {"type":"bars","title":"...","unit":"...","data":[{"label":"...","value":42} x3-4],"source":"..."}  — real comparative data if the notes give one (e.g. revenue over time, competitors)
7. {"type":"point","heading":"The catch","bullets":["<the real risk, competition, or sustainability concern>"],"keywords":["broll term"]}  — MANDATORY honest tension
8. {"type":"point","heading":"What's next","bullets":["<a concrete, grounded next step>"],"keywords":["broll term"]}
9. {"type":"outro","headline":"<the one-line takeaway>","cta":"Subscribe to ${CHANNEL}","keywords":["broll term"]}
${SPECIFICITY_RULES}
VOICE & VIBE:
- Sharp, skeptical, numbers-first, opinionated — like a business-explainer creator who actually gets finance, not a press release. Every scene should make the viewer feel smarter about where the money actually goes.
- Never narrate the heading. The "vo" must reveal the mechanism or the risk that the on-screen text only labels.
- Use words that sound like a sharp analyst talking to a friend: "so here's how they actually make money", "the catch?", "honestly", "barely", "here's the real number". No corporate/neutral phrasing.
- Wrap the 1-2 most important words per line in **double asterisks**.
- PACING: each "vo" is ONE short, punchy sentence — MAX ~16 words.
- Acronyms spoken phonetically.

"meta" MUST be: { "title":"<clickable, SPECIFIC title using the real name/number>", "description":"<2-3 sentences + a line of #hashtags>", "tags":["...", 12-18 SPECIFIC tags], "thumbnail":{"badge":"Business","bigText":"<3-5 punchy words>","subText":"<short>","accent":"#F5B301","channelName":"${CHANNEL}"} }
`;

// which long-form spec each English pillar uses (falls back to the generic
// SCRIPT_SPEC for any pillar not listed here)
const SPEC_FOR_PILLAR = { tools: TOOLS_SPEC, ainews: NEWS_SPEC, trend: TREND_SPEC, business: BUSINESS_SPEC };

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
  const subscribeText = `New here? Subscribe to ${channelName} for current affairs & GK quizzes.`;
  const ANSWER_SECONDS = 7; // seconds to answer each question (countdown)
  const REVEAL_SECONDS = 4; // seconds to see the correct answer before the next question
  const mkProps = (qs) => ({ title: "Current Affairs & GK Quiz", date: human, channelName, accent, subscribeText, music, tick, ding, answerSeconds: ANSWER_SECONDS, revealSeconds: REVEAL_SECONDS, questions: qs });

  const meta = {
    title: `Current Affairs & GK Quiz - ${human} | Monthly Current Affairs for UPSC SSC Banking`,
    description: `Current affairs & GK quiz covering this month's important news plus static GK, for competitive exams (UPSC, SSC, Banking, Railways). ${longQs.length} questions, ${ANSWER_SECONDS} seconds each - comment your score!\n\n#currentaffairs #gk #quiz #upsc #ssc #monthlycurrentaffairs`,
    tags: ["current affairs", "current affairs quiz", "monthly current affairs", "current affairs compilation", "gk quiz", "gk mcq", "general knowledge", "upsc", "ssc", "banking exam", "railway exam", "competitive exams", "today current affairs", "quiz"],
    categoryId: "27",
    thumbnail: { badge: "QUIZ", bigText: "Current Affairs & GK", subText: `${human} · ${longQs.length} Questions`, accent, channelName },
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

/** JOB factor pipeline (niche "jobs") — priority govt-notification track with a
 *  private-job / exam-info fallback so the channel uploads every day. Renders the
 *  "Jobs" slide-deck composition (no B-roll — pure info graphics). HIGH-STAKES
 *  accuracy: refuses to write when the notification can't be researched. */
async function runJobs({ channel, channelName, dateStr, doRender, doUpload, publishAt, topic }) {
  console.log(`Agent: Jobs  |  ${channelName}  |  ${dateStr}`);
  const usedPath = channelUsedTopicsPath(channel.id);
  const used = await loadUsed(usedPath);
  const covered = used.slice(-40).map((u) => u.title);

  // ① DISCOVER → ② RESEARCH → ③ WRITE, tried per track. The WRITER can reject
  // a candidate post-research (wrong state, already closed, confused/blended
  // sources, duplicate) — on reject, fall through to the NEXT track rather
  // than publishing bad content. Private-sector jobs are OUT of scope
  // entirely (not just deprioritized) — mixing them in dilutes the channel's
  // single govt-jobs identity for YouTube's recommendation algorithm; the
  // roadmap fallback below is the only thing that runs when govtjob is dry.
  const tracks = ["govtjob"];
  let pick = null, cat = null, script = null, meta = null;
  for (const id of tracks) {
    const c = JOB_CATS[id];
    console.log(`① searching ${id}…`);
    const hits = await search(topic || c.discover, 10);
    const candidates = hits.map((h, i) => `${i + 1}. ${h.title} — ${h.url}`).join("\n");
    if (!candidates) {
      console.log(`   no search results for ${id} — trying next track`);
      continue;
    }
    let candidatePick;
    try {
      const out = await chatJSON(
        [
          { role: "system", content: `Today's date is ${dateStr}. You screen job/exam notifications for a Karnataka job-alert channel. Only pick REAL, CURRENT, specific postings whose application window is CONFIRMED still open as of today — never expired, never vague listicles. Reply JSON only.` },
          {
            role: "user",
            content: `TODAY IS ${dateStr}. Category: ${c.guidance}\n\nSearch results:\n${candidates}\n\nAlready covered (NEVER repeat — this includes picking a DIFFERENT post-category from the SAME parent recruitment drive/department as anything listed here, e.g. if "KEA Group C Recruitment" is covered, do NOT pick "KEA Group C — Agriculture Officer posts" as if it were new; treat any sub-post of an already-covered drive as covered too):\n${covered.join("\n") || "(none)"}\n\nPick ONE notification that is (a) real and specific, (b) NOT the same notification OR the same parent recruitment drive as anything in the covered list, (c) whose application/exam deadline you can reasonably infer is ON OR AFTER ${dateStr} — if a result clearly states a past deadline, or if you cannot tell whether it's still open, SKIP it and pick a different one. Be especially wary of "admit card"/"hall ticket" results — these pages stay indexed forever after the exam is long over, so an admit-card headline is NOT evidence the exam is still upcoming; only pick one if you can also tell the exam date itself is still ahead. The title MUST name a notification that actually appears in the search results above — copy its name from the results; NEVER invent one. If none qualifies, return {"found":false}.\nReply JSON: {"found":true,"slug":"kebab-slug","title":"<the notification's official English name, taken from the search results>","official":"<official website or url if visible>","queries":["3-4 web searches to get the FULL notification details: posts, vacancies, eligibility, dates, fee, how to apply — including at least one query specifically targeting the CURRENT status/exam date/result date (e.g. '<title> exam date 2026' or '<title> result') so the deadline/date can be verified as on or after ${dateStr}, not just that the notification once existed"]}`,
          },
        ],
        { maxTokens: 1200 },
      );
      if (!out || out.found === false || !out.title) {
        console.log(`   no fresh ${id} pick — trying next track`);
        continue;
      }
      candidatePick = out;
    } catch (e) {
      console.warn(`   ${id} pick failed (${e.message}) — trying next track`);
      continue;
    }
    console.log(`   topic [${id}]: ${candidatePick.title}`);

    // MECHANICAL near-duplicate guard — see titleSimilarity() note above.
    const nearDup = covered.find((c) => titleSimilarity(candidatePick.title, c) >= 0.6);
    if (nearDup) {
      console.log(`   picker chose a near-duplicate of an already-covered notification ("${nearDup}") — skipping without spending a research call, trying next track`);
      continue;
    }

    // RESEARCH — the notification details are the entire video; refuse to write blind.
    console.log("② researching the notification…");
    const notes = [];
    for (const q of (candidatePick.queries || [candidatePick.title]).slice(0, 4)) {
      const res = await search(q, 4);
      for (const r of res.slice(0, 2)) {
        const body = r.content || (await fetchText(r.url, 2500));
        if (body) notes.push(`SOURCE: ${r.title} (${r.url})\n${body.slice(0, 2200)}`);
      }
    }
    if (!notes.length) {
      console.log(`   no sources found for ${id} — trying next track`);
      continue;
    }
    console.log(`   gathered ${notes.length} sources`);

    // WRITE — Gemini writes the Kannada slide deck, grounded in the notification.
    // May reject post-research (wrong state / already closed / confused sources).
    console.log("③ writing the Kannada job report with Gemini…");
    let out;
    try {
      out = await geminiJobs({ facts: notes.join("\n\n---\n\n"), category: c, channelName, sourceUrl: candidatePick.official || "", todayStr: dateStr, covered });
    } catch (e) {
      console.warn(`   ${id} write failed (${e.message}) — trying next track`);
      continue;
    }
    if (out.reject) {
      console.log(`   ${id} rejected post-research (${out.reason}) — trying next track`);
      continue;
    }
    pick = candidatePick;
    cat = { id, ...c };
    script = out.script;
    meta = out.meta;
    break;
  }

  // ROADMAP FALLBACK — no live, verified notification survived any track today.
  // Rather than skip the day entirely, publish an evergreen "how to get this
  // job" prep guide for a Karnataka/central govt job the channel hasn't
  // recently covered, rotating through ROADMAP_TARGETS.
  if ((!pick || !script) && !topic) {
    console.log("① no live notification found — falling back to a roadmap guide…");
    const usedRoadmapIds = new Set(used.filter((u) => u.pillar === "roadmap" && u.roadmapId).slice(-ROADMAP_TARGETS.length + 2).map((u) => u.roadmapId));
    const target = ROADMAP_TARGETS.find((t) => !usedRoadmapIds.has(t.id)) || ROADMAP_TARGETS[Math.floor(Date.now() / 864e5) % ROADMAP_TARGETS.length];
    console.log(`   roadmap topic: ${target.title}`);
    console.log("② researching…");
    const notes = [];
    for (const q of target.queries) {
      const res = await search(q, 4);
      for (const r of res.slice(0, 2)) {
        const body = r.content || (await fetchText(r.url, 2500));
        if (body) notes.push(`SOURCE: ${r.title} (${r.url})\n${body.slice(0, 2200)}`);
      }
    }
    if (notes.length) {
      console.log(`   gathered ${notes.length} sources`);
      console.log("③ writing the Kannada roadmap guide with Gemini…");
      try {
        const out = await geminiJobsRoadmap({ facts: notes.join("\n\n---\n\n"), target, channelName, todayStr: dateStr });
        if (out.reject) {
          console.log(`   roadmap rejected (${out.reason})`);
        } else {
          pick = { slug: `roadmap-${target.id}`, title: out.meta?.title || target.title, official: "", roadmapId: target.id };
          cat = { id: "roadmap", ...JOB_CATS.roadmap };
          script = out.script;
          meta = out.meta;
        }
      } catch (e) {
        console.warn(`   roadmap write failed (${e.message})`);
      }
    } else {
      console.log("   no sources found for roadmap topic either");
    }
  }

  if (!pick || !script) throw new Error("no usable, verified job/exam topic found today (all tracks empty or rejected, roadmap fallback also failed)");

  // enforce invariants
  script.channelName = channelName;
  script.title = script.title || pick.title;
  script.topicTag = cat.onScreenTag;
  script.accent = "#D9A514";
  script.template = "jobs";
  script.lang = "kn";
  // logo only if the file actually exists — a missing image would 404 in the
  // renderer and CANCEL the whole render (Remotion <Img> retries then aborts).
  script.logo = "";
  if (channel.logo) {
    const logoAbs = path.join(ROOT, "public", channel.logo);
    if (await fs.access(logoAbs).then(() => true).catch(() => false)) script.logo = channel.logo;
    else console.warn(`   ⚠ logo not found (public/${channel.logo}) — rendering without it`);
  }
  script.music = "";
  script.showCaptions = false;
  if ((channel.engine || "") === "cartesia") {
    script.engine = "cartesia";
    script.voice = channel.cartesiaVoice || ""; // "" = auto-resolve the account's clone
    script.fallbackVoice = channel.voice || "kn-IN-GaganNeural";
  } else {
    script.engine = "edge";
    script.voice = channel.voice || "kn-IN-GaganNeural";
  }
  const KNOWN_JOB_SCENES = new Set(["introCard", "table", "facts", "outro"]);
  script.scenes = (Array.isArray(script.scenes) ? script.scenes : []).filter((s) => s && KNOWN_JOB_SCENES.has(s.type));
  // the channel's signature sign-off — used whenever the model leaves the outro
  // vo empty (falling back to the headline made videos end mid-thought)
  const OUTRO_VO =
    "ವಿಡಿಯೋವನ್ನ ಪೂರ್ತಿಯಾಗಿ ನೋಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ಇನ್ನು ನಮ್ಮ ಚಾನೆಲ್‌ಗೆ ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಆಗಿಲ್ಲ ಅಂದ್ರೆ ಈಗಲೇ ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ, ಪಕ್ಕದಲ್ಲಿರುವ ಬೆಲ್ ಐಕಾನ್ ಪ್ರೆಸ್ ಮಾಡಿ. ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಅಧಿಕೃತ ವೆಬ್‌ಸೈಟ್‌ನಲ್ಲಿ ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ. ಥ್ಯಾಂಕ್ ಯು.";
  script.scenes.forEach((s) => {
    if (!s.vo || !String(s.vo).trim()) s.vo = s.type === "outro" ? OUTRO_VO : s.heading || s.title || s.headline || "";
  });
  // guarantee the video always closes properly
  if (!script.scenes.some((s) => s.type === "outro")) {
    script.scenes.push({ type: "outro", headline: script.title || "", cta: `${channelName} ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ`, disclaimer: "ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಅಧಿಕೃತ ವೆಬ್‌ಸೈಟ್‌ನಲ್ಲಿ ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ", vo: OUTRO_VO });
  }
  if (script.scenes.length < 3) throw new Error("Gemini returned too few usable slides");
  if (!script.scenes[0].title) script.scenes[0].title = script.title;

  meta.channel = channel.id;
  meta.lang = "kn";
  meta.categoryId = "27"; // Education — the standard category for job/exam info channels
  if (!meta.title) meta.title = pick.title;
  // the channel's evergreen generic tags (same set the original videos always used),
  // merged in front of the notification-specific ones, deduped, capped ~480 chars
  {
    const GENERIC = ["kannada", "karnataka", "karnataka jobs", "kannada jobs", "kannada job news", "10th pass job", "govt jobs karnataka", "government jobs", "sarkari naukri", "free job alert", "ಸರ್ಕಾರಿ ಉದ್ಯೋಗ", "ಉದ್ಯೋಗ ಮಾಹಿತಿ", "ಕನ್ನಡ"];
    const seen = new Set();
    const merged = [];
    for (const t of [...GENERIC, ...(Array.isArray(meta.tags) ? meta.tags : [])]) {
      const tt = String(t).trim();
      const k = tt.toLowerCase();
      if (tt && !seen.has(k)) {
        seen.add(k);
        merged.push(tt);
      }
    }
    let len = 0;
    meta.tags = [];
    for (const tt of merged) {
      if (len + tt.length + 1 > 480) break;
      meta.tags.push(tt);
      len += tt.length + 1;
    }
  }
  if (meta.thumbnail) {
    meta.thumbnail.channelName = channelName;
    meta.thumbnail.accent = "#D9A514";
  }

  // name + dedup by what was ACTUALLY written (meta.title) — the research can
  // surface a different notification than the discovery pick, and the script
  // follows the research; the filename and covered-history must follow it too.
  const finalTitle = meta.title || pick.title;
  const base = `${dateStr}-${slugify(finalTitle)}-${channel.id}`;
  await fs.mkdir(SCRIPTS, { recursive: true });
  const scriptPath = path.join(SCRIPTS, `${base}.json`);
  await fs.writeFile(scriptPath, JSON.stringify(script, null, 2));
  await fs.writeFile(path.join(SCRIPTS, `${base}.meta.json`), JSON.stringify(meta, null, 2));

  used.push({ date: dateStr, pillar: cat.id, slug: base, title: finalTitle, ...(pick.roadmapId ? { roadmapId: pick.roadmapId } : {}) });
  await fs.mkdir(path.dirname(usedPath), { recursive: true });
  await fs.writeFile(usedPath, JSON.stringify(used, null, 2));

  console.log(`\n✓ script: pipeline/scripts/${base}.json (${script.scenes.length} slides)`);
  console.log(`  title: ${meta.title}`);

  if (!doRender) {
    console.log(`\n  Next: node pipeline/build.mjs pipeline/scripts/${base}.json  &&  npx remotion render Jobs out/${base}.mp4 --props=out/${base}.props.json`);
    return;
  }

  console.log("\n④ building voiceover…");
  execSync(`node pipeline/build.mjs "${scriptPath}"`, { cwd: ROOT, stdio: "inherit" });
  console.log("\n④ rendering the slide deck…");
  execSync(`npx remotion render Jobs out/${base}.mp4 --props=out/${base}.props.json`, { cwd: ROOT, stdio: "inherit" });
  console.log(`\n✓ done: out/${base}.mp4`);

  if (doUpload) {
    const atFlag = publishAt ? ` --at=${publishAt}` : "";
    const privacyFlag = publishAt ? "" : channel.privacy === "public" ? " --public" : channel.privacy === "unlisted" ? " --unlisted" : "";
    console.log(`\n⑤ uploading to YouTube (${publishAt ? `scheduled ${publishAt}` : channel.privacy || "private"})…`);
    execSync(`node pipeline/publish.mjs "${base}" --channel=${channel.id}${privacyFlag}${atFlag}`, { cwd: ROOT, stdio: "inherit" });
  }
}

/** SCHEME factor pipeline (niche "schemes") — rotates through SCHEME_TARGETS
 *  (Karnataka five guarantees first, then major central schemes), researching
 *  each fresh every time and trying the next target on reject (a scheme can
 *  turn out discontinued/renamed — see geminiSchemes' STILL ACTIVE gate)
 *  rather than publish stale welfare info. Renders on the same generic "Jobs"
 *  slide-deck composition (introCard/table/facts/outro) — fully data-driven,
 *  no scheme-specific Remotion component needed. */
async function runSchemes({ channel, channelName, dateStr, doRender, doUpload, publishAt, topic }) {
  console.log(`Agent: Schemes  |  ${channelName}  |  ${dateStr}`);
  const usedPath = channelUsedTopicsPath(channel.id);
  const used = await loadUsed(usedPath);

  // TRUE round-robin, not an approximate recency window: rank every target by
  // when it was LAST covered (never-covered = -1, i.e. always tried first),
  // so with N real schemes in the pool, a given scheme can only repeat after
  // all N-1 others have already run — the strongest anti-repetition guarantee
  // short of a hardcoded cooldown, and it scales automatically as the pool grows.
  const lastUsedAt = new Map();
  used.forEach((u, i) => {
    if (u.pillar === "schemes" && u.schemeId) lastUsedAt.set(u.schemeId, i);
  });
  const rotation = topic
    ? [{ id: "custom", title: topic, queries: [topic] }]
    : [...SCHEME_TARGETS].sort((a, b) => (lastUsedAt.get(a.id) ?? -1) - (lastUsedAt.get(b.id) ?? -1));

  let pick = null, script = null, meta = null;
  for (const target of rotation) {
    console.log(`① scheme: ${target.title}`);
    console.log("② researching…");
    const notes = [];
    for (const q of target.queries || [target.title]) {
      const res = await search(q, 4);
      for (const r of res.slice(0, 2)) {
        const body = r.content || (await fetchText(r.url, 2500));
        if (body) notes.push(`SOURCE: ${r.title} (${r.url})\n${body.slice(0, 2200)}`);
      }
    }
    if (!notes.length) {
      console.log("   no sources found — trying next scheme");
      continue;
    }
    console.log(`   gathered ${notes.length} sources`);
    console.log("③ writing the Kannada scheme explainer with Gemini…");
    let out;
    try {
      out = await geminiSchemes({ facts: notes.join("\n\n---\n\n"), target, channelName, todayStr: dateStr });
    } catch (e) {
      console.warn(`   write failed (${e.message}) — trying next scheme`);
      continue;
    }
    if (out.reject) {
      console.log(`   rejected (${out.reason}) — trying next scheme`);
      continue;
    }
    pick = { slug: `scheme-${target.id}`, title: out.meta?.title || target.title, schemeId: target.id };
    script = out.script;
    meta = out.meta;
    break;
  }
  if (!pick || !script) throw new Error("no usable, verified scheme found today (all targets empty or rejected)");

  // enforce invariants (mirrors runJobs)
  script.channelName = channelName;
  script.title = script.title || pick.title;
  script.topicTag = script.topicTag || "ಸರ್ಕಾರಿ ಯೋಜನೆ";
  script.accent = script.accent || "#2E8B57";
  script.template = "jobs"; // reuses the generic slide-deck composition — fully data-driven
  script.lang = "kn";
  // logo only if the file actually exists — a missing image would 404 in the
  // renderer and CANCEL the whole render (Remotion <Img> retries then aborts).
  script.logo = "";
  if (channel.logo) {
    const logoAbs = path.join(ROOT, "public", channel.logo);
    if (await fs.access(logoAbs).then(() => true).catch(() => false)) script.logo = channel.logo;
    else console.warn(`   ⚠ logo not found (public/${channel.logo}) — rendering without it`);
  }
  script.music = "";
  script.showCaptions = false;
  if ((channel.engine || "") === "cartesia") {
    script.engine = "cartesia";
    script.voice = channel.cartesiaVoice || ""; // "" = auto-resolve the account's clone
    script.fallbackVoice = channel.voice || "kn-IN-GaganNeural";
  } else {
    script.engine = "edge";
    script.voice = channel.voice || "kn-IN-GaganNeural";
  }
  const KNOWN_SCHEME_SCENES = new Set(["introCard", "table", "facts", "outro"]);
  script.scenes = (Array.isArray(script.scenes) ? script.scenes : []).filter((s) => s && KNOWN_SCHEME_SCENES.has(s.type));
  const OUTRO_VO =
    "ವಿಡಿಯೋವನ್ನ ಪೂರ್ತಿಯಾಗಿ ನೋಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ಇನ್ನು ನಮ್ಮ ಚಾನೆಲ್‌ಗೆ ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಆಗಿಲ್ಲ ಅಂದ್ರೆ ಈಗಲೇ ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ, ಪಕ್ಕದಲ್ಲಿರುವ ಬೆಲ್ ಐಕಾನ್ ಪ್ರೆಸ್ ಮಾಡಿ. ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಅಧಿಕೃತ ಪೋರ್ಟಲ್‌ನಲ್ಲಿ ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ. ಥ್ಯಾಂಕ್ ಯು.";
  script.scenes.forEach((s) => {
    if (!s.vo || !String(s.vo).trim()) s.vo = s.type === "outro" ? OUTRO_VO : s.heading || s.title || s.headline || "";
  });
  if (!script.scenes.some((s) => s.type === "outro")) {
    script.scenes.push({ type: "outro", headline: script.title || "", cta: `${channelName} ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ`, disclaimer: "ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಅಧಿಕೃತ ಪೋರ್ಟಲ್‌ನಲ್ಲಿ ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ", vo: OUTRO_VO });
  }
  if (script.scenes.length < 3) throw new Error("Gemini returned too few usable slides");
  if (!script.scenes[0].title) script.scenes[0].title = script.title;

  meta.channel = channel.id;
  meta.lang = "kn";
  meta.categoryId = "27"; // Education
  if (!meta.title) meta.title = pick.title;
  {
    const GENERIC = ["kannada", "karnataka", "karnataka scheme", "kannada scheme", "government scheme", "sarkari yojane", "ಸರ್ಕಾರಿ ಯೋಜನೆ", "ಕನ್ನಡ"];
    const seen = new Set();
    const merged = [];
    for (const t of [...GENERIC, ...(Array.isArray(meta.tags) ? meta.tags : [])]) {
      const tt = String(t).trim();
      const k = tt.toLowerCase();
      if (tt && !seen.has(k)) {
        seen.add(k);
        merged.push(tt);
      }
    }
    let len = 0;
    meta.tags = [];
    for (const tt of merged) {
      if (len + tt.length + 1 > 480) break;
      meta.tags.push(tt);
      len += tt.length + 1;
    }
  }
  if (meta.thumbnail) {
    meta.thumbnail.channelName = channelName;
    meta.thumbnail.accent = script.accent;
  }

  const finalTitle = meta.title || pick.title;
  const base = `${dateStr}-${slugify(finalTitle)}-${channel.id}`;
  await fs.mkdir(SCRIPTS, { recursive: true });
  const scriptPath = path.join(SCRIPTS, `${base}.json`);
  await fs.writeFile(scriptPath, JSON.stringify(script, null, 2));
  await fs.writeFile(path.join(SCRIPTS, `${base}.meta.json`), JSON.stringify(meta, null, 2));

  used.push({ date: dateStr, pillar: "schemes", slug: base, title: finalTitle, schemeId: pick.schemeId });
  await fs.mkdir(path.dirname(usedPath), { recursive: true });
  await fs.writeFile(usedPath, JSON.stringify(used, null, 2));

  console.log(`\n✓ script: pipeline/scripts/${base}.json (${script.scenes.length} slides)`);
  console.log(`  title: ${meta.title}`);

  if (!doRender) {
    console.log(`\n  Next: node pipeline/build.mjs pipeline/scripts/${base}.json  &&  npx remotion render Jobs out/${base}.mp4 --props=out/${base}.props.json`);
    return;
  }

  console.log("\n④ building voiceover…");
  execSync(`node pipeline/build.mjs "${scriptPath}"`, { cwd: ROOT, stdio: "inherit" });
  console.log("\n④ rendering the slide deck…");
  execSync(`npx remotion render Jobs out/${base}.mp4 --props=out/${base}.props.json`, { cwd: ROOT, stdio: "inherit" });
  console.log(`\n✓ done: out/${base}.mp4`);

  if (doUpload) {
    const atFlag = publishAt ? ` --at=${publishAt}` : "";
    const privacyFlag = publishAt ? "" : channel.privacy === "public" ? " --public" : channel.privacy === "unlisted" ? " --unlisted" : "";
    console.log(`\n⑤ uploading to YouTube (${publishAt ? `scheduled ${publishAt}` : channel.privacy || "private"})…`);
    execSync(`node pipeline/publish.mjs "${base}" --channel=${channel.id}${privacyFlag}${atFlag}`, { cwd: ROOT, stdio: "inherit" });
  }
}

/** Serialized Hindi micro-drama pipeline (niche "drama") — one part per day.
 *  Series state (bible, story-so-far, cliffhanger) lives in
 *  pipeline/channels/<id>/series-state.json so each day continues EXACTLY where
 *  the last part stopped. Every part also gets a Shorts teaser, and each part's
 *  description links all previously uploaded parts (the binge loop). */
async function runDrama({ channel, channelName, dateStr, doRender, doUpload, publishAt }) {
  console.log(`Agent: Drama  |  ${channelName}  |  ${dateStr}`);
  const stateDir = path.dirname(channelUsedTopicsPath(channel.id));
  const statePath = path.join(stateDir, "series-state.json");
  let state = { current: null, completed: [] };
  try {
    state = JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    /* first run */
  }

  // ① SERIES — continue the running one, or create the next series (new trope)
  if (!state.current) {
    const tropeId = DRAMA_ORDER[(state.completed?.length || 0) % DRAMA_ORDER.length];
    const t = DRAMA_TROPES[tropeId];
    console.log(`① creating a new series (trope: ${tropeId})…`);
    const c = await geminiDramaConcept({
      trope: t.topicTag,
      guidance: t.guidance,
      totalParts: 6,
      avoidTitles: (state.completed || []).map((s) => s.title),
    });
    if (!c?.title || !Array.isArray(c.arc) || c.arc.length < 4) throw new Error("series concept generation failed");
    state.current = {
      slug: slugify(c.slug || c.title),
      title: c.title,
      trope: tropeId,
      logline: c.logline || "",
      characters: c.characters || "",
      arc: c.arc,
      totalParts: c.arc.length,
      part: 0,
      soFar: "",
      cliffhanger: "",
    };
    console.log(`   series: "${state.current.title}" (${state.current.totalParts} parts)`);
    // persist the concept NOW — if the episode call fails, the series survives
    // and the retry continues it instead of inventing a new one.
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  }
  const series = state.current;
  const part = series.part + 1;
  console.log(`② writing "${series.title}" — Part ${part}/${series.totalParts}…`);

  // ② EPISODE — retry once at the shape level too (a rare sample returns valid
  // JSON with a wrong/short structure; a resample almost always fixes it).
  let ep;
  for (let attempt = 1; attempt <= 2; attempt++) {
    ep = await geminiDramaEpisode({ series, part, channelName });
    const ok = Array.isArray(ep?.script?.scenes) && ep.script.scenes.length >= 6 && ep?.state?.soFar && ep?.state?.cliffhanger;
    if (ok) break;
    console.warn(`   episode shape invalid (attempt ${attempt}) — ${attempt < 2 ? "resampling" : "giving up"}`);
  }
  const script = ep.script || {};
  const tropeTag = DRAMA_TROPES[series.trope]?.topicTag || "Drama";
  script.channelName = channelName;
  script.topicTag = tropeTag;
  script.template = "horizon";
  script.accent = "#E11D48";
  script.lang = "hi";
  script.music = "";
  script.showCaptions = true;
  if ((channel.engine || "") === "cartesia") {
    script.engine = "cartesia";
    script.voice = channel.cartesiaVoice || "";
    script.fallbackVoice = channel.voice || "hi-IN-SwaraNeural";
  } else {
    script.engine = "edge";
    script.voice = channel.voice || "hi-IN-SwaraNeural";
  }
  script.scenes = normalizeScenes(script.scenes);
  script.scenes.forEach((s) => {
    if (!s.vo || !String(s.vo).trim()) s.vo = s.headline || s.heading || s.quote || s.cta || "";
  });
  if (script.scenes.length < 6) throw new Error("episode came back with too few scenes");
  if (!ep.state?.soFar || !ep.state?.cliffhanger) throw new Error("episode did not return updated series state");

  // Shorts teaser — its own tiny script sharing the episode's look/voice
  const shortDoc = {
    channelName,
    topicTag: tropeTag,
    template: script.template,
    accent: script.accent,
    lang: "hi",
    music: "",
    showCaptions: true,
    engine: script.engine,
    voice: script.voice,
    fallbackVoice: script.fallbackVoice,
    source: "",
    scenes: normalizeScenes(ep.short?.scenes || []),
  };
  shortDoc.scenes.forEach((s) => {
    if (!s.vo || !String(s.vo).trim()) s.vo = s.headline || s.heading || "";
  });

  // ③ META + cross-links to previously uploaded parts (the binge loop)
  const meta = ep.meta || {};
  meta.title = meta.title || `${series.title} - Part ${part}`;
  meta.channel = channel.id;
  meta.lang = "hi";
  meta.categoryId = "24"; // Entertainment
  if (meta.thumbnail) {
    meta.thumbnail.channelName = channelName;
    meta.thumbnail.badge = `PART ${part}`;
  }
  try {
    const uploads = JSON.parse(await fs.readFile(path.join(ROOT, "pipeline", "uploads.json"), "utf8"));
    const prev = uploads
      .filter((u) => u.kind !== "short" && String(u.base || "").includes(`-${series.slug}-part-`))
      .map((u) => ({ n: Number(/-part-(\d+)-/.exec(u.base)?.[1] || 0), url: u.url }))
      .filter((p) => p.n > 0 && p.n < part)
      .sort((a, b) => a.n - b.n);
    if (prev.length) meta.description = `${meta.description || ""}\n\nPichhle parts yahan dekho:\n${prev.map((p) => `Part ${p.n}: ${p.url}`).join("\n")}`;
  } catch {
    /* no uploads yet */
  }
  meta.description = `${meta.description || ""}\n\n#hindikahani #hindistory #suspensestory #dramastory #hindikahaniyan #audiostory`;

  const base = `${dateStr}-${series.slug}-part-${part}-${channel.id}`;
  await fs.mkdir(SCRIPTS, { recursive: true });
  const scriptPath = path.join(SCRIPTS, `${base}.json`);
  const shortScriptPath = path.join(SCRIPTS, `${base}.short.json`);
  await fs.writeFile(scriptPath, JSON.stringify(script, null, 2));
  await fs.writeFile(shortScriptPath, JSON.stringify(shortDoc, null, 2));
  await fs.writeFile(path.join(SCRIPTS, `${base}.meta.json`), JSON.stringify(meta, null, 2));

  // ④ update the series state (next run continues from here)
  series.part = part;
  series.soFar = ep.state.soFar;
  series.cliffhanger = ep.state.cliffhanger;
  if (part >= series.totalParts) {
    state.completed = [...(state.completed || []), { slug: series.slug, title: series.title, trope: series.trope, parts: part }];
    state.current = null;
    console.log(`   🏁 series finale — a new series starts next run`);
  }
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));

  console.log(`\n✓ script: pipeline/scripts/${base}.json (${script.scenes.length} scenes + ${shortDoc.scenes.length}-scene teaser)`);
  console.log(`  title: ${meta.title}`);

  if (!doRender) {
    console.log(`\n  Next: node pipeline/build.mjs pipeline/scripts/${base}.json  &&  npx remotion render AINews out/${base}.mp4 --props=out/${base}.props.json`);
    return;
  }

  console.log("\n③ building voiceover + B-roll…");
  execSync(`node pipeline/build.mjs "${scriptPath}"`, { cwd: ROOT, stdio: "inherit" });
  console.log("\n③ building the Shorts teaser…");
  execSync(`node pipeline/build.mjs "${shortScriptPath}" "out/${base}.short.props.json" --base=${base}.short --captions`, { cwd: ROOT, stdio: "inherit" });

  const renderLong = `npx remotion render AINews out/${base}.mp4 --props=out/${base}.props.json`;
  const renderShort = `npx remotion render AINewsShort out/${base}.short.mp4 --props=out/${base}.short.props.json`;
  for (const [label, cmd, propsFile] of [
    ["episode", renderLong, path.join(ROOT, "out", `${base}.props.json`)],
    ["teaser", renderShort, path.join(ROOT, "out", `${base}.short.props.json`)],
  ]) {
    console.log(`\n④ rendering ${label}…`);
    try {
      execSync(`${cmd} --concurrency=1`, { cwd: ROOT, stdio: "inherit" });
    } catch {
      console.warn(`\n⚠ ${label} render failed (likely B-roll) — retrying graphics-only…`);
      const props = JSON.parse(await fs.readFile(propsFile, "utf8"));
      props.scenes.forEach((s) => {
        delete s.broll;
        delete s.bgImage;
      });
      await fs.writeFile(propsFile, JSON.stringify(props, null, 2));
      execSync(cmd, { cwd: ROOT, stdio: "inherit" });
    }
  }
  console.log(`\n✓ done: out/${base}.mp4 + out/${base}.short.mp4`);

  if (doUpload) {
    const atFlag = publishAt ? ` --at=${publishAt}` : "";
    const privacyFlag = publishAt ? "" : channel.privacy === "public" ? " --public" : channel.privacy === "unlisted" ? " --unlisted" : "";
    console.log(`\n⑤ uploading Part ${part} + teaser…`);
    execSync(`node pipeline/publish.mjs "${base}" --channel=${channel.id}${privacyFlag}${atFlag}`, { cwd: ROOT, stdio: "inherit" });
    execSync(`node pipeline/publish.mjs "${base}" --short --channel=${channel.id}${privacyFlag}${atFlag}`, { cwd: ROOT, stdio: "inherit" });
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
  const publishAt = flagVal("--at"); // RFC3339 UTC — schedule the public release

  // resolve the channel (defaults to "the-inference"); its config drives name,
  // language, pillars, voice and privacy unless a flag overrides.
  const channel = getChannel(flagVal("--channel") || "the-inference");
  const channelName = channel.spokenName || channel.name; // in-video/narration name (native script if set)
  const voice = flagVal("--voice") || channel.voice || "";
  const engine = flagVal("--engine") || channel.engine || ""; // "edge" | "kokoro" | "cartesia"
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

  // Jobs niche (JOB factor) has its own pipeline — priority govt-notification
  // track with private-job/exam-info fallback, rendered as the Jobs slide deck.
  if (niche === "jobs") {
    if (!hasGemini()) {
      console.error("Jobs niche needs Gemini — add pipeline/gemini.key.");
      process.exit(1);
    }
    await runJobs({ channel, channelName, dateStr, doRender, doUpload, publishAt, topic });
    return;
  }

  // Schemes niche (SCHEME factor) — rotates through Karnataka + central govt
  // welfare schemes, rendered on the same Jobs slide deck.
  if (niche === "schemes") {
    if (!hasGemini()) {
      console.error("Schemes niche needs Gemini — add pipeline/gemini.key.");
      process.exit(1);
    }
    await runSchemes({ channel, channelName, dateStr, doRender, doUpload, publishAt, topic });
    return;
  }

  // Serialized Hindi micro-drama (one part per day, series state on disk)
  if (niche === "drama") {
    if (!hasGemini()) {
      console.error("Drama niche needs Gemini — add pipeline/gemini.key.");
      process.exit(1);
    }
    await runDrama({ channel, channelName, dateStr, doRender, doUpload, publishAt });
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
      if (/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(r.url)) continue;
      const body = r.content || (await fetchText(r.url, 2500));
      if (body) notes.push(`SOURCE: ${r.title} (${r.url})\n${body.replace(/!\[.*?\]\(.*?\)/g, "").slice(0, 2000)}`);
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
              ? `You are a viral tech YouTuber and sharp analyst for ${channelName} — you break tools down with strong hooks and fast, opinionated, high-energy delivery (think a top tech reviewer), while staying honest about what they are, how they work, and their real strengths and limitations. You NEVER claim to have personally used, tried, or tested a tool. Every claim is a concrete fact from the research — never vague hype. Output ONLY JSON.`
              : pillarId === "business"
                ? `You are a sharp business-explainer YouTuber for ${channelName} — think the top US/UK channels that break down company strategy and money with real numbers, not vague industry talk. Confident, skeptical, has a strong take — you name the real numbers, the real mechanism, the real risk. Output ONLY JSON.`
                : pillarId === "trend"
                  ? `You are a documentary-style tech-trend explainer for ${channelName} — think Cleo Abram / Johnny Harris energy: grounded in real data, connecting the dots between named companies and events, honest about what's still uncertain. Fast, never vague futurism. Output ONLY JSON.`
                  : `You are a sharp tech-news explainer YouTuber for ${channelName} — hook-driven, fast, opinionated, always concrete and well-sourced (real names, numbers, mechanisms), never vague AI hype. Output ONLY JSON.`,
        },
        {
          role: "user",
          content: `Make a ${doShort ? "SHORT (vertical, ~30s)" : "video"} for pillar "${pillar.topicTag}" (accent ${pillar.accent}).\nTopic: ${pick.title}\nAngle: ${pick.angle}\n\nRESEARCH NOTES:\n${notes.join("\n\n---\n\n").slice(0, 12000)}\n\n${(doShort ? SHORT_SPEC : SPEC_FOR_PILLAR[pillarId] || SCRIPT_SPEC).split(CHANNEL).join(channelName)}${langDirective}`,
        },
      ],
      // Indic scripts (Devanagari/Kannada) tokenize ~2-3x heavier than English, so
      // give non-English generations a much bigger budget or the JSON truncates.
      // English long-form got a higher ceiling too — the structured NEWS/TREND/
      // BUSINESS specs (up to 12 scenes, each with heading+bullets+vo) need more
      // room than the old generic spec, especially on the Gemini fallback path.
      { maxTokens: doShort ? (lang === "en" ? 2500 : 5000) : lang === "en" ? 8000 : 11000 },
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
  if (engine === "cartesia") {
    // Cartesia Sonic handles en/hi/kn natively; the channel's Edge voice is kept
    // as the fallback for when the Cartesia key runs out of credits.
    script.engine = "cartesia";
    script.voice = flagVal("--voice") || channel.cartesiaVoice || "";
    script.fallbackVoice = channel.voice || (lang !== "en" ? L.voice : "en-US-AndrewNeural");
  } else {
    script.engine = lang === "en" ? engine || "edge" : "edge";
    script.voice = voice || (lang !== "en" ? L.voice : script.engine === "kokoro" ? "am_michael" : "en-US-AndrewNeural");
  }
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
