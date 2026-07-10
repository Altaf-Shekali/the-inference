# Remotion video

<p align="center">
  <a href="https://github.com/remotion-dev/logo">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-dark.apng">
      <img alt="Animated Remotion Logo" src="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-light.gif">
    </picture>
  </a>
</p>

Welcome to your Remotion project!

---

# The Inference — automated faceless video channel

An autonomous pipeline that discovers a topic, writes a script (NVIDIA Nemotron + web
research), generates AI voiceover + B-roll, renders a video, and uploads it to YouTube.

## Setup / moving to a new PC

Requires **Node.js 20+** and (optionally, for local Kokoro voice) **Python 3.11+**. One command
bootstraps a fresh Windows machine — safe to re-run:

```console
npm run setup        # = powershell -ExecutionPolicy Bypass -File setup.ps1
```

It runs `npm install`, recreates the Kokoro venv + downloads its model, fetches the fonts,
**reports which API keys / channel authorizations are still missing**, and installs the daily
schedule. Skip parts with `-SkipKokoro` / `-SkipSchedule`.

**Moving machines (zip → new PC):**
1. Zip the project **without** `node_modules` and `pipeline/.venv-tts` (they rebuild). **Keep**
   everything else — especially:
   - `pipeline/*.key` (nemotron, gemini, pexels, tavily)
   - `pipeline/channels.json` (all channel config)
   - the whole **`pipeline/channels/<id>/`** folders — each channel's
     `youtube.client.json` + `youtube.token.json` + `used-topics.json` (this is what carries the
     YouTube auth over, per channel)
2. On the new PC: unzip → `npm run setup`. It rebuilds deps + Kokoro + fonts, re-installs the
   schedule, and reports each channel's client/auth status.
3. Add anything it flags as missing, and authorize any channel it lists as not-authorized.

Notes: those `channels/*` secrets are git-ignored, so they travel via **zip** but NOT via a git
clone. Upload times are the machine's **local clock** — adjust per channel if the new PC is in a
different timezone (e.g. the English channel's time targets US ET *from IST*). The PowerShell
schedulers are **Windows-only**.

## Control panel (UI)

```console
npm run dashboard
```

Starts a local server **and** serves the UI together (one process) at
**http://localhost:5174** — it auto-opens your browser. Keep the terminal open; closing
it stops the server. Always open it via the URL, not by double-clicking the HTML file.

From the dashboard you can:

- **Generate new content** — pick a pillar, optionally type a **Topic** (blank =
  auto-discover), and click **Generate long-form (16:9)** or **Generate Short (9:16, ~30s)**.
  The Topic box applies to **both** buttons.
- **Library** — every video with thumbnail, render/upload status, and YouTube links.
- **Preview** the long-form and the Short inline.
- **Render a Short** for any video — pick a **voice** (with a 🔊 sample button) or reuse the original.
- **Upload** as private / unlisted / public / scheduled; edit title, description & tags first.
- **Pre-upload review (YPP)** — an automatic similarity check vs. recent uploads plus a
  monetization checklist that soft-gates the upload.
- **Daily automation status** — last run, next run, and logs.

## Channels (run many at once)

Each **channel** is a separate YouTube destination with its own **language, name, pillars,
topic history, and OAuth token**. The registry is `pipeline/channels.json`; per-channel data
(its token + topic history) lives under `pipeline/channels/<id>/`.

To add one: use the dashboard **Channels** panel (id, name, language, privacy) → **Add**, then
**Authorize YouTube** and sign in with *that channel's* Google/YouTube account. Or edit
`channels.json` and run the auth command below.

```console
npm run yt-auth -- --channel=<id>        # authorize a channel's YouTube (or the phone flow)
npm run daily-upload -- --channel=<id>   # generate + upload one channel
```

- The daily run produces **one video per enabled channel** (see `run-daily.ps1`).
- The dashboard Generate panel has a **Channel** picker; a video uploads to its own channel.
- The default `the-inference` channel keeps using the original `pipeline/youtube.token.json`,
  so existing setups are unchanged.

### Niches (per channel)

Each channel has a **niche** (set in the dashboard add-channel form or `channels.json`):

- **`ainews`** (default) — Nemotron writes tech-news videos across the AI/tools/trend/business pillars.
- **`story`** — a **true-story** channel. It surfs the web for a real, documented event (rotating
  categories: crime, scam, survival, success, history, human), researches it, and **Gemini writes
  the story as a Kannada literary author** (Kuvempu / Poornachandra Tejasvi style) — natural spoken
  narration for TTS, not AI-flavoured. Facts stay real (only true events); needs `pipeline/gemini.key`.
  Captions are burned on. Copyright-safe: it writes **original retellings of facts**, never reads
  copyrighted books.

## Daily automation (peak-time scheduling)

Each channel has an **uploadTime** (its region's peak-viewership time, local clock). A
Windows Scheduled Task per channel fires **1 hour before** that — it generates, renders,
and uploads with a **scheduled release** (`publishAt`) at the peak time.

Enable / refresh (re-run whenever you add or retime a channel):

```console
powershell -ExecutionPolicy Bypass -File pipeline\install-schedule.ps1
```

- Creates `InferenceDaily-<channel>` tasks; the dashboard **Today** board shows next-run + status.
- Channels without a YouTube token are skipped (authorize them first).
- List: `Get-ScheduledTask -TaskName "InferenceDaily-*"` · Disable one:
  `Unregister-ScheduledTask -TaskName "InferenceDaily-<id>" -Confirm:$false`

> **Scheduled *public* release requires your YouTube API project to be audited** (publish the
> OAuth app). Until then the video still renders + uploads an hour early but stays **private** —
> the timing is right; the auto-public needs the audit.

## Generate from the command line

| Command | Result |
|---|---|
| `npm run daily` | Generate + render a long-form video (no upload) |
| `npm run daily-upload` | Generate + render + **upload** the long-form (private) |
| `npm run short` | Generate + render a standalone ~30s Short (no upload) |
| `npm run short-upload` | Generate + render + **upload** the Short (private, #Shorts) |
| `npm run publish <base>` | Upload an already-rendered video (`--unlisted` / `--public` / `--at=ISO` / `--short`) |

### Make a video on a specific topic (any command, any day)

Append `-- --topic="your topic"` (the `--` is required so npm passes the flag through):

```console
npm run daily        -- --topic="Nvidia's new AI chip announcement"   # long-form on topic
npm run daily-upload -- --topic="Nvidia's new AI chip announcement"   # long-form + upload
npm run short        -- --topic="Nvidia's new AI chip announcement"   # Short on topic
npm run short-upload -- --topic="Nvidia's new AI chip announcement"   # Short + upload
```

With a topic it skips discovery, researches that topic for grounding, then writes the
script. Without it, the agent auto-discovers a trending topic. Either way it still uses
the day's content pillar for styling. The same Topic field is available in the dashboard.

## Voices — Edge (cloud) vs. Kokoro (local)

Two selectable TTS engines, chosen per video from the dashboard **Voice** dropdown
(or the `--engine`/`--voice` CLI flags):

- **Edge** (default) — free Microsoft neural voices. Word-accurate caption timing.
  Note: Edge's TTS is a cloud "Read Aloud" API with a commercial-use gray area.
- **Kokoro** — local Apache-2.0 model. **Commercial-use-clean (monetization-safe)**,
  runs fully offline on CPU (no GPU needed). Captions use estimated word timing
  (slightly looser than Edge). Voices: `am_michael`, `am_adam` (US male),
  `af_heart` (US female), `bm_george` (UK male).

```console
npm run daily -- --engine=kokoro --voice=am_michael      # long-form, local voice
npm run short -- --engine=kokoro --voice=af_heart        # Short, local voice
```

**One-time Kokoro setup** (the venv + model are git-ignored — recreate on a fresh clone):

```console
py -3.11 -m venv pipeline\.venv-tts
pipeline\.venv-tts\Scripts\python -m pip install kokoro-onnx soundfile numpy
# download model files into pipeline\kokoro\ :
#   kokoro-v1.0.onnx  and  voices-v1.0.bin
#   from https://github.com/thewh1teagle/kokoro-onnx/releases (tag model-files-v1.0)
```

If Kokoro isn't installed, selecting it automatically falls back to Edge — renders never fail over engine choice.

## Languages (English / Hindi / Kannada)

Generate localized videos with `--lang` (or the dashboard **Language** dropdown). Audio,
on-screen text, and captions are all localized; Noto Devanagari/Kannada fonts (fetched by
`npm run fonts`) render the scripts.

- **English** (default) & **Hindi** — Nemotron writes the script natively; Edge voices it
  (Hindi: `hi-IN-MadhurNeural`).
- **Kannada** — Nemotron writes in English, then **Gemini** translates to Kannada
  (Nemotron's own Kannada is unreliable). Requires a Gemini key in `pipeline/gemini.key`
  (or env `GEMINI_API_KEY`); model overridable in `pipeline/gemini.model` (default
  `gemini-2.5-flash`). Without a key it falls back to direct Nemotron Kannada (lower
  quality). Voiced with `kn-IN-GaganNeural`.

```console
npm run short -- --lang=hi --topic="..."     # Hindi
npm run short -- --lang=kn --topic="..."     # Kannada (needs pipeline/gemini.key)
```

## Storage cleanup

Rendered media is large (~50 MB/video + B-roll clips + voiceover). Since every video is
already on YouTube, local copies older than **3 days are auto-deleted** — the daily run and
the dashboard both trigger it. Only date-prefixed pipeline output is touched; hand-made
renders are spared. The small script/meta JSON is kept as history.

```console
npm run cleanup            # delete pipeline media older than 3 days
node pipeline/cleanup.mjs --days=7 --dry   # preview what a 7-day cutoff would remove
```

## One-time setup

Run `npm run setup` (above) — it reports which of these are missing:

- **YouTube:** add `pipeline/youtube.client.json` (OAuth Desktop client), then authorize each
  channel: `npm run yt-auth -- --channel=<id>` (or the dashboard Channels panel). Status shows
  on the dashboard Today board.
- **Keys** (one line each, under `pipeline/`): `nemotron.key` (script generation, **required**),
  `gemini.key` (Kannada translation), `pexels.key` (B-roll), `tavily.key` (research).

---

## Remotion commands

**Install Dependencies**

```console
npm i
```

**Start Preview**

```console
npm run dev
```

**Render video**

```console
npx remotion render
```

**Upgrade Remotion**

```console
npx remotion upgrade
```

## Docs

Get started with Remotion by reading the [fundamentals page](https://www.remotion.dev/docs/the-fundamentals).

## Help

We provide help on our [Discord server](https://discord.gg/6VzzNDwUwV).

## Issues

Found an issue with Remotion? [File an issue here](https://github.com/remotion-dev/remotion/issues/new).

## License

Note that for some entities a company license is needed. [Read the terms here](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
