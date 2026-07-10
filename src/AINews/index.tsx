import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  Audio,
  Img,
  OffthreadVideo,
  staticFile,
  Easing,
  CalculateMetadataFunction,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { Tpl, TEMPLATES, resolveTpl, TemplateBackground } from "./templates";
import { withIndic } from "./fonts";

/* ------------------------------------------------------------------ *
 * THE DATA CONTRACT  (see sample.ts for full examples)
 *
 * One object → one video. Scenes are a discriminated union on `type`.
 * `template` (optional) selects the visual identity; otherwise it's derived
 * from topicTag (AI News→wire, Tool Breakdown→studio, Business→ledger,
 * Tech Trend→horizon). Any text field supports **highlight** markup.
 * ------------------------------------------------------------------ */

const wordCue = z.object({ text: z.string(), from: z.number(), to: z.number() });
const cueSchema = z.object({
  text: z.string(),
  from: z.number(),
  to: z.number(),
  words: z.array(wordCue).optional(),
});

const narr = {
  vo: z.string().optional(),
  audio: z.string().optional(),
  captions: z.array(cueSchema).optional(),
  broll: z.string().optional(),
  bgImage: z.string().optional(),
  keywords: z.array(z.string()).optional(),
};

const hookScene = z.object({ type: z.literal("hook"), durationInFrames: z.number().int().positive(), kicker: z.string(), headline: z.string(), sub: z.string(), ...narr });
const bulletScene = z.object({ type: z.literal("point"), durationInFrames: z.number().int().positive(), heading: z.string(), bullets: z.array(z.string()).max(5), image: z.string().optional(), ...narr });
const statScene = z.object({ type: z.literal("stat"), durationInFrames: z.number().int().positive(), value: z.string(), label: z.string(), source: z.string().optional(), ...narr });
const quoteScene = z.object({ type: z.literal("quote"), durationInFrames: z.number().int().positive(), quote: z.string(), attribution: z.string(), ...narr });
const outroScene = z.object({ type: z.literal("outro"), durationInFrames: z.number().int().positive(), headline: z.string(), cta: z.string(), ...narr });
const toolScene = z.object({ type: z.literal("tool"), durationInFrames: z.number().int().positive(), name: z.string(), category: z.string(), oneLiner: z.string(), features: z.array(z.string()).max(4), price: z.string(), verdict: z.string(), image: z.string().optional(), ...narr });
const compareScene = z.object({ type: z.literal("compare"), durationInFrames: z.number().int().positive(), title: z.string(), items: z.array(z.object({ name: z.string(), note: z.string() })).max(6), ...narr });
const barsScene = z.object({ type: z.literal("bars"), durationInFrames: z.number().int().positive(), title: z.string(), unit: z.string().optional(), data: z.array(z.object({ label: z.string(), value: z.number() })).max(6), source: z.string().optional(), ...narr });
const headlinesScene = z.object({ type: z.literal("headlines"), durationInFrames: z.number().int().positive(), heading: z.string(), items: z.array(z.object({ source: z.string(), title: z.string() })).max(4), ...narr });

const sceneSchema = z.discriminatedUnion("type", [hookScene, bulletScene, statScene, quoteScene, outroScene, toolScene, compareScene, barsScene, headlinesScene]);

export const aiNewsSchema = z.object({
  channelName: z.string(),
  topicTag: z.string(),
  accent: zColor(),
  template: z.enum(["wire", "studio", "ledger", "horizon"]).optional(), // visual identity; default by topicTag
  source: z.string(),
  voice: z.string(),
  lang: z.enum(["en", "hi", "kn"]).optional(), // narration/on-screen language
  music: z.string(),
  sfx: z
    .object({ whoosh: z.string().optional(), riser: z.string().optional(), boom: z.string().optional(), tick: z.string().optional(), ding: z.string().optional(), click: z.string().optional() })
    .optional(),
  showCaptions: z.boolean(),
  scenes: z.array(sceneSchema),
});

export type AINewsProps = z.infer<typeof aiNewsSchema>;
type Scene = z.infer<typeof sceneSchema>;
type Cue = z.infer<typeof cueSchema>;

export const calculateAINewsMetadata: CalculateMetadataFunction<AINewsProps> = ({ props }) => {
  const total = props.scenes.reduce((s, sc) => s + sc.durationInFrames, 0);
  return { durationInFrames: Math.max(1, total) };
};

/* ------------------------------------------------------------------ *
 * TEMPLATE CONTEXT — every component reads its palette/font from here
 * ------------------------------------------------------------------ */
const TplCtx = React.createContext<Tpl>(TEMPLATES.wire);
const useTpl = () => React.useContext(TplCtx);

/** unit + palette + font, all template-aware */
const useUnit = () => {
  const { width, height } = useVideoConfig();
  const portrait = height >= width;
  const t = useTpl();
  return {
    u: portrait ? width / 1080 : width / 1920,
    portrait,
    font: withIndic(t.font), // append Devanagari/Kannada fallback for hi/kn videos

    bg: t.bg,
    ink: t.ink,
    muted: t.muted,
    hair: t.hair,
    card: t.card,
    hero: t.hero,
    brand: t.brand,
  };
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** **highlight** markup → accent-colored span; strip any stray asterisks so
 * malformed/half markup never shows a literal "*" on screen */
const rich = (text: string, accent: string) =>
  text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <span key={i} style={{ color: accent }}>{p.slice(2, -2)}</span>
    ) : (
      <React.Fragment key={i}>{p.replace(/\*+/g, "")}</React.Fragment>
    ),
  );

/* ------------------------------------------------------------------ *
 * SCENE SHELL — slide-in, focus blur, push-in, light-sweep
 * ------------------------------------------------------------------ */
const SceneShell: React.FC<{ dur: number; idx: number; accent: string; children: React.ReactNode }> = ({ dur, idx, accent, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, mass: 0.5 } });
  const dir = idx % 2 === 0 ? 1 : -1;
  const inX = interpolate(enter, [0, 1], [70 * dir, 0]);
  const punch = interpolate(enter, [0, 1], [1.06, 1]);
  const inOp = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: "clamp" });
  const p = clamp01(frame / dur);
  const camScale = interpolate(p, [0, 1], [1.0, 1.05]);
  const sweep = interpolate(frame, [0, 12], [-120, 220], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const sweepOp = interpolate(frame, [0, 6, 12], [0, 0.5, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: inOp }}>
      <AbsoluteFill style={{ transform: `scale(${camScale * punch}) translateX(${inX}px)` }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ background: `linear-gradient(105deg, transparent 0%, ${accent}55 50%, transparent 100%)`, transform: `translateX(${sweep}%)`, opacity: sweepOp, mixBlendMode: "screen", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

/* count-up number */
const parseNum = (value: string) => {
  const m = value.match(/^([^0-9-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!m) return null;
  const decimals = (m[2].split(".")[1] || "").length;
  return { prefix: m[1], num: parseFloat(m[2].replace(/,/g, "")), decimals, suffix: m[3] };
};
const CountUp: React.FC<{ value: string; style?: React.CSSProperties }> = ({ value, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const parsed = parseNum(value);
  if (!parsed) return <span style={style}>{value}</span>;
  const e = spring({ frame, fps, config: { damping: 200, mass: 0.9 } });
  const n = parsed.num * e;
  const txt = parsed.prefix + n.toLocaleString("en-US", { minimumFractionDigits: parsed.decimals, maximumFractionDigits: parsed.decimals }) + parsed.suffix;
  return <span style={style}>{txt}</span>;
};

/* ------------------------------------------------------------------ *
 * CHROME
 * ------------------------------------------------------------------ */
const Dot: React.FC<{ accent: string; size: number }> = ({ accent, size }) => {
  const frame = useCurrentFrame();
  const pulse = interpolate(frame % 60, [0, 30, 60], [1, 0.35, 1]);
  return <div style={{ width: size, height: size, borderRadius: "50%", background: accent, opacity: pulse }} />;
};

const BrandBar: React.FC<{ channelName: string; topicTag: string; accent: string }> = ({ channelName, topicTag, accent }) => {
  const { u, portrait, font, bg: BG, ink: INK, brand } = useUnit();
  const tag = topicTag.toUpperCase();
  let badge: React.ReactNode;
  if (brand === "chip") {
    badge = (
      <div style={{ display: "flex", alignItems: "center", gap: 12 * u, border: `2px solid ${accent}`, color: accent, padding: `${8 * u}px ${18 * u}px`, borderRadius: 999, fontFamily: font, fontWeight: 800, fontSize: 24 * u, letterSpacing: 2 }}>
        <Dot accent={accent} size={11 * u} />
        {tag}
      </div>
    );
  } else if (brand === "minimal") {
    badge = (
      <div style={{ display: "flex", alignItems: "center", gap: 12 * u, color: INK, fontFamily: font, fontWeight: 700, fontSize: 24 * u, letterSpacing: 4 }}>
        <Dot accent={accent} size={11 * u} />
        {tag}
      </div>
    );
  } else {
    badge = (
      <div style={{ display: "flex", alignItems: "center", gap: 12 * u, background: accent, color: BG, padding: `${10 * u}px ${20 * u}px`, borderRadius: 6 * u, fontFamily: font, fontWeight: 800, fontSize: 26 * u, letterSpacing: 2 }}>
        <Dot accent={BG} size={12 * u} />
        {tag}
      </div>
    );
  }
  return (
    <AbsoluteFill style={{ alignItems: portrait ? "center" : "flex-start", justifyContent: "flex-start", padding: portrait ? `${64 * u}px ${56 * u}px` : `${52 * u}px ${80 * u}px` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 * u }}>
        {badge}
        <span style={{ fontFamily: font, fontWeight: 700, fontSize: 28 * u, color: INK, letterSpacing: 1 }}>{channelName}</span>
      </div>
    </AbsoluteFill>
  );
};

const ProgressBar: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { hair: HAIR } = useUnit();
  const pct = interpolate(frame, [0, durationInFrames], [0, 100], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end" }}>
      <div style={{ height: 6, width: "100%", background: HAIR }}>
        <div style={{ height: "100%", width: `${pct}%`, background: accent, boxShadow: `0 0 16px ${accent}` }} />
      </div>
    </AbsoluteFill>
  );
};

const SourceTag: React.FC<{ source: string }> = ({ source }) => {
  const { u, portrait, font, muted: MUTED } = useUnit();
  if (!source) return null;
  return (
    <AbsoluteFill style={{ alignItems: portrait ? "center" : "flex-start", justifyContent: "flex-end", padding: portrait ? `${56 * u}px` : `${44 * u}px ${80 * u}px` }}>
      <span style={{ fontFamily: font, fontSize: 20 * u, color: MUTED }}>Source: {source}</span>
    </AbsoluteFill>
  );
};

/* kinetic word-by-word captions */
const Captions: React.FC<{ cues: Cue[]; accent: string }> = ({ cues, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, font, ink: INK, hair: HAIR } = useUnit();
  const cue = cues.find((c) => frame >= c.from && frame < c.to);
  if (!cue) return null;
  const words = cue.words ?? [{ text: cue.text, from: cue.from, to: cue.to }];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: portrait ? 420 * u : 130 * u }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: `${10 * u}px ${14 * u}px`, justifyContent: "center", maxWidth: portrait ? 900 * u : 1300 * u, background: "rgba(7,11,22,0.62)", border: `1px solid ${HAIR}`, borderRadius: 18 * u, padding: `${18 * u}px ${28 * u}px` }}>
        {words.map((w, i) => {
          const active = frame >= w.from && frame < w.to;
          const seen = frame >= w.from;
          const pop = clamp01(spring({ frame: frame - w.from, fps, config: { damping: 14 } }));
          return (
            <span key={i} style={{ fontFamily: font, fontWeight: 800, fontSize: (portrait ? 52 : 40) * u, color: active ? accent : INK, opacity: seen ? 1 : 0.32, transform: `translateY(${interpolate(pop, [0, 1], [16, 0])}px) scale(${active ? 1.1 : 1})`, textShadow: "0 4px 18px rgba(0,0,0,0.5)" }}>
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const stagger = (frame: number, fps: number, i: number, delay = 14, step = 7) =>
  clamp01(spring({ frame: frame - delay - i * step, fps, config: { damping: 16 } }));

type SfxMap = NonNullable<AINewsProps["sfx"]>;

const Sfx: React.FC<{ file?: string; at?: number; volume?: number }> = ({ file, at = 0, volume = 0.5 }) =>
  file ? (
    <Sequence from={at} layout="none">
      <Audio src={staticFile(file)} volume={volume} />
    </Sequence>
  ) : null;

/* ------------------------------------------------------------------ *
 * SCENES
 * ------------------------------------------------------------------ */
const Hook: React.FC<{ s: Extract<Scene, { type: "hook" }>; accent: string }> = ({ s, accent }) => {
  const { u, portrait, font, ink: INK, muted: MUTED, hero } = useUnit();
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [6, 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  // per-template hero layout
  const cfg = {
    center: { justify: "center", align: portrait ? "center" : "flex-start", text: portrait ? "center" : "left", h: (portrait ? 92 : 104), leftBar: false, padB: 0, tag: "plain" },
    lowerThird: { justify: "flex-end", align: "flex-start", text: "left", h: portrait ? 80 : 86, leftBar: true, padB: portrait ? 300 : 170, tag: "filled" },
    split: { justify: "center", align: "flex-start", text: "left", h: portrait ? 80 : 92, leftBar: true, padB: 0, tag: "plain" },
    centerBig: { justify: "center", align: "center", text: "center", h: portrait ? 102 : 124, leftBar: false, padB: 0, tag: "center" },
  }[hero];

  const kicker =
    cfg.tag === "filled" ? (
      <span style={{ display: "inline-block", background: accent, color: "#05080F", fontFamily: font, fontWeight: 800, fontSize: 26 * u, letterSpacing: 2, padding: `${8 * u}px ${18 * u}px`, borderRadius: 4 * u }}>{s.kicker.toUpperCase()}</span>
    ) : (
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: 30 * u, color: accent, letterSpacing: 4 }}>{s.kicker.toUpperCase()}</div>
    );

  const inner = (
    <div style={{ maxWidth: 1500 * u, borderLeft: cfg.leftBar ? `${8 * u}px solid ${accent}` : undefined, paddingLeft: cfg.leftBar ? 34 * u : 0 }}>
      {kicker}
      {!cfg.leftBar ? (
        <div style={{ height: 5 * u, width: `${grow * (portrait ? 180 : 240) * u}px`, background: accent, margin: cfg.text === "center" ? `${20 * u}px auto` : `${20 * u}px 0`, borderRadius: 999, boxShadow: `0 0 16px ${accent}` }} />
      ) : (
        <div style={{ height: 18 * u }} />
      )}
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: cfg.h * u, lineHeight: 1.04, color: INK, letterSpacing: hero === "centerBig" ? -2 : -1 }}>{rich(s.headline, accent)}</div>
      <div style={{ fontFamily: font, fontWeight: 500, fontSize: 40 * u, color: MUTED, marginTop: 28 * u, lineHeight: 1.3 }}>{rich(s.sub, accent)}</div>
    </div>
  );

  return (
    <AbsoluteFill style={{ alignItems: cfg.align as "center" | "flex-start", justifyContent: cfg.justify as "center" | "flex-end", textAlign: cfg.text as "center" | "left", padding: portrait ? `0 ${70 * u}px ${cfg.padB}px` : `0 ${140 * u}px ${cfg.padB}px` }}>
      {inner}
    </AbsoluteFill>
  );
};

const Point: React.FC<{ s: Extract<Scene, { type: "point" }>; accent: string; tick?: string }> = ({ s, accent, tick }) => {
  const { u, portrait, font, ink: INK, hair: HAIR, card: CARD } = useUnit();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const heading = <div style={{ fontFamily: font, fontWeight: 800, fontSize: (portrait ? 64 : 66) * u, color: INK, lineHeight: 1.1, marginBottom: 36 * u }}>{rich(s.heading, accent)}</div>;
  const bullets = (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 * u }}>
      {s.bullets.map((b, i) => {
        const e = stagger(frame, fps, i);
        return (
          <React.Fragment key={i}>
            <Sfx file={tick} at={14 + i * 7} volume={0.22} />
            <div style={{ display: "flex", gap: 22 * u, alignItems: "center", background: CARD, border: `1px solid ${HAIR}`, borderLeft: `${5 * u}px solid ${accent}`, borderRadius: 14 * u, padding: `${18 * u}px ${24 * u}px`, opacity: e, transform: `translateX(${interpolate(e, [0, 1], [-34, 0])}px) scale(${interpolate(e, [0, 1], [0.96, 1])})` }}>
              <div style={{ fontFamily: font, fontWeight: 800, fontSize: 30 * u, color: accent, minWidth: 40 * u }}>{String(i + 1).padStart(2, "0")}</div>
              <span style={{ fontFamily: font, fontWeight: 500, fontSize: 38 * u, color: INK, lineHeight: 1.25 }}>{rich(b, accent)}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
  const media = s.image ? <KenBurns src={s.image} /> : null;
  if (portrait) {
    return (
      <AbsoluteFill style={{ justifyContent: "center", padding: `0 ${70 * u}px` }}>
        {heading}
        {media ? <div style={{ height: 480 * u, marginBottom: 30 * u }}>{media}</div> : null}
        {bullets}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: `0 ${140 * u}px` }}>
      <div style={{ display: "flex", gap: 70 * u, alignItems: "center", width: "100%" }}>
        <div style={{ flex: media ? 1.1 : 1 }}>
          {heading}
          {bullets}
        </div>
        {media ? <div style={{ flex: 1, height: 600 * u }}>{media}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const KenBurns: React.FC<{ src: string }> = ({ src }) => {
  const { u, hair: HAIR } = useUnit();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = clamp01(frame / durationInFrames);
  const scale = interpolate(p, [0, 1], [1.08, 1.2]);
  const x = interpolate(p, [0, 1], [-12, 12]);
  return (
    <div style={{ width: "100%", height: "100%", borderRadius: 24 * u, overflow: "hidden", border: `1px solid ${HAIR}`, boxShadow: "0 30px 90px rgba(0,0,0,0.55)" }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translateX(${x}px)` }} />
    </div>
  );
};

const SceneBg: React.FC<{ broll?: string; bgImage?: string; accent: string }> = ({ broll, bgImage, accent }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  if (!broll && !bgImage) return null;
  const p = clamp01(frame / durationInFrames);
  const scale = interpolate(p, [0, 1], [1.12, 1.22]);
  const x = interpolate(p, [0, 1], [-14, 14]);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${scale}) translateX(${x}px)` }}>
        {broll ? (
          <OffthreadVideo
            src={staticFile(broll)}
            muted
            // @ts-expect-error loop is supported at runtime in this Remotion build
            loop
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <Img src={staticFile(bgImage as string)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: accent, opacity: 0.14, mixBlendMode: "soft-light" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,7,12,0.86) 0%, rgba(5,7,12,0.35) 32%, rgba(5,7,12,0.45) 62%, rgba(5,7,12,0.92) 100%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(5,7,12,0.6) 0%, transparent 24%, transparent 76%, rgba(5,7,12,0.6) 100%)" }} />
      <AbsoluteFill style={{ boxShadow: "inset 0 0 300px 70px rgba(0,0,0,0.6)" }} />
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ s: Extract<Scene, { type: "stat" }>; accent: string }> = ({ s, accent }) => {
  const { u, portrait, font, ink: INK, muted: MUTED } = useUnit();
  const frame = useCurrentFrame();
  const ring = interpolate(frame, [6, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const R = (portrait ? 250 : 300) * u;
  const C = 2 * Math.PI * R;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: `0 ${80 * u}px` }}>
      <svg width={R * 2.4} height={R * 2.4} style={{ position: "absolute", opacity: 0.5 }}>
        <circle cx={R * 1.2} cy={R * 1.2} r={R} fill="none" stroke={accent} strokeWidth={6 * u} strokeDasharray={C} strokeDashoffset={C * (1 - ring)} strokeLinecap="round" transform={`rotate(-90 ${R * 1.2} ${R * 1.2})`} />
      </svg>
      <CountUp value={s.value} style={{ fontFamily: font, fontWeight: 800, fontSize: (portrait ? 240 : 300) * u, lineHeight: 1, color: accent, letterSpacing: -4, textShadow: `0 0 60px ${accent}55` }} />
      <div style={{ fontFamily: font, fontWeight: 600, fontSize: 48 * u, color: INK, marginTop: 24 * u, maxWidth: 1200 * u, lineHeight: 1.25 }}>{rich(s.label, accent)}</div>
      {s.source ? <div style={{ fontFamily: font, fontSize: 24 * u, color: MUTED, marginTop: 18 * u }}>{s.source}</div> : null}
    </AbsoluteFill>
  );
};

const Quote: React.FC<{ s: Extract<Scene, { type: "quote" }>; accent: string }> = ({ s, accent }) => {
  const { u, portrait, font, ink: INK, muted: MUTED } = useUnit();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: portrait ? `0 ${90 * u}px` : `0 ${220 * u}px` }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: font, fontWeight: 800, fontSize: 200 * u, color: accent, lineHeight: 0.6, height: 120 * u }}>&ldquo;</div>
        <div style={{ fontFamily: font, fontWeight: 600, fontSize: (portrait ? 56 : 64) * u, color: INK, lineHeight: 1.3 }}>{rich(s.quote, accent)}</div>
        <div style={{ fontFamily: font, fontWeight: 500, fontSize: 34 * u, color: MUTED, marginTop: 40 * u }}>— {s.attribution}</div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ s: Extract<Scene, { type: "outro" }>; accent: string }> = ({ s, accent }) => {
  const { u, font, ink: INK, bg: BG } = useUnit();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cta = clamp01(spring({ frame: frame - 14, fps, config: { damping: 12 } }));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: `0 ${80 * u}px` }}>
      <div>
        <div style={{ fontFamily: font, fontWeight: 800, fontSize: 84 * u, color: INK, lineHeight: 1.1 }}>{rich(s.headline, accent)}</div>
        <div style={{ display: "inline-block", marginTop: 44 * u, fontFamily: font, fontWeight: 700, fontSize: 42 * u, color: BG, background: accent, padding: `${22 * u}px ${56 * u}px`, borderRadius: 999, boxShadow: `0 20px 50px ${accent}66`, transform: `scale(${interpolate(cta, [0, 1], [0.7, 1])})` }}>{s.cta}</div>
      </div>
    </AbsoluteFill>
  );
};

const Tool: React.FC<{ s: Extract<Scene, { type: "tool" }>; accent: string; tick?: string }> = ({ s, accent, tick }) => {
  const { u, portrait, font, ink: INK, muted: MUTED, hair: HAIR, card: CARD, bg: BG } = useUnit();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const left = (
    <div style={{ flex: 1.1 }}>
      <span style={{ fontFamily: font, fontWeight: 800, fontSize: 22 * u, color: BG, background: accent, padding: `${7 * u}px ${16 * u}px`, borderRadius: 6 * u, letterSpacing: 1 }}>{s.category.toUpperCase()}</span>
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: (portrait ? 78 : 84) * u, color: INK, lineHeight: 1, marginTop: 16 * u }}>{s.name}</div>
      <div style={{ fontFamily: font, fontWeight: 500, fontSize: 36 * u, color: MUTED, marginTop: 16 * u, marginBottom: 30 * u, lineHeight: 1.3 }}>{rich(s.oneLiner, accent)}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 * u }}>
        {s.features.map((f, i) => {
          const e = stagger(frame, fps, i, 16, 7);
          return (
            <React.Fragment key={i}>
              <Sfx file={tick} at={16 + i * 7} volume={0.22} />
              <div style={{ display: "flex", gap: 16 * u, alignItems: "center", opacity: e, transform: `translateX(${interpolate(e, [0, 1], [-24, 0])}px)` }}>
                <span style={{ color: accent, fontSize: 32 * u, fontWeight: 800 }}>✓</span>
                <span style={{ fontFamily: font, fontWeight: 500, fontSize: 36 * u, color: INK }}>{rich(f, accent)}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 16 * u, marginTop: 36 * u, flexWrap: "wrap" }}>
        <span style={{ fontFamily: font, fontWeight: 700, fontSize: 32 * u, color: INK, background: CARD, border: `1px solid ${HAIR}`, padding: `${14 * u}px ${28 * u}px`, borderRadius: 999 }}>{s.price}</span>
        <span style={{ fontFamily: font, fontWeight: 700, fontSize: 32 * u, color: accent, border: `2px solid ${accent}`, padding: `${14 * u}px ${28 * u}px`, borderRadius: 999 }}>{s.verdict}</span>
      </div>
    </div>
  );
  const media = s.image ? <div style={{ flex: 1, height: portrait ? 460 * u : 560 * u }}><KenBurns src={s.image} /></div> : null;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: portrait ? `0 ${80 * u}px` : `0 ${140 * u}px` }}>
      <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", gap: portrait ? 34 * u : 70 * u, alignItems: "center", width: "100%" }}>
        {portrait && media ? media : null}
        {left}
        {!portrait && media ? media : null}
      </div>
    </AbsoluteFill>
  );
};

const Compare: React.FC<{ s: Extract<Scene, { type: "compare" }>; accent: string; tick?: string }> = ({ s, accent, tick }) => {
  const { u, portrait, font, ink: INK, muted: MUTED, hair: HAIR, card: CARD } = useUnit();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: portrait ? "center" : "flex-start", justifyContent: "center", padding: portrait ? `0 ${70 * u}px` : `0 ${160 * u}px` }}>
      <div style={{ width: "100%", maxWidth: 1400 * u }}>
        <div style={{ fontFamily: font, fontWeight: 800, fontSize: (portrait ? 60 : 70) * u, color: INK, marginBottom: 36 * u, textAlign: portrait ? "center" : "left" }}>{rich(s.title, accent)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 * u }}>
          {s.items.map((it, i) => {
            const e = stagger(frame, fps, i, 12, 9);
            return (
              <React.Fragment key={i}>
                <Sfx file={tick} at={12 + i * 9} volume={0.22} />
                <div style={{ display: "flex", alignItems: "center", gap: 26 * u, background: CARD, border: `1px solid ${HAIR}`, borderRadius: 16 * u, padding: `${20 * u}px ${28 * u}px`, opacity: e, transform: `translateY(${interpolate(e, [0, 1], [28, 0])}px)` }}>
                  <span style={{ fontFamily: font, fontWeight: 800, fontSize: 48 * u, color: accent, minWidth: 60 * u }}>{i + 1}</span>
                  <span style={{ fontFamily: font, fontWeight: 700, fontSize: 40 * u, color: INK, minWidth: 320 * u }}>{it.name}</span>
                  <span style={{ fontFamily: font, fontWeight: 500, fontSize: 32 * u, color: MUTED }}>{rich(it.note, accent)}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Bars: React.FC<{ s: Extract<Scene, { type: "bars" }>; accent: string; tick?: string }> = ({ s, accent, tick }) => {
  const { u, portrait, font, ink: INK, muted: MUTED, hair: HAIR, card: CARD } = useUnit();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const max = Math.max(...s.data.map((d) => d.value), 1);
  const unit = s.unit ?? "";
  return (
    <AbsoluteFill style={{ alignItems: portrait ? "center" : "flex-start", justifyContent: "center", padding: portrait ? `0 ${70 * u}px` : `0 ${160 * u}px` }}>
      <div style={{ width: "100%", maxWidth: 1400 * u }}>
        <div style={{ fontFamily: font, fontWeight: 800, fontSize: (portrait ? 58 : 66) * u, color: INK, marginBottom: 40 * u, textAlign: portrait ? "center" : "left" }}>{rich(s.title, accent)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 * u }}>
          {s.data.map((d, i) => {
            const e = stagger(frame, fps, i, 10, 8);
            const w = (d.value / max) * 100 * e;
            const dec = (String(d.value).split(".")[1] || "").length;
            return (
              <div key={i}>
                <Sfx file={tick} at={10 + i * 8} volume={0.2} />
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 * u }}>
                  <span style={{ fontFamily: font, fontWeight: 600, fontSize: 34 * u, color: INK }}>{d.label}</span>
                  <span style={{ fontFamily: font, fontWeight: 800, fontSize: 34 * u, color: accent }}>{(d.value * e).toFixed(dec)}{unit}</span>
                </div>
                <div style={{ height: 34 * u, background: CARD, border: `1px solid ${HAIR}`, borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${w}%`, background: `linear-gradient(90deg, ${accent}, ${accent}99)`, borderRadius: 999, boxShadow: `0 0 20px ${accent}88` }} />
                </div>
              </div>
            );
          })}
        </div>
        {s.source ? <div style={{ fontFamily: font, fontSize: 24 * u, color: MUTED, marginTop: 28 * u }}>{s.source}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const Headlines: React.FC<{ s: Extract<Scene, { type: "headlines" }>; accent: string; tick?: string }> = ({ s, accent, tick }) => {
  const { u, portrait, font, ink: INK, hair: HAIR, bg: BG } = useUnit();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: portrait ? `0 ${70 * u}px` : `0 ${150 * u}px` }}>
      <div style={{ width: "100%", maxWidth: 1500 * u }}>
        <div style={{ fontFamily: font, fontWeight: 800, fontSize: (portrait ? 56 : 64) * u, color: INK, marginBottom: 36 * u, textAlign: "center" }}>{rich(s.heading, accent)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 * u }}>
          {s.items.map((it, i) => {
            const e = stagger(frame, fps, i, 8, 10);
            const float = Math.sin((frame + i * 40) / 30) * 6 * u;
            const tilt = (i % 2 === 0 ? -1 : 1) * 1.2;
            return (
              <React.Fragment key={i}>
                <Sfx file={tick} at={8 + i * 10} volume={0.22} />
                <div style={{ display: "flex", gap: 22 * u, alignItems: "center", background: "rgba(255,255,255,0.07)", border: `1px solid ${HAIR}`, borderRadius: 16 * u, padding: `${22 * u}px ${28 * u}px`, boxShadow: "0 20px 50px rgba(0,0,0,0.45)", opacity: e, transform: `translateX(${interpolate(e, [0, 1], [120, 0])}px) translateY(${float}px) rotate(${interpolate(e, [0, 1], [tilt * 3, tilt])}deg)` }}>
                  <span style={{ fontFamily: font, fontWeight: 800, fontSize: 22 * u, color: BG, background: accent, padding: `${8 * u}px ${16 * u}px`, borderRadius: 8 * u, whiteSpace: "nowrap" }}>{it.source.toUpperCase()}</span>
                  <span style={{ fontFamily: font, fontWeight: 600, fontSize: 36 * u, color: INK, lineHeight: 1.2 }}>{rich(it.title, accent)}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const renderScene = (s: Scene, accent: string, sfx?: SfxMap) => {
  const tick = sfx?.tick;
  switch (s.type) {
    case "hook": return <Hook s={s} accent={accent} />;
    case "point": return <Point s={s} accent={accent} tick={tick} />;
    case "stat": return <Stat s={s} accent={accent} />;
    case "quote": return <Quote s={s} accent={accent} />;
    case "outro": return <Outro s={s} accent={accent} />;
    case "tool": return <Tool s={s} accent={accent} tick={tick} />;
    case "compare": return <Compare s={s} accent={accent} tick={tick} />;
    case "bars": return <Bars s={s} accent={accent} tick={tick} />;
    case "headlines": return <Headlines s={s} accent={accent} tick={tick} />;
  }
};

const ENTRANCE_SFX: Record<Scene["type"], keyof SfxMap> = {
  hook: "riser", headlines: "ding", point: "whoosh", stat: "boom", bars: "riser", quote: "whoosh", tool: "click", compare: "whoosh", outro: "ding",
};

/* ------------------------------------------------------------------ *
 * COMPOSITION
 * ------------------------------------------------------------------ */
export const AINews: React.FC<AINewsProps> = ({ channelName, topicTag, accent, template, source, music, sfx, showCaptions, scenes }) => {
  const { durationInFrames } = useVideoConfig();
  const tpl = resolveTpl(template, topicTag, accent);
  let cursor = 0;
  return (
    <TplCtx.Provider value={tpl}>
      <AbsoluteFill style={{ background: tpl.bg, overflow: "hidden" }}>
        {music ? (
          <Audio src={staticFile(music)} loop volume={(f) => interpolate(f, [0, 20, durationInFrames - 30, durationInFrames], [0, 0.16, 0.16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
        ) : null}
        <TemplateBackground tpl={tpl} accent={tpl.accent} />

        {scenes.map((s, i) => {
          const from = cursor;
          cursor += s.durationInFrames;
          return (
            <Sequence key={i} from={from} durationInFrames={s.durationInFrames}>
              <SceneBg broll={s.broll} bgImage={s.bgImage} accent={tpl.accent} />
              {s.audio ? <Audio src={staticFile(s.audio)} /> : null}
              <Sfx file={sfx?.[ENTRANCE_SFX[s.type]]} at={0} volume={ENTRANCE_SFX[s.type] === "boom" ? 0.6 : ENTRANCE_SFX[s.type] === "ding" ? 0.45 : 0.5} />
              <SceneShell dur={s.durationInFrames} idx={i} accent={tpl.accent}>
                {renderScene(s, tpl.accent, sfx)}
              </SceneShell>
              {showCaptions && s.captions?.length ? <Captions cues={s.captions} accent={tpl.accent} /> : null}
            </Sequence>
          );
        })}

        <BrandBar channelName={channelName} topicTag={topicTag} accent={tpl.accent} />
        <SourceTag source={source} />
        <ProgressBar accent={tpl.accent} />
      </AbsoluteFill>
    </TplCtx.Provider>
  );
};
