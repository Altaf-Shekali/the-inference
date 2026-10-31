import React, { useMemo } from "react";
import { z } from "zod";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  AbsoluteFill,
  Audio,
  staticFile,
  Sequence,
} from "remotion";
import { THEMES } from "../themes";
import { ArabicText } from "../components/ArabicText";
import { Transliteration } from "../components/Transliteration";
import { Translation } from "../components/Translation";
import { SourceRef } from "../components/SourceRef";
import { RainBackground } from "../components/RainBackground";
import { AmbientRainAudio } from "../components/AmbientRainAudio";
import { CircularProgress } from "../components/CircularProgress";
import { TasbihBeads } from "../components/TasbihBeads";

const COUNT_START_FRAME = 45;
const COUNT_INTERVAL_FRAMES = 45;
const OUTRO_HOLD_FRAMES = 90;

export const dhikrCounterSchema = z.object({
  arabic: z.string().default("أَسْتَغْفِرُ اللَّهَ"),
  transliteration: z.string().default("Astaghfirullāh"),
  meaning: z.string().default("I seek the forgiveness of Allah"),
  targetCount: z.number().default(33),
  countType: z.string().default("sunnah-suggested"),
  source: z
    .object({
      collection: z.string().optional(),
      hadithNum: z.string().optional(),
      narrator: z.string().optional(),
      authenticity: z.string().optional(),
    })
    .optional(),
  theme: z.string().default("midnight"),
  channelName: z.string().default("Islamic Reminders"),
});

export type DhikrCounterProps = z.infer<typeof dhikrCounterSchema>;

export const sampleDhikr: DhikrCounterProps = {
  arabic: "أَسْتَغْفِرُ اللَّهَ",
  transliteration: "Astaghfirullāh",
  meaning: "I seek the forgiveness of Allah",
  targetCount: 33,
  countType: "sunnah-suggested",
  source: {
    collection: "Sahih Muslim",
    hadithNum: "591",
    narrator: "Thawban (RA)",
    authenticity: "Sahih",
  },
  theme: "midnight",
  channelName: "Islamic Reminders",
};

export const calculateDhikrMetadata = async ({
  props,
}: {
  props: DhikrCounterProps;
}) => {
  return {
    durationInFrames:
      COUNT_START_FRAME +
      Math.max(1, props.targetCount) * COUNT_INTERVAL_FRAMES +
      OUTRO_HOLD_FRAMES,
    props,
  };
};

export const DhikrCounter: React.FC<DhikrCounterProps> = ({
  arabic,
  transliteration,
  meaning,
  targetCount = 33,
  countType = "sunnah-suggested",
  source,
  theme = "midnight",
  channelName = "Islamic Reminders",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const activeTheme = THEMES[theme] || THEMES.midnight;

  // Entrance spring animations
  const introSpring = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 80 },
  });

  const countStartFrame = COUNT_START_FRAME;
  const countEndFrame = Math.max(
    durationInFrames - OUTRO_HOLD_FRAMES,
    countStartFrame + COUNT_INTERVAL_FRAMES,
  );

  const rawCount = interpolate(
    frame,
    [countStartFrame, countEndFrame],
    [0, targetCount],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const currentCount = Math.floor(rawCount);
  const progress = targetCount > 0 ? rawCount / targetCount : 0;
  const isCompleted = currentCount >= targetCount;

  // Pre-calculate exact frame for each bead increment
  const incrementFrames = useMemo(() => {
    const list: number[] = [];
    for (let c = 1; c <= targetCount; c++) {
      const f = Math.round(
        interpolate(c, [0, targetCount], [countStartFrame, countEndFrame], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      );
      list.push(f);
    }
    return list;
  }, [targetCount, countStartFrame, countEndFrame]);

  // Source string
  const sourceLabel = source?.collection
    ? `${source.collection}${source.hadithNum ? ` ${source.hadithNum}` : ""}`
    : "Authentic Sunnah";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#050b14",
        color: activeTheme.textPrimary,
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      <AmbientRainAudio />

      {/* Tactile Bead Click on each count increment */}
      {incrementFrames.map((f, i) => (
        <Sequence key={i} from={f} durationInFrames={6}>
          <Audio src={staticFile("islamic/bead.wav")} volume={0.35} />
        </Sequence>
      ))}

      {/* Resonant Chime when count completes */}
      <Sequence from={countEndFrame} durationInFrames={75}>
        <Audio src={staticFile("islamic/complete.wav")} volume={0.45} />
      </Sequence>

      {/* Background ambient rain & lighting */}
      <RainBackground gradient={activeTheme.backgroundGradient} />

      {/* Main UI Container */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          height: "100%",
          padding: "70px 48px 60px",
          boxSizing: "border-box",
        }}
      >
        {/* Top Header */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            opacity: introSpring,
            transform: `translateY(${interpolate(introSpring, [0, 1], [-20, 0])}px)`,
          }}
        >
          <div
            style={{
              padding: "6px 20px",
              borderRadius: "9999px",
              border: `1px solid ${activeTheme.border}`,
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              backdropFilter: "blur(12px)",
              fontSize: "19px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: activeTheme.accent,
            }}
          >
            {channelName}
          </div>
          <span
            style={{
              fontSize: "17px",
              color: activeTheme.textMuted,
              letterSpacing: "0.05em",
            }}
          >
            Daily Dhikr & Remembrance
          </span>
        </div>

        {/* Central Religious Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "24px",
            width: "100%",
            maxWidth: "920px",
            opacity: introSpring,
            transform: `scale(${interpolate(introSpring, [0, 1], [0.94, 1])})`,
          }}
        >
          {/* Arabic Dhikr with glowing typography */}
          <ArabicText
            text={arabic}
            fontSize={78}
            glowColor={activeTheme.accentGlow}
          />

          {/* Transliteration */}
          <Transliteration
            text={transliteration}
            fontSize={34}
            color={activeTheme.textSecondary}
          />

          {/* Translation */}
          <Translation
            text={meaning}
            fontSize={28}
            color={activeTheme.textPrimary}
          />
        </div>

        {/* Counter Visual Section: Tasbih beads + Circular Progress */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "560px",
            height: "400px",
            marginTop: "10px",
          }}
        >
          {/* Tasbih beads arch */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TasbihBeads
              totalBeads={33}
              currentCount={currentCount}
              width={540}
              height={380}
              accentColor={activeTheme.accent}
              inactiveColor={activeTheme.beadInactive}
            />
          </div>

          {/* Center Circular Progress Ring */}
          <CircularProgress
            progress={progress}
            currentCount={currentCount}
            targetCount={targetCount}
            size={260}
            strokeWidth={12}
            color={activeTheme.accent}
            trackColor="rgba(255, 255, 255, 0.08)"
          />

          {/* Completed badge pop-in */}
          {isCompleted && (
            <div
              style={{
                position: "absolute",
                bottom: "16px",
                padding: "8px 24px",
                borderRadius: "9999px",
                backgroundColor: "rgba(16, 185, 129, 0.9)",
                color: "#ffffff",
                fontSize: "20px",
                fontWeight: 700,
                letterSpacing: "0.05em",
                boxShadow: "0 0 24px rgba(16, 185, 129, 0.6)",
              }}
            >
              ✓ Alhamdulillah Completed
            </div>
          )}
        </div>

        {/* Footer: Source Attribution & Follow-Along Note */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <SourceRef
            sourceText={sourceLabel}
            authenticity={source?.authenticity || "Sahih"}
          />

          <span
            style={{
              fontSize: "15px",
              color: activeTheme.textMuted,
              letterSpacing: "0.02em",
            }}
          >
            {countType === "sunnah-suggested"
              ? "Recommended Sunnah Dhikr after Salah"
              : "*Illustrative follow-along counter"}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
