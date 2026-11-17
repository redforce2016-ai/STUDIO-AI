import { Annotation, END, MemorySaver, START, Send, StateGraph } from "@langchain/langgraph";
import fs from "node:fs";
import path from "node:path";
import type { DirectorOutput, ResearchAndScriptOutput } from "../../src/types/studio.js";
import type {
  FinalQaReport,
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
import { getVideosDir } from "../store.js";
import {
  buildDeterministicCompositionFromShot,
  buildShotCompositionPlan,
  evaluateFinalVideoQa,
  evaluateShotWithVisualCritic,
  parseScenarioToShotSpecs,
  planShotsForProduction,
} from "./agents.js";
import { getRunOutputDir, getVideoConfig, resolveDimensions } from "./config.js";
import { detectHardwareSync } from "./hardware.js";
import { BlenderUnavailableError, isBlenderInstalled, renderBlenderShot } from "./providers/blender.js";
import { ComfyUIProvider } from "./providers/comfyui.js";
import {
  assembleFinalVideo,
  extractFrames,
  runDeterministicChecks,
} from "./providers/ffmpeg.js";
import { buildIndustrialPipeKeyframeSvg } from "./providers/generative.js";
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

  const plan = await buildShotCompositionPlan({
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
    createLog("renderer", "info", `رندر محلی شات ${spec.shot_id} با ابزار ${spec.tool}`, {
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
    if (spec.tool === "blender") {
      try {
        await renderBlenderShot({
          shotId: spec.shot_id,
          blenderPrompt: spec.visual.blender_prompt || spec.intent,
          durationSec: spec.duration_sec,
          width: spec.resolution[0],
          height: spec.resolution[1],
          fps: spec.fps,
          outputPath: outMp4,
          timeoutMs: cfg.shotRenderTimeoutMs,
        });
      } catch (err) {
        toolUsed = "remotion";
        fallbackUsed = true;
        fallbackReason =
          err instanceof BlenderUnavailableError
            ? err.message
            : `خطا در Blender، انتقال به Remotion: ${err instanceof Error ? err.message : String(err)}`;
        const remRes = await renderRemotionShot({
          plan,
          outputPath: outMp4,
          timeoutMs: cfg.shotRenderTimeoutMs,
          bypassCache: state.bypassCache || state.attempt > 1,
        });
        cacheHit = remRes.cacheHit;
      }
      renderDurationMs = Date.now() - renderStarted;
    } else if (
      spec.tool === "comfyui" ||
      spec.tool === "parallax" ||
      spec.tool === "generative_api"
    ) {
      // Ensure local keyframe exists (Strictly Image-to-Video; Text-to-Video is forbidden)
      let keyframePath = spec.visual.keyframe_path?.trim() || "";
      if (!keyframePath || !fs.existsSync(keyframePath)) {
        const autoKeyframeSvgPath = path.join(shotDir, `${spec.shot_id}_keyframe.svg`);
        fs.writeFileSync(autoKeyframeSvgPath, buildIndustrialPipeKeyframeSvg(spec), "utf-8");
        keyframePath = autoKeyframeSvgPath;
      }

      // If QA rejected 2 prior generative attempts, force Parallax on attempt 3
      const forceParallaxByQa = state.attempt >= 3 || spec.tool === "parallax";
      const provider = forceParallaxByQa
        ? new ParallaxVideoProvider()
        : new ComfyUIProvider({ autoFallbackToParallax: true });

      const clipRes = await provider.generateClip({
        shotId: spec.shot_id,
        keyframePath,
        prompt: spec.visual.generative_prompt || spec.intent,
        cameraMotion: spec.visual.camera_motion,
        aspectRatio: state.aspectRatio,
        durationSec: spec.duration_sec,
        qualityMode: state.qualityMode,
        resolution: state.qualityMode === "final_1080p" ? "1080p" : "480p",
        width: spec.resolution[0],
        height: spec.resolution[1],
        fps: spec.fps,
        visualCriticApprovedPreview: state.attempt > 1,
        outputPath: outMp4,
        timeoutMs: cfg.shotRenderTimeoutMs,
      });

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
          durationToleranceSec: cfg.durationToleranceSec,
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
      ? await extractFrames(videoPath, framesDir, spec.duration_sec)
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
  director: Annotation<DirectorOutput | null>({ reducer: (_, n) => n, default: () => null }),
  researchScript: Annotation<ResearchAndScriptOutput | null>({ reducer: (_, n) => n, default: () => null }),
  narrationWavPath: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  burnSubtitles: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  includeBackgroundMusic: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
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

// Node 3: tool_router
async function toolRouterNode(state: VideoPipelineState) {
  const cfg = getVideoConfig();
  const blenderOk = cfg.enableBlender && isBlenderInstalled();
  const hw = detectHardwareSync();

  const routed = state.shots.map((shot) => {
    let tool = shot.tool;
    let fallbackUsed = false;
    let fallbackReason: string | null = null;

    if (tool === "blender" && !blenderOk) {
      tool = "remotion";
      fallbackUsed = true;
      fallbackReason = "باینری Blender روی سرور نصب نیست؛ هدایت خودکار شات به Remotion.";
    } else if (tool === "generative_api") {
      // Cloud video API is strictly replaced with free local keyframe animation (ComfyUI / Parallax)
      tool = hw.defaultProvider;
      fallbackUsed = hw.defaultProvider === "parallax";
      fallbackReason =
        hw.defaultProvider === "parallax"
          ? hw.profileReasonFa
          : `هدایت به موتور محلی ComfyUI (${hw.selectedProfile})`;
    }

    return {
      ...shot,
      tool,
      fallback_used: fallbackUsed,
      fallback_reason: fallbackReason,
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
        createLog("tool_router", "info", "انتخاب ابزار رندر هر شات انجام شد و پردازش موازی آغاز می‌شود."),
      ],
    });
  }

  return { shots: routed };
}

// Parallel Shot Worker wrapper invoked via LangGraph Send
async function shotWorkerNode(state: ShotWorkerState & { runId: string }) {
  const out = await compiledShotWorkerSubgraph.invoke({
    runId: state.runId,
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
          .join("، ")})؛ تحویل ویدیوی معیوب مسدود شد.`,
      ),
      { status: "needs_human_review" }
    );
    return { finalVideoPath: null, srtPath: null };
  }

  appendRunLog(
    state.runId,
    createLog("assembler", "info", "مونتاژ نهایی شات‌های تاییدشده، هم‌ترازی -14 LUFS و ساخت فایل MP4 + SRT"),
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
    targetLufs: cfg.targetLufs,
  });

  // Also copy playable artifact into data/videos so /api/media/videos serves it uniformly
  const publicVideoName = `${state.runId}_final.mp4`;
  fs.copyFileSync(assembled.finalPath, path.join(getVideosDir(), publicVideoName));

  appendRunLog(state.runId, createLog("assembler", "info", "فایل ویدیوی نهایی MP4 مونتاژ و ذخیره شد."), {
    finalVideoPath: assembled.finalPath,
    finalVideoUrl: `/api/media/video-runs/${state.runId}/final.mp4`,
    srtPath: assembled.srtPath,
    srtUrl: `/api/video/runs/${state.runId}/srt`,
  });

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
    durationToleranceSec: 2.0,
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

  const initialRun: VideoPipelineRun = {
    runId,
    projectId: params.projectId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    aspectRatio,
    qualityMode,
    status: "running",
    currentNode: "START",
    shots: [],
    logs: [createLog("START", "info", "شروع پایپ‌لاین ۱۰ مرحله‌ای تولید ویدیو و QA بصری")],
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

  // Re-run assembler + final_qa
  const assembledState = await assemblerNode({
    runId: run.runId,
    projectId: run.projectId,
    scenarioText: run.shots.map((s) => s.spec.intent).join("\n"),
    aspectRatio: run.aspectRatio,
    qualityMode: run.qualityMode,
    director: null,
    researchScript: null,
    narrationWavPath: target.spec.audio.narration_path ?? null,
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
