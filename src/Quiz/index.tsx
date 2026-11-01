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
 * Daily current-affairs QUIZ — on-screen text, timer sounds, music, and optional narration.
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
      questionAudio: z.string().optional(),
      questionAudioFrames: z.number().int().positive().optional(),
      answerAudio: z.string().optional(),
      answerAudioFrames: z.number().int().positive().optional(),
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
const timingsOf = (p: QuizProps, item?: QuizProps["questions"][number]) => {
  const narrated = Boolean(item?.questionAudio && item.answerAudio);
  const READ_LEN = narrated ? Math.max(READ, item?.questionAudioFrames || READ) : READ;
  const TIMER = narrated ? 3 * FPS : Math.round((p.answerSeconds || DEFAULT_ANSWER) * FPS);
  const REVEAL = narrated
    ? (item?.answerAudioFrames || FPS) + FPS
    : Math.round((p.revealSeconds || DEFAULT_REVEAL) * FPS);
  return { READ: READ_LEN, TIMER, REVEAL, Q_LEN: READ_LEN + TIMER + REVEAL };
};

/** subscribe card sits after the middle question */
const subAfter = (n: number) => Math.max(1, Math.ceil(n / 2));

export const calculateQuizMetadata: CalculateMetadataFunction<QuizProps> = ({ props }) => {
  const questionsLength = props.questions.reduce((total, item) => total + timingsOf(props, item).Q_LEN, 0);
  return { durationInFrames: INTRO + questionsLength + SUB + OUTRO };
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

/* ------------------------------------------------------------------ *
 * 2D Particle Confetti Burst on Correct Answer Reveal
 * ------------------------------------------------------------------ */
const PARTICLE_COLORS = ["#22C55E", "#EAB308", "#38BDF8", "#F43F5E", "#A855F7", "#FFFFFF"];
const PARTICLES = Array.from({ length: 24 }).map((_, i) => {
  const angle = (i / 24) * 2 * Math.PI + (i % 3) * 0.2;
  const speed = 140 + (i % 5) * 35;
  const size = 8 + (i % 4) * 4;
  const color = PARTICLE_COLORS[i % PARTICLE_COLORS.length];
  return { angle, speed, size, color };
});

const ConfettiBurst: React.FC<{ progress: number; u: number }> = ({ progress, u }) => {
  if (progress <= 0 || progress >= 1) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
      {PARTICLES.map((p, i) => {
        const dist = p.speed * progress * u;
        const x = Math.cos(p.angle) * dist;
        const y = Math.sin(p.angle) * dist + progress * 60 * u; // subtle gravity
        const scale = interpolate(progress, [0, 0.2, 0.8, 1], [0, 1.2, 0.8, 0]);
        const rot = progress * 360 * (i % 2 === 0 ? 1 : -1);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: p.size * u,
              height: p.size * u,
              borderRadius: i % 2 === 0 ? "50%" : 2 * u,
              background: p.color,
              boxShadow: `0 0 10px ${p.color}`,
              transform: `translate(${x}px, ${y}px) scale(${scale}) rotate(${rot}deg)`,
              opacity: interpolate(progress, [0, 0.7, 1], [1, 1, 0]),
            }}
          />
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Animated 2D SVG Checkmark
 * ------------------------------------------------------------------ */
const AnimatedCheckmark: React.FC<{ progress: number; u: number }> = ({ progress, u }) => {
  const strokeLen = 40;
  const offset = interpolate(progress, [0, 1], [strokeLen, 0], { extrapolateRight: "clamp" });
  const pop = spring({ frame: progress * 15, fps: FPS, config: { damping: 12, mass: 0.5 } });
  return (
    <svg width={42 * u} height={42 * u} viewBox="0 0 36 36" style={{ transform: `scale(${pop})` }}>
      <circle cx="18" cy="18" r="16" fill="rgba(34,197,94,0.25)" />
      <path
        d="M10 18 L16 24 L26 12"
        fill="none"
        stroke="#22C55E"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={strokeLen}
        strokeDashoffset={offset}
      />
    </svg>
  );
};

const Background: React.FC = () => {
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
      {/* Subtle pulsing ambient glow */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "50%",
          width: 600,
          height: 600,
          transform: `translate(-50%, -50%) scale(${1 + Math.sin(f / 18) * 0.08})`,
          background: "radial-gradient(circle, rgba(59,130,246,0.14) 0%, transparent 70%)",
          filter: "blur(40px)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 400px 100px rgba(0,0,0,0.55)" }} />
    </AbsoluteFill>
  );
};

const CountRing: React.FC<{ progress: number; num: number; accent: string; u: number; frameInTimer: number }> = ({ progress, num, accent, u, frameInTimer }) => {
  const R = 46 * u;
  const C = 2 * Math.PI * R;
  const danger = num <= 2;
  const col = danger ? "#F43F5E" : accent;

  // Pulse effect on every tick second
  const tickBeat = (frameInTimer % FPS) / FPS;
  const beatScale = interpolate(tickBeat, [0, 0.2, 1], danger ? [1.18, 1.08, 1] : [1.08, 1.02, 1], { extrapolateRight: "clamp" });

  return (
    <div style={{ position: "relative", width: R * 2.4, height: R * 2.4, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${beatScale})` }}>
      <svg width={R * 2.4} height={R * 2.4} style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        <circle cx={R * 1.2} cy={R * 1.2} r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={8 * u} />
        <circle
          cx={R * 1.2}
          cy={R * 1.2}
          r={R}
          fill="none"
          stroke={col}
          strokeWidth={8 * u}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
          style={{ filter: `drop-shadow(0 0 ${danger ? 16 * u : 10 * u}px ${col})` }}
        />
      </svg>
      <span style={{ fontFamily: font, fontWeight: 800, fontSize: 52 * u, color: col, textShadow: danger ? `0 0 20px ${col}` : "none" }}>{num}</span>
    </div>
  );
};

const QuestionScene: React.FC<{ item: QuizProps["questions"][0]; index: number; accent: string; tick: string; ding: string; timing: ReturnType<typeof timingsOf> }> = ({ item, index, accent, tick, ding, timing }) => {
  const f = useCurrentFrame();
  const { portrait, u } = useU();
  const { READ: readFrames, TIMER: timer, REVEAL: revealFrames } = timing;
  const phase = f < readFrames ? "read" : f < readFrames + timer ? "timer" : "reveal";
  const revealed = phase === "reveal";

  const tf = Math.max(0, f - readFrames); // frames into timer
  const timerProgress = phase === "timer" ? 1 - tf / timer : phase === "reveal" ? 0 : 1;
  const countNum = Math.max(1, Math.ceil((timer - tf) / FPS)); // e.g. 7,6,…,1

  const revealStart = readFrames + timer;
  const revealProgress = Math.max(0, f - revealStart);

  const headIn = spring({ frame: f, fps: FPS, config: { damping: 14, mass: 0.6 } });

  return (
    <AbsoluteFill style={{ padding: portrait ? `${140 * u}px ${64 * u}px` : `${90 * u}px ${140 * u}px`, alignItems: "center" }}>
      {/* header: Q number + tag + timer */}
      <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: headIn, transform: `translateY(${interpolate(headIn, [0, 1], [-20, 0])}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 * u }}>
          <span style={{ fontFamily: font, fontWeight: 800, fontSize: 34 * u, color: BG, background: accent, padding: `${8 * u}px ${20 * u}px`, borderRadius: 999, boxShadow: `0 4px 18px ${accent}66` }}>Q{index + 1}</span>
          {item.tag ? <span style={{ fontFamily: font, fontWeight: 700, fontSize: 24 * u, color: accent, border: `2px solid ${accent}`, padding: `${6 * u}px ${16 * u}px`, borderRadius: 999, textTransform: "uppercase", letterSpacing: 1 }}>{item.tag}</span> : null}
        </div>
        {phase === "timer" ? <CountRing progress={timerProgress} num={countNum} accent={accent} u={u} frameInTimer={tf} /> : <div style={{ width: 110 * u, height: 110 * u }} />}
      </div>

      {/* question */}
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: (portrait ? 66 : 56) * u, color: INK, lineHeight: 1.22, textAlign: "center", marginTop: 40 * u, minHeight: 160 * u, display: "flex", alignItems: "center", justifyContent: "center", opacity: headIn, transform: `scale(${interpolate(headIn, [0, 1], [0.94, 1])})` }}>
        {item.q}
      </div>

      {/* options */}
      <div style={{ display: "grid", gridTemplateColumns: portrait ? "1fr" : "1fr 1fr", gap: 20 * u, width: "100%", marginTop: 34 * u, position: "relative" }}>
        {item.options.map((opt, i) => {
          const isCorrect = i === item.correct;
          const appear = spring({ frame: f - 6 - i * 4, fps: FPS, config: { damping: 14, mass: 0.6 } });

          // Correct answer pop and bounce
          const correctBounce = revealed && isCorrect ? spring({ frame: revealProgress, fps: FPS, config: { damping: 12, mass: 0.5 } }) : 0;
          const correctScale = revealed && isCorrect ? interpolate(correctBounce, [0, 1], [1, 1.05]) : 1;
          const glowGirth = revealed && isCorrect ? interpolate(Math.sin(revealProgress / 3), [-1, 1], [22, 38]) * u : 0;

          // Wrong answers horizontal error shake
          const shake = revealed && !isCorrect
            ? interpolate(revealProgress, [0, 2, 5, 8, 12, 16], [0, -8 * u, 8 * u, -5 * u, 5 * u, 0], { extrapolateRight: "clamp" })
            : 0;

          const bg = revealed ? (isCorrect ? "linear-gradient(135deg, #15803D 0%, #166534 100%)" : "rgba(255,255,255,0.03)") : "rgba(255,255,255,0.08)";
          const border = revealed ? (isCorrect ? "#22C55E" : "rgba(255,255,255,0.08)") : "rgba(255,255,255,0.16)";
          const dim = revealed && !isCorrect ? 0.35 : 1;

          return (
            <div
              key={i}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 18 * u,
                background: bg,
                border: `${2 * u}px solid ${border}`,
                borderRadius: 20 * u,
                padding: `${20 * u}px ${24 * u}px`,
                opacity: appear * dim,
                transform: `translateX(${shake}px) translateY(${interpolate(appear, [0, 1], [24, 0])}px) scale(${correctScale})`,
                boxShadow: revealed && isCorrect ? `0 0 ${glowGirth}px rgba(34,197,94,0.6)` : "0 4px 16px rgba(0,0,0,0.2)",
              }}
            >
              {revealed && isCorrect ? <ConfettiBurst progress={interpolate(revealProgress, [0, 24], [0, 1], { extrapolateRight: "clamp" })} u={u} /> : null}
              <span
                style={{
                  fontFamily: font,
                  fontWeight: 800,
                  fontSize: 40 * u,
                  color: revealed && isCorrect ? "#fff" : accent,
                  background: revealed && isCorrect ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.08)",
                  minWidth: 62 * u,
                  height: 62 * u,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 14 * u,
                  boxShadow: `0 2px 10px rgba(0,0,0,0.25)`,
                }}
              >
                {LETTERS[i]}
              </span>
              <span style={{ fontFamily: font, fontWeight: 600, fontSize: 44 * u, color: INK, lineHeight: 1.25, flex: 1 }}>{opt}</span>
              {revealed && isCorrect ? (
                <AnimatedCheckmark progress={interpolate(revealProgress, [0, 14], [0, 1], { extrapolateRight: "clamp" })} u={u} />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* explanation on reveal */}
      {revealed && item.explanation ? (
        <div
          style={{
            fontFamily: font,
            fontWeight: 500,
            fontSize: 40 * u,
            color: "rgba(245,248,255,0.85)",
            textAlign: "center",
            marginTop: 30 * u,
            opacity: interpolate(revealProgress, [4, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            transform: `translateY(${interpolate(revealProgress, [4, 18], [12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
            maxWidth: 1300 * u,
          }}
        >
          {item.explanation}
        </div>
      ) : null}

      {/* Audio must live in Sequences with an explicit `from`, so Remotion plays
          each clip AT the right time (a bare conditional <Audio> is timed from the
          scene start, which silently swallows the short reveal chime). */}
      {item.questionAudio ? (
        <Sequence durationInFrames={readFrames} name="question-voice">
          <Audio src={staticFile(item.questionAudio)} volume={1} />
        </Sequence>
      ) : null}
      {item.answerAudio ? (
        <Sequence from={readFrames + timer} durationInFrames={revealFrames} name="answer-voice">
          <Audio src={staticFile(item.answerAudio)} volume={1} />
        </Sequence>
      ) : null}
      {tick ? (
        <Sequence from={readFrames} durationInFrames={timer} name="tick">
          <Audio src={staticFile(tick)} volume={0.55} loop />
        </Sequence>
      ) : null}
      {ding && !item.answerAudio ? (
        <Sequence from={readFrames + timer} name="reveal-chime">
          <Audio src={staticFile(ding)} volume={0.6} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

const Card: React.FC<{ big: string; small: string; accent: string }> = ({ big, small, accent }) => {
  const f = useCurrentFrame();
  const { u } = useU();
  const s = spring({ frame: f, fps: FPS, config: { damping: 14, mass: 0.6 } });
  const float = Math.sin(f / 16) * 4 * u;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: `0 ${80 * u}px` }}>
      {/* Decorative ambient glowing ring */}
      <div
        style={{
          position: "absolute",
          width: 320 * u,
          height: 320 * u,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent}33 0%, transparent 70%)`,
          filter: "blur(30px)",
          transform: `scale(${interpolate(s, [0, 1], [0.6, 1.3])})`,
          opacity: s,
        }}
      />
      <div style={{ transform: `translateY(${float}px) scale(${interpolate(s, [0, 1], [0.85, 1])})`, opacity: s, textAlign: "center", zIndex: 2 }}>
        <div style={{ fontFamily: font, fontWeight: 800, fontSize: 84 * u, color: INK, lineHeight: 1.1, textShadow: `0 8px 30px rgba(0,0,0,0.6)` }}>{big}</div>
        <div style={{ fontFamily: font, fontWeight: 600, fontSize: 40 * u, color: accent, marginTop: 24 * u, textShadow: `0 0 20px ${accent}66` }}>{small}</div>
      </div>
    </AbsoluteFill>
  );
};

export const Quiz: React.FC<QuizProps> = (props) => {
  const { questions, accent, title, date, channelName, subscribeText, music, tick, ding } = props;
  const cut = subAfter(questions.length);
  const seq: React.ReactNode[] = [];
  seq.push(
    <Series.Sequence key="intro" durationInFrames={INTRO}>
      <Card big={title} small={date} accent={accent} />
    </Series.Sequence>,
  );
  questions.forEach((item, i) => {
    const timing = timingsOf(props, item);
    seq.push(
      <Series.Sequence key={`q${i}`} durationInFrames={timing.Q_LEN}>
        <QuestionScene item={item} index={i} accent={accent} tick={tick} ding={ding} timing={timing} />
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
      <Background />
      {music ? <Audio src={staticFile(music)} volume={0.18} loop /> : null}
      <Series>{seq}</Series>
    </AbsoluteFill>
  );
};

export const sampleQuiz: QuizProps = {
  title: "Current Affairs & GK Quiz",
  date: "July 2026",
  channelName: "Current Affairs",
  accent: "#3B82F6",
  subscribeText: "New here? Subscribe for current affairs & GK quizzes — Current Affairs",
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
