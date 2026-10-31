import React from "react";
import { z } from "zod";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
} from "remotion";
import { THEMES } from "../themes";
import { ArabicText } from "../components/ArabicText";
import { Transliteration } from "../components/Transliteration";
import { Translation } from "../components/Translation";
import { SourceRef } from "../components/SourceRef";
import { RainBackground } from "../components/RainBackground";
import { AmbientRainAudio } from "../components/AmbientRainAudio";

export const learnDuaSchema = z.object({
  title: z.string().default("Dua for Beneficial Knowledge"),
  arabic: z.string().default("رَبِّ زِدْنِي عِلْمًا"),
  transliteration: z.string().default("Rabbi zidnī ʿilmā"),
  meaning: z.string().default("My Lord, increase me in knowledge."),
  context: z
    .string()
    .default(
      "Recite whenever seeking knowledge, studying, or asking Allah for clarity.",
    ),
  source: z.string().default("Surah Ta-Ha (20:114)"),
  authenticity: z.string().default("Quran"),
  theme: z.string().default("golden"),
  channelName: z.string().default("Islamic Reminders"),
});

export type LearnDuaProps = z.infer<typeof learnDuaSchema>;

export const sampleLearnDua: LearnDuaProps = {
  title: "Dua for Beneficial Knowledge",
  arabic: "رَبِّ زِدْنِي عِلْمًا",
  transliteration: "Rabbi zidnī ʿilmā",
  meaning: "My Lord, increase me in knowledge.",
  context:
    "Recite whenever seeking knowledge, studying, or asking Allah for clarity.",
  source: "Surah Ta-Ha (20:114)",
  authenticity: "Quran",
  theme: "golden",
  channelName: "Islamic Reminders",
};

export const calculateLearnDuaMetadata = async ({
  props,
}: {
  props: LearnDuaProps;
}) => {
  // 30 seconds default (900 frames @ 30fps)
  return {
    durationInFrames: 900,
    props,
  };
};

export const LearnDua: React.FC<LearnDuaProps> = ({
  title = "Dua for Beneficial Knowledge",
  arabic = "رَبِّ زِدْنِي عِلْمًا",
  transliteration = "Rabbi zidnī ʿilmā",
  meaning = "My Lord, increase me in knowledge.",
  context = "Recite whenever seeking knowledge, studying, or asking Allah for clarity.",
  source = "Surah Ta-Ha (20:114)",
  authenticity = "Quran",
  theme = "golden",
  channelName = "Islamic Reminders",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const activeTheme = THEMES[theme] || THEMES.golden;

  // Timed stage reveals for clear silent readability
  // Stage 0: Intro (0-60 frames)
  // Stage 1: Arabic reveal (60-180 frames)
  // Stage 2: Transliteration reveal (180-300 frames)
  // Stage 3: Meaning reveal (300-480 frames)
  // Stage 4: When to recite / context (480-720 frames)
  // Stage 5: Outro / Summary card (720-900 frames)

  const introOpacity = spring({
    frame,
    fps,
    config: { damping: 15 },
  });

  const arabicSpring = spring({
    frame: frame - 45,
    fps,
    config: { damping: 12, stiffness: 90 },
  });

  const translitSpring = spring({
    frame: frame - 120,
    fps,
    config: { damping: 14, stiffness: 80 },
  });

  const meaningSpring = spring({
    frame: frame - 180,
    fps,
    config: { damping: 14, stiffness: 80 },
  });

  const contextSpring = spring({
    frame: frame - 260,
    fps,
    config: { damping: 14, stiffness: 80 },
  });

  // Global subtle breathing scale
  const breathe = 1 + Math.sin((frame / 60) * Math.PI) * 0.015;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0a0702",
        color: activeTheme.textPrimary,
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      <AmbientRainAudio />

      {/* Subtle Shimmer chime at each stage reveal */}
      <Sequence from={45} durationInFrames={40}>
        <Audio src={staticFile("islamic/shimmer.wav")} volume={0.3} />
      </Sequence>
      <Sequence from={110} durationInFrames={40}>
        <Audio src={staticFile("islamic/shimmer.wav")} volume={0.25} />
      </Sequence>
      <Sequence from={170} durationInFrames={40}>
        <Audio src={staticFile("islamic/shimmer.wav")} volume={0.25} />
      </Sequence>
      <Sequence from={250} durationInFrames={40}>
        <Audio src={staticFile("islamic/shimmer.wav")} volume={0.25} />
      </Sequence>

      <RainBackground gradient={activeTheme.backgroundGradient} />

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
            gap: "10px",
            opacity: introOpacity,
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
              fontSize: "26px",
              fontWeight: 700,
              color: activeTheme.textPrimary,
              letterSpacing: "0.02em",
              textAlign: "center",
            }}
          >
            {title}
          </span>
        </div>

        {/* Central Display Card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
            maxWidth: "960px",
            padding: "48px 36px",
            borderRadius: "32px",
            backgroundColor: activeTheme.cardBg,
            border: `1px solid ${activeTheme.border}`,
            backdropFilter: "blur(20px)",
            boxShadow: `0 20px 50px rgba(0, 0, 0, 0.6), 0 0 40px ${activeTheme.accentGlow}`,
            gap: "32px",
            transform: `scale(${breathe})`,
          }}
        >
          {/* Section 1: Arabic Supplication */}
          {frame >= 40 && (
            <div
              style={{
                opacity: arabicSpring,
                transform: `scale(${interpolate(arabicSpring, [0, 1], [0.85, 1])})`,
                width: "100%",
              }}
            >
              <div
                style={{
                  fontSize: "18px",
                  fontWeight: 600,
                  color: activeTheme.accent,
                  textAlign: "center",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: "8px",
                }}
              >
                The Supplication
              </div>
              <ArabicText
                text={arabic}
                fontSize={86}
                glowColor={activeTheme.accentGlow}
              />
            </div>
          )}

          {/* Section 2: Transliteration */}
          {frame >= 110 && (
            <div
              style={{
                opacity: translitSpring,
                transform: `translateY(${interpolate(translitSpring, [0, 1], [20, 0])}px)`,
                width: "100%",
              }}
            >
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: activeTheme.textMuted,
                  textAlign: "center",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: "4px",
                }}
              >
                Transliteration
              </div>
              <Transliteration
                text={transliteration}
                fontSize={36}
                color={activeTheme.textSecondary}
              />
            </div>
          )}

          {/* Section 3: Meaning */}
          {frame >= 170 && (
            <div
              style={{
                opacity: meaningSpring,
                transform: `translateY(${interpolate(meaningSpring, [0, 1], [20, 0])}px)`,
                width: "100%",
              }}
            >
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: activeTheme.textMuted,
                  textAlign: "center",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: "4px",
                }}
              >
                Meaning
              </div>
              <Translation
                text={meaning}
                fontSize={32}
                color={activeTheme.textPrimary}
              />
            </div>
          )}

          {/* Section 4: When to recite / Guidance */}
          {frame >= 250 && (
            <div
              style={{
                opacity: contextSpring,
                transform: `translateY(${interpolate(contextSpring, [0, 1], [20, 0])}px)`,
                width: "100%",
                padding: "16px 24px",
                borderRadius: "16px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                textAlign: "center",
                boxSizing: "border-box",
              }}
            >
              <span
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: activeTheme.accent,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  display: "block",
                  marginBottom: "6px",
                }}
              >
                When to recite
              </span>
              <p
                style={{
                  margin: 0,
                  fontSize: "21px",
                  fontWeight: 400,
                  color: activeTheme.textSecondary,
                  lineHeight: 1.4,
                }}
              >
                {context}
              </p>
            </div>
          )}
        </div>

        {/* Footer: Source Reference and Save Prompt */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <SourceRef sourceText={source} authenticity={authenticity} />
          <span
            style={{
              fontSize: "16px",
              color: activeTheme.textMuted,
              letterSpacing: "0.04em",
            }}
          >
            Save this Dua & recite regularly
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
