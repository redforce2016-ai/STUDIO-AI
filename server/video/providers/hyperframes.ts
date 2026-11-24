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
  const rawBadge = (params.spec.visual.badge_text || "").trim().slice(0, 38);
  const cleanBadge = /^شات\s*[۰-۹0-9]+$/i.test(rawBadge) ? "" : rawBadge;
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
  const safeBadge = escapeHtml(cleanBadge);
  const safeLightingNote = escapeHtml((seven?.lighting || "").slice(0, 80));

  const cornerInsetX = Math.round(width * 0.055);
  const cornerInsetTop = Math.round(height * 0.048);
  const cornerInsetBottom = Math.round(height * 0.11);

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
    background: #04070E;
    font-family: 'VazirmatnHF', 'LalezarHF', sans-serif;
    color: #F8FAFC;
  }
  #stage {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    perspective: 1400px;
    background: radial-gradient(ellipse at 50% 36%, #111D33 0%, #060912 60%, #020307 100%);
  }
  #camera-rig {
    position: absolute;
    inset: -7%;
    width: 114%;
    height: 114%;
    will-change: transform;
    transform-origin: 50% 48%;
    transform-style: preserve-3d;
  }
  #bg-photo {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: contrast(1.14) saturate(1.08) brightness(0.93);
  }
  #vignette-scrim {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(3,6,13,0.82) 0%, rgba(3,6,13,0.28) 20%, rgba(3,6,13,0.06) 44%, rgba(3,6,13,0.16) 68%, rgba(3,6,13,0.92) 100%),
      radial-gradient(circle at 50% 45%, transparent 34%, rgba(2,5,11,0.62) 100%);
    pointer-events: none;
  }
  #fx-canvas {
    position: absolute;
    inset: 0;
    width: ${width}px;
    height: ${height}px;
    pointer-events: none;
  }
  #entry-flare {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 42%, ${rimColorB}55 0%, ${rimColorA}28 38%, transparent 72%);
    mix-blend-mode: screen;
    opacity: 0;
    pointer-events: none;
  }
  .cad-reticle {
    position: absolute;
    width: 24px;
    height: 24px;
    pointer-events: none;
    opacity: 0.45;
  }
  .cad-tl { top: ${cornerInsetTop}px; left: ${cornerInsetX}px; border-top: 1.5px solid ${accentHex}; border-left: 1.5px solid ${accentHex}; }
  .cad-tr { top: ${cornerInsetTop}px; right: ${cornerInsetX}px; border-top: 1.5px solid ${accentHex}; border-right: 1.5px solid ${accentHex}; }
  .cad-bl { bottom: ${cornerInsetBottom}px; left: ${cornerInsetX}px; border-bottom: 1.5px solid rgba(255,255,255,0.42); border-left: 1.5px solid rgba(255,255,255,0.42); }
  .cad-br { bottom: ${cornerInsetBottom}px; right: ${cornerInsetX}px; border-bottom: 1.5px solid rgba(255,255,255,0.42); border-right: 1.5px solid rgba(255,255,255,0.42); }
  #typo-layer {
    position: absolute;
    top: ${Math.round(height * 0.095)}px;
    left: ${Math.round(width * 0.08)}px;
    right: ${Math.round(width * 0.08)}px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
    pointer-events: none;
  }
  .accent-hairline {
    width: 84px;
    height: 3px;
    background: linear-gradient(90deg, transparent, ${accentHex}, #FFFFFF, ${accentHex}, transparent);
    border-radius: 2px;
    box-shadow: 0 0 18px ${accentHex}99;
    opacity: 0;
  }
  .bento-tag {
    font-family: 'VazirmatnHF', sans-serif;
    font-size: ${Math.round(width * 0.024)}px;
    font-weight: 800;
    color: ${accentHex};
    letter-spacing: 0.03em;
    text-shadow: 0 2px 16px rgba(0,0,0,0.9);
    opacity: 0;
  }
  .hero-headline {
    font-family: 'LalezarHF', 'VazirmatnHF', sans-serif;
    font-size: ${Math.round(width * 0.076)}px;
    line-height: 1.18;
    color: #FFFFFF;
    text-shadow: 0 10px 38px rgba(0,0,0,0.96), 0 0 26px ${rimColorA}55;
    max-width: 94%;
    opacity: 0;
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
  <div id="entry-flare"></div>
  <div class="cad-reticle cad-tl"></div>
  <div class="cad-reticle cad-tr"></div>
  <div class="cad-reticle cad-bl"></div>
  <div class="cad-reticle cad-br"></div>
  <div id="typo-layer">
    <div id="accent-line" class="accent-hairline"></div>
    ${safeBadge ? `<div id="bento-tag" class="bento-tag">${safeBadge}</div>` : ""}
    ${safeHeadline ? `<h1 id="headline" class="hero-headline">${safeHeadline}</h1>` : ""}
  </div>
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
  const accentLine = document.getElementById('accent-line');
  const bentoTag = document.getElementById('bento-tag');
  const headline = document.getElementById('headline');
  const entryFlare = document.getElementById('entry-flare');

  // Deterministic pseudo-random multi-depth metallic dust motes & subtle embers
  const particles = [];
  let seed = ${params.spec.shot_number * 9973 + 1337};
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  for (let i = 0; i < 82; i++) {
    const depth = 0.4 + rand() * 1.1;
    particles.push({
      x: rand() * W,
      y: rand() * H,
      r: (1.2 + rand() * 3.4) * depth,
      vx: (rand() - 0.45) * 44 * depth,
      vy: (-18 - rand() * 64) * depth,
      alpha: 0.18 + rand() * 0.62,
      warm: rand() > 0.42
    });
  }

  function easeOutBack(t) {
    const c = Math.max(0, Math.min(1, t));
    const c1 = 1.35;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
  }

  function easeOutExpo(t) {
    const c = Math.max(0, Math.min(1, t));
    return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
  }

  function drawProceduralSteelPipe(progress) {
    const cx = W * 0.5;
    const cy = H * 0.53;
    const pipeW = W * 0.74;
    const pipeH = H * 0.165;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.17 + Math.sin(progress * Math.PI) * 0.045);

    const glow = ctx.createRadialGradient(0, pipeH * 0.85, 10, 0, pipeH * 0.85, pipeW * 0.68);
    glow.addColorStop(0, rimA + '60');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-pipeW * 0.72, 0, pipeW * 1.44, pipeH * 1.9);

    const sweep = -0.35 + progress * 0.7;
    const bodyGrad = ctx.createLinearGradient(0, -pipeH / 2, 0, pipeH / 2);
    bodyGrad.addColorStop(0.0, '#070E19');
    bodyGrad.addColorStop(Math.max(0.07, 0.20 + sweep * 0.14), rimA);
    bodyGrad.addColorStop(Math.max(0.16, 0.34 + sweep * 0.12), '#FFFFFF');
    bodyGrad.addColorStop(0.54, '#475569');
    bodyGrad.addColorStop(0.80, '#1E293B');
    bodyGrad.addColorStop(0.94, rimA);
    bodyGrad.addColorStop(1.0, '#04070E');

    ctx.fillStyle = bodyGrad;
    ctx.fillRect(-pipeW / 2, -pipeH / 2, pipeW, pipeH);

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let y = -pipeH / 2 + 5; y < pipeH / 2; y += 5) {
      ctx.beginPath();
      ctx.moveTo(-pipeW / 2, y);
      ctx.lineTo(pipeW / 2, y);
      ctx.stroke();
    }

    const rx = pipeH * 0.25;
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
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.stroke();

    ctx.restore();
  }

  window.__hfSeek = function(frame, totalFrames) {
    const t = totalFrames > 1 ? frame / (totalFrames - 1) : 0;
    const sec = t * ${params.spec.duration_sec};

    // 1. 3D Perspective Camera Rig Motion (smooth cinematic dolly + parallax tilt)
    let scale = 1.03 + t * 0.085;
    let tx = 0;
    let ty = 0;
    let rx = Math.sin(t * Math.PI) * 1.1;
    let ry = (-0.5 + t) * 2.2;
    if (cameraMotion === 'pan') {
      scale = 1.085;
      tx = (-0.028 + t * 0.056) * W;
      ty = Math.sin(t * Math.PI) * -10;
      ry = (-1.4 + t * 2.8);
    } else if (cameraMotion === 'orbit') {
      scale = 1.07 + Math.sin(t * Math.PI) * 0.04;
      tx = Math.sin(t * Math.PI * 1.2) * 26;
      ty = Math.cos(t * Math.PI) * 12;
      ry = Math.sin(t * Math.PI) * 3.0;
    } else if (cameraMotion === 'static') {
      scale = 1.02 + t * 0.03;
      ry = (-0.4 + t * 0.8);
    }
    rig.style.transform =
      'perspective(1400px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) ' +
      'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) scale(' + scale.toFixed(4) + ')';

    // Optical shot-entry rim flare in first 0.28s
    if (entryFlare) {
      const flare = sec < 0.28 ? Math.sin((sec / 0.28) * Math.PI) * 0.34 : 0;
      entryFlare.style.opacity = flare.toFixed(3);
    }

    // 2. Canvas atmospheric anamorphic rim-light beam sweep + floating particles
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const beamX = W * (0.14 + t * 0.72);
    const beamGrad = ctx.createRadialGradient(beamX, H * 0.26, 12, beamX, H * 0.42, W * 0.76);
    beamGrad.addColorStop(0, rimA + '42');
    beamGrad.addColorStop(0.42, rimB + '1A');
    beamGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = beamGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle diagonal anamorphic light streak
    const streakX = -W * 0.3 + t * W * 1.6;
    const streakGrad = ctx.createLinearGradient(streakX - 140, 0, streakX + 140, H);
    streakGrad.addColorStop(0, 'rgba(255,255,255,0)');
    streakGrad.addColorStop(0.5, rimB + '18');
    streakGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = streakGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    if (!hasPhoto && isSteelPipe) {
      drawProceduralSteelPipe(t);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const p of particles) {
      const px = ((p.x + p.vx * sec) % W + W) % W;
      const py = ((p.y + p.vy * sec) % H + H) % H;
      const pulse = 0.65 + 0.35 * Math.sin(sec * 3.1 + p.x);
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.warm ? rimB : rimA;
      ctx.globalAlpha = p.alpha * pulse * 0.74;
      ctx.shadowBlur = p.r * 4.2;
      ctx.shadowColor = p.warm ? rimB : rimA;
      ctx.fill();
    }
    ctx.restore();

    // 3. Kinetic upper-safe-zone hook typography (expo ease + subtle overshoot rebound)
    const lineIn = easeOutExpo(sec / 0.38);
    const headIn = easeOutBack((sec - 0.1) / 0.46);
    const outFade = sec > ${Math.max(1.2, params.spec.duration_sec - 0.4)}
      ? Math.max(0, 1 - (sec - ${Math.max(1.2, params.spec.duration_sec - 0.4)}) / 0.36)
      : 1;

    if (accentLine) {
      accentLine.style.opacity = (lineIn * outFade).toFixed(3);
      accentLine.style.transform = 'scaleX(' + (0.2 + lineIn * 0.8).toFixed(3) + ')';
    }
    if (bentoTag) {
      bentoTag.style.opacity = (lineIn * outFade).toFixed(3);
      bentoTag.style.transform = 'translateY(' + ((1 - lineIn) * 14).toFixed(1) + 'px)';
    }
    if (headline) {
      const op = Math.min(1, Math.max(0, (sec - 0.1) / 0.25)) * outFade;
      headline.style.opacity = op.toFixed(3);
      headline.style.transform = 'translateY(' + ((1 - headIn) * 24).toFixed(1) + 'px) scale(' + (0.94 + headIn * 0.06).toFixed(4) + ')';
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
