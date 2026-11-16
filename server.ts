import "dotenv/config";
import express from "express";
import fs from "node:fs";
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
import type { VideoAspectFormat, VideoQualityMode } from "./src/types/videoPipeline.js";
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
  addOrUpdateProvider,
  deleteProvider,
  syncAndDiscoverProviderModels,
  testAgentChain,
  testProviderConnection,
  testSingleProviderModel,
  toPublicRouterConfig,
  toggleProviderModel,
  updateAgentRoutes,
} from "./server/router.js";
import { generateWindowsBundleZip, getWindowsBundlePreviews } from "./server/windowsBundle.js";
import type {
  AgentRouteTarget,
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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

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

  app.get("/api/media/videos/:filename", (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(getVideosDir(), safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "فایل ویدیو یافت نشد." });
    }
    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "video/mp4",
      });
      fs.createReadStream(fullPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4",
      });
      fs.createReadStream(fullPath).pipe(res);
    }
  });

  // Serve artifacts inside output/runs/<runId>/... (shot MP4s, extracted QA frames, final.mp4)
  app.get("/api/media/video-runs/:runId/*", (req, res) => {
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
    if (ext === ".png") {
      res.setHeader("Content-Type", "image/png");
      return fs.createReadStream(fullPath).pipe(res);
    }
    if (ext === ".srt") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return fs.createReadStream(fullPath).pipe(res);
    }
    if (ext === ".json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return fs.createReadStream(fullPath).pipe(res);
    }

    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
      });
      return fs.createReadStream(fullPath, { start, end }).pipe(res);
    }
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
    });
    return fs.createReadStream(fullPath).pipe(res);
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
        narrationText
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
      const { feedback, updatedPrompt } = req.body as { feedback?: string; updatedPrompt?: string };
      const targetShot = updatedPrompt ? { ...shot, visualPromptFa: updatedPrompt } : shot;

      if (updatedPrompt) {
        project.director = {
          ...project.director,
          shots: project.director.shots.map((s) => (s.shotNumber === shotNum ? targetShot : s)),
        };
      }

      const regenerated = await runVisualProducerForShot(
        project.id,
        targetShot,
        project.director.visualDirectionSummary,
        feedback
      );

      const existingShots = project.visuals?.shots ?? [];
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

    const { aspectRatio, qualityMode, burnSubtitles, includeBackgroundMusic } = req.body as {
      aspectRatio?: VideoAspectFormat;
      qualityMode?: VideoQualityMode;
      burnSubtitles?: boolean;
      includeBackgroundMusic?: boolean;
    };

    const inferredAspect: VideoAspectFormat =
      aspectRatio ||
      (project.brief.contentFormat === "long_video" || project.brief.platform === "youtube"
        ? "16:9"
        : "9:16");
    const chosenQuality: VideoQualityMode = qualityMode === "final_1080p" ? "final_1080p" : "preview_480p";

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
        status: "running",
        currentNode: "START",
        shots: [],
        logs: [
          {
            timestamp: new Date().toISOString(),
            node: "START",
            level: "info",
            message: "پایپ‌لاین ۱۰ مرحله‌ای تولید ویدیو آغاز شد.",
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
      director: project.director,
      researchScript: project.researchScript,
      narrationWavPath,
      burnSubtitles: Boolean(burnSubtitles),
      includeBackgroundMusic: Boolean(includeBackgroundMusic),
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

  // Generate Video from Text or Animate Image (gemini-omni-1.2-flash via Interactions API)
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
        return res.status(400).json({ error: "توضیح صحنه یا حرکت دوربین برای ساخت ویدیو الزامی است." });
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
        modelUsed: "gemini-omni-1.2-flash",
        notes: imageBase64 ? "متحرک‌سازی تصویر به ویدیو" : "تولید ویدیو از متن",
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
  // Multi-Provider AI Router & Fallback Chain API
  // ============================================================================
  app.get("/api/router/config", (_req, res) => {
    res.json({
      config: toPublicRouterConfig(),
      presets: ROUTER_PROVIDER_PRESETS,
    });
  });

  app.post("/api/router/providers", async (req, res) => {
    try {
      const { id, kind, name, baseUrl, apiKey, enabled, autoDiscoverWorking } = req.body as {
        id?: string;
        kind?: RouterProviderKind;
        name?: string;
        baseUrl?: string;
        apiKey?: string;
        enabled?: boolean;
        autoDiscoverWorking?: boolean;
      };
      if (!kind || !name?.trim()) {
        return res.status(400).json({ error: "نوع سرویس‌دهنده و نام حساب الزامی است." });
      }
      const created = addOrUpdateProvider({
        id,
        kind,
        name: name.trim(),
        baseUrl,
        apiKey,
        enabled,
      });

      if (autoDiscoverWorking && apiKey?.trim()) {
        const discovery = await syncAndDiscoverProviderModels(created.providerId, "auto_working");
        return res.json({
          config: discovery.config,
          providerId: created.providerId,
          discoveryMessage: discovery.message,
          enabledWorkingCount: discovery.enabledWorkingCount,
        });
      }

      res.json({
        config: created.config,
        providerId: created.providerId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در ثبت سرویس‌دهنده";
      res.status(400).json({ error: msg });
    }
  });

  app.patch("/api/router/providers/:id", (req, res) => {
    try {
      const { kind, name, baseUrl, apiKey, enabled } = req.body as {
        kind?: RouterProviderKind;
        name?: string;
        baseUrl?: string;
        apiKey?: string;
        enabled?: boolean;
      };
      const current = toPublicRouterConfig().providers.find((p) => p.id === req.params.id);
      if (!current) return res.status(404).json({ error: "حساب سرویس‌دهنده یافت نشد." });

      const updated = addOrUpdateProvider({
        id: req.params.id,
        kind: kind || current.kind,
        name: name?.trim() || current.name,
        baseUrl,
        apiKey,
        enabled,
      });
      res.json({ config: updated.config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در ویرایش سرویس‌دهنده";
      res.status(400).json({ error: msg });
    }
  });

  app.delete("/api/router/providers/:id", (req, res) => {
    try {
      const config = deleteProvider(req.params.id);
      res.json({ config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در حذف سرویس‌دهنده";
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
      server: { middlewareMode: true },
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Content Studio Desktop server listening on http://localhost:${PORT}`);
    // Pre-warm headless Chromium once at startup without race conditions
    void ensureRemotionBrowser().catch((err) => {
      console.warn("[video-preflight] Remotion browser pre-warm deferred:", err instanceof Error ? err.message : err);
    });
  });
}

startServer();
