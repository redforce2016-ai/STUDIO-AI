import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ComparisonSide, PalettePresetKind } from "../../../../src/types/videoPipeline.js";
import {
  PALETTE_TOKENS,
  PERSIAN_RTL_BASE_STYLE,
  SPRING_PRESETS,
  getLayoutMetrics,
} from "../tokens.js";

export interface SplitScreenProps {
  primaryTitle: string;
  primaryBody: string;
  secondaryTitle: string;
  secondaryBody: string;
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const SplitScreen: React.FC<SplitScreenProps> = ({
  primaryTitle,
  primaryBody,
  secondaryTitle,
  secondaryBody,
  preset = "slate_sky",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.slate_sky;
  const accent = accentColor || tokens.accent;

  const p1 = spring({ frame: Math.max(0, frame - 4), fps, config: SPRING_PRESETS.snappy });
  const p2 = spring({ frame: Math.max(0, frame - 10), fps, config: SPRING_PRESETS.snappy });

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        width: "100%",
        display: "grid",
        gridTemplateColumns: metrics.isPortrait ? "1fr" : "1fr 1fr",
        gap: Math.round(20 * metrics.scale),
      }}
    >
      <div
        style={{
          ...PERSIAN_RTL_BASE_STYLE,
          backgroundColor: tokens.surface,
          border: `1.5px solid ${accent}88`,
          borderRadius: metrics.radius,
          padding: Math.round(26 * metrics.scale),
          opacity: p1,
          transform: `translateY(${interpolate(p1, [0, 1], [20, 0])}px)`,
          display: "flex",
          flexDirection: "column",
          gap: Math.round(10 * metrics.scale),
        }}
      >
        <div style={{ fontSize: metrics.h2Size, fontWeight: 800, color: accent }}>{primaryTitle}</div>
        <div style={{ fontSize: metrics.bodySize, lineHeight: 1.55, color: tokens.textPrimary }}>
          {primaryBody}
        </div>
      </div>

      <div
        style={{
          ...PERSIAN_RTL_BASE_STYLE,
          backgroundColor: tokens.surface,
          border: `1.5px solid ${tokens.surfaceBorder}`,
          borderRadius: metrics.radius,
          padding: Math.round(26 * metrics.scale),
          opacity: p2,
          transform: `translateY(${interpolate(p2, [0, 1], [20, 0])}px)`,
          display: "flex",
          flexDirection: "column",
          gap: Math.round(10 * metrics.scale),
        }}
      >
        <div style={{ fontSize: metrics.h2Size, fontWeight: 800, color: tokens.textPrimary }}>
          {secondaryTitle}
        </div>
        <div style={{ fontSize: metrics.bodySize, lineHeight: 1.55, color: tokens.textMuted }}>
          {secondaryBody}
        </div>
      </div>
    </div>
  );
};

export interface ComparisonProps {
  left: ComparisonSide;
  right: ComparisonSide;
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const Comparison: React.FC<ComparisonProps> = ({
  left,
  right,
  preset = "studio_amber",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;

  const sides = [left, right];

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        width: "100%",
        display: "grid",
        gridTemplateColumns: metrics.isPortrait ? "1fr" : "1fr 1fr",
        gap: Math.round(20 * metrics.scale),
      }}
    >
      {sides.map((side, idx) => {
        const sProg = spring({
          frame: Math.max(0, frame - (5 + idx * 7)),
          fps,
          config: SPRING_PRESETS.snappy,
        });
        const isWin = Boolean(side.isWinner);
        const borderCol = isWin ? tokens.success : tokens.danger;

        return (
          <div
            key={idx}
            style={{
              ...PERSIAN_RTL_BASE_STYLE,
              backgroundColor: tokens.surface,
              border: `2px solid ${isWin ? tokens.success : tokens.surfaceBorder}`,
              borderRadius: metrics.radius,
              padding: Math.round(24 * metrics.scale),
              opacity: sProg,
              transform: `scale(${interpolate(sProg, [0, 1], [0.95, 1])})`,
              display: "flex",
              flexDirection: "column",
              gap: Math.round(14 * metrics.scale),
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: metrics.h2Size, fontWeight: 800, color: tokens.textPrimary }}>
                {side.title}
              </div>
              {side.metricLabel && (
                <span
                  style={{
                    fontSize: metrics.labelSize,
                    fontWeight: 700,
                    color: isWin ? tokens.success : accent,
                    border: `1px solid ${borderCol}`,
                    borderRadius: Math.round(8 * metrics.scale),
                    padding: `${Math.round(4 * metrics.scale)}px ${Math.round(12 * metrics.scale)}px`,
                  }}
                >
                  {side.metricLabel}
                </span>
              )}
            </div>

            {side.subtitle && (
              <div style={{ fontSize: metrics.labelSize, color: tokens.textMuted }}>{side.subtitle}</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: Math.round(10 * metrics.scale) }}>
              {side.points.slice(0, 4).map((pt, pIdx) => (
                <div
                  key={pIdx}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: Math.round(10 * metrics.scale),
                    fontSize: metrics.bodySize,
                    lineHeight: 1.5,
                    color: tokens.textPrimary,
                  }}
                >
                  <span style={{ color: isWin ? tokens.success : tokens.danger, fontWeight: 800 }}>
                    {isWin ? "✓" : "✕"}
                  </span>
                  <span>{pt}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
