import React from "react";
import {
  AbsoluteFill,
  Series,
  Audio,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  CalculateMetadataFunction,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { FONTS, withIndic } from "../AINews/fonts";

/* ------------------------------------------------------------------ *
 * JOB factor — narrated "slide deck" for job notifications (Kannada).
 * Modernized take on the channel's classic format: gold intro card with
 * highlight boxes → clean white slides (tables + fact lists) → outro.
 * No B-roll anywhere: every scene is a native info-graphic card.
 * ------------------------------------------------------------------ */

const sceneSchema = z.object({
  type: z.string(), // introCard | table | facts | outro
  vo: z.string().optional().default(""),
  // introCard
  title: z.string().optional().default(""),
  highlights: z.array(z.object({ label: z.string(), value: z.string() })).optional().default([]),
  // table
  heading: z.string().optional().default(""),
  columns: z.array(z.string()).optional().default([]),
  rows: z.array(z.object({ cells: z.array(z.string()), bold: z.boolean().optional().default(false) })).optional().default([]),
  // facts
  bullets: z.array(z.string()).optional().default([]),
  // outro
  headline: z.string().optional().default(""),
  cta: z.string().optional().default(""),
  disclaimer: z.string().optional().default(""),
  // injected by the build step (captions kept loose — Jobs never renders them)
  audio: z.string().optional(),
  durationInFrames: z.number().optional(),
  captions: z.array(z.any()).optional(),
});

export const jobsSchema = z.object({
  channelName: z.string(),
  title: z.string().optional().default(""),
  topicTag: z.string().optional().default(""), // header chip, e.g. "ಸರ್ಕಾರಿ ಉದ್ಯೋಗ"
  accent: zColor().optional().default("#D9A514"),
  logo: z.string().optional().default(""), // staticFile path, e.g. "logo/jobfactor.png"
  music: z.string().optional().default(""),
  source: z.string().optional().default(""),
  lang: z.string().optional().default("kn"),
  voice: z.string().optional().default(""),
  template: z.string().optional().default(""),
  showCaptions: z.boolean().optional().default(false),
  sfx: z.record(z.string(), z.string()).optional(), // injected by the build step; unused here
  scenes: z.array(sceneSchema),
});
export type JobsProps = z.infer<typeof jobsSchema>;

const FPS = 30;
const NAVY = "#16233B";
const NAVY_SOFT = "#25355A";
const PAPER = "#F7F5F0";
const INK = "#1D2432";
const CARD = "#FFFFFF";

export const calculateJobsMetadata: CalculateMetadataFunction<JobsProps> = ({ props }) => ({
  durationInFrames: props.scenes.reduce((t, s) => t + (s.durationInFrames || 120), 0) || 120,
});

const font = withIndic(FONTS.poppins);

const useSpring = (delay = 0) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config: { damping: 200 }, durationInFrames: 20 });
};

/** slim branded bar shown on every content slide */
const HeaderBar: React.FC<{ p: JobsProps }> = ({ p }) => {
  const s = useSpring(0);
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 84, background: NAVY, display: "flex", alignItems: "center", padding: "0 44px", gap: 18, transform: `translateY(${interpolate(s, [0, 1], [-84, 0])}px)` }}>
      {p.logo ? <Img src={staticFile(p.logo)} style={{ height: 54, width: 54, objectFit: "contain", borderRadius: 10 }} /> : null}
      <span style={{ fontFamily: font, fontWeight: 700, fontSize: 30, color: "#fff", letterSpacing: 0.5 }}>{p.channelName}</span>
      <div style={{ flex: 1 }} />
      {p.topicTag ? (
        <span style={{ fontFamily: font, fontWeight: 700, fontSize: 24, color: NAVY, background: p.accent, padding: "8px 22px", borderRadius: 999 }}>{p.topicTag}</span>
      ) : null}
    </div>
  );
};

const IntroCard: React.FC<{ scene: z.infer<typeof sceneSchema>; p: JobsProps }> = ({ scene, p }) => {
  const f = useCurrentFrame();
  const card = useSpring(2);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 20%, ${NAVY_SOFT} 0%, ${NAVY} 70%)`, alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 1360, background: `linear-gradient(160deg, ${p.accent} 0%, #C89110 100%)`, borderRadius: 34, padding: "56px 64px", boxShadow: "0 30px 80px rgba(0,0,0,0.45)", transform: `scale(${interpolate(card, [0, 1], [0.92, 1])})`, opacity: card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 26, marginBottom: 34 }}>
          {p.logo ? <Img src={staticFile(p.logo)} style={{ height: 96, width: 96, objectFit: "contain", borderRadius: 18, background: "rgba(255,255,255,0.85)", padding: 8 }} /> : null}
          <div style={{ fontFamily: font, fontWeight: 800, fontSize: 58, lineHeight: 1.18, color: NAVY }}>{scene.title || p.title}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
          {scene.highlights.map((h, i) => {
            const a = spring({ frame: f - 10 - i * 6, fps: FPS, config: { damping: 200 }, durationInFrames: 18 });
            return (
              <div key={i} style={{ background: CARD, borderRadius: 18, padding: "22px 30px", boxShadow: "0 10px 26px rgba(0,0,0,0.16)", opacity: a, transform: `translateY(${interpolate(a, [0, 1], [26, 0])}px)`, display: "flex", alignItems: "baseline", gap: 14 }}>
                <span style={{ fontFamily: font, fontWeight: 600, fontSize: 30, color: "#6B7280", whiteSpace: "nowrap" }}>{h.label}</span>
                <span style={{ fontFamily: font, fontWeight: 800, fontSize: 38, color: NAVY }}>{h.value}</span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const TableSlide: React.FC<{ scene: z.infer<typeof sceneSchema>; p: JobsProps }> = ({ scene, p }) => {
  const f = useCurrentFrame();
  const head = useSpring(2);
  const cols = scene.columns.length ? scene.columns : ["", ""];
  return (
    <AbsoluteFill style={{ background: PAPER, alignItems: "center", paddingTop: 150 }}>
      <HeaderBar p={p} />
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: 52, color: INK, textAlign: "center", maxWidth: 1500, lineHeight: 1.25, opacity: head, transform: `translateY(${interpolate(head, [0, 1], [18, 0])}px)` }}>
        {scene.heading}
        <div style={{ width: 130, height: 7, background: p.accent, borderRadius: 4, margin: "18px auto 0" }} />
      </div>
      <div style={{ marginTop: 48, width: 1240, background: CARD, borderRadius: 22, overflow: "hidden", boxShadow: "0 18px 50px rgba(22,35,59,0.14)" }}>
        <div style={{ display: "grid", gridTemplateColumns: `1.5fr 1fr`, background: NAVY }}>
          {cols.map((c, i) => (
            <div key={i} style={{ fontFamily: font, fontWeight: 700, fontSize: 33, color: "#fff", padding: "24px 40px", textAlign: i ? "center" : "left" }}>{c}</div>
          ))}
        </div>
        {scene.rows.map((r, i) => {
          const a = spring({ frame: f - 14 - i * 7, fps: FPS, config: { damping: 200 }, durationInFrames: 16 });
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: `1.5fr 1fr`, background: r.bold ? "rgba(217,165,20,0.13)" : i % 2 ? "#FAF8F4" : CARD, borderTop: "1px solid #ECE8DF", opacity: a, transform: `translateX(${interpolate(a, [0, 1], [30, 0])}px)` }}>
              {r.cells.slice(0, 2).map((cell, j) => (
                <div key={j} style={{ fontFamily: font, fontWeight: r.bold ? 800 : 600, fontSize: 36, color: INK, padding: "22px 40px", textAlign: j ? "center" : "left" }}>{cell}</div>
              ))}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const FactsSlide: React.FC<{ scene: z.infer<typeof sceneSchema>; p: JobsProps }> = ({ scene, p }) => {
  const f = useCurrentFrame();
  const head = useSpring(2);
  // bold anything wrapped in **double asterisks**
  const renderText = (t: string) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") ? (
        <strong key={i} style={{ fontWeight: 800, color: NAVY }}>{part.slice(2, -2)}</strong>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      ),
    );
  return (
    <AbsoluteFill style={{ background: PAPER, paddingTop: 150, alignItems: "center" }}>
      <HeaderBar p={p} />
      <div style={{ width: 1240 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14, opacity: head }}>
          <div style={{ width: 12, height: 42, background: p.accent, borderRadius: 6 }} />
          <span style={{ fontFamily: font, fontWeight: 800, fontSize: 48, color: INK }}>{scene.heading}</span>
        </div>
        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 24 }}>
          {scene.bullets.map((b, i) => {
            const a = spring({ frame: f - 12 - i * 8, fps: FPS, config: { damping: 200 }, durationInFrames: 18 });
            return (
              <div key={i} style={{ display: "flex", gap: 22, alignItems: "flex-start", background: CARD, borderRadius: 16, padding: "26px 34px", boxShadow: "0 10px 30px rgba(22,35,59,0.10)", opacity: a, transform: `translateY(${interpolate(a, [0, 1], [22, 0])}px)` }}>
                <div style={{ minWidth: 16, height: 16, borderRadius: 999, background: p.accent, marginTop: 16 }} />
                <span style={{ fontFamily: font, fontWeight: 500, fontSize: 38, color: INK, lineHeight: 1.5 }}>{renderText(b)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const OutroSlide: React.FC<{ scene: z.infer<typeof sceneSchema>; p: JobsProps }> = ({ scene, p }) => {
  const s = useSpring(2);
  const s2 = useSpring(12);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 30%, ${NAVY_SOFT} 0%, ${NAVY} 72%)`, alignItems: "center", justifyContent: "center", gap: 30 }}>
      {p.logo ? (
        <Img src={staticFile(p.logo)} style={{ height: 190, width: 190, objectFit: "contain", borderRadius: 30, background: "rgba(255,255,255,0.92)", padding: 14, transform: `scale(${interpolate(s, [0, 1], [0.8, 1])})`, opacity: s, boxShadow: "0 24px 70px rgba(0,0,0,0.45)" }} />
      ) : null}
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: 62, color: "#fff", textAlign: "center", maxWidth: 1400, lineHeight: 1.25, opacity: s }}>{scene.headline || p.channelName}</div>
      {scene.cta ? (
        <div style={{ fontFamily: font, fontWeight: 700, fontSize: 40, color: NAVY, background: p.accent, padding: "18px 52px", borderRadius: 999, opacity: s2, transform: `translateY(${interpolate(s2, [0, 1], [18, 0])}px)`, boxShadow: "0 14px 40px rgba(0,0,0,0.35)" }}>{scene.cta}</div>
      ) : null}
      {scene.disclaimer ? (
        <div style={{ position: "absolute", bottom: 48, fontFamily: font, fontWeight: 500, fontSize: 26, color: "rgba(255,255,255,0.65)", textAlign: "center", maxWidth: 1500 }}>{scene.disclaimer}</div>
      ) : null}
    </AbsoluteFill>
  );
};

const SCENE_COMPONENTS: Record<string, React.FC<{ scene: z.infer<typeof sceneSchema>; p: JobsProps }>> = {
  introCard: IntroCard,
  table: TableSlide,
  facts: FactsSlide,
  outro: OutroSlide,
};

export const Jobs: React.FC<JobsProps> = (props) => {
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      {props.music ? <Audio src={staticFile(props.music)} volume={0.14} loop /> : null}
      <Series>
        {props.scenes.map((scene, i) => {
          const Comp = SCENE_COMPONENTS[scene.type] || FactsSlide;
          return (
            <Series.Sequence key={i} durationInFrames={scene.durationInFrames || 120}>
              <Comp scene={scene} p={props} />
              {scene.audio ? <Audio src={staticFile(scene.audio)} /> : null}
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
};

export const sampleJobs: JobsProps = {
  channelName: "JOB factor",
  title: "ಜಿಲ್ಲಾ ನ್ಯಾಯಾಲಯದಲ್ಲಿ ಉದ್ಯೋಗವಕಾಶ 2026",
  topicTag: "ಸರ್ಕಾರಿ ಉದ್ಯೋಗ",
  accent: "#D9A514",
  logo: "",
  music: "",
  source: "",
  lang: "kn",
  voice: "",
  template: "",
  showCaptions: false,
  scenes: [
    {
      type: "introCard",
      vo: "",
      title: "ಧಾರವಾಡ ಜಿಲ್ಲಾ ನ್ಯಾಯಾಲಯದಲ್ಲಿ ಭರ್ಜರಿ ಉದ್ಯೋಗವಕಾಶ",
      highlights: [
        { label: "ಸಂಬಳ", value: "₹42,000" },
        { label: "ಸ್ಥಳ", value: "ಕರ್ನಾಟಕ" },
        { label: "ಪರೀಕ್ಷೆ", value: "ಇಲ್ಲ" },
        { label: "ವಿದ್ಯಾರ್ಹತೆ", value: "10th / 12th / ಪದವಿ" },
      ],
      heading: "", columns: [], rows: [], bullets: [], headline: "", cta: "", disclaimer: "",
    },
    {
      type: "table",
      vo: "",
      title: "", highlights: [],
      heading: "ಹುದ್ದೆಗಳ ವಿವರ",
      columns: ["ಹುದ್ದೆಯ ಹೆಸರು", "ಖಾಲಿ ಹುದ್ದೆಗಳು"],
      rows: [
        { cells: ["ಪ್ಯೂನ್", "31"], bold: false },
        { cells: ["ಟೈಪಿಸ್ಟ್", "02"], bold: false },
        { cells: ["ಒಟ್ಟು", "33"], bold: true },
      ],
      bullets: [], headline: "", cta: "", disclaimer: "",
    },
    {
      type: "facts",
      vo: "",
      title: "", highlights: [], heading: "ಅರ್ಜಿ ಶುಲ್ಕ", columns: [], rows: [],
      bullets: ["ಸಾಮಾನ್ಯ ವರ್ಗ — **ರೂ. 200**", "SC/ST ಮತ್ತು ಅಂಗವಿಕಲ ಅಭ್ಯರ್ಥಿಗಳಿಗೆ — **ರೂ. 100**"],
      headline: "", cta: "", disclaimer: "",
    },
    {
      type: "outro",
      vo: "",
      title: "", highlights: [], heading: "", columns: [], rows: [], bullets: [],
      headline: "ಹೊಸ ಉದ್ಯೋಗ ಮಾಹಿತಿಗಾಗಿ",
      cta: "JOB factor ಸಬ್‌ಸ್ಕ್ರೈಬ್ ಮಾಡಿ",
      disclaimer: "ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮೊದಲು ಅಧಿಕೃತ ವೆಬ್‌ಸೈಟ್‌ನಲ್ಲಿ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.",
    },
  ],
};
