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
  DirectorOutput,
  GraphLogEntry,
  PipelineStage,
  ProjectBrief,
  ProjectRecord,
  ResearchAndScriptOutput,
  VisualAssetsOutput,
  VoicePersona,
  VoiceoverOutput,
} from "../src/types/studio.js";
import {
  runDirectorAgent,
  runMergedResearchAndScript,
  runVisualProducerBatch,
  runVoiceoverAgent,
} from "./gemini.js";
import { saveProject } from "./store.js";

function logEntry(node: string, event: GraphLogEntry["event"], message: string): GraphLogEntry {
  return {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    node,
    event,
    message,
  };
}

// Define LangGraph State Annotation for the 5-Stage Real Studio Pipeline:
// 1. research_script (سناریو)
// 2. storyboard (استوری‌بورد: دکوپاژ + تصاویر کلیدی شات‌ها)
// 3. video_shots (ساخت شات‌های ویدیو و صحنه‌های سه‌بعدی)
// 4. voiceover (ساخت صدا برای ویدیو متناسب با شات‌ها)
// 5. assembly (تدوین، میکس و مونتاژ نهایی MP4 + QA)
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
  director: Annotation<DirectorOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  visuals: Annotation<VisualAssetsOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  voiceover: Annotation<VoiceoverOutput | null>({
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

interface GateResumePayload {
  action: "approve" | "regenerate";
  feedback?: string;
  researchScript?: ResearchAndScriptOutput;
  director?: DirectorOutput;
  visuals?: VisualAssetsOutput;
  voiceover?: VoiceoverOutput;
}

// ============================================================================
// Stage 1: Research & Script (سناریو)
// ============================================================================
async function researchAndScriptNode(state: StudioGraphState) {
  const result = await runMergedResearchAndScript(state.brief, state.feedback);
  return {
    currentStage: "research_script" as PipelineStage,
    researchScript: result,
    feedback: undefined,
    logs: [
      logEntry(
        "research_and_script",
        "node_completed",
        "مرحله ۱ (سناریو): پژوهش وب و نگارش سناریوی ساختاریافته تکمیل شد."
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
    return {
      nextAction: "regenerate" as const,
      feedback: resume.feedback,
      logs: [
        logEntry(
          "checkpoint_1_script_gate",
          "checkpoint_resumed",
          "درخواست بازتولید پژوهش و سناریو با بازخورد کاربر ثبت شد."
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
        "ایستگاه تایید ۱: سناریو تایید و وارد مرحله طراحی استوری‌بورد شد."
      ),
    ],
  };
}

// ============================================================================
// Stage 2: Storyboard (استوری‌بورد: دکوپاژ + تصاویر کلیدی شات‌ها)
// ============================================================================
async function storyboardNode(state: StudioGraphState) {
  if (!state.researchScript) {
    throw new Error("خروجی سناریو برای طراحی استوری‌بورد موجود نیست.");
  }

  const director = await runDirectorAgent(
    state.researchScript,
    null,
    state.brief,
    state.feedback
  );

  const generatedShots = await runVisualProducerBatch(
    state.projectId,
    director.shots,
    director.visualDirectionSummary,
    state.feedback
  );

  const visuals: VisualAssetsOutput = {
    styleGuideSummary: director.visualDirectionSummary,
    shots: generatedShots,
  };

  return {
    currentStage: "storyboard" as PipelineStage,
    director,
    visuals,
    feedback: undefined,
    logs: [
      logEntry(
        "storyboard",
        "node_completed",
        `مرحله ۲ (استوری‌بورد): دکوپاژ ${director.shots.length} شات همراه با فریم‌های کلیدی استوری‌بورد تولید شد.`
      ),
    ],
  };
}

async function checkpoint2StoryboardGate(state: StudioGraphState) {
  const resume = interrupt<
    {
      checkpoint: string;
      stage: PipelineStage;
      director: DirectorOutput | null;
      visuals: VisualAssetsOutput | null;
    },
    GateResumePayload
  >({
    checkpoint: "checkpoint_2_storyboard",
    stage: "storyboard",
    director: state.director,
    visuals: state.visuals,
  });

  if (resume?.action === "regenerate") {
    return {
      nextAction: "regenerate" as const,
      director: resume.director ?? state.director,
      visuals: resume.visuals ?? state.visuals,
      feedback: resume.feedback,
      logs: [
        logEntry(
          "checkpoint_2_storyboard_gate",
          "checkpoint_resumed",
          "درخواست بازتولید استوری‌بورد و دکوپاژ ثبت شد."
        ),
      ],
    };
  }

  return {
    nextAction: "approve" as const,
    director: resume?.director ?? state.director,
    visuals: resume?.visuals ?? state.visuals,
    feedback: undefined,
    logs: [
      logEntry(
        "checkpoint_2_storyboard_gate",
        "checkpoint_resumed",
        "ایستگاه تایید ۲: استوری‌بورد تایید و وارد مرحله ساخت شات‌های ویدیو شد."
      ),
    ],
  };
}

// ============================================================================
// Stage 3: Video Shots Production (ساخت شات‌های ویدیو و ۳بعدی)
// ============================================================================
async function videoShotsNode(state: StudioGraphState) {
  if (!state.director || !state.visuals) {
    throw new Error("داده استوری‌بورد برای ساخت شات‌های ویدیو موجود نیست.");
  }

  let updatedVisuals = state.visuals;
  if (state.feedback) {
    const regeneratedShots = await runVisualProducerBatch(
      state.projectId,
      state.director.shots,
      state.director.visualDirectionSummary,
      state.feedback
    );
    updatedVisuals = {
      styleGuideSummary: state.director.visualDirectionSummary,
      shots: regeneratedShots,
    };
  }

  return {
    currentStage: "video_shots" as PipelineStage,
    visuals: updatedVisuals,
    feedback: undefined,
    logs: [
      logEntry(
        "video_shots",
        "node_completed",
        `مرحله ۳ (ساخت شات‌های ویدیو): ${state.director.shots.length} شات آماده رندر ویدیویی (لوکال ComfyUI/Parallax، مرورگر ایجنت Veo 2/Omni و صحنه سه‌بعدی) شد.`
      ),
    ],
  };
}

async function checkpoint3VideoShotsGate(state: StudioGraphState) {
  const resume = interrupt<
    {
      checkpoint: string;
      stage: PipelineStage;
      visuals: VisualAssetsOutput | null;
    },
    GateResumePayload
  >({
    checkpoint: "checkpoint_3_video_shots",
    stage: "video_shots",
    visuals: state.visuals,
  });

  if (resume?.action === "regenerate") {
    return {
      nextAction: "regenerate" as const,
      visuals: resume.visuals ?? state.visuals,
      feedback: resume.feedback,
      logs: [
        logEntry(
          "checkpoint_3_video_shots_gate",
          "checkpoint_resumed",
          "درخواست بازسازی شات‌های ویدیو با بازخورد کاربر ثبت شد."
        ),
      ],
    };
  }

  return {
    nextAction: "approve" as const,
    visuals: resume?.visuals ?? state.visuals,
    feedback: undefined,
    logs: [
      logEntry(
        "checkpoint_3_video_shots_gate",
        "checkpoint_resumed",
        "ایستگاه تایید ۳: شات‌های ویدیو تایید و وارد مرحله ساخت صدا شد."
      ),
    ],
  };
}

// ============================================================================
// Stage 4: Voiceover & Audio Sync (ساخت صدا برای ویدیو)
// ============================================================================
async function voiceoverNode(state: StudioGraphState) {
  if (!state.researchScript) {
    throw new Error("خروجی سناریو برای ساخت صدای ویدیو موجود نیست.");
  }

  const voiceName: VoicePersona = state.voiceover?.voiceName ?? "Kore";
  const voiceStyle = state.voiceover?.voiceStyle;
  const result = await runVoiceoverAgent(
    state.projectId,
    state.researchScript,
    state.brief,
    voiceName,
    voiceStyle,
    state.feedback,
    undefined,
    state.director
  );

  return {
    currentStage: "voiceover" as PipelineStage,
    voiceover: result,
    feedback: undefined,
    logs: [
      logEntry(
        "voiceover",
        "node_completed",
        "مرحله ۴ (ساخت صدا برای ویدیو): متن نریشن منطبق با زمان‌بندی شات‌ها و فایل صوتی WAV تولید شد."
      ),
    ],
  };
}

async function checkpoint4VoiceoverGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage; voiceover: VoiceoverOutput | null },
    GateResumePayload
  >({
    checkpoint: "checkpoint_4_voiceover",
    stage: "voiceover",
    voiceover: state.voiceover,
  });

  if (resume?.action === "regenerate") {
    return {
      nextAction: "regenerate" as const,
      voiceover: resume.voiceover ?? state.voiceover,
      feedback: resume.feedback,
      logs: [
        logEntry(
          "checkpoint_4_voiceover_gate",
          "checkpoint_resumed",
          "درخواست بازتولید صدای گوینده ثبت شد."
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
        "checkpoint_4_voiceover_gate",
        "checkpoint_resumed",
        "ایستگاه تایید ۴: صدا تایید و وارد مرحله تدوین، میکس و مونتاژ نهایی شد."
      ),
    ],
  };
}

// ============================================================================
// Stage 5: Final Editing, Mixing & Assembly (تدوین، میکس و مونتاژ نهایی)
// ============================================================================
async function assemblyNode(state: StudioGraphState) {
  return {
    currentStage: "assembly" as PipelineStage,
    feedback: undefined,
    logs: [
      logEntry(
        "assembly",
        "node_completed",
        "مرحله ۵ (تدوین و مونتاژ نهایی): تایم‌لاین Remotion + FFmpeg آماده میکس شات‌ها با صدای نریشن، زیرنویس فارسی و خروجی MP4 است."
      ),
    ],
  };
}

async function checkpoint5AssemblyGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage },
    GateResumePayload
  >({
    checkpoint: "checkpoint_5_assembly",
    stage: "assembly",
  });

  if (resume?.action === "regenerate") {
    return {
      nextAction: "regenerate" as const,
      feedback: resume.feedback,
      logs: [
        logEntry(
          "checkpoint_5_assembly_gate",
          "checkpoint_resumed",
          "درخواست بازتنظیم تایم‌لاین تدوین و مونتاژ نهایی ثبت شد."
        ),
      ],
    };
  }

  return {
    nextAction: "approve" as const,
    currentStage: "completed" as PipelineStage,
    logs: [
      logEntry(
        "checkpoint_5_assembly_gate",
        "checkpoint_resumed",
        "ایستگاه تایید ۵: تدوین، میکس و مونتاژ نهایی تکمیل و پروژه آماده انتشار شد."
      ),
    ],
  };
}

const checkpointer = new MemorySaver();

const workflow = new StateGraph(StudioGraphAnnotation)
  .addNode("research_and_script_node", researchAndScriptNode)
  .addNode("checkpoint_1_script_gate", checkpoint1ScriptGate)
  .addNode("storyboard_node", storyboardNode)
  .addNode("checkpoint_2_storyboard_gate", checkpoint2StoryboardGate)
  .addNode("video_shots_node", videoShotsNode)
  .addNode("checkpoint_3_video_shots_gate", checkpoint3VideoShotsGate)
  .addNode("voiceover_node", voiceoverNode)
  .addNode("checkpoint_4_voiceover_gate", checkpoint4VoiceoverGate)
  .addNode("assembly_node", assemblyNode)
  .addNode("checkpoint_5_assembly_gate", checkpoint5AssemblyGate)
  .addEdge(START, "research_and_script_node")
  .addEdge("research_and_script_node", "checkpoint_1_script_gate")
  .addConditionalEdges("checkpoint_1_script_gate", (s) =>
    s.nextAction === "regenerate" ? "research_and_script_node" : "storyboard_node"
  )
  .addEdge("storyboard_node", "checkpoint_2_storyboard_gate")
  .addConditionalEdges("checkpoint_2_storyboard_gate", (s) =>
    s.nextAction === "regenerate" ? "storyboard_node" : "video_shots_node"
  )
  .addEdge("video_shots_node", "checkpoint_3_video_shots_gate")
  .addConditionalEdges("checkpoint_3_video_shots_gate", (s) =>
    s.nextAction === "regenerate" ? "video_shots_node" : "voiceover_node"
  )
  .addEdge("voiceover_node", "checkpoint_4_voiceover_gate")
  .addConditionalEdges("checkpoint_4_voiceover_gate", (s) =>
    s.nextAction === "regenerate" ? "voiceover_node" : "assembly_node"
  )
  .addEdge("assembly_node", "checkpoint_5_assembly_gate")
  .addConditionalEdges("checkpoint_5_assembly_gate", (s) =>
    s.nextAction === "regenerate" ? "assembly_node" : END
  );

export const compiledStudioGraph = workflow.compile({ checkpointer });

function syncProjectFromGraph(
  project: ProjectRecord,
  values: Partial<StudioGraphState>,
  interrupted: boolean
): ProjectRecord {
  const stage: PipelineStage = values.currentStage ?? project.currentStage;
  const checkpointStatus = interrupted
    ? "waiting_approval"
    : stage === "completed"
      ? "approved"
      : "idle";

  const waitingNode = interrupted
    ? stage === "research_script"
      ? "checkpoint_1_script_gate"
      : stage === "storyboard"
        ? "checkpoint_2_storyboard_gate"
        : stage === "video_shots"
          ? "checkpoint_3_video_shots_gate"
          : stage === "voiceover"
            ? "checkpoint_4_voiceover_gate"
            : stage === "assembly"
              ? "checkpoint_5_assembly_gate"
              : null
    : null;

  const updated: ProjectRecord = {
    ...project,
    currentStage: stage,
    checkpointStatus,
    waitingNode,
    errorMessage: null,
    researchScript: values.researchScript ?? project.researchScript,
    director: values.director ?? project.director,
    visuals: values.visuals ?? project.visuals,
    voiceover: values.voiceover ?? project.voiceover,
    logs: values.logs && values.logs.length > 0 ? values.logs : project.logs,
  };
  return saveProject(updated);
}

/**
 * Starts the LangGraph 5-stage Studio Pipeline from Stage 1 (سناریو)
 */
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
        "شروع پایپ‌لاین ۵ مرحله‌ای استودیو (سناریو -> استوری‌بورد -> ساخت شات ویدیو -> صدا -> تدوین نهایی)."
      ),
    ],
  };

  const result = await compiledStudioGraph.invoke(initialInput, config);
  const interrupted = isInterrupted(result);
  return syncProjectFromGraph(project, result, interrupted);
}

/**
 * Resumes a paused LangGraph checkpoint with approval, inline edits, or regeneration feedback.
 * If MemorySaver lost thread state after server restart, recovers & advances smoothly across all 5 stages.
 */
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
  const updated = { ...project };
  if (payload.researchScript) updated.researchScript = payload.researchScript;
  if (payload.director) updated.director = payload.director;
  if (payload.visuals) updated.visuals = payload.visuals;
  if (payload.voiceover) updated.voiceover = payload.voiceover;

  // Stage 1 -> Stage 2
  if (project.currentStage === "research_script") {
    if (payload.action === "regenerate") {
      updated.researchScript = await runMergedResearchAndScript(updated.brief, payload.feedback);
      updated.logs.push(logEntry("research_and_script", "node_completed", "بازتولید سناریو انجام شد."));
      return saveProject({
        ...updated,
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_1_script_gate",
      });
    }

    const dir = await runDirectorAgent(updated.researchScript!, null, updated.brief);
    const shots = await runVisualProducerBatch(
      updated.id,
      dir.shots,
      dir.visualDirectionSummary
    );
    updated.director = dir;
    updated.visuals = { styleGuideSummary: dir.visualDirectionSummary, shots };
    updated.currentStage = "storyboard";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_2_storyboard_gate";
    updated.logs.push(
      logEntry("storyboard", "node_completed", `استوری‌بورد در ${dir.shots.length} شات طراحی شد.`)
    );
    return saveProject(updated);
  }

  // Stage 2 -> Stage 3
  if (project.currentStage === "storyboard") {
    if (payload.action === "regenerate") {
      const dir = await runDirectorAgent(
        updated.researchScript!,
        null,
        updated.brief,
        payload.feedback
      );
      const shots = await runVisualProducerBatch(
        updated.id,
        dir.shots,
        dir.visualDirectionSummary,
        payload.feedback
      );
      updated.director = dir;
      updated.visuals = { styleGuideSummary: dir.visualDirectionSummary, shots };
      updated.logs.push(logEntry("storyboard", "node_completed", "بازتولید استوری‌بورد انجام شد."));
      return saveProject({
        ...updated,
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_2_storyboard_gate",
      });
    }

    updated.currentStage = "video_shots";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_3_video_shots_gate";
    updated.logs.push(
      logEntry("video_shots", "node_completed", "استوری‌بورد تایید و وارد مرحله ساخت شات‌های ویدیو شد.")
    );
    return saveProject(updated);
  }

  // Stage 3 -> Stage 4
  if (project.currentStage === "video_shots") {
    if (payload.action === "regenerate") {
      if (updated.director) {
        const shots = await runVisualProducerBatch(
          updated.id,
          updated.director.shots,
          updated.director.visualDirectionSummary,
          payload.feedback
        );
        updated.visuals = { styleGuideSummary: updated.director.visualDirectionSummary, shots };
      }
      updated.logs.push(logEntry("video_shots", "node_completed", "بازسازی شات‌های ویدیو انجام شد."));
      return saveProject({
        ...updated,
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_3_video_shots_gate",
      });
    }

    const vo = await runVoiceoverAgent(
      updated.id,
      updated.researchScript!,
      updated.brief,
      updated.voiceover?.voiceName ?? "Kore",
      updated.voiceover?.voiceStyle,
      undefined,
      undefined,
      updated.director
    );
    updated.voiceover = vo;
    updated.currentStage = "voiceover";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_4_voiceover_gate";
    updated.logs.push(
      logEntry("voiceover", "node_completed", "متن نریشن همگام با شات‌ها و فایل صوتی WAV تولید شد.")
    );
    return saveProject(updated);
  }

  // Stage 4 -> Stage 5
  if (project.currentStage === "voiceover") {
    if (payload.action === "regenerate") {
      const vo = await runVoiceoverAgent(
        updated.id,
        updated.researchScript!,
        updated.brief,
        updated.voiceover?.voiceName ?? "Kore",
        updated.voiceover?.voiceStyle,
        payload.feedback,
        payload.feedback ? undefined : updated.voiceover?.narrationText,
        updated.director
      );
      updated.voiceover = vo;
      updated.logs.push(logEntry("voiceover", "node_completed", "بازتولید صدای گوینده انجام شد."));
      return saveProject({
        ...updated,
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_4_voiceover_gate",
      });
    }

    updated.currentStage = "assembly";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_5_assembly_gate";
    updated.logs.push(
      logEntry("assembly", "node_completed", "آماده تدوین، میکس و مونتاژ نهایی MP4.")
    );
    return saveProject(updated);
  }

  // Stage 5 -> Completed
  if (project.currentStage === "assembly") {
    if (payload.action === "regenerate") {
      updated.logs.push(
        logEntry("assembly", "node_completed", "بروزرسانی تنظیمات تدوین و مونتاژ نهایی ثبت شد.")
      );
      return saveProject({
        ...updated,
        checkpointStatus: "waiting_approval",
        waitingNode: "checkpoint_5_assembly_gate",
      });
    }

    updated.currentStage = "completed";
    updated.checkpointStatus = "approved";
    updated.waitingNode = null;
    updated.logs.push(
      logEntry("checkpoint_5_assembly_gate", "checkpoint_resumed", "تدوین و مونتاژ نهایی تکمیل و پروژه نهایی شد.")
    );
    return saveProject(updated);
  }

  return saveProject(updated);
}
