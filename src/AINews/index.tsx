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

const personEntitySchema = z.object({
  type: z.literal("person"),
  name: z.string(),
  role: z.string().optional(),
  gender: z.enum(["man", "woman", "unspecified"]).optional(),
  age: z.enum(["child", "adult", "elder"]).optional(),
  pose: z.enum(["standing", "walking", "sitting", "reaching", "pointing", "surprised", "worried", "running", "kneeling"]).optional(),
  mood: z.enum(["neutral", "hopeful", "sad", "angry", "scared", "worried", "determined"]).optional(),
});
const animalEntitySchema = z.object({
  type: z.literal("animal"),
  name: z.string(),
  species: z.enum(["dog", "cat", "horse", "bird", "cow", "deer", "elephant", "tiger", "snake", "generic"]),
  action: z.enum(["standing", "walking", "running", "sitting", "flying"]).optional(),
  mood: z.enum(["neutral", "calm", "alert", "scared", "angry"]).optional(),
});
const objectEntitySchema = z.object({
  type: z.literal("object"),
  name: z.string(),
  objectType: z.enum(["phone", "letter", "key", "car", "motorcycle", "bag", "suitcase", "document", "lamp", "table", "door", "clock", "generic"]),
  state: z.enum(["normal", "highlighted", "broken", "hidden"]).optional(),
});
const storyEntitySchema = z.discriminatedUnion("type", [
  personEntitySchema,
  animalEntitySchema,
  objectEntitySchema,
]);

const narr = {
  vo: z.string().optional(),
  audio: z.string().optional(),
  captions: z.array(cueSchema).optional(),
  broll: z.string().optional(),
  bgImage: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  visual: z.enum(["timeline", "clue", "location", "reveal", "counter", "silhouette"]).optional(),
  setting: z.enum(["home", "street", "office", "forest", "train", "court", "hospital", "city", "room", "mountain", "sea", "interior", "night"]).optional(),
  locationLabel: z.string().optional(),
  camera: z.enum(["wide", "medium", "close", "overhead"]).optional(),
  characters: z.array(z.object({
    name: z.string(),
    role: z.string().optional(),
    gender: z.enum(["man", "woman", "unspecified"]).optional(),
    pose: z.enum(["standing", "walking", "sitting", "reaching", "pointing", "surprised", "worried", "running", "kneeling"]).optional(),
    mood: z.enum(["neutral", "hopeful", "sad", "angry", "scared", "worried", "determined"]).optional(),
  })).max(3).optional(),
  entities: z.array(storyEntitySchema).max(5).optional(),
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
type StoryEntity = z.infer<typeof storyEntitySchema>;

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
const SceneShell: React.FC<{ dur: number; idx: number; accent: string; storyMode?: boolean; children: React.ReactNode }> = ({ dur, idx, accent, storyMode = false, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, mass: 0.5 } });
  const dir = idx % 2 === 0 ? 1 : -1;
  const inX = interpolate(enter, [0, 1], [(storyMode ? 16 : 70) * dir, 0]);
  const punch = interpolate(enter, [0, 1], [storyMode ? 1.02 : 1.06, 1]);
  const inOp = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: "clamp" });
  const p = clamp01(frame / dur);
  const camScale = storyMode ? 1 : interpolate(p, [0, 1], [1.0, 1.05]);
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

const StoryCharacter: React.FC<{
  name: string;
  role?: string;
  gender?: "man" | "woman" | "unspecified";
  age?: "child" | "adult" | "elder";
  pose?: "standing" | "walking" | "sitting" | "reaching" | "pointing" | "surprised" | "worried" | "running" | "kneeling";
  mood?: "neutral" | "hopeful" | "sad" | "angry" | "scared" | "worried" | "determined";
  accent: string;
  x: number;
  scale?: number;
  frame: number;
  landscape: boolean;
}> = ({ name, role, gender = "unspecified", age = "adult", pose = "standing", mood = "neutral", accent, x, scale = 1, frame, landscape }) => {
  const { u } = useUnit();
  const isScared = mood === "scared";
  const isAngry = mood === "angry";
  const skin = "#C98A67";
  const shirt = isAngry ? accent : gender === "woman" ? "#B7A1E8" : "#6F9DB8";
  const legShift = pose === "walking" || pose === "running" ? Math.sin(frame / (pose === "running" ? 4 : 7)) * 16 * u : 0;
  const armRotation = pose === "pointing" ? -28 : pose === "reaching" ? -62 : pose === "surprised" ? 18 : pose === "running" ? -24 : 0;
  const headScale = pose === "worried" || isScared ? 0.96 : 1;
  const hair = age === "elder" ? "#AEB2B7" : "#171923";
  const headY = age === "child" ? 168 : 158;

  return (
    <div style={{ position: "absolute", left: x * u, bottom: (landscape ? 220 : 190) * u, width: 280 * u, height: 650 * u, transform: `scale(${scale * (age === "child" ? 0.82 : 1)})`, transformOrigin: "bottom center" }}>
      <svg width="100%" height="100%" viewBox="0 0 280 650" role="img" aria-label={`${name}${role ? `, ${role}` : ""}`}>
        <ellipse cx="140" cy="624" rx="112" ry="18" fill="rgba(0,0,0,0.38)" />
        {gender === "woman" ? <path d={`M58 ${headY + 28} C45 56 233 54 222 ${headY + 28} L220 286 L60 286Z`} fill={hair} /> : null}
        <circle cx="140" cy={headY} r={age === "child" ? 88 : 82} fill={skin} transform={`scale(${headScale})`} style={{ transformOrigin: `140px ${headY}px` }} />
        <path d={`M62 ${headY - 21} C74 50 206 48 218 ${headY - 21} C198 ${headY - 50} 166 ${headY - 66} 140 ${headY - 66} C114 ${headY - 66} 82 ${headY - 50} 62 ${headY - 21}Z`} fill={hair} />
        {mood === "sad" || mood === "scared" || mood === "worried" ? (
          <path d="M104 188 Q140 166 176 188" fill="none" stroke="#4B2331" strokeWidth="7" strokeLinecap="round" />
        ) : (
          <path d="M108 188 Q140 205 172 188" fill="none" stroke="#4B2331" strokeWidth="7" strokeLinecap="round" />
        )}
        <circle cx="108" cy="158" r="7" fill="#171923" />
        <circle cx="172" cy="158" r="7" fill="#171923" />
        {isAngry ? (
          <>
            <path d="M92 142 L118 152" stroke="#171923" strokeWidth="8" strokeLinecap="round" />
            <path d="M188 142 L162 152" stroke="#171923" strokeWidth="8" strokeLinecap="round" />
          </>
        ) : null}
        <path d={gender === "woman" ? "M140 240 C82 240 54 302 48 430 L232 430 C226 302 198 240 140 240Z M48 430 L232 430 L254 560 L26 560Z" : "M140 240 C82 240 54 302 48 430 L232 430 C226 302 198 240 140 240Z"} fill={shirt} />
        <path d="M140 240 L140 430" stroke="rgba(20,30,50,0.14)" strokeWidth="4" />
        <g style={{ transform: `rotate(${armRotation}deg)`, transformOrigin: "62px 298px" }}>
          <path d="M68 278 C28 326 18 388 24 452" fill="none" stroke={skin} strokeWidth="42" strokeLinecap="round" />
        </g>
        <g style={{ transform: `rotate(${armRotation * -0.5}deg)`, transformOrigin: "218px 298px" }}>
          <path d="M212 278 C252 326 262 388 256 452" fill="none" stroke={skin} strokeWidth="42" strokeLinecap="round" />
        </g>
        {gender === "woman" ? null : (
          <>
            <path d="M48 430 L232 430 L216 610 L155 610 L140 454 L125 610 L64 610Z" fill="#20283A" />
            <path d="M125 610 L64 610 L58 638 L132 638Z" fill="#111827" transform={`translate(${-legShift},0)`} />
            <path d="M155 610 L216 610 L222 638 L148 638Z" fill="#111827" transform={`translate(${legShift},0)`} />
          </>
        )}
      </svg>
      <div style={{ position: "absolute", left: "50%", bottom: -10 * u, transform: "translateX(-50%)", minWidth: 180 * u, textAlign: "center", fontFamily: "inherit", fontWeight: 800, fontSize: 24 * u, color: "#FFFFFF", background: "rgba(7,11,22,0.82)", border: `1px solid ${accent}`, borderRadius: 999, padding: `${7 * u}px ${16 * u}px`, whiteSpace: "nowrap" }}>
        {name}
        {role ? <div style={{ fontSize: 16 * u, color: accent, marginTop: 2 * u }}>{role}</div> : null}
      </div>
    </div>
  );
};

const StoryAnimal: React.FC<{
  entity: Extract<StoryEntity, { type: "animal" }>;
  accent: string;
  x: number;
  frame: number;
  scale: number;
  landscape: boolean;
}> = ({ entity, accent, x, frame, scale, landscape }) => {
  const { u } = useUnit();
  const step = entity.action === "walking" || entity.action === "running" ? Math.sin(frame / (entity.action === "running" ? 4 : 7)) * 8 : 0;
  const body = entity.species === "snake" ? (
    <path d="M35 165 C75 70 115 205 160 110 C180 65 212 120 210 155" fill="none" stroke="#71936A" strokeWidth="26" strokeLinecap="round" />
  ) : entity.species === "bird" ? (
    <>
      <ellipse cx="116" cy="145" rx="66" ry="42" fill="#68A7C9" />
      <circle cx="170" cy="103" r="32" fill="#68A7C9" />
      <path d="M194 99 L236 113 L195 124Z" fill="#E8AE43" />
      <path d="M104 137 Q68 90 91 119 Q119 91 146 139Z" fill="#9CCDE0" style={{ transform: `rotate(${Math.sin(frame / 5) * 18}deg)`, transformOrigin: "108px 128px" }} />
      <path d="M64 150 L30 128 L48 168Z" fill="#5591B1" />
      <circle cx="178" cy="97" r="4" fill="#171923" />
      {entity.action === "flying" ? null : <path d="M108 183 L103 205 M136 183 L140 205 M94 205 H110 M132 205 H148" stroke="#D99B38" strokeWidth="5" strokeLinecap="round" />}
    </>
  ) : (
    <>
      <ellipse cx="130" cy="142" rx={entity.species === "horse" || entity.species === "cow" || entity.species === "elephant" ? 82 : 65} ry="48" fill={entity.species === "elephant" ? "#89939A" : entity.species === "cow" ? "#E9E5D9" : entity.species === "tiger" ? "#D68135" : "#8D7055"} />
      {entity.species === "elephant" ? (
        <path d="M190 102 C240 112 218 175 208 194" fill="none" stroke="#89939A" strokeWidth="25" strokeLinecap="round" />
      ) : null}
      {entity.species === "horse" ? <path d="M157 111 Q170 55 206 71 L224 111 L194 130Z" fill="#795640" /> : null}
      <circle cx="200" cy="105" r={entity.species === "horse" ? 34 : 30} fill={entity.species === "elephant" ? "#89939A" : entity.species === "cow" ? "#E9E5D9" : entity.species === "tiger" ? "#D68135" : "#8D7055"} />
      {entity.species === "cat" ? <path d="M177 83 L185 48 L204 76 L220 48 L226 86" fill="#8D7055" /> : null}
      {entity.species === "dog" ? <path d="M180 87 Q160 48 178 56 L199 82 M212 82 Q242 50 238 72 L228 100" fill="#6F5542" /> : null}
      {entity.species === "cow" ? (
        <>
          <path d="M182 78 Q168 45 158 54 L171 91 M216 78 Q230 45 242 54 L228 91" fill="#E9E5D9" />
          <ellipse cx="105" cy="127" rx="22" ry="17" fill="#3D3B3B" />
          <ellipse cx="149" cy="157" rx="18" ry="13" fill="#3D3B3B" />
        </>
      ) : null}
      {entity.species === "deer" ? (
        <>
          <path d="M192 77 L180 45 L166 30 M180 45 L187 20 M219 78 L232 45 L248 30 M232 45 L225 20" fill="none" stroke="#B8A277" strokeWidth="8" strokeLinecap="round" />
          <path d="M177 84 L181 57 L197 81 L216 55 L228 84" fill="#9A7755" />
        </>
      ) : null}
      {entity.species === "elephant" ? <ellipse cx="204" cy="100" rx="38" ry="42" fill="#AEB5B8" opacity="0.8" /> : null}
      {entity.species === "tiger" ? (
        <>
          <path d="M93 112 L112 151 M126 98 L142 143 M157 105 L174 140 M189 91 L200 118" stroke="#30231B" strokeWidth="10" />
        </>
      ) : null}
      {entity.species === "horse" ? <path d="M170 82 Q180 45 207 72 L196 115Z" fill="#3B2C23" /> : null}
      <ellipse cx="208" cy="116" rx="4" ry="5" fill="#171923" />
      <circle cx="209" cy="148" r="4" fill="#171923" />
      {[0, 1, 2, 3].map((leg) => (
        <path key={leg} d={entity.action === "sitting" && leg < 2
          ? `M${85 + leg * 28} 168 Q${72 + leg * 28} 203 ${112 + leg * 28} 202`
          : `M${85 + leg * 28} 168 L${82 + leg * 28 + (leg % 2 ? step : -step)} 214`}
          stroke={entity.species === "elephant" ? "#737D84" : entity.species === "cow" ? "#E9E5D9" : "#75563F"}
          strokeWidth={entity.species === "elephant" ? 18 : 12}
          strokeLinecap="round"
        />
      ))}
      {entity.species === "dog" || entity.species === "cat" ? <path d="M70 128 Q30 100 48 78" fill="none" stroke="#8D7055" strokeWidth="10" strokeLinecap="round" /> : null}
    </>
  );
  return (
    <div style={{ position: "absolute", left: x * u, bottom: (landscape ? 250 : 220) * u, width: 270 * u, height: 245 * u, transform: `scale(${scale})`, transformOrigin: "bottom center" }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 280 240"
        role="img"
        aria-label={`${entity.name}, ${entity.species}`}
        style={entity.species === "bird" && entity.action === "flying" ? { transform: `translateY(${(-12 + Math.sin(frame / 5) * 8) * u}px)` } : undefined}
      >
        <ellipse cx="140" cy="218" rx="102" ry="14" fill="rgba(0,0,0,0.35)" />
        {body}
        {entity.mood === "alert" ? <path d="M180 50 L188 35 M207 45 L212 28" stroke={accent} strokeWidth="5" strokeLinecap="round" /> : null}
      </svg>
      <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", color: "#fff", background: "rgba(7,11,22,0.82)", border: `1px solid ${accent}`, borderRadius: 999, padding: `${5 * u}px ${13 * u}px`, fontSize: 18 * u, fontWeight: 800, whiteSpace: "nowrap" }}>
        {entity.name}
      </div>
    </div>
  );
};

const StoryObject: React.FC<{
  entity: Extract<StoryEntity, { type: "object" }>;
  accent: string;
  x: number;
  frame: number;
  scale: number;
  landscape: boolean;
}> = ({ entity, accent, x, frame, scale, landscape }) => {
  const { u } = useUnit();
  const bob = Math.sin(frame / 14) * 4 * u;
  const metal = "#BCC8D6";
  const dark = "#273245";
  const object = (() => {
    switch (entity.objectType) {
      case "phone":
        return <><rect x="83" y="24" width="74" height="144" rx="13" fill={dark} stroke={metal} strokeWidth="5" /><rect x="91" y="38" width="58" height="111" rx="4" fill="#182B38" /><circle cx="120" cy="158" r="4" fill={metal} /></>;
      case "letter":
      case "document":
        return <><path d="M60 38 H180 V166 H60Z" fill="#E8D8B8" stroke="#9D8357" strokeWidth="5" /><path d="M78 70 H162 M78 90 H153 M78 110 H160 M78 130 H139" stroke="#796A58" strokeWidth="5" /></>;
      case "key":
        return <><circle cx="91" cy="93" r="34" fill="none" stroke={metal} strokeWidth="14" /><path d="M123 93 H198 V110 H180 V128 H162 V110 H123Z" fill={metal} /></>;
      case "car":
        return <><path d="M36 116 L53 75 Q60 62 77 62 H161 Q176 62 188 83 L205 116 V151 H36Z" fill="#557C9A" stroke={metal} strokeWidth="5" /><path d="M72 73 H112 V107 H57Z M124 73 H159 Q169 75 179 107 H124Z" fill="#B7D3E2" /><circle cx="73" cy="151" r="17" fill="#111722" stroke={metal} strokeWidth="5" /><circle cx="169" cy="151" r="17" fill="#111722" stroke={metal} strokeWidth="5" /></>;
      case "motorcycle":
        return <><circle cx="65" cy="144" r="25" fill="none" stroke={metal} strokeWidth="8" /><circle cx="183" cy="144" r="25" fill="none" stroke={metal} strokeWidth="8" /><path d="M65 144 L103 92 L142 144 H183 L146 99 H117 L103 92 M142 144 L159 103 H183" fill="none" stroke="#6688A2" strokeWidth="11" strokeLinejoin="round" /></>;
      case "bag":
      case "suitcase":
        return <><rect x="52" y="65" width="136" height="104" rx={entity.objectType === "bag" ? "28" : "10"} fill="#8A5E43" stroke={metal} strokeWidth="5" /><path d="M96 65 V48 Q96 34 110 34 H132 Q146 34 146 48 V65" fill="none" stroke={metal} strokeWidth="8" /><path d="M120 80 V156" stroke="#D3AC78" strokeWidth="5" /></>;
      case "lamp":
        return <><path d="M77 72 H163 L145 110 H95Z" fill="#E7BE62" /><path d="M120 110 V170 M88 174 H152" stroke={metal} strokeWidth="9" strokeLinecap="round" /><circle cx="120" cy="88" r="64" fill="#F6D778" opacity="0.08" /></>;
      case "table":
        return <><rect x="42" y="92" width="156" height="24" rx="5" fill="#8B6544" /><path d="M62 116 V178 M178 116 V178" stroke="#765339" strokeWidth="14" /></>;
      case "door":
        return <><rect x="66" y="28" width="110" height="150" rx="4" fill="#73543E" stroke={metal} strokeWidth="6" /><circle cx="154" cy="105" r="6" fill="#E6C16B" /></>;
      case "clock":
        return <><circle cx="120" cy="100" r="68" fill={dark} stroke={metal} strokeWidth="8" /><path d="M120 100 V55 M120 100 L156 118" stroke="#F0D78E" strokeWidth="7" strokeLinecap="round" /><circle cx="120" cy="100" r="6" fill="#F0D78E" /></>;
      default:
        return <><rect x="56" y="58" width="128" height="104" rx="14" fill="#667A8B" stroke={metal} strokeWidth="5" /><circle cx="120" cy="110" r="22" fill="#A8BBC9" /></>;
    }
  })();
  const hidden = entity.state === "hidden";
  return (
    <div style={{ position: "absolute", left: x * u, bottom: (landscape ? 310 : 300) * u + bob, width: 240 * u, height: 220 * u, transform: `scale(${scale})`, transformOrigin: "bottom center", opacity: hidden ? 0.48 : 1 }}>
      <svg width="100%" height="100%" viewBox="0 0 240 210" role="img" aria-label={`${entity.name}, ${entity.objectType}`}>
        {entity.state === "highlighted" ? <ellipse cx="120" cy="108" rx="105" ry="92" fill="none" stroke={accent} strokeWidth="4" strokeDasharray="12 9" opacity={0.45 + Math.sin(frame / 8) * 0.25} /> : null}
        {object}
        {entity.state === "broken" ? <path d="M120 42 L104 92 L133 101 L112 162" fill="none" stroke="#F5E7D7" strokeWidth="5" /> : null}
      </svg>
      <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", color: "#fff", background: "rgba(7,11,22,0.82)", border: `1px solid ${accent}`, borderRadius: 999, padding: `${5 * u}px ${13 * u}px`, fontSize: 18 * u, fontWeight: 800, whiteSpace: "nowrap" }}>
        {entity.name}
      </div>
    </div>
  );
};

const StoryEnvironment: React.FC<{
  setting: string;
  accent: string;
  frame: number;
}> = ({ setting, accent, frame }) => {
  const { u, portrait } = useUnit();
  const landscape = !portrait;
  const drift = Math.sin(frame / 18) * 8 * u;
  const slow = interpolate(frame, [0, 240], [0, 1], { extrapolateRight: "clamp" });

  if (setting === "forest") {
    const trees = landscape ? Array.from({ length: 10 }, (_, i) => i * 210 - 100) : [-120, 40, 220, 760, 930];
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 210 * u, height: 520 * u, background: "linear-gradient(180deg,transparent,rgba(4,18,14,0.82))" }} />
        {trees.map((x, i) => (
          <div key={x} style={{ position: "absolute", left: (x + (i % 2 ? drift : -drift)) * u, bottom: 220 * u, width: 210 * u, height: (620 + i * 22) * u, transform: `rotate(${i % 2 ? -2 : 2}deg)` }}>
            <div style={{ position: "absolute", left: 96 * u, bottom: 0, width: 18 * u, height: 520 * u, background: "#38251B", borderRadius: 9 * u }} />
            {[0, 1, 2, 3].map((n) => (
              <div key={n} style={{ position: "absolute", left: -30 * u + n * 16 * u, top: 20 * u + n * 86 * u, width: (170 - n * 18) * u, height: (150 - n * 12) * u, borderRadius: "50%", background: n % 2 ? "#1D4A38" : "#285C43", boxShadow: "0 18px 40px rgba(0,0,0,0.28)" }} />
            ))}
          </div>
        ))}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220 * u, background: "linear-gradient(180deg,#1A3A2B,#091511)" }} />
      </AbsoluteFill>
    );
  }

  if (setting === "street" || setting === "city") {
    const buildings = Array.from({ length: landscape ? 9 : 5 }, (_, i) => i);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 210 * u, height: 430 * u, background: "linear-gradient(180deg,rgba(31,43,66,0.12),rgba(8,12,20,0.94))" }} />
        {buildings.map((n) => (
          <div key={n} style={{ position: "absolute", left: (n * 240 - 70) * u, bottom: 210 * u, width: (180 + n % 2 * 70) * u, height: (310 + n * 32) * u, background: "linear-gradient(150deg,rgba(28,38,59,0.96),rgba(7,10,18,0.96))", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 24px 60px rgba(0,0,0,0.32)" }}>
            {[0, 1, 2, 3].map((r) => (
              <div key={r} style={{ position: "absolute", left: (18 + r % 2 * 70) * u, top: (22 + r * 62) * u, width: 42 * u, height: 34 * u, background: r % 3 === 0 ? `${accent}88` : "rgba(180,210,230,0.18)", boxShadow: r % 3 === 0 ? `0 0 18px ${accent}44` : "none" }} />
            ))}
          </div>
        ))}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 215 * u, background: "linear-gradient(180deg,#26303A,#0B0E13)" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 170 * u, height: 4 * u, background: "repeating-linear-gradient(90deg,rgba(255,255,255,0.22) 0 90px,transparent 90px 150px)" }} />
        <div style={{ position: "absolute", right: 130 * u, bottom: 190 * u, width: 4 * u, height: 620 * u, background: "#1B2330" }}>
          <div style={{ position: "absolute", left: -38 * u, top: 0, width: 80 * u, height: 12 * u, background: "#1B2330", transform: "rotate(-8deg)" }} />
        </div>
      </AbsoluteFill>
    );
  }

  if (setting === "room" || setting === "home" || setting === "office" || setting === "interior") {
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 90 * u, right: 90 * u, top: 330 * u, bottom: 220 * u, border: "2px solid rgba(255,255,255,0.08)", background: "linear-gradient(145deg,rgba(255,255,255,0.025),rgba(0,0,0,0.18))" }}>
          <div style={{ position: "absolute", left: 64 * u, top: 92 * u, width: 210 * u, height: 150 * u, background: "#151A25", border: "14px solid #2A3040", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}>
            <div style={{ position: "absolute", left: 30 * u, top: 25 * u, width: 120 * u, height: 8 * u, background: accent, opacity: 0.65 }} />
            <div style={{ position: "absolute", left: 30 * u, top: 52 * u, width: 80 * u, height: 8 * u, background: "rgba(255,255,255,0.16)" }} />
          </div>
          <div style={{ position: "absolute", right: 72 * u, top: 130 * u, width: 300 * u, height: 240 * u, border: "14px solid #252A38", background: "linear-gradient(135deg,rgba(155,202,230,0.22),rgba(255,255,255,0.04))" }}>
            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2 * u, background: "rgba(255,255,255,0.16)" }} />
          </div>
          <div style={{ position: "absolute", left: 70 * u, right: 70 * u, bottom: 80 * u, height: 100 * u, background: "#171A22", borderRadius: "12px 12px 0 0", boxShadow: "0 -18px 30px rgba(0,0,0,0.24)" }} />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220 * u, background: "linear-gradient(180deg,#261F29,#120F16)" }} />
      </AbsoluteFill>
    );
  }

  if (setting === "court") {
    const seats = Array.from({ length: landscape ? 8 : 4 }, (_, i) => i);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 70 * u, right: 70 * u, top: 300 * u, bottom: 220 * u, background: "linear-gradient(180deg,rgba(104,77,49,0.28),rgba(15,12,10,0.72))", border: "2px solid rgba(255,255,255,0.08)" }}>
          <div style={{ position: "absolute", left: "50%", top: 30 * u, transform: "translateX(-50%)", width: 360 * u, height: 150 * u, background: "#3A2C20", border: `3px solid ${accent}66`, borderRadius: "0 0 180px 180px", boxShadow: "0 20px 50px rgba(0,0,0,0.32)" }} />
          {seats.map((n) => (
            <div key={n} style={{ position: "absolute", left: (190 + n * 175) * u, top: 250 * u, width: 110 * u, height: 120 * u, background: "#2A211A", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px 18px 8px 8px" }} />
          ))}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220 * u, background: "#17120F" }} />
      </AbsoluteFill>
    );
  }

  if (setting === "hospital") {
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 70 * u, right: 70 * u, top: 300 * u, bottom: 220 * u, background: "rgba(211,236,239,0.06)", border: "2px solid rgba(255,255,255,0.08)" }}>
          <div style={{ position: "absolute", left: 80 * u, top: 100 * u, width: (landscape ? 980 : 620) * u, height: 300 * u, background: "#AABBC0", opacity: 0.16, borderRadius: 18 * u, border: "8px solid rgba(255,255,255,0.10)" }} />
          <div style={{ position: "absolute", right: 110 * u, top: 150 * u, width: 180 * u, height: 260 * u, background: "#D8EDF0", opacity: 0.12, borderRadius: "90px 90px 18px 18px" }} />
          <div style={{ position: "absolute", left: "50%", top: 90 * u, transform: "translateX(-50%)", color: accent, fontSize: 72 * u, fontWeight: 800, opacity: 0.55 }}>+</div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220 * u, background: "#183038" }} />
      </AbsoluteFill>
    );
  }

  if (setting === "train") {
    const windows = Array.from({ length: landscape ? 7 : 4 }, (_, i) => i);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 55 * u, right: 55 * u, top: 300 * u, bottom: 220 * u, borderRadius: "50px 50px 20px 20px", background: "linear-gradient(180deg,#314157,#111827)", border: "3px solid rgba(255,255,255,0.10)" }}>
          {windows.map((n) => (
            <div key={n} style={{ position: "absolute", left: (120 + n * (landscape ? 235 : 220)) * u, top: 80 * u, width: 150 * u, height: 260 * u, background: "linear-gradient(135deg,rgba(161,210,229,0.30),rgba(255,255,255,0.05))", border: "10px solid #1A2433", transform: `translateX(${drift * (n % 2 ? 0.4 : -0.4)}px)` }} />
          ))}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220 * u, background: "#151923" }} />
      </AbsoluteFill>
    );
  }

  if (setting === "mountain") {
    const peaks = Array.from({ length: landscape ? 5 : 3 }, (_, i) => i);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {peaks.map((n) => (
          <div key={n} style={{ position: "absolute", left: (n * (landscape ? 410 : 330) - 100) * u, bottom: 210 * u, width: (landscape ? 600 : 520) * u, height: (620 - n % 3 * 40) * u, background: n % 2 ? "#4C5966" : "#384650", clipPath: "polygon(50% 0,100% 100%,0 100%)", opacity: 0.86, transform: `translateX(${drift * n * 0.25}px)` }}>
            <div style={{ position: "absolute", left: "24%", top: 0, width: "52%", height: "26%", background: "rgba(230,238,240,0.72)", clipPath: "polygon(50% 0,100% 100%,68% 72%,50% 100%,34% 72%,0 100%)" }} />
          </div>
        ))}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220 * u, background: "#18221E" }} />
      </AbsoluteFill>
    );
  }

  if (setting === "sea") {
    const waves = Array.from({ length: landscape ? 8 : 5 }, (_, i) => i);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 210 * u, height: 520 * u, background: "linear-gradient(180deg,#477B92,#17384D)" }} />
        {waves.map((n) => (
          <div key={n} style={{ position: "absolute", left: (-100 + n * (landscape ? 270 : 240) + drift) * u, bottom: (360 - n % 2 * 80) * u, width: 300 * u, height: 16 * u, borderRadius: "50%", borderTop: `4px solid rgba(255,255,255,${0.18 + n * 0.03})`, transform: `rotate(${n % 2 ? 2 : -2}deg)` }} />
        ))}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220 * u, background: "#0E1B24" }} />
      </AbsoluteFill>
    );
  }

  if (setting === "night") {
    const stars = Array.from({ length: landscape ? 10 : 5 }, (_, i) => i);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {stars.map((n) => (
          <div key={n} style={{ position: "absolute", left: (120 + n * (landscape ? 185 : 220) + drift) * u, top: (300 + n % 2 * 140) * u, width: 4 * u, height: 4 * u, borderRadius: "50%", background: "#FFF3C4", boxShadow: "0 0 18px rgba(255,243,196,0.75)", opacity: 0.5 + n * 0.04 }} />
        ))}
        <div style={{ position: "absolute", right: 120 * u, top: 290 * u, width: 140 * u, height: 140 * u, borderRadius: "50%", background: "rgba(220,230,255,0.78)", boxShadow: "0 0 80px rgba(180,205,255,0.24)" }} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 210 * u, height: 560 * u, background: "linear-gradient(180deg,transparent,rgba(0,0,0,0.35))" }} />
      <div style={{ position: "absolute", right: 80 * u, bottom: 260 * u, width: 300 * u, height: 300 * u, borderRadius: "50%", border: `2px solid ${accent}33`, transform: `scale(${0.8 + slow * 0.2})` }} />
    </AbsoluteFill>
  );
};

const KannadaCharacterScene: React.FC<{
  scene: Scene;
  accent: string;
}> = ({ scene, accent }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const { u, portrait } = useUnit();
  const landscape = !portrait;
  const enter = clamp01(spring({ frame, fps, config: { damping: 16, mass: 0.65 } }));
  const progress = interpolate(frame, [0, scene.durationInFrames], [0, 1], { extrapolateRight: "clamp" });
  const camera = scene.camera || "wide";
  const zoom = camera === "close"
    ? interpolate(progress, [0, 1], [1.08, 1.16])
    : camera === "medium"
      ? interpolate(progress, [0, 1], [1.03, 1.09])
      : camera === "overhead"
        ? interpolate(progress, [0, 1], [1.02, 1.05])
        : interpolate(progress, [0, 1], [1, 1.04]);
  const pan = interpolate(progress, [0, 1], [camera === "close" ? 9 : -14, camera === "close" ? -9 : 14]);
  const cameraTransform = `${camera === "overhead" ? "perspective(1600px) rotateX(7deg) " : ""}scale(${zoom}) translate3d(${pan * u}px,${camera === "medium" ? -4 * progress * u : 0}px,0)`;
  const setting = scene.setting || "night";
  const backgrounds: Record<string, string> = {
    home: "linear-gradient(160deg,#2D3558 0%,#101526 60%,#090B12 100%)",
    street: "linear-gradient(160deg,#31435C 0%,#172238 58%,#090B12 100%)",
    office: "linear-gradient(160deg,#334258 0%,#151F33 58%,#090B12 100%)",
    forest: "linear-gradient(160deg,#183B34 0%,#10231F 58%,#090B12 100%)",
    train: "linear-gradient(160deg,#36445A 0%,#1A2435 58%,#090B12 100%)",
    court: "linear-gradient(160deg,#52402D 0%,#211A14 58%,#090B12 100%)",
    hospital: "linear-gradient(160deg,#355C68 0%,#17333E 58%,#090B12 100%)",
    city: "linear-gradient(160deg,#31445D 0%,#171F32 58%,#090B12 100%)",
    room: "linear-gradient(160deg,#543A4D 0%,#291C28 58%,#090B12 100%)",
    mountain: "linear-gradient(160deg,#44586A 0%,#1B2A3A 58%,#090B12 100%)",
    sea: "linear-gradient(160deg,#315D78 0%,#17364B 58%,#090B12 100%)",
    interior: "linear-gradient(160deg,#4B3C31 0%,#251B16 58%,#090B12 100%)",
    night: "linear-gradient(160deg,#212C4A 0%,#10162B 58%,#090B12 100%)",
  };
  const entities: StoryEntity[] = scene.entities?.slice(0, 5) || (scene.characters || []).slice(0, 3).map((character) => ({
    type: "person" as const,
    ...character,
  }));
  const stageWidth = width / u;
  const entityPositions = landscape
    ? entities.length === 1
      ? [stageWidth / 2 - 140]
      : entities.length === 2
        ? [stageWidth * 0.28 - 140, stageWidth * 0.72 - 140]
        : entities.length === 3
          ? [stageWidth * 0.18 - 140, stageWidth * 0.5 - 140, stageWidth * 0.82 - 140]
          : entities.length === 4
            ? [stageWidth * 0.08 - 140, stageWidth * 0.36 - 140, stageWidth * 0.64 - 140, stageWidth * 0.92 - 140]
            : [stageWidth * 0.03 - 140, stageWidth * 0.265 - 140, stageWidth * 0.5 - 140, stageWidth * 0.735 - 140, stageWidth * 0.97 - 140]
    : entities.length === 1
      ? [400]
      : entities.length === 2
        ? [220, 580]
        : entities.length === 3
          ? [80, 400, 720]
          : entities.length === 4
            ? [0, 260, 520, 780]
            : [-30, 190, 410, 630, 850];
  const entityScale = landscape
    ? entities.length > 3 ? 0.62 : entities.length > 1 ? 0.8 : 0.92
    : entities.length > 3 ? 0.72 : entities.length > 1 ? 0.9 : 1.05;

  const copy = scene.type === "hook"
    ? scene.headline
    : scene.type === "point"
      ? scene.heading
      : scene.type === "quote"
        ? scene.quote
        : scene.type === "outro"
          ? scene.headline
          : "";

  return (
    <AbsoluteFill style={{ background: backgrounds[setting], opacity: enter }}>
      <AbsoluteFill style={{ transform: cameraTransform, transformOrigin: "50% 70%", willChange: "transform" }}>
        <StoryEnvironment setting={setting} accent={accent} frame={frame} />
        {entities.map((entity, i) => {
          const x = entityPositions[i];
          if (entity.type === "person") {
            return (
              <StoryCharacter
                key={`${entity.type}-${entity.name}-${i}`}
                name={entity.name}
                role={entity.role}
                gender={entity.gender}
                age={entity.age}
                pose={entity.pose}
                mood={entity.mood}
                accent={accent}
                x={x}
                scale={entityScale}
                frame={frame}
                landscape={landscape}
              />
            );
          }
          if (entity.type === "animal") {
            return <StoryAnimal key={`${entity.type}-${entity.name}-${i}`} entity={entity} accent={accent} x={x} scale={entityScale} frame={frame} landscape={landscape} />;
          }
          return <StoryObject key={`${entity.type}-${entity.name}-${i}`} entity={entity} accent={accent} x={x} scale={entityScale} frame={frame} landscape={landscape} />;
        })}
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: (landscape ? 300 : 420) * u, background: "linear-gradient(180deg,rgba(0,0,0,0.45),transparent)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: (landscape ? 72 : 54) * u, top: (landscape ? 118 : 190) * u, display: "flex", alignItems: "center", gap: 14 * u }}>
        <div style={{ width: 12 * u, height: 12 * u, borderRadius: "50%", background: accent, boxShadow: `0 0 22px ${accent}` }} />
        <div style={{ fontFamily: "inherit", fontWeight: 800, fontSize: 22 * u, letterSpacing: 2 * u, color: "rgba(255,255,255,0.78)", textTransform: "uppercase" }}>
          {scene.locationLabel || (setting === "night" ? "ರಾತ್ರಿಯ ದೃಶ್ಯ" : setting)}
        </div>
      </div>
      {copy ? (
        <div style={{ position: "absolute", left: (landscape ? 140 : 70) * u, right: (landscape ? 140 : 70) * u, bottom: (landscape ? 54 : 62) * u, display: "flex", justifyContent: "center", textAlign: "center", opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [28, 0])}px)` }}>
          <div style={{ maxWidth: (landscape ? 1280 : 940) * u, fontFamily: "inherit", fontWeight: 800, fontSize: (landscape ? 42 : 48) * u, lineHeight: 1.12, color: "#FFFFFF", background: "rgba(7,11,22,0.82)", borderLeft: `${7 * u}px solid ${accent}`, borderRadius: 18 * u, padding: `${18 * u}px ${30 * u}px`, boxShadow: "0 18px 70px rgba(0,0,0,0.42)" }}>
            {copy}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

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

const Point: React.FC<{ s: Extract<Scene, { type: "point" }>; accent: string; tick?: string; storyMode?: boolean }> = ({ s, accent, tick, storyMode = false }) => {
  const { u, portrait, font, ink: INK, hair: HAIR, card: CARD } = useUnit();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (storyMode && s.bullets.length === 0) {
    const reveal = clamp01(spring({ frame, fps, config: { damping: 14, mass: 0.7 } }));
    return (
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: `0 ${100 * u}px` }}>
        <div style={{ width: 100 * u, height: 8 * u, background: accent, borderRadius: 999, marginBottom: 34 * u, transform: `scaleX(${reveal})`, boxShadow: `0 0 24px ${accent}` }} />
        <div style={{ maxWidth: 900 * u, fontFamily: font, fontWeight: 800, fontSize: (portrait ? 78 : 82) * u, lineHeight: 1.12, color: INK, opacity: reveal, transform: `translateY(${interpolate(reveal, [0, 1], [32, 0])}px)`, textShadow: "0 18px 60px rgba(0,0,0,0.65)" }}>{rich(s.heading, accent)}</div>
      </AbsoluteFill>
    );
  }
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

const renderScene = (s: Scene, accent: string, sfx?: SfxMap, storyMode = false) => {
  const tick = sfx?.tick;
  switch (s.type) {
    case "hook": return <Hook s={s} accent={accent} />;
    case "point": return <Point s={s} accent={accent} tick={tick} storyMode={storyMode} />;
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
export const AINews: React.FC<AINewsProps> = ({ channelName, topicTag, accent, template, source, lang, music, sfx, showCaptions, scenes }) => {
  const { durationInFrames } = useVideoConfig();
  const tpl = resolveTpl(template, topicTag, accent);
  const storyMode = lang === "kn";
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
              {storyMode ? (
                <KannadaCharacterScene scene={s} accent={tpl.accent} />
              ) : (
                <SceneBg broll={s.broll} bgImage={s.bgImage} accent={tpl.accent} />
              )}
              {s.audio ? <Audio src={staticFile(s.audio)} /> : null}
              <Sfx file={sfx?.[ENTRANCE_SFX[s.type]]} at={0} volume={ENTRANCE_SFX[s.type] === "boom" ? 0.6 : ENTRANCE_SFX[s.type] === "ding" ? 0.45 : 0.5} />
              <SceneShell dur={s.durationInFrames} idx={i} accent={tpl.accent} storyMode={storyMode}>
                {storyMode ? null : renderScene(s, tpl.accent, sfx, storyMode)}
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
