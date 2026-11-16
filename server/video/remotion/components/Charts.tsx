import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ChartDatum, PalettePresetKind } from "../../../../src/types/videoPipeline.js";
import {
  PALETTE_TOKENS,
  PERSIAN_RTL_BASE_STYLE,
  SPRING_PRESETS,
  getLayoutMetrics,
} from "../tokens.js";

export interface BarChartProps {
  title?: string;
  data: ChartDatum[];
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const BarChart: React.FC<BarChartProps> = ({
  title,
  data,
  preset = "studio_amber",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  const accent = accentColor || tokens.accent;

  const safeData = Array.isArray(data) && data.length > 0 ? data.slice(0, 6) : [];
  const maxVal = Math.max(1, ...safeData.map((d) => Math.abs(Number(d.value) || 0)));

  const cardReveal = spring({
    frame,
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
        borderRadius: metrics.radius,
        padding: Math.round(30 * metrics.scale),
        opacity: interpolate(cardReveal, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(cardReveal, [0, 1], [24, 0])}px)`,
        display: "flex",
        flexDirection: "column",
        gap: Math.round(22 * metrics.scale),
      }}
    >
      {title && (
        <div
          style={{
            ...PERSIAN_RTL_BASE_STYLE,
            fontSize: metrics.h2Size,
            fontWeight: 700,
            color: tokens.textPrimary,
            borderBottom: `1px solid ${tokens.surfaceBorder}`,
            paddingBottom: Math.round(14 * metrics.scale),
          }}
        >
          {title}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: Math.round(18 * metrics.scale),
        }}
      >
        {safeData.map((item, idx) => {
          const barSpring = spring({
            frame: Math.max(0, frame - (8 + idx * 5)),
            fps,
            config: SPRING_PRESETS.snappy,
          });
          const pct = Math.max(6, Math.round((Math.abs(item.value) / maxVal) * 100));
          const animPct = interpolate(barSpring, [0, 1], [0, pct]);
          const isHighlight = item.highlight ?? idx === 0;
          const barColor = isHighlight ? accent : "#64748B";
          const displayNum = Math.round(item.value * barSpring);

          return (
            <div key={idx} style={{ display: "flex", flexDirection: "column", gap: Math.round(8 * metrics.scale) }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: metrics.bodySize,
                  fontWeight: isHighlight ? 700 : 500,
                  color: isHighlight ? tokens.textPrimary : tokens.textMuted,
                }}
              >
                <span>{item.label}</span>
                <span style={{ color: isHighlight ? accent : tokens.textPrimary, fontWeight: 700 }}>
                  {displayNum.toLocaleString("fa-IR")} {item.unit || ""}
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: Math.round(22 * metrics.scale),
                  borderRadius: Math.round(8 * metrics.scale),
                  backgroundColor: "rgba(255,255,255,0.07)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${animPct}%`,
                    height: "100%",
                    borderRadius: Math.round(8 * metrics.scale),
                    background: isHighlight
                      ? `linear-gradient(90deg, ${accent}CC, ${accent})`
                      : barColor,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface LineChartProps {
  title?: string;
  data: ChartDatum[];
  preset?: PalettePresetKind;
  accentColor?: string;
}

export const LineChart: React.FC<LineChartProps> = ({
  title,
  data,
  preset = "slate_sky",
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const metrics = getLayoutMetrics(width, height);
  const tokens = PALETTE_TOKENS[preset] || PALETTE_TOKENS.slate_sky;
  const accent = accentColor || tokens.accent;

  const safeData =
    Array.isArray(data) && data.length >= 2
      ? data.slice(0, 8)
      : [
          { label: "شروع", value: 20 },
          { label: "میانه", value: 55 },
          { label: "هدف", value: 90 },
        ];

  const drawProg = spring({
    frame: Math.max(0, frame - 6),
    fps,
    config: SPRING_PRESETS.gentle,
  });

  const chartW = 760;
  const chartH = 260;
  const padX = 48;
  const padY = 28;
  const maxVal = Math.max(1, ...safeData.map((d) => d.value));
  const minVal = Math.min(0, ...safeData.map((d) => d.value));
  const range = Math.max(1, maxVal - minVal);

  const pts = safeData.map((d, i) => {
    const x = padX + (i / (safeData.length - 1)) * (chartW - padX * 2);
    const y = chartH - padY - ((d.value - minVal) / range) * (chartH - padY * 2);
    return { x, y, ...d };
  });

  const polyPoints = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const totalLen = 1400;
  const dashOffset = interpolate(drawProg, [0, 1], [totalLen, 0]);

  return (
    <div
      style={{
        ...PERSIAN_RTL_BASE_STYLE,
        width: "100%",
        backgroundColor: tokens.surface,
        border: `1.5px solid ${tokens.surfaceBorder}`,
        borderRadius: metrics.radius,
        padding: Math.round(28 * metrics.scale),
        display: "flex",
        flexDirection: "column",
        gap: Math.round(18 * metrics.scale),
      }}
    >
      {title && (
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
      )}

      <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
        {[0.25, 0.5, 0.75].map((ratio, idx) => (
          <line
            key={idx}
            x1={padX}
            y1={padY + ratio * (chartH - padY * 2)}
            x2={chartW - padX}
            y2={padY + ratio * (chartH - padY * 2)}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="6 6"
          />
        ))}

        <polyline
          fill="none"
          stroke={accent}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polyPoints}
          strokeDasharray={totalLen}
          strokeDashoffset={dashOffset}
        />

        {pts.map((p, idx) => {
          const pointProg = spring({
            frame: Math.max(0, frame - (10 + idx * 4)),
            fps,
            config: SPRING_PRESETS.snappy,
          });
          return (
            <g key={idx} opacity={pointProg}>
              <circle cx={p.x} cy={p.y} r={8} fill={accent} stroke={tokens.bgPrimary} strokeWidth={3} />
              <text
                x={p.x}
                y={p.y - 16}
                textAnchor="middle"
                fill={tokens.textPrimary}
                fontSize={18}
                fontWeight={700}
                fontFamily="Vazirmatn, sans-serif"
              >
                {p.value.toLocaleString("fa-IR")}
              </text>
            </g>
          );
        })}
      </svg>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingInline: Math.round(12 * metrics.scale),
          fontSize: metrics.labelSize,
          color: tokens.textMuted,
          direction: "ltr",
        }}
      >
        {pts.map((p, i) => (
          <span key={i} style={{ fontFamily: "Vazirmatn, sans-serif" }}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
};
