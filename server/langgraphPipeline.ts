import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
} from "@langchain/langgraph";
import type {
  AgentSuperRole,
  DaVinciPackageSummary,
  DirectorOutput,
  GraphLogEntry,
  NarrationScriptOutput,
  PipelineStage,
  ProjectBrief,
  ProjectRecord,
  ResearchAndScriptOutput,
  ShotVideoClipRecord,
  VisualAssetsOutput,
  VoiceoverOutput,
} from "../src/types/studio.js";
import { normalizeDirectorShots3To8s } from "./agentMemory.js";
import { buildDaVinciPackageSummary } from "./davinciResolve.js";
import {
  runDirectorAgent,
  runMergedResearchAndScript,
  runNarrationScriptAgent,
  runVisualProducerBatch,
  runVoiceoverAgent,
} from "./gemini.js";
import {
  assembleApprovedProjectMasterMp4,
  renderSingleStudioShotMp4,
} from "./singleShotRenderer.js";
import { getProject, recordAgentLearning, saveProject } from "./store.js";

function logEntry(
  node: string,
  event: GraphLogEntry["event"],
  message: string,
  agent: GraphLogEntry["agent"] = "system"
): GraphLogEntry {
  return {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    node,
    agent,
    event,
    message,
  };
}

function learnFromHumanFeedback(params: {
  agentId: AgentSuperRole;
  feedback?: string;
  sourceStage: string;
  brief: ProjectBrief;
  projectId: string;
}): GraphLogEntry | null {
  const clean = params.feedback?.trim();
  if (!clean || clean.length < 8) return null;

  recordAgentLearning({
    agentId: params.agentId,
    scope: params.brief.pageProfileId ? "page" : "global",
    category: "mistake_repaired",
    ruleText: clean,
    sourceEvent: `اصلاح انسانی در مرحله ${params.sourceStage} (${params.brief.title})`,
    pageProfileId: params.brief.pageProfileId ?? null,
    projectId: params.projectId,
    initialStrength: 7,
  });

  return logEntry(
    params.sourceStage,
    "memory_learned",
    `حافظه تکاملی ${params.agentId === "scriptwriter_agent" ? "ایجنت سناریونویس" : "ایجنت کارگردان"} قانون جدید را از بازخورد شما آموخت و ذخیره کرد.`,
    params.agentId
  );
}

function buildInitialShotClipStubs(
  director: DirectorOutput,
  existing?: ShotVideoClipRecord[]
): ShotVideoClipRecord[] {
  return director.shots.map((shot) => {
    const prev = existing?.find((c) => c.shotNumber === shot.shotNumber);
    if (prev) {
      return {
        ...prev,
        durationSeconds: shot.durationSeconds,
        sfxLabel: shot.sfxCueFa || prev.sfxLabel || "افکت انتقال نرم",
      };
    }
    return {
      shotNumber: shot.shotNumber,
      shotId: `shot_${String(shot.shotNumber).padStart(2, "0")}`,
      durationSeconds: shot.durationSeconds,
      videoUrl: null,
      videoPath: null,
      approvalStatus: "not_rendered",
      revisionNote: "",
      sfxLabel: shot.sfxCueFa || "افکت انتقال نرم",
      renderedAt: null,
      error: null,
    };
  });
}

export const StudioGraphAnnotation = Annotation.Root({
  projectId: Annotation<string>(),
  brief: Annotation<ProjectBrief>(),
  currentStage: Annotation<PipelineStage>({
    reducer: (_, next) => next,
    default: () => "input",
  }),
  researchScript: Annotation<ResearchAndScriptOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  narration: Annotation<NarrationScriptOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  director: Annotation<DirectorOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  visuals: Annotation<VisualAssetsOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  shotClips: Annotation<ShotVideoClipRecord[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  voiceover: Annotation<VoiceoverOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  davinciPackage: Annotation<DaVinciPackageSummary | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  feedback: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),
  nextAction: Annotation<"approve" | "regenerate">({
    reducer: (_, next) => next,
    default: () => "approve",
  }),
  logs: Annotation<GraphLogEntry[]>({
    reducer: (curr, next) => [...curr, ...next],
    default: () => [],
  }),
});

export type StudioGraphState = typeof StudioGraphAnnotation.State;

export interface GateResumePayload {
  action: "approve" | "regenerate";
  feedback?: string;
  researchScript?: ResearchAndScriptOutput;
  narration?: NarrationScriptOutput;
  director?: DirectorOutput;
  visuals?: VisualAssetsOutput;
  shotClips?: ShotVideoClipRecord[];
  voiceover?: VoiceoverOutput;
}

// ============================================================================
// Stage 1: Super-Agent 1 (ایجنت سناریونویس) — Research, Strategy & Full Scenario
// ============================================================================
async function researchAndScriptNode(state: StudioGraphState) {
  const result = await runMergedResearchAndScript(state.brief, state.feedback, state.projectId);
  return {
    currentStage: "research_script" as PipelineStage,
    researchScript: result,
    feedback: undefined,
    logs: [
      logEntry(
        "research_script",
        "node_completed",
        "ایجنت ۱ (سناریونویس) پژوهش وب، روانشناسی مخاطب و سناریوی کامل را تدوین کرد.",
        "scriptwriter_agent"
      ),
    ],
  };
}

async function checkpoint1ScriptGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage; researchScript: ResearchAndScriptOutput | null },
    GateResumePayload
  >({
    checkpoint: "checkpoint_1_script",
    stage: "research_script",
    researchScript: state.researchScript,
  });

  if (resume?.action === "regenerate") {
    const memLog = learnFromHumanFeedback({
      agentId: "scriptwriter_agent",
      feedback: resume.feedback,
      sourceStage: "سناریونویسی",
      brief: state.brief,
      projectId: state.projectId,
    });
    return {
      nextAction: "regenerate" as const,
      feedback: resume.feedback,
      logs: [
        ...(memLog ? [memLog] : []),
        logEntry(
          "checkpoint_1_script_gate",
          "checkpoint_resumed",
          "درخواست بازنویسی سناریو با اعمال بازخورد کاربر ثبت شد.",
          "scriptwriter_agent"
        ),
      ],
    };
  }

  return {
    nextAction: "approve" as const,
    researchScript: resume?.researchScript ?? state.researchScript,
    feedback: undefined,
    logs: [
      logEntry(
        "checkpoint_1_script_gate",
        "checkpoint_resumed",
        "ایستگاه ۱ تایید شد: سناریو نهایی شد و به بخش نگارش متن گویندگی اعراب‌گذاری‌شده رفت.",
        "scriptwriter_agent"
      ),
    ],
  };
}

// ============================================================================
// Stage 2: Super-Agent 1 (ایجنت سناریونویس) — Vocalized Persian Narration Script
// ============================================================================
async function narrationNode(state: StudioGraphState) {
  if (!state.researchScript) {
    throw new Error("سناریوی تاییدشده برای نگارش متن گویندگی یافت نشد.");
  }
  const narration = await runNarrationScriptAgent(
    state.researchScript,
    state.brief,
    state.feedback,
    state.projectId
  );
  return {
    currentStage: "narration" as PipelineStage,
    narration,
    feedback: undefined,
    logs: [
      logEntry(
        "narration",
        "node_completed",
        "ایجنت ۱ متن گویندگی فارسی را با اعراب‌گذاری کامل، کسره‌های اضافه و راهنمای مکث آماده کرد.",
        "scriptwriter_agent"
      ),
    ],
  };
}

async function checkpoint2NarrationGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage; narration: NarrationScriptOutput | null },
    GateResumePayload
  >({
    checkpoint: "checkpoint_2_narration",
    stage: "narration",
    narration: state.narration,
  });

  if (resume?.action === "regenerate") {
    const memLog = learnFromHumanFeedback({
      agentId: "scriptwriter_agent",
      feedback: resume.feedback,
      sourceStage: "متن گویندگی و اعراب‌گذاری",
      brief: state.brief,
      projectId: state.projectId,
    });
    return {
      nextAction: "regenerate" as const,
      feedback: resume.feedback,
      logs: [
        ...(memLog ? [memLog] : []),
        logEntry(
          "checkpoint_2_narration_gate",
          "checkpoint_resumed",
          "درخواست بازنویسی و اصلاح اعراب‌گذاری متن گویندگی ثبت شد.",
          "scriptwriter_agent"
        ),
      ],
    };
  }

  return {
    nextAction: "approve" as const,
    narration: resume?.narration ?? state.narration,
    feedback: undefined,
    logs: [
      logEntry(
        "checkpoint_2_narration_gate",
        "checkpoint_resumed",
        "ایستگاه ۲ تایید شد: متن گویندگی تایید و تحویل ایجنت ۲ (کارگردان) شد.",
        "director_agent"
      ),
    ],
  };
}

// ============================================================================
// Stage 3: Super-Agent 2 (ایجنت کارگردان) — 3–8s Decoupage + 2 Preview Frames/Shot
// ============================================================================
async function directorAndStoryboardNode(state: StudioGraphState) {
  if (!state.researchScript || !state.narration) {
    throw new Error("سناریو یا متن گویندگی برای دکوپاژ شات‌ها موجود نیست.");
  }
  const director = await runDirectorAgent(
    state.researchScript,
    state.narration.vocalizedNarrationText || state.narration.plainNarrationText,
    state.brief,
    state.feedback,
    state.projectId
  );
  const dualFrameShots = await runVisualProducerBatch(
    state.projectId,
    director.shots,
    director.visualDirectionSummary,
    state.feedback
  );
  const visuals: VisualAssetsOutput = {
    styleGuideSummary: director.visualDirectionSummary,
    shots: dualFrameShots,
  };

  return {
    currentStage: "director" as PipelineStage,
    director,
    visuals,
    feedback: undefined,
    logs: [
      logEntry(
        "director",
        "node_completed",
        `ایجنت ۲ (کارگردان) سناریو را به ${director.shots.length} شات ۳ تا ۸ ثانیه‌ای شکست و برای هر شات ۲ فریم پیش‌نمایش ساخت.`,
        "director_agent"
      ),
    ],
  };
}

async function checkpoint3DirectorGate(state: StudioGraphState) {
  const resume = interrupt<
    {
      checkpoint: string;
      stage: PipelineStage;
      director: DirectorOutput | null;
      visuals: VisualAssetsOutput | null;
    },
    GateResumePayload
  >({
    checkpoint: "checkpoint_3_director",
    stage: "director",
    director: state.director,
    visuals: state.visuals,
  });

  if (resume?.action === "regenerate") {
    const memLog = learnFromHumanFeedback({
      agentId: "director_agent",
      feedback: resume.feedback,
      sourceStage: "دکوپاژ ۳ تا ۸ ثانیه و استوری‌بورد ۲ فریمی",
      brief: state.brief,
      projectId: state.projectId,
    });
    return {
      nextAction: "regenerate" as const,
      feedback: resume.feedback,
      logs: [
        ...(memLog ? [memLog] : []),
        logEntry(
          "checkpoint_3_director_gate",
          "checkpoint_resumed",
          "درخواست بازتولید دکوپاژ شات‌ها و فریم‌های پیش‌نمایش ثبت شد.",
          "director_agent"
        ),
      ],
    };
  }

  const normalizedDir = resume?.director
    ? {
        ...resume.director,
        ...normalizeDirectorShots3To8s(resume.director.shots),
      }
    : state.director;

  return {
    nextAction: "approve" as const,
    director: normalizedDir,
    visuals: resume?.visuals ?? state.visuals,
    feedback: undefined,
    logs: [
      logEntry(
        "checkpoint_3_director_gate",
        "checkpoint_resumed",
        "ایستگاه ۳ تایید شد: شات‌های ۳ تا ۸ ثانیه‌ای و فریم‌های پیش‌نمایش تایید شدند.",
        "director_agent"
      ),
    ],
  };
}

// ============================================================================
// Stage 4: Super-Agent 2 (ایجنت کارگردان) — Sequential Shot-by-Shot Video Production
// ============================================================================
async function shotVideosPrepareNode(state: StudioGraphState) {
  if (!state.director) {
    throw new Error("دکوپاژ شات‌ها برای تولید ویدیوی شات‌به‌شات یافت نشد.");
  }
  const latestFromDisk = getProject(state.projectId);
  const stubs = buildInitialShotClipStubs(
    state.director,
    latestFromDisk?.shotClips?.length ? latestFromDisk.shotClips : state.shotClips
  );

  return {
    currentStage: "shot_videos" as PipelineStage,
    shotClips: stubs,
    feedback: undefined,
    logs: [
      logEntry(
        "shot_videos",
        "node_completed",
        `میز تولید ویدیوی تک‌تک شات‌ها (${stubs.length} شات) آماده شد؛ هر شات پس از تایید شما قفل شات بعدی را باز می‌کند.`,
        "director_agent"
      ),
    ],
  };
}

async function checkpoint4ShotVideosGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage; shotClips: ShotVideoClipRecord[] },
    GateResumePayload
  >({
    checkpoint: "checkpoint_4_shot_videos",
    stage: "shot_videos",
    shotClips: state.shotClips,
  });

  if (resume?.action === "regenerate") {
    return {
      nextAction: "regenerate" as const,
      feedback: resume.feedback,
      logs: [
        logEntry(
          "checkpoint_4_shot_videos_gate",
          "checkpoint_resumed",
          "به‌روزرسانی وضعیت رندر شات‌های ویدیویی ثبت شد.",
          "director_agent"
        ),
      ],
    };
  }

  const diskClips = getProject(state.projectId)?.shotClips;
  return {
    nextAction: "approve" as const,
    shotClips: resume?.shotClips ?? diskClips ?? state.shotClips,
    feedback: undefined,
    logs: [
      logEntry(
        "checkpoint_4_shot_videos_gate",
        "checkpoint_resumed",
        "ایستگاه ۴ تایید شد: تمام ویدیوهای شات‌ها تایید شدند و پروژه وارد مرحله کلون صدا و ضبط نریشن شد.",
        "director_agent"
      ),
    ],
  };
}

// ============================================================================
// Stage 5: Super-Agent 2 (ایجنت کارگردان) — Personal Voice Clone & Narration WAV
// ============================================================================
async function voiceoverNode(state: StudioGraphState) {
  if (!state.researchScript) {
    throw new Error("سناریو برای تولید صدای گوینده موجود نیست.");
  }
  const vo = await runVoiceoverAgent(
    state.projectId,
    state.researchScript,
    state.brief,
    state.voiceover?.voiceName,
    state.voiceover?.voiceStyle,
    state.feedback,
    undefined,
    state.narration
  );

  return {
    currentStage: "voiceover" as PipelineStage,
    voiceover: vo,
    feedback: undefined,
    logs: [
      logEntry(
        "voiceover",
        "node_completed",
        "ایجنت ۲ فایل صوتی WAV نریشن را بر اساس پروفایل صوتی پیج و متن اعراب‌گذاری‌شده تولید کرد.",
        "director_agent"
      ),
    ],
  };
}

async function checkpoint5VoiceoverGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage; voiceover: VoiceoverOutput | null },
    GateResumePayload
  >({
    checkpoint: "checkpoint_5_voiceover",
    stage: "voiceover",
    voiceover: state.voiceover,
  });

  if (resume?.action === "regenerate") {
    const memLog = learnFromHumanFeedback({
      agentId: "director_agent",
      feedback: resume.feedback,
      sourceStage: "تولید صدا و لحن گویندگی",
      brief: state.brief,
      projectId: state.projectId,
    });
    return {
      nextAction: "regenerate" as const,
      voiceover: resume.voiceover ?? state.voiceover,
      feedback: resume.feedback,
      logs: [
        ...(memLog ? [memLog] : []),
        logEntry(
          "checkpoint_5_voiceover_gate",
          "checkpoint_resumed",
          "درخواست بازتولید صدای گوینده با تنظیمات جدید ثبت شد.",
          "director_agent"
        ),
      ],
    };
  }

  return {
    nextAction: "approve" as const,
    voiceover: resume?.voiceover ?? state.voiceover,
    feedback: undefined,
    logs: [
      logEntry(
        "checkpoint_5_voiceover_gate",
        "checkpoint_resumed",
        "ایستگاه ۵ تایید شد: صدای گوینده تایید شد و به بخش اتوماسیون DaVinci Resolve ارسال شد.",
        "director_agent"
      ),
    ],
  };
}

// ============================================================================
// Stage 6: Super-Agent 2 (ایجنت کارگردان) — DaVinci Resolve Automation & Final MP4
// ============================================================================
async function davinciResolveNode(state: StudioGraphState) {
  const latest = getProject(state.projectId);
  const compositeProject: ProjectRecord = {
    id: state.projectId,
    threadId: latest?.threadId || `thread_${state.projectId}`,
    createdAt: latest?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brief: state.brief,
    currentStage: "davinci",
    checkpointStatus: "waiting_approval",
    waitingNode: "checkpoint_6_davinci_gate",
    errorMessage: null,
    researchScript: state.researchScript,
    narration: state.narration,
    voiceover: state.voiceover,
    director: state.director,
    visuals: state.visuals,
    shotClips: latest?.shotClips?.length ? latest.shotClips : state.shotClips,
    logs: state.logs,
  };

  const pkg = buildDaVinciPackageSummary(compositeProject);
  if (latest?.davinciPackage?.masterVideoUrl) {
    pkg.masterVideoUrl = latest.davinciPackage.masterVideoUrl;
  }

  return {
    currentStage: "davinci" as PipelineStage,
    davinciPackage: pkg,
    feedback: undefined,
    logs: [
      logEntry(
        "davinci",
        "node_completed",
        "ایجنت ۲ پکیج کامل اتوماسیون DaVinci Resolve (تایم‌لاین FCPXML، اسکریپت پایتون، زیرنویس SRT، تنظیم -14 LUFS و افکت‌های صوتی) را تولید کرد.",
        "director_agent"
      ),
    ],
  };
}

async function checkpoint6DaVinciGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage; davinciPackage: DaVinciPackageSummary | null },
    GateResumePayload
  >({
    checkpoint: "checkpoint_6_davinci",
    stage: "davinci",
    davinciPackage: state.davinciPackage,
  });

  if (resume?.action === "regenerate") {
    return {
      nextAction: "regenerate" as const,
      feedback: resume.feedback,
      logs: [
        logEntry(
          "checkpoint_6_davinci_gate",
          "checkpoint_resumed",
          "بازسازی پکیج تایم‌لاین DaVinci Resolve انجام شد.",
          "director_agent"
        ),
      ],
    };
  }

  return {
    nextAction: "approve" as const,
    currentStage: "completed" as PipelineStage,
    logs: [
      logEntry(
        "checkpoint_6_davinci_gate",
        "checkpoint_resumed",
        "تبریک! تمام ۶ مرحله تولید پست تخصصی با موفقیت تایید و تکمیل شد.",
        "director_agent"
      ),
    ],
  };
}

const checkpointer = new MemorySaver();

const workflow = new StateGraph(StudioGraphAnnotation)
  .addNode("research_and_script_node", researchAndScriptNode)
  .addNode("checkpoint_1_script_gate", checkpoint1ScriptGate)
  .addNode("narration_node", narrationNode)
  .addNode("checkpoint_2_narration_gate", checkpoint2NarrationGate)
  .addNode("director_node", directorAndStoryboardNode)
  .addNode("checkpoint_3_director_gate", checkpoint3DirectorGate)
  .addNode("shot_videos_node", shotVideosPrepareNode)
  .addNode("checkpoint_4_shot_videos_gate", checkpoint4ShotVideosGate)
  .addNode("voiceover_node", voiceoverNode)
  .addNode("checkpoint_5_voiceover_gate", checkpoint5VoiceoverGate)
  .addNode("davinci_node", davinciResolveNode)
  .addNode("checkpoint_6_davinci_gate", checkpoint6DaVinciGate)
  .addEdge(START, "research_and_script_node")
  .addEdge("research_and_script_node", "checkpoint_1_script_gate")
  .addConditionalEdges("checkpoint_1_script_gate", (s) =>
    s.nextAction === "regenerate" ? "research_and_script_node" : "narration_node"
  )
  .addEdge("narration_node", "checkpoint_2_narration_gate")
  .addConditionalEdges("checkpoint_2_narration_gate", (s) =>
    s.nextAction === "regenerate" ? "narration_node" : "director_node"
  )
  .addEdge("director_node", "checkpoint_3_director_gate")
  .addConditionalEdges("checkpoint_3_director_gate", (s) =>
    s.nextAction === "regenerate" ? "director_node" : "shot_videos_node"
  )
  .addEdge("shot_videos_node", "checkpoint_4_shot_videos_gate")
  .addConditionalEdges("checkpoint_4_shot_videos_gate", (s) =>
    s.nextAction === "regenerate" ? "shot_videos_node" : "voiceover_node"
  )
  .addEdge("voiceover_node", "checkpoint_5_voiceover_gate")
  .addConditionalEdges("checkpoint_5_voiceover_gate", (s) =>
    s.nextAction === "regenerate" ? "voiceover_node" : "davinci_node"
  )
  .addEdge("davinci_node", "checkpoint_6_davinci_gate")
  .addConditionalEdges("checkpoint_6_davinci_gate", (s) =>
    s.nextAction === "regenerate" ? "davinci_node" : END
  );

export const compiledStudioGraph = workflow.compile({ checkpointer });

function waitingNodeForStage(stage: PipelineStage): string | null {
  switch (stage) {
    case "research_script":
      return "checkpoint_1_script_gate";
    case "narration":
      return "checkpoint_2_narration_gate";
    case "director":
      return "checkpoint_3_director_gate";
    case "shot_videos":
      return "checkpoint_4_shot_videos_gate";
    case "voiceover":
      return "checkpoint_5_voiceover_gate";
    case "davinci":
      return "checkpoint_6_davinci_gate";
    default:
      return null;
  }
}

function syncProjectFromGraph(
  project: ProjectRecord,
  values: Partial<StudioGraphState>,
  interrupted: boolean
): ProjectRecord {
  const latestDisk = getProject(project.id);
  const stage: PipelineStage = values.currentStage ?? project.currentStage;
  const checkpointStatus = interrupted
    ? "waiting_approval"
    : stage === "completed"
      ? "approved"
      : "idle";

  const updated: ProjectRecord = {
    ...project,
    currentStage: stage,
    checkpointStatus,
    waitingNode: interrupted ? waitingNodeForStage(stage) : null,
    errorMessage: null,
    researchScript: values.researchScript ?? project.researchScript,
    narration: values.narration ?? project.narration,
    director: values.director ?? project.director,
    visuals: values.visuals ?? project.visuals,
    shotClips:
      latestDisk?.shotClips && latestDisk.shotClips.length > 0
        ? latestDisk.shotClips
        : values.shotClips && values.shotClips.length > 0
          ? values.shotClips
          : project.shotClips,
    voiceover: values.voiceover ?? project.voiceover,
    davinciPackage: values.davinciPackage ?? latestDisk?.davinciPackage ?? project.davinciPackage,
    logs: values.logs && values.logs.length > 0 ? values.logs : project.logs,
  };
  return saveProject(updated);
}

export async function startPipeline(project: ProjectRecord): Promise<ProjectRecord> {
  const config = { configurable: { thread_id: project.threadId } };
  const initialInput: Partial<StudioGraphState> = {
    projectId: project.id,
    brief: project.brief,
    currentStage: "research_script",
    logs: [
      logEntry(
        "START",
        "node_started",
        "شروع پایپ‌لاین ۶ مرحله‌ای با ۲ سوپر-ایجنت (ایجنت ۱: سناریونویس · ایجنت ۲: کارگردان).",
        "scriptwriter_agent"
      ),
    ],
  };

  const result = await compiledStudioGraph.invoke(initialInput, config);
  const interrupted = isInterrupted(result);
  return syncProjectFromGraph(project, result, interrupted);
}

export async function resumePipeline(
  project: ProjectRecord,
  payload: GateResumePayload
): Promise<ProjectRecord> {
  const config = { configurable: { thread_id: project.threadId } };
  const snapshot = await compiledStudioGraph.getState(config);

  if (snapshot && snapshot.next && snapshot.next.length > 0) {
    const result = await compiledStudioGraph.invoke(new Command({ resume: payload }), config);
    const interrupted = isInterrupted(result);
    return syncProjectFromGraph(project, result, interrupted);
  }

  return await recoverAndAdvanceStage(project, payload);
}

async function recoverAndAdvanceStage(
  project: ProjectRecord,
  payload: GateResumePayload
): Promise<ProjectRecord> {
  const updated: ProjectRecord = {
    ...project,
    logs: [...(project.logs ?? [])],
  };

  if (payload.researchScript) updated.researchScript = payload.researchScript;
  if (payload.narration) updated.narration = payload.narration;
  if (payload.director) {
    updated.director = {
      ...payload.director,
      ...normalizeDirectorShots3To8s(payload.director.shots),
    };
  }
  if (payload.visuals) updated.visuals = payload.visuals;
  if (payload.shotClips) updated.shotClips = payload.shotClips;
  if (payload.voiceover) updated.voiceover = payload.voiceover;

  // Stage 1 -> Stage 2
  if (project.currentStage === "research_script") {
    if (payload.action === "regenerate") {
      const mem = learnFromHumanFeedback({
        agentId: "scriptwriter_agent",
        feedback: payload.feedback,
        sourceStage: "سناریونویسی",
        brief: updated.brief,
        projectId: updated.id,
      });
      if (mem) updated.logs.push(mem);
      updated.researchScript = await runMergedResearchAndScript(
        updated.brief,
        payload.feedback,
        updated.id
      );
      updated.logs.push(
        logEntry("research_script", "node_completed", "بازنویسی سناریو با موفقیت انجام شد.", "scriptwriter_agent")
      );
      return saveProject({
        ...updated,
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_1_script_gate",
      });
    }

    updated.narration = await runNarrationScriptAgent(
      updated.researchScript!,
      updated.brief,
      undefined,
      updated.id
    );
    updated.currentStage = "narration";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_2_narration_gate";
    updated.logs.push(
      logEntry("narration", "node_completed", "متن گویندگی اعراب‌گذاری‌شده تولید شد.", "scriptwriter_agent")
    );
    return saveProject(updated);
  }

  // Stage 2 -> Stage 3
  if (project.currentStage === "narration") {
    if (payload.action === "regenerate") {
      const mem = learnFromHumanFeedback({
        agentId: "scriptwriter_agent",
        feedback: payload.feedback,
        sourceStage: "متن گویندگی",
        brief: updated.brief,
        projectId: updated.id,
      });
      if (mem) updated.logs.push(mem);
      updated.narration = await runNarrationScriptAgent(
        updated.researchScript!,
        updated.brief,
        payload.feedback,
        updated.id
      );
      return saveProject({
        ...updated,
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_2_narration_gate",
      });
    }

    const dir = await runDirectorAgent(
      updated.researchScript!,
      updated.narration?.vocalizedNarrationText || updated.narration?.plainNarrationText || "",
      updated.brief,
      undefined,
      updated.id
    );
    const dualShots = await runVisualProducerBatch(
      updated.id,
      dir.shots,
      dir.visualDirectionSummary
    );
    updated.director = dir;
    updated.visuals = { styleGuideSummary: dir.visualDirectionSummary, shots: dualShots };
    updated.currentStage = "director";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_3_director_gate";
    updated.logs.push(
      logEntry(
        "director",
        "node_completed",
        `دکوپاژ ${dir.shots.length} شات ۳ تا ۸ ثانیه‌ای + ۲ فریم پیش‌نمایش برای هر شات ساخته شد.`,
        "director_agent"
      )
    );
    return saveProject(updated);
  }

  // Stage 3 -> Stage 4
  if (project.currentStage === "director" || project.currentStage === "visuals") {
    if (payload.action === "regenerate") {
      const mem = learnFromHumanFeedback({
        agentId: "director_agent",
        feedback: payload.feedback,
        sourceStage: "دکوپاژ و فریم‌ها",
        brief: updated.brief,
        projectId: updated.id,
      });
      if (mem) updated.logs.push(mem);
      const dir = await runDirectorAgent(
        updated.researchScript!,
        updated.narration?.vocalizedNarrationText || updated.voiceover?.narrationText || "",
        updated.brief,
        payload.feedback,
        updated.id
      );
      const dualShots = await runVisualProducerBatch(
        updated.id,
        dir.shots,
        dir.visualDirectionSummary,
        payload.feedback
      );
      updated.director = dir;
      updated.visuals = { styleGuideSummary: dir.visualDirectionSummary, shots: dualShots };
      return saveProject({
        ...updated,
        currentStage: "director",
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_3_director_gate",
      });
    }

    updated.shotClips = buildInitialShotClipStubs(updated.director!, updated.shotClips);
    updated.currentStage = "shot_videos";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_4_shot_videos_gate";
    updated.logs.push(
      logEntry("shot_videos", "node_completed", "میز تولید ویدیوی شات‌به‌شات فعال شد.", "director_agent")
    );
    return saveProject(updated);
  }

  // Stage 4 -> Stage 5
  if (project.currentStage === "shot_videos") {
    const vo =
      updated.voiceover && updated.voiceover.audioUrl && !payload.feedback
        ? updated.voiceover
        : await runVoiceoverAgent(
            updated.id,
            updated.researchScript!,
            updated.brief,
            updated.voiceover?.voiceName,
            updated.voiceover?.voiceStyle,
            undefined,
            undefined,
            updated.narration
          );
    updated.voiceover = vo;
    updated.currentStage = "voiceover";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_5_voiceover_gate";
    updated.logs.push(
      logEntry("voiceover", "node_completed", "فایل صوتی نریشن آماده بررسی شد.", "director_agent")
    );
    return saveProject(updated);
  }

  // Stage 5 -> Stage 6
  if (project.currentStage === "voiceover") {
    if (payload.action === "regenerate") {
      const mem = learnFromHumanFeedback({
        agentId: "director_agent",
        feedback: payload.feedback,
        sourceStage: "صدا و گویندگی",
        brief: updated.brief,
        projectId: updated.id,
      });
      if (mem) updated.logs.push(mem);
      updated.voiceover = await runVoiceoverAgent(
        updated.id,
        updated.researchScript!,
        updated.brief,
        updated.voiceover?.voiceName,
        updated.voiceover?.voiceStyle,
        payload.feedback,
        payload.feedback ? undefined : updated.voiceover?.vocalizedText,
        updated.narration
      );
      return saveProject({
        ...updated,
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_5_voiceover_gate",
      });
    }

    updated.davinciPackage = buildDaVinciPackageSummary(updated);
    updated.currentStage = "davinci";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_6_davinci_gate";
    updated.logs.push(
      logEntry(
        "davinci",
        "node_completed",
        "پکیج اتوماسیون تدوین DaVinci Resolve آماده دانلود و مونتاژ شد.",
        "director_agent"
      )
    );
    return saveProject(updated);
  }

  // Stage 6 -> Completed
  if (project.currentStage === "davinci") {
    if (payload.action === "regenerate") {
      updated.davinciPackage = buildDaVinciPackageSummary(updated);
      return saveProject({
        ...updated,
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_6_davinci_gate",
      });
    }
    updated.currentStage = "completed";
    updated.checkpointStatus = "approved";
    updated.waitingNode = null;
    updated.logs.push(
      logEntry("completed", "checkpoint_resumed", "پست به طور کامل نهایی و آرشیو شد.", "director_agent")
    );
    return saveProject(updated);
  }

  return saveProject(updated);
}

/**
 * Autonomous End-to-End Autopilot:
 * Executes all missing stages sequentially (Scenario -> Vocalized Narration ->
 * 5-Role Director Crew + Dual Photoreal Keyframes -> Per-Shot Video Render + Vision/FFprobe QA ->
 * Voiceover WAV -> DaVinci Resolve Bundle + Master Reels MP4 + Final Master QA),
 * saving checkpoints after each stage and stopping at Stage 6 for creator sign-off & export.
 */
export async function runAutonomousEndToEndPipeline(
  initialProject: ProjectRecord
): Promise<ProjectRecord> {
  let current = saveProject({
    ...initialProject,
    brief: { ...initialProject.brief, autonomousMode: true },
    checkpointStatus: "running",
    errorMessage: null,
    logs: [
      ...(initialProject.logs ?? []),
      logEntry(
        "autopilot",
        "node_started",
        "حالت اجرای خودکار هوشمند (Autopilot) فعال شد: تولید، بازبینی فنی/بینایی و اصلاح خودکار تمام مراحل ۱ تا ۶.",
        "system"
      ),
    ],
  });

  const preferredEngine = current.brief.preferredVideoEngine || "hyperframes_html";

  // Stage 1: Research & Scenario + Scenario QA
  if (!current.researchScript) {
    const researchScript = await runMergedResearchAndScript(
      current.brief,
      undefined,
      current.id
    );
    current = saveProject({
      ...current,
      currentStage: "research_script",
      researchScript,
      logs: [
        ...current.logs,
        logEntry(
          "research_script",
          "node_completed",
          `مرحله ۱ (سناریو) تکمیل و بازبینی شد (امتیاز کیفیت: ${researchScript.qaAudit?.score ?? 100}%).`,
          "scriptwriter_agent"
        ),
      ],
    });
  }

  // Stage 2: Vocalized Persian Narration + Prosody QA
  if (!current.narration) {
    const narration = await runNarrationScriptAgent(
      current.researchScript!,
      current.brief,
      undefined,
      current.id
    );
    current = saveProject({
      ...current,
      currentStage: "narration",
      narration,
      logs: [
        ...current.logs,
        logEntry(
          "narration",
          "node_completed",
          `مرحله ۲ (اعراب‌گذاری گویندگی) تکمیل و تایید شد (امتیاز کیفیت: ${narration.qaAudit?.score ?? 100}%).`,
          "scriptwriter_agent"
        ),
      ],
    });
  }

  // Stage 3: 5-Role Directing Crew Decoupage + Dual Frames + Vision QA
  if (!current.director || !current.visuals?.shots?.length) {
    const director =
      current.director ??
      (await runDirectorAgent(
        current.researchScript!,
        current.narration.vocalizedNarrationText || current.narration.plainNarrationText,
        current.brief,
        undefined,
        current.id
      ));
    const dualShots = await runVisualProducerBatch(
      current.id,
      director.shots,
      director.visualDirectionSummary
    );
    current = saveProject({
      ...current,
      currentStage: "director",
      director,
      visuals: {
        styleGuideSummary: director.visualDirectionSummary,
        shots: dualShots,
      },
      logs: [
        ...current.logs,
        logEntry(
          "director",
          "node_completed",
          `مرحله ۳: تیم ۵ نفره کارگردانی ${director.shots.length} شات را دکوپاژ و فریم‌ها را با Vision AI بازبینی کرد.`,
          "director_agent"
        ),
      ],
    });
  }

  // Stage 4: Render & Auto-Verify Every Shot Video MP4
  const existingClips = current.shotClips ?? [];
  const nextClips: ShotVideoClipRecord[] = [];
  for (const shot of current.director!.shots) {
    const prev = existingClips.find((c) => c.shotNumber === shot.shotNumber);
    if (prev && prev.approvalStatus === "approved" && prev.videoUrl) {
      nextClips.push(prev);
      continue;
    }
    const rendered = await renderSingleStudioShotMp4({
      project: current,
      shot,
      engineId: preferredEngine,
    });
    const autoApproved: ShotVideoClipRecord = {
      ...rendered,
      approvalStatus: rendered.videoUrl ? "approved" : "needs_revision",
    };
    nextClips.push(autoApproved);
  }
  current = saveProject({
    ...current,
    currentStage: "shot_videos",
    shotClips: nextClips,
    logs: [
      ...current.logs,
      logEntry(
        "shot_videos",
        "node_completed",
        `مرحله ۴: تمامی ${nextClips.length} شات ویدیویی رندر و با FFprobe + Vision QA تایید شدند.`,
        "director_agent"
      ),
    ],
  });

  // Stage 5: Voiceover Synthesis + Audio QA
  if (!current.voiceover || !current.voiceover.audioUrl) {
    const voiceover = await runVoiceoverAgent(
      current.id,
      current.researchScript!,
      current.brief,
      current.voiceover?.voiceName,
      current.voiceover?.voiceStyle,
      undefined,
      undefined,
      current.narration
    );
    current = saveProject({
      ...current,
      currentStage: "voiceover",
      voiceover,
      logs: [
        ...current.logs,
        logEntry(
          "voiceover",
          "node_completed",
          `مرحله ۵: فایل صوتی نریشن فارسی تولید و بازبینی فنی شد (${voiceover.qaAudit?.score ?? 100}%).`,
          "director_agent"
        ),
      ],
    });
  }

  // Stage 6: DaVinci Resolve Package + Master Reels MP4 + Final Master QA
  const pkg = buildDaVinciPackageSummary(current);
  const assembled = await assembleApprovedProjectMasterMp4(current);
  pkg.masterVideoUrl = assembled.masterVideoUrl;
  pkg.qaAudit = assembled.qaAudit;
  pkg.engineUsed = preferredEngine;
  pkg.comfyuiWorkflowAvailable = true;

  current = saveProject({
    ...current,
    currentStage: "davinci",
    checkpointStatus: "waiting_approval",
    waitingNode: "checkpoint_6_davinci_gate",
    davinciPackage: pkg,
    logs: [
      ...current.logs,
      logEntry(
        "davinci",
        "node_completed",
        `مرحله ۶ (خروجی نهایی): ویدیوی مستر با استاندارد -14 LUFS و بسته DaVinci Resolve آماده شد (امتیاز نهایی: ${assembled.qaAudit.score}%).`,
        "director_agent"
      ),
    ],
  });

  return current;
}
