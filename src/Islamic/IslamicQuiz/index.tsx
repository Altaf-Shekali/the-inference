import React from "react";
import { z } from "zod";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  AbsoluteFill,
} from "remotion";
import { THEMES } from "../themes";
import { SourceRef } from "../components/SourceRef";
import { RainBackground } from "../components/RainBackground";
import { AmbientRainAudio } from "../components/AmbientRainAudio";

export const islamicQuizSchema = z.object({
  question: z
    .string()
    .default("Which Surah of the Holy Quran is known as the 'Heart of the Quran'?"),
  options: z.array(z.string()).default([
    "Surah Al-Mulk",
    "Surah Ya-Sin",
    "Surah Al-Kahf",
    "Surah Ar-Rahman",
  ]),
  correctIndex: z.number().default(1),
  explanation: z
    .string()
    .default(
      "Prophet Muhammad ﷺ mentioned that everything has a heart, and the heart of the Quran is Surah Ya-Sin.",
    ),
  source: z.string().default("Sunan at-Tirmidhi (2887)"),
  theme: z.string().default("midnight"),
  channelName: z.string().default("Islamic Reminders"),
});

export type IslamicQuizProps = z.infer<typeof islamicQuizSchema>;

export const sampleIslamicQuiz: IslamicQuizProps = {
  question: "Which Surah of the Holy Quran is known as the 'Heart of the Quran'?",
  options: [
    "Surah Al-Mulk",
    "Surah Ya-Sin",
    "Surah Al-Kahf",
    "Surah Ar-Rahman",
  ],
  correctIndex: 1,
  explanation:
    "The Prophet ﷺ said: 'Indeed everything has a heart, and the heart of the Quran is Ya-Sin.'",
  source: "Jami` at-Tirmidhi 2887",
  theme: "midnight",
  channelName: "Islamic Reminders",
};

export const calculateQuizMetadata = async ({
  props,
}: {
  props: IslamicQuizProps;
}) => {
  return {
    durationInFrames: 600, // 20s
    props,
  };
};

export const IslamicQuiz: React.FC<IslamicQuizProps> = ({
  question = "Which Surah of the Holy Quran is known as the 'Heart of the Quran'?",
  options = [
    "Surah Al-Mulk",
    "Surah Ya-Sin",
    "Surah Al-Kahf",
    "Surah Ar-Rahman",
  ],
  correctIndex = 1,
  explanation = "The Prophet ﷺ said: 'Indeed everything has a heart, and the heart of the Quran is Ya-Sin.'",
  source = "Jami` at-Tirmidhi 2887",
  theme = "midnight",
  channelName = "Islamic Reminders",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const activeTheme = THEMES[theme] || THEMES.midnight;

  // Reveal happens at frame 270 (9 seconds)
  const revealFrame = 270;
  const isRevealed = frame >= revealFrame;

  // Countdown timer from frame 30 to revealFrame
  const remainingSeconds = Math.max(
    0,
    Math.ceil((revealFrame - frame) / fps),
  );

  const introSpring = spring({
    frame,
    fps,
    config: { damping: 14 },
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
            Islamic Knowledge Quiz
          </span>
        </div>

        {/* Central Quiz Container */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
            maxWidth: "960px",
            gap: "28px",
          }}
        >
          {/* Question Card */}
          <div
            style={{
              width: "100%",
              padding: "36px 32px",
              borderRadius: "28px",
              backgroundColor: activeTheme.cardBg,
              border: `1px solid ${activeTheme.border}`,
              backdropFilter: "blur(20px)",
              boxShadow: `0 20px 40px rgba(0, 0, 0, 0.5)`,
              textAlign: "center",
              fontSize: "32px",
              fontWeight: 700,
              lineHeight: 1.4,
              color: "#ffffff",
              boxSizing: "border-box",
            }}
          >
            {question}
          </div>

          {/* Countdown badge (pre-reveal) */}
          {!isRevealed ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 24px",
                borderRadius: "9999px",
                backgroundColor: "rgba(239, 68, 68, 0.2)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "#f87171",
                fontSize: "22px",
                fontWeight: 700,
              }}
            >
              <span>⏱</span>
              <span>Time left: {remainingSeconds}s</span>
            </div>
          ) : (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 24px",
                borderRadius: "9999px",
                backgroundColor: "rgba(16, 185, 129, 0.2)",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                color: "#34d399",
                fontSize: "22px",
                fontWeight: 700,
              }}
            >
              <span>✓</span>
              <span>Correct Answer Revealed</span>
            </div>
          )}

          {/* Options List */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              width: "100%",
            }}
          >
            {options.map((opt, idx) => {
              const isCorrect = idx === correctIndex;
              let bg = "rgba(255, 255, 255, 0.05)";
              let border = "rgba(255, 255, 255, 0.12)";
              let textColor = "#f1f5f9";
              let shadow = "none";

              if (isRevealed) {
                if (isCorrect) {
                  bg = "rgba(16, 185, 129, 0.25)";
                  border = "2px solid #10b981";
                  textColor = "#ffffff";
                  shadow = "0 0 30px rgba(16, 185, 129, 0.4)";
                } else {
                  bg = "rgba(0, 0, 0, 0.3)";
                  border = "1px solid rgba(255, 255, 255, 0.05)";
                  textColor = "#64748b";
                }
              }

              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "20px",
                    padding: "20px 28px",
                    borderRadius: "20px",
                    backgroundColor: bg,
                    border,
                    color: textColor,
                    boxShadow: shadow,
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "12px",
                      backgroundColor:
                        isRevealed && isCorrect
                          ? "#10b981"
                          : "rgba(255, 255, 255, 0.1)",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: "20px",
                    }}
                  >
                    {String.fromCharCode(65 + idx)}
                  </div>
                  <span
                    style={{
                      fontSize: "26px",
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {opt}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Explanation on reveal */}
          {isRevealed && (
            <div
              style={{
                width: "100%",
                padding: "18px 24px",
                borderRadius: "16px",
                backgroundColor: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                textAlign: "center",
                color: activeTheme.textSecondary,
                fontSize: "20px",
                lineHeight: 1.4,
                boxSizing: "border-box",
              }}
            >
              {explanation}
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
          <SourceRef sourceText={source} authenticity="Verified" />
          <span
            style={{
              fontSize: "16px",
              color: activeTheme.textMuted,
              letterSpacing: "0.04em",
            }}
          >
            How did you score? Comment below!
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
