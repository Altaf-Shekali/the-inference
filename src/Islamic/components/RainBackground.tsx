import React, { useMemo } from "react";
import { useCurrentFrame } from "remotion";

interface RainBackgroundProps {
  gradient?: string;
  particleCount?: number;
}

export const RainBackground: React.FC<RainBackgroundProps> = ({
  gradient = "radial-gradient(circle at 50% 15%, #0f2744 0%, #081326 45%, #040812 100%)",
  particleCount = 55,
}) => {
  const frame = useCurrentFrame();

  const particles = useMemo(() => {
    const list = [];
    for (let i = 0; i < particleCount; i++) {
      // Deterministic pseudo-random distribution
      const seedX = (Math.sin(i * 997 + 13) * 10000) % 1;
      const seedY = (Math.cos(i * 733 + 29) * 10000) % 1;
      const seedSpeed = (Math.sin(i * 421 + 7) * 10000) % 1;
      const seedLength = (Math.cos(i * 127 + 53) * 10000) % 1;
      const seedOpacity = (Math.sin(i * 311 + 83) * 10000) % 1;

      const x = Math.abs(seedX) * 1080;
      const initialY = Math.abs(seedY) * 1920;
      const speed = 12 + Math.abs(seedSpeed) * 18;
      const length = 20 + Math.abs(seedLength) * 35;
      const opacity = 0.15 + Math.abs(seedOpacity) * 0.35;

      list.push({ x, initialY, speed, length, opacity });
    }
    return list;
  }, [particleCount]);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: gradient,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {/* Top ambient moonlight glow */}
      <div
        style={{
          position: "absolute",
          top: "-150px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "800px",
          height: "600px",
          background: "radial-gradient(ellipse at center, rgba(147, 197, 253, 0.18) 0%, rgba(59, 130, 246, 0.05) 50%, transparent 75%)",
          filter: "blur(40px)",
        }}
      />

      {/* Rain particles */}
      <svg
        width="1080"
        height="1920"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
        }}
      >
        {particles.map((p, idx) => {
          const currentY = (p.initialY + frame * p.speed) % 2000 - 80;
          return (
            <line
              key={idx}
              x1={p.x}
              y1={currentY}
              x2={p.x - 2}
              y2={currentY + p.length}
              stroke="rgba(219, 234, 254, 0.6)"
              strokeWidth="1.5"
              strokeOpacity={p.opacity}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    </div>
  );
};
