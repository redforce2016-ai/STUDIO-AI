import type { PalettePresetKind } from "../../../src/types/videoPipeline.js";

export interface DesignPalette {
  bgPrimary: string;
  bgSecondary: string;
  surface: string;
  surfaceBorder: string;
  accent: string;
  accentSoft: string;
  textPrimary: string;
  textMuted: string;
  success: string;
  danger: string;
}

export const PALETTE_TOKENS: Record<PalettePresetKind, DesignPalette> = {
  studio_amber: {
    bgPrimary: "#0B0D11",
    bgSecondary: "#14171F",
    surface: "#181C26",
    surfaceBorder: "rgba(255,255,255,0.12)",
    accent: "#F59E0B",
    accentSoft: "rgba(245, 158, 11, 0.16)",
    textPrimary: "#F8FAFC",
    textMuted: "#CBD5E1",
    success: "#22C55E",
    danger: "#EF4444",
  },
  slate_sky: {
    bgPrimary: "#0F172A",
    bgSecondary: "#1E293B",
    surface: "#172136",
    surfaceBorder: "rgba(56, 189, 248, 0.22)",
    accent: "#38BDF8",
    accentSoft: "rgba(56, 189, 248, 0.16)",
    textPrimary: "#F8FAFC",
    textMuted: "#CBD5E1",
    success: "#34D399",
    danger: "#FB7185",
  },
  emerald_tech: {
    bgPrimary: "#061311",
    bgSecondary: "#0F2420",
    surface: "#122B26",
    surfaceBorder: "rgba(16, 185, 129, 0.24)",
    accent: "#10B981",
    accentSoft: "rgba(16, 185, 129, 0.16)",
    textPrimary: "#F0FDF4",
    textMuted: "#A7F3D0",
    success: "#34D399",
    danger: "#F87171",
  },
  crimson_alert: {
    bgPrimary: "#120A0E",
    bgSecondary: "#221118",
    surface: "#29141D",
    surfaceBorder: "rgba(244, 63, 94, 0.25)",
    accent: "#F43F5E",
    accentSoft: "rgba(244, 63, 94, 0.16)",
    textPrimary: "#FFF1F2",
    textMuted: "#FECDD3",
    success: "#4ADE80",
    danger: "#FB7185",
  },
};

export const SPRING_PRESETS = {
  snappy: { damping: 16, stiffness: 190, mass: 0.8 },
  smooth: { damping: 20, stiffness: 120, mass: 1 },
  gentle: { damping: 26, stiffness: 85, mass: 1.1 },
} as const;

export function getLayoutMetrics(width: number, height: number) {
  const isPortrait = height > width;
  const scale = isPortrait ? width / 1080 : width / 1920;

  return {
    isPortrait,
    scale,
    safeTop: Math.round(height * (isPortrait ? 0.1 : 0.08)),
    safeBottom: Math.round(height * (isPortrait ? 0.14 : 0.11)),
    safeSide: Math.round(width * (isPortrait ? 0.075 : 0.065)),
    gap: Math.round(28 * scale),
    radius: Math.round(22 * scale),
    h1Size: Math.round((isPortrait ? 62 : 66) * scale),
    h2Size: Math.round((isPortrait ? 34 : 36) * scale),
    bodySize: Math.round((isPortrait ? 28 : 26) * scale),
    captionSize: Math.round((isPortrait ? 32 : 30) * scale),
    labelSize: Math.round((isPortrait ? 24 : 22) * scale),
    kpiSize: Math.round((isPortrait ? 92 : 98) * scale),
  };
}

export const PERSIAN_RTL_BASE_STYLE = {
  fontFamily: '"Vazirmatn", sans-serif',
  direction: "rtl" as const,
  letterSpacing: 0,
  fontFeatureSettings: '"tnum" 1',
  fontVariantNumeric: "tabular-nums" as const,
};
