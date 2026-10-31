import React, { useMemo } from "react";

interface TasbihBeadsProps {
  totalBeads?: number;
  currentCount: number;
  width?: number;
  height?: number;
  accentColor?: string;
  inactiveColor?: string;
}

export const TasbihBeads: React.FC<TasbihBeadsProps> = ({
  totalBeads = 33,
  currentCount,
  width = 540,
  height = 360,
  accentColor = "#fbbf24",
  inactiveColor = "rgba(255, 255, 255, 0.2)",
}) => {
  const activeIndex = Math.min(Math.max(currentCount - 1, -1), totalBeads - 1);

  const beads = useMemo(() => {
    const list = [];
    const rx = width * 0.44;
    const ry = height * 0.42;
    const cx = width / 2;
    const cy = height / 2;

    // Arc from 145 deg to 395 deg (open at bottom so it wraps gracefully)
    const startAngle = (140 * Math.PI) / 180;
    const endAngle = (400 * Math.PI) / 180;
    const step = (endAngle - startAngle) / (totalBeads - 1);

    for (let i = 0; i < totalBeads; i++) {
      const angle = startAngle + i * step;
      const x = cx + rx * Math.cos(angle);
      const y = cy + ry * Math.sin(angle);
      list.push({ index: i, x, y });
    }
    return list;
  }, [totalBeads, width, height]);

  return (
    <svg
      width={width}
      height={height}
      style={{
        overflow: "visible",
      }}
    >
      {/* Background connecting thread / string */}
      <path
        d={beads.reduce((acc, b, i) => `${acc} ${i === 0 ? "M" : "L"} ${b.x} ${b.y}`, "")}
        fill="none"
        stroke="rgba(255, 255, 255, 0.1)"
        strokeWidth="2"
        strokeDasharray="4 4"
      />

      {/* Beads */}
      {beads.map((b) => {
        const isCompleted = b.index < activeIndex;
        const isActive = b.index === activeIndex;

        let fill = inactiveColor;
        let r = 8;
        let stroke = "none";
        let filter = "none";

        if (isCompleted) {
          fill = accentColor;
          r = 8.5;
        } else if (isActive) {
          fill = "#ffffff";
          r = 13;
          stroke = accentColor;
          filter = `drop-shadow(0 0 10px ${accentColor})`;
        }

        return (
          <circle
            key={b.index}
            cx={b.x}
            cy={b.y}
            r={r}
            fill={fill}
            stroke={stroke}
            strokeWidth={isActive ? 3 : 0}
            style={{
              filter,
            }}
          />
        );
      })}
    </svg>
  );
};
