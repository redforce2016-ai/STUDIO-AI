import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import type { VideoAspectFormat } from "../../../src/types/videoPipeline.js";
import { getGoogleApiKeyFromRouter } from "../../router.js";

export interface GenerativeVideoRequest {
  shotId: string;
  prompt: string;
  aspectRatio: VideoAspectFormat;
  durationSec: number;
  resolution: "720p" | "1080p";
  outputPath: string;
  timeoutMs?: number;
}

export interface VideoProvider {
  readonly name: string;
  generateClip(req: GenerativeVideoRequest): Promise<{ outputPath: string; mimeType: string }>;
}

export class GeminiOmniVideoProvider implements VideoProvider {
  readonly name = "gemini-omni-1.2-flash";

  async generateClip(req: GenerativeVideoRequest): Promise<{ outputPath: string; mimeType: string }> {
    const apiKey = getGoogleApiKeyFromRouter();
    if (!apiKey) {
      throw new Error("کلید API گوگل برای تولید ویدیوی Omni در دسترس نیست.");
    }
    const ai = new GoogleGenAI({
      apiKey,
      apiVersion: "v1beta",
      httpOptions: {
        apiVersion: "v1beta",
        headers: { "User-Agent": "aistudio-build" },
      },
    });

    const clampedSec = Math.max(3, Math.min(15, Math.round(req.durationSec)));
    const interaction = await ai.interactions.create(
      {
        model: "gemini-omni-1.2-flash",
        input: req.prompt,
        background: false,
        store: false,
        stream: false,
        response_format: {
          type: "video",
          aspect_ratio: req.aspectRatio,
          duration: `${clampedSec}s`,
          resolution: req.resolution,
        } as never,
      },
      { timeout: req.timeoutMs ?? 180_000 }
    );

    const videoPart = interaction.output_video;
    if (!videoPart?.data) {
      throw new Error("مدل Omni ویدیویی برنگرداند.");
    }

    fs.mkdirSync(path.dirname(req.outputPath), { recursive: true });
    const buffer = Buffer.from(videoPart.data, "base64");
    fs.writeFileSync(req.outputPath, buffer);

    return {
      outputPath: req.outputPath,
      mimeType: videoPart.mime_type || "video/mp4",
    };
  }
}
