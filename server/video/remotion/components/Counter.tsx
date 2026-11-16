import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { PalettePresetKind } from "../../../../src/types/videoPipeline.js";
import {
  PALETTE_TOKENS,
  PERSIAN_RTL_BASE_STYLE,
  SPRING_PRESETS,
  getLayoutMetrics,
} from "../tokens.js";

export interface CounterProps {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const Counter: React.FC<CounterProps> = ({
  value,
  label,
  prefix = "",
  suffix = "",
  preset = "studio_amber",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;

  const progress = spring({
    frame: Math.max(0, frame - 4),
    fps,
    config: SPRING_PRESETS.gentle,
  });

  const currentVal = Math.round(interpolate(progress, [0, 1], [0, value]));

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        backgroundColor: tokens.surface,
        border: `1.5px solid ${accent}55`,
        borderRadius: metrics.radius,
        padding: `${Math.round(26 * metrics.scale)}px ${Math.round(36 * metrics.scale)}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: Math.round(10 * metrics.scale),
        opacity: interpolate(progress, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
      }}
    >
      <div
        style={{
          ...PERSIAN_RTL_BASE_STYLE,
          fontSize: metrics.kpiSize,
          fontWeight: 800,
          lineHeight: 1.05,
          color: accent,
          direction: "ltr",
        }}
      >
        {prefix}
        {currentVal.toLocaleString("fa-IR")}
        {suffix}
      </div>
      <div
        style={{
          ...PERSIAN_RTL_BASE_STYLE,
          fontSize: metrics.h2Size,
          fontWeight: 600,
          color: tokens.textPrimary,
          textAlign: "center",
        }}
      >
        {label}
      </div>
    </div>
  );
};
