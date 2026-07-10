import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from "remotion";
import { z } from "zod";
import { loadFont as loadKannada } from "@remotion/google-fonts/NotoSansKannada";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";

const { fontFamily: kannadaFont } = loadKannada();
const { fontFamily: poppinsFont } = loadPoppins();

// Brand palette — matches the real Kaval app icon (#1565C0 with a blue check)
const BRAND = "#1565C0";
const BRAND_DEEP = "#0D47A1";
const BRAND_LIGHT = "#42A5F5";
const WHITE = "#FFFFFF";

export const kavalIntroSchema = z.object({
  appNameKn: z.string(),
  appNameEn: z.string(),
  tagline: z.string(),
  footer: z.string(),
  // Feature chips shown near the bottom
  chips: z
    .array(z.string())
    .default([
      "ಫೋನ್ ಸ್ಕ್ಯಾನ್",
      "ಬ್ರೀಚ್ ಪರಿಶೀಲನೆ",
      "ವೈಫೈ ಸುರಕ್ಷತೆ",
      "ಪಾಸ್‌ವರ್ಡ್",
      "ಲಿಂಕ್ ಸುರಕ್ಷತೆ",
    ]),
  // Which font to use for the body copy (tagline, chips, footer + the hero
  // line). "kannada" keeps the original look; "latin" renders an English cut.
  scriptFont: z.enum(["kannada", "latin"]).default("kannada"),
});

export type KavalIntroProps = z.infer<typeof kavalIntroSchema>;

const Shield: React.FC<{ progress: number; checkDraw: number }> = ({
  progress,
  checkDraw,
}) => {
  // Shield body — white fill on the blue background, with a blue checkmark inside.
  return (
    <svg
      width={420}
      height={500}
      viewBox="0 0 100 120"
      style={{
        filter: "drop-shadow(0 24px 60px rgba(0,0,0,0.35))",
      }}
    >
      <path
        d="M50 4 L92 19 L92 60 C92 92 73 110 50 118 C27 110 8 92 8 60 L8 19 Z"
        fill={WHITE}
        opacity={progress}
      />
      <polyline
        points="33,62 45,76 70,42"
        fill="none"
        stroke={BRAND}
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - checkDraw}
      />
    </svg>
  );
};

const Chip: React.FC<{ label: string; delay: number; font: string }> = ({
  label,
  delay,
  font,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 14 } });
  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const translateY = interpolate(enter, [0, 1], [24, 0]);
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        background: "rgba(255,255,255,0.14)",
        border: "1px solid rgba(255,255,255,0.25)",
        color: WHITE,
        padding: "14px 26px",
        borderRadius: 999,
        fontFamily: font,
        fontSize: 34,
        fontWeight: 600,
        backdropFilter: "blur(4px)",
      }}
    >
      {label}
    </div>
  );
};

export const KavalIntro: React.FC<KavalIntroProps> = ({
  appNameKn,
  appNameEn,
  tagline,
  footer,
  chips,
  scriptFont,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Body copy font — Latin renders the English cut, otherwise Kannada.
  const bodyFont = scriptFont === "latin" ? poppinsFont : kannadaFont;

  // Background subtle zoom for life
  const bgScale = interpolate(frame, [0, durationInFrames], [1.08, 1.16]);

  // Shield entrance
  const shieldSpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 90 },
  });
  const shieldScale = interpolate(shieldSpring, [0, 1], [0.4, 1]);
  const shieldProgress = interpolate(frame, [4, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const checkDraw = interpolate(frame, [22, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Lift the shield up once the wordmark comes in, to make room below it
  const lift = interpolate(frame, [48, 72], [0, -340], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Wordmark
  const wordSpring = spring({
    frame: frame - 50,
    fps,
    config: { damping: 14 },
  });
  const wordOpacity = interpolate(wordSpring, [0, 1], [0, 1]);
  const wordY = interpolate(wordSpring, [0, 1], [40, 0]);

  // Final fade for footer
  const footerOpacity = interpolate(frame, [150, 165], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 35%, ${BRAND_LIGHT} 0%, ${BRAND} 42%, ${BRAND_DEEP} 100%)`,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* soft glow blobs */}
      <AbsoluteFill style={{ transform: `scale(${bgScale})` }}>
        <div
          style={{
            position: "absolute",
            top: "12%",
            left: "10%",
            width: 500,
            height: 500,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.10)",
            filter: "blur(80px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "10%",
            right: "8%",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: "rgba(13,71,161,0.45)",
            filter: "blur(90px)",
          }}
        />
      </AbsoluteFill>

      {/* Shield */}
      <div
        style={{
          position: "absolute",
          transform: `translateY(${lift}px) scale(${shieldScale})`,
        }}
      >
        <Shield progress={shieldProgress} checkDraw={checkDraw} />
      </div>

      {/* Wordmark + tagline */}
      <Sequence from={50}>
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            transform: "translateY(180px)",
          }}
        >
          <div
            style={{
              opacity: wordOpacity,
              transform: `translateY(${wordY}px)`,
              textAlign: "center",
            }}
          >
            {appNameKn ? (
              <div
                style={{
                  fontFamily: scriptFont === "latin" ? poppinsFont : kannadaFont,
                  fontSize: 150,
                  fontWeight: 700,
                  color: WHITE,
                  lineHeight: 1,
                  letterSpacing: -1,
                }}
              >
                {appNameKn}
              </div>
            ) : null}
            {appNameEn ? (
              <div
                style={{
                  fontFamily: poppinsFont,
                  fontSize: 56,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.85)",
                  letterSpacing: 14,
                  marginTop: 8,
                  textTransform: "uppercase",
                }}
              >
                {appNameEn}
              </div>
            ) : null}
            <div
              style={{
                fontFamily: bodyFont,
                fontSize: 46,
                fontWeight: 500,
                color: "rgba(255,255,255,0.9)",
                marginTop: 28,
              }}
            >
              {tagline}
            </div>
          </div>
        </AbsoluteFill>
      </Sequence>

      {/* Feature chips */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 320,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            justifyContent: "center",
            maxWidth: 900,
          }}
        >
          {chips.map((label, i) => (
            <Chip key={label} label={label} delay={104 + i * 8} font={bodyFont} />
          ))}
        </div>
      </AbsoluteFill>

      {/* Footer */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 150,
        }}
      >
        <div
          style={{
            opacity: footerOpacity,
            fontFamily: bodyFont,
            fontSize: 34,
            fontWeight: 600,
            color: WHITE,
            background: "rgba(255,255,255,0.12)",
            padding: "14px 36px",
            borderRadius: 999,
            letterSpacing: 1,
            maxWidth: 960,
            textAlign: "center",
          }}
        >
          {footer}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
