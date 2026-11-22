import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type Page } from "playwright-core";
import type { CameraMotionKind } from "../../../src/types/videoPipeline.js";

const execFileAsync = promisify(execFile);

export type CinemaSceneArchetype =
  | "furnace_billet_extraction"
  | "welded_seam_rupture"
  | "rotary_piercing_mill"
  | "seamless_pipe_gliding"
  | "modern_refinery_pipelines"
  | "manifold_flanged_pipes"
  | "pipe_cross_section_inspection"
  | "hollow_billet_tunnel_pov"
  | "generic_cinematic";

export interface ProceduralSceneConfig {
  archetype: CinemaSceneArchetype;
  cameraMotion: CameraMotionKind;
  shotNumber: number;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  paletteMode: "teal_amber" | "steam_steel" | "refinery_night" | "forge_red";
}

export function classifyCinemaSceneArchetype(
  promptText: string,
  shotNumber = 1
): CinemaSceneArchetype {
  const p = (promptText || "").toLowerCase();

  if (
    /hollow\s+(?:glowing\s+)?center|inside\s+(?:a\s+|the\s+)?(?:hollow|glowing|molten)\s+pipe|molten\s+tunnel|piercing\s+mandrel|\bpov\b|حفره\s*مرکزی|سمبه\s*سوراخ|درون\s*تونل/i.test(
      p
    )
  ) {
    return "hollow_billet_tunnel_pov";
  }
  if (
    /cross-section|beveled\s+cross|solid\s+wall\s+cross|monolithic.*grain|مقطع\s*برش|مقطع\s*لوله|لبه\s*لوله|داخلی\s*خالی|دیواره\s*ضخیم|ساختار\s*دانه‌بندی|پخ‌خورده/i.test(
      p
    )
  ) {
    return "pipe_cross_section_inspection";
  }
  if (
    /newly\s+formed\s+seamless|freshly\s+pierced.*gliding|gliding\s+smoothly|cooling\s+roller|zero\s+weld\s+seam|عاری\s*از.*خط\s*جوش|بدون\s*خط\s*جوش|بدون\s*درز|خروج\s*لوله.*بی‌نقص|خروج\s*لوله.*قالب|لوله.*بدون\s*درز|لغزش\s*لوله|ریل‌های\s*خنک‌کننده/i.test(
      p
    )
  ) {
    return "seamless_pipe_gliding";
  }
  if (
    /riveted\s+iron\s+pipe|weld(?:ed)?\s*(?:iron\s*)?(?:pipe\s*)?seam|hairline\s+crack|longitudinal\s+weld|boiler\s+room|درز\s*آن\s*شکافته|لوله\s*ترک‌خورده|خط\s*جوش|ترک\s*داغ|پارگی|پرچ‌کاری|انفجار\s*فشار/i.test(
      p
    )
  ) {
    return "welded_seam_rupture";
  }
  if (
    /rotary\s+piercing|angled\s+conical|conical\s+steel\s+roller|mannesmann.*roller|غلتک|قالب\s*مخروطی|فرم‌دهی\s*لوله|نورد\s*سوراخ|نورد\s*تاریخی/i.test(
      p
    )
  ) {
    return "rotary_piercing_mill";
  }
  if (
    /refinery|petrochemical|flare\s+stack|distillation|پالایشگاه|برج(?:‌های)?\s*تقطیر|مشعل\s*بلند|جنگل\s*برج/i.test(
      p
    )
  ) {
    return "modern_refinery_pipelines";
  }
  if (
    /manifold|flanged\s+valve|astm|api\s*5l|حک\s*شده|سطح\s*فلزی|زانویی|منیفولد|شیرهای\s*فلکی|اتصالات\s*فلنجی/i.test(
      p
    )
  ) {
    return "manifold_flanged_pipes";
  }
  if (
    /furnace|ironworks|foundry|tongs|billet|کوره|شمش|گداخته|انبر|ذوب/i.test(p)
  ) {
    return "furnace_billet_extraction";
  }
  if (/pipe|steel|فولاد|لوله|صنعت|کارخانه/i.test(p)) {
    const cycle: CinemaSceneArchetype[] = [
      "furnace_billet_extraction",
      "welded_seam_rupture",
      "rotary_piercing_mill",
      "seamless_pipe_gliding",
      "modern_refinery_pipelines",
      "manifold_flanged_pipes",
      "pipe_cross_section_inspection",
      "hollow_billet_tunnel_pov",
    ];
    return cycle[(Math.max(1, shotNumber) - 1) % cycle.length];
  }
  return "generic_cinematic";
}

export function findHeadlessChromiumPath(): string | undefined {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  try {
    const pwDir = "/ms-playwright";
    if (fs.existsSync(pwDir)) {
      const entries = fs.readdirSync(pwDir);
      for (const e of entries) {
        if (e.startsWith("chromium") || e.startsWith("chrome")) {
          const p1 = path.join(pwDir, e, "chrome-linux", "chrome");
          const p2 = path.join(pwDir, e, "chrome-headless-shell");
          if (fs.existsSync(p1)) return p1;
          if (fs.existsSync(p2)) return p2;
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

let sharedBrowserPromise: Promise<Browser> | null = null;

async function getSharedCinemaBrowser(): Promise<Browser> {
  if (sharedBrowserPromise) {
    try {
      const b = await sharedBrowserPromise;
      if (b.isConnected()) return b;
    } catch {
      sharedBrowserPromise = null;
    }
  }
  const executablePath = findHeadlessChromiumPath();
  sharedBrowserPromise = chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
    ],
  });
  return sharedBrowserPromise;
}

export async function closeSharedCinemaBrowser(): Promise<void> {
  if (!sharedBrowserPromise) return;
  try {
    const b = await sharedBrowserPromise;
    await b.close();
  } catch {
    // ignore
  } finally {
    sharedBrowserPromise = null;
  }
}

const threeAssetCache = new Map<string, Buffer>();

function readThreeAsset(relPath: string): Buffer | null {
  if (threeAssetCache.has(relPath)) {
    return threeAssetCache.get(relPath)!;
  }
  const threeRoot = path.resolve(process.cwd(), "node_modules/three");
  const candidate = path.resolve(threeRoot, relPath);
  if (!candidate.startsWith(threeRoot) || !fs.existsSync(candidate)) {
    return null;
  }
  const buf = fs.readFileSync(candidate);
  threeAssetCache.set(relPath, buf);
  return buf;
}

/**
 * Mounts in-memory route interception on http://cinema.local/** so the headless WebGL2
 * cinema page can import Three.js core + EffectComposer + UnrealBloomPass instantaneously
 * with zero network calls or external CDN access.
 */
async function mountCinemaScenePage(page: Page, cfg: ProceduralSceneConfig): Promise<void> {
  const html = buildWebGlCinemaHtml(cfg);
  await page.route("http://cinema.local/**", async (route) => {
    const urlPath = new URL(route.request().url()).pathname;
    if (urlPath === "/index.html" || urlPath === "/") {
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    }
    if (urlPath.startsWith("/three/")) {
      const rel = urlPath.replace(/^\/three\//, "");
      const buf = readThreeAsset(rel);
      if (buf) {
        return route.fulfill({
          status: 200,
          contentType: "application/javascript; charset=utf-8",
          body: buf,
        });
      }
    }
    return route.fulfill({ status: 404, body: "Not found" });
  });
  await page.goto("http://cinema.local/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as unknown as { __cinemaReady?: boolean }).__cinemaReady), null, {
    timeout: 20_000,
  });
}

/**
 * Photorealistic WebGL2 + Three.js PBR + HDR UnrealBloom + Volumetric Shader + 3D Particle Physics renderer.
 */
function buildWebGlCinemaHtml(cfg: ProceduralSceneConfig): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script type="importmap">
  {
    "imports": {
      "three": "http://cinema.local/three/build/three.module.js",
      "three/addons/": "http://cinema.local/three/examples/jsm/"
    }
  }
  </script>
</head>
<body style="margin:0;padding:0;background:#03070a;overflow:hidden;">
<canvas id="c"></canvas>
<script type="module">
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const W = ${cfg.width};
const H = ${cfg.height};
const SS = (W < 480 || H < 480) ? 2 : 1;
const RW = W * SS;
const RH = H * SS;
const CFG = ${JSON.stringify(cfg)};

// Deterministic PRNG for repeatable high-craft film composition
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(1885 + CFG.shotNumber * 7919);

// ---------------------------------------------------------------------------
// 1. Procedural PBR Textures (Steel Brushed Bump, Wet Floor, Soft Smoke Sprite)
// ---------------------------------------------------------------------------
function makeBrushedMetalTexture(baseHex, streakAlpha, grimeCount) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = baseHex;
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const y = rng() * 512;
    const len = 40 + rng() * 320;
    const xp = rng() * 512;
    const bright = rng() > 0.5 ? 255 : 0;
    x.fillStyle = 'rgba(' + bright + ',' + bright + ',' + bright + ',' + (rng() * streakAlpha).toFixed(3) + ')';
    x.fillRect(xp, y, len, 1 + rng() * 2.2);
  }
  for (let i = 0; i < grimeCount; i++) {
    const gx = rng() * 512, gy = rng() * 512, gr = 12 + rng() * 54;
    const g = x.createRadialGradient(gx, gy, 1, gx, gy, gr);
    g.addColorStop(0, 'rgba(12,16,18,' + (0.25 + rng() * 0.35).toFixed(2) + ')');
    g.addColorStop(1, 'rgba(12,16,18,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(gx, gy, gr, 0, Math.PI * 2); x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeSmokeSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 18; i++) {
    const ox = 128 + (rng() - 0.5) * 68;
    const oy = 128 + (rng() - 0.5) * 68;
    const r = 42 + rng() * 58;
    const g = x.createRadialGradient(ox, oy, 2, ox, oy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.5, 'rgba(230,235,240,0.09)');
    g.addColorStop(1, 'rgba(200,210,220,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(ox, oy, r, 0, Math.PI * 2); x.fill();
  }
  return new THREE.CanvasTexture(c);
}

function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 32);
  const g = x.createLinearGradient(8, 16, 122, 16);
  g.addColorStop(0, 'rgba(255,70,0,0)');
  g.addColorStop(0.55, 'rgba(255,155,28,0.65)');
  g.addColorStop(0.88, 'rgba(255,238,165,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.beginPath();
  x.ellipse(68, 16, 56, 3.2, 0, 0, Math.PI * 2);
  x.fill();
  // Intense pinpoint spark head
  const head = x.createRadialGradient(108, 16, 0.5, 108, 16, 6);
  head.addColorStop(0, 'rgba(255,255,245,1)');
  head.addColorStop(0.5, 'rgba(255,200,80,0.65)');
  head.addColorStop(1, 'rgba(255,120,20,0)');
  x.fillStyle = head;
  x.beginPath(); x.arc(108, 16, 6, 0, Math.PI * 2); x.fill();
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// 2. GLSL Shaders: Incandescent Magma + Cracked Mill Scale & Furnace Flame
// ---------------------------------------------------------------------------
const MOLTEN_VERT = \`
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
\`;

const MOLTEN_FRAG = \`
  uniform float uTime;
  uniform float uCrustStrength;
  uniform float uHeatBoost;
  uniform float uScrollU;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = rot * p * 2.05;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Seamless 360-degree periodic cylinder coordinates (zero UV seam line)
    float ang = vUv.x * 6.2831853 + uScrollU;
    vec2 cyl = vec2(cos(ang), sin(ang)) * 2.1;
    vec2 uv = vec2(cyl.x * 1.4 + cyl.y * 0.9, vUv.y * 10.0 + cyl.y * 0.65);
    float warp = fbm(uv + vec2(uTime * 0.14, -uTime * 0.09));
    float f = fbm(uv * 1.45 + vec2(warp * 2.2, warp * 1.6));
    float crack = smoothstep(0.38, 0.68, f);

    // Fresnel rim lighting so glowing metal reads 3D cylindrical
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float ndotv = clamp(dot(normalize(vNormalW), viewDir), 0.0, 1.0);
    float rim = pow(1.0 - ndotv, 2.5);

    // Blackbody temperature gradient calibrated for ACES Filmic + subtle HDR Bloom (no whiteout)
    vec3 coreWhite = vec3(1.22, 0.90, 0.42);
    vec3 hotOrange = vec3(0.92, 0.26, 0.02);
    vec3 cherryRed = vec3(0.32, 0.035, 0.005);
    vec3 darkScale = vec3(0.032, 0.022, 0.022);

    float heat = clamp((1.0 - crack * uCrustStrength) * uHeatBoost + 0.08 * sin(uTime * 4.5 + warp * 5.0), 0.0, 1.12);
    vec3 col = mix(cherryRed, hotOrange, smoothstep(0.18, 0.65, heat));
    col = mix(col, coreWhite, smoothstep(0.68, 1.08, heat));
    col = mix(darkScale, col, smoothstep(0.18, 0.85, 1.0 - crack * uCrustStrength * 0.95));

    // Subtle cool steel-teal rim on unheated scale crust edges
    col += vec3(0.025, 0.075, 0.10) * rim * crack * 0.7;
    col += vec3(0.35, 0.12, 0.01) * pow(max(0.0, heat - 0.6), 2.0) * 0.45;

    gl_FragColor = vec4(col, 1.0);
  }
\`;

const FLAME_FRAG = \`
  uniform float uTime;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.04; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 p = vec2(vUv.x * 3.0, vUv.y * 2.4 - uTime * 1.9);
    float n = fbm(p + fbm(p * 1.4 - vec2(0.0, uTime * 0.8)));
    float shape = (1.0 - vUv.y) * (1.0 - abs(vUv.x - 0.5) * 2.1);
    float intensity = clamp(shape * 1.15 + (n - 0.45) * 0.8, 0.0, 1.15);
    vec3 col = mix(vec3(0.28, 0.03, 0.0), vec3(1.05, 0.32, 0.03), smoothstep(0.22, 0.65, intensity));
    col = mix(col, vec3(1.35, 0.98, 0.45), smoothstep(0.72, 1.1, intensity));
    float alpha = smoothstep(0.16, 0.5, intensity) * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
    gl_FragColor = vec4(col, alpha);
  }
\`;

// ---------------------------------------------------------------------------
// 3. Renderer + Composer (ACES Filmic + HDR UnrealBloom)
// ---------------------------------------------------------------------------
const canvas = document.getElementById('c');
canvas.width = RW;
canvas.height = RH;
const outCanvas = SS > 1 ? document.createElement('canvas') : null;
if (outCanvas) { outCanvas.width = W; outCanvas.height = H; }
const outCtx = outCanvas ? outCanvas.getContext('2d') : null;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
});
renderer.setSize(RW, RH, false);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
const fogColor = CFG.paletteMode === 'refinery_night' ? 0x05131c : 0x051218;
scene.background = new THREE.Color(fogColor);
scene.fog = new THREE.FogExp2(fogColor, 0.075);

const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 140);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(RW, RH), 0.28, 0.35, 0.88);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Shared procedural materials
const steelTex = makeBrushedMetalTexture('#2a3942', 0.14, 24);
steelTex.repeat.set(2, 2);
const rustedIronTex = makeBrushedMetalTexture('#1f262b', 0.18, 46);
rustedIronTex.repeat.set(3, 2);
const floorTex = makeBrushedMetalTexture('#0a1217', 0.12, 35);
floorTex.repeat.set(6, 6);

const darkSteelMat = new THREE.MeshStandardMaterial({
  map: steelTex,
  bumpMap: steelTex,
  bumpScale: 0.025,
  color: 0x354954,
  metalness: 0.88,
  roughness: 0.32,
});
const weatheredIronMat = new THREE.MeshStandardMaterial({
  map: rustedIronTex,
  bumpMap: rustedIronTex,
  bumpScale: 0.045,
  color: 0x242c32,
  metalness: 0.76,
  roughness: 0.50,
});
const wetFloorMat = new THREE.MeshStandardMaterial({
  map: floorTex,
  bumpMap: floorTex,
  bumpScale: 0.015,
  color: 0x0a1319,
  metalness: 0.88,
  roughness: 0.20,
});

// Teal & Amber industrial lighting rig (physically balanced so dark teal shadows hold depth)
const hemiLight = new THREE.HemisphereLight(0x287b96, 0x160a05, 0.65);
scene.add(hemiLight);

const tealKeyRim = new THREE.DirectionalLight(0x369db8, 1.35);
tealKeyRim.position.set(-6, 11, -5);
scene.add(tealKeyRim);

const cyanOverhead = new THREE.SpotLight(0x45aecb, 4.5, 32, Math.PI * 0.28, 0.65, 1.4);
cyanOverhead.position.set(2.5, 9.5, 1.5);
scene.add(cyanOverhead);

const moltenLight = new THREE.PointLight(0xff7216, 4.2, 16, 1.5);
moltenLight.position.set(0, 1.8, 1.5);
scene.add(moltenLight);

const secondaryAmber = new THREE.PointLight(0xff9e30, 2.2, 14, 1.6);
secondaryAmber.position.set(-1.5, 0.7, 2.2);
scene.add(secondaryAmber);

// Wet dark foundry floor & industrial roof girders common to factory interiors
function buildFoundryBackdrop() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), wetFloorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  const girderGeo = new THREE.BoxGeometry(0.28, 14, 0.35);
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const colL = new THREE.Mesh(girderGeo, weatheredIronMat);
    colL.position.set(-4.5, 7, -i * 3.2 - 1.5);
    scene.add(colL);
    const colR = new THREE.Mesh(girderGeo, weatheredIronMat);
    colR.position.set(4.5, 7, -i * 3.2 - 1.5);
    scene.add(colR);
  }
  const trussGeo = new THREE.BoxGeometry(11, 0.25, 0.25);
  for (let z = -10; z <= 4; z += 3.5) {
    const beam = new THREE.Mesh(trussGeo, weatheredIronMat);
    beam.position.set(0, 6.2, z);
    scene.add(beam);
  }
}

// ---------------------------------------------------------------------------
// 4. 3D Gravity Sparks + Volumetric Smoke/Steam Particle Rig
// ---------------------------------------------------------------------------
const smokeTex = makeSmokeSpriteTexture();
const sparkTex = makeSparkTexture();

const sparkCount = 260;
const sparkMeshes = [];
const sparkMat = new THREE.MeshBasicMaterial({
  map: sparkTex,
  color: 0xffc668,
  transparent: true,
  opacity: 0.92,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const sparkQuad = new THREE.PlaneGeometry(0.11, 0.018);
const sparkGroup = new THREE.Group();
scene.add(sparkGroup);
const sparkData = [];
for (let i = 0; i < sparkCount; i++) {
  const m = new THREE.Mesh(sparkQuad, sparkMat);
  sparkGroup.add(m);
  sparkMeshes.push(m);
  sparkData.push({
    phase: rng(),
    speed: 0.55 + rng() * 1.15,
    vx: (rng() - 0.5) * 3.4,
    vy: 0.4 + rng() * 2.8,
    vz: (rng() - 0.5) * 3.2,
    ox: (rng() - 0.5) * 1.2,
    oy: (rng() - 0.5) * 0.4,
    oz: (rng() - 0.5) * 1.4,
    scale: 0.55 + rng() * 1.25,
  });
}

const smokeCount = 48;
const smokeSprites = [];
const smokeData = [];
const smokeGroup = new THREE.Group();
scene.add(smokeGroup);
for (let i = 0; i < smokeCount; i++) {
  const isWarm = rng() > 0.42;
  const smMat = new THREE.SpriteMaterial({
    map: smokeTex,
    color: isWarm ? 0x6b3a1c : 0x1d3e4a,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  const sp = new THREE.Sprite(smMat);
  smokeGroup.add(sp);
  smokeSprites.push(sp);
  smokeData.push({
    phase: rng(),
    speed: 0.14 + rng() * 0.18,
    ox: (rng() - 0.5) * 3.6,
    oz: (rng() - 0.5) * 3.8,
    size: 1.8 + rng() * 2.8,
    driftX: (rng() - 0.5) * 1.4,
    baseOpacity: 0.18 + rng() * 0.26,
    isWarm,
  });
}

function updateParticles(t, emitterPos, sparkMode, smokeMode) {
  for (let i = 0; i < sparkCount; i++) {
    const d = sparkData[i];
    const m = sparkMeshes[i];
    const life = (t * d.speed + d.phase) % 1;
    let px, py, pz, vx, vy, vz;

    if (sparkMode === 'burst_down') {
      // Reference signature: bright sparks spraying down & hitting rollers/floor and bouncing!
      px = emitterPos.x + d.ox * 0.55 + d.vx * life * 0.9;
      const rawY = emitterPos.y + (d.vy * 0.45) * life - 3.6 * life * life;
      if (rawY < 0.06) {
        const over = 0.06 - rawY;
        py = 0.06 + over * 0.45;
        vy = Math.abs(d.vy) * 0.4;
      } else {
        py = rawY;
        vy = d.vy * 0.45 - 7.2 * life;
      }
      pz = emitterPos.z + d.oz * 0.55 + d.vz * life * 0.9;
      vx = d.vx; vz = d.vz;
    } else if (sparkMode === 'swirl') {
      const ang = d.phase * 6.283 + t * 3.4 * d.speed;
      const r = 0.28 + life * 1.5;
      px = emitterPos.x + Math.cos(ang) * r;
      py = emitterPos.y + Math.sin(ang) * r;
      pz = emitterPos.z - 2.0 + (1.0 - life) * 4.5;
      vx = -Math.sin(ang) * 2.0; vy = Math.cos(ang) * 2.0; vz = 3.0;
    } else if (sparkMode === 'dust_motes') {
      px = emitterPos.x + d.ox * 2.5 + Math.sin(t * 0.7 + d.phase * 10) * 0.4;
      py = 0.5 + ((d.oy + t * 0.22 * d.speed + 4.0) % 3.4);
      pz = emitterPos.z + d.oz * 2.2;
      vx = 0.1; vy = 0.2; vz = 0.0;
    } else {
      px = emitterPos.x + d.ox * 0.9 + d.vx * life * 1.1;
      py = emitterPos.y + d.oy * 0.5 + d.vy * life * 1.5 - 2.4 * life * life;
      pz = emitterPos.z + d.oz * 0.9 + d.vz * life * 1.1;
      vx = d.vx; vy = d.vy - 4.8 * life; vz = d.vz;
    }

    m.position.set(px, py, pz);
    m.lookAt(camera.position);
    const angle = Math.atan2(vy, vx + 0.001);
    m.rotateZ(angle);
    const fade = Math.sin(life * Math.PI);
    const sc = (sparkMode === 'dust_motes' ? 0.25 : d.scale) * fade;
    m.scale.set(sc * (sparkMode === 'dust_motes' ? 0.45 : 1.15), sc, 1);
    m.visible = fade > 0.05;
  }

  for (let i = 0; i < smokeCount; i++) {
    const d = smokeData[i];
    const sp = smokeSprites[i];
    const life = (t * d.speed + d.phase) % 1;
    if (smokeMode === 'steam_jet') {
      sp.position.set(
        emitterPos.x + d.ox * 0.22 + d.driftX * life * 1.1,
        emitterPos.y + life * 4.2,
        emitterPos.z + d.oz * 0.22 + life * 0.5
      );
      const s = d.size * (0.35 + life * 1.25);
      sp.scale.set(s, s, 1);
      sp.material.color.setHex(0x6e98ab);
      sp.material.opacity = Math.sin(life * Math.PI) * 0.20;
    } else {
      sp.position.set(
        emitterPos.x + d.ox + d.driftX * life,
        0.55 + life * 4.4,
        emitterPos.z + d.oz + Math.sin(t + d.phase * 6) * 0.4
      );
      const s = d.size * (0.8 + life * 1.2);
      sp.scale.set(s, s, 1);
      sp.material.color.setHex(d.isWarm && life < 0.55 ? 0x6b3212 : 0x152c36);
      sp.material.opacity = Math.sin(life * Math.PI) * (d.baseOpacity * 0.72);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Scene Builders per CinemaSceneArchetype
// ---------------------------------------------------------------------------
const arch = CFG.archetype;
const updaters = [];
let sparkEmit = new THREE.Vector3(0, 1.0, 0.8);
let sparkMode = 'burst_down';
let smokeMode = 'warm_smoke';

const moltenMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uCrustStrength: { value: 0.78 },
    uHeatBoost: { value: 1.08 },
    uScrollU: { value: 0 },
  },
  vertexShader: MOLTEN_VERT,
  fragmentShader: MOLTEN_FRAG,
});

const flameMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: MOLTEN_VERT,
  fragmentShader: FLAME_FRAG,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

if (arch === 'furnace_billet_extraction' || arch === 'seamless_pipe_gliding') {
  buildFoundryBackdrop();
  const isSeamless = arch === 'seamless_pipe_gliding';
  const isShot2CloseImpact = !isSeamless && CFG.shotNumber === 2;
  moltenMat.uniforms.uCrustStrength.value = isSeamless ? 0.12 : 0.76;
  moltenMat.uniforms.uHeatBoost.value = isSeamless ? 0.96 : 1.15;

  // Blazing furnace chamber wall & archway on background z = -4.2
  if (!isSeamless) {
    const brickWall = new THREE.Mesh(new THREE.BoxGeometry(7.2, 5.2, 0.9), weatheredIronMat);
    brickWall.position.set(-0.4, 2.6, -4.6);
    scene.add(brickWall);

    const doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 3.0, 1.08),
      new THREE.MeshStandardMaterial({ color: 0x121518, metalness: 0.85, roughness: 0.55 })
    );
    doorFrame.position.set(-0.2, 1.65, -4.5);
    scene.add(doorFrame);

    const furnaceGlowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 2.6),
      new THREE.MeshBasicMaterial({ color: 0xff8c1a })
    );
    furnaceGlowPlane.position.set(-0.2, 1.55, -3.93);
    scene.add(furnaceGlowPlane);

    const flameSheet = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.5), flameMat);
    flameSheet.position.set(-0.2, 1.5, -3.88);
    scene.add(flameSheet);
  }

  // Row of 7 heavy rotating metallic conveyor rollers in deep perspective (64-seg smooth)
  const rollers = [];
  const rollerGeo = new THREE.CylinderGeometry(0.24, 0.24, 3.2, 64);
  rollerGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 7; i++) {
    const zPos = -3.2 + i * 1.15;
    const roller = new THREE.Mesh(rollerGeo, darkSteelMat);
    roller.position.set(0, 0.52, zPos);
    scene.add(roller);
    rollers.push(roller);

    const chockL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.35), weatheredIronMat);
    chockL.position.set(-1.68, 0.38, zPos);
    scene.add(chockL);
    const chockR = chockL.clone();
    chockR.position.x = 1.68;
    scene.add(chockR);
  }

  const railL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 9.5), weatheredIronMat);
  railL.position.set(-1.72, 0.62, 0.2);
  scene.add(railL);
  const railR = railL.clone();
  railR.position.x = 1.72;
  scene.add(railR);

  const radius = isSeamless ? 0.34 : 0.40;
  const billetGeo = new THREE.CylinderGeometry(radius, radius, 6.2, 64, 16);
  billetGeo.rotateX(Math.PI / 2);
  const billet = new THREE.Mesh(billetGeo, moltenMat);
  billet.position.set(0, 0.52 + 0.24 + radius - 0.02, -0.5);
  scene.add(billet);

  if (!isSeamless && !isShot2CloseImpact) {
    const tongArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.5), weatheredIronMat);
    tongArm.position.set(-0.55, 1.55, -2.5);
    tongArm.rotation.y = -0.14;
    tongArm.rotation.x = 0.12;
    scene.add(tongArm);
  }

  sparkEmit.set(0, 0.85, 1.75);
  sparkMode = isSeamless ? 'rise' : 'burst_down';
  smokeMode = 'warm_smoke';

  updaters.push((t, prog) => {
    moltenMat.uniforms.uTime.value = t;
    moltenMat.uniforms.uScrollU.value = t * (isSeamless ? 0.5 : 0.32);
    flameMat.uniforms.uTime.value = t;
    for (const r of rollers) r.rotation.x = t * 3.8;
    billet.rotation.z = t * (isSeamless ? 1.5 : 0.85);
    billet.position.z = (isShot2CloseImpact ? -0.35 : -0.75) + prog * 1.35;
    sparkEmit.z = billet.position.z + 2.1;
    moltenLight.position.set(0, 1.65, billet.position.z + 1.4);
    moltenLight.intensity = 4.2 + Math.sin(t * 9.0) * 0.8;

    if (isShot2CloseImpact) {
      // Dramatic wider low-angle foundry impact frame showing dark conveyor, trusses & sparks
      camera.position.set(2.4 - prog * 0.45, 1.62, 5.2 - prog * 0.75);
      camera.lookAt(-0.1, 0.95, 0.4 + prog * 0.3);
    } else if (isSeamless) {
      camera.position.set(2.85 - prog * 1.15, 2.05, 5.4 - prog * 0.55);
      camera.lookAt(0, 0.95, 0.2 + prog * 0.5);
    } else {
      camera.position.set(1.75 - prog * 0.45, 2.35 - prog * 0.2, 6.2 - prog * 1.0);
      camera.lookAt(-0.1, 1.05, -0.2 + prog * 0.3);
    }
  });
} else if (arch === 'welded_seam_rupture') {
  buildFoundryBackdrop();
  // Dual key + lower-front catchlight so cylindrical riveted boiler body, flanges & bolts read crisply
  const boilerRim = new THREE.SpotLight(0x52c2df, 12.0, 26, Math.PI * 0.36, 0.55, 1.1);
  boilerRim.position.set(1.4, 5.4, 4.2);
  scene.add(boilerRim);
  const frontFill = new THREE.PointLight(0x2e8da8, 3.4, 14, 1.3);
  frontFill.position.set(-2.2, 1.0, 3.6);
  scene.add(frontFill);

  const boilerPipeMat = new THREE.MeshStandardMaterial({
    map: rustedIronTex,
    bumpMap: rustedIronTex,
    bumpScale: 0.04,
    color: 0x526875,
    metalness: 0.80,
    roughness: 0.34,
  });

  // Concrete & steel pipe support saddles anchoring boiler pipe to foundry floor
  for (const sx of [-1.75, 1.75]) {
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.25, 1.65), weatheredIronMat);
    saddle.position.set(sx, 0.62, 0);
    scene.add(saddle);
  }

  // Heavy riveted vintage boiler pipe under extreme pressure
  const pipeGeo = new THREE.CylinderGeometry(0.86, 0.86, 7.6, 64, 8);
  pipeGeo.rotateZ(Math.PI / 2);
  const pipeGroup = new THREE.Group();
  pipeGroup.position.set(0, 1.48, 0);
  scene.add(pipeGroup);

  const mainPipe = new THREE.Mesh(pipeGeo, boilerPipeMat);
  pipeGroup.add(mainPipe);

  const flangeGeo = new THREE.CylinderGeometry(1.10, 1.10, 0.24, 64);
  flangeGeo.rotateZ(Math.PI / 2);
  const boltGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.30, 8);
  boltGeo.rotateZ(Math.PI / 2);
  for (const fx of [-1.42, 1.42]) {
    const fl = new THREE.Mesh(flangeGeo, darkSteelMat);
    fl.position.x = fx;
    pipeGroup.add(fl);
    for (let b = 0; b < 12; b++) {
      const ba = (b / 12) * Math.PI * 2;
      const bolt = new THREE.Mesh(boltGeo, weatheredIronMat);
      bolt.position.set(fx, Math.sin(ba) * 0.98, Math.cos(ba) * 0.98);
      pipeGroup.add(bolt);
    }
  }

  // Place weld seam & twin parallel rivet rows along upper-front shoulder facing camera (theta = 0.26 * PI)
  const seamTheta = Math.PI * 0.26;
  const rivetGeo = new THREE.SphereGeometry(0.055, 14, 14);
  for (const dTheta of [-0.15, 0.15]) {
    const th = seamTheta + dTheta;
    const ry = Math.sin(th) * 0.855;
    const rz = Math.cos(th) * 0.855;
    for (let rx = -1.25; rx <= 1.25; rx += 0.25) {
      const rv = new THREE.Mesh(rivetGeo, darkSteelMat);
      rv.position.set(rx, ry, rz);
      pipeGroup.add(rv);
    }
  }

  // Custom tapered jagged glowing crack fissure hugging the boiler cylinder surface
  moltenMat.uniforms.uCrustStrength.value = 0.42;
  moltenMat.uniforms.uHeatBoost.value = 0.96;
  const crackSegX = 48;
  const crackSegA = 6;
  const cPos = [];
  const cNorm = [];
  const cUv = [];
  const cIdx = [];
  const crackHalfLen = 1.18;
  for (let ix = 0; ix <= crackSegX; ix++) {
    const u = ix / crackSegX;
    const tNorm = u * 2 - 1;
    const xPos = tNorm * crackHalfLen;
    const pinch = Math.pow(Math.max(0.002, 1 - tNorm * tNorm), 1.45);
    const jag = 0.72 + 0.36 * Math.abs(Math.sin(tNorm * 9.5 + 0.4));
    const halfAng = 0.068 * pinch * jag;
    for (let ia = 0; ia <= crackSegA; ia++) {
      const v = ia / crackSegA;
      const th = seamTheta + (v - 0.5) * 2 * halfAng;
      const r = 0.868 + 0.004 * pinch;
      const ny = Math.sin(th);
      const nz = Math.cos(th);
      cPos.push(xPos, r * ny, r * nz);
      cNorm.push(0, ny, nz);
      cUv.push(u, v);
    }
  }
  for (let ix = 0; ix < crackSegX; ix++) {
    for (let ia = 0; ia < crackSegA; ia++) {
      const a = ix * (crackSegA + 1) + ia;
      const b = a + crackSegA + 1;
      const c = a + 1;
      const d = b + 1;
      cIdx.push(a, b, c, c, b, d);
    }
  }
  const crackGeo = new THREE.BufferGeometry();
  crackGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  crackGeo.setAttribute('normal', new THREE.Float32BufferAttribute(cNorm, 3));
  crackGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cUv, 2));
  crackGeo.setIndex(cIdx);
  const crackMesh = new THREE.Mesh(crackGeo, moltenMat);
  pipeGroup.add(crackMesh);

  const emitY = 1.48 + Math.sin(seamTheta) * 0.88;
  const emitZ = Math.cos(seamTheta) * 0.88;
  sparkEmit.set(0, emitY, emitZ);
  sparkMode = 'burst_down';
  smokeMode = 'steam_jet';
  moltenLight.color.setHex(0xff5a12);

  updaters.push((t, prog) => {
    moltenMat.uniforms.uTime.value = t * 1.6;
    const shake = 0.018 * Math.sin(t * 58);
    pipeGroup.position.y = 1.48 + shake;
    crackMesh.scale.x = 0.55 + prog * 0.62;
    moltenLight.position.set(0, emitY + 0.25, emitZ + 0.55);
    moltenLight.intensity = 4.4 + Math.sin(t * 22) * 0.9;
    camera.position.set(-1.35 + prog * 1.45, 2.55 - prog * 0.18, 5.75 - prog * 0.65);
    camera.lookAt(0, 1.48, 0.15);
  });
} else if (arch === 'rotary_piercing_mill') {
  buildFoundryBackdrop();
  moltenMat.uniforms.uCrustStrength.value = 0.55;
  moltenMat.uniforms.uHeatBoost.value = 0.98;

  const housingL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.8, 1.8), weatheredIronMat);
  housingL.position.set(-1.95, 1.9, 0);
  scene.add(housingL);
  const housingR = housingL.clone();
  housingR.position.x = 1.95;
  scene.add(housingR);

  const gearGroup = new THREE.Group();
  gearGroup.position.set(-1.4, 1.9, -2.8);
  const gearWheel = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.35, 64), darkSteelMat);
  gearWheel.rotation.x = Math.PI / 2;
  gearGroup.add(gearWheel);
  for (let g = 0; g < 16; g++) {
    const a = (g / 16) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.36), darkSteelMat);
    tooth.position.set(Math.cos(a) * 1.58, Math.sin(a) * 1.58, 0);
    tooth.rotation.z = a;
    gearGroup.add(tooth);
  }
  scene.add(gearGroup);

  const coneGeo = new THREE.CylinderGeometry(0.55, 0.88, 2.6, 64);
  coneGeo.rotateZ(Math.PI / 2);

  const topRoller = new THREE.Mesh(coneGeo, darkSteelMat);
  topRoller.position.set(0, 2.28, 0);
  topRoller.rotation.y = 0.24;
  topRoller.rotation.z = -0.10;
  scene.add(topRoller);

  const botRoller = new THREE.Mesh(coneGeo, darkSteelMat);
  botRoller.position.set(0, 0.86, 0);
  botRoller.rotation.y = -0.24;
  botRoller.rotation.z = 0.10;
  scene.add(botRoller);

  const billetGeo = new THREE.CylinderGeometry(0.36, 0.40, 6.0, 64, 12);
  billetGeo.rotateZ(Math.PI / 2);
  const billet = new THREE.Mesh(billetGeo, moltenMat);
  billet.position.set(0, 1.56, 0);
  scene.add(billet);

  sparkEmit.set(0.25, 1.48, 0.35);
  sparkMode = 'burst_down';
  smokeMode = 'steam_jet';

  updaters.push((t, prog) => {
    moltenMat.uniforms.uTime.value = t * 1.4;
    moltenMat.uniforms.uScrollU.value = t * 0.9;
    topRoller.rotation.x = t * 5.2;
    botRoller.rotation.x = -t * 5.2;
    gearGroup.rotation.z = -t * 0.9;
    billet.rotation.x = t * 3.8;
    billet.position.x = -0.5 + prog * 1.1;
    moltenLight.position.set(0, 1.58, 0.9);
    moltenLight.intensity = 4.6 + Math.sin(t * 15) * 0.9;
    camera.position.set(1.85 - prog * 0.55, 2.05, 6.15 - prog * 0.85);
    camera.lookAt(0, 1.54, 0);
  });
} else if (arch === 'modern_refinery_pipelines' || arch === 'manifold_flanged_pipes') {
  const isRefinery = arch === 'modern_refinery_pipelines';
  if (isRefinery) {
    // Outdoor refinery floor (no indoor foundry roof girders blocking flare stack!)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), wetFloorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const towerFlood = new THREE.SpotLight(0x4bc3e0, 12, 42, Math.PI * 0.42, 0.7, 1.1);
    towerFlood.position.set(-3.5, 6.5, 4.0);
    scene.add(towerFlood);
  } else {
    buildFoundryBackdrop();
  }

  if (isRefinery) {
    // Towering steel distillation columns + glowing walkway rings + warning beacons
    const colSpecs = [
      [-2.0, 5.2, 0.65, -4.8],
      [0.15, 6.4, 0.78, -6.2],
      [2.1, 4.6, 0.56, -4.6],
    ];
    const beacons = [];
    const refinerySteel = new THREE.MeshStandardMaterial({
      map: steelTex,
      color: 0x4f6878,
      metalness: 0.85,
      roughness: 0.30,
    });
    for (const [cx, ch, cr, cz] of colSpecs) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(cr, cr * 1.06, ch, 48), refinerySteel);
      col.position.set(cx, ch / 2, cz);
      scene.add(col);
      for (let r = 1.2; r < ch - 0.5; r += 1.1) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(cr * 1.16, 0.045, 12, 40), weatheredIronMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(cx, r, cz);
        scene.add(ring);
      }
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffaa22 }));
      b.position.set(cx, ch + 0.16, cz);
      scene.add(b);
      beacons.push(b);
    }

    // Tall flare stack & roaring flame plume unobstructed against dusk sky
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 6.2, 32), weatheredIronMat);
    stack.position.set(2.3, 3.1, -7.8);
    scene.add(stack);
    const flare = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.2), flameMat);
    flare.position.set(2.3, 6.8, -7.8);
    scene.add(flare);

    // Sweeping foreground high-pressure steel pipelines with amber specular highlights
    const pipeGeo = new THREE.CylinderGeometry(0.28, 0.28, 12, 48);
    pipeGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(pipeGeo, refinerySteel);
      p.position.set(0, 0.85 + i * 0.65, 1.5 - i * 0.9);
      scene.add(p);
    }
    sparkEmit.set(-0.6, 2.1, -1.2);
    sparkMode = 'dust_motes';
    smokeMode = 'steam_jet';
    moltenLight.position.set(2.3, 6.5, -6.2);
    moltenLight.intensity = 4.6;

    updaters.push((t, prog) => {
      flameMat.uniforms.uTime.value = t * 1.4;
      flare.lookAt(camera.position);
      beacons.forEach((b, idx) => {
        b.visible = Math.sin(t * 4.5 + idx * 2) > -0.3;
      });
      camera.position.set(-0.35 + prog * 0.65, 1.45 + prog * 1.45, 5.4 - prog * 0.8);
      camera.lookAt(0.2, 3.0 + prog * 0.7, -5.2);
    });
  } else {
    // Tight gimbal glide past colossal manifold pipes, 12-bolt flanges, amber valve handwheels & precision steel grain
    scene.fog = new THREE.FogExp2(0x06161f, 0.032);
    const manifoldSteel = new THREE.MeshStandardMaterial({
      map: steelTex,
      bumpMap: steelTex,
      bumpScale: 0.022,
      color: 0x6f8b9c,
      metalness: 0.86,
      roughness: 0.24,
    });
    const flangeMat = new THREE.MeshStandardMaterial({
      map: rustedIronTex,
      color: 0x4b5f6c,
      metalness: 0.84,
      roughness: 0.32,
    });
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.50,
      roughness: 0.28,
    });

    const pipeGeo = new THREE.CylinderGeometry(0.42, 0.42, 14, 48);
    pipeGeo.rotateZ(Math.PI / 2);
    const flGeo = new THREE.CylinderGeometry(0.60, 0.60, 0.18, 48);
    flGeo.rotateZ(Math.PI / 2);
    const boltGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.24, 8);
    boltGeo.rotateZ(Math.PI / 2);
    const wheelGeo = new THREE.TorusGeometry(0.28, 0.048, 12, 28);
    const stemGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.36, 12);

    for (let i = 0; i < 4; i++) {
      const y = 0.95 + i * 0.95;
      const z = 0.6 - i * 0.72;
      const pipe = new THREE.Mesh(pipeGeo, manifoldSteel);
      pipe.position.set(0, y, z);
      scene.add(pipe);

      for (const fx of [-1.4, 0.9, 3.2]) {
        const fl = new THREE.Mesh(flGeo, flangeMat);
        fl.position.set(fx, y, z);
        scene.add(fl);
        for (let b = 0; b < 10; b++) {
          const ba = (b / 10) * Math.PI * 2;
          const bolt = new THREE.Mesh(boltGeo, darkSteelMat);
          bolt.position.set(fx, y + Math.sin(ba) * 0.51, z + Math.cos(ba) * 0.51);
          scene.add(bolt);
        }
      }
      const wx = -0.35 + i * 0.75;
      const stem = new THREE.Mesh(stemGeo, darkSteelMat);
      stem.position.set(wx, y + 0.52, z);
      scene.add(stem);
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, y + 0.74, z);
      wheel.rotation.x = Math.PI * 0.15;
      scene.add(wheel);
    }

    // Precision studio-industrial dual spotlights so machined flanges & amber valves gleam unmistakably
    const keySpot = new THREE.SpotLight(0x6bd5f2, 16, 26, Math.PI * 0.38, 0.55, 1.1);
    keySpot.position.set(-1.5, 5.2, 5.8);
    scene.add(keySpot);
    const warmKey = new THREE.PointLight(0xffa430, 6.2, 18, 1.2);
    warmKey.position.set(2.2, 2.5, 4.2);
    scene.add(warmKey);

    sparkEmit.set(0.4, 1.4, 0.2);
    sparkMode = 'dust_motes';
    smokeMode = 'steam_jet';
    moltenLight.position.set(-1.5, 2.6, 3.4);
    moltenLight.intensity = 4.6;

    updaters.push((_t, prog) => {
      camera.position.set(-1.15 + prog * 2.25, 2.25 + prog * 0.25, 4.85 - prog * 0.55);
      camera.lookAt(0.25 + prog * 0.85, 2.15, -0.35);
    });
  }
} else if (arch === 'pipe_cross_section_inspection') {
  buildFoundryBackdrop();
  // Machined 3D thick-walled beveled hollow carbon steel pipe cross-section (ZERO weld seam!)
  const pts = [
    new THREE.Vector2(0.74, -0.9),
    new THREE.Vector2(0.74, 0.82),
    new THREE.Vector2(0.84, 0.92),
    new THREE.Vector2(1.26, 0.92),
    new THREE.Vector2(1.36, 0.82),
    new THREE.Vector2(1.36, -0.9),
    new THREE.Vector2(0.74, -0.9),
  ];
  const pipeLathe = new THREE.LatheGeometry(pts, 72);
  const precisionSteel = new THREE.MeshStandardMaterial({
    map: steelTex,
    bumpMap: steelTex,
    bumpScale: 0.015,
    color: 0x9eb4c2,
    metalness: 0.94,
    roughness: 0.18,
  });
  const section = new THREE.Mesh(pipeLathe, precisionSteel);
  section.rotation.x = Math.PI * 0.42;
  section.position.set(0, 1.75, 0);
  scene.add(section);

  // Sweeping warm golden inspection laser / spotlight (calibrated)
  const inspectSpot = new THREE.SpotLight(0xffbb44, 6.5, 16, Math.PI * 0.18, 0.55, 1.2);
  scene.add(inspectSpot);
  scene.add(inspectSpot.target);
  inspectSpot.target.position.copy(section.position);

  sparkEmit.set(0, 1.2, 0.5);
  sparkMode = 'dust_motes';
  smokeMode = 'warm_smoke';
  moltenLight.position.set(2.2, 2.8, 2.2);
  moltenLight.intensity = 3.2;

  updaters.push((t, prog) => {
    const ang = -0.65 + prog * 1.3;
    inspectSpot.position.set(Math.sin(t * 1.8) * 2.8, 3.6, 3.2);
    camera.position.set(Math.sin(ang) * 4.2, 1.95 + Math.cos(prog * Math.PI) * 0.25, Math.cos(ang) * 4.2);
    camera.lookAt(0, 1.75, 0);
  });
} else if (arch === 'hollow_billet_tunnel_pov') {
  // Deep furnace atmospheric fog dissolves far end smoothly into glowing amber core (zero hard ring cutoff)
  scene.background = new THREE.Color(0x280902);
  scene.fog = new THREE.FogExp2(0x3a0f03, 0.072);

  moltenMat.uniforms.uCrustStrength.value = 0.64;
  moltenMat.uniforms.uHeatBoost.value = 0.84;
  const tunnelMat = moltenMat.clone();
  tunnelMat.side = THREE.BackSide;

  const tunnelGeo = new THREE.CylinderGeometry(1.75, 1.75, 36.0, 64, 32, true);
  tunnelGeo.rotateX(Math.PI / 2);
  const tunnel = new THREE.Mesh(tunnelGeo, tunnelMat);
  tunnel.position.set(0, 0, -13.0);
  scene.add(tunnel);

  // Authentic paraboloid Mannesmann piercing mandrel plug pointing directly toward viewer along +Z (-Math.PI/2 maps +Y tip -> +Z)
  const plugPts = [];
  for (let i = 0; i <= 16; i++) {
    const s = i / 16;
    const y = s * 2.5 - 1.25;
    const r = s < 0.15 ? 0.26 + s * 1.2 : Math.max(0.015, 0.44 * Math.pow(1 - (s - 0.15) / 0.85, 0.68));
    plugPts.push(new THREE.Vector2(r, y));
  }
  const mandrelGeo = new THREE.LatheGeometry(plugPts, 48);
  mandrelGeo.rotateX(Math.PI / 2);
  mandrelGeo.rotateY(Math.PI);
  const mandrelMat = new THREE.MeshStandardMaterial({
    map: steelTex,
    color: 0x627c8d,
    metalness: 0.88,
    roughness: 0.20,
  });
  const mandrel = new THREE.Mesh(mandrelGeo, mandrelMat);
  mandrel.position.set(0, 0, -5.8);
  scene.add(mandrel);

  // Tapered support bar holding piercing mandrel from deep inside furnace
  const barGeo = new THREE.CylinderGeometry(0.18, 0.22, 16, 24);
  barGeo.rotateX(Math.PI / 2);
  const bar = new THREE.Mesh(barGeo, weatheredIronMat);
  bar.position.set(0, 0, -14.8);
  scene.add(bar);

  // Dual grazing lights chisel 3D cone highlights along mandrel tip facing camera
  const mandrelRim = new THREE.SpotLight(0x6bd4f2, 22, 18, Math.PI * 0.28, 0.55, 1.0);
  mandrelRim.position.set(0.95, 0.85, -3.1);
  scene.add(mandrelRim);
  scene.add(mandrelRim.target);
  mandrelRim.target.position.copy(mandrel.position);

  const tipFireLight = new THREE.PointLight(0xff8420, 10.5, 12, 1.2);
  tipFireLight.position.set(-0.65, -0.55, -4.1);
  scene.add(tipFireLight);

  sparkEmit.set(0, 0, -5.0);
  sparkMode = 'swirl';
  smokeMode = 'warm_smoke';
  moltenLight.position.set(0, 0, -9.5);
  moltenLight.intensity = 4.8;

  updaters.push((t, prog) => {
    tunnelMat.uniforms.uTime.value = t * 1.5;
    tunnelMat.uniforms.uScrollU.value = t * 1.25;
    tunnel.rotation.z = t * 0.55;
    mandrel.rotation.z = -t * 2.2;
    camera.position.set(Math.sin(t * 2.1) * 0.08, Math.cos(t * 1.7) * 0.06, 3.8 - prog * 5.2);
    camera.lookAt(0.04, -0.02, -7.2);
  });
} else {
  // generic_cinematic: atmospheric 3D monolith pillars + Teal/Amber rim lights + floating embers
  buildFoundryBackdrop();
  for (let i = -2; i <= 2; i++) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 5.5, 24), darkSteelMat);
    pillar.position.set(i * 1.45, 2.75, -Math.abs(i) * 1.1);
    scene.add(pillar);
  }
  sparkEmit.set(0, 1.5, 0.5);
  sparkMode = 'dust_motes';
  smokeMode = 'warm_smoke';
  updaters.push((_t, prog) => {
    camera.position.set(-0.6 + prog * 1.2, 1.7, 4.6 - prog * 1.0);
    camera.lookAt(0, 1.8, -1.0);
  });
}

// ---------------------------------------------------------------------------
// 6. Frame Driver API consumed by Chromium PNG & MP4 exporters
// ---------------------------------------------------------------------------
function renderAtTime(t) {
  const dur = Math.max(1, CFG.durationSec);
  const prog = Math.max(0, Math.min(1, t / dur));
  for (const fn of updaters) fn(t, prog);
  updateParticles(t, sparkEmit, sparkMode, smokeMode);
  composer.render();
}

function exportCanvasDataUrl(mime, quality) {
  if (outCanvas && outCtx) {
    outCtx.drawImage(canvas, 0, 0, W, H);
    return outCanvas.toDataURL(mime, quality);
  }
  return canvas.toDataURL(mime, quality);
}

window.__renderFrameAt = (t) => {
  renderAtTime(t);
  return exportCanvasDataUrl('image/jpeg', 0.94);
};

window.__renderPngAt = (t) => {
  renderAtTime(t);
  return exportCanvasDataUrl('image/png');
};

renderAtTime(1.2);
window.__cinemaReady = true;
</script>
</body>
</html>`;
}

export async function renderProceduralCinemaKeyframePng(params: {
  prompt: string;
  shotNumber: number;
  width: number;
  height: number;
  cameraMotion?: CameraMotionKind;
  outputPngPath: string;
}): Promise<string> {
  const archetype = classifyCinemaSceneArchetype(params.prompt, params.shotNumber);
  const cfg: ProceduralSceneConfig = {
    archetype,
    cameraMotion: params.cameraMotion || "push-in",
    shotNumber: params.shotNumber,
    width: params.width,
    height: params.height,
    fps: 24,
    durationSec: 5,
    paletteMode:
      archetype === "modern_refinery_pipelines"
        ? "refinery_night"
        : archetype === "welded_seam_rupture" || archetype === "manifold_flanged_pipes"
          ? "steam_steel"
          : "teal_amber",
  };

  const browser = await getSharedCinemaBrowser();
  const page = await browser.newPage({
    viewport: { width: params.width, height: params.height },
  });
  try {
    await mountCinemaScenePage(page, cfg);
    const dataUrl = await page.evaluate(() => {
      return (window as unknown as { __renderPngAt: (t: number) => string }).__renderPngAt(1.4);
    });
    const base64 = dataUrl.split(",")[1];
    fs.mkdirSync(path.dirname(params.outputPngPath), { recursive: true });
    fs.writeFileSync(params.outputPngPath, Buffer.from(base64, "base64"));
    return params.outputPngPath;
  } finally {
    await page.close();
  }
}

export async function renderProceduralCinemaVideoMp4(params: {
  prompt: string;
  shotNumber: number;
  cameraMotion: CameraMotionKind;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  depthMapOutPath?: string;
}): Promise<{ outputPath: string; archetype: CinemaSceneArchetype }> {
  const archetype = classifyCinemaSceneArchetype(params.prompt, params.shotNumber);
  const fps = params.fps || 24;
  const dur = Math.max(2, Math.min(15, params.durationSec));
  const totalFrames = Math.max(24, Math.round(dur * fps));

  // Render SwiftShader WebGL2 video frames at balanced 480x854 (or 854x480) then Lanczos-upscale to target resolution
  // for 3.5x faster CPU rendering while preserving razor-sharp 720x1280/1280x720 H.264 output
  const isVertical = params.height >= params.width;
  const renderW = isVertical ? Math.min(params.width, 480) : Math.min(params.width, 854);
  const renderH = isVertical ? Math.min(params.height, 854) : Math.min(params.height, 480);

  const cfg: ProceduralSceneConfig = {
    archetype,
    cameraMotion: params.cameraMotion,
    shotNumber: params.shotNumber,
    width: renderW,
    height: renderH,
    fps,
    durationSec: dur,
    paletteMode:
      archetype === "modern_refinery_pipelines"
        ? "refinery_night"
        : archetype === "welded_seam_rupture" || archetype === "manifold_flanged_pipes"
          ? "steam_steel"
          : "teal_amber",
  };

  fs.mkdirSync(path.dirname(params.outputPath), { recursive: true });
  const silentVideoPath = params.outputPath.replace(/\.mp4$/i, "_silent.mp4");

  const browser = await getSharedCinemaBrowser();
  const page = await browser.newPage({
    viewport: { width: renderW, height: renderH },
  });

  try {
    await mountCinemaScenePage(page, cfg);

    if (params.depthMapOutPath) {
      const midData = await page.evaluate(
        (midT) => (window as unknown as { __renderPngAt: (t: number) => string }).__renderPngAt(midT),
        dur * 0.4
      );
      const midPng = path.join(path.dirname(params.depthMapOutPath), `mid_kf_${params.shotNumber}.png`);
      fs.writeFileSync(midPng, Buffer.from(midData.split(",")[1], "base64"));
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        midPng,
        "-vf",
        `scale=${params.width}:${params.height}:flags=lanczos,format=gray,sobel=scale=2.2:delta=20,gblur=sigma=12,format=gray`,
        "-frames:v",
        "1",
        params.depthMapOutPath,
      ]);
      try {
        fs.unlinkSync(midPng);
      } catch {
        // ignore
      }
    }

    await new Promise<void>((resolve, reject) => {
      const scaleFilter =
        renderW !== params.width || renderH !== params.height
          ? ["-vf", `scale=${params.width}:${params.height}:flags=lanczos,unsharp=3:3:0.3`]
          : [];
      const ff = spawn("ffmpeg", [
        "-y",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-r",
        String(fps),
        "-i",
        "pipe:0",
        ...scaleFilter,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        "-t",
        dur.toFixed(2),
        silentVideoPath,
      ]);

      let stderr = "";
      ff.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      ff.on("error", reject);
      ff.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg image2pipe exited ${code}: ${stderr.slice(-400)}`));
      });

      (async () => {
        try {
          for (let f = 0; f < totalFrames; f++) {
            const tSec = f / fps;
            const dataUrl = await page.evaluate(
              (tVal) =>
                (window as unknown as { __renderFrameAt: (t: number) => string }).__renderFrameAt(tVal),
              tSec
            );
            const buf = Buffer.from(dataUrl.split(",")[1], "base64");
            if (!ff.stdin.write(buf)) {
              await new Promise<void>((resDrain) => ff.stdin.once("drain", resDrain));
            }
          }
          ff.stdin.end();
        } catch (err) {
          ff.kill("SIGKILL");
          reject(err);
        }
      })();
    });
  } finally {
    await page.close();
  }

  // Synthesize rich domain-matched 48kHz stereo foley audio & mux cleanly
  const isSteam =
    archetype === "welded_seam_rupture" ||
    archetype === "modern_refinery_pipelines" ||
    archetype === "manifold_flanged_pipes";
  const isFurnace =
    archetype === "furnace_billet_extraction" ||
    archetype === "rotary_piercing_mill" ||
    archetype === "seamless_pipe_gliding" ||
    archetype === "hollow_billet_tunnel_pov";

  const audioGraph = isSteam
    ? `anoisesrc=color=white:sample_rate=48000:duration=${dur.toFixed(2)},bandpass=f=2200:width_type=h:width=1600,tremolo=f=3.2:d=0.45,volume=0.22[steam];anoisesrc=color=brown:sample_rate=48000:duration=${dur.toFixed(2)},lowpass=f=210,volume=0.34[rumble];[steam][rumble]amix=inputs=2:duration=first,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.2,afade=t=out:st=${Math.max(0.2, dur - 0.25).toFixed(2)}:d=0.25[aout]`
    : isFurnace
      ? `anoisesrc=color=brown:sample_rate=48000:duration=${dur.toFixed(2)},bandpass=f=125:width_type=h:width=180,tremolo=f=4.8:d=0.38,volume=0.42[furnace];anoisesrc=color=white:sample_rate=48000:duration=${dur.toFixed(2)},highpass=f=2800,tremolo=f=13.0:d=0.72,volume=0.065[sparks];sine=frequency=62:sample_rate=48000:duration=${dur.toFixed(2)},volume=0.05[rollers];[furnace][sparks][rollers]amix=inputs=3:duration=first,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.2,afade=t=out:st=${Math.max(0.2, dur - 0.25).toFixed(2)}:d=0.25[aout]`
      : `anoisesrc=color=pink:sample_rate=48000:duration=${dur.toFixed(2)},lowpass=f=280,volume=0.14,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.2,afade=t=out:st=${Math.max(0.2, dur - 0.25).toFixed(2)}:d=0.25[aout]`;

  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    silentVideoPath,
    "-filter_complex",
    audioGraph,
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-t",
    dur.toFixed(2),
    params.outputPath,
  ]);

  try {
    fs.unlinkSync(silentVideoPath);
  } catch {
    // ignore
  }

  return { outputPath: params.outputPath, archetype };
}
