import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CameraMotionKind } from "../../../src/types/videoPipeline.js";
import { executeWithGoogleKeyFailover } from "../../router.js";
import {
  assertImageToVideoOnly,
  type ClipAttemptTelemetry,
  type ClipGenerationResult,
  type GenerativeVideoRequest,
  type VideoProvider,
} from "./generative.js";

const execFileAsync = promisify(execFile);

/**
 * Normalizes requested duration into gemini-omni-1.2-flash allowed range: '3s' to '15s' in 1s steps.
 */
export function normalizeOmniDurationSec(durationSec: number): number {
  const n = Math.round(Number(durationSec) || 4);
  return Math.max(3, Math.min(15, n));
}

/**
 * Builds a rich 6-layer cinema physics + motion + diegetic sound prompt for Image-to-Video.
 * Designed directly from forensic comparison with broadcast molten-steel reference footage:
 *   1. Primary physical subject dynamics (moving rollers, rolling billets, glowing forge work, machinery)
 *   2. Secondary atmospheric particles (hot flying sparks, rising volumetric smoke, steam & heat shimmer)
 *   3. Cinematic camera kinematics (24fps tracking dolly, push-in, orbital sweep)
 *   4. Dynamic lighting & specular fire/amber reflections against deep teal-charcoal shadows
 *   5. Synchronized diegetic SFX audio cue (furnace roar, metallic rolling rumble, sparks crackling)
 *   6. Visual continuity lock preserving exact starting storyboard composition
 */
export function buildCinemaPhysicsMotionPrompt(params: {
  rawPrompt: string;
  cameraMotion?: CameraMotionKind;
  durationSec?: number;
}): string {
  const raw = (params.rawPrompt || "").replace(/\s+/g, " ").trim();
  const lower = raw.toLowerCase();

  const camMap: Record<CameraMotionKind, string> = {
    "push-in": "Smooth 24fps cinema dolly push-in toward the focal subject with shallow anamorphic depth of field",
    pan: "Fluid lateral tracking camera pan across the action plane at steady 24fps cinematic pace",
    orbit: "Subtle 2.5D orbital arc around the subject revealing layered foreground and background depth",
    static: "Locked cinema tripod shot with micro-handheld breathing while intense physical action unfolds in frame",
  };
  const camLine = camMap[params.cameraMotion || "push-in"];

  // Infer concrete secondary particles, reflections, and diegetic sound cues from scene domain
  const isFurnaceOrMolten =
    /کوره|گداخته|ذوب|شمش|آتش|جرقه|furnace|molten|billet|glowing|ember|forge|spark/i.test(raw);
  const isFactoryOrPipe =
    /کارخانه|لوله|فولاد|نورد|مانیسمان|ماندرل|سوراخ|صنعت|چرخ|غلتک|pipe|steel|mill|factory|roller|piercing|mannesmann|extrusion|hydraulic/i.test(
      raw
    );
  const isHistoricalOrLab =
    /تاریخی|۱۸۸۵|۱۸۸۶|آلمان|برادران|آزمایش|طراحی|نقشه|کاغذ|تست|فشار|گیج|history|1885|1886|vintage|workshop|laboratory|gauge|pressure/i.test(
      lower + " " + raw
    );

  let particleAndPhysics =
    "Natural continuous physical motion inside the scene: floating atmospheric dust motes, drifting volumetric mist, natural cloth/air micro-movement, and realistic surface reflections.";
  let audioCue =
    "Diegetic audio: authentic ambient room tone, subtle tactile foley and realistic environmental acoustics.";

  if (isFurnaceOrMolten) {
    particleAndPhysics =
      "Intense continuous industrial physics: glowing white-hot/amber metal moving forward along spinning steel rollers, bright showering sparks erupting and bouncing off the metal bed, rising billowing heat smoke and shimmer waves distorting the background air, and flickering golden firelight casting moving specular reflections on dark steel surfaces.";
    audioCue =
      "Diegetic audio: deep roaring blast furnace combustion, heavy mechanical conveyor rumble, sharp metallic clanks, and crisp crackling sparks.";
  } else if (isFactoryOrPipe) {
    particleAndPhysics =
      "Heavy mechanical industrial physics: synchronized rotating steel rollers and precision dies pressing and piercing thick steel cylinders, rising white steam and cool mist bursts, micro-sparks and metallic sheen reflections sweeping along brushed steel, and subtle airborne industrial haze illuminated by overhead amber/cyan beams.";
    audioCue =
      "Diegetic audio: powerful hydraulic machinery hum, rhythmic heavy steel rolling rumble, pressurized steam hiss, and resonant factory acoustics.";
  } else if (isHistoricalOrLab) {
    particleAndPhysics =
      "Authentic period atmosphere: gentle dancing warm tungsten/candle flicker, fine dust particles drifting through sunbeams, subtle mechanical needle vibration on brass gauges or water/steam droplets, and crisp depth parallax across historical workshop textures.";
    audioCue =
      "Diegetic audio: quiet historic workshop resonance, faint metallic tick and steam valve hiss, warm analog acoustic presence.";
  }

  return [
    `Animate strictly from the provided starting storyboard image while preserving exact subject identity, colors, and architecture.`,
    `Scene Action & Physics: ${raw || "Photorealistic cinematic scene with rich physical detail and natural movement."}`,
    `Motion & Particle Detail: ${particleAndPhysics}`,
    `Camera & Lighting: ${camLine}. Rich high-contrast cinematic lighting with warm molten amber highlights and deep charcoal-teal shadows, subtle 35mm organic film motion blur.`,
    audioCue,
    `Duration: ${normalizeOmniDurationSec(params.durationSec || 4)} seconds. Zero morphing artifacts, crisp frame-to-frame coherence.`,
  ].join(" ");
}

/**
 * Ensures any local image (including legacy SVG) is converted to a crisp PNG/JPEG buffer for Gemini Interactions API.
 */
async function loadKeyframeAsRasterBuffer(
  keyframePath: string,
  width: number,
  height: number
): Promise<{ mimeType: "image/png" | "image/jpeg"; data: string }> {
  const ext = path.extname(keyframePath).toLowerCase();
  if (ext === ".png") {
    return { mimeType: "image/png", data: fs.readFileSync(keyframePath).toString("base64") };
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return { mimeType: "image/jpeg", data: fs.readFileSync(keyframePath).toString("base64") };
  }
  // Convert webp or svg cleanly to PNG via FFmpeg
  const tmpPng = path.join(os.tmpdir(), `omni_kf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      keyframePath,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      "-frames:v",
      "1",
      tmpPng,
    ]);
    return { mimeType: "image/png", data: fs.readFileSync(tmpPng).toString("base64") };
  } finally {
    try {
      if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng);
    } catch {
      // ignore
    }
  }
}

/**
 * Real Generative Image-to-Video provider powered by Gemini Interactions API (`gemini-omni-1.2-flash`).
 * Produces true physical motion, sparks/smoke particles, camera kinematics, AND native diegetic audio.
 */
export class OmniVideoProvider implements VideoProvider {
  readonly name = "omni_flash";

  async generateClip(req: GenerativeVideoRequest): Promise<ClipGenerationResult> {
    const started = Date.now();
    assertImageToVideoOnly(req);

    const durSec = normalizeOmniDurationSec(req.durationSec);
    const width = req.width || (req.aspectRatio === "16:9" ? 1280 : 720);
    const height = req.height || (req.aspectRatio === "16:9" ? 720 : 1280);
    const targetRes = req.resolution === "1080p" ? "1080p" : "720p";

    const cinemaPrompt = buildCinemaPhysicsMotionPrompt({
      rawPrompt: req.prompt,
      cameraMotion: req.cameraMotion,
      durationSec: durSec,
    });

    const { mimeType, data: imageBase64 } = await loadKeyframeAsRasterBuffer(
      req.keyframePath,
      width,
      height
    );

    const { result: interaction } = await executeWithGoogleKeyFailover(
      {
        taskRole: "video_omni",
        modelId: "gemini-omni-1.2-flash",
        apiVersion: "v1beta",
      },
      async (ai) =>
        (ai.interactions.create as Function)(
          {
            model: "gemini-omni-1.2-flash",
            input: [
              {
                type: "image",
                mime_type: mimeType,
                data: imageBase64,
              },
              {
                type: "text",
                text: cinemaPrompt,
              },
            ],
            background: false,
            store: false,
            stream: false,
            response_format: {
              type: "video",
              aspect_ratio: req.aspectRatio === "16:9" ? "16:9" : "9:16",
              duration: `${durSec}s`,
              resolution: targetRes,
            },
          },
          { timeout: Math.max(240_000, req.timeoutMs || 300_000) }
        )
    );

    const videoPart = interaction?.output_video as { data?: string; mime_type?: string } | undefined;
    if (!videoPart?.data) {
      throw new Error("مدل gemini-omni-1.2-flash داده ویدیویی برنگرداند.");
    }

    fs.mkdirSync(path.dirname(req.outputPath), { recursive: true });
    const rawOutPath = `${req.outputPath}.raw_omni.mp4`;
    fs.writeFileSync(rawOutPath, Buffer.from(videoPart.data, "base64"));

    // Conform strictly to pipeline width/height/fps/yuv420p while keeping native diegetic audio if present!
    const targetFps = req.fps || 24;
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      rawOutPath,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${targetFps},format=yuv420p,setsar=1`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "17",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-t",
      durSec.toFixed(2),
      req.outputPath,
    ]);

    try {
      if (fs.existsSync(rawOutPath)) fs.unlinkSync(rawOutPath);
    } catch {
      // ignore
    }

    const totalDurationMs = Date.now() - started;
    const ramUsedMb = Math.round((os.totalmem() - os.freemem()) / (1024 * 1024));
    const attemptEntry: ClipAttemptTelemetry = {
      attempt: 1,
      provider: "omni_flash",
      success: true,
      durationMs: totalDurationMs,
      vramUsedMb: 0,
      ramUsedMb,
    };

    return {
      outputPath: req.outputPath,
      mimeType: "video/mp4",
      providerUsed: "omni_flash",
      fallbackUsed: false,
      fallbackReason: null,
      attempts: 1,
      totalDurationMs,
      vramUsedMb: 0,
      ramUsedMb,
      subClipsCount: 1,
      sanitizedMotionPrompt: cinemaPrompt,
      attemptLog: [attemptEntry],
    };
  }
}
