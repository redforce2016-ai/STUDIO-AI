import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type Page } from "playwright-core";
import type { CameraMotionKind } from "../../../src/types/videoPipeline.js";
import { findHeadlessChromiumPath } from "./proceduralCinema.js";

const execFileAsync = promisify(execFile);

export type PhotorealisticFxProfile =
  | "molten_fire"
  | "pressurized_steam"
  | "refinery_night"
  | "industrial_clean"
  | "ambient_cinema";

export interface DetectedHotspot {
  u: number; // 0..1 left-to-right
  v: number; // 0..1 bottom-to-top (WebGL UV)
  intensity: number; // 0..1
}

export interface KeyframeThermalAnalysis {
  fxProfile: PhotorealisticFxProfile;
  hotspots: DetectedHotspot[];
  moltenPixelRatio: number;
  brightPixelRatio: number;
}

export interface PhotorealisticMotionRequest {
  keyframePath: string;
  prompt: string;
  shotNumber?: number;
  cameraMotion?: CameraMotionKind;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  depthMapOutPath?: string;
}

export interface PhotorealisticMotionResult {
  outputPath: string;
  depthMapPath: string | null;
  fxProfile: PhotorealisticFxProfile;
  hotspotsDetected: number;
  framesRendered: number;
  renderDurationMs: number;
}

/**
 * Classifies the physical FX profile (heat shimmer, sparks, billowing smoke, pressurized steam,
 * or subtle backlit atmospheric motes) based on shot prompt + real pixel thermal measurement.
 */
export function classifyPhotorealisticFxProfile(
  promptText: string,
  moltenPixelRatio: number
): PhotorealisticFxProfile {
  const p = (promptText || "").toLowerCase();
  if (
    moltenPixelRatio >= 0.015 ||
    /furnace|molten|billet|foundry|rolling\s*mill|piercing|forge|spark|ember|fire|flame|کوره|گداخته|شمش|ذوب|غلتک|نورد|ریخته‌گری|جرقه|آتش/i.test(
      p
    )
  ) {
    return "molten_fire";
  }
  if (
    /boiler|steam|rupture|crack|pressure|leak|بویلر|بخار|ترک|شکاف|پارگی|انفجار\s*فشار/i.test(p)
  ) {
    return "pressurized_steam";
  }
  if (
    /refinery|petrochemical|flare|distillation|night|twilight|پالایشگاه|پتروشیمی|تقطیر|مشعل/i.test(p)
  ) {
    return "refinery_night";
  }
  if (
    /pipe|steel|flange|manifold|valve|factory|metal|astm|api|لوله|فولاد|فلنج|منیفولد|شیر|صنعت|کارخانه/i.test(
      p
    )
  ) {
    return "industrial_clean";
  }
  return "ambient_cinema";
}

/**
 * Pure RGB buffer scanner: extracts molten/incandescent hotspots (and fallback highlight vents)
 * directly from raw RGB24 pixels so WebGL2 sparks and heat shimmer erupt from the ACTUAL glowing
 * regions of the real photograph.
 */
export function detectHotspotsFromRgbBuffer(
  rgb: Uint8Array,
  sampleW: number,
  sampleH: number,
  promptText: string
): KeyframeThermalAnalysis {
  const totalPixels = Math.max(1, sampleW * sampleH);
  let moltenCount = 0;
  let brightCount = 0;

  // Divide image into an 8x12 coarse grid to avoid clustering all hotspots in one pixel
  const gridCols = 8;
  const gridRows = 12;
  const moltenCells: Array<{ u: number; v: number; score: number }> = [];
  const brightCells: Array<{ u: number; v: number; score: number }> = [];

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      moltenCells.push({ u: (gx + 0.5) / gridCols, v: 1 - (gy + 0.5) / gridRows, score: 0 });
      brightCells.push({ u: (gx + 0.5) / gridCols, v: 1 - (gy + 0.5) / gridRows, score: 0 });
    }
  }

  for (let y = 0; y < sampleH; y++) {
    for (let x = 0; x < sampleW; x++) {
      const idx = (y * sampleW + x) * 3;
      const r = rgb[idx] || 0;
      const g = rgb[idx + 1] || 0;
      const b = rgb[idx + 2] || 0;

      const gx = Math.min(gridCols - 1, Math.floor((x / sampleW) * gridCols));
      const gy = Math.min(gridRows - 1, Math.floor((y / sampleH) * gridRows));
      const cIdx = gy * gridCols + gx;

      // Incandescent molten metal / flame / orange-white furnace glow
      const warmth = r - b;
      const isMolten = r >= 165 && warmth >= 55 && r > b * 1.42 && g >= 60;
      if (isMolten) {
        moltenCount++;
        const score = (r / 255) * 0.55 + (warmth / 255) * 0.45;
        if (score > moltenCells[cIdx].score) {
          moltenCells[cIdx] = {
            u: (x + 0.5) / sampleW,
            v: 1 - (y + 0.5) / sampleH,
            score,
          };
        }
      }

      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (luma >= 0.72) {
        brightCount++;
        if (luma > brightCells[cIdx].score) {
          brightCells[cIdx] = {
            u: (x + 0.5) / sampleW,
            v: 1 - (y + 0.5) / sampleH,
            score: luma,
          };
        }
      }
    }
  }

  const moltenPixelRatio = moltenCount / totalPixels;
  const brightPixelRatio = brightCount / totalPixels;
  const fxProfile = classifyPhotorealisticFxProfile(promptText, moltenPixelRatio);

  const topMolten = moltenCells
    .filter((c) => c.score > 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map((c) => ({ u: c.u, v: c.v, intensity: Math.min(1, c.score) }));

  const topBright = brightCells
    .filter((c) => c.score > 0.72)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((c) => ({ u: c.u, v: c.v, intensity: Math.min(1, c.score) }));

  let hotspots = topMolten.length >= 3 ? topMolten : topBright;
  if (hotspots.length === 0) {
    // Sensible natural focal anchors in mid-lower frame
    hotspots = [
      { u: 0.42, v: 0.45, intensity: 0.6 },
      { u: 0.58, v: 0.48, intensity: 0.6 },
      { u: 0.50, v: 0.38, intensity: 0.55 },
    ];
  }

  return {
    fxProfile,
    hotspots,
    moltenPixelRatio: Math.round(moltenPixelRatio * 10000) / 10000,
    brightPixelRatio: Math.round(brightPixelRatio * 10000) / 10000,
  };
}

/**
 * Downsamples keyframe via FFmpeg to 96x96 RGB24 and extracts thermal/hotspot data in <80ms.
 */
export async function analyzeKeyframeThermalHotspots(
  keyframePngPath: string,
  promptText: string
): Promise<KeyframeThermalAnalysis> {
  const sampleW = 96;
  const sampleH = 96;
  const { stdout } = await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      keyframePngPath,
      "-vf",
      `scale=${sampleW}:${sampleH}:flags=bilinear,format=rgb24`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 10_000 }
  );
  return detectHotspotsFromRgbBuffer(
    new Uint8Array(stdout as unknown as Buffer),
    sampleW,
    sampleH,
    promptText
  );
}

/**
 * Generates a smooth structural depth map from the real photograph combining:
 *  - Natural ground/foreground vertical perspective gradient (bottom closer, upper sky/ceiling farther)
 *  - Smooth Sobel structural foreground salience (pipes, rollers, machinery stand proud in 3D relief)
 *  - Heavy Gaussian smoothing so the displaced 3D mesh NEVER tears or causes double-vision ghosting.
 */
export async function generateSmooth3DReliefDepthMap(params: {
  keyframePngPath: string;
  depthMapPath: string;
  width: number;
  height: number;
}): Promise<void> {
  const { keyframePngPath, depthMapPath, width, height } = params;
  fs.mkdirSync(path.dirname(depthMapPath), { recursive: true });

  // Render depth map at lightweight 256px scale then upscale smoothly for fast execution (<120ms)
  const dw = width > height ? 320 : 180;
  const dh = width > height ? 180 : 320;

  const filterComplex = [
    `[0:v]scale=${dw}:${dh}:flags=bilinear,format=gray,split=2[g1][g2]`,
    `[g1]sobel=scale=2.2:delta=18,gblur=sigma=8[edge]`,
    `[g2]gblur=sigma=12,geq=lum='clip(0.42*p(X,Y) + 0.58*(255*(Y/H)), 0, 255)'[ramp]`,
    `[ramp][edge]blend=all_mode=addition:all_opacity=0.45,gblur=sigma=10,curves=all='0/0.05 0.5/0.48 1/0.98',scale=${width}:${height}:flags=bilinear,format=gray[out]`,
  ].join(";");

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      keyframePngPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[out]",
      "-frames:v",
      "1",
      depthMapPath,
    ],
    { timeout: 15_000 }
  );
}

/**
 * Builds the 48kHz stereo domain-matched diegetic foley audio filtergraph tailored to the shot's physical world.
 */
export function buildPhotorealisticFoleyAudioFilter(
  fxProfile: PhotorealisticFxProfile,
  durationSec: number
): string {
  const dur = durationSec.toFixed(2);
  const fadeOutStart = Math.max(0.25, durationSec - 0.35).toFixed(2);
  const tail = `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.30,afade=t=out:st=${fadeOutStart}:d=0.35[aout]`;

  if (fxProfile === "molten_fire") {
    return (
      `anoisesrc=color=brown:sample_rate=48000:duration=${dur},bandpass=f=115:width_type=h:width=170,tremolo=f=3.8:d=0.38,volume=0.42[roar];` +
      `anoisesrc=color=white:sample_rate=48000:duration=${dur},bandpass=f=3600:width_type=h:width=2200,tremolo=f=13.5:d=0.72,volume=0.048[sparks];` +
      `sine=frequency=52:sample_rate=48000:duration=${dur},tremolo=f=1.6:d=0.25,volume=0.09[roller];` +
      `[roar][sparks][roller]amix=inputs=3:duration=first,${tail}`
    );
  }
  if (fxProfile === "pressurized_steam") {
    return (
      `anoisesrc=color=pink:sample_rate=48000:duration=${dur},bandpass=f=2100:width_type=h:width=1600,tremolo=f=2.4:d=0.42,volume=0.22[hiss];` +
      `anoisesrc=color=brown:sample_rate=48000:duration=${dur},lowpass=f=190,volume=0.32[boiler];` +
      `sine=frequency=68:sample_rate=48000:duration=${dur},volume=0.06[pipe];` +
      `[hiss][boiler][pipe]amix=inputs=3:duration=first,${tail}`
    );
  }
  if (fxProfile === "refinery_night") {
    return (
      `anoisesrc=color=brown:sample_rate=48000:duration=${dur},lowpass=f=220,tremolo=f=0.9:d=0.25,volume=0.32[wind];` +
      `sine=frequency=56:sample_rate=48000:duration=${dur},volume=0.07[turbine];` +
      `anoisesrc=color=pink:sample_rate=48000:duration=${dur},bandpass=f=900:width_type=h:width=500,tremolo=f=5.0:d=0.35,volume=0.04[flare];` +
      `[wind][turbine][flare]amix=inputs=3:duration=first,${tail}`
    );
  }
  if (fxProfile === "industrial_clean") {
    return (
      `anoisesrc=color=brown:sample_rate=48000:duration=${dur},lowpass=f=240,volume=0.24[room];` +
      `sine=frequency=60:sample_rate=48000:duration=${dur},volume=0.05[hum];` +
      `[room][hum]amix=inputs=2:duration=first,${tail}`
    );
  }
  return `anoisesrc=color=pink:sample_rate=48000:duration=${dur},lowpass=f=280,volume=0.12,${tail}`;
}

let sharedMotionBrowser: Browser | null = null;
let sharedMotionPage: Page | null = null;

export async function closePhotorealisticMotionBrowser(): Promise<void> {
  try {
    if (sharedMotionPage && !sharedMotionPage.isClosed()) {
      await sharedMotionPage.close();
    }
  } catch {
    // ignore
  }
  try {
    if (sharedMotionBrowser && sharedMotionBrowser.isConnected()) {
      await sharedMotionBrowser.close();
    }
  } catch {
    // ignore
  }
  sharedMotionPage = null;
  sharedMotionBrowser = null;
}

async function getPhotorealisticWebGL2Page(): Promise<Page> {
  if (sharedMotionBrowser && sharedMotionBrowser.isConnected() && sharedMotionPage && !sharedMotionPage.isClosed()) {
    return sharedMotionPage;
  }

  const executablePath = findHeadlessChromiumPath();
  sharedMotionBrowser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });

  sharedMotionPage = await sharedMotionBrowser.newPage({ viewport: { width: 480, height: 854 } });
  await sharedMotionPage.setContent(buildPhotorealisticWebGL2HostHtml(), { waitUntil: "domcontentloaded" });
  return sharedMotionPage;
}

/**
 * Self-contained Single-Pass WebGL2 GLSL 3D Relief Real-Photo Cinema Host:
 *  - Displaces a 96x96 perspective mesh using the real photograph's structural depth map
 *    for genuine 3D foreground/background camera parallax with ZERO double-vision ghosting.
 *  - Applies rising convective optical heat-shimmer refraction ONLY over hot glowing regions.
 *  - Adds dynamic furnace firelight flicker + subtle single-pass warm highlight bloom.
 *  - Layers procedural 3-octave curled volumetric smoke / pressurized steam tinted to the scene.
 *  - Emits hotspot-anchored 3D gravity sparks & glowing ember streaks erupting directly from
 *    the photograph's real incandescent pixels!
 */
function buildPhotorealisticWebGL2HostHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>html,body{margin:0;padding:0;overflow:hidden;background:#000;}canvas{display:block;}</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
(() => {
  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  if (!gl) {
    window.__initError = 'WebGL2 unavailable';
    return;
  }

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || 'Shader compile error');
    }
    return s;
  }

  function createProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || 'Program link error');
    }
    return p;
  }

  // ----- PASS 1: 3D Depth-Displaced Real Photograph + Heat Shimmer + Volumetric Smoke + Grain -----
  const meshVS = \`#version 300 es
  precision highp float;
  in vec2 aPos;   // -1..1
  in vec2 aUv;    // 0..1

  uniform sampler2D uDepthTex;
  uniform float uAspect;
  uniform float uRelief;
  uniform vec3 uCamPos;
  uniform vec3 uCamTarget;
  uniform float uFovScale;

  out vec2 vUv;
  out float vDepth;

  void main() {
    float d = texture(uDepthTex, aUv).r;
    vUv = aUv;
    vDepth = d;

    // World plane oversized slightly (1.22x) so perspective shifts NEVER reveal edges
    vec3 worldPos = vec3(
      aPos.x * 1.24 * uAspect,
      aPos.y * 1.24,
      (d - 0.5) * uRelief
    );

    // Camera lookAt basis
    vec3 fwd = normalize(uCamTarget - uCamPos);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);

    vec3 rel = worldPos - uCamPos;
    float cx = dot(rel, right);
    float cy = dot(rel, up);
    float cz = max(0.25, dot(rel, fwd));

    float ndcX = (cx * uFovScale) / (cz * uAspect);
    float ndcY = (cy * uFovScale) / cz;
    float ndcZ = (cz - 2.2) * 0.25;

    gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
  }
  \`;

  const meshFS = \`#version 300 es
  precision highp float;

  in vec2 vUv;
  in float vDepth;

  uniform sampler2D uPhotoTex;
  uniform float uTime;
  uniform float uHeatStrength;
  uniform float uSmokeStrength;
  uniform float uFlickerStrength;
  uniform vec3 uSmokeColor;
  uniform vec2 uResolution;

  out vec4 fragColor;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = rot * p * 2.05;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = clamp(vUv, vec2(0.002), vec2(0.998));

    // Sample base photo slightly below current UV to detect rising heat plumes ABOVE hot molten zones
    vec3 belowCol = texture(uPhotoTex, clamp(uv - vec2(0.0, 0.035), vec2(0.002), vec2(0.998))).rgb;
    vec3 baseCol = texture(uPhotoTex, uv).rgb;
    float hotLocal = smoothstep(0.16, 0.52, baseCol.r - baseCol.b * 1.15) * smoothstep(0.42, 0.82, baseCol.r);
    float hotBelow = smoothstep(0.14, 0.48, belowCol.r - belowCol.b * 1.15) * smoothstep(0.38, 0.78, belowCol.r);
    float heatMask = max(hotLocal, hotBelow * 0.92);

    // Convective rising heat shimmer refraction (physically active ONLY over glowing hot areas)
    vec2 shimmerUv = uv;
    if (uHeatStrength > 0.001 && heatMask > 0.01) {
      float w1 = sin(uv.y * 62.0 - uTime * 9.5 + uv.x * 16.0);
      float w2 = cos(uv.y * 94.0 - uTime * 13.2 - uv.x * 24.0);
      float disp = uHeatStrength * heatMask;
      shimmerUv.x += w1 * 0.0038 * disp;
      shimmerUv.y += w2 * 0.0022 * disp;
    }

    vec3 col = texture(uPhotoTex, clamp(shimmerUv, vec2(0.002), vec2(0.998))).rgb;

    // Lightweight single-pass warm highlight bloom around molten/bright zones
    vec2 px = 2.6 / uResolution;
    vec3 glow = vec3(0.0);
    glow += max(vec3(0.0), texture(uPhotoTex, clamp(shimmerUv + vec2(px.x, 0.0), 0.002, 0.998)).rgb - 0.62);
    glow += max(vec3(0.0), texture(uPhotoTex, clamp(shimmerUv - vec2(px.x, 0.0), 0.002, 0.998)).rgb - 0.62);
    glow += max(vec3(0.0), texture(uPhotoTex, clamp(shimmerUv + vec2(0.0, px.y), 0.002, 0.998)).rgb - 0.62);
    glow += max(vec3(0.0), texture(uPhotoTex, clamp(shimmerUv - vec2(0.0, px.y), 0.002, 0.998)).rgb - 0.62);
    glow *= 0.25;

    // Realistic low-frequency furnace / industrial lighting flicker
    float flicker = 1.0 + uFlickerStrength * (0.62 * sin(uTime * 6.4) * cos(uTime * 2.9) + 0.38 * sin(uTime * 11.7));
    col += glow * (0.42 * flicker + heatMask * 0.28);
    col *= mix(1.0, flicker, 0.22 + heatMask * 0.35);

    // Depth-layered rising volumetric smoke / pressurized steam plumes
    if (uSmokeStrength > 0.001) {
      vec2 sUv1 = vec2(uv.x * 2.6 + sin(uTime * 0.45 + uv.y * 2.5) * 0.14, uv.y * 2.2 - uTime * 0.24);
      vec2 sUv2 = vec2(uv.x * 4.4 - cos(uTime * 0.35 + uv.y * 3.1) * 0.12, uv.y * 3.6 - uTime * 0.38);
      float n1 = fbm3(sUv1);
      float n2 = fbm3(sUv2);
      float plume = smoothstep(0.42, 0.88, n1 * 0.62 + n2 * 0.38);
      // Concentrate smoke/steam more in upper 75% and softly around foreground depth transitions
      float verticalEnvelope = smoothstep(0.04, 0.42, uv.y) * (1.0 - smoothstep(0.86, 1.0, uv.y) * 0.25);
      float smokeAmt = plume * verticalEnvelope * uSmokeStrength * (0.72 + (1.0 - vDepth) * 0.40);
      // Tint smoke subtly by local firelight glow so it looks physically integrated into the real room
      vec3 litSmoke = mix(uSmokeColor, uSmokeColor * vec3(1.35, 0.92, 0.58) + vec3(0.28, 0.12, 0.03), heatMask * 0.78);
      col = mix(col, max(col, litSmoke), clamp(smokeAmt, 0.0, 0.42));
    }

    // Subtle 35mm organic film grain (time-varying so static surfaces feel like real cinema film)
    float grain = (hash21(uv * uResolution + vec2(uTime * 97.3, uTime * 43.1)) - 0.5) * 0.026;
    col += grain;

    // Gentle anamorphic edge vignette
    vec2 vig = (uv - 0.5) * vec2(1.15, 1.05);
    float vMask = 1.0 - dot(vig, vig) * 0.42;
    col *= clamp(vMask, 0.62, 1.0);

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
  \`;

  // ----- PASS 2: Hotspot-Anchored 3D Ballistic Sparks / Embers / Atmospheric Motes -----
  const sparkVS = \`#version 300 es
  precision highp float;
  in vec2 aCorner;      // -1..1 quad corners
  in vec4 aOriginVel;   // xy = spawn UV (0..1), zw = velocity UV/s
  in vec4 aLifeParams;  // x = phase, y = lifeSec, z = sizePx, w = kind (0=spark, 1=mote)

  uniform float uTime;
  uniform float uGravity;
  uniform vec2 uResolution;
  uniform vec2 uCamOffset;

  out vec2 vLocal;
  out float vAlpha;
  out float vTemp;
  out float vKind;

  void main() {
    float life = max(0.35, aLifeParams.y);
    float age = mod(uTime + aLifeParams.x, life);
    float normAge = age / life;

    vec2 vel = aOriginVel.zw;
    vec2 pos = aOriginVel.xy + vel * age;
    // Gravity arc + subtle lateral air turbulence
    pos.y -= 0.5 * uGravity * age * age;
    pos.x += sin(uTime * 3.1 + aLifeParams.x * 11.0) * 0.012 * age;

    // Floor bounce for sparks
    if (aLifeParams.w < 0.5 && pos.y < 0.04) {
      pos.y = 0.04 + abs(0.04 - pos.y) * 0.45;
    }

    // Subtle parallax shift synced to camera
    pos += uCamOffset * (aLifeParams.w < 0.5 ? 0.55 : 0.35);

    vec2 curVel = vec2(vel.x, vel.y - uGravity * age);
    float speed = length(curVel);
    vec2 dir = speed > 0.001 ? curVel / speed : vec2(0.0, 1.0);
    vec2 perp = vec2(-dir.y, dir.x);

    float pxSize = aLifeParams.z * (1.0 - normAge * 0.45);
    float streakLen = aLifeParams.w < 0.5 ? pxSize * (1.9 + clamp(speed * 7.5, 0.0, 6.5)) : pxSize;

    vec2 offsetPx = dir * (aCorner.x * streakLen) + perp * (aCorner.y * pxSize);
    vec2 ndcPos = pos * 2.0 - 1.0 + (offsetPx * 2.0) / uResolution;

    vLocal = aCorner;
    vAlpha = sin(normAge * 3.14159265) * (1.0 - normAge * 0.25);
    vTemp = 1.0 - normAge;
    vKind = aLifeParams.w;

    gl_Position = vec4(ndcPos, 0.0, 1.0);
  }
  \`;

  const sparkFS = \`#version 300 es
  precision highp float;
  in vec2 vLocal;
  in float vAlpha;
  in float vTemp;
  in float vKind;

  out vec4 fragColor;

  void main() {
    float r2 = dot(vLocal, vLocal);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 4.2);

    vec3 col;
    if (vKind < 0.5) {
      // Hot white-yellow core cooling to deep glowing orange-amber
      vec3 hotCol = vec3(1.0, 0.96, 0.80);
      vec3 midCol = vec3(1.0, 0.54, 0.12);
      vec3 coolCol = vec3(0.88, 0.22, 0.04);
      col = mix(coolCol, mix(midCol, hotCol, smoothstep(0.45, 0.95, vTemp)), vTemp);
      fragColor = vec4(col * core * 1.45, core * vAlpha * 0.92);
    } else {
      // Soft backlit atmospheric mist/dust mote
      col = vec3(0.85, 0.90, 0.95);
      fragColor = vec4(col * core * 0.45, core * vAlpha * 0.34);
    }
  }
  \`;

  const meshProg = createProgram(meshVS, meshFS);
  const sparkProg = createProgram(sparkVS, sparkFS);

  // Build 96x96 subdivided mesh geometry once
  const GRID = 96;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let y = 0; y <= GRID; y++) {
    for (let x = 0; x <= GRID; x++) {
      const u = x / GRID;
      const v = y / GRID;
      positions.push(u * 2 - 1, v * 2 - 1);
      uvs.push(u, v);
    }
  }
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const a = y * (GRID + 1) + x;
      const b = a + 1;
      const c = a + (GRID + 1);
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const meshVao = gl.createVertexArray();
  gl.bindVertexArray(meshVao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  const aPosLoc = gl.getAttribLocation(meshProg, 'aPos');
  gl.enableVertexAttribArray(aPosLoc);
  gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  const aUvLoc = gl.getAttribLocation(meshProg, 'aUv');
  gl.enableVertexAttribArray(aUvLoc);
  gl.vertexAttribPointer(aUvLoc, 2, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
  const meshIndexCount = indices.length;

  // Spark instanced VAO
  const sparkVao = gl.createVertexArray();
  gl.bindVertexArray(sparkVao);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
  const aCornerLoc = gl.getAttribLocation(sparkProg, 'aCorner');
  gl.enableVertexAttribArray(aCornerLoc);
  gl.vertexAttribPointer(aCornerLoc, 2, gl.FLOAT, false, 0, 0);

  const originVelBuf = gl.createBuffer();
  const lifeParamsBuf = gl.createBuffer();
  let sparkCount = 0;

  let photoTex = null;
  let depthTex = null;
  let sceneCfg = null;
  let readbackBuf = null;

  function loadImageTexture(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        resolve(tex);
      };
      img.onerror = () => reject(new Error('Failed to decode texture image'));
      img.src = dataUrl;
    });
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  window.__setupPhotoCinema = async (cfg) => {
    sceneCfg = cfg;
    canvas.width = cfg.renderW;
    canvas.height = cfg.renderH;
    gl.viewport(0, 0, cfg.renderW, cfg.renderH);
    readbackBuf = new Uint8Array(cfg.renderW * cfg.renderH * 4);

    if (photoTex) gl.deleteTexture(photoTex);
    if (depthTex) gl.deleteTexture(depthTex);

    photoTex = await loadImageTexture(cfg.photoDataUrl);
    depthTex = await loadImageTexture(cfg.depthDataUrl);

    // Build hotspot-anchored sparks + floating atmospheric motes
    const rng = mulberry32(cfg.seed || 1337);
    const hotspots = cfg.hotspots && cfg.hotspots.length ? cfg.hotspots : [{ u: 0.5, v: 0.45, intensity: 0.7 }];
    const isMolten = cfg.fxProfile === 'molten_fire';
    const isRefinery = cfg.fxProfile === 'refinery_night';
    const isSteam = cfg.fxProfile === 'pressurized_steam';

    const numSparks = isMolten ? 84 : isRefinery ? 28 : 0;
    const numMotes = isSteam ? 42 : 24;
    sparkCount = numSparks + numMotes;

    const ovData = new Float32Array(sparkCount * 4);
    const lpData = new Float32Array(sparkCount * 4);

    for (let i = 0; i < numSparks; i++) {
      const hs = hotspots[i % hotspots.length];
      const u = Math.min(0.95, Math.max(0.05, hs.u + (rng() - 0.5) * 0.14));
      const v = Math.min(0.92, Math.max(0.08, hs.v + (rng() - 0.5) * 0.10));
      const angle = (rng() - 0.5) * 2.2;
      const spd = 0.08 + rng() * 0.24;
      const vx = Math.sin(angle) * spd;
      const vy = (isMolten ? 0.12 : 0.08) + Math.cos(angle) * spd * 0.75;
      ovData[i * 4 + 0] = u;
      ovData[i * 4 + 1] = v;
      ovData[i * 4 + 2] = vx;
      ovData[i * 4 + 3] = vy;

      lpData[i * 4 + 0] = rng() * 3.5;              // phase
      lpData[i * 4 + 1] = 1.1 + rng() * 1.9;        // life
      lpData[i * 4 + 2] = 1.6 + rng() * 2.4;        // px radius
      lpData[i * 4 + 3] = 0.0;                      // kind = spark
    }

    for (let j = 0; j < numMotes; j++) {
      const i = numSparks + j;
      ovData[i * 4 + 0] = rng();
      ovData[i * 4 + 1] = rng();
      ovData[i * 4 + 2] = (rng() - 0.5) * 0.025;
      ovData[i * 4 + 3] = (isSteam ? 0.06 : 0.022) + rng() * 0.035;

      lpData[i * 4 + 0] = rng() * 5.0;
      lpData[i * 4 + 1] = 2.8 + rng() * 2.4;
      lpData[i * 4 + 2] = isSteam ? 2.4 + rng() * 3.2 : 1.5 + rng() * 2.0;
      lpData[i * 4 + 3] = 1.0; // kind = mote
    }

    gl.bindVertexArray(sparkVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, originVelBuf);
    gl.bufferData(gl.ARRAY_BUFFER, ovData, gl.STATIC_DRAW);
    const aOvLoc = gl.getAttribLocation(sparkProg, 'aOriginVel');
    gl.enableVertexAttribArray(aOvLoc);
    gl.vertexAttribPointer(aOvLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aOvLoc, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, lifeParamsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lpData, gl.STATIC_DRAW);
    const aLpLoc = gl.getAttribLocation(sparkProg, 'aLifeParams');
    gl.enableVertexAttribArray(aLpLoc);
    gl.vertexAttribPointer(aLpLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aLpLoc, 1);

    return { ok: true, sparkCount };
  };

  window.__renderFrameRgbaBase64 = (timeSec, progress01) => {
    const cfg = sceneCfg;
    const W = cfg.renderW;
    const H = cfg.renderH;
    const aspect = W / H;

    // Smooth cinematic 3D camera kinematics + natural handheld breathing
    const ease = progress01 * progress01 * (3.0 - 2.0 * progress01);
    const breathX = Math.sin(timeSec * 1.45) * 0.008 + Math.cos(timeSec * 2.7) * 0.003;
    const breathY = Math.cos(timeSec * 1.2) * 0.007;

    let camX = breathX;
    let camY = breathY;
    let camZ = 2.18;
    let tgtX = 0.0;
    let tgtY = 0.0;

    if (cfg.cameraMotion === 'pan') {
      const dir = (cfg.shotNumber % 2 === 0) ? 1 : -1;
      camX = dir * (-0.15 + ease * 0.30) + breathX;
      camY = 0.02 - ease * 0.04 + breathY;
      camZ = 2.10 - ease * 0.16;
      tgtX = camX * 0.35;
      tgtY = camY * 0.25;
    } else if (cfg.cameraMotion === 'orbit') {
      const ang = -0.14 + ease * 0.28;
      camX = Math.sin(ang) * 0.42 + breathX;
      camY = -0.05 + ease * 0.10 + breathY;
      camZ = 2.12 - Math.abs(Math.sin(ang)) * 0.12 - ease * 0.14;
      tgtX = -camX * 0.12;
      tgtY = 0.0;
    } else {
      // Dramatic dolly push-in with subtle elevation tilt
      camX = (-0.04 + ease * 0.08) + breathX;
      camY = (-0.03 + ease * 0.06) + breathY;
      camZ = 2.22 - ease * 0.34;
      tgtX = camX * 0.22;
      tgtY = camY * 0.22;
    }

    gl.clearColor(0.02, 0.03, 0.04, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Pass 1: Displaced real photo mesh
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(meshProg);
    gl.bindVertexArray(meshVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, photoTex);
    gl.uniform1i(gl.getUniformLocation(meshProg, 'uPhotoTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.uniform1i(gl.getUniformLocation(meshProg, 'uDepthTex'), 1);

    gl.uniform1f(gl.getUniformLocation(meshProg, 'uAspect'), aspect);
    gl.uniform1f(gl.getUniformLocation(meshProg, 'uRelief'), cfg.reliefStrength);
    gl.uniform3f(gl.getUniformLocation(meshProg, 'uCamPos'), camX, camY, camZ);
    gl.uniform3f(gl.getUniformLocation(meshProg, 'uCamTarget'), tgtX, tgtY, 0.0);
    gl.uniform1f(gl.getUniformLocation(meshProg, 'uFovScale'), 1.98);
    gl.uniform1f(gl.getUniformLocation(meshProg, 'uTime'), timeSec);
    gl.uniform1f(gl.getUniformLocation(meshProg, 'uHeatStrength'), cfg.heatStrength);
    gl.uniform1f(gl.getUniformLocation(meshProg, 'uSmokeStrength'), cfg.smokeStrength);
    gl.uniform1f(gl.getUniformLocation(meshProg, 'uFlickerStrength'), cfg.flickerStrength);
    gl.uniform3f(gl.getUniformLocation(meshProg, 'uSmokeColor'), cfg.smokeColor[0], cfg.smokeColor[1], cfg.smokeColor[2]);
    gl.uniform2f(gl.getUniformLocation(meshProg, 'uResolution'), W, H);

    gl.drawElements(gl.TRIANGLES, meshIndexCount, gl.UNSIGNED_INT, 0);

    // Pass 2: Additive 3D hotspot sparks & drifting motes
    if (sparkCount > 0) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(sparkProg);
      gl.bindVertexArray(sparkVao);

      gl.uniform1f(gl.getUniformLocation(sparkProg, 'uTime'), timeSec);
      gl.uniform1f(gl.getUniformLocation(sparkProg, 'uGravity'), cfg.fxProfile === 'molten_fire' ? 0.26 : 0.06);
      gl.uniform2f(gl.getUniformLocation(sparkProg, 'uResolution'), W, H);
      gl.uniform2f(gl.getUniformLocation(sparkProg, 'uCamOffset'), -camX * 0.25, -camY * 0.25);

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, sparkCount);
    }

    gl.finish();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, readbackBuf);

    // Fast chunked base64 encode (WebGL readPixels is bottom-up; FFmpeg vflip flips cleanly at zero JS cost!)
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < readbackBuf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, readbackBuf.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  };
})();
</script>
</body>
</html>`;
}

/**
 * Renders any photorealistic photograph (from Gemini Image or Wikimedia/Openverse Real Media Curator)
 * into a living 24fps 3D depth-displaced cinema MP4 with optical heat-shimmer, hotspot-anchored
 * ballistic sparks, volumetric rising smoke/steam, 35mm organic film grain, and 48kHz stereo foley audio.
 */
export async function renderPhotorealisticCinemaVideoMp4(
  req: PhotorealisticMotionRequest
): Promise<PhotorealisticMotionResult> {
  const started = Date.now();
  const durationSec = Math.max(3, Math.min(15, req.durationSec || 5));
  const fps = req.fps || 24;
  const totalFrames = Math.max(24, Math.round(durationSec * fps));
  const outW = req.width || 720;
  const outH = req.height || 1280;

  // Render internal WebGL2 at 480x854 (9:16) or 854x480 (16:9) for ~6x CPU SwiftShader speedup,
  // then Lanczos upscale + unsharp to crisp 720x1280/1280x720 in FFmpeg!
  const renderW = outW > outH ? Math.min(outW, 854) : Math.min(outW, 480);
  const renderH = outW > outH ? Math.min(outH, 480) : Math.min(outH, 854);

  const outDir = path.dirname(req.outputPath);
  fs.mkdirSync(outDir, { recursive: true });
  const tmpDir = path.join(outDir, `.photo_motion_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const normKeyPath = path.join(tmpDir, "keyframe_norm.png");
  const depthPath = req.depthMapOutPath || path.join(tmpDir, "depth_map.png");

  try {
    // 1. Normalize input real photo edge-to-edge
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        req.keyframePath,
        "-vf",
        `scale=${outW}:${outH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${outW}:${outH},format=rgb24`,
        "-frames:v",
        "1",
        normKeyPath,
      ],
      { timeout: 15_000 }
    );

    // 2. Analyze thermal hotspots + build smooth 3D relief depth map in parallel
    const [thermal, _depthDone] = await Promise.all([
      analyzeKeyframeThermalHotspots(normKeyPath, req.prompt),
      generateSmooth3DReliefDepthMap({
        keyframePngPath: normKeyPath,
        depthMapPath: depthPath,
        width: renderW,
        height: renderH,
      }),
    ]);

    // Also create a WebGL-sized JPEG data URL for instant browser texture upload
    const texPhotoPath = path.join(tmpDir, "tex_photo.jpg");
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        normKeyPath,
        "-vf",
        `scale=${renderW}:${renderH}:flags=lanczos`,
        "-q:v",
        "2",
        "-frames:v",
        "1",
        texPhotoPath,
      ],
      { timeout: 10_000 }
    );

    const photoDataUrl = `data:image/jpeg;base64,${fs.readFileSync(texPhotoPath).toString("base64")}`;
    const depthDataUrl = `data:image/png;base64,${fs.readFileSync(depthPath).toString("base64")}`;

    const fxProfile = thermal.fxProfile;
    const fxSettings =
      fxProfile === "molten_fire"
        ? {
            reliefStrength: 0.30,
            heatStrength: 1.0,
            smokeStrength: 0.30,
            flickerStrength: 0.14,
            smokeColor: [0.42, 0.28, 0.18],
          }
        : fxProfile === "pressurized_steam"
          ? {
              reliefStrength: 0.28,
              heatStrength: 0.25,
              smokeStrength: 0.36,
              flickerStrength: 0.05,
              smokeColor: [0.76, 0.82, 0.88],
            }
          : fxProfile === "refinery_night"
            ? {
                reliefStrength: 0.30,
                heatStrength: 0.65,
                smokeStrength: 0.24,
                flickerStrength: 0.10,
                smokeColor: [0.22, 0.30, 0.38],
              }
            : fxProfile === "industrial_clean"
              ? {
                  reliefStrength: 0.28,
                  heatStrength: 0.12,
                  smokeStrength: 0.16,
                  flickerStrength: 0.04,
                  smokeColor: [0.48, 0.54, 0.60],
                }
              : {
                  reliefStrength: 0.24,
                  heatStrength: 0.0,
                  smokeStrength: 0.10,
                  flickerStrength: 0.03,
                  smokeColor: [0.55, 0.58, 0.62],
                };

    const page = await getPhotorealisticWebGL2Page();
    await page.setViewportSize({ width: renderW, height: renderH });
    await page.evaluate(
      async (cfg) => {
        // @ts-expect-error injected host helper
        await window.__setupPhotoCinema(cfg);
      },
      {
        renderW,
        renderH,
        photoDataUrl,
        depthDataUrl,
        fxProfile,
        hotspots: thermal.hotspots,
        cameraMotion: req.cameraMotion || "push-in",
        shotNumber: req.shotNumber || 1,
        seed: (req.shotNumber || 1) * 7919 + 42,
        ...fxSettings,
      }
    );

    const audioFilter = buildPhotorealisticFoleyAudioFilter(fxProfile, durationSec);
    const scaleChain =
      renderW !== outW || renderH !== outH
        ? `vflip,scale=${outW}:${outH}:flags=lanczos,unsharp=3:3:0.25:3:3:0.0,format=yuv420p[vout]`
        : `vflip,format=yuv420p[vout]`;

    const ffmpegArgs = [
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${renderW}x${renderH}`,
      "-r",
      String(fps),
      "-i",
      "pipe:0",
      "-filter_complex",
      `[0:v]${scaleChain};${audioFilter}`,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-t",
      durationSec.toFixed(2),
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "16",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      req.outputPath,
    ];

    const ff = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "ignore", "pipe"] });
    let ffErr = "";
    ff.stderr.on("data", (d) => {
      ffErr += d.toString();
    });

    const ffDone = new Promise<void>((resolve, reject) => {
      ff.on("error", reject);
      ff.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg photorealistic motion encode failed (${code}): ${ffErr.slice(-400)}`));
      });
    });

    for (let f = 0; f < totalFrames; f++) {
      const timeSec = f / fps;
      const progress01 = totalFrames > 1 ? f / (totalFrames - 1) : 0;
      const b64 = await page.evaluate(
        ({ t, p }) => {
          // @ts-expect-error injected host helper
          return window.__renderFrameRgbaBase64(t, p) as string;
        },
        { t: timeSec, p: progress01 }
      );
      const frameBuf = Buffer.from(b64, "base64");
      if (!ff.stdin.write(frameBuf)) {
        await new Promise<void>((r) => ff.stdin.once("drain", r));
      }
    }

    ff.stdin.end();
    await ffDone;

    return {
      outputPath: req.outputPath,
      depthMapPath: req.depthMapOutPath && fs.existsSync(req.depthMapOutPath) ? req.depthMapOutPath : null,
      fxProfile,
      hotspotsDetected: thermal.hotspots.length,
      framesRendered: totalFrames,
      renderDurationMs: Date.now() - started,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }
}
