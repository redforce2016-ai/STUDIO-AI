import { Annotation, END, MemorySaver, START, Send, StateGraph } from "@langchain/langgraph";
import fs from "node:fs";
import path from "node:path";
import type { DirectorOutput, ResearchAndScriptOutput } from "../../src/types/studio.js";
import type {
  CinemaLookPreset,
  FinalQaReport,
  KineticSubtitleStylePreset,
  ShotCompositionPlan,
  ShotExecutionRecord,
  ShotSpec,
  ShotToolKind,
  VideoAspectFormat,
  VideoPipelineLog,
  VideoPipelineRun,
  VideoQualityMode,
  VisualCriticIssue,
} from "../../src/types/videoPipeline.js";
import { getAudioDir, getImagesDir, getProject, getVideosDir, getVisualsDir } from "../store.js";
import { getActiveRemoteComfyUrl } from "../cloudGpuNotebooks.js";
import { getColabBridgeConfig } from "../colabBridge.js";
import { extractDavinciClipsFromProject, generateOpenTimelineIoJson } from "../davinciResolveExport.js";
import { generateAfterEffectsExtendScriptJsx } from "./afterEffectsExporter.js";
import {
  buildDeterministicCompositionFromShot,
  buildShotCompositionPlan,
  evaluateFinalVideoQa,
  evaluateShotWithVisualCritic,
  parseScenarioToShotSpecs,
  planShotsForProduction,
} from "./agents.js";
import { getRunOutputDir, getVideoConfig, resolveDimensions } from "./config.js";
import {
  BlenderUnavailableError,
  isBlenderInstalled,
  isColabBlenderReady,
  renderBlenderShot,
} from "./providers/blender.js";
import { ComfyUIProvider } from "./providers/comfyui.js";
import {
  assembleFinalVideo,
  extractFrames,
  normalizeShotClip,
  probeMedia,
  runDeterministicChecks,
} from "./providers/ffmpeg.js";
import { buildIndustrialPipeKeyframeSvg } from "./providers/generative.js";
import { renderHyperFramesShot } from "./providers/hyperframes.js";
import { OmniVideoProvider } from "./providers/omniVideo.js";
import { ParallaxVideoProvider } from "./providers/parallax.js";
import { renderRemotionShot } from "./providers/remotion.js";
import { validateCompositionPlanSafety } from "./schemas.js";

function createLog(
  node: string,
  level: VideoPipelineLog["level"],
  message: string,
  extra?: { shot_id?: string; attempt?: number; data?: Record<string, unknown> }
): VideoPipelineLog {
  return {
    timestamp: new Date().toISOString(),
    node,
    shot_id: extra?.shot_id,
    attempt: extra?.attempt,
    level,
    message,
    data: extra?.data,
  };
}

// ============================================================================
// Live Run Store (persists disk checkpoints + lets UI poll in real time)
// ============================================================================
const activeRuns = new Map<string, VideoPipelineRun>();

function persistRunSnapshot(run: VideoPipelineRun): VideoPipelineRun {
  const updated = { ...run, updatedAt: new Date().toISOString() };
  activeRuns.set(updated.runId, updated);
  const runDir = getRunOutputDir(updated.runId);
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export function getVideoRun(runId: string): VideoPipelineRun | null {
  const mem = activeRuns.get(runId);
  if (mem) return mem;
  const diskPath = path.join(getRunOutputDir(runId), "run.json");
  if (fs.existsSync(diskPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(diskPath, "utf-8")) as VideoPipelineRun;
      activeRuns.set(runId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function updateShotInRun(
  runId: string,
  shotId: string,
  patch: Partial<ShotExecutionRecord>,
  log?: VideoPipelineLog
) {
  const current = getVideoRun(runId);
  if (!current) return;
  const shots = current.shots.map((s) => (s.shot_id === shotId ? { ...s, ...patch } : s));
  const logs = log ? [...current.logs, log] : current.logs;
  persistRunSnapshot({
    ...current,
    currentNode: log?.node || current.currentNode,
    shots,
    logs,
  });
}

function appendRunLog(runId: string, log: VideoPipelineLog, patch?: Partial<VideoPipelineRun>) {
  const current = getVideoRun(runId);
  if (!current) return;
  persistRunSnapshot({
    ...current,
    ...(patch || {}),
    currentNode: log.node,
    logs: [...current.logs, log],
  });
}

// ============================================================================
// Subgraph (Nodes 4–8): Per-Shot Build -> Render -> Extract -> Visual Critic -> Decision
// Runs inside LangGraph Send branches in parallel, looping up to 3 attempts!
// ============================================================================
const ShotWorkerAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  projectId: Annotation<string | undefined>({ reducer: (_, n) => n, default: () => undefined }),
  scenarioText: Annotation<string>(),
  aspectRatio: Annotation<VideoAspectFormat>(),
  qualityMode: Annotation<VideoQualityMode>(),
  maxAttempts: Annotation<number>({ reducer: (_, n) => n, default: () => 3 }),
  humanInstruction: Annotation<string | undefined>({ reducer: (_, n) => n, default: () => undefined }),
  bypassCache: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  shot: Annotation<ShotSpec>({ reducer: (_, n) => n }),
  attempt: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  priorIssues: Annotation<VisualCriticIssue[]>({ reducer: (_, n) => n, default: () => [] }),
  plan: Annotation<ShotCompositionPlan | null>({ reducer: (_, n) => n, default: () => null }),
  renderPath: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  cacheHit: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  toolUsed: Annotation<ShotToolKind>({ reducer: (_, n) => n, default: () => "remotion" }),
  fallbackUsed: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  fallbackReason: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  frameFiles: Annotation<Array<{ label: string; timestampSec: number; filePath: string }>>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  executionRecord: Annotation<ShotExecutionRecord | null>({ reducer: (_, n) => n, default: () => null }),
});

type ShotWorkerState = typeof ShotWorkerAnnotation.State;

// Node 4: builder
async function builderNode(state: ShotWorkerState) {
  const nextAttempt = state.attempt + 1;
  const spec = state.shot;

  updateShotInRun(
    state.runId,
    spec.shot_id,
    { status: "building", attempts: nextAttempt },
    createLog("builder", "info", `ساخت کد/Spec کامپوننت‌های شات ${spec.shot_id} (تلاش ${nextAttempt}/${state.maxAttempts})`, {
      shot_id: spec.shot_id,
      attempt: nextAttempt,
    })
  );

  const isKeyframeVideoTool =
    spec.tool === "parallax" ||
    spec.tool === "comfyui" ||
    spec.tool === "omni_flash" ||
    spec.tool === "generative_api";
  const plan = isKeyframeVideoTool
    ? buildDeterministicCompositionFromShot(spec)
    : await buildShotCompositionPlan({
        spec,
        attempt: nextAttempt,
        priorIssues: state.priorIssues,
        humanInstruction: state.humanInstruction,
      });

  const safety = validateCompositionPlanSafety(plan);
  const safePlan = safety.valid ? plan : buildDeterministicCompositionFromShot(spec);

  updateShotInRun(state.runId, spec.shot_id, { compositionPlan: safePlan });

  return {
    attempt: nextAttempt,
    plan: safePlan,
  };
}

// Node 5: renderer
async function rendererNode(state: ShotWorkerState) {
  const cfg = getVideoConfig();
  const spec = state.shot;
  const plan = state.plan || buildDeterministicCompositionFromShot(spec);
  const runDir = getRunOutputDir(state.runId);
  const shotDir = path.join(runDir, "shots", spec.shot_id);
  fs.mkdirSync(shotDir, { recursive: true });
  const outMp4 = path.join(shotDir, `attempt_${state.attempt}.mp4`);

  updateShotInRun(
    state.runId,
    spec.shot_id,
    { status: "rendering" },
    createLog("renderer", "info", `رندر شات ${spec.shot_id} با موتور ${spec.tool}`, {
      shot_id: spec.shot_id,
      attempt: state.attempt,
    })
  );

  let toolUsed: ShotToolKind = spec.tool;
  let fallbackUsed = Boolean(spec.fallback_used);
  let fallbackReason: string | null = spec.fallback_reason || null;
  let cacheHit = false;
  let renderDurationMs = 0;
  let vramUsedMb = 0;
  let ramUsedMb = 0;
  let subClipsCount = 1;
  let depthMapUrl: string | null = null;

  let renderError: string | null = null;
  const renderStarted = Date.now();

  try {
    // Always prioritize and preserve a verified Stage 3 Real Live-Action HD shot clip on disk
    // regardless of whether tool_router suggested remotion/blender/omni_flash/parallax!
    let reusedStage3Path: string | null = null;
    if (!state.bypassCache && state.projectId) {
      const proj = getProject(state.projectId);
      const visMatch = proj?.visuals?.shots?.find((v) => v.shotNumber === spec.shot_number);
      if (visMatch?.videoUrl && visMatch.videoUrl.startsWith("/api/media/videos/")) {
        const diskVid = path.join(getVideosDir(), path.basename(visMatch.videoUrl));
        if (fs.existsSync(diskVid)) {
          const p = await probeMedia(diskVid).catch(() => null);
          if (p && p.hasVideo && p.width >= 720 && p.durationSec >= 2.5) {
            reusedStage3Path = diskVid;
          }
        }
      }
    }

    if (reusedStage3Path) {
      await normalizeShotClip(reusedStage3Path, outMp4, spec.resolution[0], spec.resolution[1], spec.fps);
      cacheHit = true;
      renderDurationMs = Date.now() - renderStarted;
      fallbackReason = "استفاده مستقیم از فیلم مستند زنده تاییدشده مرحله ۳ با هم‌ترازی کامل رزولوشن و فریم‌ریت";
    } else if (spec.tool === "hyperframes") {
      const hfRes = await renderHyperFramesShot({
        spec,
        outputPath: outMp4,
        keyframeImagePath: spec.visual.keyframe_path || null,
        timeoutMs: cfg.shotRenderTimeoutMs,
      });
      toolUsed = "hyperframes";
      renderDurationMs = hfRes.durationMs;
      fallbackUsed = false;
      fallbackReason = "رندر ۱۰۰٪ رایگان و دقیق با موتور HyperFrames (ذرات معلق + نور فلزی + تایپوگرافی مدرن فارسی)";
    } else if (spec.tool === "blender") {
      try {
        const bRes = await renderBlenderShot({
          shotId: spec.shot_id,
          spec,
          blenderPrompt: spec.visual.blender_prompt || spec.intent,
          durationSec: spec.duration_sec,
          width: spec.resolution[0],
          height: spec.resolution[1],
          fps: spec.fps,
          outputPath: outMp4,
          timeoutMs: cfg.shotRenderTimeoutMs,
        });
        toolUsed = "blender";
        fallbackReason =
          bRes.executionHost === "colab_gpu_blender"
            ? "رندر واقعی سه‌بعدی PBR با Blender 4.2 روی Google Colab GPU"
            : "رندر واقعی سه‌بعدی PBR با Blender محلی";
      } catch (err) {
        toolUsed = "hyperframes";
        fallbackUsed = true;
        fallbackReason =
          err instanceof BlenderUnavailableError
            ? err.message
            : `خطا در Blender، انتقال به HyperFrames: ${err instanceof Error ? err.message : String(err)}`;
        await renderHyperFramesShot({
          spec,
          outputPath: outMp4,
          keyframeImagePath: spec.visual.keyframe_path || null,
          timeoutMs: cfg.shotRenderTimeoutMs,
        });
      }
      renderDurationMs = Date.now() - renderStarted;
    } else if (
      spec.tool === "omni_flash" ||
      spec.tool === "comfyui" ||
      spec.tool === "parallax" ||
      spec.tool === "generative_api"
    ) {
      {
        // Ensure local keyframe exists (Strictly Image-to-Video; Text-to-Video is forbidden)
        let keyframePath = spec.visual.keyframe_path?.trim() || "";
        if (!keyframePath || !fs.existsSync(keyframePath)) {
          const autoKeyframeSvgPath = path.join(shotDir, `${spec.shot_id}_keyframe.svg`);
          fs.writeFileSync(autoKeyframeSvgPath, buildIndustrialPipeKeyframeSvg(spec), "utf-8");
          keyframePath = autoKeyframeSvgPath;
        }

        const forceParallaxByQa = state.attempt >= 3 || spec.tool === "parallax";
        const remoteComfyUrl = getActiveRemoteComfyUrl();
        const clipReq = {
          shotId: spec.shot_id,
          shotNumber: spec.shot_number,
          keyframePath,
          prompt: spec.visual.generative_prompt || spec.intent,
          cameraMotion: spec.visual.camera_motion,
          aspectRatio: state.aspectRatio,
          durationSec: spec.duration_sec,
          qualityMode: state.qualityMode,
          resolution: (state.qualityMode === "final_1080p" ? "1080p" : "480p") as "1080p" | "480p",
          width: spec.resolution[0],
          height: spec.resolution[1],
          fps: spec.fps,
          visualCriticApprovedPreview: state.attempt > 1,
          outputPath: outMp4,
          timeoutMs: cfg.shotRenderTimeoutMs,
        };

        let clipRes;
        if (!forceParallaxByQa && spec.tool === "omni_flash") {
          try {
            const omni = new OmniVideoProvider();
            clipRes = await omni.generateClip(clipReq);
          } catch (omniErr) {
            const errMsg = omniErr instanceof Error ? omniErr.message : String(omniErr);
            const parallax = new ParallaxVideoProvider();
            clipRes = await parallax.generateClip(clipReq);
            clipRes = {
              ...clipRes,
              fallbackUsed: true,
              fallbackReason: `فال‌بک به موتور 2.5D Depth Parallax پس از خطای Omni Flash: ${errMsg}`,
            };
          }
        } else {
          const provider = forceParallaxByQa
            ? new ParallaxVideoProvider()
            : new ComfyUIProvider({
                baseUrl: remoteComfyUrl || undefined,
                autoFallbackToParallax: true,
              });
          clipRes = await provider.generateClip(clipReq);
        }

        toolUsed = clipRes.providerUsed;
        fallbackUsed = fallbackUsed || clipRes.fallbackUsed || forceParallaxByQa;
        fallbackReason = clipRes.fallbackReason || fallbackReason;
        renderDurationMs = clipRes.totalDurationMs;
        vramUsedMb = clipRes.vramUsedMb;
        ramUsedMb = clipRes.ramUsedMb;
        subClipsCount = clipRes.subClipsCount;
        if (clipRes.depthMapPath && fs.existsSync(clipRes.depthMapPath)) {
          depthMapUrl = `/api/media/video-runs/${state.runId}/shots/${spec.shot_id}/${path.basename(
            clipRes.depthMapPath
          )}`;
        }
      }
    } else {
      const remRes = await renderRemotionShot({
        plan,
        outputPath: outMp4,
        timeoutMs: cfg.shotRenderTimeoutMs,
        bypassCache: state.bypassCache || state.attempt > 1,
      });
      cacheHit = remRes.cacheHit;
      renderDurationMs = Date.now() - renderStarted;
    }
  } catch (err) {
    renderError = err instanceof Error ? err.message : String(err);
    renderDurationMs = Date.now() - renderStarted;
    appendRunLog(
      state.runId,
      createLog("renderer", "error", `خطا در رندر شات ${spec.shot_id}: ${renderError}`, {
        shot_id: spec.shot_id,
        attempt: state.attempt,
      })
    );
  }

  const renderOk = !renderError && fs.existsSync(outMp4);
  const renderUrl = renderOk
    ? `/api/media/video-runs/${state.runId}/shots/${spec.shot_id}/attempt_${state.attempt}.mp4`
    : undefined;
  updateShotInRun(state.runId, spec.shot_id, {
    renderPath: renderOk ? outMp4 : null,
    renderUrl,
    depthMapUrl,
    renderDurationMs,
    vramUsedMb,
    ramUsedMb,
    subClipsCount,
    toolUsed,
    fallbackUsed,
    fallbackReason: renderError ? `${fallbackReason ? fallbackReason + " | " : ""}${renderError}` : fallbackReason,
    cacheHit,
  });

  return {
    renderPath: renderOk ? outMp4 : null,
    cacheHit,
    toolUsed,
    fallbackUsed,
    fallbackReason,
  };
}

// Node 6: frame_extractor
async function frameExtractorNode(state: ShotWorkerState) {
  const cfg = getVideoConfig();
  const spec = state.shot;
  const runDir = getRunOutputDir(state.runId);
  const framesDir = path.join(runDir, "shots", spec.shot_id, `frames_attempt_${state.attempt}`);
  const videoPath = state.renderPath;

  updateShotInRun(
    state.runId,
    spec.shot_id,
    { status: "extracting" },
    createLog("frame_extractor", "info", `استخراج فریم‌ها و اجرای بررسی فنی FFmpeg/ffprobe برای ${spec.shot_id}`, {
      shot_id: spec.shot_id,
      attempt: state.attempt,
    })
  );

  const deterministicCheck =
    videoPath && fs.existsSync(videoPath)
      ? await runDeterministicChecks(videoPath, {
          durationSec: spec.duration_sec,
          width: spec.resolution[0],
          height: spec.resolution[1],
          fps: spec.fps,
          durationToleranceSec: Math.max(cfg.durationToleranceSec, 1.25),
          requireAudio: false,
        })
      : {
          passed: false,
          duration_sec: 0,
          duration_delta_sec: spec.duration_sec,
          width: 0,
          height: 0,
          fps: 0,
          has_video_stream: false,
          has_audio_stream: false,
          black_frames_detected: true,
          frozen_frames_detected: true,
          mean_volume_db: null,
          failures: ["فایل ویدیوی خروجی رندر تولید نشد."],
        };

  const frameFiles =
    videoPath && fs.existsSync(videoPath)
      ? await extractFrames(videoPath, framesDir, deterministicCheck.duration_sec || spec.duration_sec)
      : [];
  const frameUrls = frameFiles.map(
    (f) =>
      `/api/media/video-runs/${state.runId}/shots/${spec.shot_id}/frames_attempt_${state.attempt}/${path.basename(
        f.filePath
      )}`
  );

  const prevRecord = getVideoRun(state.runId)?.shots.find((s) => s.shot_id === spec.shot_id);
  const updatedRecord: ShotExecutionRecord = {
    ...(prevRecord || {
      shot_id: spec.shot_id,
      shot_number: spec.shot_number,
      spec,
      status: "extracting",
      attempts: state.attempt,
      maxAttempts: state.maxAttempts,
      toolUsed: state.toolUsed,
      fallbackUsed: state.fallbackUsed,
      fallbackReason: state.fallbackReason,
      cacheHit: state.cacheHit,
      frameUrls: [],
      attemptHistory: [],
    }),
    deterministicCheck,
    frameUrls,
  };

  updateShotInRun(state.runId, spec.shot_id, {
    deterministicCheck,
    frameUrls,
  });

  return {
    frameFiles,
    executionRecord: updatedRecord,
  };
}

// Node 7: visual_critic
async function visualCriticNode(state: ShotWorkerState) {
  const spec = state.shot;
  const detCheck = state.executionRecord?.deterministicCheck || {
    passed: false,
    duration_sec: 0,
    duration_delta_sec: spec.duration_sec,
    width: 0,
    height: 0,
    fps: 0,
    has_video_stream: false,
    has_audio_stream: false,
    black_frames_detected: true,
    frozen_frames_detected: true,
    mean_volume_db: null,
    failures: ["خروجی بررسی فنی در دسترس نیست"],
  };

  updateShotInRun(
    state.runId,
    spec.shot_id,
    { status: "critiquing" },
    createLog("visual_critic", "info", `ممیزی بصری فریم‌های شات ${spec.shot_id} با مدل بینایی`, {
      shot_id: spec.shot_id,
      attempt: state.attempt,
    })
  );

  const criticReport = await evaluateShotWithVisualCritic({
    spec,
    attempt: state.attempt,
    scenarioText: state.scenarioText,
    frameFiles: state.frameFiles,
    deterministicCheck: detCheck,
  });

  const currentRec = getVideoRun(state.runId)?.shots.find((s) => s.shot_id === spec.shot_id);
  const renderUrl = `/api/media/video-runs/${state.runId}/shots/${spec.shot_id}/attempt_${state.attempt}.mp4`;

  const historyEntry = {
    attempt: state.attempt,
    renderUrl,
    deterministicPassed: detCheck.passed,
    criticPassed: criticReport.passed,
    scores: criticReport.scores,
    verdictReason: criticReport.verdict_reason,
    issues: criticReport.issues,
  };

  const nextRec: ShotExecutionRecord = {
    ...(currentRec || state.executionRecord!),
    criticReport,
    attemptHistory: [...(currentRec?.attemptHistory || []), historyEntry],
  };

  updateShotInRun(state.runId, spec.shot_id, {
    criticReport,
    attemptHistory: nextRec.attemptHistory,
  });

  return {
    executionRecord: nextRec,
    priorIssues: criticReport.issues,
  };
}

// Node 8: decision
async function decisionNode(state: ShotWorkerState) {
  const spec = state.shot;
  const rec = state.executionRecord!;
  const passed = Boolean(rec.criticReport?.passed && rec.deterministicCheck?.passed);

  if (passed) {
    const finalRec: ShotExecutionRecord = { ...rec, status: "passed" };
    updateShotInRun(
      state.runId,
      spec.shot_id,
      { status: "passed" },
      createLog("decision", "info", `شات ${spec.shot_id} در تلاش ${state.attempt} با موفقیت QA را گذراند.`, {
        shot_id: spec.shot_id,
        attempt: state.attempt,
      })
    );
    return { executionRecord: finalRec };
  }

  if (state.attempt < state.maxAttempts) {
    const nextIssues =
      rec.criticReport?.issues?.length
        ? rec.criticReport.issues
        : [
            {
              frame: "همه فریم‌ها",
              problem: rec.criticReport?.verdict_reason || "نمره یا شرط QA برآورده نشد.",
              fix: "تیتر و محتوا را کوتاه‌تر، خواناتر و کاملاً منطبق با هدف شات بازچینی کن.",
            },
          ];
    updateShotInRun(
      state.runId,
      spec.shot_id,
      { status: "retrying" },
      createLog(
        "decision",
        "warn",
        `شات ${spec.shot_id} در تلاش ${state.attempt} رد شد؛ بازگشت به builder برای اصلاح (${nextIssues[0]?.problem || ""})`,
        { shot_id: spec.shot_id, attempt: state.attempt }
      )
    );
    return {
      priorIssues: nextIssues,
      executionRecord: { ...rec, status: "retrying" as const },
    };
  }

  const failedRec: ShotExecutionRecord = { ...rec, status: "needs_human_review" };
  updateShotInRun(
    state.runId,
    spec.shot_id,
    { status: "needs_human_review" },
    createLog(
      "decision",
      "error",
      `شات ${spec.shot_id} پس از ${state.maxAttempts} تلاش همچنان ناموفق بود و نیازمند بازبینی انسانی است (needs_human_review).`,
      { shot_id: spec.shot_id, attempt: state.attempt }
    )
  );
  return { executionRecord: failedRec };
}

const shotWorkerWorkflow = new StateGraph(ShotWorkerAnnotation)
  .addNode("builder", builderNode)
  .addNode("renderer", rendererNode)
  .addNode("frame_extractor", frameExtractorNode)
  .addNode("visual_critic", visualCriticNode)
  .addNode("decision", decisionNode)
  .addEdge(START, "builder")
  .addEdge("builder", "renderer")
  .addEdge("renderer", "frame_extractor")
  .addEdge("frame_extractor", "visual_critic")
  .addEdge("visual_critic", "decision")
  .addConditionalEdges("decision", (s) => {
    if (s.executionRecord?.status === "retrying" && s.attempt < s.maxAttempts) {
      return "builder";
    }
    return END;
  });

const compiledShotWorkerSubgraph = shotWorkerWorkflow.compile();

// ============================================================================
// Parent 10-Node Graph: scenario_parser -> shot_planner -> tool_router
//   -> Send("shot_worker") -> assembler -> final_qa
// ============================================================================
const VideoPipelineAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  projectId: Annotation<string | undefined>(),
  scenarioText: Annotation<string>(),
  aspectRatio: Annotation<VideoAspectFormat>(),
  qualityMode: Annotation<VideoQualityMode>(),
  colorGradePreset: Annotation<CinemaLookPreset>({ reducer: (_, n) => n, default: () => "industrial_teal_amber" }),
  subtitleStylePreset: Annotation<KineticSubtitleStylePreset>({ reducer: (_, n) => n, default: () => "industrial_steel_blue" }),
  musicSource: Annotation<"lyria" | "ambient_cinema" | "none">({ reducer: (_, n) => n, default: () => "ambient_cinema" }),
  director: Annotation<DirectorOutput | null>({ reducer: (_, n) => n, default: () => null }),
  researchScript: Annotation<ResearchAndScriptOutput | null>({ reducer: (_, n) => n, default: () => null }),
  narrationWavPath: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  burnSubtitles: Annotation<boolean>({ reducer: (_, n) => n, default: () => true }),
  includeBackgroundMusic: Annotation<boolean>({ reducer: (_, n) => n, default: () => true }),
  needsClarification: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  clarificationQuestions: Annotation<string[]>({ reducer: (_, n) => n, default: () => [] }),
  shots: Annotation<ShotSpec[]>({ reducer: (_, n) => n, default: () => [] }),
  completedShots: Annotation<ShotExecutionRecord[]>({
    reducer: (curr, next) => {
      const map = new Map<string, ShotExecutionRecord>();
      for (const s of curr) map.set(s.shot_id, s);
      for (const s of next) map.set(s.shot_id, s);
      return Array.from(map.values()).sort((a, b) => a.shot_number - b.shot_number);
    },
    default: () => [],
  }),
  finalVideoPath: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  srtPath: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  finalQa: Annotation<FinalQaReport | null>({ reducer: (_, n) => n, default: () => null }),
});

type VideoPipelineState = typeof VideoPipelineAnnotation.State;

// Node 1: scenario_parser
async function scenarioParserNode(state: VideoPipelineState) {
  appendRunLog(
    state.runId,
    createLog("scenario_parser", "info", "تجزیه سناریو و استخراج ساختار شات‌ها با اعتبارسنجی Zod")
  );

  const parsed = await parseScenarioToShotSpecs({
    scenarioText: state.scenarioText,
    aspectRatio: state.aspectRatio,
    qualityMode: state.qualityMode,
    director: state.director,
    researchScript: state.researchScript,
    narrationUrl: state.narrationWavPath,
  });

  if (parsed.needsClarification) {
    appendRunLog(
      state.runId,
      createLog("scenario_parser", "warn", "سناریو برای برخی شات‌ها ابهام دارد و نیازمند شفاف‌سازی کاربر است."),
      { status: "needs_clarification" }
    );
  }

  return {
    needsClarification: parsed.needsClarification,
    clarificationQuestions: parsed.clarificationQuestions,
    shots: parsed.shots,
  };
}

// Node 2: shot_planner
async function shotPlannerNode(state: VideoPipelineState) {
  const cfg = getVideoConfig();
  const planned = planShotsForProduction(state.shots);

  const initialRecords: ShotExecutionRecord[] = planned.map((spec) => ({
    shot_id: spec.shot_id,
    shot_number: spec.shot_number,
    spec,
    status: "planning",
    attempts: 0,
    maxAttempts: cfg.maxShotRetries,
    toolUsed: spec.tool,
    fallbackUsed: false,
    cacheHit: false,
    frameUrls: [],
    attemptHistory: [],
  }));

  const current = getVideoRun(state.runId);
  if (current) {
    persistRunSnapshot({
      ...current,
      currentNode: "shot_planner",
      shots: initialRecords,
      logs: [
        ...current.logs,
        createLog("shot_planner", "info", `طراحی چیدمان، حرکت دوربین و پالت رنگی برای ${planned.length} شات تکمیل شد.`),
      ],
    });
  }

  return { shots: planned };
}

/**
 * Pure, unit-testable Open-Source Free-Engine Router.
 * Strictly blocks automatic `omni_flash` routing — selects Blender (local/Colab GPU), ComfyUI (Colab GPU),
 * HyperFrames (100% free local Playwright+Canvas+FFmpeg), or Remotion!
 */
export function resolveFreeEngineRoute(params: {
  requestedTool: ShotToolKind;
  hasKeyframe: boolean;
  localBlenderAvailable: boolean;
  colabBlenderAvailable: boolean;
  remoteComfyUrl: string | null;
  allowOmniFlashManualOverride?: boolean;
}): { tool: ShotToolKind; fallbackUsed: boolean; fallbackReason: string } {
  const { requestedTool, hasKeyframe, localBlenderAvailable, colabBlenderAvailable, remoteComfyUrl } = params;

  if (requestedTool === "blender") {
    if (localBlenderAvailable || colabBlenderAvailable) {
      return {
        tool: "blender",
        fallbackUsed: false,
        fallbackReason: colabBlenderAvailable
          ? "رندر سه‌بعدی PBR واقعی روی Google Colab GPU (Blender 4.2)"
          : "رندر سه‌بعدی PBR واقعی با Blender محلی",
      };
    }
    return {
      tool: "hyperframes",
      fallbackUsed: true,
      fallbackReason: "Blender محلی یا Colab GPU متصل نیست؛ انتقال رایگان به موتور HyperFrames (نور فلزی + ذرات + تایپوگرافی مدرن).",
    };
  }

  if (requestedTool === "comfyui") {
    if (remoteComfyUrl) {
      return {
        tool: "comfyui",
        fallbackUsed: false,
        fallbackReason: `اجرای Wan 2.2 / ComfyUI روی سرور واقعی Google Colab GPU (${remoteComfyUrl})`,
      };
    }
    return {
      tool: "hyperframes",
      fallbackUsed: true,
      fallbackReason: "سرور Google Colab ComfyUI متصل نیست؛ انتقال به موتور رایگان محلی HyperFrames.",
    };
  }

  if (requestedTool === "remotion") {
    return {
      tool: "remotion",
      fallbackUsed: false,
      fallbackReason: "رندر رایگان موشن‌گرافیک و نمودار با Remotion v4",
    };
  }

  if (requestedTool === "omni_flash" || requestedTool === "generative_api") {
    if (params.allowOmniFlashManualOverride) {
      return {
        tool: "omni_flash",
        fallbackUsed: false,
        fallbackReason: "اجرای دستی OmniFlash بنا به درخواست صریح کاربر",
      };
    }
    if (remoteComfyUrl && hasKeyframe) {
      return {
        tool: "comfyui",
        fallbackUsed: false,
        fallbackReason: "جایگزینی خودکار OmniFlash با موتور رایگان ComfyUI (Wan 2.2) روی Google Colab GPU",
      };
    }
    return {
      tool: "hyperframes",
      fallbackUsed: false,
      fallbackReason: "قفل پیش‌فرض روی موتور رایگان HyperFrames + FFmpeg (عدم مصرف OmniFlash)",
    };
  }

  return {
    tool: "hyperframes",
    fallbackUsed: false,
    fallbackReason: "رندر رایگان سینمایی با موتور HyperFrames (1080×1920 + ذرات + نورپردازی + تایپوگرافی فارسی)",
  };
}

// Node 3: tool_router
async function toolRouterNode(state: VideoPipelineState) {
  const cfg = getVideoConfig();
  const colabCfg = getColabBridgeConfig();
  const remoteComfyUrl =
    (colabCfg.connected && colabCfg.lastHealth?.engines?.comfyui ? colabCfg.bridgeUrl : null) ||
    getActiveRemoteComfyUrl();
  const localBlenderAvailable = isBlenderInstalled();
  const colabBlenderAvailable = isColabBlenderReady();
  const projectRecord = state.projectId ? getProject(state.projectId) : null;

  const routed = state.shots.map((shot) => {
    let resolvedKeyframePath = shot.visual.keyframe_path;

    // Resolve REAL Stage 2 storyboard keyframe image from disk if available!
    if (!resolvedKeyframePath && projectRecord?.visuals?.shots) {
      const visMatch = projectRecord.visuals.shots.find(
        (v) => v.shotNumber === shot.shot_number
      );
      if (visMatch?.imageUrl) {
        if (visMatch.imageUrl.startsWith("/api/media/images/")) {
          const p = path.join(getImagesDir(), path.basename(visMatch.imageUrl));
          if (fs.existsSync(p)) resolvedKeyframePath = p;
        } else if (visMatch.imageUrl.startsWith("/api/media/visuals/")) {
          const p = path.join(getVisualsDir(), path.basename(visMatch.imageUrl));
          if (fs.existsSync(p)) resolvedKeyframePath = p;
        }
      }
    }

    const decision = resolveFreeEngineRoute({
      requestedTool: shot.tool,
      hasKeyframe: Boolean(resolvedKeyframePath),
      localBlenderAvailable,
      colabBlenderAvailable,
      remoteComfyUrl,
      allowOmniFlashManualOverride: cfg.enableGenerativeApi && shot.tool === "omni_flash",
    });

    return {
      ...shot,
      tool: decision.tool,
      visual: {
        ...shot.visual,
        keyframe_path: resolvedKeyframePath,
      },
      fallback_used: decision.fallbackUsed,
      fallback_reason: decision.fallbackReason,
    };
  });

  const current = getVideoRun(state.runId);
  if (current) {
    persistRunSnapshot({
      ...current,
      currentNode: "tool_router",
      shots: current.shots.map((rec) => {
        const match = routed.find((r) => r.shot_id === rec.shot_id);
        return match
          ? {
              ...rec,
              spec: match,
              toolUsed: match.tool,
              fallbackUsed: Boolean(match.fallback_used),
              fallbackReason: match.fallback_reason,
            }
          : rec;
      }),
      logs: [
        ...current.logs,
        createLog(
          "tool_router",
          "info",
          "مسیریابی هوشمند شات‌ها روی موتورهای رایگان (HyperFrames / Remotion / Blender / ComfyUI Colab — بدون OmniFlash) انجام شد."
        ),
      ],
    });
  }

  return { shots: routed };
}

// Parallel Shot Worker wrapper invoked via LangGraph Send
async function shotWorkerNode(state: ShotWorkerState & { runId: string }) {
  const out = await compiledShotWorkerSubgraph.invoke({
    runId: state.runId,
    projectId: state.projectId,
    scenarioText: state.scenarioText,
    aspectRatio: state.aspectRatio,
    qualityMode: state.qualityMode,
    maxAttempts: state.maxAttempts,
    humanInstruction: state.humanInstruction,
    bypassCache: state.bypassCache,
    shot: state.shot,
    attempt: 0,
    priorIssues: [],
  });
  return {
    completedShots: out.executionRecord ? [out.executionRecord] : [],
  };
}

// Node 9: assembler
async function assemblerNode(state: VideoPipelineState) {
  const cfg = getVideoConfig();
  const [width, height] = resolveDimensions(state.aspectRatio, state.qualityMode);
  const runDir = getRunOutputDir(state.runId);
  const currentRun = getVideoRun(state.runId);
  const allShots = (state.completedShots.length ? state.completedShots : currentRun?.shots || []).sort(
    (a, b) => a.shot_number - b.shot_number
  );

  const needsReview = allShots.filter((s) => s.status !== "passed" || !s.renderPath);
  if (needsReview.length > 0) {
    appendRunLog(
      state.runId,
      createLog(
        "assembler",
        "error",
        `${needsReview.length} شات هنوز تایید QA نگرفته است (${needsReview
          .map((s) => s.shot_id)
          .join("، ")})؛ تحویل ویدیوی معیوب مسدود شد.`
      ),
      { status: "needs_human_review" }
    );
    return { finalVideoPath: null, srtPath: null };
  }

  appendRunLog(
    state.runId,
    createLog(
      "assembler",
      "info",
      `اجرای موتور تدوین و اصلاح رنگ سینمایی (${state.colorGradePreset}) + 3D .cube LUT + میکس صدا (-14 LUFS)`
    ),
    { status: "assembling" }
  );

  const finalOutPath = path.join(runDir, "final.mp4");
  const srtOutPath = path.join(runDir, "subtitles.srt");

  const assembled = await assembleFinalVideo({
    shots: allShots.map((s) => ({
      shot_id: s.shot_id,
      videoPath: s.renderPath!,
      transition_in: s.spec.transition_in,
      narration_text: s.spec.narration_text,
      onScreenText: s.spec.visual.headline,
      duration_sec: s.spec.duration_sec,
    })),
    workDir: path.join(runDir, "assemble_tmp"),
    finalOutPath,
    srtOutPath,
    width,
    height,
    fps: cfg.fps,
    narrationWavPath: state.narrationWavPath,
    includeBackgroundMusic: state.includeBackgroundMusic,
    burnSubtitles: state.burnSubtitles,
    subtitleStylePreset: state.subtitleStylePreset || "industrial_steel_blue",
    targetLufs: cfg.targetLufs,
    colorGradePreset: state.colorGradePreset,
    musicSource: state.musicSource,
  });

  // Generate OpenTimelineIO (.otio) for DaVinci Resolve AND Automated After Effects ExtendScript (.jsx)
  let otioUrl: string | null = null;
  let afterEffectsJsxUrl: string | null = null;
  const projectRecord = state.projectId ? getProject(state.projectId) : null;
  if (projectRecord) {
    const otioClips = extractDavinciClipsFromProject(projectRecord, getVideosDir(), getImagesDir());
    const otioText = generateOpenTimelineIoJson({
      project: projectRecord,
      clips: otioClips,
      voiceoverAbsPath: state.narrationWavPath || null,
      cubeLutFilename: assembled.cubeLutPath ? path.basename(assembled.cubeLutPath) : null,
      fps: cfg.fps,
    });
    fs.writeFileSync(path.join(runDir, "timeline.otio"), otioText, "utf-8");
    otioUrl = `/api/media/video-runs/${state.runId}/timeline.otio`;

    const aeJsx = generateAfterEffectsExtendScriptJsx({
      project: projectRecord,
      width,
      height,
      fps: cfg.fps,
      subtitlePreset: state.subtitleStylePreset,
    });
    fs.writeFileSync(path.join(runDir, "build_after_effects.jsx"), aeJsx, "utf-8");
    afterEffectsJsxUrl = `/api/media/video-runs/${state.runId}/build_after_effects.jsx`;
  }

  // Copy playable artifact into data/videos so /api/media/videos serves it uniformly
  const publicVideoName = `${state.runId}_final.mp4`;
  fs.copyFileSync(assembled.finalPath, path.join(getVideosDir(), publicVideoName));

  const cubeLutUrl = assembled.cubeLutPath
    ? `/api/media/video-runs/${state.runId}/${path.basename(assembled.cubeLutPath)}`
    : null;
  const assSubtitleUrl = assembled.assPath
    ? `/api/media/video-runs/${state.runId}/${path.basename(assembled.assPath)}`
    : null;

  appendRunLog(
    state.runId,
    createLog(
      "assembler",
      "info",
      "فایل مستر MP4 سینمایی (CRF 19) + زیرنویس کینتیک ASS همگام با صدا + .cube LUT + DaVinci OTIO + اسکریپت After Effects (.jsx) ساخته شد."
    ),
    {
      finalVideoPath: assembled.finalPath,
      finalVideoUrl: `/api/media/video-runs/${state.runId}/final.mp4`,
      srtPath: assembled.srtPath,
      srtUrl: `/api/video/runs/${state.runId}/srt`,
      assSubtitleUrl,
      cubeLutUrl,
      otioUrl,
      afterEffectsJsxUrl,
      colorGradePreset: state.colorGradePreset,
      subtitleStylePreset: state.subtitleStylePreset,
      musicSource: assembled.musicSourceUsed,
    }
  );

  return {
    finalVideoPath: assembled.finalPath,
    srtPath: assembled.srtPath,
  };
}

// Node 10: final_qa
async function finalQaNode(state: VideoPipelineState) {
  const cfg = getVideoConfig();
  const [width, height] = resolveDimensions(state.aspectRatio, state.qualityMode);
  const runDir = getRunOutputDir(state.runId);

  if (!state.finalVideoPath || !fs.existsSync(state.finalVideoPath)) {
    const run = getVideoRun(state.runId);
    if (run) {
      fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(run, null, 2), "utf-8");
    }
    return { finalQa: null };
  }

  appendRunLog(state.runId, createLog("final_qa", "info", "اجرای QA نهایی روی ویدیوی مونتاژشده (فریم‌ها + صدا + پیوستگی)"));

  const expectedTotalDur = state.completedShots.reduce((acc, s) => acc + s.spec.duration_sec, 0);
  const finalCheck = await runDeterministicChecks(state.finalVideoPath, {
    durationSec: Math.max(1, expectedTotalDur - Math.max(0, state.completedShots.length - 1) * 0.3),
    width,
    height,
    fps: cfg.fps,
    durationToleranceSec: 4.0,
    requireAudio: true,
  });

  const sampleFrames = await extractFrames(
    state.finalVideoPath,
    path.join(runDir, "final_qa_frames"),
    finalCheck.duration_sec || expectedTotalDur
  );

  const report = await evaluateFinalVideoQa({
    finalCheck,
    sampleFrames,
    scenarioText: state.scenarioText,
  });

  const currentRun = getVideoRun(state.runId);
  if (currentRun) {
    const finalSnapshot = persistRunSnapshot({
      ...currentRun,
      status: report.passed ? "completed" : "needs_human_review",
      currentNode: "final_qa",
      finalQa: report,
      reportUrl: `/api/video/runs/${state.runId}/report`,
      logs: [
        ...currentRun.logs,
        createLog(
          "final_qa",
          report.passed ? "info" : "warn",
          `گزارش Final QA ثبت شد (نمره پیوستگی: ${report.continuity_score}/10).`
        ),
      ],
    });
    fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(finalSnapshot, null, 2), "utf-8");
  }

  return { finalQa: report };
}

const graphCheckpointer = new MemorySaver();

const videoPipelineWorkflow = new StateGraph(VideoPipelineAnnotation)
  .addNode("scenario_parser", scenarioParserNode)
  .addNode("shot_planner", shotPlannerNode)
  .addNode("tool_router", toolRouterNode)
  .addNode("shot_worker", shotWorkerNode as never)
  .addNode("assembler", assemblerNode)
  .addNode("final_qa", finalQaNode)
  .addEdge(START, "scenario_parser")
  .addConditionalEdges("scenario_parser", (s) =>
    s.needsClarification ? END : "shot_planner"
  )
  .addEdge("shot_planner", "tool_router")
  .addConditionalEdges("tool_router", (s) => {
    const cfg = getVideoConfig();
    return s.shots.map(
      (shot) =>
        new Send("shot_worker", {
          runId: s.runId,
          projectId: s.projectId,
          scenarioText: s.scenarioText,
          aspectRatio: s.aspectRatio,
          qualityMode: s.qualityMode,
          maxAttempts: cfg.maxShotRetries,
          bypassCache: false,
          shot,
          attempt: 0,
          priorIssues: [],
        })
    );
  })
  .addEdge("shot_worker", "assembler")
  .addEdge("assembler", "final_qa")
  .addEdge("final_qa", END);

export const compiledVideoPipelineGraph = videoPipelineWorkflow.compile({
  checkpointer: graphCheckpointer,
});

// ============================================================================
// Public Entrypoints: Run Full Pipeline + Human-in-the-Loop Retry Shot
// ============================================================================
export async function runVideoProductionPipeline(params: {
  runId?: string;
  projectId?: string;
  scenarioText: string;
  aspectRatio?: VideoAspectFormat;
  qualityMode?: VideoQualityMode;
  colorGradePreset?: CinemaLookPreset;
  subtitleStylePreset?: KineticSubtitleStylePreset;
  musicSource?: "lyria" | "ambient_cinema" | "none";
  director?: DirectorOutput | null;
  researchScript?: ResearchAndScriptOutput | null;
  narrationWavPath?: string | null;
  burnSubtitles?: boolean;
  includeBackgroundMusic?: boolean;
  preparsedShots?: ShotSpec[];
}): Promise<VideoPipelineRun> {
  const cfg = getVideoConfig();
  const runId = params.runId || `vrun_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const aspectRatio = params.aspectRatio || cfg.defaultAspectRatio;
  const qualityMode = params.qualityMode || cfg.defaultQualityMode;
  const colorGradePreset = params.colorGradePreset || "industrial_teal_amber";
  const subtitleStylePreset = params.subtitleStylePreset || "industrial_steel_blue";
  const musicSource = params.musicSource || "ambient_cinema";

  const initialRun: VideoPipelineRun = {
    runId,
    projectId: params.projectId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    aspectRatio,
    qualityMode,
    colorGradePreset,
    subtitleStylePreset,
    musicSource,
    status: "running",
    currentNode: "START",
    shots: [],
    logs: [createLog("START", "info", "شروع پایپ‌لاین ۱۰ مرحله‌ای تولید ویدیو (موتورهای رایگان + QA ۷ لایه)")],
  };
  persistRunSnapshot(initialRun);

  try {
    await compiledVideoPipelineGraph.invoke(
      {
        runId,
        projectId: params.projectId,
        scenarioText: params.scenarioText,
        aspectRatio,
        qualityMode,
        colorGradePreset,
        subtitleStylePreset,
        musicSource,
        director: params.director ?? null,
        researchScript: params.researchScript ?? null,
        narrationWavPath: params.narrationWavPath ?? null,
        burnSubtitles: params.burnSubtitles ?? cfg.burnSubtitles,
        includeBackgroundMusic: params.includeBackgroundMusic ?? cfg.includeBackgroundMusic,
        shots: params.preparsedShots ?? [],
      },
      { configurable: { thread_id: `vthread_${runId}` } }
    );

    return getVideoRun(runId)!;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed = persistRunSnapshot({
      ...getVideoRun(runId)!,
      status: "error",
      errorMessage: msg,
      logs: [...(getVideoRun(runId)?.logs || []), createLog("ERROR", "error", msg)],
    });
    return failed;
  }
}

/**
 * Retries a single failed/human-review shot with optional user feedback and re-assembles final MP4.
 */
export async function retryShotAndReassemble(params: {
  runId: string;
  shotId: string;
  humanInstruction?: string;
}): Promise<VideoPipelineRun> {
  const run = getVideoRun(params.runId);
  if (!run) throw new Error("اجرای ویدیویی مورد نظر یافت نشد.");

  const target = run.shots.find((s) => s.shot_id === params.shotId);
  if (!target) throw new Error("شات مورد نظر یافت نشد.");

  const cfg = getVideoConfig();
  persistRunSnapshot({
    ...run,
    status: "running",
    errorMessage: null,
    logs: [
      ...run.logs,
      createLog("human_retry", "info", `تلاش مجدد با دستور کاربر روی شات ${params.shotId}`, {
        shot_id: params.shotId,
      }),
    ],
  });

  const workerResult = await compiledShotWorkerSubgraph.invoke({
    runId: run.runId,
    projectId: run.projectId,
    scenarioText: run.shots.map((s) => s.spec.intent).join("\n"),
    aspectRatio: run.aspectRatio,
    qualityMode: run.qualityMode,
    maxAttempts: cfg.maxShotRetries,
    humanInstruction: params.humanInstruction,
    bypassCache: true,
    shot: target.spec,
    attempt: 0,
    priorIssues: target.criticReport?.issues || [],
  });

  const updatedRun = getVideoRun(run.runId)!;
  const completedShots = updatedRun.shots;
  const allPassed = completedShots.every((s) => s.status === "passed" && s.renderPath);

  if (!allPassed || workerResult.executionRecord?.status !== "passed") {
    return persistRunSnapshot({
      ...updatedRun,
      status: "needs_human_review",
    });
  }

  const projectRecord = run.projectId ? getProject(run.projectId) : null;
  const fallbackNarrationWav = projectRecord?.voiceover?.audioFilename
    ? path.join(getAudioDir(), path.basename(projectRecord.voiceover.audioFilename))
    : null;

  const assembledState = await assemblerNode({
    runId: run.runId,
    projectId: run.projectId,
    scenarioText: run.shots.map((s) => s.spec.intent).join("\n"),
    aspectRatio: run.aspectRatio,
    qualityMode: run.qualityMode,
    colorGradePreset: run.colorGradePreset || "industrial_teal_amber",
    subtitleStylePreset: run.subtitleStylePreset || "industrial_steel_blue",
    musicSource: run.musicSource || "ambient_cinema",
    director: null,
    researchScript: null,
    narrationWavPath: target.spec.audio.narration_path ?? fallbackNarrationWav ?? null,
    burnSubtitles: cfg.burnSubtitles,
    includeBackgroundMusic: cfg.includeBackgroundMusic,
    needsClarification: false,
    clarificationQuestions: [],
    shots: completedShots.map((s) => s.spec),
    completedShots,
    finalVideoPath: null,
    srtPath: null,
    finalQa: null,
  });

  await finalQaNode({
    runId: run.runId,
    projectId: run.projectId,
    scenarioText: run.shots.map((s) => s.spec.intent).join("\n"),
    aspectRatio: run.aspectRatio,
    qualityMode: run.qualityMode,
    colorGradePreset: run.colorGradePreset || "industrial_teal_amber",
    subtitleStylePreset: run.subtitleStylePreset || "industrial_steel_blue",
    musicSource: run.musicSource || "ambient_cinema",
    director: null,
    researchScript: null,
    narrationWavPath: null,
    burnSubtitles: cfg.burnSubtitles,
    includeBackgroundMusic: cfg.includeBackgroundMusic,
    needsClarification: false,
    clarificationQuestions: [],
    shots: completedShots.map((s) => s.spec),
    completedShots,
    finalVideoPath: assembledState.finalVideoPath,
    srtPath: assembledState.srtPath,
    finalQa: null,
  });

  return getVideoRun(run.runId)!;
}

export { compiledShotWorkerSubgraph };
