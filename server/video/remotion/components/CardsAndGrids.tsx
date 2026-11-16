import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  FeatureGridItem,
  PalettePresetKind,
  TimelineStepItem,
} from "../../../../src/types/videoPipeline.js";
import {
  PALETTE_TOKENS,
  PERSIAN_RTL_BASE_STYLE,
  SPRING_PRESETS,
  getLayoutMetrics,
} from "../tokens.js";

export interface CardProps {
  title: string;
  body: string;
  tag?: string;
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const Card: React.FC<CardProps> = ({
  title,
  body,
  tag,
  preset = "studio_amber",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;

  const reveal = spring({
    frame: Math.max(0, frame - 6),
    fps,
    config: SPRING_PRESETS.smooth,
  });

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        width: "100%",
        backgroundColor: tokens.surface,
        border: `1.5px solid ${tokens.surfaceBorder}`,
        borderRight: `6px solid ${accent}`,
        borderRadius: metrics.radius,
        padding: Math.round(28 * metrics.scale),
        opacity: interpolate(reveal, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(reveal, [0, 1], [20, 0])}px)`,
        display: "flex",
        flexDirection: "column",
        gap: Math.round(12 * metrics.scale),
      }}
    >
      {tag && (
        <span
          style={{
            ...PERSIAN_RTL_BASE_STYLE,
            fontSize: metrics.labelSize,
            fontWeight: 700,
            color: accent,
          }}
        >
          {tag}
        </span>
      )}
      <div
        style={{
          ...PERSIAN_RTL_BASE_STYLE,
          fontSize: metrics.h2Size,
          fontWeight: 700,
          color: tokens.textPrimary,
        }}
      >
        {title}
      </div>
      <div
        style={{
          ...PERSIAN_RTL_BASE_STYLE,
          fontSize: metrics.bodySize,
          lineHeight: 1.6,
          color: tokens.textMuted,
        }}
      >
        {body}
      </div>
    </div>
  );
};

export interface FeatureGridProps {
  items: FeatureGridItem[];
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const FeatureGrid: React.FC<FeatureGridProps> = ({
  items,
  preset = "studio_amber",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;
  const safeItems = Array.isArray(items) ? items.slice(0, 4) : [];
  const columns = metrics.isPortrait ? 1 : 2;
  const staggerFrames = Math.min(20, Math.max(8, Math.floor((durationInFrames * 0.42) / Math.max(1, safeItems.length))));
  const activeIdx = Math.min(
    Math.max(0, safeItems.length - 1),
    Math.floor((frame / Math.max(1, durationInFrames)) * Math.max(1, safeItems.length))
  );

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        width: "100%",
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: Math.round(18 * metrics.scale),
      }}
    >
      {safeItems.map((item, idx) => {
        const itemSpring = spring({
          frame: Math.max(0, frame - (6 + idx * staggerFrames)),
          fps,
          config: SPRING_PRESETS.snappy,
        });
        const isActive = idx === activeIdx;
        return (
          <div
            key={idx}
            style={{
              ...PERSIAN_RTL_BASE_STYLE,
              backgroundColor: tokens.surface,
              border: `1.5px solid ${isActive ? accent : tokens.surfaceBorder}`,
              borderRight: `5px solid ${isActive ? accent : tokens.surfaceBorder}`,
              borderRadius: metrics.radius,
              padding: Math.round(22 * metrics.scale),
              opacity: interpolate(itemSpring, [0, 1], [0, 1]),
              transform: `translateY(${interpolate(itemSpring, [0, 1], [22, 0])}px)`,
              display: "flex",
              flexDirection: "column",
              gap: Math.round(8 * metrics.scale),
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  ...PERSIAN_RTL_BASE_STYLE,
                  fontSize: Math.round(metrics.bodySize * 1.05),
                  fontWeight: 700,
                  color: isActive ? accent : tokens.textPrimary,
                }}
              >
                {item.title}
              </span>
              {item.metric && (
                <span
                  style={{
                    ...PERSIAN_RTL_BASE_STYLE,
                    fontSize: metrics.bodySize,
                    fontWeight: 800,
                    color: accent,
                  }}
                >
                  {item.metric}
                </span>
              )}
            </div>
            <p
              style={{
                ...PERSIAN_RTL_BASE_STYLE,
                margin: 0,
                fontSize: metrics.labelSize,
                lineHeight: 1.55,
                color: tokens.textMuted,
              }}
            >
              {item.description}
            </p>
          </div>
        );
      })}
    </div>
  );
};

export interface TimelineProps {
  steps: TimelineStepItem[];
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const Timeline: React.FC<TimelineProps> = ({
  steps,
  preset = "studio_amber",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;
  const safeSteps = Array.isArray(steps) ? steps.slice(0, 4) : [];
  const staggerFrames = Math.min(20, Math.max(8, Math.floor((durationInFrames * 0.42) / Math.max(1, safeSteps.length))));
  const activeIdx = Math.min(
    Math.max(0, safeSteps.length - 1),
    Math.floor((frame / Math.max(1, durationInFrames)) * Math.max(1, safeSteps.length))
  );

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: Math.round(18 * metrics.scale),
      }}
    >
      {safeSteps.map((step, idx) => {
        const prog = spring({
          frame: Math.max(0, frame - (6 + idx * staggerFrames)),
          fps,
          config: SPRING_PRESETS.snappy,
        });
        const isActive = idx === activeIdx;
        return (
          <div
            key={idx}
            style={{
              ...PERSIAN_RTL_BASE_STYLE,
              display: "flex",
              alignItems: "flex-start",
              gap: Math.round(18 * metrics.scale),
              backgroundColor: tokens.surface,
              border: `1.5px solid ${isActive ? accent : tokens.surfaceBorder}`,
              borderRadius: metrics.radius,
              padding: Math.round(20 * metrics.scale),
              opacity: interpolate(prog, [0, 1], [0, 1]),
              transform: `translateX(${interpolate(prog, [0, 1], [-24, 0])}px)`,
            }}
          >
            <div
              style={{
                minWidth: Math.round(48 * metrics.scale),
                height: Math.round(48 * metrics.scale),
                borderRadius: Math.round(12 * metrics.scale),
                backgroundColor: isActive ? accent : `${accent}24`,
                border: `1.5px solid ${accent}`,
                color: isActive ? "#0B0D11" : accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: metrics.bodySize,
                flexShrink: 0,
              }}
            >
              {step.stepLabel}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: Math.round(4 * metrics.scale) }}>
              <div style={{ fontSize: metrics.bodySize, fontWeight: 700, color: tokens.textPrimary }}>
                {step.title}
              </div>
              <div style={{ fontSize: metrics.labelSize, lineHeight: 1.5, color: tokens.textMuted }}>
                {step.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
