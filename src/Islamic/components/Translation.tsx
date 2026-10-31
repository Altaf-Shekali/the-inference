import React from "react";

interface TranslationProps {
  text: string;
  fontSize?: number;
  color?: string;
  style?: React.CSSProperties;
}

export const Translation: React.FC<TranslationProps> = ({
  text,
  fontSize = 30,
  color = "#f8fafc",
  style,
}) => {
  return (
    <div
      style={{
        fontFamily: "'Poppins', sans-serif",
        fontSize: `${fontSize}px`,
        fontWeight: 400,
        color,
        textAlign: "center",
        lineHeight: 1.5,
        maxWidth: "850px",
        margin: "0 auto",
        ...style,
      }}
    >
      "{text}"
    </div>
  );
};
