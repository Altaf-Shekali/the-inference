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

export const islamicReminderSchema = z.object({
  title: z.string().default("Do Not Despair of Allah's Mercy"),
  arabic: z.string().optional(),
  transliteration: z.string().optional(),
  reminderText: z
    .string()
    .default(
      "Never allow past mistakes to make you feel distant from Allah. The door to sincere repentance is always open.",
    ),
  supportingEvidence: z.string().default("Surah Az-Zumar (39:53)"),
  theme: z.string().default("golden"),
  channelName: z.string().default("Islamic Reminders"),
});

export type IslamicReminderProps = z.infer<typeof islamicReminderSchema>;

export const sampleReminder: IslamicReminderProps = {
  title: "Do Not Despair of Allah's Mercy",
  arabic: "قُلْ يَا عِبَادِيَ الَّذِينَ أَسْرَفُوا عَلَىٰ أَنفُسِهِمْ لَا تَقْنَطُوا مِن رَّحْمَةِ اللَّهِ",
  transliteration: "Qul yā ʿibādiya alladhīna asrafū ʿalā anfusihim lā taqnaṭū min raḥmati Allāh",
  reminderText:
    "Never allow past mistakes to make you feel distant from Allah. The door to sincere repentance is always open.",
  supportingEvidence: "Surah Az-Zumar (39:53)",
  theme: "golden",
  channelName: "Islamic Reminders",
};

export const calculateReminderMetadata = async ({
  props,
}: {
  props: IslamicReminderProps;
}) => {
  return {
    durationInFrames: 900,
    props,
  };
};

export const IslamicReminder: React.FC<IslamicReminderProps> = ({
  title = "Do Not Despair of Allah's Mercy",
  arabic,
  transliteration,
  reminderText = "Never allow past mistakes to make you feel distant from Allah. The door to sincere repentance is always open.",
  supportingEvidence = "Surah Az-Zumar (39:53)",
  theme = "golden",
  channelName = "Islamic Reminders",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const activeTheme = THEMES[theme] || THEMES.golden;

  const introSpring = spring({
    frame,
    fps,
    config: { damping: 14 },
  });

  const cardSpring = spring({
    frame: frame - 40,
    fps,
    config: { damping: 14, stiffness: 80 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0a0702",
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
            Daily Reminder
          </span>
        </div>

        {/* Central Card */}
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
            opacity: cardSpring,
            transform: `scale(${interpolate(cardSpring, [0, 1], [0.93, 1])})`,
          }}
        >
          <div
            style={{
              fontSize: "30px",
              fontWeight: 800,
              color: activeTheme.accent,
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            {title}
          </div>

          {arabic && (
            <ArabicText
              text={arabic}
              fontSize={60}
              glowColor={activeTheme.accentGlow}
            />
          )}

          {transliteration && (
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
          )}

          <Translation
            text={reminderText}
            fontSize={32}
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
          <SourceRef sourceText={supportingEvidence} authenticity="Authentic" />
          <span
            style={{
              fontSize: "16px",
              color: activeTheme.textMuted,
              letterSpacing: "0.04em",
            }}
          >
            Share this reminder to benefit others
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
