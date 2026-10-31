import React from "react";

interface CircularProgressProps {
  progress: number; // 0 to 1
  currentCount: number;
  targetCount: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({
  progress,
  currentCount,
  targetCount,
  size = 280,
  strokeWidth = 14,
  color = "#fbbf24",
  trackColor = "rgba(255, 255, 255, 0.12)",
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const strokeDashoffset = circumference - clampedProgress * circumference;

  return (
    <div
      style={{
        position: "relative",
        width: `${size}px`,
        height: `${size}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width={size}
        height={size}
        style={{
          transform: "rotate(-90deg)",
        }}
      >
        {/* Track circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 12px ${color})`,
          }}
        />
      </svg>

      {/* Center numbers */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "'Poppins', sans-serif",
            fontSize: "68px",
            fontWeight: 800,
            color: "#ffffff",
            lineHeight: 1,
            textShadow: `0 0 20px ${color}`,
          }}
        >
          {currentCount}
        </span>
        <span
          style={{
            fontFamily: "'Poppins', sans-serif",
            fontSize: "22px",
            fontWeight: 600,
            color: "rgba(255, 255, 255, 0.6)",
            marginTop: "6px",
            letterSpacing: "0.08em",
          }}
        >
          / {targetCount}
        </span>
      </div>
    </div>
  );
};
