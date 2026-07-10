/**
 * Code-callable web search + page fetch — the agent's research tool.
 * Default: DuckDuckGo (keyless). Optional upgrade: drop a Tavily key in
 * pipeline/tavily.key (free tier, LLM-optimized) for more reliable results.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { hasGemini, geminiGroundedSearch } from "./gemini.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function readLocal(file) {
  try {
    return readFileSync(path.join(DIR, file), "utf8").trim();
  } catch {
    return "";
  }
}
const TAVILY = process.env.TAVILY_API_KEY || readLocal("tavily.key");

const stripHtml = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

async function tavilySearch(query, max) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY,
      query,
      max_results: max,
      include_raw_content: true,
      topic: "news",
    }),
    // Tavily's news topic is the best source; give it room but still fall back if slow
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}`);
  const j = await r.json();
  return (j.results ?? []).map((x) => ({
    title: x.title,
    url: x.url,
    snippet: x.content || "",
    content: x.raw_content || x.content || "",
  }));
}

// Gemini + Google Search grounding → results shaped like the others. The grounded
// answer (rich, cited) is attached as `content` on the first result so the research
// step uses it directly (no page-fetch needed).
async function geminiSearch(query, max) {
  const { answer, sources } = await geminiGroundedSearch(query);
  if (!answer) throw new Error("empty grounded answer");
  const label = sources.map((s) => s.title).filter(Boolean).slice(0, 4).join(", ") || sources[0]?.url || "web";
  const items = answer
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length > 8);
  if (items.length >= 2) {
    // multiple items → good candidate list for discovery; answer as content on #0
    return items.slice(0, max).map((t, i) => ({ title: t.slice(0, 140), url: label, snippet: "", content: i === 0 ? answer : "" }));
  }
  return [{ title: query, url: label, snippet: answer.slice(0, 200), content: answer }];
}

async function ddgSearch(query, max) {
  const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(6000), // fail fast if DDG is blocked/unreachable
  });
  const html = await r.text();
  const out = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < max) {
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = "https:" + url;
    out.push({ title: stripHtml(m[2]), url, snippet: "" });
  }
  return out;
}

/** search the web → [{title, url, snippet, content?}].
 * Order: Tavily → DuckDuckGo (both free) → Gemini grounding (costs tokens, but
 * reachable when the others are network-blocked). NEVER throws — returns [] if
 * every provider fails, so the agent degrades instead of crashing. */
export async function search(query, max = 8) {
  // 1) Tavily (free, if a key is present and reachable)
  if (TAVILY) {
    try {
      const r = await tavilySearch(query, max);
      if (r.length) return r;
    } catch (e) {
      console.warn(`  tavily failed (${e.message}) — trying DuckDuckGo`);
    }
  }
  // 2) DuckDuckGo (free, keyless)
  try {
    const r = await ddgSearch(query, max);
    if (r.length) return r;
    console.warn("  duckduckgo returned nothing — trying Gemini");
  } catch (e) {
    console.warn(`  duckduckgo failed (${e.message}) — trying Gemini`);
  }
  // 3) Gemini grounding — only when the free providers are blocked/empty
  if (hasGemini()) {
    try {
      return await geminiSearch(query, max);
    } catch (e) {
      console.warn(`  gemini search failed (${e.message}) — no web results`);
    }
  }
  return [];
}

/** fetch a page and return cleaned plain text (truncated) */
export async function fetchText(url, maxChars = 4000) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return "";
    const html = await r.text();
    return stripHtml(html).slice(0, maxChars);
  } catch {
    return "";
  }
}
