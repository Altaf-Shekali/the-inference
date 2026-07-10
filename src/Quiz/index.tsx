import React from "react";
import {
  AbsoluteFill,
  Series,
  Sequence,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  CalculateMetadataFunction,
} from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { FONTS } from "../AINews/fonts";

/* ------------------------------------------------------------------ *
 * Daily current-affairs QUIZ — silent (on-screen text + timer sound + music).
 * Each question: read → answer countdown → reveal the correct option (green).
 * Answer/reveal seconds are props (answerSeconds / revealSeconds).
 * ------------------------------------------------------------------ */

export const quizSchema = z.object({
  title: z.string(),
  date: z.string(),
  channelName: z.string(),
  accent: zColor(),
  subscribeText: z.string().optional().default(""),
  music: z.string().optional().default(""), // staticFile path, or "" for none
  tick: z.string().optional().default(""), // countdown tick (looped 1/sec), or "" for none
  ding: z.string().optional().default(""), // "answer revealed" chime, or "" for none
  answerSeconds: z.number().optional().default(7), // seconds to answer each question (countdown)
  revealSeconds: z.number().optional().default(4), // seconds to see the answer before the next question
  questions: z.array(
    z.object({
      q: z.string(),
      options: z.array(z.string()).length(4),
      correct: z.number().int().min(0).max(3),
      explanation: z.string().optional().default(""),
      tag: z.string().optional().default(""),
    }),
  ),
});
export type QuizProps = z.infer<typeof quizSchema>;

const FPS = 30;
const READ = 60; // 2.0s to read Q + options before the countdown starts
const DEFAULT_ANSWER = 7; // seconds to answer (countdown) — overridable via props.answerSeconds
const DEFAULT_REVEAL = 4; // seconds to see the correct answer — overridable via props.revealSeconds
const INTRO = 78; // 2.6s
const SUB = 108; // 3.6s subscribe card
const OUTRO = 78; // 2.6s

/** per-question phase lengths (in frames), derived from the props */
const timingsOf = (p: QuizProps) => {
  const TIMER = Math.round((p.answerSeconds || DEFAULT_ANSWER) * FPS);
  const REVEAL = Math.round((p.revealSeconds || DEFAULT_REVEAL) * FPS);
  return { TIMER, REVEAL, Q_LEN: READ + TIMER + REVEAL };
};

/** subscribe card sits after the middle question */
const subAfter = (n: number) => Math.max(1, Math.ceil(n / 2));

export const calculateQuizMetadata: CalculateMetadataFunction<QuizProps> = ({ props }) => {
  const n = props.questions.length || 1;
  const { Q_LEN } = timingsOf(props);
  return { durationInFrames: INTRO + n * Q_LEN + SUB + OUTRO };
};

const BG = "#0A0F1E";
const INK = "#F5F8FF";
const font = FONTS.poppins;
const LETTERS = ["A", "B", "C", "D"];

const useU = () => {
  const { width, height } = useVideoConfig();
  const portrait = height >= width;
  return { portrait, u: portrait ? width / 1080 : width / 1920 };
};

const Background: React.FC<{ accent: string }> = ({ accent }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 12%, #14264a 0%, ${BG} 62%)` }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          backgroundPosition: `0 ${(f * 0.3) % 64}px`,
          opacity: 0.35,
          maskImage: "radial-gradient(circle at 50% 40%, black 0%, transparent 80%)",
        }}
      />
      <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 400px 100px rgba(0,0,0,0.55)" }} />
    </AbsoluteFill>
  );
};

const CountRing: React.FC<{ progress: number; num: number; accent: string; u: number }> = ({ progress, num, accent, u }) => {
  const R = 46 * u;
  const C = 2 * Math.PI * R;
  const danger = num <= 1;
  const col = danger ? "#F43F5E" : accent;
  return (
    <div style={{ position: "relative", width: R * 2.4, height: R * 2.4, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={R * 2.4} height={R * 2.4} style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        <circle cx={R * 1.2} cy={R * 1.2} r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={8 * u} />
        <circle cx={R * 1.2} cy={R * 1.2} r={R} fill="none" stroke={col} strokeWidth={8 * u} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} style={{ filter: `drop-shadow(0 0 ${10 * u}px ${col})` }} />
      </svg>
      <span style={{ fontFamily: font, fontWeight: 800, fontSize: 52 * u, color: col }}>{num}</span>
    </div>
  );
};

const QuestionScene: React.FC<{ item: QuizProps["questions"][0]; index: number; accent: string; tick: string; ding: string; timer: number }> = ({ item, index, accent, tick, ding, timer }) => {
  const f = useCurrentFrame();
  const { portrait, u } = useU();
  const phase = f < READ ? "read" : f < READ + timer ? "timer" : "reveal";
  const revealed = phase === "reveal";

  const tf = f - READ; // frames into timer
  const timerProgress = phase === "timer" ? 1 - tf / timer : phase === "reveal" ? 0 : 1;
  const countNum = Math.max(1, Math.ceil((timer - tf) / FPS)); // e.g. 7,6,…,1

  const headIn = spring({ frame: f, fps: FPS, config: { damping: 200 }, durationInFrames: 18 });

  return (
    <AbsoluteFill style={{ padding: portrait ? `${140 * u}px ${64 * u}px` : `${90 * u}px ${140 * u}px`, alignItems: "center" }}>
      {/* header: Q number + tag + timer */}
      <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: headIn }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 * u }}>
          <span style={{ fontFamily: font, fontWeight: 800, fontSize: 34 * u, color: BG, background: accent, padding: `${8 * u}px ${20 * u}px`, borderRadius: 999 }}>Q{index + 1}</span>
          {item.tag ? <span style={{ fontFamily: font, fontWeight: 700, fontSize: 24 * u, color: accent, border: `2px solid ${accent}`, padding: `${6 * u}px ${16 * u}px`, borderRadius: 999, textTransform: "uppercase", letterSpacing: 1 }}>{item.tag}</span> : null}
        </div>
        {phase === "timer" ? <CountRing progress={timerProgress} num={countNum} accent={accent} u={u} /> : <div style={{ width: 110 * u, height: 110 * u }} />}
      </div>

      {/* question */}
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: (portrait ? 66 : 56) * u, color: INK, lineHeight: 1.22, textAlign: "center", marginTop: 40 * u, minHeight: 160 * u, display: "flex", alignItems: "center", justifyContent: "center", opacity: headIn }}>
        {item.q}
      </div>

      {/* options */}
      <div style={{ display: "grid", gridTemplateColumns: portrait ? "1fr" : "1fr 1fr", gap: 20 * u, width: "100%", marginTop: 34 * u }}>
        {item.options.map((opt, i) => {
          const isCorrect = i === item.correct;
          const appear = spring({ frame: f - 8 - i * 5, fps: FPS, config: { damping: 200 }, durationInFrames: 16 });
          const correctPulse = revealed && isCorrect ? interpolate(f - (READ + timer), [0, 10], [0.9, 1], { extrapolateRight: "clamp" }) : 1;
          const bg = revealed ? (isCorrect ? "#15803D" : "rgba(255,255,255,0.04)") : "rgba(255,255,255,0.08)";
          const border = revealed ? (isCorrect ? "#22C55E" : "rgba(255,255,255,0.10)") : "rgba(255,255,255,0.16)";
          const dim = revealed && !isCorrect ? 0.45 : 1;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 18 * u, background: bg, border: `${2 * u}px solid ${border}`, borderRadius: 18 * u, padding: `${20 * u}px ${24 * u}px`, opacity: appear * dim, transform: `translateY(${interpolate(appear, [0, 1], [20, 0])}px) scale(${correctPulse})`, boxShadow: revealed && isCorrect ? `0 0 30px ${accent}55` : "none" }}>
              <span style={{ fontFamily: font, fontWeight: 800, fontSize: 40 * u, color: revealed && isCorrect ? "#fff" : accent, background: revealed && isCorrect ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)", minWidth: 62 * u, height: 62 * u, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12 * u }}>{LETTERS[i]}</span>
              <span style={{ fontFamily: font, fontWeight: 600, fontSize: 44 * u, color: INK, lineHeight: 1.25, flex: 1 }}>{opt}</span>
              {revealed && isCorrect ? <span style={{ fontSize: 40 * u }}>✓</span> : null}
            </div>
          );
        })}
      </div>

      {/* explanation on reveal */}
      {revealed && item.explanation ? (
        <div style={{ fontFamily: font, fontWeight: 500, fontSize: 40 * u, color: "rgba(245,248,255,0.75)", textAlign: "center", marginTop: 30 * u, opacity: interpolate(f - (READ + timer), [6, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), maxWidth: 1300 * u }}>
          {item.explanation}
        </div>
      ) : null}

      {/* Audio must live in Sequences with an explicit `from`, so Remotion plays
          each clip AT the right time (a bare conditional <Audio> is timed from the
          scene start, which silently swallows the short reveal chime). */}
      {tick ? (
        <Sequence from={READ} durationInFrames={timer} name="tick">
          <Audio src={staticFile(tick)} volume={0.55} loop />
        </Sequence>
      ) : null}
      {ding ? (
        <Sequence from={READ + timer} name="reveal-chime">
          <Audio src={staticFile(ding)} volume={0.6} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

const Card: React.FC<{ big: string; small: string; accent: string }> = ({ big, small, accent }) => {
  const f = useCurrentFrame();
  const { u } = useU();
  const s = spring({ frame: f, fps: FPS, config: { damping: 200 }, durationInFrames: 20 });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: `0 ${80 * u}px` }}>
      <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.8, 1])})`, opacity: s, textAlign: "center" }}>
        <div style={{ fontFamily: font, fontWeight: 800, fontSize: 84 * u, color: INK, lineHeight: 1.1 }}>{big}</div>
        <div style={{ fontFamily: font, fontWeight: 600, fontSize: 40 * u, color: accent, marginTop: 24 * u }}>{small}</div>
      </div>
    </AbsoluteFill>
  );
};

export const Quiz: React.FC<QuizProps> = (props) => {
  const { questions, accent, title, date, channelName, subscribeText, music, tick, ding } = props;
  const { TIMER, Q_LEN } = timingsOf(props);
  const cut = subAfter(questions.length);
  const seq: React.ReactNode[] = [];
  seq.push(
    <Series.Sequence key="intro" durationInFrames={INTRO}>
      <Card big={title} small={date} accent={accent} />
    </Series.Sequence>,
  );
  questions.forEach((item, i) => {
    seq.push(
      <Series.Sequence key={`q${i}`} durationInFrames={Q_LEN}>
        <QuestionScene item={item} index={i} accent={accent} tick={tick} ding={ding} timer={TIMER} />
      </Series.Sequence>,
    );
    if (i + 1 === cut) {
      seq.push(
        <Series.Sequence key="sub" durationInFrames={SUB}>
          <Card big="Subscribe 🔔" small={subscribeText || `for a daily quiz — ${channelName}`} accent={accent} />
        </Series.Sequence>,
      );
    }
  });
  seq.push(
    <Series.Sequence key="outro" durationInFrames={OUTRO}>
      <Card big="How many did you get?" small={`Comment your score · ${channelName}`} accent={accent} />
    </Series.Sequence>,
  );
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Background accent={accent} />
      {music ? <Audio src={staticFile(music)} volume={0.18} loop /> : null}
      <Series>{seq}</Series>
    </AbsoluteFill>
  );
};

export const sampleQuiz: QuizProps = {
  title: "Daily Current Affairs Quiz",
  date: "July 2026",
  channelName: "Current Affairs",
  accent: "#3B82F6",
  subscribeText: "New here? Subscribe for a daily quiz — Current Affairs",
  music: "",
  tick: "",
  ding: "",
  answerSeconds: 7,
  revealSeconds: 4,
  questions: [
    { q: "Which country hosted the 2026 G20 Summit?", options: ["Brazil", "India", "South Africa", "USA"], correct: 2, explanation: "South Africa hosted the 2026 G20 Summit — a first for the African continent.", tag: "current" },
    { q: "Who is the current Governor of the Reserve Bank of India (RBI)?", options: ["Shaktikanta Das", "Sanjay Malhotra", "Raghuram Rajan", "Urjit Patel"], correct: 1, explanation: "Sanjay Malhotra took charge as the 26th RBI Governor.", tag: "gk" },
    { q: "The Nobel Peace Prize 2025 was awarded for work in which field?", options: ["Nuclear disarmament", "Climate action", "Press freedom", "Poverty relief"], correct: 0, explanation: "It recognized efforts toward nuclear disarmament.", tag: "current" },
    { q: "Which river is known as the 'Sorrow of Bihar'?", options: ["Ganga", "Kosi", "Son", "Gandak"], correct: 1, explanation: "The Kosi river is called the Sorrow of Bihar for its frequent floods.", tag: "gk" },
  ],
};
