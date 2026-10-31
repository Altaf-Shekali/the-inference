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
import { Translation } from "../components/Translation";
import { SourceRef } from "../components/SourceRef";
import { RainBackground } from "../components/RainBackground";
import { AmbientRainAudio } from "../components/AmbientRainAudio";

export const cinematicHadithSchema = z.object({
  topic: z.string().default("Good Character & Kindness"),
  narrator: z.string().default("Abu Hurairah (RA)"),
  arabic: z.string().optional(),
  hadithText: z
    .string()
    .default(
      "The Messenger of Allah ﷺ said: 'The most complete of the believers in faith, is the one with the best character.'",
    ),
  collection: z.string().default("Jami` at-Tirmidhi"),
  hadithNum: z.string().default("1162"),
  authenticity: z.string().default("Sahih"),
  theme: z.string().default("emerald"),
  channelName: z.string().default("Islamic Reminders"),
});

export type CinematicHadithProps = z.infer<typeof cinematicHadithSchema>;

export const sampleHadith: CinematicHadithProps = {
  topic: "Good Character & Kindness",
  narrator: "Abu Hurairah (RA)",
  arabic: "أَكْمَلُ الْمُؤْمِنِينَ إِيمَانًا أَحْسَنُهُمْ خُلُقًا",
  hadithText:
    "The Messenger of Allah ﷺ said: 'The most complete of the believers in faith, is the one with the best character.'",
  collection: "Jami` at-Tirmidhi",
  hadithNum: "1162",
  authenticity: "Sahih",
  theme: "emerald",
  channelName: "Islamic Reminders",
};

export const calculateHadithMetadata = async ({
  props,
}: {
  props: CinematicHadithProps;
}) => {
  return {
    durationInFrames: 900,
    props,
  };
};

export const CinematicHadith: React.FC<CinematicHadithProps> = ({
  topic = "Good Character & Kindness",
  narrator = "Abu Hurairah (RA)",
  arabic,
  hadithText = "The Messenger of Allah ﷺ said: 'The most complete of the believers in faith, is the one with the best character.'",
  collection = "Jami` at-Tirmidhi",
  hadithNum = "1162",
  authenticity = "Sahih",
  theme = "emerald",
  channelName = "Islamic Reminders",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const activeTheme = THEMES[theme] || THEMES.emerald;

  const introSpring = spring({
    frame,
    fps,
    config: { damping: 14 },
  });

  const contentSpring = spring({
    frame: frame - 45,
    fps,
    config: { damping: 14, stiffness: 80 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#061812",
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
            {topic}
          </span>
        </div>

        {/* Central Hadith Card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "28px",
            width: "100%",
            maxWidth: "960px",
            padding: "48px 36px",
            borderRadius: "32px",
            backgroundColor: activeTheme.cardBg,
            border: `1px solid ${activeTheme.border}`,
            backdropFilter: "blur(20px)",
            boxShadow: `0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px ${activeTheme.accentGlow}`,
            opacity: contentSpring,
            transform: `scale(${interpolate(contentSpring, [0, 1], [0.93, 1])})`,
          }}
        >
          {narrator && (
            <div
              style={{
                fontSize: "18px",
                fontWeight: 600,
                color: activeTheme.accent,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Narrated by {narrator}
            </div>
          )}

          {arabic && (
            <ArabicText
              text={arabic}
              fontSize={64}
              glowColor={activeTheme.accentGlow}
            />
          )}

          <Translation
            text={hadithText}
            fontSize={34}
            color={activeTheme.textPrimary}
          />
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
            sourceText={`${collection} ${hadithNum}`}
            authenticity={authenticity}
          />
          <span
            style={{
              fontSize: "16px",
              color: activeTheme.textMuted,
              letterSpacing: "0.04em",
            }}
          >
            Authentic Prophetic Guidance ﷺ
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
