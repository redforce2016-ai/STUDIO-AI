import fs from "node:fs";
import type {
  CameraMotionKind,
  ShotSpec,
  VideoAspectFormat,
  VideoQualityMode,
} from "../../../src/types/videoPipeline.js";

export interface GenerativeVideoRequest {
  shotId: string;
  /**
   * REQUIRED: Path to the local keyframe image (PNG/JPG/SVG).
   * Text-to-video without a keyframe image is strictly forbidden.
   */
  keyframePath: string;
  prompt: string;
  cameraMotion?: CameraMotionKind;
  aspectRatio: VideoAspectFormat;
  durationSec: number;
  qualityMode?: VideoQualityMode;
  resolution: "480p" | "720p" | "1080p";
  width?: number;
  height?: number;
  fps?: number;
  seed?: number;
  visualCriticApprovedPreview?: boolean;
  outputPath: string;
  timeoutMs?: number;
}

export interface ClipAttemptTelemetry {
  attempt: number;
  provider: string;
  success: boolean;
  durationMs: number;
  vramUsedMb: number;
  ramUsedMb: number;
  seed?: number;
  error?: string;
}

export interface ClipGenerationResult {
  outputPath: string;
  mimeType: string;
  providerUsed: "comfyui" | "parallax";
  fallbackUsed: boolean;
  fallbackReason: string | null;
  attempts: number;
  totalDurationMs: number;
  vramUsedMb: number;
  ramUsedMb: number;
  depthMapPath?: string | null;
  subClipsCount: number;
  sanitizedMotionPrompt: string;
  attemptLog: ClipAttemptTelemetry[];
}

export interface VideoProvider {
  readonly name: string;
  generateClip(req: GenerativeVideoRequest): Promise<ClipGenerationResult>;
}

/**
 * Quality Rule 1: Only Image-to-Video is allowed; Text-to-Video is strictly forbidden.
 */
export function assertImageToVideoOnly(req: GenerativeVideoRequest): void {
  const keyframe = req.keyframePath?.trim();
  if (!keyframe) {
    throw new Error(
      "قانون کیفیت نقض شد: تولید ویدیو از متن (Text-to-Video) ممنوع است. فایل Keyframe برای Image-to-Video الزامی است."
    );
  }
  if (!fs.existsSync(keyframe)) {
    throw new Error(
      `فایل Keyframe در مسیر مشخص‌شده یافت نشد (${keyframe}). تولید بدون فریم مرجع مجاز نیست.`
    );
  }
}

/**
 * Quality Rule 2: Gentle and short motion prompt (calm camera motion, minimal subject deformation).
 */
export function sanitizeGentleMotionPrompt(
  rawPrompt: string,
  cameraMotion: CameraMotionKind = "push-in"
): string {
  const cameraMap: Record<CameraMotionKind, string> = {
    "push-in": "slow gentle camera push-in",
    pan: "calm subtle horizontal camera pan",
    orbit: "gentle 2.5D orbital parallax camera motion",
    static: "steady locked camera with subtle atmospheric light",
  };
  const motionPhrase = cameraMap[cameraMotion] || cameraMap["push-in"];

  // Strip aggressive/chaotic action words and keep subject concise
  const cleaned = (rawPrompt || "")
    .replace(/\b(explosion|fast|rapid|chaotic|morph|transform|spin|whip|shake|run|jump)\b/gi, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean).slice(0, 14).join(" ");
  const base = words ? `${motionPhrase}, ${words}` : motionPhrase;
  return `${base}, minimal subject change, preserved geometry, smooth cinematic motion`;
}

/**
 * Quality Rule 3: Each clip must be 3 to 5 seconds.
 * Longer shots are automatically split into multiple 3–5s sub-clips.
 */
export function splitIntoShortClipDurations(totalDurationSec: number): number[] {
  const safeTotal = Math.max(3, Math.min(60, Math.round(totalDurationSec || 4)));
  if (safeTotal <= 5) {
    return [safeTotal];
  }
  const clips: number[] = [];
  let remaining = safeTotal;
  while (remaining > 0) {
    if (remaining <= 5) {
      clips.push(Math.max(3, remaining));
      break;
    }
    if (remaining === 6 || remaining === 7) {
      const first = 3;
      clips.push(first);
      remaining -= first;
    } else {
      clips.push(4);
      remaining -= 4;
    }
  }
  return clips;
}

/**
 * Quality Rule 4: Preview at low resolution (480p), final 1080p render ONLY after Visual Critic approval.
 */
export function resolveAllowedClipDimensions(req: GenerativeVideoRequest): {
  width: number;
  height: number;
  effectiveResolution: "480p" | "720p" | "1080p";
  downgradedToPreview: boolean;
} {
  const wantsHighRes = req.resolution === "1080p" || req.qualityMode === "final_1080p";
  const allowedHighRes = wantsHighRes && Boolean(req.visualCriticApprovedPreview);
  const downgradedToPreview = wantsHighRes && !allowedHighRes;

  const effectiveResolution: "480p" | "720p" | "1080p" = allowedHighRes
    ? "1080p"
    : req.resolution === "720p" && req.visualCriticApprovedPreview
      ? "720p"
      : "480p";

  if (req.aspectRatio === "16:9") {
    if (effectiveResolution === "1080p") {
      return { width: 1920, height: 1080, effectiveResolution, downgradedToPreview };
    }
    if (effectiveResolution === "720p") {
      return { width: 1280, height: 720, effectiveResolution, downgradedToPreview };
    }
    return { width: 854, height: 480, effectiveResolution: "480p", downgradedToPreview };
  }

  // Default 9:16
  if (effectiveResolution === "1080p") {
    return { width: 1080, height: 1920, effectiveResolution, downgradedToPreview };
  }
  if (effectiveResolution === "720p") {
    return { width: 720, height: 1280, effectiveResolution, downgradedToPreview };
  }
  return { width: 480, height: 854, effectiveResolution: "480p", downgradedToPreview };
}

export function buildIndustrialPipeKeyframeSvg(spec?: Partial<ShotSpec>): string {
  const headline = spec?.visual?.headline || "لوله مانیسمان رده ۸۰ — بدون درز جوش";
  const sub = spec?.intent || "مقاومت هیدرواستاتیک ۳۸۰ بار در خطوط انتقال نفت و بخار پرفشار";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 854" width="480" height="854">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B0D11" />
      <stop offset="50%" stop-color="#141923" />
      <stop offset="100%" stop-color="#090B10" />
    </linearGradient>
    <linearGradient id="steelBody" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#64748B" />
      <stop offset="35%" stop-color="#CBD5E1" />
      <stop offset="65%" stop-color="#475569" />
      <stop offset="100%" stop-color="#1E293B" />
    </linearGradient>
    <radialGradient id="amberGlow" cx="50%" cy="46%" r="48%">
      <stop offset="0%" stop-color="#F59E0B" stop-opacity="0.38" />
      <stop offset="70%" stop-color="#F59E0B" stop-opacity="0.06" />
      <stop offset="100%" stop-color="#0B0D11" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="480" height="854" fill="url(#bgGrad)" />
  <rect width="480" height="854" fill="url(#amberGlow)" />
  <!-- Background industrial grid -->
  <g stroke="#334155" stroke-opacity="0.28" stroke-width="1">
    <line x1="80" y1="0" x2="80" y2="854" />
    <line x1="160" y1="0" x2="160" y2="854" />
    <line x1="240" y1="0" x2="240" y2="854" />
    <line x1="320" y1="0" x2="320" y2="854" />
    <line x1="400" y1="0" x2="400" y2="854" />
    <line x1="0" y1="180" x2="480" y2="180" />
    <line x1="0" y1="360" x2="480" y2="360" />
    <line x1="0" y1="540" x2="480" y2="540" />
    <line x1="0" y1="720" x2="480" y2="720" />
  </g>
  <!-- Midground industrial pipe cylinder -->
  <g transform="translate(0, 15)">
    <rect x="75" y="310" width="230" height="150" rx="18" fill="url(#steelBody)" stroke="#94A3B8" stroke-width="2" />
    <line x1="95" y1="342" x2="285" y2="342" stroke="#F8FAFC" stroke-opacity="0.45" stroke-width="4" />
    <line x1="95" y1="435" x2="285" y2="435" stroke="#0F172A" stroke-opacity="0.65" stroke-width="5" />
    <!-- Foreground seamless pipe cross-section ring (Sch 80 thick wall) -->
    <circle cx="315" cy="385" r="88" fill="#334155" stroke="#F59E0B" stroke-width="4" />
    <circle cx="315" cy="385" r="74" fill="#94A3B8" stroke="#E2E8F0" stroke-width="2" />
    <circle cx="315" cy="385" r="46" fill="#0B0D11" stroke="#F59E0B" stroke-width="3" />
    <!-- Pressure callout badge -->
    <rect x="65" y="135" width="350" height="82" rx="14" fill="#14171F" stroke="#F59E0B" stroke-width="2.5" />
    <circle cx="110" cy="176" r="18" fill="#F59E0B" />
    <rect x="145" y="156" width="240" height="16" rx="6" fill="#F8FAFC" />
    <rect x="185" y="182" width="200" height="12" rx="4" fill="#94A3B8" />
    <!-- Bottom technical telemetry card -->
    <rect x="65" y="545" width="350" height="135" rx="16" fill="#14171F" stroke="#334155" stroke-width="2" />
    <rect x="92" y="575" width="135" height="75" rx="10" fill="#1B1F2A" stroke="#F59E0B" stroke-width="2" />
    <rect x="252" y="575" width="135" height="75" rx="10" fill="#1B1F2A" stroke="#38BDF8" stroke-width="2" />
    <circle cx="160" cy="612" r="20" fill="#F59E0B" fill-opacity="0.3" stroke="#F59E0B" stroke-width="2" />
    <path d="M285 628 L310 595 L335 615 L360 588" stroke="#38BDF8" stroke-width="4" fill="none" stroke-linecap="round" />
  </g>
  <desc>${headline} - ${sub}</desc>
</svg>`;
}
