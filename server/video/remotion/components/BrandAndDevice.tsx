import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { PalettePresetKind } from "../../../../src/types/videoPipeline.js";
import {
  PALETTE_TOKENS,
  PERSIAN_RTL_BASE_STYLE,
  SPRING_PRESETS,
  getLayoutMetrics,
} from "../tokens.js";

export interface LogoRevealProps {
  brandName: string;
  tagline?: string;
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const LogoReveal: React.FC<LogoRevealProps> = ({
  brandName,
  tagline,
  preset = "studio_amber",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;

  const prog = spring({ frame, fps, config: SPRING_PRESETS.snappy });

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: Math.round(16 * metrics.scale),
        opacity: prog,
        transform: `scale(${interpolate(prog, [0, 1], [0.88, 1])})`,
      }}
    >
      <div
        style={{
          width: Math.round(112 * metrics.scale),
          height: Math.round(112 * metrics.scale),
          borderRadius: Math.round(28 * metrics.scale),
          background: `linear-gradient(135deg, ${accent}, ${tokens.bgSecondary})`,
          border: `2px solid ${accent}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round(44 * metrics.scale),
          fontWeight: 800,
          color: "#0B0D11",
          boxShadow: `0 18px 50px ${accent}44`,
        }}
      >
        {brandName.trim().slice(0, 2)}
      </div>
      <div style={{ fontSize: metrics.h1Size, fontWeight: 800, color: tokens.textPrimary }}>
        {brandName}
      </div>
      {tagline && (
        <div style={{ fontSize: metrics.bodySize, color: tokens.textMuted }}>{tagline}</div>
      )}
    </div>
  );
};

export interface DeviceMockupProps {
  title: string;
  lines: string[];
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const DeviceMockup: React.FC<DeviceMockupProps> = ({
  title,
  lines,
  preset = "slate_sky",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.slate_sky;
  const accent = accentColor || tokens.accent;

  const prog = spring({ frame: Math.max(0, frame - 5), fps, config: SPRING_PRESETS.smooth });

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        width: metrics.isPortrait ? "88%" : "72%",
        marginInline: "auto",
        backgroundColor: "#090B10",
        border: `2px solid ${accent}66`,
        borderRadius: Math.round(30 * metrics.scale),
        padding: Math.round(24 * metrics.scale),
        boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        opacity: prog,
        transform: `translateY(${interpolate(prog, [0, 1], [28, 0])}px)`,
        display: "flex",
        flexDirection: "column",
        gap: Math.round(16 * metrics.scale),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${tokens.surfaceBorder}`,
          paddingBottom: Math.round(12 * metrics.scale),
        }}
      >
        <span style={{ fontSize: metrics.bodySize, fontWeight: 700, color: accent }}>{title}</span>
        <div style={{ display: "flex", gap: Math.round(8 * metrics.scale) }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: "#EF4444" }} />
          <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: "#F59E0B" }} />
          <span style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: "#22C55E" }} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: Math.round(12 * metrics.scale) }}>
        {lines.slice(0, 4).map((line, i) => (
          <div
            key={i}
            style={{
              backgroundColor: tokens.surface,
              borderRadius: Math.round(12 * metrics.scale),
              padding: `${Math.round(14 * metrics.scale)}px ${Math.round(18 * metrics.scale)}px`,
              fontSize: metrics.bodySize,
              color: tokens.textPrimary,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

export interface CallToActionProps {
  headline: string;
  actionLabel: string;
  subnote?: string;
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const CallToAction: React.FC<CallToActionProps> = ({
  headline,
  actionLabel,
  subnote,
  preset = "studio_amber",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;

  const prog = spring({ frame: Math.max(0, frame - 4), fps, config: SPRING_PRESETS.snappy });
  const pulse = 1 + Math.sin(frame / 7) * 0.02;

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        width: "100%",
        backgroundColor: tokens.surface,
        border: `2px solid ${accent}`,
        borderRadius: metrics.radius,
        padding: Math.round(36 * metrics.scale),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: Math.round(22 * metrics.scale),
        textAlign: "center",
        opacity: prog,
        transform: `translateY(${interpolate(prog, [0, 1], [24, 0])}px)`,
      }}
    >
      <div style={{ fontSize: metrics.h1Size * 0.85, fontWeight: 800, color: tokens.textPrimary }}>
        {headline}
      </div>

      <div
        style={{
          backgroundColor: accent,
          color: "#0B0D11",
          padding: `${Math.round(18 * metrics.scale)}px ${Math.round(42 * metrics.scale)}px`,
          borderRadius: Math.round(14 * metrics.scale),
          fontSize: metrics.h2Size,
          fontWeight: 800,
          transform: `scale(${pulse})`,
          boxShadow: `0 12px 34px ${accent}55`,
        }}
      >
        {actionLabel}
      </div>

      {subnote && (
        <div style={{ fontSize: metrics.bodySize, color: tokens.textMuted }}>{subnote}</div>
      )}
    </div>
  );
};
