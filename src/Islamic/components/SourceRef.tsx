import React from "react";

interface SourceRefProps {
  sourceText: string;
  authenticity?: string;
  style?: React.CSSProperties;
}

export const SourceRef: React.FC<SourceRefProps> = ({
  sourceText,
  authenticity,
  style,
}) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 18px",
        borderRadius: "9999px",
        backgroundColor: "rgba(255, 255, 255, 0.08)",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        backdropFilter: "blur(8px)",
        color: "#94a3b8",
        fontSize: "20px",
        fontWeight: 500,
        letterSpacing: "0.04em",
        ...style,
      }}
    >
      <span style={{ color: "#fbbf24", fontWeight: 700 }}>✦</span>
      <span>{sourceText}</span>
      {authenticity && (
        <span
          style={{
            padding: "2px 8px",
            borderRadius: "6px",
            backgroundColor: "rgba(16, 185, 129, 0.2)",
            color: "#34d399",
            fontSize: "16px",
            fontWeight: 600,
            border: "1px solid rgba(16, 185, 129, 0.4)",
          }}
        >
          {authenticity}
        </span>
      )}
    </div>
  );
};
