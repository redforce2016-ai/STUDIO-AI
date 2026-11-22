import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CinemaLookPreset,
  DeterministicVideoCheck,
  KineticSubtitleStylePreset,
  TransitionKind,
} from "../../../src/types/videoPipeline.js";
import {
  buildCinemaAudioFilterGraph,
  buildCinemaVideoFilterGraph,
  generateCinemaAmbientMusicBed,
  generateCube3dLutFile,
} from "../cinemaMastering.js";
import {
  analyzeNarrationAudioSync,
  generateKineticAssSubtitles,
  getBundledFontsDir,
} from "../kineticSubtitles.js";

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
  const tol = expected.durationToleranceSec ?? 0.35;
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

function splitIntoReelCaptionChunks(text: string, maxWordsPerChunk = 5, maxCharsPerChunk = 34): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let current: string[] = [];
  for (const w of words) {
    const candidate = [...current, w].join(" ");
    const hitPunctuationBreak =
      current.length >= 3 && /[،,.؟!؛:]$/.test(current[current.length - 1]);
    if (
      current.length > 0 &&
      (current.length >= maxWordsPerChunk ||
        candidate.length > maxCharsPerChunk ||
        hitPunctuationBreak)
    ) {
      chunks.push(current.join(" "));
      current = [w];
    } else {
      current.push(w);
    }
  }
  if (current.length > 0) {
    if (current.length === 1 && chunks.length > 0 && chunks[chunks.length - 1].length + current[0].length < maxCharsPerChunk + 8) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${current[0]}`;
    } else {
      chunks.push(current.join(" "));
    }
  }
  return chunks;
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
    const chunks = splitIntoReelCaptionChunks(text, 5, 34);
    const totalWeight = chunks.reduce((sum, c) => sum + Math.max(4, c.length), 0) || 1;
    let subCursor = start;
    for (let i = 0; i < chunks.length; i++) {
      const weight = Math.max(4, chunks[i].length);
      const chunkDur = i === chunks.length - 1 ? Math.max(0.2, end - subCursor) : (s.durationSec * weight) / totalWeight;
      const chunkEnd = Math.min(end, subCursor + chunkDur);
      blocks.push(`${idx}\n${formatSrtTime(subCursor)} --> ${formatSrtTime(chunkEnd)}\n${chunks[i]}\n`);
      subCursor = chunkEnd;
      idx++;
    }
  }
  return blocks.join("\n");
}

function mapXfadeTransition(t: TransitionKind): string {
  switch (t) {
    case "slide":
      return "smoothleft";
    case "zoom":
      return "zoomin";
    case "wipe":
      return "wipeleft";
    case "crossfade":
    default:
      return "dissolve";
  }
}

/**
 * Normalizes a shot MP4 to uniform fps/resolution/yuv420p using Lanczos sharp scaling and preserves diegetic audio.
 */
export async function normalizeShotClip(
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
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},fps=${fps},format=yuv420p,setsar=1`;
  args.push("-vf", vf);

  if (!probe.hasAudio) {
    args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest");
  } else {
    args.push("-map", "0:v:0", "-map", "0:a:0", "-ar", "48000", "-ac", "2");
  }

  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "16", "-c:a", "aac", "-b:a", "192k", outputPath);
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
    onScreenText?: string;
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
  subtitleStylePreset?: KineticSubtitleStylePreset;
  targetLufs?: number;
  colorGradePreset?: CinemaLookPreset;
  musicSource?: "lyria" | "ambient_cinema" | "none";
  musicMoodPrompt?: string;
}): Promise<{
  finalPath: string;
  srtPath: string;
  assPath: string | null;
  cubeLutPath: string | null;
  musicSourceUsed: "lyria" | "ambient_cinema" | "none";
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

  // Write legacy SRT alongside Kinetic ASS
  const srtContent = buildSrtFromShots(
    params.shots.map((s, idx) => ({
      durationSec: normalized[idx]?.duration || s.duration_sec,
      narrationText: s.narration_text,
    }))
  );
  fs.writeFileSync(params.srtOutPath, srtContent, "utf-8");

  const stitchedPath = path.join(params.workDir, "stitched_raw.mp4");
  const xfadeDur = 0.34;

  if (normalized.length === 1) {
    fs.copyFileSync(normalized[0].path, stitchedPath);
  } else {
    const canXfade = normalized.every((n) => n.duration > 0.85 && n.transition !== "cut");
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
        "16",
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
        "16",
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
  const preset: CinemaLookPreset = params.colorGradePreset || "industrial_teal_amber";

  // 0. Analyze real WAV voiceover duration & speech windows for tight audio-to-subtitle synchronization
  const syncPlan = await analyzeNarrationAudioSync(params.narrationWavPath, totalDur);
  const assOutPath = path.join(path.dirname(params.finalOutPath), "kinetic_subtitles.ass");
  const { assContent, cueCount } = generateKineticAssSubtitles({
    shots: params.shots.map((s, idx) => ({
      shotNumber: idx + 1,
      durationSec: normalized[idx]?.duration || s.duration_sec,
      narrationText: s.narration_text,
      onScreenText: s.onScreenText,
    })),
    syncPlan,
    width: params.width,
    height: params.height,
    stylePreset: params.subtitleStylePreset || "industrial_steel_blue",
    includeShotTitles: false,
  });
  let savedAssPath: string | null = null;
  if (cueCount > 0) {
    fs.writeFileSync(assOutPath, assContent, "utf-8");
    savedAssPath = assOutPath;
  }

  // 1. Generate 33^3 3D .cube LUT in output folder for lossless headless mastering & desktop DaVinci export
  let cubeLutPath: string | null = null;
  if (preset !== "none") {
    cubeLutPath = path.join(path.dirname(params.finalOutPath), "cinema_grade.cube");
    generateCube3dLutFile(preset, cubeLutPath);
  }

  // 2. Generate Cinema Background Score (Lyria 3 -> FFmpeg Multi-Harmonic Cinema Underscore)
  let musicPath: string | null = null;
  let musicSourceUsed: "lyria" | "ambient_cinema" | "none" = "none";
  const wantMusic = Boolean(params.includeBackgroundMusic && params.musicSource !== "none");
  if (wantMusic) {
    const scoreOut = path.join(params.workDir, "cinema_score.wav");
    try {
      const musicRes = await generateCinemaAmbientMusicBed({
        outputPath: scoreOut,
        durationSec: totalDur,
        moodPrompt: params.musicMoodPrompt,
        preferLyria: params.musicSource !== "ambient_cinema",
      });
      if (fs.existsSync(musicRes.musicPath)) {
        musicPath = musicRes.musicPath;
        musicSourceUsed = musicRes.source;
      }
    } catch {
      musicPath = null;
      musicSourceUsed = "none";
    }
  }

  // 3. Build Multi-Input High-Clarity Cinema Mastering Command
  const finalArgs: string[] = ["-y", "-i", stitchedPath];
  if (hasNarration && params.narrationWavPath) {
    finalArgs.push("-i", params.narrationWavPath);
  }
  if (musicPath) {
    finalArgs.push("-i", musicPath);
  }

  const audioMaster = buildCinemaAudioFilterGraph({
    totalDurationSec: totalDur,
    hasNarration,
    hasMusic: Boolean(musicPath),
    hasDiegeticAudio: stitchedProbe.hasAudio,
    targetLufs,
    narrationAtempo: syncPlan.recommendedAtempo,
  });

  const videoMaster = buildCinemaVideoFilterGraph({
    inputLabel: "[0:v]",
    outputLabel: "[v_grade]",
    preset,
    cubeLutPath,
    srtPath: params.srtOutPath,
    assPath: savedAssPath,
    fontsDir: getBundledFontsDir(),
    burnSubtitles: Boolean(params.burnSubtitles && (savedAssPath || srtContent.trim())),
  });

  finalArgs.push(
    "-filter_complex",
    `${videoMaster};${audioMaster.filterGraph}`,
    "-map",
    "[v_grade]",
    "-map",
    audioMaster.mapLabel,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level",
    "4.2",
    "-preset",
    "medium",
    "-crf",
    "19",
    "-maxrate",
    "5500k",
    "-bufsize",
    "11000k",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-b:a",
    "160k",
    "-t",
    totalDur.toFixed(2),
    params.finalOutPath
  );

  await execFileAsync("ffmpeg", finalArgs, { timeout: 220_000 });
  const finalProbe = await probeMedia(params.finalOutPath);

  return {
    finalPath: params.finalOutPath,
    srtPath: params.srtOutPath,
    assPath: savedAssPath,
    cubeLutPath,
    musicSourceUsed,
    totalDurationSec: finalProbe.durationSec,
  };
}
