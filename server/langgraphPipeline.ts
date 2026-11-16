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
  formatGeminiError,
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

// Define LangGraph State Annotation
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
  voiceover: Annotation<VoiceoverOutput | null>({
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
  voiceover?: VoiceoverOutput;
  director?: DirectorOutput;
  visuals?: VisualAssetsOutput;
}

// 1. Merged Researcher + Scriptwriter Node
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
        "ایجنت ادغام‌شده پژوهشگر و سناریونویس پژوهش وب و سناریوی ساختاریافته را تکمیل کرد."
      ),
    ],
  };
}

// Checkpoint 1 Gate (Human-in-the-Loop)
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
          `درخواست بازتولید پژوهش و سناریو با بازخورد کاربر ثبت شد.`
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
        "ایستگاه تایید ۱: سناریو توسط کاربر تایید و به ایجنت گوینده ارسال شد."
      ),
    ],
  };
}

// 2. Voiceover + TTS Audio Node
async function voiceoverNode(state: StudioGraphState) {
  if (!state.researchScript) {
    throw new Error("خروجی سناریو برای ایجنت گوینده موجود نیست.");
  }
  const voiceName: VoicePersona = state.voiceover?.voiceName ?? "Kore";
  const voiceStyle = state.voiceover?.voiceStyle;
  const result = await runVoiceoverAgent(
    state.projectId,
    state.researchScript,
    state.brief,
    voiceName,
    voiceStyle,
    state.feedback
  );
  return {
    currentStage: "voiceover" as PipelineStage,
    voiceover: result,
    feedback: undefined,
    logs: [
      logEntry(
        "voiceover",
        "node_completed",
        "ایجنت گوینده متن نریشن و فایل صوتی WAV را تولید کرد."
      ),
    ],
  };
}

// Checkpoint 2 Gate (Human-in-the-Loop)
async function checkpoint2VoiceoverGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage; voiceover: VoiceoverOutput | null },
    GateResumePayload
  >({
    checkpoint: "checkpoint_2_voiceover",
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
          "checkpoint_2_voiceover_gate",
          "checkpoint_resumed",
          "درخواست بازتولید نریشن و صدا ثبت شد."
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
        "checkpoint_2_voiceover_gate",
        "checkpoint_resumed",
        "ایستگاه تایید ۲: نریشن و صدا تایید و به ایجنت کارگردان ارسال شد."
      ),
    ],
  };
}

// 3. Director / Decoupage Node
async function directorNode(state: StudioGraphState) {
  if (!state.researchScript || !state.voiceover) {
    throw new Error("داده سناریو یا نریشن برای کارگردان موجود نیست.");
  }
  const result = await runDirectorAgent(
    state.researchScript,
    state.voiceover,
    state.brief,
    state.feedback
  );
  return {
    currentStage: "director" as PipelineStage,
    director: result,
    feedback: undefined,
    logs: [
      logEntry(
        "director",
        "node_completed",
        `ایجنت کارگردان دکوپاژ را در ${result.shots.length} شات مجزا تدوین کرد.`
      ),
    ],
  };
}

// Checkpoint 3 Gate (Human-in-the-Loop)
async function checkpoint3DirectorGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage; director: DirectorOutput | null },
    GateResumePayload
  >({
    checkpoint: "checkpoint_3_director",
    stage: "director",
    director: state.director,
  });

  if (resume?.action === "regenerate") {
    return {
      nextAction: "regenerate" as const,
      feedback: resume.feedback,
      logs: [
        logEntry(
          "checkpoint_3_director_gate",
          "checkpoint_resumed",
          "درخواست بازتولید دکوپاژ شات‌ها ثبت شد."
        ),
      ],
    };
  }

  return {
    nextAction: "approve" as const,
    director: resume?.director ?? state.director,
    feedback: undefined,
    logs: [
      logEntry(
        "checkpoint_3_director_gate",
        "checkpoint_resumed",
        "ایستگاه تایید ۳: دکوپاژ تایید و به ایجنت تولیدکننده بصری ارسال شد."
      ),
    ],
  };
}

// 4. Visual Asset Producer Node
async function visualProducerNode(state: StudioGraphState) {
  if (!state.director) {
    throw new Error("دکوپاژ کارگردان برای تولید بصری موجود نیست.");
  }
  const generatedShots = await runVisualProducerBatch(
    state.projectId,
    state.director.shots,
    state.director.visualDirectionSummary,
    state.feedback
  );
  const visuals: VisualAssetsOutput = {
    styleGuideSummary: state.director.visualDirectionSummary,
    shots: generatedShots,
  };
  return {
    currentStage: "visuals" as PipelineStage,
    visuals,
    feedback: undefined,
    logs: [
      logEntry(
        "visual_producer",
        "node_completed",
        `ایجنت تولیدکننده بصری استوری‌بورد ${generatedShots.length} شات را تولید کرد.`
      ),
    ],
  };
}

// Checkpoint 4 Gate (Human-in-the-Loop)
async function checkpoint4VisualsGate(state: StudioGraphState) {
  const resume = interrupt<
    { checkpoint: string; stage: PipelineStage; visuals: VisualAssetsOutput | null },
    GateResumePayload
  >({
    checkpoint: "checkpoint_4_visuals",
    stage: "visuals",
    visuals: state.visuals,
  });

  if (resume?.action === "regenerate") {
    return {
      nextAction: "regenerate" as const,
      feedback: resume.feedback,
      logs: [
        logEntry(
          "checkpoint_4_visuals_gate",
          "checkpoint_resumed",
          "درخواست بازتولید کل استوری‌بورد ثبت شد."
        ),
      ],
    };
  }

  return {
    nextAction: "approve" as const,
    currentStage: "completed" as PipelineStage,
    visuals: resume?.visuals ?? state.visuals,
    logs: [
      logEntry(
        "checkpoint_4_visuals_gate",
        "checkpoint_resumed",
        "ایستگاه تایید ۴: پروژه تولید محتوا نهایی و آماده خروجی شد."
      ),
    ],
  };
}

const checkpointer = new MemorySaver();

const workflow = new StateGraph(StudioGraphAnnotation)
  .addNode("research_and_script_node", researchAndScriptNode)
  .addNode("checkpoint_1_script_gate", checkpoint1ScriptGate)
  .addNode("voiceover_node", voiceoverNode)
  .addNode("checkpoint_2_voiceover_gate", checkpoint2VoiceoverGate)
  .addNode("director_node", directorNode)
  .addNode("checkpoint_3_director_gate", checkpoint3DirectorGate)
  .addNode("visual_producer_node", visualProducerNode)
  .addNode("checkpoint_4_visuals_gate", checkpoint4VisualsGate)
  .addEdge(START, "research_and_script_node")
  .addEdge("research_and_script_node", "checkpoint_1_script_gate")
  .addConditionalEdges("checkpoint_1_script_gate", (s) =>
    s.nextAction === "regenerate" ? "research_and_script_node" : "voiceover_node"
  )
  .addEdge("voiceover_node", "checkpoint_2_voiceover_gate")
  .addConditionalEdges("checkpoint_2_voiceover_gate", (s) =>
    s.nextAction === "regenerate" ? "voiceover_node" : "director_node"
  )
  .addEdge("director_node", "checkpoint_3_director_gate")
  .addConditionalEdges("checkpoint_3_director_gate", (s) =>
    s.nextAction === "regenerate" ? "director_node" : "visual_producer_node"
  )
  .addEdge("visual_producer_node", "checkpoint_4_visuals_gate")
  .addConditionalEdges("checkpoint_4_visuals_gate", (s) =>
    s.nextAction === "regenerate" ? "visual_producer_node" : END
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
      : stage === "voiceover"
        ? "checkpoint_2_voiceover_gate"
        : stage === "director"
          ? "checkpoint_3_director_gate"
          : stage === "visuals"
            ? "checkpoint_4_visuals_gate"
            : null
    : null;

  const updated: ProjectRecord = {
    ...project,
    currentStage: stage,
    checkpointStatus,
    waitingNode,
    errorMessage: null,
    researchScript: values.researchScript ?? project.researchScript,
    voiceover: values.voiceover ?? project.voiceover,
    director: values.director ?? project.director,
    visuals: values.visuals ?? project.visuals,
    logs: values.logs && values.logs.length > 0 ? values.logs : project.logs,
  };
  return saveProject(updated);
}

/**
 * Starts the LangGraph pipeline from Stage 1 (Merged Researcher + Scriptwriter)
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
        "شروع پایپ‌لاین LangGraph و فعال‌سازی ایجنت ادغام‌شده پژوهشگر و سناریونویس."
      ),
    ],
  };

  const result = await compiledStudioGraph.invoke(initialInput, config);
  const interrupted = isInterrupted(result);
  return syncProjectFromGraph(project, result, interrupted);
}

/**
 * Resumes a paused LangGraph checkpoint with approval, inline edits, or regeneration feedback.
 * If MemorySaver lost thread state after server restart, gracefully handles direct stage execution.
 */
export async function resumePipeline(
  project: ProjectRecord,
  payload: GateResumePayload
): Promise<ProjectRecord> {
  const config = { configurable: { thread_id: project.threadId } };
  const snapshot = await compiledStudioGraph.getState(config);

  // If thread exists in active MemorySaver with pending interrupt, resume via LangGraph Command
  if (snapshot && snapshot.next && snapshot.next.length > 0) {
    const result = await compiledStudioGraph.invoke(new Command({ resume: payload }), config);
    const interrupted = isInterrupted(result);
    return syncProjectFromGraph(project, result, interrupted);
  }

  // Fallback recovery if server restarted mid-project: run targeted stage directly & save
  return await recoverAndAdvanceStage(project, payload);
}

async function recoverAndAdvanceStage(
  project: ProjectRecord,
  payload: GateResumePayload
): Promise<ProjectRecord> {
  const updated = { ...project };
  if (payload.researchScript) updated.researchScript = payload.researchScript;
  if (payload.voiceover) updated.voiceover = payload.voiceover;
  if (payload.director) updated.director = payload.director;
  if (payload.visuals) updated.visuals = payload.visuals;

  if (project.currentStage === "research_script") {
    if (payload.action === "regenerate") {
      updated.researchScript = await runMergedResearchAndScript(updated.brief, payload.feedback);
      updated.logs.push(logEntry("research_and_script", "node_completed", "بازتولید پژوهش و سناریو انجام شد."));
      return saveProject({ ...updated, checkpointStatus: "waiting_approval", waitingNode: "checkpoint_1_script_gate" });
    }
    const vo = await runVoiceoverAgent(updated.id, updated.researchScript!, updated.brief);
    updated.voiceover = vo;
    updated.currentStage = "voiceover";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_2_voiceover_gate";
    updated.logs.push(logEntry("voiceover", "node_completed", "نریشن و فایل صوتی WAV تولید شد."));
    return saveProject(updated);
  }

  if (project.currentStage === "voiceover") {
    if (payload.action === "regenerate") {
      const vo = await runVoiceoverAgent(
        updated.id,
        updated.researchScript!,
        updated.brief,
        updated.voiceover?.voiceName ?? "Kore",
        updated.voiceover?.voiceStyle,
        payload.feedback,
        payload.feedback ? undefined : updated.voiceover?.narrationText
      );
      updated.voiceover = vo;
      updated.logs.push(logEntry("voiceover", "node_completed", "بازتولید صدا و نریشن انجام شد."));
      return saveProject({ ...updated, checkpointStatus: "waiting_approval", waitingNode: "checkpoint_2_voiceover_gate" });
    }
    const dir = await runDirectorAgent(updated.researchScript!, updated.voiceover!, updated.brief);
    updated.director = dir;
    updated.currentStage = "director";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_3_director_gate";
    updated.logs.push(logEntry("director", "node_completed", `دکوپاژ در ${dir.shots.length} شات تدوین شد.`));
    return saveProject(updated);
  }

  if (project.currentStage === "director") {
    if (payload.action === "regenerate") {
      const dir = await runDirectorAgent(updated.researchScript!, updated.voiceover!, updated.brief, payload.feedback);
      updated.director = dir;
      updated.logs.push(logEntry("director", "node_completed", "بازتولید دکوپاژ انجام شد."));
      return saveProject({ ...updated, checkpointStatus: "waiting_approval", waitingNode: "checkpoint_3_director_gate" });
    }
    const shots = await runVisualProducerBatch(
      updated.id,
      updated.director!.shots,
      updated.director!.visualDirectionSummary
    );
    updated.visuals = { styleGuideSummary: updated.director!.visualDirectionSummary, shots };
    updated.currentStage = "visuals";
    updated.checkpointStatus = "waiting_approval";
    updated.waitingNode = "checkpoint_4_visuals_gate";
    updated.logs.push(logEntry("visual_producer", "node_completed", "تصاویر استوری‌بورد شات‌ها تولید شد."));
    return saveProject(updated);
  }

  if (project.currentStage === "visuals") {
    if (payload.action === "regenerate") {
      const shots = await runVisualProducerBatch(
        updated.id,
        updated.director!.shots,
        updated.director!.visualDirectionSummary,
        payload.feedback
      );
      updated.visuals = { styleGuideSummary: updated.director!.visualDirectionSummary, shots };
      updated.logs.push(logEntry("visual_producer", "node_completed", "بازتولید استوری‌بورد انجام شد."));
      return saveProject({ ...updated, checkpointStatus: "waiting_approval", waitingNode: "checkpoint_4_visuals_gate" });
    }
    updated.currentStage = "completed";
    updated.checkpointStatus = "approved";
    updated.waitingNode = null;
    updated.logs.push(logEntry("checkpoint_4_visuals_gate", "checkpoint_resumed", "پروژه نهایی شد."));
    return saveProject(updated);
  }

  return saveProject(updated);
}
