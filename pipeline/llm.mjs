/**
 * NVIDIA Nemotron client (OpenAI-compatible chat API).
 * Put your key in pipeline/nemotron.key (one line) or env NVIDIA_API_KEY.
 * Override the model in pipeline/nemotron.model or env NEMOTRON_MODEL.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { hasGemini, geminiChatJSON } from "./gemini.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER = "PASTE_YOUR_NVIDIA_NEMOTRON_KEY_HERE";
const BASE = "https://integrate.api.nvidia.com/v1";

function readLocal(file) {
  try {
    return readFileSync(path.join(DIR, file), "utf8").trim();
  } catch {
    return "";
  }
}

function loadKey() {
  if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY.trim();
  const k = readLocal("nemotron.key");
  return k && k !== PLACEHOLDER ? k : "";
}

const KEY = loadKey();
const MODEL =
  process.env.NEMOTRON_MODEL || readLocal("nemotron.model") || "nvidia/llama-3.1-nemotron-70b-instruct";

export const hasKey = () => KEY.length > 0;
export const modelName = () => MODEL;

/** raw chat completion → assistant text */
export async function chat(messages, { temperature = 0.7, maxTokens = 4096 } = {}) {
  if (!hasKey()) throw new Error("No Nemotron key — add pipeline/nemotron.key");
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error(`Nemotron ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "";
}

/** extract the first balanced JSON object/array from a string */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("no JSON found in model output");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++;
    else if (body[i] === close && --depth === 0) {
      return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error("unbalanced JSON in model output");
}

/** chat that must return JSON — retries once on parse failure, and falls back to
 *  Gemini when Nemotron is unreachable (network-blocked) or won't return JSON. */
export async function chatJSON(messages, opts = {}) {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      last = await chat(messages, { ...opts, temperature: attempt ? 0.3 : opts.temperature ?? 0.6 });
    } catch (e) {
      // Nemotron unreachable (e.g. carrier-blocked) → use Gemini instead
      if (hasGemini()) {
        console.warn(`  nemotron unreachable (${e.message}) — using Gemini`);
        return await geminiChatJSON(messages, { maxTokens: opts.maxTokens });
      }
      throw e;
    }
    try {
      return extractJson(last);
    } catch (e) {
      messages = [
        ...messages,
        { role: "assistant", content: last },
        { role: "user", content: `That did not parse as JSON (${e.message}). Reply with ONLY valid JSON, no prose, no markdown fences.` },
      ];
    }
  }
  // Nemotron reached but never returned valid JSON → last-resort Gemini
  if (hasGemini()) {
    console.warn("  nemotron returned no valid JSON — using Gemini");
    return await geminiChatJSON(messages, { maxTokens: opts.maxTokens });
  }
  throw new Error("Nemotron did not return valid JSON after 2 tries");
}
