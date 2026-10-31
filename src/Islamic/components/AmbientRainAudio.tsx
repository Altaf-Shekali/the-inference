import React from "react";
import { Audio, interpolate, staticFile, useVideoConfig } from "remotion";

export const AmbientRainAudio: React.FC<{ volume?: number }> = ({
  volume = 0.1,
}) => {
  const { durationInFrames } = useVideoConfig();

  return (
    <Audio
      src={staticFile("islamic/rain.wav")}
      loop
      volume={(frame) =>
        interpolate(
          frame,
          [0, 30, durationInFrames - 30, durationInFrames],
          [0, volume, volume, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      }
    />
  );
};
