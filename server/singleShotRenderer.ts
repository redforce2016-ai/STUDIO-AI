import fs from "node:fs";
import path from "node:path";
import type {
  DirectorShot,
  LocalVideoEngineId,
  ProjectRecord,
  ShotVideoClipRecord,
  StageQualityAudit,
} from "../src/types/studio.js";
import type { TransitionKind } from "../src/types/videoPipeline.js";
import {
  buildSingleShotCompositionPlan,
  renderShotWithEngine,
} from "./localVideoEngines.js";
import {
  auditFinalReelsMasterMp4,
  auditShotVideoMp4,
} from "./qualityAssurance.js";
import {
  getAudioDir,
  getImagesDir,
  getVideosDir,
  getVisualsDir,
} from "./store.js";
import { assembleFinalVideo } from "./video/providers/ffmpeg.js";

export { buildSingleShotCompositionPlan };

function mapTransition(t?: DirectorShot["transitionToNext"]): TransitionKind {
  switch (t) {
    case "whip_pan":
      return "slide";
    case "zoom_in":
      return "zoom";
    case "cross_dissolve":
      return "crossfade";
    default:
      return "cut";
  }
}

export function resolveVisualFrameDiskPath(urlOrNull?: string | null): string | null {
  if (!urlOrNull) return null;
  const base = path.basename(urlOrNull);
  const candidates = [
    path.join(getImagesDir(), base),
    path.join(getVisualsDir(), base),
    path.resolve(process.cwd(), "src", "assets", "images", base),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Renders a single 3-8s shot via the chosen lightweight local engine, runs FFprobe + Vision QA,
 * self-heals once if any technical or visual check fails, and returns ShotVideoClipRecord with qaAudit.
 */
export async function renderSingleStudioShotMp4(params: {
  project: ProjectRecord;
  shot: DirectorShot;
  revisionNote?: string;
  engineId?: LocalVideoEngineId;
}): Promise<ShotVideoClipRecord> {
  const totalShots = params.project.director?.shots.length || 1;
  const durationSeconds = Math.max(
    3,
    Math.min(8, Math.round(Number(params.shot.durationSeconds) || 5))
  );
  const filename = `${params.project.id}_shot_${String(params.shot.shotNumber).padStart(
    2,
    "0"
  )}_${Date.now()}.mp4`;
  const outputPath = path.join(getVideosDir(), filename);

  const plan = buildSingleShotCompositionPlan({
    project: params.project,
    shot: params.shot,
    totalShots,
    revisionNote: params.revisionNote,
  });

  const visualShot = params.project.visuals?.shots.find(
    (v) => v.shotNumber === params.shot.shotNumber
  );
  const frame1Path = resolveVisualFrameDiskPath(visualShot?.imageUrl);
  const frame2Path =
    resolveVisualFrameDiskPath(visualShot?.secondaryImageUrl) ?? frame1Path;

  const requestedEngine: LocalVideoEngineId =
    params.engineId ||
    params.project.brief.preferredVideoEngine ||
    params.shot.recommendedEngine ||
    "hyperframes_html";

  const fixesApplied: string[] = [];
  let renderResult = await renderShotWithEngine({
    engineId: requestedEngine,
    project: params.project,
    shot: params.shot,
    totalShots,
    frame1Path,
    frame2Path,
    outputPath,
    revisionNote: params.revisionNote,
  });
  if (renderResult.fallbackNoteFa) {
    fixesApplied.push(renderResult.fallbackNoteFa);
  }

  let qaAudit = await auditShotVideoMp4({
    videoPath: outputPath,
    shot: params.shot,
    expectedWidth: plan.width,
    expectedHeight: plan.height,
    expectedFps: plan.fps,
    attemptsRun: 1,
    fixesAppliedFa: fixesApplied,
  });

  // Self-Healing Loop: if QA failed, re-render deterministically using HyperFrames + FFmpeg repair
  if (!qaAudit.passed) {
    const failedReason = qaAudit.checks
      .filter((c) => !c.passed)
      .map((c) => c.nameFa)
      .join("، ");
    fixesApplied.push(`اصلاح خودکار پس از بازبینی فنی (${failedReason || "کیفیت فریم"})`);
    if (qaAudit.autoFixPromptFa) {
      fixesApplied.push(`پیشنهاد ناظر بینایی اعمال شد: ${qaAudit.autoFixPromptFa.slice(0, 120)}`);
    }
    renderResult = await renderShotWithEngine({
      engineId: "ffmpeg_cinema",
      project: params.project,
      shot: params.shot,
      totalShots,
      frame1Path,
      frame2Path,
      outputPath,
      revisionNote: qaAudit.autoFixPromptFa || params.revisionNote,
    });
    qaAudit = await auditShotVideoMp4({
      videoPath: outputPath,
      shot: params.shot,
      expectedWidth: plan.width,
      expectedHeight: plan.height,
      expectedFps: plan.fps,
      attemptsRun: 2,
      fixesAppliedFa: fixesApplied,
    });
  }

  return {
    shotNumber: params.shot.shotNumber,
    shotId: plan.shot_id,
    durationSeconds,
    videoUrl: `/api/media/videos/${filename}`,
    videoPath: outputPath,
    approvalStatus: "waiting_approval",
    revisionNote: params.revisionNote || "",
    sfxLabel: params.shot.sfxCueFa || "افکت انتقال نرم",
    engineUsed: renderResult.engineUsed,
    qaAudit,
    renderedAt: new Date().toISOString(),
    error: null,
  };
}

/**
 * Assembles all approved per-shot MP4 clips + WAV voiceover + -14 LUFS audio normalization
 * into the final downloadable Master MP4 for Stage 6, then runs Final Master QA Audit.
 */
export async function assembleApprovedProjectMasterMp4(
  project: ProjectRecord
): Promise<{
  masterVideoUrl: string;
  srtContent: string;
  durationSec: number;
  qaAudit: StageQualityAudit;
}> {
  const directorShots = project.director?.shots ?? [];
  if (directorShots.length === 0) {
    throw new Error("دکوپاژ شات‌ها برای مونتاژ نهایی یافت نشد.");
  }

  const clips = [...(project.shotClips ?? [])];
  const ensuredClips: Array<{
    shot_id: string;
    videoPath: string;
    transition_in: TransitionKind;
    narration_text: string;
    duration_sec: number;
  }> = [];

  for (const shot of directorShots) {
    let clip = clips.find((c) => c.shotNumber === shot.shotNumber);
    if (!clip?.videoPath || !fs.existsSync(clip.videoPath)) {
      clip = await renderSingleStudioShotMp4({ project, shot });
    }
    ensuredClips.push({
      shot_id: clip.shotId,
      videoPath: clip.videoPath!,
      transition_in: mapTransition(shot.transitionToNext),
      narration_text: shot.onScreenText || shot.spokenSegment || "",
      duration_sec: clip.durationSeconds,
    });
  }

  const isHorizontal =
    project.brief.contentFormat === "long_video" || project.brief.platform === "youtube";
  const width = isHorizontal ? 960 : 540;
  const height = isHorizontal ? 540 : 960;

  const workDir = path.join(getVideosDir(), `work_${project.id}_${Date.now()}`);
  const finalFilename = `${project.id}_master_${Date.now()}.mp4`;
  const finalOutPath = path.join(getVideosDir(), finalFilename);
  const srtOutPath = path.join(getVideosDir(), `${project.id}_master.srt`);

  const narrationWavPath = project.voiceover?.audioFilename
    ? path.join(getAudioDir(), path.basename(project.voiceover.audioFilename))
    : null;

  let assembled: Awaited<ReturnType<typeof assembleFinalVideo>>;
  try {
    assembled = await assembleFinalVideo({
      shots: ensuredClips,
      workDir,
      finalOutPath,
      srtOutPath,
      width,
      height,
      fps: 30,
      narrationWavPath,
      includeBackgroundMusic: true,
      burnSubtitles: false, // Each shot already carries crisp HyperFrames RTL Persian Safe-Zone overlay PNG
      targetLufs: -14,
    });
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }

  const expectedTotalDur = directorShots.reduce((s, sh) => s + (sh.durationSeconds || 5), 0);
  const qaAudit = await auditFinalReelsMasterMp4({
    masterPath: finalOutPath,
    shots: directorShots,
    expectedWidth: width,
    expectedHeight: height,
    expectedDurationSec: expectedTotalDur,
  });

  const srtContent = fs.existsSync(srtOutPath) ? fs.readFileSync(srtOutPath, "utf-8") : "";
  return {
    masterVideoUrl: `/api/media/videos/${finalFilename}`,
    srtContent,
    durationSec: assembled.totalDurationSec,
    qaAudit,
  };
}
