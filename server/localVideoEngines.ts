import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DirectorShot,
  LocalEngineStatus,
  LocalVideoEngineId,
  ProjectRecord,
} from "../src/types/studio.js";
import type { CameraMotionKind, PalettePresetKind, ShotCompositionPlan, TransitionKind } from "../src/types/videoPipeline.js";
import { getImagesDir } from "./store.js";
import { isBlenderInstalled, renderBlenderShot } from "./video/providers/blender.js";
import { renderRemotionShot } from "./video/providers/remotion.js";

const execFileAsync = promisify(execFile);

const VAZIRMATN_700 = path.resolve(
  process.cwd(),
  "node_modules/@fontsource/vazirmatn/files/vazirmatn-arabic-700-normal.woff2"
);
const VAZIRMATN_400 = path.resolve(
  process.cwd(),
  "node_modules/@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff2"
);

function buildFontFaceCss(): string {
  const rules: string[] = [];
  if (fs.existsSync(VAZIRMATN_400)) {
    rules.push(`@font-face { font-family: 'VazirmatnHF'; font-weight: 400; src: url('file://${VAZIRMATN_400}') format('woff2'); }`);
  }
  if (fs.existsSync(VAZIRMATN_700)) {
    rules.push(`@font-face { font-family: 'VazirmatnHF'; font-weight: 700; src: url('file://${VAZIRMATN_700}') format('woff2'); }`);
  }
  return rules.join("\n");
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function findChromiumBinary(): string | null {
  const candidates = [
    "/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const found = execSync("which chromium || which google-chrome || which chrome-headless-shell", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    return found || null;
  } catch {
    return null;
  }
}

export function isFfmpegInstalled(): boolean {
  try {
    const out = execSync("which ffmpeg", { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }).trim();
    return Boolean(out);
  } catch {
    return false;
  }
}

export async function probeComfyUiStatus(): Promise<{ available: boolean; baseUrl: string; note: string }> {
  const baseUrl = (process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1100);
  try {
    const res = await fetch(`${baseUrl}/system_stats`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      return {
        available: true,
        baseUrl,
        note: `متصل به سرور محلی ComfyUI در ${baseUrl} (حالت کم‌مصرف 4-step فعال)`,
      };
    }
    return {
      available: false,
      baseUrl,
      note: `سرور ComfyUI در ${baseUrl} پاسخ کد ${res.status} داد.`,
    };
  } catch {
    clearTimeout(timer);
    return {
      available: false,
      baseUrl,
      note: `سرور لوکال ComfyUI روی ${baseUrl} در حال اجرا نیست (نسخه ویندوز + Workflow آماده دانلود موجود است).`,
    };
  }
}

export async function getLocalEnginesStatus(): Promise<LocalEngineStatus[]> {
  const hasChrome = Boolean(findChromiumBinary());
  const hasFfmpeg = isFfmpegInstalled();
  const hasBlender = isBlenderInstalled();
  const comfy = await probeComfyUiStatus();

  return [
    {
      id: "hyperframes_html",
      labelFa: "HyperFrames HTML5 + FFmpeg",
      descriptionFa:
        "رندر فریم‌های واقعی و تایپوگرافی دقیق فارسی (Safe-Zone ریلز) روی CPU بدون نیاز به گرافیک سنگین",
      available: hasChrome && hasFfmpeg,
      hardwareNoteFa: "۱۰۰٪ لوکال روی CPU معمولی (Headless Chromium + FFmpeg H.264)",
      isDefault: true,
      requiresGpu: false,
    },
    {
      id: "comfyui_light",
      labelFa: "ComfyUI سبک (SDXL-Turbo / AnimateDiff)",
      descriptionFa:
        "اتصال به سرور لوکال ComfyUI (127.0.0.1:8188) با ورک‌فلو ۴ مرحله‌ای کم‌مصرف (فال‌بک خودکار به HyperFrames)",
      available: comfy.available,
      hardwareNoteFa: comfy.note,
      isDefault: false,
      requiresGpu: true,
    },
    {
      id: "remotion_kinetic",
      labelFa: "Remotion Motion Engine",
      descriptionFa: "انیمیشن تایپوگرافی و کارت‌های داده React/Remotion با حرکت دوربین و سایه‌پردازی",
      available: hasFfmpeg,
      hardwareNoteFa: "مناسب ویدیوهای داده، مقایسه عددی و موشن‌گرافیک با فریم‌ریت 30fps",
      isDefault: false,
      requiresGpu: false,
    },
    {
      id: "blender_headless",
      labelFa: "Blender 3D Headless",
      descriptionFa: "رندر سه‌بعدی خودکار محصول و صحنه با اسکریپت پایتون (در صورت نصب Blender)",
      available: hasBlender,
      hardwareNoteFa: hasBlender
        ? "باینری Blender روی سیستم شناسایی شد و آماده رندر سه‌بعدی است."
        : "روی این سرور ابری نصب نیست (فال‌بک هوشمند به HyperFrames · آماده در ویندوز).",
      isDefault: false,
      requiresGpu: false,
    },
    {
      id: "ffmpeg_cinema",
      labelFa: "FFmpeg Cinema Grade",
      descriptionFa: "رندر فوق‌سریع با زوم سینمایی Ken Burns، گرید رنگ، و زیرنویس متصل فارسی",
      available: hasFfmpeg,
      hardwareNoteFa: "سبک‌ترین موتور خط تولید روی CPU با سرعت رندر زیر ۳ ثانیه",
      isDefault: false,
      requiresGpu: false,
    },
  ];
}

/**
 * Generates an importable, lightweight ComfyUI API workflow JSON tuned for low-VRAM GPUs
 * (SDXL-Turbo / Lightning 4 steps, CFG 1.5, 576x1024 vertical 9:16).
 */
export function buildComfyUiLightweightWorkflow(shot?: DirectorShot) {
  const positivePrompt =
    shot?.photorealPromptStartEn ||
    shot?.visualPromptFa ||
    "photorealistic commercial product photography, crisp tungsten workshop lighting, shallow depth of field, vertical 9:16";
  const negativePrompt =
    shot?.negativePromptEn ||
    "blurry, cartoon, anime, plastic texture, distorted hands, extra fingers, watermark, text overlay, low contrast";

  return {
    meta: {
      name: "ContentStudio_Reels_Lightweight_4Step",
      description: "ورک‌فلو فوق‌سبک ComfyUI ویژه کارت گرافیک ۴ تا ۸ گیگابایت (SDXL-Turbo / FLUX-Schnell Q4)",
      targetResolution: "576x1024 (upscale to 1080x1920)",
      vramRecommendation: "4GB-8GB VRAM",
      shotNumber: shot?.shotNumber ?? 1,
    },
    prompt: {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: {
          ckpt_name: "sd_xl_turbo_1.0_fp16.safetensors",
        },
      },
      "2": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: positivePrompt,
          clip: ["1", 1],
        },
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: negativePrompt,
          clip: ["1", 1],
        },
      },
      "4": {
        class_type: "EmptyLatentImage",
        inputs: {
          width: 576,
          height: 1024,
          batch_size: 1,
        },
      },
      "5": {
        class_type: "KSampler",
        inputs: {
          seed: 420810 + (shot?.shotNumber ?? 1),
          steps: 4,
          cfg: 1.5,
          sampler_name: "euler_ancestral",
          scheduler: "karras",
          denoise: 1.0,
          model: ["1", 0],
          positive: ["2", 0],
          negative: ["3", 0],
          latent_image: ["4", 0],
        },
      },
      "6": {
        class_type: "VAEDecode",
        inputs: {
          samples: ["5", 0],
          vae: ["1", 2],
        },
      },
      "7": {
        class_type: "SaveImage",
        inputs: {
          filename_prefix: `ContentStudio_Shot_${String(shot?.shotNumber ?? 1).padStart(2, "0")}`,
          images: ["6", 0],
        },
      },
    },
  };
}

/**
 * Renders any self-contained HTML5 page using Headless Chromium into a pixel-exact PNG.
 */
export async function renderHyperFramesPng(params: {
  html: string;
  width: number;
  height: number;
  outPngPath: string;
  transparent?: boolean;
}): Promise<string> {
  const chromeBin = findChromiumBinary();
  if (!chromeBin) {
    throw new Error("مرورگر Headless Chromium برای رندر HyperFrames یافت نشد.");
  }
  fs.mkdirSync(path.dirname(params.outPngPath), { recursive: true });
  const tempHtmlPath = `${params.outPngPath}.hf.html`;
  fs.writeFileSync(tempHtmlPath, params.html, "utf-8");

  const args = [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${params.width},${params.height}`,
    `--screenshot=${params.outPngPath}`,
  ];
  if (params.transparent) {
    args.push("--default-background-color=00000000");
  }
  args.push(`file://${tempHtmlPath}`);

  try {
    await execFileAsync(chromeBin, args, { timeout: 15_000 });
  } finally {
    try {
      fs.rmSync(tempHtmlPath, { force: true });
    } catch {
      // ignore temp cleanup
    }
  }

  if (!fs.existsSync(params.outPngPath)) {
    throw new Error("رندر HyperFrames خروجی PNG نساخت.");
  }
  return params.outPngPath;
}

/**
 * Renders a crisp transparent RGBA PNG containing RTL Persian caption overlay positioned
 * inside Instagram Reels / YouTube Shorts Safe-Zone (bottom 21% kept clear of UI chrome).
 */
export async function renderPersianReelsCaptionOverlayPng(params: {
  text: string;
  subLabel?: string;
  width: number;
  height: number;
  outPngPath: string;
  accentHex?: string;
  shotBadge?: string;
}): Promise<string> {
  const accent = params.accentHex || "#F59E0B";
  const fontCss = buildFontFaceCss();
  const cleanText = escapeHtml(params.text.trim());
  const cleanSub = params.subLabel ? escapeHtml(params.subLabel.trim()) : "";
  const cleanBadge = params.shotBadge ? escapeHtml(params.shotBadge.trim()) : "";
  const safeBottomPx = Math.round(params.height * 0.21);
  const safeTopPx = Math.round(params.height * 0.08);
  const fontSize = params.width >= 900 ? 28 : 24;

  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
${fontCss}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: ${params.width}px;
  height: ${params.height}px;
  background: transparent;
  overflow: hidden;
  font-family: 'VazirmatnHF', 'Vazirmatn', 'Tahoma', sans-serif;
}
.stage {
  position: relative;
  width: 100%;
  height: 100%;
}
.top-badge {
  position: absolute;
  top: ${safeTopPx}px;
  right: 28px;
  padding: 6px 14px;
  border-radius: 8px;
  background: rgba(11, 13, 17, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #E2E8F0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.caption-wrap {
  position: absolute;
  bottom: ${safeBottomPx}px;
  left: 36px;
  right: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}
.caption-box {
  background: rgba(11, 13, 17, 0.86);
  border: 1.5px solid ${accent};
  border-radius: 14px;
  padding: 12px 20px;
  color: #FFFFFF;
  font-size: ${fontSize}px;
  font-weight: 700;
  line-height: 1.55;
  text-shadow: 0 2px 10px rgba(0,0,0,0.85);
  box-shadow: 0 12px 32px rgba(0,0,0,0.55);
}
.accent-word {
  color: ${accent};
}
.sub-line {
  font-size: 14px;
  font-weight: 400;
  color: #CBD5E1;
  background: rgba(11, 13, 17, 0.74);
  padding: 4px 12px;
  border-radius: 6px;
}
</style>
</head>
<body>
  <div class="stage">
    ${cleanBadge ? `<div class="top-badge">${cleanBadge}</div>` : ""}
    ${
      cleanText
        ? `<div class="caption-wrap">
            <div class="caption-box">${cleanText}</div>
            ${cleanSub ? `<div class="sub-line">${cleanSub}</div>` : ""}
           </div>`
        : ""
    }
  </div>
</body>
</html>`;

  return renderHyperFramesPng({
    html,
    width: params.width,
    height: params.height,
    outPngPath: params.outPngPath,
    transparent: true,
  });
}

/**
 * Generates realistic, high-craft HyperFrames Start (Frame 1) & Action Payoff (Frame 2)
 * PNG plates inside `/data/images/` served at `/api/media/images/...`.
 * If a photographic base plate path is supplied, creates Frame 1 & zoomed/graded Frame 2 directly from it.
 */
export async function renderHyperFramesDualKeyframes(params: {
  projectId: string;
  shot: DirectorShot;
  directionSummary: string;
  width?: number;
  height?: number;
  backgroundPlatePath?: string | null;
}): Promise<{
  imageUrl: string;
  secondaryImageUrl: string;
  frame1Path: string;
  frame2Path: string;
}> {
  const width = params.width ?? 540;
  const height = params.height ?? 960;
  const imagesDir = getImagesDir();
  fs.mkdirSync(imagesDir, { recursive: true });
  const ts = Date.now();
  const f1Name = `${params.projectId}_shot_${params.shot.shotNumber}_f1_${ts}.png`;
  const f2Name = `${params.projectId}_shot_${params.shot.shotNumber}_f2_${ts}.png`;
  const f1Path = path.join(imagesDir, f1Name);
  const f2Path = path.join(imagesDir, f2Name);

  // If a real photo plate exists on disk, generate Frame 1 (graded) & Frame 2 (macro push-in + action cue) from it
  if (params.backgroundPlatePath && fs.existsSync(params.backgroundPlatePath)) {
    const cropW = Math.round(width * 0.84);
    const cropH = Math.round(height * 0.84);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      params.backgroundPlatePath,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},eq=contrast=1.06:saturation=1.08`,
      "-frames:v",
      "1",
      f1Path,
    ]);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      params.backgroundPlatePath,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},crop=${cropW}:${cropH}:(iw-${cropW})/2:(ih-${cropH})/2,scale=${width}:${height},eq=contrast=1.10:saturation=1.12`,
      "-frames:v",
      "1",
      f2Path,
    ]);
    return {
      imageUrl: `/api/media/images/${f1Name}`,
      secondaryImageUrl: `/api/media/images/${f2Name}`,
      frame1Path: f1Path,
      frame2Path: f2Path,
    };
  }

  // Try optional live ComfyUI light image generation if reachable on 127.0.0.1:8188
  const comfy = await probeComfyUiStatus();
  if (comfy.available) {
    try {
      const wf = buildComfyUiLightweightWorkflow(params.shot);
      const qRes = await fetch(`${comfy.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: wf.prompt }),
      });
      if (qRes.ok) {
        const queued = (await qRes.json()) as { prompt_id?: string };
        if (queued.prompt_id) {
          for (let i = 0; i < 12; i++) {
            await new Promise((r) => setTimeout(r, 1200));
            const hRes = await fetch(`${comfy.baseUrl}/history/${queued.prompt_id}`);
            if (hRes.ok) {
              const hist = (await hRes.json()) as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }>;
              const item = hist[queued.prompt_id];
              const imgMeta = item?.outputs?.["7"]?.images?.[0];
              if (imgMeta) {
                const viewUrl = `${comfy.baseUrl}/view?filename=${encodeURIComponent(imgMeta.filename)}&subfolder=${encodeURIComponent(imgMeta.subfolder || "")}&type=${encodeURIComponent(imgMeta.type || "output")}`;
                const imgRes = await fetch(viewUrl);
                if (imgRes.ok) {
                  const arr = Buffer.from(await imgRes.arrayBuffer());
                  fs.writeFileSync(f1Path, arr);
                  await execFileAsync("ffmpeg", [
                    "-y",
                    "-i",
                    f1Path,
                    "-vf",
                    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${Math.round(width * 0.85)}:${Math.round(height * 0.85)},scale=${width}:${height}`,
                    "-frames:v",
                    "1",
                    f2Path,
                  ]);
                  return {
                    imageUrl: `/api/media/images/${f1Name}`,
                    secondaryImageUrl: `/api/media/images/${f2Name}`,
                    frame1Path: f1Path,
                    frame2Path: f2Path,
                  };
                }
              }
            }
          }
        }
      }
    } catch {
      // gracefully fall back to HyperFrames studio plate renderer
    }
  }

  // Fallback high-craft HyperFrames HTML5 Studio Composition Cards (realistic dark optical HUD + scene spec)
  const fontCss = buildFontFaceCss();
  const buildCardHtml = (frameIdx: 1 | 2) => {
    const accent = frameIdx === 1 ? "#F59E0B" : "#38BDF8";
    const frameTitle = frameIdx === 1 ? "فریم ۱ · نقطه شروع شات" : "فریم ۲ · اوج حرکت دوربین";
    const frameDesc =
      frameIdx === 1
        ? params.shot.startFrameDescriptionFa || params.shot.sceneDescriptionFa
        : params.shot.endFrameDescriptionFa || params.shot.cameraMovement;
    const lens = escapeHtml(params.shot.lensAndFramingFa || params.shot.cameraAngle || "Macro 50mm");
    const light = escapeHtml(params.shot.lightingRigFa || params.shot.lightingAndMood || "Tungsten Key");
    const micro = escapeHtml(params.shot.microScenarioFa || params.shot.sceneDescriptionFa || "");
    const caption = escapeHtml(params.shot.onScreenText || "");
    const engPrompt = escapeHtml(
      (frameIdx === 1 ? params.shot.photorealPromptStartEn : params.shot.photorealPromptEndEn) ||
        params.shot.visualPromptFa ||
        ""
    ).slice(0, 170);

    return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
${fontCss}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  width: ${width}px;
  height: ${height}px;
  background: radial-gradient(circle at ${frameIdx === 1 ? "35% 32%" : "64% 42%"}, ${
      frameIdx === 1 ? "rgba(245,158,11,0.22)" : "rgba(56,189,248,0.22)"
    }, #0B0D11 68%);
  color: #F8FAFC;
  font-family: 'VazirmatnHF', 'Vazirmatn', 'Tahoma', sans-serif;
  padding: 52px 32px 170px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
}
.grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 60px 60px;
  pointer-events: none;
}
.top-bar {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255,255,255,0.12);
  padding-bottom: 14px;
  font-size: 13px;
}
.badge { color: ${accent}; font-weight: 700; }
.tc { color: #94A3B8; font-family: monospace; font-size: 12px; }
.hero {
  position: relative;
  background: rgba(20, 23, 31, 0.88);
  border: 1.5px solid ${accent};
  border-radius: 18px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 22px 48px rgba(0,0,0,0.6);
}
.kicker { font-size: 13px; font-weight: 700; color: ${accent}; }
.scene { font-size: 19px; font-weight: 700; line-height: 1.65; color: #FFFFFF; }
.micro { font-size: 14px; line-height: 1.7; color: #CBD5E1; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; }
.specs { display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: #94A3B8; background: rgba(11,13,17,0.75); padding: 12px; border-radius: 10px; }
.en-prompt { dir: ltr; text-align: left; font-family: monospace; font-size: 11px; line-height: 1.5; color: #7DD3FC; background: rgba(11,13,17,0.85); padding: 10px; border-radius: 8px; border: 1px solid rgba(56,189,248,0.22); }
.caption {
  position: relative;
  background: rgba(11,13,17,0.92);
  border: 1.5px solid ${accent};
  border-radius: 14px;
  padding: 14px 20px;
  text-align: center;
  font-size: 22px;
  font-weight: 700;
  color: #FFFFFF;
}
</style>
</head>
<body>
  <div class="grid"></div>
  <div class="top-bar">
    <span class="badge">شات ${params.shot.shotNumber} · ${frameTitle}</span>
    <span class="tc" dir="ltr">${params.shot.timecode} (${params.shot.durationSeconds}s)</span>
  </div>
  <div class="hero">
    <div class="kicker">${escapeHtml(params.shot.cameraAngle)} · ${escapeHtml(params.shot.cameraMovement)}</div>
    <div class="scene">${escapeHtml(frameDesc)}</div>
    <div class="micro">${micro}</div>
    <div class="specs">
      <div><strong>لنز و قاب:</strong> ${lens}</div>
      <div><strong>نورپردازی:</strong> ${light}</div>
    </div>
    <div class="en-prompt">${engPrompt}</div>
  </div>
  ${caption ? `<div class="caption">${caption}</div>` : `<div></div>`}
</body>
</html>`;
  };

  await renderHyperFramesPng({
    html: buildCardHtml(1),
    width,
    height,
    outPngPath: f1Path,
  });
  await renderHyperFramesPng({
    html: buildCardHtml(2),
    width,
    height,
    outPngPath: f2Path,
  });

  return {
    imageUrl: `/api/media/images/${f1Name}`,
    secondaryImageUrl: `/api/media/images/${f2Name}`,
    frame1Path: f1Path,
    frame2Path: f2Path,
  };
}

function mapCameraMotion(movement: string): CameraMotionKind {
  const m = movement.toLowerCase();
  if (m.includes("پن") || m.includes("چپ") || m.includes("راست") || m.includes("pan")) return "pan";
  if (m.includes("چرخش") || m.includes("orbit")) return "orbit";
  if (m.includes("ثابت") || m.includes("static")) return "static";
  return "push-in";
}

function mapTransition(t?: DirectorShot["transitionToNext"]): TransitionKind {
  switch (t) {
    case "whip_pan":
      return "slide";
    case "zoom_in":
      return "zoom";
    case "cross_dissolve":
      return "crossfade";
    default:
      return "cut";
  }
}

export function buildSingleShotCompositionPlan(params: {
  project: ProjectRecord;
  shot: DirectorShot;
  totalShots: number;
  revisionNote?: string;
}): ShotCompositionPlan {
  const isHorizontal =
    params.project.brief.contentFormat === "long_video" ||
    params.project.brief.platform === "youtube";
  const width = isHorizontal ? 960 : 540;
  const height = isHorizontal ? 540 : 960;
  const durationSec = Math.max(3, Math.min(8, Math.round(Number(params.shot.durationSeconds) || 5)));

  const presets: Array<{ preset: PalettePresetKind; palette: [string, string, string] }> = [
    { preset: "studio_amber", palette: ["#0B0D11", "#14171F", "#F59E0B"] },
    { preset: "slate_sky", palette: ["#0F172A", "#1E293B", "#38BDF8"] },
    { preset: "emerald_tech", palette: ["#091512", "#11241E", "#10B981"] },
    { preset: "crimson_alert", palette: ["#180B0E", "#271218", "#F43F5E"] },
  ];
  const chosen = presets[(params.shot.shotNumber - 1) % presets.length];
  const isFirst = params.shot.shotNumber === 1;
  const isLast = params.shot.shotNumber === params.totalShots;

  const badge = `شات ${params.shot.shotNumber} از ${params.totalShots} · ${params.shot.cameraAngle}`;
  const headlineText = params.shot.onScreenText?.trim() || params.project.brief.title.slice(0, 55);
  const subtitleText = params.revisionNote?.trim()
    ? `${params.shot.sceneDescriptionFa} (${params.revisionNote.trim()})`
    : params.shot.sceneDescriptionFa;

  const nodes: ShotCompositionPlan["nodes"] = [
    {
      component: "Background",
      props: {
        showGrid: true,
        glowPosition: isFirst ? "top" : isLast ? "bottom" : "center",
      },
    },
    {
      component: "Headline",
      props: {
        badge,
        text: headlineText,
        align: "center",
      },
    },
    {
      component: "Card",
      props: {
        kicker: params.shot.lightingAndMood || "کارگردانی استودیو",
        title: subtitleText.slice(0, 95),
        body: params.shot.spokenSegment || "",
      },
    },
  ];

  return {
    shot_id: `shot_${String(params.shot.shotNumber).padStart(2, "0")}`,
    duration_sec: durationSec,
    fps: 30,
    width,
    height,
    palette_preset: chosen.preset,
    palette: chosen.palette,
    transition_in: mapTransition(params.shot.transitionToNext),
    camera_motion: mapCameraMotion(params.shot.cameraMovement || ""),
    caption_text: params.shot.spokenSegment || headlineText,
    nodes,
  };
}

/**
 * Renders dual keyframes with Ken Burns smooth camera motion, HyperFrames RTL Persian caption PNG overlay,
 * subtle SFX tone, and H.264 yuv420p AAC MP4 output.
 */
async function renderCinematicHyperFramesFfmpegShot(params: {
  project: ProjectRecord;
  shot: DirectorShot;
  totalShots: number;
  width: number;
  height: number;
  durationSec: number;
  frame1Path?: string | null;
  frame2Path?: string | null;
  outputPath: string;
}): Promise<void> {
  fs.mkdirSync(path.dirname(params.outputPath), { recursive: true });
  let f1 = params.frame1Path && fs.existsSync(params.frame1Path) ? params.frame1Path : null;
  let f2 = params.frame2Path && fs.existsSync(params.frame2Path) ? params.frame2Path : null;

  if (!f1 || !f2) {
    const generated = await renderHyperFramesDualKeyframes({
      projectId: params.project.id,
      shot: params.shot,
      directionSummary: params.project.director?.visualDirectionSummary || "",
      width: params.width,
      height: params.height,
    });
    f1 = generated.frame1Path;
    f2 = generated.frame2Path;
  }

  const captionOverlayPath = `${params.outputPath}.caption.png`;
  const captionText = params.shot.onScreenText?.trim() || "";
  const badgeText = `شات ${params.shot.shotNumber} از ${params.totalShots}`;
  await renderPersianReelsCaptionOverlayPng({
    text: captionText,
    width: params.width,
    height: params.height,
    outPngPath: captionOverlayPath,
    shotBadge: badgeText,
    accentHex: params.shot.shotNumber % 2 === 1 ? "#F59E0B" : "#38BDF8",
  });

  const halfDur = Math.max(1.5, Number((params.durationSec * 0.56).toFixed(2)));
  const fadeDur = 0.45;
  const secondDur = Math.max(1.5, Number((params.durationSec - halfDur + fadeDur).toFixed(2)));
  const offset = Number((halfDur - fadeDur).toFixed(2));
  const f1Frames = Math.max(45, Math.round(halfDur * 30));
  const f2Frames = Math.max(45, Math.round(secondDur * 30));
  const barHex = params.shot.shotNumber % 2 === 1 ? "0xF59E0B" : "0x38BDF8";

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-loop",
      "1",
      "-t",
      String(halfDur),
      "-i",
      f1,
      "-loop",
      "1",
      "-t",
      String(secondDur),
      "-i",
      f2,
      "-loop",
      "1",
      "-t",
      String(params.durationSec),
      "-i",
      captionOverlayPath,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${190 + params.shot.shotNumber * 30}:sample_rate=48000:d=0.18`,
      "-filter_complex",
      `[0:v]scale=${params.width * 2}:${params.height * 2}:force_original_aspect_ratio=increase,crop=${params.width * 2}:${params.height * 2},zoompan=z='min(zoom+0.0012,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${f1Frames}:s=${params.width}x${params.height}:fps=30,format=yuv420p[v0];` +
        `[1:v]scale=${params.width * 2}:${params.height * 2}:force_original_aspect_ratio=increase,crop=${params.width * 2}:${params.height * 2},zoompan=z='max(1.12-0.0011*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${f2Frames}:s=${params.width}x${params.height}:fps=30,format=yuv420p[v1];` +
        `[v0][v1]xfade=transition=fade:duration=${fadeDur}:offset=${offset}[base];` +
        `[base][2:v]overlay=0:0:shortest=1,drawbox=x=0:y=${params.height - 8}:w='(t/${params.durationSec})*${params.width}':h=8:color=${barHex}:t=fill,format=yuv420p[v];` +
        `[3:a]volume=0.07,apad=whole_dur=${params.durationSec}[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      String(params.durationSec),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      params.outputPath,
    ]);
  } finally {
    try {
      fs.rmSync(captionOverlayPath, { force: true });
    } catch {
      // ignore cleanup error
    }
  }
}

/**
 * Renders a single shot MP4 using the selected lightweight local engine, falling back
 * deterministically to HyperFrames + FFmpeg Cinema if optional local daemons (ComfyUI/Blender)
 * are offline or Remotion exceeds its cold-start timeout.
 */
export async function renderShotWithEngine(params: {
  engineId: LocalVideoEngineId;
  project: ProjectRecord;
  shot: DirectorShot;
  totalShots: number;
  frame1Path?: string | null;
  frame2Path?: string | null;
  outputPath: string;
  revisionNote?: string;
}): Promise<{ outputPath: string; engineUsed: LocalVideoEngineId; fallbackNoteFa?: string }> {
  const plan = buildSingleShotCompositionPlan({
    project: params.project,
    shot: params.shot,
    totalShots: params.totalShots,
    revisionNote: params.revisionNote,
  });

  if (params.engineId === "remotion_kinetic") {
    const tempRem = `${params.outputPath}.remotion.mp4`;
    try {
      await Promise.race([
        renderRemotionShot({
          plan,
          outputPath: tempRem,
          timeoutMs: 7_500,
          bypassCache: Boolean(params.revisionNote),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("remotion_timeout")), 7_500)
        ),
      ]);
      if (fs.existsSync(tempRem)) {
        fs.renameSync(tempRem, params.outputPath);
        return { outputPath: params.outputPath, engineUsed: "remotion_kinetic" };
      }
    } catch {
      if (fs.existsSync(tempRem)) fs.rmSync(tempRem, { force: true });
      await renderCinematicHyperFramesFfmpegShot({
        project: params.project,
        shot: params.shot,
        totalShots: params.totalShots,
        width: plan.width,
        height: plan.height,
        durationSec: plan.duration_sec,
        frame1Path: params.frame1Path,
        frame2Path: params.frame2Path,
        outputPath: params.outputPath,
      });
      return {
        outputPath: params.outputPath,
        engineUsed: "hyperframes_html",
        fallbackNoteFa: "موتور Remotion در زمان مجاز آماده نشد و رندر با موتور سریع HyperFrames انجام شد.",
      };
    }
  }

  if (params.engineId === "blender_headless") {
    if (isBlenderInstalled()) {
      try {
        await renderBlenderShot({
          shotId: plan.shot_id,
          blenderPrompt: params.shot.photorealPromptStartEn || params.shot.visualPromptFa,
          durationSec: plan.duration_sec,
          width: plan.width,
          height: plan.height,
          fps: plan.fps,
          outputPath: params.outputPath,
        });
        return { outputPath: params.outputPath, engineUsed: "blender_headless" };
      } catch {
        // fall through cleanly to HyperFrames
      }
    }
    await renderCinematicHyperFramesFfmpegShot({
      project: params.project,
      shot: params.shot,
      totalShots: params.totalShots,
      width: plan.width,
      height: plan.height,
      durationSec: plan.duration_sec,
      frame1Path: params.frame1Path,
      frame2Path: params.frame2Path,
      outputPath: params.outputPath,
    });
    return {
      outputPath: params.outputPath,
      engineUsed: "hyperframes_html",
      fallbackNoteFa: "Blender روی این سرور نصب نیست؛ خروجی با HyperFrames HTML5 رندر شد.",
    };
  }

  if (params.engineId === "comfyui_light") {
    const comfy = await probeComfyUiStatus();
    if (comfy.available) {
      // If a ComfyUI server is reachable locally, regenerate photoreal dual frames via ComfyUI first
      const frames = await renderHyperFramesDualKeyframes({
        projectId: params.project.id,
        shot: params.shot,
        directionSummary: params.project.director?.visualDirectionSummary || "",
        width: plan.width,
        height: plan.height,
      });
      await renderCinematicHyperFramesFfmpegShot({
        project: params.project,
        shot: params.shot,
        totalShots: params.totalShots,
        width: plan.width,
        height: plan.height,
        durationSec: plan.duration_sec,
        frame1Path: frames.frame1Path,
        frame2Path: frames.frame2Path,
        outputPath: params.outputPath,
      });
      return { outputPath: params.outputPath, engineUsed: "comfyui_light" };
    }
    await renderCinematicHyperFramesFfmpegShot({
      project: params.project,
      shot: params.shot,
      totalShots: params.totalShots,
      width: plan.width,
      height: plan.height,
      durationSec: plan.duration_sec,
      frame1Path: params.frame1Path,
      frame2Path: params.frame2Path,
      outputPath: params.outputPath,
    });
    return {
      outputPath: params.outputPath,
      engineUsed: "hyperframes_html",
      fallbackNoteFa: "سرور لوکال ComfyUI خاموش بود؛ رندر با موتور HyperFrames HTML5 انجام شد.",
    };
  }

  // hyperframes_html & ffmpeg_cinema both execute the unified Ken Burns + RTL Caption PNG pipeline cleanly
  await renderCinematicHyperFramesFfmpegShot({
    project: params.project,
    shot: params.shot,
    totalShots: params.totalShots,
    width: plan.width,
    height: plan.height,
    durationSec: plan.duration_sec,
    frame1Path: params.frame1Path,
    frame2Path: params.frame2Path,
    outputPath: params.outputPath,
  });

  return {
    outputPath: params.outputPath,
    engineUsed: params.engineId === "ffmpeg_cinema" ? "ffmpeg_cinema" : "hyperframes_html",
  };
}
