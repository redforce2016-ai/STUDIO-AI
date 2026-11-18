import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  VideoAspectFormat,
  VideoPreflightStatus,
  VideoQualityMode,
} from "../../src/types/videoPipeline.js";

export interface VideoPipelineConfig {
  defaultAspectRatio: VideoAspectFormat;
  defaultQualityMode: VideoQualityMode;
  fps: number;
  maxShotRetries: number;
  shotRenderTimeoutMs: number;
  maxParallelShots: number;
  enableGenerativeApi: boolean;
  maxGenerativeShotsPerRun: number;
  enableBlender: boolean;
  targetLufs: number;
  burnSubtitles: boolean;
  includeBackgroundMusic: boolean;
  durationToleranceSec: number;
  visionCriticModel: string;
  plannerModel: string;
}

export const DEFAULT_VIDEO_CONFIG: VideoPipelineConfig = {
  defaultAspectRatio: "9:16",
  defaultQualityMode: "preview_480p",
  fps: 30,
  maxShotRetries: 3,
  shotRenderTimeoutMs: 120_000,
  maxParallelShots: 3,
  enableGenerativeApi: false,
  maxGenerativeShotsPerRun: 1,
  enableBlender: true,
  targetLufs: -14,
  burnSubtitles: false,
  includeBackgroundMusic: false,
  durationToleranceSec: 0.15,
  visionCriticModel: "gemini-4-hydrogen",
  plannerModel: "gemini-4-hydrogen",
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const CONFIG_PATH = path.join(DATA_DIR, "video_pipeline.config.json");

export function getVideoConfig(): VideoPipelineConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Partial<VideoPipelineConfig>;
      return { ...DEFAULT_VIDEO_CONFIG, ...raw };
    }
  } catch {
    // ignore malformed optional config and use defaults
  }
  return { ...DEFAULT_VIDEO_CONFIG };
}

export function getRunOutputDir(runId: string): string {
  const dir = path.join(OUTPUT_DIR, "runs", path.basename(runId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getRenderCacheDir(): string {
  const dir = path.join(OUTPUT_DIR, "cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveDimensions(
  aspectRatio: VideoAspectFormat,
  qualityMode: VideoQualityMode
): [number, number] {
  if (aspectRatio === "16:9") {
    return qualityMode === "final_1080p" ? [1920, 1080] : [854, 480];
  }
  return qualityMode === "final_1080p" ? [1080, 1920] : [480, 854];
}

function commandExists(cmd: string): string | null {
  try {
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function findRemotionBrowserExecutable(): string | null {
  const remotionKnownBin = path.resolve(
    process.cwd(),
    "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"
  );
  if (fs.existsSync(remotionKnownBin)) {
    return remotionKnownBin;
  }
  const systemBin = commandExists("which chromium || which google-chrome || which chromium-browser");
  return systemBin ? systemBin.split("\n")[0]?.trim() || null : null;
}

export function runPreflightCheck(): VideoPreflightStatus {
  const ffmpegVerRaw = commandExists("ffmpeg -version");
  const ffmpegAvailable = Boolean(ffmpegVerRaw);
  const ffmpegVersion = ffmpegVerRaw ? ffmpegVerRaw.split("\n")[0]?.slice(0, 60) || "installed" : null;
  const ffprobeAvailable = Boolean(commandExists("which ffprobe"));
  const blenderAvailable = Boolean(commandExists("which blender"));

  const remotionPkg = fs.existsSync(path.resolve(process.cwd(), "node_modules/remotion/package.json"));
  const remotionRendererPkg = fs.existsSync(
    path.resolve(process.cwd(), "node_modules/@remotion/renderer/package.json")
  );
  const remotionAvailable = remotionPkg && remotionRendererPkg;

  const chromiumAvailable = Boolean(findRemotionBrowserExecutable());

  const fontFile = path.resolve(
    process.cwd(),
    "node_modules/@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff2"
  );
  const localFontsAvailable = fs.existsSync(fontFile);

  const geminiKeyConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());

  const missingCritical: string[] = [];
  if (!ffmpegAvailable) missingCritical.push("ffmpeg نصب نیست");
  if (!ffprobeAvailable) missingCritical.push("ffprobe نصب نیست");
  if (!remotionAvailable) missingCritical.push("پکیج‌های Remotion v4 نصب نیست");
  if (!localFontsAvailable) missingCritical.push("فونت محلی Vazirmatn یافت نشد");

  const warnings: string[] = [];
  if (!blenderAvailable) {
    warnings.push("Blender روی سرور نصب نیست؛ شات‌های سه‌بعدی به‌صورت خودکار به Remotion هدایت می‌شوند.");
  }
  if (!chromiumAvailable) {
    warnings.push("مرورگر Headless Chromium در اولین رندر توسط Remotion آماده می‌شود.");
  }
  if (!geminiKeyConfigured) {
    warnings.push("کلید GEMINI_API_KEY تنظیم نشده است؛ ارزیابی Vision QA نیازمند کلید معتبر است.");
  }

  return {
    ready: missingCritical.length === 0,
    nodeVersion: process.version,
    ffmpegAvailable,
    ffmpegVersion,
    ffprobeAvailable,
    remotionAvailable,
    chromiumAvailable,
    blenderAvailable,
    localFontsAvailable,
    geminiKeyConfigured,
    missingCritical,
    warnings,
  };
}
