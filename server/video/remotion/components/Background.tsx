import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { PalettePresetKind, TransitionKind } from "../../../../src/types/videoPipeline.js";
import { PALETTE_TOKENS, SPRING_PRESETS } from "../tokens.js";

export interface BackgroundProps {
  preset?: PalettePresetKind;
  palette?: [string, string, string];
  showGrid?: boolean;
  glowPosition?: "top" | "center" | "bottom";
}

export const Background: React.FC<BackgroundProps> = ({
  preset = "studio_amber",
  palette,
  showGrid = true,
  glowPosition = "center",
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;

  const topColor = palette?.[0] || tokens.bgPrimary;
  const bottomColor = palette?.[1] || tokens.bgSecondary;
  const accentColor = palette?.[2] || tokens.accent;

  const progress = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  const driftY = interpolate(progress, [0, 1], [-24, 36]);
  const driftX = Math.sin(progress * Math.PI * 2) * 18;
  const gridShiftX = interpolate(progress, [0, 1], [0, 48]);
  const gridShiftY = interpolate(progress, [0, 1], [0, 28]);
  const glowScale = 1 + Math.sin(progress * Math.PI * 2) * 0.06;

  const glowY = glowPosition === "top" ? "20%" : glowPosition === "bottom" ? "78%" : "42%";

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(155deg, ${topColor} 0%, ${bottomColor} 65%, ${topColor} 100%)`,
        overflow: "hidden",
      }}
    >
      {/* Atmospheric Radial Spotlight with continuous motion */}
      <div
        style={{
          position: "absolute",
          inset: "-22%",
          background: `radial-gradient(circle at 50% ${glowY}, ${accentColor}2E 0%, transparent 58%)`,
          transform: `translate3d(${driftX.toFixed(2)}px, ${driftY.toFixed(2)}px, 0) scale(${glowScale.toFixed(4)})`,
        }}
      />

      {/* Subtle Technical Grid with smooth parallax */}
      {showGrid && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "54px 54px",
            backgroundPosition: `${gridShiftX.toFixed(2)}px ${gridShiftY.toFixed(2)}px`,
            maskImage: "radial-gradient(ellipse at center, black 35%, transparent 90%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 35%, transparent 90%)",
          }}
        />
      )}

      {/* Subtle top framing progress accent line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(90deg, transparent, ${accentColor}44, transparent)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: 3,
          width: `${(progress * 100).toFixed(2)}%`,
          background: `linear-gradient(90deg, ${accentColor}, ${accentColor}CC)`,
        }}
      />
    </AbsoluteFill>
  );
};

export interface TransitionProps {
  kind: TransitionKind;
  children: React.ReactNode;
}

export const Transition: React.FC<TransitionProps> = ({ kind, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (kind === "cut") {
    return <AbsoluteFill>{children}</AbsoluteFill>;
  }

  const prog = spring({
    frame,
    fps,
    config: SPRING_PRESETS.smooth,
    durationInFrames: Math.min(18, Math.round(fps * 0.55)),
  });

  let opacity = 1;
  let transform = "none";

  if (kind === "crossfade") {
    opacity = interpolate(prog, [0, 1], [0.15, 1]);
  } else if (kind === "slide") {
    const x = interpolate(prog, [0, 1], [-60, 0]);
    opacity = interpolate(prog, [0, 1], [0.25, 1]);
    transform = `translateX(${x}px)`;
  } else if (kind === "zoom") {
    const s = interpolate(prog, [0, 1], [1.06, 1]);
    opacity = interpolate(prog, [0, 1], [0.2, 1]);
    transform = `scale(${s})`;
  } else if (kind === "wipe") {
    const insetRight = interpolate(prog, [0, 1], [18, 0]);
    return (
      <AbsoluteFill style={{ clipPath: `inset(0 ${insetRight}% 0 0)` }}>
        {children}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ opacity, transform }}>
      {children}
    </AbsoluteFill>
  );
};
