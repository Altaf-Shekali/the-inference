import React from "react";

interface TransliterationProps {
  text: string;
  fontSize?: number;
  color?: string;
  style?: React.CSSProperties;
}

export const Transliteration: React.FC<TransliterationProps> = ({
  text,
  fontSize = 32,
  color = "#cbd5e1",
  style,
}) => {
  return (
    <div
      style={{
        fontFamily: "'Poppins', sans-serif",
        fontSize: `${fontSize}px`,
        fontWeight: 500,
        fontStyle: "italic",
        color,
        textAlign: "center",
        lineHeight: 1.4,
        letterSpacing: "0.03em",
        ...style,
      }}
    >
      {text}
    </div>
  );
};
