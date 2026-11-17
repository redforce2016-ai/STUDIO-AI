import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CameraMotionKind } from "../../../src/types/videoPipeline.js";
import {
  assertImageToVideoOnly,
  resolveAllowedClipDimensions,
  sanitizeGentleMotionPrompt,
  splitIntoShortClipDurations,
  type ClipAttemptTelemetry,
  type ClipGenerationResult,
  type GenerativeVideoRequest,
  type VideoProvider,
} from "./generative.js";

const execFileAsync = promisify(execFile);

export interface DepthMapResult {
  keyframePngPath: string;
  depthMapPath: string;
  methodUsed: "local_python_midas" | "local_ffmpeg_sobel_depth";
  durationMs: number;
}

/**
 * Generates a local grayscale depth map (depth_map.png) from any keyframe (PNG/JPG/SVG)
 * with zero cloud API calls.
 * Bright pixels (255) = near foreground subject; Dark pixels (0) = distant background.
 */
export async function generateLocalDepthMap(params: {
  keyframePath: string;
  outDir: string;
  width: number;
  height: number;
}): Promise<DepthMapResult> {
  const started = Date.now();
  fs.mkdirSync(params.outDir, { recursive: true });

  const keyframePngPath = path.join(params.outDir, "keyframe_norm.png");
  const depthMapPath = path.join(params.outDir, "depth_map.png");

  // 1. Rasterize / normalize input keyframe (supports .svg via librsvg, .png, .jpg, .webp)
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    params.keyframePath,
    "-vf",
    `scale=${params.width}:${params.height}:force_original_aspect_ratio=decrease,pad=${params.width}:${params.height}:(ow-iw)/2:(oh-ih)/2:color=#0B0D11,format=rgb24`,
    "-frames:v",
    "1",
    keyframePngPath,
  ]);

  // 2. Compute local structural depth map combining:
  //    - Sobel edge magnitude + morphological smoothing (captures foreground subject geometry)
  //    - Luminance contrast elevation + smooth Gaussian depth field
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    keyframePngPath,
    "-vf",
    [
      "format=gray",
      "sobel=scale=2.2:delta=18",
      "gblur=sigma=10",
      "curves=all='0/0.08 0.35/0.45 0.75/0.88 1/1'",
      `scale=${params.width}:${params.height}`,
      "format=gray",
    ].join(","),
    "-frames:v",
    "1",
    depthMapPath,
  ]);

  return {
    keyframePngPath,
    depthMapPath,
    methodUsed: "local_ffmpeg_sobel_depth",
    durationMs: Date.now() - started,
  };
}

/**
 * Renders a single 3-5s 2.5D Parallax sub-clip using the keyframe and its local depth map.
 * Foreground (bright depth) and Background (dark depth) planes move at distinct parallax
 * velocities under gentle virtual camera motion (push-in, pan, or orbit).
 */
async function renderParallaxSubClip(params: {
  keyframePngPath: string;
  depthMapPath: string;
  outputPath: string;
  cameraMotion: CameraMotionKind;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  segmentIndex: number;
}): Promise<void> {
  const { width: w, height: h, fps, durationSec: dur, cameraMotion } = params;
  const totalFrames = Math.max(24, Math.round(dur * fps));

  // Overscan dimensions for smooth sub-pixel translation & scale without black borders
  const bgW = Math.round(w * 1.12);
  const bgH = Math.round(h * 1.12);
  const fgW = Math.round(w * 1.20);
  const fgH = Math.round(h * 1.20);

  // Background plane moves slower (0.4x); Foreground depth-masked plane moves faster (1.0x)
  let bgCropX = `(iw-ow)/2`;
  let bgCropY = `(ih-oh)/2`;
  let fgOverlayX = `(W-w)/2`;
  let fgOverlayY = `(H-h)/2`;

  if (cameraMotion === "pan") {
    const dir = params.segmentIndex % 2 === 0 ? 1 : -1;
    bgCropX = `(iw-ow)/2+${dir}*((t/${dur})-0.5)*${Math.round(w * 0.035)}`;
    bgCropY = `(ih-oh)/2+sin(t*1.2)*4`;
    fgOverlayX = `(W-w)/2+${dir}*((t/${dur})-0.5)*${Math.round(w * 0.085)}`;
    fgOverlayY = `(H-h)/2+cos(t*1.2)*6`;
  } else if (cameraMotion === "orbit") {
    bgCropX = `(iw-ow)/2+sin(t*1.5)*${Math.round(w * 0.03)}`;
    bgCropY = `(ih-oh)/2+cos(t*1.5)*${Math.round(h * 0.02)}`;
    fgOverlayX = `(W-w)/2-sin(t*1.5)*${Math.round(w * 0.075)}`;
    fgOverlayY = `(H-h)/2-cos(t*1.5)*${Math.round(h * 0.035)}`;
  } else {
    // Default gentle "push-in" parallax: background drifts subtly while foreground expands & advances
    bgCropX = `(iw-ow)/2+sin(t*1.1)*${Math.round(w * 0.018)}`;
    bgCropY = `(ih-oh)/2-(t/${dur})*${Math.round(h * 0.028)}`;
    fgOverlayX = `(W-w)/2-sin(t*1.1)*${Math.round(w * 0.042)}`;
    fgOverlayY = `(H-h)/2+(t/${dur})*${Math.round(h * 0.055)}`;
  }

  // Filtergraph:
  // [0:v] = keyframe_norm.png (looped)
  // [1:v] = depth_map.png (looped)
  // 1) Background layer: darkened slightly for depth separation + slow camera drift
  // 2) Foreground layer: keyframe merged with depth_map alpha mask + faster parallax motion
  // 3) Composite foreground over background + gentle continuous zoompan (1.0 -> 1.045) so zero frozen frames occur
  const filterComplex = [
    `[0:v]scale=${bgW}:${bgH},eq=brightness=-0.03:saturation=0.95,gblur=sigma=1.8,crop=${w}:${h}:${bgCropX}:${bgCropY}[bg]`,
    `[0:v]scale=${fgW}:${fgH},format=rgb24[fg_rgb]`,
    `[1:v]scale=${fgW}:${fgH},gblur=sigma=6,format=gray[depth_alpha]`,
    `[fg_rgb][depth_alpha]alphamerge[fg_masked]`,
    `[bg][fg_masked]overlay=x='${fgOverlayX}':y='${fgOverlayY}':shortest=1,zoompan=z='1.0+0.042*(on/${totalFrames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${fps},format=yuv420p[vout]`,
  ].join(";");

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-loop",
      "1",
      "-framerate",
      String(fps),
      "-t",
      dur.toFixed(2),
      "-i",
      params.keyframePngPath,
      "-loop",
      "1",
      "-framerate",
      String(fps),
      "-t",
      dur.toFixed(2),
      "-i",
      params.depthMapPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-t",
      dur.toFixed(2),
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      params.outputPath,
    ],
    { timeout: 60_000 }
  );
}

export class ParallaxVideoProvider implements VideoProvider {
  readonly name = "parallax";

  async generateClip(req: GenerativeVideoRequest): Promise<ClipGenerationResult> {
    const started = Date.now();

    // Rule 1: Strictly Image-to-Video only
    assertImageToVideoOnly(req);

    // Rule 2: Gentle & short motion prompt
    const cameraMotion: CameraMotionKind = req.cameraMotion || "push-in";
    const sanitizedMotionPrompt = sanitizeGentleMotionPrompt(req.prompt, cameraMotion);

    // Rule 3: Short clip duration (3-5s); longer shots = multiple clips
    const subDurations = splitIntoShortClipDurations(req.durationSec);

    // Rule 4: Preview at low resolution (480p), final render only after Visual Critic approval
    const dims = resolveAllowedClipDimensions(req);
    const width = req.width || dims.width;
    const height = req.height || dims.height;
    const fps = req.fps || 30;

    const outDir = path.dirname(req.outputPath);
    fs.mkdirSync(outDir, { recursive: true });
    const tempWorkDir = path.join(outDir, `parallax_tmp_${req.shotId}_${Date.now()}`);
    fs.mkdirSync(tempWorkDir, { recursive: true });

    const persistentDepthPath = path.join(outDir, `${req.shotId}_depth_map.png`);
    const persistentKeyframePng = path.join(outDir, `${req.shotId}_keyframe.png`);

    try {
      // Generate local depth map from keyframe
      const depthRes = await generateLocalDepthMap({
        keyframePath: req.keyframePath,
        outDir: tempWorkDir,
        width,
        height,
      });

      fs.copyFileSync(depthRes.depthMapPath, persistentDepthPath);
      fs.copyFileSync(depthRes.keyframePngPath, persistentKeyframePng);

      const segmentPaths: string[] = [];
      for (let i = 0; i < subDurations.length; i++) {
        const segDur = subDurations[i];
        const segOut = path.join(tempWorkDir, `seg_${String(i + 1).padStart(2, "0")}.mp4`);
        const segMotion: CameraMotionKind =
          i === 0
            ? cameraMotion
            : i % 2 === 1
              ? cameraMotion === "push-in"
                ? "pan"
                : "push-in"
              : "orbit";

        await renderParallaxSubClip({
          keyframePngPath: depthRes.keyframePngPath,
          depthMapPath: depthRes.depthMapPath,
          outputPath: segOut,
          cameraMotion: segMotion,
          durationSec: segDur,
          width,
          height,
          fps,
          segmentIndex: i,
        });
        segmentPaths.push(segOut);
      }

      if (segmentPaths.length === 1) {
        fs.copyFileSync(segmentPaths[0], req.outputPath);
      } else {
        const concatListPath = path.join(tempWorkDir, "concat.txt");
        fs.writeFileSync(
          concatListPath,
          segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
          "utf-8"
        );
        await execFileAsync("ffmpeg", [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatListPath,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "19",
          "-pix_fmt",
          "yuv420p",
          req.outputPath,
        ]);
      }

      const totalDurationMs = Date.now() - started;
      const ramUsedMb = Math.round((os.totalmem() - os.freemem()) / (1024 * 1024));

      const attemptEntry: ClipAttemptTelemetry = {
        attempt: 1,
        provider: "parallax",
        success: true,
        durationMs: totalDurationMs,
        vramUsedMb: 0,
        ramUsedMb,
      };

      return {
        outputPath: req.outputPath,
        mimeType: "video/mp4",
        providerUsed: "parallax",
        fallbackUsed: false,
        fallbackReason: null,
        attempts: 1,
        totalDurationMs,
        vramUsedMb: 0,
        ramUsedMb,
        depthMapPath: persistentDepthPath,
        subClipsCount: subDurations.length,
        sanitizedMotionPrompt,
        attemptLog: [attemptEntry],
      };
    } finally {
      // Clean up temporary sub-clip staging files
      try {
        if (fs.existsSync(tempWorkDir)) {
          fs.rmSync(tempWorkDir, { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup error
      }
    }
  }
}
