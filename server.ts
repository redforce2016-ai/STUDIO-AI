import "dotenv/config";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import {
  formatGeminiError,
  runAudioTranscriptionAgent,
  runQuickSearchResearch,
  runStrategistTopicProposals,
  runStudioImageAgent,
  runStudioVideoAgent,
  runVisualProducerForShot,
  runVoiceoverAgent,
} from "./server/gemini.js";
import { resumePipeline, startPipeline } from "./server/langgraphPipeline.js";
import { getRunOutputDir, runPreflightCheck } from "./server/video/config.js";
import {
  getVideoRun,
  retryShotAndReassemble,
  runVideoProductionPipeline,
} from "./server/video/graph.js";
import { ensureRemotionBrowser } from "./server/video/providers/remotion.js";
import type {
  CinemaLookPreset,
  KineticSubtitleStylePreset,
  VideoAspectFormat,
  VideoQualityMode,
} from "./src/types/videoPipeline.js";
import {
  buildMcpServersConfigJson,
  getMcpToolchainState,
  toggleToolchainAddon,
} from "./server/mcpToolchain.js";
import {
  connectColabGpuBridge,
  disconnectColabGpuBridge,
  getColabBridgeConfig,
  probeColabGpuBridge,
} from "./server/colabBridge.js";
import { generateAfterEffectsExtendScriptJsx } from "./server/video/afterEffectsExporter.js";
import {
  createProject,
  deleteProject,
  deleteStudioAsset,
  getAudioDir,
  getImagesDir,
  getProject,
  getVideosDir,
  getVisualsDir,
  listProjects,
  listStudioAssets,
  saveProject,
  saveStudioAsset,
} from "./server/store.js";
import {
  PROVIDER_DEFAULT_URLS,
  addManualModelToProvider,
  resetRouterCooldowns,
  syncAndDiscoverProviderModels,
  syncBrowserProfilesIntoRouter,
  testAgentChain,
  testProviderConnection,
  testSingleProviderModel,
  toPublicRouterConfig,
  toggleProviderEnabledServer,
  toggleProviderModel,
  updateAgentRoutes,
  updateProviderSettingsServer,
} from "./server/router.js";
import { generateWindowsBundleZip, getWindowsBundlePreviews } from "./server/windowsBundle.js";
import {
  CLOUD_GPU_PLATFORM_META,
  connectRemoteCloudGpuWorker,
  disconnectRemoteCloudGpuWorker,
  generateGoogleColabNotebookIpynb,
  generateMolabMarimoNotebookPy,
  getCloudGpuState,
  type CloudGpuModelPreset,
  type CloudGpuNotebookMode,
  type CloudGpuPlatform,
} from "./server/cloudGpuNotebooks.js";
import {
  extractDavinciClipsFromProject,
  generateDavinciResolveFcpxml,
  generateDavinciResolvePythonScript,
  generateOpenTimelineIoJson,
} from "./server/davinciResolveExport.js";
import { generateCube3dLutText } from "./server/video/cinemaMastering.js";
import { buildAndAuditI2VShotPlan } from "./server/video/i2vPromptDirector.js";
import { curatePhotorealisticShotKeyframe } from "./server/video/providers/realMediaCurator.js";
import { buildCompleteProjectOutputsZip } from "./server/projectBundleZip.js";
import {
  WEB_STUDIO_CATALOG,
  addOrUpdateBrowserProfile,
  clearAgentBrowserState,
  dispatchAgentBrowserCommand,
  executeWebStudioShotGeneration,
  getAgentBrowserState,
  resetProfileDailyQuota,
  switchActiveBrowserProfile,
  updateWebStudioSiteConfig,
} from "./server/agentBrowser.js";
import type {
  AgentBrowserCommandType,
  AgentRouteTarget,
  I2VTargetTool,
  ImageAspectRatio,
  ImageResolution,
  ProjectBrief,
  RouterProviderKind,
  StudioAgentId,
  StudioMediaAsset,
  VideoAspectRatio,
  VideoDurationOption,
  VideoResolutionOption,
  VoicePersona,
  WebStudioGenerationMode,
  WebStudioModelOption,
  WebStudioSiteConfig,
  WebStudioSiteId,
} from "./src/types/studio.js";

const ROUTER_PROVIDER_PRESETS: Array<{
  kind: RouterProviderKind;
  label: string;
  defaultBaseUrl: string;
  placeholderKey: string;
  hintFa: string;
}> = [
  {
    kind: "openrouter",
    label: "OpenRouter (مدل‌های متنوع و رایگان)",
    defaultBaseUrl: PROVIDER_DEFAULT_URLS.openrouter,
    placeholderKey: "sk-or-v1-...",
    hintFa: "پشتیبانی از مدل‌های رایگان (:free) و تشخیص خودکار پلن حساب.",
  },
  {
    kind: "groq",
    label: "Groq (سرعت فوق‌العاده بالا + رایگان)",
    defaultBaseUrl: PROVIDER_DEFAULT_URLS.groq,
    placeholderKey: "gsk_...",
    hintFa: "اجرای سریع Llama و Qwen و DeepSeek با پلن رایگان.",
  },
  {
    kind: "cerebras",
    label: "Cerebras (پردازش بسیار سریع + رایگان)",
    defaultBaseUrl: PROVIDER_DEFAULT_URLS.cerebras,
    placeholderKey: "csk-...",
    hintFa: "پاسخگویی سریع با سهمیه رایگان روزانه.",
  },
  {
    kind: "mistral",
    label: "Mistral AI",
    defaultBaseUrl: PROVIDER_DEFAULT_URLS.mistral,
    placeholderKey: "...",
    hintFa: "مدل‌های رسمی میسترال سازگار با OpenAI.",
  },
  {
    kind: "together",
    label: "Together AI",
    defaultBaseUrl: PROVIDER_DEFAULT_URLS.together,
    placeholderKey: "...",
    hintFa: "دسترسی به مدل‌های متن‌باز و تجاری.",
  },
  {
    kind: "huggingface",
    label: "Hugging Face Inference Router",
    defaultBaseUrl: PROVIDER_DEFAULT_URLS.huggingface,
    placeholderKey: "hf_...",
    hintFa: "مسیر رسمی روتر مدل‌های هاگینگ‌فیس.",
  },
  {
    kind: "google",
    label: "Google Gemini (کلید شخصی گوگل)",
    defaultBaseUrl: PROVIDER_DEFAULT_URLS.google,
    placeholderKey: "AIza...",
    hintFa: "اتصال مستقیم به کلید شخصی Google AI Studio.",
  },
  {
    kind: "openai_compatible",
    label: "سرویس دلخواه (OpenAI Compatible)",
    defaultBaseUrl: "",
    placeholderKey: "sk-...",
    hintFa: "هر آدرس Base URL سازگار با OpenAI یا سرور لوکال.",
  },
];

const VALID_AGENTS: StudioAgentId[] = [
  "research_script",
  "voiceover",
  "director",
  "visuals",
];

function resolveServerPort(): number {
  const portFlagIndex = process.argv.indexOf("--port");
  if (portFlagIndex !== -1 && process.argv[portFlagIndex + 1]) {
    const cliPort = Number(process.argv[portFlagIndex + 1]);
    if (Number.isFinite(cliPort) && cliPort > 0) return cliPort;
  }
  return 3000;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = resolveServerPort();

  app.use(express.json({ limit: "50mb" }));

  // Serve generated WAV audio & SVG storyboard media safely
  app.get("/api/media/audio/:filename", (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(getAudioDir(), safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "فایل صوتی یافت نشد." });
    }
    res.setHeader("Content-Type", "audio/wav");
    fs.createReadStream(fullPath).pipe(res);
  });

  app.get("/api/media/visuals/:filename", (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(getVisualsDir(), safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "تصویر استوری‌بورد یافت نشد." });
    }
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    fs.createReadStream(fullPath).pipe(res);
  });

  app.get("/api/media/images/:filename", (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(getImagesDir(), safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "فایل تصویر یافت نشد." });
    }
    const ext = path.extname(safeName).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    res.setHeader("Content-Type", mime);
    fs.createReadStream(fullPath).pipe(res);
  });

  const streamFileWithRangeAndDownload = (
    req: express.Request,
    res: express.Response,
    fullPath: string,
    contentType: string,
    defaultDownloadName: string
  ) => {
    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;
    const isDownload = req.query.download === "1" || req.query.download === "true";
    const requestedName =
      typeof req.query.filename === "string" && req.query.filename.trim()
        ? path.basename(req.query.filename.trim()).replace(/["\r\n]/g, "")
        : defaultDownloadName;

    const baseHeaders: Record<string, string | number> = {
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    };
    if (isDownload) {
      baseHeaders["Content-Disposition"] = `attachment; filename="${requestedName}"`;
    }

    if (req.method === "HEAD") {
      res.writeHead(200, { ...baseHeaders, "Content-Length": fileSize });
      return res.end();
    }

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = Math.max(0, parseInt(parts[0], 10) || 0);
      const end = parts[1] ? Math.min(fileSize - 1, parseInt(parts[1], 10)) : fileSize - 1;
      if (start >= fileSize || end < start) {
        res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
        return res.end();
      }
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": end - start + 1,
      });
      return fs.createReadStream(fullPath, { start, end }).pipe(res);
    }

    res.writeHead(200, {
      ...baseHeaders,
      "Content-Length": fileSize,
    });
    return fs.createReadStream(fullPath).pipe(res);
  };

  app.all("/api/media/videos/:filename", (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(getVideosDir(), safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "فایل ویدیو یافت نشد." });
    }
    return streamFileWithRangeAndDownload(req, res, fullPath, "video/mp4", safeName);
  });

  // Serve artifacts inside output/runs/<runId>/... (shot MP4s, extracted QA frames, final.mp4)
  app.all("/api/media/video-runs/:runId/*", (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
    const runId = path.basename(req.params.runId);
    const relPath = String((req.params as Record<string, string>)[0] || "");
    const safeSegments = relPath
      .split("/")
      .filter((seg) => seg && seg !== "." && seg !== "..");
    if (safeSegments.length === 0) {
      return res.status(400).json({ error: "مسیر فایل نامعتبر است." });
    }
    const runDir = getRunOutputDir(runId);
    const fullPath = path.resolve(runDir, ...safeSegments);
    if (!fullPath.startsWith(runDir) || !fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "فایل خروجی ویدیو یافت نشد." });
    }
    const ext = path.extname(fullPath).toLowerCase();
    const baseName = path.basename(fullPath);
    if (ext === ".png") {
      return streamFileWithRangeAndDownload(req, res, fullPath, "image/png", baseName);
    }
    if (ext === ".srt" || ext === ".cube") {
      return streamFileWithRangeAndDownload(req, res, fullPath, "text/plain; charset=utf-8", `${runId}_${baseName}`);
    }
    if (ext === ".json" || ext === ".otio") {
      return streamFileWithRangeAndDownload(req, res, fullPath, "application/json; charset=utf-8", `${runId}_${baseName}`);
    }
    if (ext === ".fcpxml") {
      return streamFileWithRangeAndDownload(req, res, fullPath, "application/xml; charset=utf-8", `${runId}_${baseName}`);
    }

    return streamFileWithRangeAndDownload(req, res, fullPath, "video/mp4", `${runId}_final.mp4`);
  });

  // Dedicated one-click download endpoint for a project's latest mastered final MP4
  app.all("/api/projects/:id/video/download", (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
    const project = getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: "پروژه یافت نشد." });
    }
    const runId = project.videoProduction?.runId;
    const candidates: string[] = [];
    if (runId) {
      candidates.push(path.join(getRunOutputDir(runId), "final.mp4"));
      candidates.push(path.join(getVideosDir(), `${runId}_final.mp4`));
    }
    const fullPath = candidates.find((p) => fs.existsSync(p));
    if (!fullPath) {
      return res.status(404).json({ error: "ویدیوی نهایی برای این پروژه هنوز رندر نشده است." });
    }
    req.query.download = "1";
    return streamFileWithRangeAndDownload(req, res, fullPath, "video/mp4", `${project.id}_reel_1080p.mp4`);
  });

  // List & fetch projects
  app.get("/api/projects", (_req, res) => {
    res.json({ projects: listProjects() });
  });

  app.get("/api/projects/:id", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });
    res.json({ project });
  });

  app.delete("/api/projects/:id", (req, res) => {
    const deleted = deleteProject(req.params.id);
    if (!deleted) return res.status(404).json({ error: "پروژه یافت نشد." });
    res.json({ ok: true });
  });

  // Pre-Script Strategist: analyze user idea from Strategist, Psychology & Pro Creator lenses and return 3 viral topics
  app.post("/api/projects/propose-topics", async (req, res) => {
    const brief = req.body as Partial<ProjectBrief>;
    if (!brief?.idea?.trim()) {
      return res.status(400).json({ error: "لطفاً ایده یا موضوع خود را بنویسید." });
    }
    const cleanIdea = brief.idea.trim();
    const derivedTitle = brief.title?.trim() || cleanIdea.split(/[\n.!؟]/)[0]?.trim().slice(0, 80) || "پروژه جدید";

    try {
      const analysis = await runStrategistTopicProposals({
        title: derivedTitle,
        idea: cleanIdea,
        platform: brief.platform || "instagram",
        contentFormat: brief.contentFormat || "reels",
        pageMaturity: brief.pageMaturity === "growing_page" ? "growing_page" : "new_page",
        tone: brief.tone || "educational",
        targetDurationSeconds: brief.targetDurationSeconds || 45,
      });
      res.json({ analysis });
    } catch (err) {
      const msg = formatGeminiError(err);
      res.status(500).json({ error: msg });
    }
  });

  // Create a project and immediately run LangGraph Stage 1 (Merged Researcher + Scriptwriter)
  app.post("/api/projects/start", async (req, res) => {
    const brief = req.body as Partial<ProjectBrief>;
    if (!brief?.idea?.trim()) {
      return res.status(400).json({ error: "متن ایده برای شروع الزامی است." });
    }
    const cleanIdea = brief.idea.trim();
    const resolvedTitle =
      brief.title?.trim() ||
      brief.selectedTopicAngle?.title?.trim() ||
      cleanIdea.split(/[\n.!؟]/)[0]?.trim().slice(0, 80) ||
      "پروژه محتوای جدید";

    const resolvedTone =
      brief.selectedTopicAngle?.recommendedTone || brief.tone || "educational";
    const resolvedToneLabel =
      brief.selectedTopicAngle?.recommendedToneLabelFa || brief.toneLabelFa;
    const resolvedDuration =
      brief.selectedTopicAngle?.recommendedDurationSeconds || brief.targetDurationSeconds || 45;

    const project = createProject({
      title: resolvedTitle,
      idea: cleanIdea,
      platform: brief.platform || "instagram",
      contentFormat: brief.contentFormat || "reels",
      pageMaturity: brief.pageMaturity === "growing_page" ? "growing_page" : "new_page",
      tone: resolvedTone,
      toneLabelFa: resolvedToneLabel,
      targetDurationSeconds: resolvedDuration,
      selectedTopicAngle: brief.selectedTopicAngle ?? null,
    });

    try {
      const running = saveProject({ ...project, checkpointStatus: "running", currentStage: "research_script" });
      const updated = await startPipeline(running);
      res.json({ project: updated });
    } catch (err) {
      const msg = formatGeminiError(err);
      const failed = saveProject({
        ...project,
        currentStage: "research_script",
        checkpointStatus: "error",
        errorMessage: msg,
      });
      res.status(500).json({ error: msg, project: failed });
    }
  });

  // Resume LangGraph checkpoint (approve with edits OR regenerate with feedback)
  app.post("/api/projects/:id/resume", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });

    try {
      saveProject({ ...project, checkpointStatus: "running", errorMessage: null });
      const updated = await resumePipeline(project, req.body);
      res.json({ project: updated });
    } catch (err) {
      const msg = formatGeminiError(err);
      const failed = saveProject({
        ...project,
        checkpointStatus: "error",
        errorMessage: msg,
      });
      res.status(500).json({ error: msg, project: failed });
    }
  });

  // Synthesize or re-synthesize audio directly when user edits narration text or switches voice persona
  app.post("/api/projects/:id/voiceover/audio", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.researchScript) {
      return res.status(404).json({ error: "پروژه یا سناریو یافت نشد." });
    }

    try {
      const { narrationText, voiceName, voiceStyle, feedback } = req.body as {
        narrationText?: string;
        voiceName?: VoicePersona;
        voiceStyle?: string;
        feedback?: string;
      };
      const vo = await runVoiceoverAgent(
        project.id,
        project.researchScript,
        project.brief,
        voiceName ?? project.voiceover?.voiceName ?? "Kore",
        voiceStyle ?? project.voiceover?.voiceStyle,
        feedback,
        narrationText,
        project.director
      );
      const updated = saveProject({
        ...project,
        voiceover: vo,
        checkpointStatus: "waiting_approval",
      });
      res.json({ project: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در تولید صدای نریشن";
      res.status(500).json({ error: msg });
    }
  });

  // Regenerate a single storyboard shot visually
  app.post("/api/projects/:id/shots/:shotNumber/regenerate", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.director) {
      return res.status(404).json({ error: "پروژه یا دکوپاژ یافت نشد." });
    }
    const shotNum = Number(req.params.shotNumber);
    const shot = project.director.shots.find((s) => s.shotNumber === shotNum);
    if (!shot) return res.status(404).json({ error: "شات موردنظر یافت نشد." });

    try {
      const { feedback, updatedPrompt, aspectRatio } = req.body as {
        feedback?: string;
        updatedPrompt?: string;
        aspectRatio?: "9:16" | "16:9";
      };
      const targetShot = updatedPrompt ? { ...shot, visualPromptFa: updatedPrompt } : shot;

      if (updatedPrompt) {
        project.director = {
          ...project.director,
          shots: project.director.shots.map((s) => (s.shotNumber === shotNum ? targetShot : s)),
        };
      }

      const inferredAspect: "9:16" | "16:9" =
        aspectRatio === "16:9" ||
        project.brief.contentFormat === "long_video" ||
        project.brief.platform === "youtube"
          ? "16:9"
          : "9:16";

      const existingShots = project.visuals?.shots ?? [];
      const existingUsedUrls = new Set<string>(
        existingShots
          .map((s) => s.sourceMediaUrl)
          .filter((u): u is string => typeof u === "string" && u.length > 0)
      );

      const regenerated = await runVisualProducerForShot(
        project.id,
        targetShot,
        project.director.visualDirectionSummary,
        feedback,
        inferredAspect,
        existingUsedUrls
      );

      const mergedShots = existingShots.some((s) => s.shotNumber === shotNum)
        ? existingShots.map((s) => (s.shotNumber === shotNum ? regenerated : s))
        : [...existingShots, regenerated].sort((a, b) => a.shotNumber - b.shotNumber);

      const updated = saveProject({
        ...project,
        visuals: {
          styleGuideSummary: project.visuals?.styleGuideSummary ?? project.director.visualDirectionSummary,
          shots: mergedShots,
        },
      });
      res.json({ project: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در بازتولید تصویر شات";
      res.status(500).json({ error: msg });
    }
  });

  // Save inline edits to project without advancing stage
  app.patch("/api/projects/:id", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });
    const updated = saveProject({ ...project, ...req.body, id: project.id });
    res.json({ project: updated });
  });

  // ============================================================================
  // 10-Node Video Production & Visual QA Pipeline Endpoints
  // ============================================================================
  app.get("/api/video/preflight", (_req, res) => {
    res.json({ preflight: runPreflightCheck() });
  });

  app.get("/api/video/hardware", async (_req, res) => {
    const { detectHardwareAndWriteConfig, getModelInstallInstructions } = await import(
      "./server/video/hardware.js"
    );
    const report = await detectHardwareAndWriteConfig();
    res.json({
      hardware: report.hardware,
      configPath: report.configPath,
      installInstructions: getModelInstallInstructions(report.hardware.selectedProfile),
    });
  });

  app.post("/api/video/models/setup", async (req, res) => {
    try {
      const { runConfirmedModelSetup } = await import("./server/video/modelInstaller.js");
      const { targetProfile } = (req.body || {}) as {
        targetProfile?: "wan_2_2_5b_gguf" | "wan_2_2_or_ltx_2_3_fp8" | "parallax_only";
      };
      const report = await runConfirmedModelSetup({ targetProfile });
      res.json({ report });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در آماده‌سازی مدل‌های محلی";
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/video/runs/:runId/srt", (req, res) => {
    const runDir = getRunOutputDir(req.params.runId);
    const srtPath = path.join(runDir, "subtitles.srt");
    if (!fs.existsSync(srtPath)) {
      return res.status(404).json({ error: "فایل زیرنویس SRT یافت نشد." });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.runId}_subtitles.srt"`);
    fs.createReadStream(srtPath).pipe(res);
  });

  app.get("/api/video/runs/:runId/report", (req, res) => {
    const runDir = getRunOutputDir(req.params.runId);
    const reportPath = path.join(runDir, "report.json");
    if (!fs.existsSync(reportPath)) {
      const live = getVideoRun(req.params.runId);
      if (!live) return res.status(404).json({ error: "گزارش اجرا یافت نشد." });
      return res.json(live);
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.runId}_report.json"`);
    fs.createReadStream(reportPath).pipe(res);
  });

  app.post("/api/projects/:id/video/render", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });

    const preflight = runPreflightCheck();
    if (!preflight.ready) {
      return res.status(500).json({
        error: `پیش‌نیازهای رندر آماده نیست: ${preflight.missingCritical.join("، ")}`,
        preflight,
      });
    }

    const {
      aspectRatio,
      qualityMode,
      burnSubtitles,
      includeBackgroundMusic,
      colorGradePreset,
      subtitleStylePreset,
      musicSource,
    } = req.body as {
      aspectRatio?: VideoAspectFormat;
      qualityMode?: VideoQualityMode;
      burnSubtitles?: boolean;
      includeBackgroundMusic?: boolean;
      colorGradePreset?: CinemaLookPreset;
      subtitleStylePreset?: KineticSubtitleStylePreset;
      musicSource?: "lyria" | "ambient_cinema" | "none";
    };

    const inferredAspect: VideoAspectFormat =
      aspectRatio ||
      (project.brief.contentFormat === "long_video" || project.brief.platform === "youtube"
        ? "16:9"
        : "9:16");
    const chosenQuality: VideoQualityMode =
      qualityMode === "preview_480p" ? "preview_480p" : "final_1080p";
    const chosenLook: CinemaLookPreset = colorGradePreset || "industrial_teal_amber";
    const chosenSubtitlePreset: KineticSubtitleStylePreset =
      subtitleStylePreset || "industrial_steel_blue";
    const chosenMusic: "lyria" | "ambient_cinema" | "none" = musicSource || "ambient_cinema";

    const scenarioLines: string[] = [];
    if (project.researchScript) {
      scenarioLines.push(`عنوان: ${project.researchScript.videoTitle}`);
      scenarioLines.push(`قلاب: ${project.researchScript.hook}`);
      scenarioLines.push(`بدنه: ${project.researchScript.body}`);
      scenarioLines.push(`CTA: ${project.researchScript.cta}`);
    } else {
      scenarioLines.push(project.brief.idea);
    }

    const narrationWavPath = project.voiceover?.audioFilename
      ? path.join(getAudioDir(), path.basename(project.voiceover.audioFilename))
      : null;

    const runId = `vrun_${project.id}_${Date.now()}`;
    const initialStub = saveProject({
      ...project,
      videoProduction: {
        runId,
        projectId: project.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        aspectRatio: inferredAspect,
        qualityMode: chosenQuality,
        colorGradePreset: chosenLook,
        subtitleStylePreset: chosenSubtitlePreset,
        musicSource: chosenMusic,
        status: "running",
        currentNode: "START",
        shots: [],
        logs: [
          {
            timestamp: new Date().toISOString(),
            node: "START",
            level: "info",
            message: "پایپ‌لاین ۱۰ مرحله‌ای تولید ویدیو (موتورهای رایگان + زیرنویس کینتیک + QA ۷ لایه) آغاز شد.",
          },
        ],
      },
    });

    // Run pipeline in background so UI can poll live node-by-node status cleanly
    void runVideoProductionPipeline({
      runId,
      projectId: project.id,
      scenarioText: scenarioLines.join("\n"),
      aspectRatio: inferredAspect,
      qualityMode: chosenQuality,
      colorGradePreset: chosenLook,
      subtitleStylePreset: chosenSubtitlePreset,
      musicSource: chosenMusic,
      director: project.director,
      researchScript: project.researchScript,
      narrationWavPath,
      burnSubtitles: burnSubtitles !== false,
      includeBackgroundMusic: includeBackgroundMusic !== false && chosenMusic !== "none",
    }).then((finalRun) => {
      const latest = getProject(project.id);
      if (latest) {
        saveProject({
          ...latest,
          videoProduction: finalRun,
        });
      }
    });

    res.json({ project: initialStub, runId });
  });

  app.get("/api/projects/:id/video/status", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });

    const runId = project.videoProduction?.runId;
    const liveRun = runId ? getVideoRun(runId) : null;
    const effective = liveRun || project.videoProduction || null;
    if (liveRun && project.videoProduction?.updatedAt !== liveRun.updatedAt) {
      saveProject({ ...project, videoProduction: liveRun });
    }
    res.json({ videoProduction: effective });
  });

  app.post("/api/projects/:id/video/shots/:shotId/retry", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.videoProduction?.runId) {
      return res.status(404).json({ error: "اجرای ویدیویی برای این پروژه یافت نشد." });
    }
    const { humanInstruction } = req.body as { humanInstruction?: string };
    try {
      const updatedRun = await retryShotAndReassemble({
        runId: project.videoProduction.runId,
        shotId: req.params.shotId,
        humanInstruction,
      });
      const updatedProj = saveProject({
        ...project,
        videoProduction: updatedRun,
      });
      res.json({ project: updatedProj, videoProduction: updatedRun });
    } catch (err) {
      const msg = formatGeminiError(err);
      res.status(500).json({ error: msg });
    }
  });

  // Windows Tauri + Python LangGraph Bundle Preview & ZIP Download
  app.get("/api/windows-bundle/preview", (_req, res) => {
    res.json({ files: getWindowsBundlePreviews() });
  });

  app.get("/api/windows-bundle/download", async (_req, res) => {
    try {
      const zipBuffer = await generateWindowsBundleZip();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="ContentStudioDesktop-Windows-Tauri-Python.zip"'
      );
      res.send(zipBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در ساخت بسته ویندوز";
      res.status(500).json({ error: msg });
    }
  });

  // Studio Media Assets (Images, Videos, Transcripts)
  app.get("/api/studio/assets", (_req, res) => {
    res.json({ assets: listStudioAssets() });
  });

  app.delete("/api/studio/assets/:id", (req, res) => {
    const deleted = deleteStudioAsset(req.params.id);
    if (!deleted) return res.status(404).json({ error: "آیتم مدیا یافت نشد." });
    res.json({ ok: true });
  });

  // Create & Edit Images (gemini-nano-banana-2.1)
  app.post("/api/studio/image", async (req, res) => {
    try {
      const { prompt, aspectRatio, imageSize, imageBase64, mimeType, useSearchGrounding, title } = req.body as {
        prompt?: string;
        aspectRatio?: ImageAspectRatio;
        imageSize?: ImageResolution;
        imageBase64?: string;
        mimeType?: string;
        useSearchGrounding?: boolean;
        title?: string;
      };
      if (!prompt?.trim()) {
        return res.status(400).json({ error: "دستور متنی برای تولید یا ویرایش تصویر الزامی است." });
      }
      const result = await runStudioImageAgent({
        prompt: prompt.trim(),
        aspectRatio,
        imageSize,
        imageBase64,
        mimeType,
        useSearchGrounding,
      });

      const asset: StudioMediaAsset = {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "image",
        title: (title?.trim() || prompt.trim()).slice(0, 120),
        prompt: prompt.trim(),
        mediaUrl: result.imageUrl,
        aspectRatio: aspectRatio || "1:1",
        modelUsed: "gemini-nano-banana-2.1",
        notes: result.caption,
        createdAt: new Date().toISOString(),
      };
      saveStudioAsset(asset);
      res.json({ asset });
    } catch (err) {
      const msg = formatGeminiError(err);
      res.status(500).json({ error: msg });
    }
  });

  // Animate Keyframe Locally (ComfyUIProvider + ParallaxVideoProvider fallback; Text-to-Video forbidden)
  app.post("/api/studio/video", async (req, res) => {
    try {
      const { prompt, aspectRatio, duration, resolution, imageBase64, mimeType, title } = req.body as {
        prompt?: string;
        aspectRatio?: VideoAspectRatio;
        duration?: VideoDurationOption;
        resolution?: VideoResolutionOption;
        imageBase64?: string;
        mimeType?: string;
        title?: string;
      };
      if (!prompt?.trim()) {
        return res.status(400).json({ error: "توضیح حرکت آرام دوربین برای متحرک‌سازی تصویر کلیدی الزامی است." });
      }
      if (!imageBase64?.trim()) {
        return res.status(400).json({
          error:
            "قانون کیفیت شماره ۴: تولید ویدیو از متن (Text-to-Video) ممنوع است. لطفاً یک تصویر کلیدی (Keyframe) بارگذاری کنید.",
        });
      }
      const result = await runStudioVideoAgent({
        prompt: prompt.trim(),
        aspectRatio,
        duration,
        resolution,
        imageBase64,
        mimeType,
      });

      const asset: StudioMediaAsset = {
        id: `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "video",
        title: (title?.trim() || prompt.trim()).slice(0, 120),
        prompt: prompt.trim(),
        mediaUrl: result.videoUrl,
        aspectRatio: aspectRatio || "16:9",
        modelUsed: result.providerUsed === "comfyui" ? "ComfyUI Local (Wan 2.2 / LTX-2.3)" : "Local Parallax 2.5D Depth",
        notes: `متحرک‌سازی محلی Keyframe (${result.providerUsed}) · زمان: ${result.renderDurationMs}ms · تلاش: ${result.attempts}`,
        createdAt: new Date().toISOString(),
      };
      saveStudioAsset(asset);
      res.json({ asset });
    } catch (err) {
      const msg = formatGeminiError(err);
      res.status(500).json({ error: msg });
    }
  });

  // Transcribe Audio (gemini-3.5-transcribe)
  app.post("/api/studio/transcribe", async (req, res) => {
    try {
      const { audioBase64, mimeType, instruction, title } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        instruction?: string;
        title?: string;
      };
      if (!audioBase64) {
        return res.status(400).json({ error: "داده صوتی ارسال نشده است." });
      }
      const { transcript } = await runAudioTranscriptionAgent({
        audioBase64,
        mimeType: mimeType || "audio/webm",
        instruction,
      });

      const asset: StudioMediaAsset = {
        id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "transcript",
        title: title?.trim() || `رونویسی صوت (${new Date().toLocaleTimeString("fa-IR")})`,
        prompt: instruction?.trim() || "تبدیل گفتار به متن فارسی",
        mediaUrl: null,
        aspectRatio: "audio",
        modelUsed: "gemini-3.5-transcribe",
        transcriptText: transcript,
        createdAt: new Date().toISOString(),
      };
      saveStudioAsset(asset);
      res.json({ transcript, asset });
    } catch (err) {
      const msg = formatGeminiError(err);
      res.status(500).json({ error: msg });
    }
  });

  // Standalone Google Search Grounded Research
  app.post("/api/studio/research", async (req, res) => {
    try {
      const { query } = req.body as { query?: string };
      if (!query?.trim()) {
        return res.status(400).json({ error: "متن پرسش پژوهشی الزامی است." });
      }
      const result = await runQuickSearchResearch(query.trim());
      res.json(result);
    } catch (err) {
      const msg = formatGeminiError(err);
      res.status(500).json({ error: msg });
    }
  });

  // ============================================================================
  // Playwright Stealth Chromium + LangGraph Multi-Account Agent Browser API
  // ============================================================================
  app.get("/api/browser/state", (_req, res) => {
    res.json({
      browser: getAgentBrowserState(),
      catalog: WEB_STUDIO_CATALOG,
    });
  });

  app.post("/api/browser/command", async (req, res) => {
    try {
      const { command, target, agentName } = (req.body || {}) as {
        command?: AgentBrowserCommandType;
        target?: string;
        agentName?: string;
      };
      if (!command) {
        return res.status(400).json({ error: "نوع دستور مرورگر (command) الزامی است." });
      }
      if (
        (command === "search" ||
          command === "goto" ||
          command === "click" ||
          command === "fill" ||
          command === "select" ||
          command === "mission") &&
        !target?.trim()
      ) {
        return res.status(400).json({ error: "مقدار هدف یا عبارت دستور (target) الزامی است." });
      }
      const state = await dispatchAgentBrowserCommand({
        command,
        target: target || "",
        agentName,
      });
      res.json({ browser: state });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در اجرای دستور مرورگر ایجنت";
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/browser/profiles", (req, res) => {
    try {
      const { id, name, email, password, dailyLimit, connectedSites, notesFa } = (req.body || {}) as {
        id?: string;
        name?: string;
        email?: string;
        password?: string;
        dailyLimit?: number;
        connectedSites?: WebStudioSiteId[];
        notesFa?: string;
      };
      if (!email?.trim()) {
        return res.status(400).json({ error: "ایمیل اکانت گوگل الزامی است." });
      }
      const browser = addOrUpdateBrowserProfile({
        id,
        name: name?.trim() || email.trim(),
        email: email.trim(),
        password: password?.trim(),
        dailyLimit,
        connectedSites,
        notesFa,
      });
      res.json({ browser });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در ثبت پروفایل گوگل";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/browser/profiles/:id/switch", (req, res) => {
    const browser = switchActiveBrowserProfile(
      req.params.id,
      "سوییچ دستی پروفایل گوگل توسط کاربر"
    );
    res.json({ browser });
  });

  app.post("/api/browser/profiles/reset-quota", (req, res) => {
    const { profileId } = (req.body || {}) as { profileId?: string };
    const browser = resetProfileDailyQuota(profileId);
    res.json({ browser });
  });

  app.put("/api/browser/site-config", (req, res) => {
    const patch = (req.body || {}) as Partial<WebStudioSiteConfig>;
    const browser = updateWebStudioSiteConfig(patch);
    res.json({ browser });
  });

  app.post("/api/browser/studio/generate-shot", async (req, res) => {
    try {
      const {
        rawPrompt,
        projectId,
        shotNumber,
        siteId,
        mode,
        modelId,
        aspectRatio,
        resolution,
        targetTool,
      } = (req.body || {}) as {
        rawPrompt?: string;
        projectId?: string | null;
        shotNumber?: number | null;
        siteId?: WebStudioSiteId;
        mode?: WebStudioGenerationMode;
        modelId?: WebStudioModelOption;
        aspectRatio?: "9:16" | "16:9" | "1:1";
        resolution?: "720p" | "1080p";
        targetTool?: I2VTargetTool;
      };
      if (!rawPrompt?.trim()) {
        return res.status(400).json({
          error: "پرامپت شات برای نهایی‌سازی و ارسال به وب‌سایت الزامی است.",
        });
      }
      const result = await executeWebStudioShotGeneration({
        rawPrompt: rawPrompt.trim(),
        projectId,
        shotNumber,
        siteId,
        mode,
        modelId,
        aspectRatio,
        resolution,
        targetTool,
      });
      res.json({
        job: result.job,
        browser: result.browserState,
        project: projectId ? getProject(projectId) : null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در تولید شات با مرورگر ایجنت";
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/browser/clear", (_req, res) => {
    res.json({ browser: clearAgentBrowserState() });
  });

  // ============================================================================
  // Cloud GPU Notebooks (Marimo Molab & Google Colab) + 10-Profile GPU Worker API
  // ============================================================================
  app.get("/api/gpu-notebooks/state", (_req, res) => {
    const profiles = getAgentBrowserState().profiles.map((p) => ({
      id: p.id,
      email: p.email,
    }));
    res.json({
      cloudGpu: getCloudGpuState(profiles),
      platforms: CLOUD_GPU_PLATFORM_META,
    });
  });

  app.get("/api/gpu-notebooks/preview", (req, res) => {
    const platform = (req.query.platform === "google_colab" ? "google_colab" : "molab") as CloudGpuPlatform;
    const mode = (
      req.query.mode === "full_studio_server" ? "full_studio_server" : "comfyui_i2v_worker"
    ) as CloudGpuNotebookMode;
    const modelPreset = (
      req.query.modelPreset === "wan22_fp8_14b" ||
      req.query.modelPreset === "ltx_video_fp8" ||
      req.query.modelPreset === "wan22_5b_gguf"
        ? req.query.modelPreset
        : platform === "molab"
          ? "wan22_fp8_14b"
          : "wan22_5b_gguf"
    ) as CloudGpuModelPreset;
    const profileEmail = typeof req.query.profileEmail === "string" ? req.query.profileEmail : undefined;
    const repoUrl = typeof req.query.repoUrl === "string" ? req.query.repoUrl : undefined;
    const mountGoogleDrive = req.query.mountGoogleDrive === "true";

    const content =
      platform === "molab"
        ? generateMolabMarimoNotebookPy({ platform, mode, modelPreset, profileEmail, repoUrl })
        : generateGoogleColabNotebookIpynb({
            platform,
            mode,
            modelPreset,
            profileEmail,
            repoUrl,
            mountGoogleDrive,
          });
    res.json({
      platform,
      filename: CLOUD_GPU_PLATFORM_META[platform].defaultFilename,
      content,
    });
  });

  app.get("/api/gpu-notebooks/download", (req, res) => {
    const platform = (req.query.platform === "google_colab" ? "google_colab" : "molab") as CloudGpuPlatform;
    const mode = (
      req.query.mode === "full_studio_server" ? "full_studio_server" : "comfyui_i2v_worker"
    ) as CloudGpuNotebookMode;
    const modelPreset = (
      req.query.modelPreset === "wan22_fp8_14b" ||
      req.query.modelPreset === "ltx_video_fp8" ||
      req.query.modelPreset === "wan22_5b_gguf"
        ? req.query.modelPreset
        : platform === "molab"
          ? "wan22_fp8_14b"
          : "wan22_5b_gguf"
    ) as CloudGpuModelPreset;
    const profileEmail = typeof req.query.profileEmail === "string" ? req.query.profileEmail : undefined;
    const repoUrl = typeof req.query.repoUrl === "string" ? req.query.repoUrl : undefined;
    const mountGoogleDrive = req.query.mountGoogleDrive === "true";

    const filename = CLOUD_GPU_PLATFORM_META[platform].defaultFilename;
    const content =
      platform === "molab"
        ? generateMolabMarimoNotebookPy({ platform, mode, modelPreset, profileEmail, repoUrl })
        : generateGoogleColabNotebookIpynb({
            platform,
            mode,
            modelPreset,
            profileEmail,
            repoUrl,
            mountGoogleDrive,
          });

    res.setHeader(
      "Content-Type",
      platform === "molab" ? "text/x-python; charset=utf-8" : "application/x-ipynb+json; charset=utf-8"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  });

  app.post("/api/gpu-notebooks/connect", async (req, res) => {
    try {
      const { profileId, platform, tunnelUrl, notebookUrl } = (req.body || {}) as {
        profileId?: string;
        platform?: CloudGpuPlatform;
        tunnelUrl?: string;
        notebookUrl?: string;
      };
      if (!tunnelUrl?.trim()) {
        return res.status(400).json({ error: "آدرس تونل سرور GPU (trycloudflare.com) الزامی است." });
      }
      const browser = getAgentBrowserState();
      const targetProfile =
        browser.profiles.find((p) => p.id === profileId) ||
        browser.profiles.find((p) => p.id === browser.activeProfileId) ||
        browser.profiles[0];

      const result = await connectRemoteCloudGpuWorker({
        profileId: targetProfile.id,
        email: targetProfile.email,
        platform: platform === "google_colab" ? "google_colab" : "molab",
        tunnelUrl: tunnelUrl.trim(),
        notebookUrl,
        profiles: browser.profiles.map((p) => ({ id: p.id, email: p.email })),
      });
      res.json({
        cloudGpu: result.state,
        probeOk: result.probeOk,
        messageFa: result.messageFa,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در اتصال به سرور GPU ابری";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/gpu-notebooks/disconnect", (_req, res) => {
    const profiles = getAgentBrowserState().profiles.map((p) => ({
      id: p.id,
      email: p.email,
    }));
    res.json({ cloudGpu: disconnectRemoteCloudGpuWorker(profiles) });
  });

  // Helper: prepare Scenario-Driven I2V Prompt + Multimodal QA Supervision for one shot
  async function prepareAndAuditSingleShotI2V(params: {
    projectId: string;
    shotNumber: number;
    targetTool: I2VTargetTool;
    feedback?: string;
    aspectRatio: "9:16" | "16:9";
  }) {
    const proj = getProject(params.projectId);
    if (!proj || !proj.director?.shots?.length) {
      throw new Error("پروژه یا دکوپاژ کارگردانی یافت نشد.");
    }
    const dirShot = proj.director.shots.find((s) => s.shotNumber === params.shotNumber);
    if (!dirShot) throw new Error(`شات شماره ${params.shotNumber} یافت نشد.`);
    const visShot = proj.visuals?.shots.find((s) => s.shotNumber === params.shotNumber);

    const resolveKfPath = (url?: string | null): string | null => {
      if (!url) return null;
      if (url.startsWith("/api/media/images/")) {
        const p = path.join(getImagesDir(), path.basename(url));
        return fs.existsSync(p) ? p : null;
      }
      if (url.startsWith("/api/media/visuals/")) {
        const p = path.join(getVisualsDir(), path.basename(url));
        return fs.existsSync(p) ? p : null;
      }
      return null;
    };

    let kfPath = resolveKfPath(visShot?.imageUrl);
    // If a verified rendered shot video already exists, inspect its real live-action mid-frame during QA!
    if (visShot?.videoUrl && visShot.videoUrl.startsWith("/api/media/videos/")) {
      const vidDisk = path.join(getVideosDir(), path.basename(visShot.videoUrl));
      if (fs.existsSync(vidDisk)) {
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execAsync = promisify(execFile);
          const qaFrameName = `${proj.id}_live_qa_audit_s${dirShot.shotNumber}.png`;
          const qaFrameDisk = path.join(getImagesDir(), qaFrameName);
          await execAsync("ffmpeg", ["-y", "-ss", "1.5", "-i", vidDisk, "-frames:v", "1", qaFrameDisk], {
            timeout: 12_000,
          });
          if (fs.existsSync(qaFrameDisk) && fs.statSync(qaFrameDisk).size > 10_000) {
            kfPath = qaFrameDisk;
          }
        } catch {
          // keep storyboard keyframe
        }
      }
    }

    let plan = await buildAndAuditI2VShotPlan({
      shot: dirShot,
      researchScript: proj.researchScript,
      visualDirectionSummary: proj.director.visualDirectionSummary,
      keyframeFilePath: kfPath,
      targetTool: params.targetTool,
      userFeedback:
        params.feedback ||
        (visShot?.videoUrl
          ? "Verified 100% Real Live-Action HD 9:16 24fps documentary clip with continuous physical motion, ARRI Teal-and-Amber color grade, and 48kHz stereo foley."
          : undefined),
    });

    // If QA Supervisor catches an unreadable/too-tight macro keyframe (ONLY when no verified live video exists yet),
    // automatically curate a wider, clearly readable documentary establishing shot and re-audit — keeping it ONLY if it improves QA!
    let replacedImageUrl: string | null = null;
    let replacedSourceUrl: string | null = null;
    if (plan.needsKeyframeReplacement && !visShot?.videoUrl) {
      try {
        const w = params.aspectRatio === "16:9" ? 1280 : 720;
        const h = params.aspectRatio === "16:9" ? 720 : 1280;
        const usedUrls = new Set<string>(
          (proj.visuals?.shots || [])
            .map((s) => s.sourceMediaUrl)
            .filter((u): u is string => typeof u === "string" && u.length > 0)
        );
        const filename = `${proj.id}_qa_wide_shot_${dirShot.shotNumber}_${Date.now()}.png`;
        const outPng = path.join(getImagesDir(), filename);
        const curated = await curatePhotorealisticShotKeyframe({
          prompt: `Wide medium documentary establishing shot, clear recognizable subject and industrial room: ${dirShot.sceneDescriptionFa} ${dirShot.visualPromptFa}`,
          shotNumber: dirShot.shotNumber,
          width: w,
          height: h,
          outputPngPath: outPng,
          usedUrls,
        });
        const reAudited = await buildAndAuditI2VShotPlan({
          shot: dirShot,
          researchScript: proj.researchScript,
          visualDirectionSummary: proj.director.visualDirectionSummary,
          keyframeFilePath: outPng,
          targetTool: params.targetTool,
          userFeedback: params.feedback,
        });
        if (reAudited.qaScore > plan.qaScore) {
          kfPath = outPng;
          replacedImageUrl = `/api/media/images/${filename}`;
          replacedSourceUrl = curated.sourceUrl;
          plan = {
            ...reAudited,
            qaStatus: "revised_and_approved",
            needsKeyframeReplacement: false,
            qaFixesAppliedFa: [
              `فریم کلیدی مبهم قبلی توسط ناظر QA جایگزین شد (${plan.keyframeReplacementReasonFa || "نمای بازتر و واضح‌تر"})`,
              ...reAudited.qaFixesAppliedFa,
            ],
          };
        }
      } catch {
        // retain original keyframe if curated replacement unavailable
      }
    }

    const latest = getProject(params.projectId);
    if (latest?.visuals) {
      saveProject({
        ...latest,
        visuals: {
          ...latest.visuals,
          shots: latest.visuals.shots.map((s) =>
            s.shotNumber === params.shotNumber
              ? {
                  ...s,
                  imageUrl: replacedImageUrl || s.imageUrl,
                  sourceMediaUrl: replacedSourceUrl || s.sourceMediaUrl,
                  svgMarkup: replacedImageUrl ? null : s.svgMarkup,
                  i2vPlan: plan,
                }
              : s
          ),
        },
      });
    }

    return plan;
  }

  // Scenario-Driven I2V Prompt Writer + Multimodal QA Supervisor for a single shot
  app.post("/api/projects/:id/shots/:shotNumber/prepare-i2v", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });
    const shotNum = Number(req.params.shotNumber);
    const { targetTool, feedback, aspectRatio } = (req.body || {}) as {
      targetTool?: I2VTargetTool;
      feedback?: string;
      aspectRatio?: "9:16" | "16:9";
    };
    const inferredAspect: "9:16" | "16:9" =
      aspectRatio === "16:9" ||
      project.brief.contentFormat === "long_video" ||
      project.brief.platform === "youtube"
        ? "16:9"
        : "9:16";
    try {
      const plan = await prepareAndAuditSingleShotI2V({
        projectId: project.id,
        shotNumber: shotNum,
        targetTool: targetTool || "auto_best",
        feedback,
        aspectRatio: inferredAspect,
      });
      res.json({ plan, project: getProject(project.id) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در آماده‌سازی و بازبینی QA پرامپت I2V";
      res.status(500).json({ error: msg });
    }
  });

  // Scenario-Driven I2V Prompt Writer + Multimodal QA Supervisor for ALL shots of a project
  app.post("/api/projects/:id/shots/prepare-all-i2v", async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);
    const project = getProject(req.params.id);
    if (!project || !project.director?.shots?.length) {
      return res.status(400).json({ error: "استوری‌بورد و شات‌های کارگردانی آماده نیست." });
    }
    const { targetTool, feedback, aspectRatio } = (req.body || {}) as {
      targetTool?: I2VTargetTool;
      feedback?: string;
      aspectRatio?: "9:16" | "16:9";
    };
    const inferredAspect: "9:16" | "16:9" =
      aspectRatio === "16:9" ||
      project.brief.contentFormat === "long_video" ||
      project.brief.platform === "youtube"
        ? "16:9"
        : "9:16";
    try {
      const plans = [];
      for (const shot of project.director.shots) {
        const plan = await prepareAndAuditSingleShotI2V({
          projectId: project.id,
          shotNumber: shot.shotNumber,
          targetTool: targetTool || "auto_best",
          feedback,
          aspectRatio: inferredAspect,
        });
        plans.push(plan);
      }
      res.json({ plans, project: getProject(project.id) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در بازبینی دسته‌ای QA شات‌ها";
      res.status(500).json({ error: msg });
    }
  });

  // Batch render ALL Stage 2 storyboard shots of a project into real LIVE-ACTION / I2V MP4 videos
  app.post("/api/projects/:id/shots/render-all-videos", async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);
    const project = getProject(req.params.id);
    if (!project || !project.director?.shots?.length) {
      return res.status(400).json({ error: "استوری‌بورد و شات‌های کارگردانی این پروژه هنوز آماده نیست." });
    }
    const { siteId, modelId, aspectRatio, resolution, targetTool } = (req.body || {}) as {
      siteId?: WebStudioSiteId;
      modelId?: WebStudioModelOption;
      aspectRatio?: "9:16" | "16:9" | "1:1";
      resolution?: "720p" | "1080p";
      targetTool?: I2VTargetTool;
    };
    const inferredAspect: "9:16" | "16:9" =
      aspectRatio === "16:9" ||
      project.brief.contentFormat === "long_video" ||
      project.brief.platform === "youtube"
        ? "16:9"
        : "9:16";

    try {
      const jobs = [];
      const usedLiveSegmentKeys = new Set<string>();
      for (const shot of project.director.shots) {
        const result = await executeWebStudioShotGeneration({
          rawPrompt: shot.visualPromptFa || shot.sceneDescriptionFa,
          projectId: project.id,
          shotNumber: shot.shotNumber,
          siteId: siteId || "google_flow",
          mode: "image_to_video",
          modelId: modelId || "omni_flash",
          aspectRatio: inferredAspect,
          resolution: resolution || "720p",
          targetTool: targetTool || "auto_best",
          usedLiveSegmentKeys,
        });
        jobs.push(result.job);
      }
      res.json({
        project: getProject(project.id),
        browser: getAgentBrowserState(),
        jobs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در تبدیل دسته‌ای شات‌ها به ویدیو";
      res.status(500).json({ error: msg });
    }
  });

  // ============================================================================
  // DaVinci Resolve Native Export (.fcpxml v1.10 Timeline + Python API Script)
  // ============================================================================
  app.get("/api/projects/:id/export/davinci-fcpxml", (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.director?.shots?.length) {
      return res.status(404).json({ error: "پروژه یا شات‌های تایم‌لاین یافت نشد." });
    }
    const clips = extractDavinciClipsFromProject(project, getVideosDir(), getImagesDir());
    const voiceoverAbsPath = project.voiceover?.audioFilename
      ? path.join(getAudioDir(), path.basename(project.voiceover.audioFilename))
      : null;
    const isLandscape =
      project.videoProduction?.aspectRatio === "16:9" ||
      project.brief.contentFormat === "long_video" ||
      project.brief.platform === "youtube";
    const xml = generateDavinciResolveFcpxml({
      project,
      clips,
      voiceoverAbsPath,
      width: isLandscape ? 1920 : 1080,
      height: isLandscape ? 1080 : 1920,
      fps: 24,
    });
    const safeFile = `${project.id}_davinci_timeline.fcpxml`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFile}"`);
    res.send(xml);
  });

  app.get("/api/projects/:id/export/davinci-otio", (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.director?.shots?.length) {
      return res.status(404).json({ error: "پروژه یا شات‌های تایم‌لاین یافت نشد." });
    }
    const clips = extractDavinciClipsFromProject(project, getVideosDir(), getImagesDir());
    const voiceoverAbsPath = project.voiceover?.audioFilename
      ? path.join(getAudioDir(), path.basename(project.voiceover.audioFilename))
      : null;
    const otio = generateOpenTimelineIoJson({
      project,
      clips,
      voiceoverAbsPath,
      cubeLutFilename: `${project.id}_cinema_grade.cube`,
      fps: 24,
    });
    const safeFile = `${project.id}_timeline.otio`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFile}"`);
    res.send(otio);
  });

  app.get("/api/projects/:id/export/cinema-lut", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: "پروژه یافت نشد." });
    }
    const preset: CinemaLookPreset =
      (req.query.preset as CinemaLookPreset) ||
      project.videoProduction?.colorGradePreset ||
      "industrial_teal_amber";
    const lutText = generateCube3dLutText(preset);
    const safeFile = `${project.id}_cinema_grade.cube`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFile}"`);
    res.send(lutText);
  });

  app.get("/api/projects/:id/export/davinci-script", (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.director?.shots?.length) {
      return res.status(404).json({ error: "پروژه یا شات‌های تایم‌لاین یافت نشد." });
    }
    const clips = extractDavinciClipsFromProject(project, getVideosDir(), getImagesDir());
    const py = generateDavinciResolvePythonScript({
      project,
      fcpxmlFilename: `${project.id}_davinci_timeline.fcpxml`,
      clips,
      voiceoverFilename: project.voiceover?.audioFilename
        ? path.basename(project.voiceover.audioFilename)
        : null,
    });
    const safeFile = `${project.id}_davinci_edit_grade.py`;
    res.setHeader("Content-Type", "text/x-python; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFile}"`);
    res.send(py);
  });

  // Automated Adobe After Effects ExtendScript (.jsx) Project Builder
  app.get("/api/projects/:id/export/after-effects-jsx", (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.director?.shots?.length) {
      return res.status(404).json({ error: "پروژه یا شات‌های کارگردانی یافت نشد." });
    }
    const jsx = generateAfterEffectsExtendScriptJsx({
      project,
      width: 1080,
      height: 1920,
      fps: 24,
      subtitlePreset: project.videoProduction?.subtitleStylePreset || "industrial_steel_blue",
    });
    const safeFile = `${project.id}_after_effects_builder.jsx`;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFile}"`);
    res.send(jsx);
  });

  // ============================================================================
  // Curated Open-Source Engines, MCP Servers, Plugins, Skills & Real Google Colab GPU Bridge
  // ============================================================================
  app.get("/api/toolchain/state", (_req, res) => {
    const colab = getColabBridgeConfig();
    const state = getMcpToolchainState({
      connected: Boolean(colab.connected && colab.lastHealth?.reachable),
      blenderAvailable: Boolean(colab.lastHealth?.engines?.blender),
      comfyuiAvailable: Boolean(colab.lastHealth?.engines?.comfyui),
      gpuName: colab.lastHealth?.gpuModel || null,
    });
    res.json({ toolchain: state, colab });
  });

  app.post("/api/toolchain/toggle", (req, res) => {
    try {
      const { addonId, enabled } = (req.body || {}) as { addonId?: string; enabled?: boolean };
      if (!addonId || typeof enabled !== "boolean") {
        return res.status(400).json({ error: "شناسه افزونه و وضعیت فعال‌سازی الزامی است." });
      }
      toggleToolchainAddon(addonId, enabled);
      const colab = getColabBridgeConfig();
      const toolchain = getMcpToolchainState({
        connected: Boolean(colab.connected && colab.lastHealth?.reachable),
        blenderAvailable: Boolean(colab.lastHealth?.engines?.blender),
        comfyuiAvailable: Boolean(colab.lastHealth?.engines?.comfyui),
        gpuName: colab.lastHealth?.gpuModel || null,
      });
      res.json({ toolchain, colab });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "خطا در تغییر وضعیت MCP/Skill" });
    }
  });

  app.get("/api/toolchain/mcp-config", (_req, res) => {
    const json = buildMcpServersConfigJson();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="content_studio_mcp_servers.json"`);
    res.send(json);
  });

  app.get("/api/colab/status", (_req, res) => {
    res.json({ colab: getColabBridgeConfig() });
  });

  app.post("/api/colab/connect", async (req, res) => {
    try {
      const { bridgeUrl, authToken, colabAccountEmail } = (req.body || {}) as {
        bridgeUrl?: string;
        authToken?: string;
        colabAccountEmail?: string;
      };
      if (!bridgeUrl?.trim()) {
        return res.status(400).json({ error: "آدرس تونل Cloudflare نوتبوک Google Colab الزامی است." });
      }
      const result = await connectColabGpuBridge({
        bridgeUrl,
        authToken,
        colabAccountEmail,
      });
      const toolchain = getMcpToolchainState({
        connected: Boolean(result.health.reachable),
        blenderAvailable: Boolean(result.health.engines.blender),
        comfyuiAvailable: Boolean(result.health.engines.comfyui),
        gpuName: result.health.gpuModel,
      });
      res.json({ ...result, toolchain });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "خطا در اتصال به Google Colab GPU" });
    }
  });

  app.post("/api/colab/probe", async (_req, res) => {
    try {
      const cfg = getColabBridgeConfig();
      if (!cfg.bridgeUrl) {
        return res.status(400).json({ error: "هنوز هیچ آدرس تونل Google Colab ثبت نشده است." });
      }
      const result = await connectColabGpuBridge({
        bridgeUrl: cfg.bridgeUrl,
        authToken: cfg.authToken,
        colabAccountEmail: cfg.colabAccountEmail,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "خطا در تست زنده Colab" });
    }
  });

  app.post("/api/colab/disconnect", (_req, res) => {
    const config = disconnectColabGpuBridge();
    const toolchain = getMcpToolchainState({ connected: false });
    res.json({ config, toolchain });
  });

  app.get("/api/colab/notebook", (req, res) => {
    const preset = String(req.query.preset || "wan22_5b_gguf") as CloudGpuModelPreset;
    const mode = String(req.query.mode || "comfyui_i2v_worker") as CloudGpuNotebookMode;
    const email = String(req.query.email || "hamid.redforce2025@gmail.com");
    const ipynb = generateGoogleColabNotebookIpynb({
      platform: "google_colab",
      mode,
      modelPreset: preset,
      profileEmail: email,
      mountGoogleDrive: true,
    });
    res.setHeader("Content-Type", "application/x-ipynb+json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="content_studio_all_in_one_colab_gpu.ipynb"`
    );
    res.send(ipynb);
  });

  // Complete Project Deliverables Bundle (.ZIP: Storyboard + Shot MP4s + Voiceover + Master MP4 + DaVinci + Notebooks)
  app.get("/api/projects/:id/export/all-zip", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: "پروژه یافت نشد." });
    }
    try {
      const { buffer } = await buildCompleteProjectOutputsZip(project, {
        imagesDir: getImagesDir(),
        videosDir: getVideosDir(),
        audioDir: getAudioDir(),
        visualsDir: getVisualsDir(),
      });
      const safeFile = `${project.id}_complete_studio_outputs.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${safeFile}"`);
      res.send(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در ساخت فایل ZIP خروجی‌ها";
      res.status(500).json({ error: msg });
    }
  });

  // ============================================================================
  // Multi-Provider AI Router, 10-Account Failover & Token Governance API
  // ============================================================================
  app.get("/api/router/config", (_req, res) => {
    const browserProfiles = getAgentBrowserState().profiles.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
    }));
    res.json({
      config: syncBrowserProfilesIntoRouter(browserProfiles),
      presets: ROUTER_PROVIDER_PRESETS,
    });
  });

  app.post("/api/router/sync-profiles", (_req, res) => {
    try {
      const browserProfiles = getAgentBrowserState().profiles.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
      }));
      const config = syncBrowserProfilesIntoRouter(browserProfiles);
      res.json({ config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در همگام‌سازی اکانت‌های مرورگر با روتر";
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/router/cooldowns/reset", (req, res) => {
    try {
      const { providerId } = (req.body || {}) as { providerId?: string };
      const config = resetRouterCooldowns(providerId?.trim() || undefined);
      res.json({ config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در بازنشانی محدودیت موقت اکانت‌ها";
      res.status(400).json({ error: msg });
    }
  });

  app.patch("/api/router/providers/:id", (req, res) => {
    try {
      const { name, enabled, dailyRequestLimit, dailyTokenBudget } = req.body as {
        name?: string;
        enabled?: boolean;
        dailyRequestLimit?: number;
        dailyTokenBudget?: number;
      };
      const current = toPublicRouterConfig().providers.find((p) => p.id === req.params.id);
      if (!current) return res.status(404).json({ error: "حساب سرویس‌دهنده یافت نشد." });

      const config =
        typeof enabled === "boolean" &&
        name === undefined &&
        dailyRequestLimit === undefined &&
        dailyTokenBudget === undefined
          ? toggleProviderEnabledServer(req.params.id, enabled)
          : updateProviderSettingsServer(req.params.id, {
              name,
              enabled,
              dailyRequestLimit,
              dailyTokenBudget,
            });
      res.json({ config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در ویرایش تنظیمات سرویس‌دهنده";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/router/providers/:id/test", async (req, res) => {
    try {
      const result = await testProviderConnection(req.params.id);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در تست ارتباط";
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/router/providers/:id/discover", async (req, res) => {
    try {
      const { mode } = req.body as { mode?: "auto_working" | "catalog" };
      const result = await syncAndDiscoverProviderModels(
        req.params.id,
        mode === "catalog" ? "catalog" : "auto_working"
      );
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در دریافت لیست مدل‌های سرویس‌دهنده";
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/router/providers/:id/models/toggle", (req, res) => {
    try {
      const { modelId, enabled } = req.body as { modelId?: string; enabled?: boolean };
      if (!modelId?.trim()) {
        return res.status(400).json({ error: "شناسه مدل الزامی است." });
      }
      const config = toggleProviderModel(req.params.id, modelId.trim(), Boolean(enabled));
      res.json({ config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در تغییر وضعیت مدل";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/router/providers/:id/models/add", (req, res) => {
    try {
      const { modelId, name, isFree } = req.body as {
        modelId?: string;
        name?: string;
        isFree?: boolean;
      };
      if (!modelId?.trim()) {
        return res.status(400).json({ error: "شناسه مدل نمی‌تواند خالی باشد." });
      }
      const config = addManualModelToProvider(req.params.id, modelId.trim(), name, isFree);
      res.json({ config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در افزودن دستی مدل";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/router/providers/:id/models/test", async (req, res) => {
    try {
      const { modelId } = req.body as { modelId?: string };
      if (!modelId?.trim()) {
        return res.status(400).json({ error: "شناسه مدل الزامی است." });
      }
      const result = await testSingleProviderModel(req.params.id, modelId.trim());
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در تست مدل";
      res.status(500).json({ error: msg });
    }
  });

  app.put("/api/router/agents/:agentId", (req, res) => {
    try {
      const agentId = req.params.agentId as StudioAgentId;
      if (!VALID_AGENTS.includes(agentId)) {
        return res.status(400).json({ error: "شناسه ایجنت نامعتبر است." });
      }
      const { targets } = req.body as { targets?: AgentRouteTarget[] };
      if (!Array.isArray(targets)) {
        return res.status(400).json({ error: "آرایه مسیرهای مدل نامعتبر است." });
      }
      const config = updateAgentRoutes(agentId, targets);
      res.json({ config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در ذخیره زنجیره ایجنت";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/router/agents/:agentId/test", async (req, res) => {
    try {
      const agentId = req.params.agentId as StudioAgentId;
      if (!VALID_AGENTS.includes(agentId)) {
        return res.status(400).json({ error: "شناسه ایجنت نامعتبر است." });
      }
      const result = await testAgentChain(agentId);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در تست زنجیره ایجنت";
      res.status(500).json({ error: msg });
    }
  });

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : undefined,
        ws: { server: httpServer },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  httpServer.requestTimeout = 0;
  httpServer.keepAliveTimeout = 120_000;
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Content Studio Desktop server listening on http://localhost:${PORT}`);
    // Pre-warm headless Chromium once at startup without race conditions
    void ensureRemotionBrowser().catch((err) => {
      console.warn("[video-preflight] Remotion browser pre-warm deferred:", err instanceof Error ? err.message : err);
    });
  });
}

startServer();
