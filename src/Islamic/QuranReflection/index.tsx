import React from "react";
import { z } from "zod";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  AbsoluteFill,
} from "remotion";
import { THEMES } from "../themes";
import { ArabicText } from "../components/ArabicText";
import { Transliteration } from "../components/Transliteration";
import { Translation } from "../components/Translation";
import { SourceRef } from "../components/SourceRef";
import { RainBackground } from "../components/RainBackground";
import { AmbientRainAudio } from "../components/AmbientRainAudio";

export const quranReflectionSchema = z.object({
  surahName: z.string().default("Ash-Sharh"),
  surahNum: z.number().default(94),
  ayahNum: z.number().default(6),
  arabic: z.string().default("إِنَّ مَعَ الْعُسْرِ يُسْرًا"),
  transliteration: z.string().default("Inna ma'al-'usri yusra"),
  translation: z.string().default("Indeed, with hardship comes ease."),
  reflection: z
    .string()
    .default(
      "No matter what hardship you face today, Allah promises ease alongside it.",
    ),
  theme: z.string().default("midnight"),
  channelName: z.string().default("Islamic Reminders"),
});

export type QuranReflectionProps = z.infer<typeof quranReflectionSchema>;

export const sampleQuran: QuranReflectionProps = {
  surahName: "Ash-Sharh",
  surahNum: 94,
  ayahNum: 6,
  arabic: "إِنَّ مَعَ الْعُسْرِ يُسْرًا",
  transliteration: "Inna ma'al-'usri yusra",
  translation: "Indeed, with hardship comes ease.",
  reflection:
    "No matter what hardship you face today, Allah promises ease alongside it.",
  theme: "midnight",
  channelName: "Islamic Reminders",
};

export const calculateQuranMetadata = async ({
  props,
}: {
  props: QuranReflectionProps;
}) => {
  return {
    durationInFrames: 900,
    props,
  };
};

export const QuranReflection: React.FC<QuranReflectionProps> = ({
  surahName = "Ash-Sharh",
  surahNum = 94,
  ayahNum = 6,
  arabic = "إِنَّ مَعَ الْعُسْرِ يُسْرًا",
  transliteration = "Inna ma'al-'usri yusra",
  translation = "Indeed, with hardship comes ease.",
  reflection = "No matter what hardship you face today, Allah promises ease alongside it.",
  theme = "midnight",
  channelName = "Islamic Reminders",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const activeTheme = THEMES[theme] || THEMES.midnight;

  const introSpring = spring({
    frame,
    fps,
    config: { damping: 14 },
  });

  const verseSpring = spring({
    frame: frame - 40,
    fps,
    config: { damping: 14, stiffness: 85 },
  });

  const reflectSpring = spring({
    frame: frame - 180,
    fps,
    config: { damping: 14, stiffness: 80 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#050b14",
        color: activeTheme.textPrimary,
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      <AmbientRainAudio />
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
            gap: "8px",
            opacity: introSpring,
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
              fontSize: "24px",
              fontWeight: 700,
              color: activeTheme.textPrimary,
              letterSpacing: "0.02em",
            }}
          >
            Quranic Reflection
          </span>
        </div>

        {/* Central Display Card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "32px",
            width: "100%",
            maxWidth: "960px",
            padding: "48px 36px",
            borderRadius: "32px",
            backgroundColor: activeTheme.cardBg,
            border: `1px solid ${activeTheme.border}`,
            backdropFilter: "blur(20px)",
            boxShadow: `0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px ${activeTheme.accentGlow}`,
            opacity: verseSpring,
            transform: `scale(${interpolate(verseSpring, [0, 1], [0.93, 1])})`,
          }}
        >
          {/* Surah Reference Pill */}
          <div
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: activeTheme.accent,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Surah {surahName} ({surahNum}:{ayahNum})
          </div>

          {/* Arabic Verse */}
          <ArabicText
            text={arabic}
            fontSize={78}
            glowColor={activeTheme.accentGlow}
          />

          <div style={{ width: "100%" }}>
            <div
              style={{
                fontSize: "15px",
                fontWeight: 700,
                color: activeTheme.textMuted,
                textAlign: "center",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: "4px",
              }}
            >
              Transliteration
            </div>
            <Transliteration
              text={transliteration}
              fontSize={26}
              color={activeTheme.textSecondary}
            />
          </div>

          {/* Translation */}
          <Translation
            text={translation}
            fontSize={36}
            color={activeTheme.textPrimary}
          />

          {/* Practical Reflection */}
          {frame >= 160 && (
            <div
              style={{
                opacity: reflectSpring,
                transform: `translateY(${interpolate(reflectSpring, [0, 1], [20, 0])}px)`,
                width: "100%",
                padding: "18px 24px",
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
                Reflection
              </span>
              <p
                style={{
                  margin: 0,
                  fontSize: "22px",
                  fontWeight: 400,
                  color: activeTheme.textSecondary,
                  lineHeight: 1.4,
                }}
              >
                {reflection}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <SourceRef
            sourceText={`Surah ${surahName} • Tanzil Verified`}
            authenticity="Quran"
          />
          <span
            style={{
              fontSize: "16px",
              color: activeTheme.textMuted,
              letterSpacing: "0.04em",
            }}
          >
            Reflect upon the words of your Creator
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
