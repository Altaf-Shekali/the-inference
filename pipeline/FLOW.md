# Faceless AI-news channel — production flow

The exact pipeline: **discover → research → script → render → upload.**
Stages ①–③ produce a script JSON; ④ renders it; ⑤ publishes it.

```
①  DISCOVER        →  ②  RESEARCH      →  ③  SCRIPT         →  ④  RENDER         →  ⑤  UPLOAD
   trending AI         verify facts,        scenes + vo +        Remotion →           YouTube w/
   topics (web)        data, quotes         B-roll keywords      video + thumbnail    title/tags/desc
```

## ① Discover  (web research tools)
Find what's trending in AI/tech right now. Output: a chosen topic + angle.
Done with web search across news aggregators, Reuters/CNBC/Fortune/TechCrunch, etc.

## ② Research  (web research tools)
Verify the key numbers, get a quotable line, collect 3–5 reputable sources.
Prefer primary/reputable outlets over SEO blogs for any figure that goes on screen.

## ③ Script  → `pipeline/scripts/<topic>.json`
Turn the research into the data contract (see any file in `pipeline/scripts/`).
Rules that make it retain:
- Open with a **hook** that creates a question.
- Mix scene types: `hook → headlines → stat → bars → point → quote → point → outro`.
- Put numbers in `stat` / `bars` (they animate + count up).
- Wrap the 1–2 most important words per line in `**double asterisks**` → renders in accent.
- Give footage scenes (`hook`/`point`/`quote`/`outro`) 2–3 `keywords` for B-roll;
  leave data scenes (`stat`/`bars`/`headlines`) as clean motion graphics.
- `vo` is the narration; spell tricky terms phonetically ("I-P-O", "A-I").
- Also write `<topic>.meta.json`: title, description (with chapters), tags, thumbnail text.

## ④ Render
```bash
npm run sound                              # once, only if you want a music bed later
npm run vo pipeline/scripts/<topic>.json   # voiceover + auto B-roll + durations → out/<topic>.props.json
npx remotion render AINews out/<topic>.mp4 --props=out/<topic>.props.json
npx remotion still AINewsThumbnail out/<topic>.thumb.png --props=pipeline/scripts/<topic>.meta.json
```

## ⑤ Upload  (not built yet — Slice 4)
YouTube Data API: upload `out/<topic>.mp4`, set the thumbnail, and apply
`title` / `description` / `tags` from `<topic>.meta.json`.

---
**Who does what:** ①–③ are currently done by the agent (Claude) using web tools — highest
quality, no extra API keys. For unattended cron automation later, this stage would move to an
LLM API call from code. ④ is fully automated. ⑤ is the next build.
