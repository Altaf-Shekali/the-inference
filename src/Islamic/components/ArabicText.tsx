import React from "react";
import { ARABIC_FONTS } from "../fonts";

interface ArabicTextProps {
  text: string;
  fontSize?: number;
  color?: string;
  glowColor?: string;
  style?: React.CSSProperties;
}

export const ArabicText: React.FC<ArabicTextProps> = ({
  text,
  fontSize = 72,
  color = "#ffffff",
  glowColor = "rgba(251, 191, 36, 0.45)",
  style,
}) => {
  return (
    <div
      dir="rtl"
      lang="ar"
      style={{
        fontFamily: ARABIC_FONTS,
        fontSize: `${fontSize}px`,
        fontWeight: 700,
        color,
        lineHeight: 1.5,
        textAlign: "center",
        textShadow: `0 0 24px ${glowColor}, 0 2px 8px rgba(0,0,0,0.8)`,
        letterSpacing: "0.02em",
        wordSpacing: "0.1em",
        userSelect: "none",
        ...style,
      }}
    >
      {text}
    </div>
  );
};
