import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DeterministicVideoCheck,
  TransitionKind,
} from "../../../src/types/videoPipeline.js";

const execFileAsync = promisify(execFile);

export interface ProbeMediaInfo {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

function parseFpsFraction(rateStr?: string): number {
  if (!rateStr) return 0;
  const parts = rateStr.split("/");
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    return den > 0 ? Math.round((num / den) * 100) / 100 : 0;
  }
  const n = Number(rateStr);
  return Number.isFinite(n) ? n : 0;
}

export async function probeMedia(filePath: string): Promise<ProbeMediaInfo> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }>;
  };
  const streams = parsed.streams || [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const durationSec = Number(parsed.format?.duration || 0);
  const fps = parseFpsFraction(video?.avg_frame_rate || video?.r_frame_rate);

  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    fps,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

export async function runDeterministicChecks(
  videoPath: string,
  expected: {
    durationSec: number;
    width: number;
    height: number;
    fps: number;
    durationToleranceSec?: number;
    requireAudio?: boolean;
  }
): Promise<DeterministicVideoCheck> {
  const failures: string[] = [];
  if (!fs.existsSync(videoPath)) {
    return {
      passed: false,
      duration_sec: 0,
      duration_delta_sec: expected.durationSec,
      width: 0,
      height: 0,
      fps: 0,
      has_video_stream: false,
      has_audio_stream: false,
      black_frames_detected: true,
      frozen_frames_detected: true,
      mean_volume_db: null,
      failures: ["فایل MP4 خروجی یافت نشد."],
    };
  }

  const probe = await probeMedia(videoPath);
  const tol = expected.durationToleranceSec ?? 0.15;
  const durationDelta = Math.abs(probe.durationSec - expected.durationSec);

  if (!probe.hasVideo) failures.push("استریم ویدیو در فایل یافت نشد.");
  if (expected.requireAudio && !probe.hasAudio) failures.push("استریم صدا در فایل یافت نشد.");
  if (probe.width !== expected.width || probe.height !== expected.height) {
    failures.push(
      `ابعاد خروجی (${probe.width}x${probe.height}) با مقدار مورد انتظار (${expected.width}x${expected.height}) هم‌خوانی ندارد.`
    );
  }
  if (Math.abs(probe.fps - expected.fps) > 1.5) {
    failures.push(`نرخ فریم (${probe.fps}) با ${expected.fps} هم‌خوانی ندارد.`);
  }
  if (durationDelta > tol) {
    failures.push(
      `اختلاف مدت‌زمان (${durationDelta.toFixed(2)}s) از تلورانس مجاز (${tol}s) بیشتر است.`
    );
  }

  // Run blackdetect & freezedetect via FFmpeg null sink
  let blackDetected = false;
  let freezeDetected = false;
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-i",
      videoPath,
      "-vf",
      "blackdetect=d=0.45:pix_th=0.10,freezedetect=n=-60dB:d=2.0",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    if (/black_duration:\s*([0-9.]+)/.test(stderr)) {
      const m = stderr.match(/black_duration:\s*([0-9.]+)/);
      if (m && Number(m[1]) >= 0.45) {
        blackDetected = true;
        failures.push(`فریم تماماً سیاه طولانی (${m[1]}s) شناسایی شد.`);
      }
    }
    if (/freeze_duration:\s*([0-9.]+)/.test(stderr)) {
      const m = stderr.match(/freeze_duration:\s*([0-9.]+)/);
      if (m && Number(m[1]) >= 2.0) {
        freezeDetected = true;
        failures.push(`فریز شدن تصویر (${m[1]}s بدون تغییر) شناسایی شد.`);
      }
    }
  } catch {
    // non-fatal if filter check errors on tiny clips
  }

  // Optional audio loudness probe
  let meanVolumeDb: number | null = null;
  if (probe.hasAudio) {
    try {
      const { stderr } = await execFileAsync("ffmpeg", [
        "-i",
        videoPath,
        "-af",
        "volumedetect",
        "-vn",
        "-f",
        "null",
        "-",
      ]);
      const match = stderr.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/);
      if (match) meanVolumeDb = Number(match[1]);
    } catch {
      meanVolumeDb = null;
    }
  }

  return {
    passed: failures.length === 0,
    duration_sec: Math.round(probe.durationSec * 100) / 100,
    duration_delta_sec: Math.round(durationDelta * 100) / 100,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    has_video_stream: probe.hasVideo,
    has_audio_stream: probe.hasAudio,
    black_frames_detected: blackDetected,
    frozen_frames_detected: freezeDetected,
    mean_volume_db: meanVolumeDb,
    failures,
  };
}

/**
 * Extracts first, middle, last, and regular interval frames (0.5-1s) via FFmpeg.
 */
export async function extractFrames(
  videoPath: string,
  outDir: string,
  durationSec: number
): Promise<Array<{ label: string; timestampSec: number; filePath: string }>> {
  fs.mkdirSync(outDir, { recursive: true });
  const safeDur = Math.max(0.6, durationSec);
  const step = safeDur <= 5 ? 0.8 : 1.2;

  const timestamps = new Set<number>();
  timestamps.add(0.15);
  timestamps.add(Number((safeDur / 2).toFixed(2)));
  timestamps.add(Number(Math.max(0.2, safeDur - 0.18).toFixed(2)));
  for (let t = step; t < safeDur - 0.25; t += step) {
    timestamps.add(Number(t.toFixed(2)));
  }

  const sorted = Array.from(timestamps)
    .sort((a, b) => a - b)
    .slice(0, 7);

  const results: Array<{ label: string; timestampSec: number; filePath: string }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const ts = sorted[i];
    const filename = `frame_${String(i + 1).padStart(2, "0")}_${ts.toFixed(2)}s.png`;
    const filePath = path.join(outDir, filename);
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      ts.toFixed(2),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      filePath,
    ]);
    if (fs.existsSync(filePath)) {
      const label =
        i === 0
          ? `فریم شروع (${ts.toFixed(1)}s)`
          : i === sorted.length - 1
            ? `فریم پایانی (${ts.toFixed(1)}s)`
            : `فریم میانی (${ts.toFixed(1)}s)`;
      results.push({ label, timestampSec: ts, filePath });
    }
  }
  return results;
}

function formatSrtTime(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const hrs = Math.floor(totalMs / 3_600_000);
  const mins = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const p3 = (n: number) => String(n).padStart(3, "0");
  return `${p2(hrs)}:${p2(mins)}:${p2(secs)},${p3(ms)}`;
}

export function buildSrtFromShots(
  shots: Array<{ durationSec: number; narrationText: string }>
): string {
  let cursor = 0;
  const blocks: string[] = [];
  let idx = 1;
  for (const s of shots) {
    const text = s.narrationText.trim();
    const start = cursor;
    const end = cursor + s.durationSec;
    cursor = end;
    if (!text) continue;
    blocks.push(`${idx}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`);
    idx++;
  }
  return blocks.join("\n");
}

function mapXfadeTransition(t: TransitionKind): string {
  switch (t) {
    case "slide":
      return "slideleft";
    case "zoom":
      return "smoothup";
    case "wipe":
      return "wipeleft";
    case "crossfade":
    default:
      return "fade";
  }
}

/**
 * Normalizes a shot MP4 to uniform fps/resolution/yuv420p and guarantees an audio stream (silent if absent).
 */
async function normalizeShotClip(
  inputPath: string,
  outputPath: string,
  width: number,
  height: number,
  fps: number
): Promise<number> {
  const probe = await probeMedia(inputPath);
  const args: string[] = ["-y", "-i", inputPath];
  if (!probe.hasAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#0B0D11,fps=${fps},format=yuv420p,setsar=1`;
  args.push("-vf", vf);

  if (!probe.hasAudio) {
    args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest");
  } else {
    args.push("-map", "0:v:0", "-map", "0:a:0", "-ar", "48000", "-ac", "2");
  }

  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "19", "-c:a", "aac", "-b:a", "192k", outputPath);
  await execFileAsync("ffmpeg", args);
  const outProbe = await probeMedia(outputPath);
  return outProbe.durationSec;
}

export async function assembleFinalVideo(params: {
  shots: Array<{
    shot_id: string;
    videoPath: string;
    transition_in: TransitionKind;
    narration_text: string;
    duration_sec: number;
  }>;
  workDir: string;
  finalOutPath: string;
  srtOutPath: string;
  width: number;
  height: number;
  fps: number;
  narrationWavPath?: string | null;
  includeBackgroundMusic?: boolean;
  burnSubtitles?: boolean;
  targetLufs?: number;
}): Promise<{
  finalPath: string;
  srtPath: string;
  totalDurationSec: number;
}> {
  fs.mkdirSync(params.workDir, { recursive: true });
  const normDir = path.join(params.workDir, "normalized");
  fs.mkdirSync(normDir, { recursive: true });

  const normalized: Array<{ path: string; duration: number; transition: TransitionKind }> = [];
  for (let i = 0; i < params.shots.length; i++) {
    const s = params.shots[i];
    const normPath = path.join(normDir, `norm_${String(i + 1).padStart(2, "0")}_${s.shot_id}.mp4`);
    const dur = await normalizeShotClip(s.videoPath, normPath, params.width, params.height, params.fps);
    normalized.push({ path: normPath, duration: dur, transition: s.transition_in });
  }

  // Write SRT
  const srtContent = buildSrtFromShots(
    params.shots.map((s, idx) => ({
      durationSec: normalized[idx]?.duration || s.duration_sec,
      narrationText: s.narration_text,
    }))
  );
  fs.writeFileSync(params.srtOutPath, srtContent, "utf-8");

  const stitchedPath = path.join(params.workDir, "stitched_raw.mp4");
  const xfadeDur = 0.3;

  if (normalized.length === 1) {
    fs.copyFileSync(normalized[0].path, stitchedPath);
  } else {
    // Build xfade + acrossfade filtergraph if all clips > 0.8s, otherwise concat demuxer
    const canXfade = normalized.every((n) => n.duration > 0.8 && n.transition !== "cut");
    if (canXfade) {
      const inputs: string[] = [];
      for (const n of normalized) {
        inputs.push("-i", n.path);
      }

      const vFilters: string[] = [];
      const aFilters: string[] = [];
      let prevV = "[0:v]";
      let prevA = "[0:a]";
      let accumDur = normalized[0].duration;

      for (let i = 1; i < normalized.length; i++) {
        const offset = Math.max(0.1, accumDur - xfadeDur);
        const nextV = i === normalized.length - 1 ? "[vout]" : `[v${i}]`;
        const nextA = i === normalized.length - 1 ? "[aout]" : `[a${i}]`;
        const trans = mapXfadeTransition(normalized[i].transition);
        vFilters.push(
          `${prevV}[${i}:v]xfade=transition=${trans}:duration=${xfadeDur}:offset=${offset.toFixed(3)}${nextV}`
        );
        aFilters.push(`${prevA}[${i}:a]acrossfade=d=${xfadeDur}${nextA}`);
        prevV = nextV;
        prevA = nextA;
        accumDur = accumDur + normalized[i].duration - xfadeDur;
      }

      await execFileAsync("ffmpeg", [
        "-y",
        ...inputs,
        "-filter_complex",
        `${vFilters.join(";")};${aFilters.join(";")}`,
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        stitchedPath,
      ]);
    } else {
      const concatTxt = path.join(params.workDir, "concat_list.txt");
      fs.writeFileSync(
        concatTxt,
        normalized.map((n) => `file '${n.path.replace(/'/g, "'\\''")}'`).join("\n"),
        "utf-8"
      );
      await execFileAsync("ffmpeg", [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatTxt,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        stitchedPath,
      ]);
    }
  }

  const stitchedProbe = await probeMedia(stitchedPath);
  const totalDur = Math.max(1, stitchedProbe.durationSec);
  const hasNarration = Boolean(params.narrationWavPath && fs.existsSync(params.narrationWavPath));
  const targetLufs = params.targetLufs ?? -14;

  // Mix narration + optional ambient bed with sidechaincompress ducking + -14 LUFS loudnorm
  const finalArgs: string[] = ["-y", "-i", stitchedPath];
  const filterChains: string[] = [];

  if (hasNarration && params.narrationWavPath) {
    finalArgs.push("-i", params.narrationWavPath);
    if (params.includeBackgroundMusic) {
      // Generate gentle low-level ambient harmonic pad via FFmpeg sine synthesis and duck under narration
      finalArgs.push(
        "-f",
        "lavfi",
        "-t",
        totalDur.toFixed(2),
        "-i",
        "sine=frequency=110:sample_rate=48000"
      );
      filterChains.push(
        `[2:a]volume=0.05,lowpass=f=320,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bgm]`,
        `[1:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${totalDur.toFixed(2)}[vo]`,
        `[vo]asplit=2[vo_sc][vo_mix]`,
        `[bgm][vo_sc]sidechaincompress=threshold=0.02:ratio=6:attack=25:release=350[ducked_bgm]`,
        `[vo_mix][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[a_norm]`
      );
    } else {
      filterChains.push(
        `[1:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${totalDur.toFixed(2)},loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[a_norm]`
      );
    }
  } else {
    filterChains.push(
      `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[a_norm]`
    );
  }

  let videoMap = "0:v";
  if (params.burnSubtitles && srtContent.trim()) {
    const escapedSrt = params.srtOutPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    filterChains.push(
      `[0:v]subtitles='${escapedSrt}':force_style='FontName=Vazirmatn,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=1,MarginV=36'[v_sub]`
    );
    videoMap = "[v_sub]";
  }

  finalArgs.push(
    "-filter_complex",
    filterChains.join(";"),
    "-map",
    videoMap,
    "-map",
    "[a_norm]",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    totalDur.toFixed(2),
    params.finalOutPath
  );

  try {
    await execFileAsync("ffmpeg", finalArgs);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const tail = rawMsg.split("\n").filter((l) => l.trim() && !l.trim().startsWith("configuration:") && !l.trim().startsWith("lib")).slice(-3).join(" | ");
    throw new Error(`خطا در مونتاژ نهایی FFmpeg: ${tail.slice(0, 260)}`);
  }
  const finalProbe = await probeMedia(params.finalOutPath);

  return {
    finalPath: params.finalOutPath,
    srtPath: params.srtOutPath,
    totalDurationSec: finalProbe.durationSec,
  };
}
