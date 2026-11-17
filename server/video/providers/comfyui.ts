import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  detectHardwareSync,
  probeComfyUIServerStats,
  type HardwareProfileId,
} from "../hardware.js";
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
import { ParallaxVideoProvider } from "./parallax.js";

const execFileAsync = promisify(execFile);

export interface ComfyUIProviderOptions {
  baseUrl?: string;
  profile?: HardwareProfileId;
  maxRetries?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  autoFallbackToParallax?: boolean;
}

interface ComfyHistoryOutputItem {
  filename: string;
  subfolder?: string;
  type?: string;
  format?: string;
}

interface ComfyHistoryEntry {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<[string, Record<string, unknown>]>;
  };
  outputs?: Record<
    string,
    {
      gifs?: ComfyHistoryOutputItem[];
      videos?: ComfyHistoryOutputItem[];
      images?: ComfyHistoryOutputItem[];
    }
  >;
}

const DEFAULT_NEGATIVE_PROMPT =
  "fast motion, chaotic camera shake, morphing subject, warped edges, text distortion, blurry, low quality, flickering, black frames";

/**
 * Loads the API-format ComfyUI workflow JSON and replaces ONLY the parameter placeholders:
 * image, prompt, negative_prompt, seed, frame_count, width, height, fps.
 */
export function buildParameterizedComfyWorkflow(params: {
  profile: HardwareProfileId;
  uploadedImageName: string;
  motionPrompt: string;
  negativePrompt?: string;
  seed: number;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
}): Record<string, unknown> {
  const workflowRelPath =
    params.profile === "wan_2_2_or_ltx_2_3_fp8"
      ? "server/video/workflows/ltx23_fp8_i2v_api.json"
      : "server/video/workflows/wan22_5b_gguf_i2v_api.json";

  const fullPath = path.resolve(process.cwd(), workflowRelPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`فایل قالب Workflow API یافت نشد: ${workflowRelPath}`);
  }

  const rawJson = fs.readFileSync(fullPath, "utf-8");

  // Wan & LTX models require frame count = 4k + 1 (e.g. 49, 65, 81)
  const validFrameCount = Math.max(25, Math.round((params.frameCount - 1) / 4) * 4 + 1);
  // Align width & height to multiples of 16 for diffusion VAE
  const alignedWidth = Math.max(256, Math.round(params.width / 16) * 16);
  const alignedHeight = Math.max(256, Math.round(params.height / 16) * 16);

  const replaced = rawJson
    .replace(/"\{\{IMAGE_FILENAME\}\}"/g, JSON.stringify(params.uploadedImageName))
    .replace(/"\{\{MOTION_PROMPT\}\}"/g, JSON.stringify(params.motionPrompt))
    .replace(
      /"\{\{NEGATIVE_PROMPT\}\}"/g,
      JSON.stringify(params.negativePrompt || DEFAULT_NEGATIVE_PROMPT)
    )
    .replace(/"\{\{SEED\}\}"/g, String(Math.abs(Math.trunc(params.seed))))
    .replace(/"\{\{FRAME_COUNT\}\}"/g, String(validFrameCount))
    .replace(/"\{\{WIDTH\}\}"/g, String(alignedWidth))
    .replace(/"\{\{HEIGHT\}\}"/g, String(alignedHeight))
    .replace(/"\{\{FPS\}\}"/g, String(params.fps));

  return JSON.parse(replaced) as Record<string, unknown>;
}

export class ComfyUIProvider implements VideoProvider {
  readonly name = "comfyui";
  private readonly baseUrl: string;
  private readonly profile: HardwareProfileId;
  private readonly maxRetries: number;
  private readonly pollIntervalMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly autoFallbackToParallax: boolean;

  constructor(opts?: ComfyUIProviderOptions) {
    const hw = detectHardwareSync(opts?.baseUrl);
    this.baseUrl = (opts?.baseUrl || process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(
      /\/+$/,
      ""
    );
    this.profile =
      opts?.profile ||
      (hw.selectedProfile === "parallax_only" ? "wan_2_2_5b_gguf" : hw.selectedProfile);
    this.maxRetries = opts?.maxRetries ?? 3;
    this.pollIntervalMs = opts?.pollIntervalMs ?? 1200;
    this.defaultTimeoutMs = opts?.timeoutMs ?? 120_000;
    this.autoFallbackToParallax = opts?.autoFallbackToParallax ?? true;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 1. Upload keyframe image via official ComfyUI `POST /upload/image` (multipart/form-data)
   */
  private async uploadKeyframeToComfy(pngPath: string, timeoutMs: number): Promise<string> {
    const fileBuffer = fs.readFileSync(pngPath);
    const filename = path.basename(pngPath);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: "image/png" });
    formData.append("image", blob, filename);
    formData.append("type", "input");
    formData.append("overwrite", "true");

    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/upload/image`,
      {
        method: "POST",
        body: formData,
      },
      Math.min(15_000, timeoutMs)
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`خطا در آپلود Keyframe به ComfyUI (/upload/image HTTP ${res.status}): ${txt}`);
    }

    const data = (await res.json()) as { name?: string; subfolder?: string };
    if (!data.name) {
      throw new Error("پاسخ /upload/image فاقد نام فایل بود.");
    }
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
  }

  /**
   * 2. Submit API workflow via official ComfyUI `POST /prompt`
   */
  private async queuePrompt(
    workflow: Record<string, unknown>,
    clientId: string,
    timeoutMs: number
  ): Promise<string> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: workflow,
          client_id: clientId,
        }),
      },
      Math.min(15_000, timeoutMs)
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`خطا در ارسال Workflow به ComfyUI (/prompt HTTP ${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      prompt_id?: string;
      node_errors?: Record<string, unknown>;
    };
    if (data.node_errors && Object.keys(data.node_errors).length > 0) {
      throw new Error(`خطای گره‌های ComfyUI: ${JSON.stringify(data.node_errors).slice(0, 240)}`);
    }
    if (!data.prompt_id) {
      throw new Error("پاسخ /prompt فاقد prompt_id بود.");
    }
    return data.prompt_id;
  }

  /**
   * 3. Poll `GET /history/{prompt_id}` until completion or timeout
   */
  private async pollHistoryUntilDone(
    promptId: string,
    timeoutMs: number
  ): Promise<ComfyHistoryOutputItem> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const res = await this.fetchWithTimeout(
        `${this.baseUrl}/history/${encodeURIComponent(promptId)}`,
        { method: "GET" },
        8000
      );

      if (res.ok) {
        const historyMap = (await res.json()) as Record<string, ComfyHistoryEntry>;
        const entry = historyMap[promptId];
        if (entry) {
          if (entry.status?.status_str === "error") {
            throw new Error(
              `اجرای گراف در ComfyUI با خطا متوقف شد: ${JSON.stringify(entry.status.messages || [])}`
            );
          }
          if (entry.status?.completed || entry.outputs) {
            const outputs = entry.outputs || {};
            for (const nodeOut of Object.values(outputs)) {
              const candidate =
                nodeOut.gifs?.[0] || nodeOut.videos?.[0] || nodeOut.images?.[0];
              if (candidate?.filename) {
                return candidate;
              }
            }
            if (entry.status?.completed) {
              throw new Error("اجرای ComfyUI کامل شد اما هیچ فایل خروجی در outputs یافت نشد.");
            }
          }
        }
      }

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }

    throw new Error(`مهلت زمانی (Timeout ${timeoutMs}ms) برای دریافت خروجی از ComfyUI به پایان رسید.`);
  }

  /**
   * 4. Download rendered file via official ComfyUI `GET /view`
   */
  private async downloadOutputFromView(
    item: ComfyHistoryOutputItem,
    destPath: string,
    timeoutMs: number
  ): Promise<void> {
    const qs = new URLSearchParams({
      filename: item.filename,
      subfolder: item.subfolder || "",
      type: item.type || "output",
    });

    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/view?${qs.toString()}`,
      { method: "GET" },
      Math.min(30_000, timeoutMs)
    );

    if (!res.ok) {
      throw new Error(`خطا در دانلود خروجی از /view (HTTP ${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
  }

  /**
   * Free temporary memory on ComfyUI server (`POST /free`)
   */
  private async freeComfyMemory(): Promise<void> {
    try {
      await this.fetchWithTimeout(
        `${this.baseUrl}/free`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unload_models: false, free_memory: true }),
        },
        3000
      );
    } catch {
      // ignore if server offline
    }
  }

  async generateClip(req: GenerativeVideoRequest): Promise<ClipGenerationResult> {
    const overallStart = Date.now();

    // Quality Rule 1: Strictly Image-to-Video only
    assertImageToVideoOnly(req);

    // Quality Rule 2: Gentle & short motion prompt
    const sanitizedMotionPrompt = sanitizeGentleMotionPrompt(req.prompt, req.cameraMotion);

    // Quality Rule 3: Short clip duration (3-5s); longer shots = multiple clips
    const subDurations = splitIntoShortClipDurations(req.durationSec);

    // Quality Rule 4: Preview at low resolution (480p), final render only after Visual Critic approval
    const dims = resolveAllowedClipDimensions(req);
    const width = req.width || dims.width;
    const height = req.height || dims.height;
    const fps = req.fps || 16;
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;

    const outDir = path.dirname(req.outputPath);
    fs.mkdirSync(outDir, { recursive: true });
    const tempDir = path.join(outDir, `comfy_tmp_${req.shotId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const attemptLog: ClipAttemptTelemetry[] = [];
    let peakVramUsedMb = 0;

    try {
      // Rasterize keyframe to PNG inside tempDir so LoadImage in ComfyUI always receives a clean PNG
      const normKeyframePng = path.join(tempDir, `kf_${req.shotId}.png`);
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        req.keyframePath,
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#0B0D11,format=rgb24`,
        "-frames:v",
        "1",
        normKeyframePng,
      ]);

      // Try up to maxRetries (3 attempts) on ComfyUI
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        const attemptStart = Date.now();
        const seed = (req.seed ?? 104729) + attempt * 7919;

        try {
          const statsBefore = await probeComfyUIServerStats(this.baseUrl);
          if (!statsBefore.reachable) {
            throw new Error(
              `سرور محلی ComfyUI در آدرس ${this.baseUrl} در دسترس نیست (تلاش ${attempt}/${this.maxRetries}).`
            );
          }

          const uploadedName = await this.uploadKeyframeToComfy(normKeyframePng, timeoutMs);
          const segmentPaths: string[] = [];

          for (let segIdx = 0; segIdx < subDurations.length; segIdx++) {
            const segSec = subDurations[segIdx];
            const frameCount = segSec * fps + 1;
            const workflow = buildParameterizedComfyWorkflow({
              profile: this.profile,
              uploadedImageName: uploadedName,
              motionPrompt: sanitizedMotionPrompt,
              seed: seed + segIdx * 101,
              frameCount,
              width,
              height,
              fps,
            });

            const clientId = crypto.randomUUID();
            const promptId = await this.queuePrompt(workflow, clientId, timeoutMs);
            const outputItem = await this.pollHistoryUntilDone(promptId, timeoutMs);

            const rawSegPath = path.join(tempDir, `raw_seg_${segIdx + 1}_${outputItem.filename}`);
            await this.downloadOutputFromView(outputItem, rawSegPath, timeoutMs);

            const normSegPath = path.join(tempDir, `seg_${segIdx + 1}.mp4`);
            await execFileAsync("ffmpeg", [
              "-y",
              "-i",
              rawSegPath,
              "-vf",
              `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#0B0D11,fps=30,format=yuv420p`,
              "-c:v",
              "libx264",
              "-preset",
              "fast",
              "-crf",
              "19",
              "-pix_fmt",
              "yuv420p",
              normSegPath,
            ]);
            segmentPaths.push(normSegPath);
          }

          if (segmentPaths.length === 1) {
            fs.copyFileSync(segmentPaths[0], req.outputPath);
          } else {
            const concatFile = path.join(tempDir, "concat.txt");
            fs.writeFileSync(
              concatFile,
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
              concatFile,
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

          const statsAfter = await probeComfyUIServerStats(this.baseUrl);
          const vramUsed =
            statsAfter.vramTotalMb > 0
              ? Math.max(0, statsAfter.vramTotalMb - statsAfter.vramFreeMb)
              : 0;
          peakVramUsedMb = Math.max(peakVramUsedMb, vramUsed);
          const ramUsedMb = Math.round((os.totalmem() - os.freemem()) / (1024 * 1024));

          attemptLog.push({
            attempt,
            provider: "comfyui",
            success: true,
            durationMs: Date.now() - attemptStart,
            vramUsedMb: vramUsed,
            ramUsedMb,
            seed,
          });

          await this.freeComfyMemory();

          return {
            outputPath: req.outputPath,
            mimeType: "video/mp4",
            providerUsed: "comfyui",
            fallbackUsed: false,
            fallbackReason: null,
            attempts: attempt,
            totalDurationMs: Date.now() - overallStart,
            vramUsedMb: peakVramUsedMb,
            ramUsedMb,
            subClipsCount: subDurations.length,
            sanitizedMotionPrompt,
            attemptLog,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const ramUsedMb = Math.round((os.totalmem() - os.freemem()) / (1024 * 1024));
          attemptLog.push({
            attempt,
            provider: "comfyui",
            success: false,
            durationMs: Date.now() - attemptStart,
            vramUsedMb: peakVramUsedMb,
            ramUsedMb,
            seed,
            error: errMsg,
          });
          await this.freeComfyMemory();
        }
      }

      // Quality Rule 5: After 3 generative failures, automatically fall back to local Parallax and report!
      if (this.autoFallbackToParallax) {
        const parallaxProvider = new ParallaxVideoProvider();
        const parallaxResult = await parallaxProvider.generateClip(req);
        const lastComfyErr =
          attemptLog[attemptLog.length - 1]?.error || "عدم پاسخگویی سرور محلی ComfyUI";

        return {
          ...parallaxResult,
          providerUsed: "parallax",
          fallbackUsed: true,
          fallbackReason: `بازگشت خودکار به حالت Parallax پس از ${this.maxRetries} تلاش ناموفق در ComfyUI (${lastComfyErr})`,
          attempts: attemptLog.length + parallaxResult.attempts,
          totalDurationMs: Date.now() - overallStart,
          attemptLog: [...attemptLog, ...parallaxResult.attemptLog],
        };
      }

      throw new Error(
        `تولید کلیپ در ComfyUI پس از ${this.maxRetries} تلاش ناموفق بود: ${
          attemptLog[attemptLog.length - 1]?.error || "خطای ناشناخته"
        }`
      );
    } finally {
      // Always clean up temporary files
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup error
      }
    }
  }
}
