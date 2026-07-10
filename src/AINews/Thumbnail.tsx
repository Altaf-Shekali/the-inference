import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
// Self-hosted (public/fonts/, via `npm run fonts`) — no gstatic fetch at render.
import { FONTS, withIndic } from "./fonts";

const font = withIndic(FONTS.poppins);

const BG = "#0A0E1A";
const BG2 = "#111A2E";
const INK = "#F8FAFC";

/* Thumbnail shares the channel's design system. Rendered as a STILL:
 *   npx remotion still AINewsThumbnail out/thumb.png --props=video.json
 * The pipeline reuses fields from the video's data (accent, channelName). */
export const thumbnailSchema = z.object({
  badge: z.string(), // small top label, e.g. "AI NEWS"
  bigText: z.string(), // the punchy headline (keep it short, 3–6 words)
  subText: z.string(), // supporting line
  accent: zColor(),
  channelName: z.string(),
  image: z.string().optional(), // right-side image in public/
});

export type ThumbnailProps = z.infer<typeof thumbnailSchema>;

export const AINewsThumbnail: React.FC<ThumbnailProps> = ({
  badge,
  bigText,
  subText,
  accent,
  channelName,
  image,
}) => {
  return (
    <AbsoluteFill style={{ background: BG, fontFamily: font, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 22% 30%, ${BG2} 0%, ${BG} 65%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "-12%",
          left: "-10%",
          width: 760,
          height: 760,
          borderRadius: "50%",
          background: accent,
          opacity: 0.2,
          filter: "blur(150px)",
        }}
      />

      {/* optional right-side image with a fade into the background */}
      {image ? (
        <>
          <Img
            src={staticFile(image)}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              width: "52%",
              height: "100%",
              objectFit: "cover",
            }}
          />
          <AbsoluteFill
            style={{
              background: `linear-gradient(90deg, ${BG} 30%, transparent 72%)`,
            }}
          />
        </>
      ) : null}

      {/* text block */}
      <AbsoluteFill
        style={{ justifyContent: "center", padding: "0 110px", width: image ? "62%" : "100%" }}
      >
        <div
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            background: accent,
            color: BG,
            fontWeight: 800,
            fontSize: 40,
            letterSpacing: 3,
            padding: "12px 28px",
            borderRadius: 10,
            marginBottom: 34,
          }}
        >
          {badge.toUpperCase()}
        </div>
        <div
          style={{
            fontWeight: 800,
            fontSize: 150,
            lineHeight: 0.98,
            color: INK,
            letterSpacing: -3,
            textShadow: "0 8px 40px rgba(0,0,0,0.6)",
          }}
        >
          {bigText}
        </div>
        <div
          style={{
            fontWeight: 600,
            fontSize: 54,
            color: accent,
            marginTop: 30,
          }}
        >
          {subText}
        </div>
      </AbsoluteFill>

      {/* channel watermark */}
      <div
        style={{
          position: "absolute",
          left: 110,
          bottom: 70,
          fontWeight: 700,
          fontSize: 38,
          color: "rgba(248,250,252,0.6)",
          letterSpacing: 1,
        }}
      >
        {channelName}
      </div>
    </AbsoluteFill>
  );
};
