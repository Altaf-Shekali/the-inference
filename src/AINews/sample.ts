import type { AINewsProps } from "./index";
import type { ThumbnailProps } from "./Thumbnail";

/* ------------------------------------------------------------------ *
 * These are exactly the shapes your pipeline (Claude → script → JSON →
 * TTS build) must produce. Drop a generated object like this in as
 * defaultProps (or pass via --props=file.json at render time).
 *
 *   • `vo` is the narration text per scene. The TTS build step
 *     (pipeline/build.mjs) reads it, generates the voiceover mp3,
 *     and fills in `audio`, `captions`, and the real `durationInFrames`.
 *   • The durations below are hand-set so the templates preview nicely
 *     in Studio WITHOUT audio. After running the build, durations come
 *     from the actual voiceover length.
 *   At 30fps: 90 = 3s, 150 = 5s, 240 = 8s.
 * ------------------------------------------------------------------ */

// ---------------- Pillar 1: AI NEWS ----------------
export const sampleAINews: AINewsProps = {
  channelName: "The Inference",
  topicTag: "AI News",
  accent: "#38BDF8",
  source: "Company filings, The Verge, Reuters",
  voice: "en-US-AndrewNeural",
  music: "",
  showCaptions: false,
  scenes: [
    {
      type: "hook",
      durationInFrames: 120,
      kicker: "Breaking",
      headline: "OpenAI Just Made Its **Biggest Move** Yet",
      sub: "And almost nobody is talking about what it actually means.",
      vo: "OpenAI just made its biggest move yet, and almost nobody is talking about what it actually means.",
    },
    {
      type: "headlines",
      durationInFrames: 150,
      heading: "It's everywhere this week",
      items: [
        { source: "The Verge", title: "OpenAI ships agentic model at half the price" },
        { source: "Reuters", title: "Rivals scramble to respond within days" },
        { source: "Bloomberg", title: "Enterprise demand spikes overnight" },
      ],
      vo: "It's everywhere this week. The Verge, Reuters, Bloomberg — all covering the same story from different angles.",
    },
    {
      type: "point",
      durationInFrames: 180,
      heading: "What happened",
      bullets: [
        "A new model shipped with **agentic tool-use** built in",
        "Pricing dropped **40%** versus the previous tier",
        "Enterprise API access opened the same day",
      ],
      vo: "Here's what happened. A new model shipped with agentic tool use built right in. Pricing dropped forty percent versus the previous tier. And enterprise API access opened the very same day.",
    },
    {
      type: "stat",
      durationInFrames: 120,
      value: "40%",
      label: "cheaper than the model it replaces — per million tokens",
      source: "OpenAI pricing page",
      vo: "Forty percent cheaper than the model it replaces, per million tokens.",
    },
    {
      type: "bars",
      durationInFrames: 170,
      title: "Price per million tokens",
      unit: "",
      data: [
        { label: "Old model", value: 10 },
        { label: "New model", value: 6 },
        { label: "Competitor A", value: 9 },
        { label: "Competitor B", value: 12 },
      ],
      source: "Public pricing pages, June 2026",
      vo: "Look at the price per million tokens. The new model undercuts its predecessor and both major competitors.",
    },
    {
      type: "point",
      durationInFrames: 180,
      heading: "Why it matters",
      bullets: [
        "Cuts the **cost floor** for AI startups overnight",
        "Pressures competitors to match within weeks",
        "Makes **always-on agents** commercially viable",
      ],
      vo: "Why does it matter? It cuts the cost floor for AI startups overnight. It pressures competitors to match within weeks. And it makes always-on agents commercially viable for the first time.",
    },
    {
      type: "quote",
      durationInFrames: 150,
      quote: "This is the moment agents stop being a demo and start being a product.",
      attribution: "industry analyst",
      vo: "As one industry analyst put it: this is the moment agents stop being a demo and start being a product.",
    },
    {
      type: "outro",
      durationInFrames: 120,
      headline: "We break down AI moves like this every day.",
      cta: "Subscribe to The Inference",
      vo: "We break down AI moves like this every single day. Subscribe to The Inference so you never miss one.",
    },
  ],
};

// ---------------- Pillar 2: TOOL BREAKDOWN ----------------
export const sampleAITools: AINewsProps = {
  channelName: "The Inference",
  topicTag: "Tool Breakdown",
  accent: "#34D399",
  source: "Vendor pricing pages, hands-on testing",
  voice: "en-US-AndrewNeural",
  music: "",
  showCaptions: false,
  scenes: [
    {
      type: "hook",
      durationInFrames: 120,
      kicker: "Tool Breakdown",
      headline: "The 5 AI Tools Actually Worth Paying For",
      sub: "We tested 30. Most were hype. These five weren't.",
      vo: "We tested thirty AI tools this month. Most were hype. These five actually weren't.",
    },
    {
      type: "tool",
      durationInFrames: 210,
      name: "Runway",
      category: "AI Video",
      oneLiner: "Text and image to video that finally looks usable.",
      features: [
        "Cinematic text-to-video clips",
        "Motion brush for precise control",
        "Fast enough for daily content",
      ],
      price: "$15/mo",
      verdict: "Best for creators",
      vo: "First up, Runway. Text and image to video that finally looks usable. You get cinematic clips, a motion brush for precise control, and it's fast enough for daily content. Fifteen dollars a month, and it's the best pick for creators.",
    },
    {
      type: "tool",
      durationInFrames: 210,
      name: "Perplexity",
      category: "AI Search",
      oneLiner: "Answers with sources, not ten blue links.",
      features: [
        "Cited, up-to-date answers",
        "Built-in research workflows",
        "Generous free tier",
      ],
      price: "Free / $20mo",
      verdict: "Best free pick",
      vo: "Next, Perplexity. It gives you answers with real sources, not ten blue links. You get cited, up to date answers, built in research workflows, and a genuinely generous free tier. It's our best free pick.",
    },
    {
      type: "compare",
      durationInFrames: 210,
      title: "The full ranking",
      items: [
        { name: "Runway", note: "AI video — best for creators" },
        { name: "Perplexity", note: "AI search — best free pick" },
        { name: "Claude", note: "Writing & code — best reasoning" },
        { name: "ElevenLabs", note: "Voiceover — best quality" },
        { name: "Cursor", note: "Coding — best for devs" },
      ],
      vo: "Here's the full ranking. Runway for video. Perplexity for search. Claude for writing and code. ElevenLabs for voiceover. And Cursor for developers.",
    },
    {
      type: "outro",
      durationInFrames: 120,
      headline: "New tool breakdowns every week.",
      cta: "Subscribe to The Inference",
      vo: "We post new tool breakdowns every week. Subscribe to The Inference so you always know what's worth paying for.",
    },
  ],
};

// ---------------- Thumbnails ----------------
export const sampleThumbnail: ThumbnailProps = {
  badge: "AI News",
  bigText: "OpenAI's Biggest Move",
  subText: "What nobody is telling you",
  accent: "#38BDF8",
  channelName: "The Inference",
};

export const sampleToolsThumbnail: ThumbnailProps = {
  badge: "Tool Breakdown",
  bigText: "5 AI Tools Worth Paying For",
  subText: "We tested 30. These won.",
  accent: "#34D399",
  channelName: "The Inference",
};
