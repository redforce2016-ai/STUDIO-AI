import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { PalettePresetKind } from "../../../../src/types/videoPipeline.js";
import {
  PALETTE_TOKENS,
  PERSIAN_RTL_BASE_STYLE,
  SPRING_PRESETS,
  getLayoutMetrics,
} from "../tokens.js";

export interface CaptionTrackProps {
  text: string;
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const CaptionTrack: React.FC<CaptionTrackProps> = ({
  text,
  preset = "studio_amber",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;

  const clean = text.trim();
  if (!clean) return null;

  const words = clean.split(/\s+/).filter(Boolean);
  const activeIdx = Math.min(
    words.length - 1,
    Math.floor((frame / Math.max(1, durationInFrames)) * words.length)
  );

  // Show a focused sliding window of max 9 words so captions never overflow or clip
  const windowSize = metrics.isPortrait ? 7 : 10;
  const page = Math.floor(activeIdx / windowSize);
  const visibleWords = words.slice(page * windowSize, (page + 1) * windowSize);
  const localActive = activeIdx - page * windowSize;

  const reveal = spring({ frame, fps, config: SPRING_PRESETS.smooth });
  const shotProgressPct = Math.min(100, Math.max(0, (frame / Math.max(1, durationInFrames - 1)) * 100));

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        position: "absolute",
        bottom: Math.round(metrics.safeBottom * 0.42),
        left: metrics.safeSide,
        right: metrics.safeSide,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        opacity: interpolate(reveal, [0, 1], [0, 1]),
      }}
    >
      <div
        style={{
          ...PERSIAN_RTL_BASE_STYLE,
          position: "relative",
          overflow: "hidden",
          backgroundColor: "rgba(11, 13, 17, 0.88)",
          border: `1px solid ${tokens.surfaceBorder}`,
          borderRadius: Math.round(14 * metrics.scale),
          padding: `${Math.round(12 * metrics.scale)}px ${Math.round(22 * metrics.scale)}px ${Math.round(15 * metrics.scale)}px`,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `${Math.round(6 * metrics.scale)}px ${Math.round(10 * metrics.scale)}px`,
          maxWidth: "100%",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        {visibleWords.map((word, idx) => {
          const isCurrent = idx === localActive;
          return (
            <span
              key={`${page}_${idx}`}
              style={{
                ...PERSIAN_RTL_BASE_STYLE,
                fontSize: metrics.captionSize,
                fontWeight: isCurrent ? 800 : 600,
                color: isCurrent ? accent : tokens.textPrimary,
                lineHeight: 1.45,
              }}
            >
              {word}
            </span>
          );
        })}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            height: 2,
            width: `${shotProgressPct.toFixed(2)}%`,
            backgroundColor: accent,
          }}
        />
      </div>
    </div>
  );
};
