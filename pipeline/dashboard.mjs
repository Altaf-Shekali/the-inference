/**
 * Local control panel for "The Inference" pipeline.
 *
 *   npm run dashboard            # opens http://localhost:5174
 *
 * A zero-dependency Node server (built-in http only) that wraps the existing
 * scripts. It does NOT touch the daily automation — that scheduled task keeps
 * running as usual. This is just a manual cockpit:
 *   • Library of every video (thumbnail + render/upload status + YouTube link)
 *   • Inline preview of long-form and Short
 *   • One-click render of the 9:16 Short
 *   • Upload (private / unlisted / public / scheduled) for video or Short
 *   • Edit title / description / tags
 *   • Daily scheduled-task status + latest log
 */
import { createServer } from "http";
import { promises as fs, createReadStream, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { hasYouTube, loadClient } from "./youtube.mjs";
import { synth } from "./tts.mjs";
import { loadChannels, addChannel, removeChannel, getChannel } from "./channels.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SCRIPTS = path.join(ROOT, "pipeline", "scripts");
const OUT = path.join(ROOT, "out");
const REGISTRY = path.join(ROOT, "pipeline", "uploads.json");
const PORT = process.env.DASH_PORT ? Number(process.env.DASH_PORT) : 5174;

const exists = (p) => fs.access(p).then(() => true).catch(() => false);
const readJSON = (p, fb) => fs.readFile(p, "utf8").then(JSON.parse).catch(() => fb);

// content pillars the Generate button can force (must match agent.mjs PILLARS)
const PILLARS = ["ainews", "tools", "trend", "business"];

// Selectable voices. value = "<engine>:<voiceId>". "" = default / reuse.
//   edge   = Microsoft Edge cloud voices (word-accurate caption timing)
//   kokoro = local Apache-2.0 voices (offline, commercial-license-clean)
const VOICES = [
  { value: "", label: "Default (Edge · Andrew — standard)" },
  { value: "edge:en-US-AndrewMultilingualNeural", label: "Edge · Andrew — natural male" },
  { value: "edge:en-US-AvaMultilingualNeural", label: "Edge · Ava — natural female" },
  { value: "edge:en-US-BrianMultilingualNeural", label: "Edge · Brian — confident male" },
  { value: "edge:en-US-EmmaMultilingualNeural", label: "Edge · Emma — friendly female" },
  { value: "kokoro:am_michael", label: "Kokoro · Michael — US male (local, license-clean)" },
  { value: "kokoro:am_adam", label: "Kokoro · Adam — US male (local)" },
  { value: "kokoro:af_heart", label: "Kokoro · Heart — US female (local)" },
  { value: "kokoro:bm_george", label: "Kokoro · George — UK male (local)" },
];
const VOICE_VALUES = new Set(VOICES.map((v) => v.value).filter(Boolean));
const parseVoice = (v) => {
  if (!v) return { engine: "", id: "" };
  const i = v.indexOf(":");
  return i < 0 ? { engine: "edge", id: v } : { engine: v.slice(0, i), id: v.slice(i + 1) };
};

// --- repetition guard: how similar is each video to the others? -------------
// YouTube's monetization review flags "mass-produced / repetitious" content, so
// we surface the closest recent upload as a guidance signal (not a hard block).
const STOP = new Set(
  "the a an and or of to in for on with is are be this that your you it as at by from how why what here when who will can new now top best your via more than into out about over them they we our us".split(" "),
);
const tokenize = (v) =>
  new Set((`${v.title} ${(v.tags || []).join(" ")}`.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)));
const jaccard = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
};
/** annotate each video with .similar = {base,title,score%} for its closest peer */
function attachSimilarity(videos) {
  const sets = videos.map(tokenize);
  // drop tokens shared by most videos (evergreen pillar tags) so they don't
  // make everything look similar — leaves the topic-specific words that matter.
  const df = new Map();
  for (const s of sets) for (const t of s) df.set(t, (df.get(t) || 0) + 1);
  const cap = Math.max(2, videos.length * 0.6);
  const sig = sets.map((s) => new Set([...s].filter((t) => df.get(t) <= cap)));
  videos.forEach((v, i) => {
    let best = null;
    videos.forEach((w, j) => {
      if (i === j) return;
      const s = jaccard(sig[i], sig[j]);
      if (!best || s > best.s) best = { s, base: w.base, title: w.title };
    });
    v.similar = best ? { base: best.base, title: best.title, score: Math.round(best.s * 100) } : null;
  });
}

// ---------------------------------------------------------------- jobs (SSE)
// Each long-running command (render / upload) becomes a job; the browser opens
// an EventSource to stream its stdout live and learn the exit code.
const jobs = new Map();
let jobSeq = 0;

function startJob(label, command) {
  const id = `job${++jobSeq}`;
  const job = { id, label, lines: [], done: false, code: null, clients: new Set() };
  jobs.set(id, job);
  const emit = (line) => {
    job.lines.push(line);
    for (const res of job.clients) res.write(`data: ${JSON.stringify(line)}\n\n`);
  };
  emit(`$ ${command}`);
  // shell:true so `npx`/`node` resolve via PATH on Windows, and so we can chain
  // build && render in one job with &&
  const child = spawn(command, { cwd: ROOT, shell: true });
  const onData = (buf) => buf.toString().split(/\r?\n/).forEach((l) => l && emit(l));
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => {
    job.done = true;
    job.code = code ?? 0;
    emit(`\n— finished (exit ${job.code}) —`);
    for (const res of job.clients) {
      res.write(`event: done\ndata: ${job.code}\n\n`);
      res.end();
    }
  });
  return id;
}

// ---------------------------------------------------------------- library
async function listVideos() {
  const uploads = await readJSON(REGISTRY, []);
  const byBase = {};
  for (const u of uploads) (byBase[u.base] ||= []).push(u);

  const metas = (await fs.readdir(SCRIPTS).catch(() => []))
    .filter((f) => f.endsWith(".meta.json"))
    .map((f) => f.replace(/\.meta\.json$/, ""));
  const mp4s = (await fs.readdir(OUT).catch(() => []))
    .filter((f) => f.endsWith(".mp4") && !f.endsWith(".short.mp4"))
    .map((f) => f.replace(/\.mp4$/, ""));
  // date-prefixed daily videos first (newest → oldest), ad-hoc test files after
  const isDated = (b) => /^\d{4}-\d{2}-\d{2}/.test(b);
  const bases = [...new Set([...metas, ...mp4s])].sort((a, b) => {
    if (isDated(a) !== isDated(b)) return isDated(a) ? -1 : 1;
    return b.localeCompare(a);
  });

  const out = [];
  for (const base of bases) {
    const meta = await readJSON(path.join(SCRIPTS, `${base}.meta.json`), {});
    const script = await readJSON(path.join(SCRIPTS, `${base}.json`), {});
    out.push({
      base,
      title: meta.title || base,
      description: meta.description || "",
      tags: meta.tags || [],
      channel: meta.channel || "the-inference",
      lang: meta.lang || script.lang || "en",
      pillar: script.topicTag || "",
      accent: script.accent || "#3B9EFF",
      hasVideo: await exists(path.join(OUT, `${base}.mp4`)),
      hasShort: await exists(path.join(OUT, `${base}.short.mp4`)),
      hasProps: await exists(path.join(OUT, `${base}.props.json`)),
      hasScript: await exists(path.join(SCRIPTS, `${base}.json`)),
      hasThumb: await exists(path.join(OUT, `${base}.thumb.png`)),
      uploads: byBase[base] || [],
    });
  }
  attachSimilarity(out);
  return out;
}

/** per-channel "did today's upload happen?" summary for the status board */
async function todayStatus(channels) {
  const date = new Date().toISOString().slice(0, 10);
  const uploads = await readJSON(REGISTRY, []);
  const rows = channels.map((c) => {
    const ups = uploads.filter((u) => (u.channel || "the-inference") === c.id);
    const todays = ups.filter((u) => String(u.at || "").slice(0, 10) === date);
    const last = ups.length ? ups[ups.length - 1] : null;
    return {
      id: c.id,
      name: c.name,
      lang: c.lang,
      uploadTime: c.uploadTime || "19:30",
      renderTime: c.renderTime || "",
      enabled: c.enabled !== false,
      youtube: c.youtube,
      uploadedToday: todays.length > 0,
      todayUploads: todays.map((u) => ({ url: u.url, kind: u.kind })),
      last: last ? { date: String(last.at || "").slice(0, 10), url: last.url, title: last.title } : null,
    };
  });
  return { date, channels: rows };
}

async function dailyStatus() {
  // newest out/daily-*.log → last run summary
  const files = (await fs.readdir(OUT).catch(() => []))
    .filter((f) => f.startsWith("daily-") && f.endsWith(".log"))
    .sort()
    .reverse();
  let lastLog = null;
  if (files[0]) {
    const txt = await fs.readFile(path.join(OUT, files[0]), "utf8").catch(() => "");
    lastLog = { file: files[0], tail: txt.split(/\r?\n/).slice(-40).join("\n") };
  }
  // per-channel scheduled tasks (InferenceDaily-*) via PowerShell.
  // -EncodedCommand (base64 UTF-16LE) avoids all shell-quoting issues.
  const task = await new Promise((resolve) => {
    const ps =
      "Get-ScheduledTask -TaskName 'InferenceDaily-*' -ErrorAction SilentlyContinue | " +
      "ForEach-Object { $i=$_ | Get-ScheduledTaskInfo; \"$($_.TaskName)|$($i.NextRunTime)|$($i.LastRunTime)|$($i.LastTaskResult)\" }";
    const enc = Buffer.from(ps, "utf16le").toString("base64");
    const c = spawn("powershell", ["-NoProfile", "-EncodedCommand", enc], { shell: false });
    let s = "";
    c.stdout.on("data", (d) => (s += d));
    c.on("close", () => {
      const lines = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      if (!lines.length) return resolve({ installed: false, tasks: [] });
      const tasks = lines.map((l) => {
        const [name, next, last, result] = l.split("|");
        return { id: name.replace(/^InferenceDaily-/, ""), next, last, result };
      });
      const nexts = tasks.map((t) => t.next).filter(Boolean).sort();
      const lasts = tasks.map((t) => t.last).filter((x) => x && !/^0001/.test(x)).sort();
      resolve({ installed: true, count: tasks.length, tasks, nextRun: nexts[0], lastRun: lasts[lasts.length - 1] });
    });
  });
  return { task, lastLog };
}

// ---------------------------------------------------------------- http
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serveFile(req, res, filePath, type) {
  let st;
  try {
    st = statSync(filePath);
  } catch {
    return send(res, 404, { error: "not found" });
  }
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : st.size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${st.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
    });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes" });
    createReadStream(filePath).pipe(res);
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    // --- page
    if (p === "/" || p === "/index.html") {
      const html = await fs.readFile(path.join(HERE, "dashboard.html"), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    // --- state
    if (p === "/api/state") {
      const channels = loadChannels().map((c) => ({ ...c, youtube: hasYouTube(c.id) }));
      return send(res, 200, {
        videos: await listVideos(),
        daily: await dailyStatus(),
        today: await todayStatus(channels),
        youtube: hasYouTube(),
        voices: VOICES,
        pillars: PILLARS,
        channels,
      });
    }

    // --- voice sample — /api/voice-sample?voice=kokoro:am_michael
    if (p === "/api/voice-sample") {
      const v = url.searchParams.get("voice");
      if (!VOICE_VALUES.has(v)) return send(res, 400, { error: "unknown voice" });
      const { engine, id } = parseVoice(v);
      const { buffer, ext } = await synth("Here's how this voice sounds narrating your video.", id, engine);
      res.writeHead(200, { "Content-Type": ext === "wav" ? "audio/wav" : "audio/mpeg", "Cache-Control": "no-store", "Content-Length": buffer.length });
      return res.end(buffer);
    }

    // --- build a channel's Google consent URL (phone-friendly auth; no loopback
    //     server needed — the user pastes the resulting code back via /yt-code).
    if (p === "/api/channel/auth-url") {
      const id = url.searchParams.get("channel");
      if (!id) return send(res, 400, { error: "missing channel" });
      if (!loadChannels().some((c) => c.id === id)) return send(res, 400, { error: `unknown channel "${id}"` });
      const c = loadClient(id);
      if (!c) return send(res, 400, { error: `No OAuth client for "${id}" — add pipeline/channels/${id}/youtube.client.json` });
      const authUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: c.id,
          redirect_uri: "http://localhost:53682",
          response_type: "code",
          scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube",
          access_type: "offline",
          prompt: "consent",
        });
      return send(res, 200, { url: authUrl, name: getChannel(id).name });
    }

    // --- media (preview / thumbnail) — /api/file?base=..&kind=long|short|thumb
    if (p === "/api/file") {
      const base = url.searchParams.get("base");
      const kind = url.searchParams.get("kind") || "long";
      const safe = path.basename(base || ""); // no traversal
      const map = { long: [`${safe}.mp4`, "video/mp4"], short: [`${safe}.short.mp4`, "video/mp4"], thumb: [`${safe}.thumb.png`, "image/png"] };
      const [file, type] = map[kind] || map.long;
      return serveFile(req, res, path.join(OUT, file), type);
    }

    // --- job log stream (SSE)
    if (p.startsWith("/api/job/")) {
      const id = p.split("/").pop();
      const job = jobs.get(id);
      if (!job) return send(res, 404, { error: "no such job" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      for (const line of job.lines) res.write(`data: ${JSON.stringify(line)}\n\n`);
      if (job.done) {
        res.write(`event: done\ndata: ${job.code}\n\n`);
        return res.end();
      }
      job.clients.add(res);
      req.on("close", () => job.clients.delete(res));
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req);

      // generate a brand-new video (discover → script → build → render). With
      // short:true it writes its OWN ~30s vertical script (not a cut of a long-form).
      // No upload — it lands in the Library for you to review/upload manually.
      if (p === "/api/generate") {
        const pillar = PILLARS.includes(body.pillar) ? `${body.pillar} ` : "";
        // --short = short only; --long = long only (quiz respects this so the
        // "generate long" button doesn't also produce a Short). Non-quiz niches ignore --long.
        const short = body.short ? "--short " : "--long ";
        const topic = body.topic ? ` --topic="${String(body.topic).replace(/["\r\n]/g, " ").trim()}"` : "";
        const pv = parseVoice(body.voice);
        // effective language = explicit hi/kn override, else the channel's own language
        const chLang = body.channel ? getChannel(body.channel).lang : "en";
        const effLang = ["hi", "kn"].includes(body.lang) ? body.lang : chLang;
        const lang = ["hi", "kn"].includes(body.lang) ? ` --lang=${body.lang}` : ""; // else channel's lang applies in agent
        // the English/Kokoro voice picker only applies to English; hi/kn auto-pick their native voice
        const voice = effLang === "en" && VOICE_VALUES.has(body.voice) ? ` --engine=${pv.engine} --voice=${pv.id}` : "";
        const chan = body.channel ? ` --channel=${body.channel}` : "";
        const id = startJob(`generate ${body.channel || ""} ${body.short ? "short " : ""}${body.pillar || "auto"}`.trim(), `node pipeline/agent.mjs ${pillar}${short}--render${topic}${voice}${lang}${chan}`);
        return send(res, 200, { jobId: id });
      }

      // add/update a channel
      if (p === "/api/channels/add") {
        if (!body.id || !/^[a-z0-9-]+$/.test(body.id)) return send(res, 400, { error: "id must be lowercase letters, numbers, hyphens" });
        const niche = ["story", "psych", "quiz"].includes(body.niche) ? body.niche : "ainews";
        const pillarsFor = { story: ["crime", "scam", "survival", "success", "history", "human"], psych: ["bias", "behavior", "relationships", "dark", "mind", "social"], quiz: [], ainews: ["ainews", "tools", "trend", "business"] };
        const ch = await addChannel({
          id: body.id,
          name: body.name || body.id,
          lang: ["en", "hi", "kn"].includes(body.lang) ? body.lang : "en",
          niche,
          pillars: pillarsFor[niche],
          region: ["IN", "US"].includes(body.region) ? body.region : "IN",
          uploadTime: /^\d{1,2}:\d{2}$/.test(body.uploadTime || "") ? body.uploadTime : "",
          privacy: ["private", "unlisted", "public"].includes(body.privacy) ? body.privacy : "private",
          enabled: body.enabled !== false,
        });
        return send(res, 200, { ok: true, channel: ch });
      }

      // edit a channel (upload time / privacy / enabled)
      if (p === "/api/channels/update") {
        if (!body.id) return send(res, 400, { error: "missing id" });
        const patch = { id: body.id };
        if (/^\d{1,2}:\d{2}$/.test(body.uploadTime || "")) patch.uploadTime = body.uploadTime;
        if (["private", "unlisted", "public"].includes(body.privacy)) patch.privacy = body.privacy;
        if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
        const ch = await addChannel(patch);
        return send(res, 200, { ok: true, channel: ch });
      }

      // remove a channel from the registry
      if (p === "/api/channels/delete") {
        if (!body.id || body.id === "the-inference") return send(res, 400, { error: "can't delete the default channel" });
        await removeChannel(body.id);
        return send(res, 200, { ok: true });
      }

      // (re)install the per-channel Windows scheduled tasks from channels.json
      if (p === "/api/schedule/install") {
        return send(res, 200, { jobId: startJob("apply schedule", "powershell -NoProfile -ExecutionPolicy Bypass -File pipeline\\install-schedule.ps1") });
      }

      // start the YouTube OAuth for a channel — the consent URL streams in the job log
      if (p === "/api/channel/authorize") {
        if (!body.id) return send(res, 400, { error: "missing channel id" });
        return send(res, 200, { jobId: startJob(`authorize ${body.id}`, `node pipeline/youtube-auth.mjs --channel=${body.id}`) });
      }

      // phone flow: exchange a pasted redirect code/URL for a channel's token
      if (p === "/api/channel/yt-code") {
        if (!body.id || !body.code) return send(res, 400, { error: "missing id or code" });
        const code = String(body.code).replace(/["\r\n]/g, " ").trim();
        return send(res, 200, { jobId: startJob(`yt-code ${body.id}`, `node pipeline/yt-code.mjs "${code}" --channel=${body.id}`) });
      }

      const base = path.basename(body.base || "");
      if (!base) return send(res, 400, { error: "missing base" });

      // save edited meta
      if (p === "/api/meta") {
        const metaPath = path.join(SCRIPTS, `${base}.meta.json`);
        const meta = await readJSON(metaPath, {});
        if (typeof body.title === "string") meta.title = body.title;
        if (typeof body.description === "string") meta.description = body.description;
        if (Array.isArray(body.tags)) meta.tags = body.tags;
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
        return send(res, 200, { ok: true });
      }

      // render the 9:16 Short (captions burned on). With a voice chosen, the
      // narration is re-synthesized into SEPARATE short artifacts so the
      // long-form's audio is never touched; otherwise the existing audio is reused.
      if (p === "/api/render-short") {
        const v = body.voice || "";
        const render = `npx remotion render AINewsShort out/${base}.short.mp4 --props=out/${base}.short.props.json --concurrency=1`;
        let command;
        if (v && VOICE_VALUES.has(v)) {
          const pv = parseVoice(v);
          if (!(await exists(path.join(SCRIPTS, `${base}.json`)))) return send(res, 400, { error: "script JSON missing — can't re-voice" });
          // build short audio/props with the chosen engine+voice (no B-roll re-fetch), then render
          command = `node pipeline/build.mjs pipeline/scripts/${base}.json out/${base}.short.props.json --engine=${pv.engine} --voice=${pv.id} --base=${base}.short --captions --no-broll && ${render}`;
        } else {
          // fast path: reuse the long-form audio, just flip captions on for the vertical cut
          const props = await readJSON(path.join(OUT, `${base}.props.json`), null);
          if (!props) return send(res, 400, { error: "no props — render the long-form video first" });
          props.showCaptions = true;
          await fs.writeFile(path.join(OUT, `${base}.short.props.json`), JSON.stringify(props));
          command = render;
        }
        return send(res, 200, { jobId: startJob(`render short: ${base}`, command) });
      }

      // upload (long or short) with a privacy / schedule choice, to the video's channel
      if (p === "/api/upload") {
        const flags = [];
        if (body.kind === "short") flags.push("--short");
        if (body.privacy === "unlisted") flags.push("--unlisted");
        else if (body.privacy === "public") flags.push("--public");
        if (body.at) flags.push(`--at=${body.at}`);
        flags.push(`--channel=${body.channel || "the-inference"}`);
        const id = startJob(`upload ${body.kind || "long"}: ${base}`, `node pipeline/publish.mjs ${base} ${flags.join(" ")}`.trim());
        return send(res, 200, { jobId: id });
      }
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  const link = `http://localhost:${PORT}`;
  console.log(`\n  The Inference — control panel\n  ${link}\n`);
  // best-effort auto-open on Windows
  spawn("cmd", ["/c", "start", "", link], { shell: true }).on("error", () => {});
  // tidy old rendered media (>3 days, already on YouTube) in the background
  spawn("node", ["pipeline/cleanup.mjs"], { cwd: ROOT, stdio: "ignore" }).on("error", () => {});
});
