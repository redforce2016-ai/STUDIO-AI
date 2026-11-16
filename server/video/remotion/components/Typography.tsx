import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { PalettePresetKind } from "../../../../src/types/videoPipeline.js";
import {
  PALETTE_TOKENS,
  PERSIAN_RTL_BASE_STYLE,
  SPRING_PRESETS,
  getLayoutMetrics,
} from "../tokens.js";

export interface HeadlineProps {
  text: string;
  badge?: string;
  align?: "right" | "center";
  preset?: PalettePresetKind;
  accentColor?: string;
  delayFrames?: number;
}

export const Headline: React.FC<HeadlineProps> = ({
  text,
  badge,
  align = "center",
  preset = "studio_amber",
  accentColor,
  delayFrames = 2,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;

  const progress = spring({
    frame: Math.max(0, frame - delayFrames),
    fps,
    config: SPRING_PRESETS.snappy,
  });

  const translateY = interpolate(progress, [0, 1], [28, 0]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        textAlign: align,
        opacity,
        transform: `translateY(${translateY}px)`,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: Math.round(14 * metrics.scale),
        width: "100%",
      }}
    >
      {badge && (
        <div
          style={{
            ...PERSIAN_RTL_BASE_STYLE,
            display: "inline-flex",
            alignItems: "center",
            padding: `${Math.round(8 * metrics.scale)}px ${Math.round(18 * metrics.scale)}px`,
            borderRadius: Math.round(10 * metrics.scale),
            backgroundColor: `${accent}22`,
            border: `1.5px solid ${accent}80`,
            color: accent,
            fontSize: metrics.labelSize,
            fontWeight: 700,
          }}
        >
          {badge}
        </div>
      )}
      <h1
        style={{
          ...PERSIAN_RTL_BASE_STYLE,
          margin: 0,
          fontSize: metrics.h1Size,
          fontWeight: 800,
          lineHeight: 1.32,
          color: tokens.textPrimary,
          textShadow: "0 4px 24px rgba(0,0,0,0.45)",
          maxWidth: "96%",
          wordBreak: "break-word",
        }}
      >
        {text}
      </h1>
    </div>
  );
};

export interface SubtitleProps {
  text: string;
  align?: "right" | "center";
  preset?: PalettePresetKind;
  delayFrames?: number;
}

export const Subtitle: React.FC<SubtitleProps> = ({
  text,
  align = "center",
  preset = "studio_amber",
  delayFrames = 9,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;

  const progress = spring({
    frame: Math.max(0, frame - delayFrames),
    fps,
    config: SPRING_PRESETS.smooth,
  });

  const translateY = interpolate(progress, [0, 1], [18, 0]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);

  return (
    <p
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        margin: 0,
        textAlign: align,
        opacity,
        transform: `translateY(${translateY}px)`,
        fontSize: metrics.h2Size,
        fontWeight: 500,
        lineHeight: 1.5,
        color: tokens.textMuted,
        maxWidth: "92%",
        wordBreak: "break-word",
      }}
    >
      {text}
    </p>
  );
};
