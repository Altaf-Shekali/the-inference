import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  random,
} from "remotion";
// Self-hosted fonts (public/fonts/, via `npm run fonts`) — no render-time
// network fetch from gstatic. See src/AINews/fonts.ts.
import { FONTS } from "./fonts";

const poppins = FONTS.poppins;
const oswald = FONTS.oswald;
const sora = FONTS.sora;
const archivo = FONTS.archivo;

/* A "template" is a full visual identity: font + palette + background style +
 * hero (hook) layout + brand-chrome style. One per content pillar. */
export type Tpl = {
  key: string;
  font: string;
  bg: string;
  bg2: string;
  ink: string;
  muted: string;
  hair: string;
  card: string;
  accent: string;
  bgVariant: "wire" | "spotlight" | "ledger" | "horizon";
  hero: "lowerThird" | "center" | "split" | "centerBig";
  brand: "bar" | "chip" | "minimal";
};

export const TEMPLATES: Record<string, Tpl> = {
  // AI News — sharp newsroom: condensed type, navy, lower-third hero
  wire: {
    key: "wire", font: oswald,
    bg: "#05080F", bg2: "#0B1B33", ink: "#F4F8FF",
    muted: "rgba(244,248,255,0.58)", hair: "rgba(255,255,255,0.10)", card: "rgba(255,255,255,0.05)",
    accent: "#3B9EFF", bgVariant: "wire", hero: "lowerThird", brand: "bar",
  },
  // Tool Breakdown — clean product studio: rounded type, green, centered cards
  studio: {
    key: "studio", font: poppins,
    bg: "#08120E", bg2: "#0F2A1E", ink: "#F1FFF9",
    muted: "rgba(241,255,249,0.58)", hair: "rgba(255,255,255,0.09)", card: "rgba(255,255,255,0.05)",
    accent: "#34D399", bgVariant: "spotlight", hero: "center", brand: "chip",
  },
  // Business — financial ledger: grotesk type, gold on near-black, split hero
  ledger: {
    key: "ledger", font: archivo,
    bg: "#0C0A05", bg2: "#2A1E08", ink: "#FFFCF2",
    muted: "rgba(255,252,242,0.58)", hair: "rgba(255,255,255,0.10)", card: "rgba(255,255,255,0.05)",
    accent: "#F5B301", bgVariant: "ledger", hero: "split", brand: "bar",
  },
  // Tech Trend — cinematic horizon: techy type, bold rose-red, huge centered hero
  horizon: {
    key: "horizon", font: sora,
    bg: "#0C0910", bg2: "#2A0F1A", ink: "#FFF5F6",
    muted: "rgba(255,245,246,0.58)", hair: "rgba(255,255,255,0.10)", card: "rgba(255,255,255,0.06)",
    accent: "#F43F5E", bgVariant: "horizon", hero: "centerBig", brand: "minimal",
  },
};

const TAG_TO_TPL: Record<string, string> = {
  "ai news": "wire",
  "tool breakdown": "studio",
  business: "ledger",
  "tech trend": "horizon",
};

/** pick the template by explicit key, else by pillar/topicTag; data accent wins */
export const resolveTpl = (template: string | undefined, topicTag: string, accent: string): Tpl => {
  const key = template && TEMPLATES[template] ? template : TAG_TO_TPL[(topicTag || "").toLowerCase()] || "wire";
  const t = TEMPLATES[key] || TEMPLATES.wire;
  return { ...t, accent: accent || t.accent };
};

const Particles: React.FC<{ accent: string; count?: number }> = ({ accent, count = 20 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ opacity: 0.5 }}>
      {new Array(count).fill(0).map((_, i) => {
        const x = random(`x${i}`) * width;
        const baseY = random(`y${i}`) * height;
        const speed = 0.2 + random(`s${i}`) * 0.6;
        const size = 2 + random(`z${i}`) * 5;
        const y = (baseY - frame * speed * 1.2 + height * 2) % (height + 40);
        const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((frame + i * 30) / 22));
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: size, height: size, borderRadius: "50%", background: i % 4 === 0 ? accent : "#FFFFFF", opacity: tw * 0.5 }} />
        );
      })}
    </AbsoluteFill>
  );
};

const Blob: React.FC<{ color: string; x: string; y: string; size: number; opacity: number }> = ({ color, x, y, size, opacity }) => (
  <div style={{ position: "absolute", left: x, top: y, width: size, height: size, borderRadius: "50%", background: color, opacity, filter: "blur(150px)" }} />
);

/* Distinct animated background per template. Never a static screen. */
export const TemplateBackground: React.FC<{ tpl: Tpl; accent: string }> = ({ tpl, accent }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / Math.max(1, durationInFrames);
  const grid = (frame * 0.4) % 64;
  const base = <AbsoluteFill style={{ background: `radial-gradient(circle at 30% 16%, ${tpl.bg2} 0%, ${tpl.bg} 62%)` }} />;
  const vignette = <AbsoluteFill style={{ boxShadow: "inset 0 0 400px 90px rgba(0,0,0,0.6)", pointerEvents: "none" }} />;

  if (tpl.bgVariant === "horizon") {
    return (
      <>
        {base}
        <AbsoluteFill>
          <Blob color={accent} x={`${-8 + t * 6}%`} y={`${8 + Math.sin(frame / 90) * 5}%`} size={760} opacity={0.2} />
          <Blob color="#EA580C" x={`${70 - t * 4}%`} y={`${50 + Math.cos(frame / 110) * 6}%`} size={680} opacity={0.16} />
        </AbsoluteFill>
        <Particles accent={accent} count={26} />
        {vignette}
      </>
    );
  }

  if (tpl.bgVariant === "spotlight") {
    return (
      <>
        {base}
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 45% at 50% ${18 + Math.sin(frame / 80) * 3}%, ${accent}26 0%, transparent 70%)` }} />
        <Blob color={accent} x="60%" y={`${55 + t * 8}%`} size={620} opacity={0.12} />
        <Particles accent={accent} count={14} />
        {vignette}
      </>
    );
  }

  if (tpl.bgVariant === "ledger") {
    return (
      <>
        {base}
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${tpl.hair} 1px, transparent 1px), linear-gradient(90deg, ${tpl.hair} 1px, transparent 1px)`,
            backgroundSize: "80px 80px",
            backgroundPosition: `0 ${grid}px`,
            opacity: 0.4,
            maskImage: "radial-gradient(circle at 50% 45%, black 0%, transparent 80%)",
          }}
        />
        <AbsoluteFill>
          <Blob color={accent} x={`${-6 + t * 5}%`} y="10%" size={620} opacity={0.12} />
          <Blob color="#B97E00" x="68%" y="58%" size={560} opacity={0.12} />
        </AbsoluteFill>
        {/* diagonal sheen */}
        <AbsoluteFill style={{ background: `linear-gradient(115deg, transparent 40%, ${accent}10 50%, transparent 60%)`, transform: `translateX(${interpolate(frame % 240, [0, 240], [-30, 30])}%)` }} />
        {vignette}
      </>
    );
  }

  // wire — newsroom: panning grid, scanlines, bottom ticker glow, particles
  return (
    <>
      {base}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${tpl.hair} 1px, transparent 1px), linear-gradient(90deg, ${tpl.hair} 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
          backgroundPosition: `${grid}px ${grid}px`,
          opacity: 0.45,
          maskImage: "radial-gradient(circle at 50% 42%, black 0%, transparent 78%)",
        }}
      />
      {/* scanlines */}
      <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px)`, opacity: 0.5 }} />
      <Particles accent={accent} count={16} />
      {/* bottom ticker glow */}
      <AbsoluteFill style={{ justifyContent: "flex-end" }}>
        <div style={{ height: 3, width: "100%", background: accent, opacity: 0.5, boxShadow: `0 0 24px ${accent}` }} />
      </AbsoluteFill>
      {vignette}
    </>
  );
};
