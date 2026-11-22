import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import type { ShotSpec } from "../../../src/types/videoPipeline.js";
import { findRemotionBrowserExecutable } from "../config.js";
import { getBundledFontsDir } from "../kineticSubtitles.js";

const execFileAsync = promisify(execFile);

export interface HyperFramesRenderRequest {
  spec: ShotSpec;
  outputPath: string;
  keyframeImagePath?: string | null;
  timeoutMs?: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileToDataUri(filePath: string | null | undefined): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".svg"
        ? "image/svg+xml"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";
  const b64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${b64}`;
}

function loadFontDataUri(filename: string): string {
  const full = path.join(getBundledFontsDir(), filename);
  if (!fs.existsSync(full)) return "";
  return `data:font/ttf;base64,${fs.readFileSync(full).toString("base64")}`;
}

/**
 * Generates a deterministic self-contained HyperFrames HTML5 + Canvas2D + CSS3 composition driven strictly
 * by the Director's 7-Layer Cinematic Blueprint (Scene, Objects, Animation, Camera, Lighting, Transition, Sound Design).
 * Exposes `window.__hfSeek(frameIndex, totalFrames)` for exact frame-accurate capture with zero jitter.
 */
export function buildHyperFramesHtmlDocument(params: {
  spec: ShotSpec;
  keyframeDataUri?: string | null;
}): string {
  const [width, height] = params.spec.resolution;
  const seven = params.spec.seven_layer_spec;
  const headline = (params.spec.visual.headline || params.spec.visual.primary_subject || "").trim().slice(0, 65);
  const badge = (params.spec.visual.badge_text || `شات ${params.spec.shot_number}`).trim().slice(0, 42);
  const lightingText = (seven?.lighting || params.spec.style.mood || "").toLowerCase();
  const objectText = (seven?.objects || params.spec.visual.primary_subject || "").toLowerCase();

  // Detect cool white/blue metallic commercial lighting vs warm molten amber lighting from Director's Lighting layer
  const isWarmMolten =
    lightingText.includes("آتش") ||
    lightingText.includes("کهربا") ||
    lightingText.includes("گداخته") ||
    lightingText.includes("amber") ||
    lightingText.includes("molten") ||
    lightingText.includes("fire");
  const isSteelPipeSubject =
    objectText.includes("لوله") ||
    objectText.includes("فولاد") ||
    objectText.includes("pipe") ||
    objectText.includes("steel") ||
    objectText.includes("کولیس") ||
    objectText.includes("رده");

  const rimColorA = isWarmMolten ? "#FF9E2C" : "#38BDF8";
  const rimColorB = isWarmMolten ? "#FFF1D0" : "#F8FAFC";
  const accentHex = isWarmMolten ? "#F59E0B" : "#38BDF8";
  const cameraMotion = params.spec.visual.camera_motion || "push-in";

  const vazirExtraBoldUri = loadFontDataUri("Vazirmatn-ExtraBold.ttf");
  const lalezarUri = loadFontDataUri("Lalezar-Regular.ttf");

  const safeHeadline = escapeHtml(headline);
  const safeBadge = escapeHtml(badge);
  const safeLightingNote = escapeHtml((seven?.lighting || "").slice(0, 80));

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  ${vazirExtraBoldUri ? `@font-face { font-family: 'VazirmatnHF'; src: url('${vazirExtraBoldUri}') format('truetype'); font-weight: 800; }` : ""}
  ${lalezarUri ? `@font-face { font-family: 'LalezarHF'; src: url('${lalezarUri}') format('truetype'); font-weight: 400; }` : ""}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: #05080F;
    font-family: 'VazirmatnHF', 'LalezarHF', sans-serif;
    color: #F8FAFC;
  }
  #stage {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: radial-gradient(ellipse at 50% 34%, #101B2E 0%, #060911 58%, #020307 100%);
  }
  #camera-rig {
    position: absolute;
    inset: -6%;
    width: 112%;
    height: 112%;
    will-change: transform;
    transform-origin: 50% 50%;
  }
  #bg-photo {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: contrast(1.12) saturate(1.06) brightness(0.92);
  }
  #vignette-scrim {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(4,7,14,0.72) 0%, rgba(4,7,14,0.12) 26%, rgba(4,7,14,0.15) 66%, rgba(4,7,14,0.88) 100%),
      radial-gradient(circle at 50% 42%, transparent 32%, rgba(2,5,11,0.68) 100%);
    pointer-events: none;
  }
  #fx-canvas {
    position: absolute;
    inset: 0;
    width: ${width}px;
    height: ${height}px;
    pointer-events: none;
  }
  #typo-layer {
    position: absolute;
    top: ${Math.round(height * 0.085)}px;
    left: ${Math.round(width * 0.07)}px;
    right: ${Math.round(width * 0.07)}px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 18px;
    pointer-events: none;
  }
  .kicker-line {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    font-size: ${Math.round(width * 0.028)}px;
    font-weight: 800;
    letter-spacing: 0.02em;
    color: ${accentHex};
    text-shadow: 0 4px 20px rgba(0,0,0,0.85);
    opacity: 0;
  }
  .kicker-rule {
    width: 44px;
    height: 3px;
    background: linear-gradient(90deg, transparent, ${accentHex}, #FFFFFF);
    border-radius: 2px;
  }
  .hero-headline {
    font-family: 'LalezarHF', 'VazirmatnHF', sans-serif;
    font-size: ${Math.round(width * 0.078)}px;
    line-height: 1.18;
    color: #FFFFFF;
    text-shadow: 0 8px 34px rgba(0,0,0,0.92), 0 0 24px rgba(56,189,248,0.28);
    max-width: 92%;
    opacity: 0;
  }
  .spec-bar {
    position: absolute;
    bottom: ${Math.round(height * 0.24)}px;
    left: ${Math.round(width * 0.12)}px;
    right: ${Math.round(width * 0.12)}px;
    height: 3px;
    background: rgba(255,255,255,0.12);
    border-radius: 2px;
    overflow: hidden;
  }
  .spec-bar-fill {
    width: 0%;
    height: 100%;
    background: linear-gradient(90deg, ${rimColorA}, ${rimColorB});
    box-shadow: 0 0 18px ${rimColorA};
  }
</style>
</head>
<body>
<div id="stage">
  <div id="camera-rig">
    ${params.keyframeDataUri ? `<img id="bg-photo" src="${params.keyframeDataUri}" alt="shot keyframe" />` : ""}
  </div>
  <canvas id="fx-canvas" width="${width}" height="${height}"></canvas>
  <div id="vignette-scrim"></div>
  <div id="typo-layer">
    <div id="kicker" class="kicker-line">
      <span class="kicker-rule"></span>
      <span>${safeBadge}</span>
      <span class="kicker-rule"></span>
    </div>
    ${safeHeadline ? `<h1 id="headline" class="hero-headline">${safeHeadline}</h1>` : ""}
  </div>
  <div class="spec-bar"><div id="spec-fill" class="spec-bar-fill"></div></div>
</div>
<script>
(function() {
  const W = ${width};
  const H = ${height};
  const hasPhoto = ${Boolean(params.keyframeDataUri)};
  const isSteelPipe = ${isSteelPipeSubject};
  const cameraMotion = ${JSON.stringify(cameraMotion)};
  const rimA = ${JSON.stringify(rimColorA)};
  const rimB = ${JSON.stringify(rimColorB)};
  const lightingHint = ${JSON.stringify(safeLightingNote)};

  const canvas = document.getElementById('fx-canvas');
  const ctx = canvas.getContext('2d');
  const rig = document.getElementById('camera-rig');
  const kicker = document.getElementById('kicker');
  const headline = document.getElementById('headline');
  const specFill = document.getElementById('spec-fill');

  // Deterministic pseudo-random floating particles (dust motes & subtle metallic sparks)
  const particles = [];
  let seed = ${params.spec.shot_number * 9973 + 1337};
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  for (let i = 0; i < 68; i++) {
    particles.push({
      x: rand() * W,
      y: rand() * H,
      r: 1.4 + rand() * 3.8,
      vx: (rand() - 0.45) * 42,
      vy: -22 - rand() * 68,
      alpha: 0.2 + rand() * 0.65,
      warm: rand() > 0.45
    });
  }

  function easeOutCubic(t) {
    const c = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - c, 3);
  }

  function drawProceduralSteelPipe(progress) {
    // High-contrast cinematic brushed steel pipe cylinder with white & blue specular highlights
    const cx = W * 0.5;
    const cy = H * 0.52;
    const pipeW = W * 0.72;
    const pipeH = H * 0.16;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.18 + Math.sin(progress * Math.PI) * 0.05);

    // Soft studio ground reflection
    const glow = ctx.createRadialGradient(0, pipeH * 0.9, 10, 0, pipeH * 0.9, pipeW * 0.65);
    glow.addColorStop(0, rimA + '55');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-pipeW * 0.7, 0, pipeW * 1.4, pipeH * 1.8);

    // Metallic cylinder gradient with moving specular reflection band
    const sweep = -0.35 + progress * 0.7;
    const bodyGrad = ctx.createLinearGradient(0, -pipeH / 2, 0, pipeH / 2);
    bodyGrad.addColorStop(0.0, '#0B1320');
    bodyGrad.addColorStop(Math.max(0.08, 0.22 + sweep * 0.15), rimA);
    bodyGrad.addColorStop(Math.max(0.18, 0.36 + sweep * 0.12), '#FFFFFF');
    bodyGrad.addColorStop(0.55, '#475569');
    bodyGrad.addColorStop(0.82, '#1E293B');
    bodyGrad.addColorStop(0.95, rimA);
    bodyGrad.addColorStop(1.0, '#05080F');

    ctx.fillStyle = bodyGrad;
    ctx.fillRect(-pipeW / 2, -pipeH / 2, pipeW, pipeH);

    // Subtle brushed steel horizontal micro-grooves
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let y = -pipeH / 2 + 6; y < pipeH / 2; y += 6) {
      ctx.beginPath();
      ctx.moveTo(-pipeW / 2, y);
      ctx.lineTo(pipeW / 2, y);
      ctx.stroke();
    }

    // Cross-section hollow bore showing realistic steel wall thickness
    const rx = pipeH * 0.24;
    const ry = pipeH * 0.5;
    ctx.beginPath();
    ctx.ellipse(pipeW / 2, 0, rx, ry, 0, 0, Math.PI * 2);
    const rimGrad = ctx.createLinearGradient(pipeW / 2 - rx, -ry, pipeW / 2 + rx, ry);
    rimGrad.addColorStop(0, '#FFFFFF');
    rimGrad.addColorStop(0.45, '#94A3B8');
    rimGrad.addColorStop(1, rimA);
    ctx.fillStyle = rimGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(pipeW / 2, 0, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#03060C';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.stroke();

    ctx.restore();
  }

  window.__hfSeek = function(frame, totalFrames) {
    const t = totalFrames > 1 ? frame / (totalFrames - 1) : 0;
    const sec = t * ${params.spec.duration_sec};

    // 1. Controlled smooth camera rig motion
    let scale = 1.02 + t * 0.085;
    let tx = 0;
    let ty = 0;
    if (cameraMotion === 'pan') {
      scale = 1.08;
      tx = (-0.025 + t * 0.05) * W;
      ty = Math.sin(t * Math.PI) * -10;
    } else if (cameraMotion === 'orbit') {
      scale = 1.06 + Math.sin(t * Math.PI) * 0.04;
      tx = Math.sin(t * Math.PI * 1.2) * 28;
      ty = Math.cos(t * Math.PI) * 14;
    } else if (cameraMotion === 'static') {
      scale = 1.01 + t * 0.025;
    }
    rig.style.transform = 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) scale(' + scale.toFixed(4) + ')';

    // 2. Canvas atmospheric volumetric light beams + procedural steel pipe (when no photo) + floating particles
    ctx.clearRect(0, 0, W, H);

    // Cool blue / crisp white diagonal studio rim light beams
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const beamX = W * (0.2 + t * 0.6);
    const beamGrad = ctx.createRadialGradient(beamX, H * 0.22, 10, beamX, H * 0.35, W * 0.72);
    beamGrad.addColorStop(0, rimA + '38');
    beamGrad.addColorStop(0.45, rimB + '16');
    beamGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = beamGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    if (!hasPhoto && isSteelPipe) {
      drawProceduralSteelPipe(t);
    }

    // Subtle floating dust / metallic spark particles
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const p of particles) {
      const px = ((p.x + p.vx * sec) % W + W) % W;
      const py = ((p.y + p.vy * sec) % H + H) % H;
      const pulse = 0.65 + 0.35 * Math.sin(sec * 3.1 + p.x);
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.warm ? rimB : rimA;
      ctx.globalAlpha = p.alpha * pulse * 0.72;
      ctx.shadowBlur = p.r * 4;
      ctx.shadowColor = p.warm ? rimB : rimA;
      ctx.fill();
    }
    ctx.restore();

    // 3. Kinetic typography entrance (modern, crisp, non-intrusive)
    const kickerIn = easeOutCubic(sec / 0.45);
    const headIn = easeOutCubic((sec - 0.14) / 0.55);
    const outFade = sec > ${Math.max(1.2, params.spec.duration_sec - 0.45)}
      ? Math.max(0, 1 - (sec - ${Math.max(1.2, params.spec.duration_sec - 0.45)}) / 0.4)
      : 1;

    if (kicker) {
      kicker.style.opacity = (kickerIn * outFade).toFixed(3);
      kicker.style.transform = 'translateY(' + ((1 - kickerIn) * 18).toFixed(1) + 'px)';
    }
    if (headline) {
      headline.style.opacity = (headIn * outFade).toFixed(3);
      headline.style.transform = 'translateY(' + ((1 - headIn) * 26).toFixed(1) + 'px) scale(' + (0.95 + headIn * 0.05).toFixed(4) + ')';
    }
    if (specFill) {
      specFill.style.width = (t * 100).toFixed(1) + '%';
    }
    return { frame, progress: t, lightingHint };
  };

  window.__hfSeek(0, 100);
})();
</script>
</body>
</html>`;
}

/**
 * Renders a deterministic 100%-free local HyperFrames MP4 clip using Playwright Chromium + FFmpeg.
 */
export async function renderHyperFramesShot(
  req: HyperFramesRenderRequest
): Promise<{ outputPath: string; framesRendered: number; durationMs: number }> {
  const started = Date.now();
  const [width, height] = req.spec.resolution;
  const fps = Math.max(24, Math.min(30, req.spec.fps || 24));
  const durationSec = Math.max(2, Math.min(15, req.spec.duration_sec || 4));
  const totalFrames = Math.max(24, Math.round(durationSec * fps));

  const workDir = path.join(path.dirname(req.outputPath), `hf_${req.spec.shot_id}_${Date.now()}`);
  const framesDir = path.join(workDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const keyframeDataUri = fileToDataUri(req.keyframeImagePath || req.spec.visual.keyframe_path);
  const html = buildHyperFramesHtmlDocument({
    spec: req.spec,
    keyframeDataUri,
  });
  const htmlPath = path.join(workDir, "scene.html");
  fs.writeFileSync(htmlPath, html, "utf-8");

  const execPath = findRemotionBrowserExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(execPath ? { executablePath: execPath } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts?.ready);

    // Capture frames deterministically (JPEG q=94 is crisp & 4x faster than PNG for 1080x1920)
    for (let f = 0; f < totalFrames; f++) {
      await page.evaluate(
        ({ frameIdx, total }) => {
          (window as unknown as { __hfSeek: (a: number, b: number) => void }).__hfSeek(frameIdx, total);
        },
        { frameIdx: f, total: totalFrames }
      );
      const frameFile = path.join(framesDir, `frame_${String(f).padStart(5, "0")}.jpg`);
      await page.screenshot({ path: frameFile, type: "jpeg", quality: 94 });
    }
  } finally {
    await browser.close();
  }

  fs.mkdirSync(path.dirname(req.outputPath), { recursive: true });
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      path.join(framesDir, "frame_%05d.jpg"),
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=48000`,
      "-t",
      durationSec.toFixed(2),
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-level",
      "4.2",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-shortest",
      req.outputPath,
    ],
    { timeout: req.timeoutMs ?? 150_000 }
  );

  // Clean up intermediate frame JPGs to save disk space
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // non-fatal
  }

  if (!fs.existsSync(req.outputPath)) {
    throw new Error("خروجی MP4 از موتور HyperFrames ساخته نشد.");
  }

  return {
    outputPath: req.outputPath,
    framesRendered: totalFrames,
    durationMs: Date.now() - started,
  };
}
