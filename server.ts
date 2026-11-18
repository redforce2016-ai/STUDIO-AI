import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import {
  buildDaVinciPackageSummary,
  generateDaVinciBundleZip,
} from "./server/davinciResolve.js";
import {
  formatGeminiError,
  runAudioTranscriptionAgent,
  runCompetitorAndViralRadar,
  runQuickSearchResearch,
  runStrategistTopicProposals,
  runVisualProducerForShot,
  runVoiceoverAgent,
} from "./server/gemini.js";
import {
  resumePipeline,
  runAutonomousEndToEndPipeline,
  startPipeline,
} from "./server/langgraphPipeline.js";
import {
  buildComfyUiLightweightWorkflow,
  getLocalEnginesStatus,
} from "./server/localVideoEngines.js";
import {
  addManualModelToProvider,
  syncAndDiscoverProviderModels,
  testAgentChain,
  testProviderConnection,
  testSingleProviderModel,
  toPublicRouterConfig,
  toggleProviderEnabledServer,
  toggleProviderModel,
  updateAgentRoutes,
} from "./server/router.js";
import {
  assembleApprovedProjectMasterMp4,
  renderSingleStudioShotMp4,
} from "./server/singleShotRenderer.js";
import {
  createProject,
  deleteAgentMemory,
  deletePageProfile,
  deleteProject,
  getAudioDir,
  getImagesDir,
  getPageProfile,
  getProject,
  getVaultSnapshotAndSyncDisk,
  getVideosDir,
  getVisualsDir,
  listAgentMemories,
  listPageProfiles,
  listProjects,
  listViralReports,
  recordAgentLearning,
  saveAudioFile,
  saveCustomVaultNote,
  savePageProfile,
  saveProject,
  saveViralReport,
} from "./server/store.js";
import { getRunOutputDir, runPreflightCheck } from "./server/video/config.js";
import { ensureRemotionBrowser } from "./server/video/providers/remotion.js";
import { generateWindowsBundleZip, getWindowsBundlePreviews } from "./server/windowsBundle.js";
import type {
  AgentMemoryEntry,
  AgentRouteTarget,
  LocalVideoEngineId,
  PageProfile,
  PlatformOption,
  ProjectBrief,
  ShotVideoApprovalStatus,
  ShotVideoClipRecord,
  StudioAgentId,
  VaultFolderId,
  VoicePersona,
} from "./src/types/studio.js";

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

  // ============================================================================
  // Media File Streaming (Audio WAV/WebM, Storyboard SVGs, Shot & Master MP4s)
  // ============================================================================
  app.get("/api/media/audio/:filename", (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(getAudioDir(), safeName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "فایل صوتی یافت نشد." });
    }
    const ext = path.extname(safeName).toLowerCase();
    const mime =
      ext === ".mp3"
        ? "audio/mpeg"
        : ext === ".webm"
          ? "audio/webm"
          : ext === ".ogg"
            ? "audio/ogg"
            : "audio/wav";
    res.setHeader("Content-Type", mime);
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
    const primaryPath = path.join(getImagesDir(), safeName);
    const bundledAssetsPath = path.resolve(process.cwd(), "src", "assets", "images", safeName);
    const fullPath = fs.existsSync(primaryPath) ? primaryPath : bundledAssetsPath;
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "فایل تصویر یافت نشد." });
    }
    const ext = path.extname(safeName).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : "image/png";
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
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
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
    const stat = fs.statSync(fullPath);
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": "video/mp4",
    });
    return fs.createReadStream(fullPath).pipe(res);
  });

  // ============================================================================
  // Multi-Page / Channel Profiles + Personal Voice Clone Sample Recording
  // ============================================================================
  app.get("/api/pages", (_req, res) => {
    res.json({ pages: listPageProfiles() });
  });

  app.post("/api/pages", (req, res) => {
    const body = req.body as Partial<PageProfile>;
    if (!body?.name?.trim() || !body?.niche?.trim()) {
      return res.status(400).json({ error: "نام پیج و حوزه تخصصی الزامی است." });
    }
    const now = new Date().toISOString();
    const created: PageProfile = {
      id: body.id?.trim() || `page_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: body.name.trim(),
      handle: body.handle?.trim() || "@new.studio.page",
      platform: body.platform || "instagram",
      defaultFormat: body.defaultFormat || "reels",
      pageMaturity: body.pageMaturity || "new_page",
      niche: body.niche.trim(),
      contentStyle: body.contentStyle?.trim() || "محتوای تخصصی، ریتم سریع و کاربردی",
      targetAudiencePersona: body.targetAudiencePersona?.trim() || "مخاطبان علاقه‌مند به این حوزه تخصصی",
      audiencePainPoints: Array.isArray(body.audiencePainPoints) ? body.audiencePainPoints : [],
      brandTone: body.brandTone || "educational",
      brandToneNoteFa: body.brandToneNoteFa?.trim() || "صمیمی، معتبر و بدون حاشیه",
      visualAestheticFa: body.visualAestheticFa?.trim() || "نورپردازی کنتراست بالا با زیرنویس خوانا",
      tabooRedLines: Array.isArray(body.tabooRedLines) ? body.tabooRedLines : [],
      algorithmGuardrails: Array.isArray(body.algorithmGuardrails) ? body.algorithmGuardrails : [],
      competitorHandles: Array.isArray(body.competitorHandles) ? body.competitorHandles : [],
      voiceProfile: body.voiceProfile || {
        speakerName: `صدای اختصاصی ${body.name.trim()}`,
        voicePersona: "Kore",
        prosodyStyle: "بیان شمرده، گرم و با تاکید روی کلمات کلیدی",
        sampleAudioUrl: null,
        cloneEnginePreference: "gemini_persona",
      },
      createdAt: now,
      updatedAt: now,
    };
    const saved = savePageProfile(created);
    res.json({ page: saved, pages: listPageProfiles() });
  });

  app.patch("/api/pages/:id", (req, res) => {
    const existing = getPageProfile(req.params.id);
    if (!existing) return res.status(404).json({ error: "پروفایل پیج یافت نشد." });
    const saved = savePageProfile({
      ...existing,
      ...(req.body as Partial<PageProfile>),
      id: existing.id,
      voiceProfile: {
        ...existing.voiceProfile,
        ...((req.body as Partial<PageProfile>).voiceProfile || {}),
      },
    });
    res.json({ page: saved, pages: listPageProfiles() });
  });

  app.delete("/api/pages/:id", (req, res) => {
    const ok = deletePageProfile(req.params.id);
    if (!ok) return res.status(404).json({ error: "پروفایل پیج یافت نشد." });
    res.json({ ok: true, pages: listPageProfiles() });
  });

  // Upload or record user's real voice sample for a Page Profile
  app.post("/api/pages/:id/voice-sample", async (req, res) => {
    const existing = getPageProfile(req.params.id);
    if (!existing) return res.status(404).json({ error: "پروفایل پیج یافت نشد." });

    const { audioBase64, mimeType, speakerName, prosodyStyle, voicePersona, cloneEnginePreference } =
      req.body as {
        audioBase64?: string;
        mimeType?: string;
        speakerName?: string;
        prosodyStyle?: string;
        voicePersona?: VoicePersona;
        cloneEnginePreference?: PageProfile["voiceProfile"]["cloneEnginePreference"];
      };

    let sampleAudioUrl = existing.voiceProfile.sampleAudioUrl;
    let sampleTranscript = existing.voiceProfile.sampleTranscript || "";

    if (audioBase64?.trim()) {
      const ext = mimeType?.includes("mp3")
        ? "mp3"
        : mimeType?.includes("webm")
          ? "webm"
          : "wav";
      const filename = `voice_ref_${existing.id}_${Date.now()}.${ext}`;
      const buf = Buffer.from(audioBase64, "base64");
      sampleAudioUrl = saveAudioFile(filename, buf);

      try {
        const tr = await runAudioTranscriptionAgent({
          audioBase64,
          mimeType: mimeType || "audio/webm",
        });
        sampleTranscript = tr.transcript;
      } catch {
        // Optional transcript enrichment; sample audio is still saved
      }
    }

    const updated = savePageProfile({
      ...existing,
      voiceProfile: {
        ...existing.voiceProfile,
        speakerName: speakerName?.trim() || existing.voiceProfile.speakerName,
        prosodyStyle: prosodyStyle?.trim() || existing.voiceProfile.prosodyStyle,
        voicePersona: voicePersona || existing.voiceProfile.voicePersona,
        cloneEnginePreference:
          cloneEnginePreference || existing.voiceProfile.cloneEnginePreference,
        sampleAudioUrl,
        sampleTranscript,
      },
    });

    res.json({ page: updated, pages: listPageProfiles() });
  });

  // ============================================================================
  // Safe Grounded Competitor & Weekly Viral Radar
  // ============================================================================
  app.get("/api/viral-radar", (_req, res) => {
    res.json({ reports: listViralReports() });
  });

  app.post("/api/viral-radar/analyze", async (req, res) => {
    const { nicheQuery, platform, pageProfileId } = req.body as {
      nicheQuery?: string;
      platform?: PlatformOption;
      pageProfileId?: string | null;
    };
    const profile = getPageProfile(pageProfileId);
    const effectiveQuery = nicheQuery?.trim() || profile?.niche || "";
    if (!effectiveQuery) {
      return res.status(400).json({ error: "لطفاً موضوع یا پروفایل پیج را انتخاب کنید." });
    }

    try {
      const report = await runCompetitorAndViralRadar({
        nicheQuery: effectiveQuery,
        platform: platform || profile?.platform || "instagram",
        pageProfileId: pageProfileId ?? null,
      });
      saveViralReport(report);
      res.json({ report, reports: listViralReports() });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // ============================================================================
  // Self-Evolving Agent Memory + Obsidian Second Brain Vault
  // ============================================================================
  app.get("/api/memories", (_req, res) => {
    res.json({ memories: listAgentMemories() });
  });

  app.post("/api/memories", (req, res) => {
    const body = req.body as {
      agentId?: AgentMemoryEntry["agentId"];
      scope?: AgentMemoryEntry["scope"];
      category?: AgentMemoryEntry["category"];
      ruleText?: string;
      sourceEvent?: string;
      pageProfileId?: string | null;
      projectId?: string | null;
      initialStrength?: number;
    };
    if (!body?.ruleText?.trim()) {
      return res.status(400).json({ error: "متن قانون یا الگو نمی‌تواند خالی باشد." });
    }
    const memories = recordAgentLearning({
      agentId: body.agentId === "director_agent" ? "director_agent" : "scriptwriter_agent",
      scope: body.scope || (body.pageProfileId ? "page" : "global"),
      category: body.category || "learned_rule",
      ruleText: body.ruleText.trim(),
      sourceEvent: body.sourceEvent?.trim() || "ثبت مستقیم توسط مدیر استودیو",
      pageProfileId: body.pageProfileId ?? null,
      projectId: body.projectId ?? null,
      initialStrength: body.initialStrength ?? 8,
    });
    res.json({ memories });
  });

  app.delete("/api/memories/:id", (req, res) => {
    const ok = deleteAgentMemory(req.params.id);
    if (!ok) return res.status(404).json({ error: "حافظه موردنظر یافت نشد." });
    res.json({ ok: true, memories: listAgentMemories() });
  });

  app.get("/api/vault", (_req, res) => {
    const vault = getVaultSnapshotAndSyncDisk();
    res.json({ vault });
  });

  app.post("/api/vault/notes", (req, res) => {
    const { id, title, folder, contentMd, tags } = req.body as {
      id?: string;
      title?: string;
      folder?: VaultFolderId;
      contentMd?: string;
      tags?: string[];
    };
    if (!title?.trim() || !contentMd?.trim()) {
      return res.status(400).json({ error: "عنوان و متن یادداشت Markdown الزامی است." });
    }
    const note = saveCustomVaultNote({
      id,
      title: title.trim(),
      folder: folder || "02_Viral_Lab",
      contentMd,
      tags,
    });
    const vault = getVaultSnapshotAndSyncDisk();
    res.json({ note, vault });
  });

  // ============================================================================
  // Projects & 6-Stage Pipeline Endpoints
  // ============================================================================
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

  // Step 0: Propose 3 deeply analyzed viral options tailored to the active Page Profile
  app.post("/api/projects/propose-topics", async (req, res) => {
    const brief = req.body as Partial<ProjectBrief>;
    if (!brief?.idea?.trim()) {
      return res.status(400).json({ error: "لطفاً موضوع خام را وارد کنید." });
    }
    const profile = getPageProfile(brief.pageProfileId);
    const cleanIdea = brief.idea.trim();
    const derivedTitle =
      brief.title?.trim() || cleanIdea.split(/[\n.!؟]/)[0]?.trim().slice(0, 80) || "پست جدید";

    try {
      const analysis = await runStrategistTopicProposals({
        title: derivedTitle,
        idea: cleanIdea,
        pageProfileId: brief.pageProfileId ?? null,
        platform: brief.platform || profile?.platform || "instagram",
        contentFormat: brief.contentFormat || profile?.defaultFormat || "reels",
        pageMaturity: brief.pageMaturity || profile?.pageMaturity || "new_page",
        tone: brief.tone || profile?.brandTone || "educational",
        targetDurationSeconds: brief.targetDurationSeconds || 35,
      });
      res.json({ analysis });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // Create project & launch Stage 1 (Super-Agent 1: Scenario)
  app.post("/api/projects/start", async (req, res) => {
    const brief = req.body as Partial<ProjectBrief>;
    if (!brief?.idea?.trim()) {
      return res.status(400).json({ error: "موضوع برای شروع الزامی است." });
    }
    const profile = getPageProfile(brief.pageProfileId);
    const cleanIdea = brief.idea.trim();
    const resolvedTitle =
      brief.title?.trim() ||
      brief.selectedTopicAngle?.title?.trim() ||
      cleanIdea.split(/[\n.!؟]/)[0]?.trim().slice(0, 80) ||
      "پست تخصصی جدید";

    const project = createProject({
      title: resolvedTitle,
      idea: cleanIdea,
      pageProfileId: brief.pageProfileId ?? null,
      platform: brief.platform || profile?.platform || "instagram",
      contentFormat: brief.contentFormat || profile?.defaultFormat || "reels",
      pageMaturity: brief.pageMaturity || profile?.pageMaturity || "new_page",
      tone:
        brief.selectedTopicAngle?.recommendedTone ||
        brief.tone ||
        profile?.brandTone ||
        "educational",
      toneLabelFa: brief.selectedTopicAngle?.recommendedToneLabelFa || brief.toneLabelFa,
      targetDurationSeconds:
        brief.selectedTopicAngle?.recommendedDurationSeconds ||
        brief.targetDurationSeconds ||
        35,
      selectedTopicAngle: brief.selectedTopicAngle ?? null,
    });

    try {
      const running = saveProject({
        ...project,
        checkpointStatus: "running",
        currentStage: "research_script",
      });
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

  // Autonomous Autopilot: create project from brief and run all stages 1-6 with QA & self-healing
  app.post("/api/projects/start-autopilot", async (req, res) => {
    const brief = req.body as Partial<ProjectBrief>;
    if (!brief?.idea?.trim()) {
      return res.status(400).json({ error: "موضوع برای اجرای خودکار الزامی است." });
    }
    const profile = getPageProfile(brief.pageProfileId);
    const cleanIdea = brief.idea.trim();
    const resolvedTitle =
      brief.title?.trim() ||
      brief.selectedTopicAngle?.title?.trim() ||
      cleanIdea.split(/[\n.!؟]/)[0]?.trim().slice(0, 80) ||
      "پست خودکار جدید";

    const project = createProject({
      title: resolvedTitle,
      idea: cleanIdea,
      pageProfileId: brief.pageProfileId ?? null,
      platform: brief.platform || profile?.platform || "instagram",
      contentFormat: brief.contentFormat || profile?.defaultFormat || "reels",
      pageMaturity: brief.pageMaturity || profile?.pageMaturity || "new_page",
      tone:
        brief.selectedTopicAngle?.recommendedTone ||
        brief.tone ||
        profile?.brandTone ||
        "educational",
      toneLabelFa: brief.selectedTopicAngle?.recommendedToneLabelFa || brief.toneLabelFa,
      targetDurationSeconds:
        brief.selectedTopicAngle?.recommendedDurationSeconds ||
        brief.targetDurationSeconds ||
        35,
      selectedTopicAngle: brief.selectedTopicAngle ?? null,
      preferredVideoEngine: brief.preferredVideoEngine || "hyperframes_html",
      autonomousMode: true,
    });

    try {
      const completed = await runAutonomousEndToEndPipeline(project);
      res.json({ project: completed });
    } catch (err) {
      const msg = formatGeminiError(err);
      const latest = getProject(project.id) ?? project;
      const failed = saveProject({
        ...latest,
        checkpointStatus: "error",
        errorMessage: msg,
      });
      res.status(500).json({ error: msg, project: failed });
    }
  });

  // Autonomous Autopilot on an existing project: finish all remaining stages to final Reels MP4
  app.post("/api/projects/:id/autopilot", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });

    const { preferredVideoEngine } = (req.body || {}) as {
      preferredVideoEngine?: LocalVideoEngineId;
    };
    const prepared = preferredVideoEngine
      ? saveProject({
          ...project,
          brief: { ...project.brief, preferredVideoEngine, autonomousMode: true },
        })
      : project;

    try {
      const completed = await runAutonomousEndToEndPipeline(prepared);
      res.json({ project: completed });
    } catch (err) {
      const msg = formatGeminiError(err);
      const latest = getProject(prepared.id) ?? prepared;
      const failed = saveProject({
        ...latest,
        checkpointStatus: "error",
        errorMessage: msg,
      });
      res.status(500).json({ error: msg, project: failed });
    }
  });

  // Resume checkpoint (Approve & advance OR Regenerate with feedback)
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

  // Stage 3: Regenerate the 2 preview frames of a single 3-8s shot
  app.post("/api/projects/:id/shots/:shotNumber/regenerate", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.director) {
      return res.status(404).json({ error: "پروژه یا دکوپاژ شات‌ها یافت نشد." });
    }
    const shotNum = Number(req.params.shotNumber);
    const shot = project.director.shots.find((s) => s.shotNumber === shotNum);
    if (!shot) return res.status(404).json({ error: "شات موردنظر یافت نشد." });

    try {
      const { feedback, updatedPrompt } = req.body as {
        feedback?: string;
        updatedPrompt?: string;
      };
      const targetShot = updatedPrompt ? { ...shot, visualPromptFa: updatedPrompt } : shot;

      if (feedback?.trim()) {
        recordAgentLearning({
          agentId: "director_agent",
          scope: project.brief.pageProfileId ? "page" : "global",
          category: "voice_and_edit_rule",
          ruleText: feedback.trim(),
          sourceEvent: `اصلاح فریم‌های شات ${shotNum} در پروژه ${project.brief.title}`,
          pageProfileId: project.brief.pageProfileId ?? null,
          projectId: project.id,
        });
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
        director: updatedPrompt
          ? {
              ...project.director,
              shots: project.director.shots.map((s) =>
                s.shotNumber === shotNum ? targetShot : s
              ),
            }
          : project.director,
        visuals: {
          styleGuideSummary:
            project.visuals?.styleGuideSummary ?? project.director.visualDirectionSummary,
          shots: mergedShots,
        },
      });
      res.json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // Stage 4: Render playable MP4 for a single 3-8s shot
  app.post("/api/projects/:id/shots/:shotNumber/render-video", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.director) {
      return res.status(404).json({ error: "پروژه یا دکوپاژ شات‌ها یافت نشد." });
    }
    const shotNum = Number(req.params.shotNumber);
    const shot = project.director.shots.find((s) => s.shotNumber === shotNum);
    if (!shot) return res.status(404).json({ error: "شات موردنظر یافت نشد." });

    try {
      const { revisionNote, engineId } = req.body as {
        revisionNote?: string;
        engineId?: LocalVideoEngineId;
      };
      if (revisionNote?.trim()) {
        recordAgentLearning({
          agentId: "director_agent",
          scope: project.brief.pageProfileId ? "page" : "global",
          category: "mistake_repaired",
          ruleText: revisionNote.trim(),
          sourceEvent: `اصلاح ویدیوی شات ${shotNum} (${project.brief.title})`,
          pageProfileId: project.brief.pageProfileId ?? null,
          projectId: project.id,
        });
      }

      const renderedClip = await renderSingleStudioShotMp4({
        project,
        shot,
        revisionNote,
        engineId,
      });

      const currentClips = project.shotClips ?? [];
      const nextClips = currentClips.some((c) => c.shotNumber === shotNum)
        ? currentClips.map((c) => (c.shotNumber === shotNum ? renderedClip : c))
        : [...currentClips, renderedClip].sort((a, b) => a.shotNumber - b.shotNumber);

      const updated = saveProject({
        ...project,
        brief: engineId ? { ...project.brief, preferredVideoEngine: engineId } : project.brief,
        shotClips: nextClips,
      });
      res.json({ project: updated, clip: renderedClip });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در رندر ویدیوی این شات";
      res.status(500).json({ error: msg });
    }
  });

  // Stage 4: Batch-render & QA-verify all shots automatically with optional auto-approve
  app.post("/api/projects/:id/shots/render-all", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.director) {
      return res.status(404).json({ error: "پروژه یا دکوپاژ شات‌ها یافت نشد." });
    }
    try {
      const { engineId, autoApprove } = (req.body || {}) as {
        engineId?: LocalVideoEngineId;
        autoApprove?: boolean;
      };
      const targetEngine =
        engineId || project.brief.preferredVideoEngine || "hyperframes_html";
      const nextClips: ShotVideoClipRecord[] = [];
      for (const shot of project.director.shots) {
        const rendered = await renderSingleStudioShotMp4({
          project,
          shot,
          engineId: targetEngine,
        });
        nextClips.push(
          autoApprove && rendered.videoUrl
            ? { ...rendered, approvalStatus: "approved" }
            : rendered
        );
      }
      const updated = saveProject({
        ...project,
        brief: { ...project.brief, preferredVideoEngine: targetEngine },
        shotClips: nextClips,
      });
      res.json({ project: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در رندر خودکار شات‌ها";
      res.status(500).json({ error: msg });
    }
  });

  // Stage 4: Approve or mark needs_revision for a single shot video (unlocking the next shot sequentially)
  app.post("/api/projects/:id/shots/:shotNumber/approve", (req, res) => {
    const project = getProject(req.params.id);
    if (!project || !project.director) {
      return res.status(404).json({ error: "پروژه یافت نشد." });
    }
    const shotNum = Number(req.params.shotNumber);
    const { status, revisionNote } = req.body as {
      status?: ShotVideoApprovalStatus;
      revisionNote?: string;
    };
    const nextStatus: ShotVideoApprovalStatus =
      status === "needs_revision" ? "needs_revision" : "approved";

    const currentClips = project.shotClips ?? [];
    const nextClips = currentClips.map((c) =>
      c.shotNumber === shotNum
        ? {
            ...c,
            approvalStatus: nextStatus,
            revisionNote: revisionNote ?? c.revisionNote,
          }
        : c
    );

    const updated = saveProject({
      ...project,
      shotClips: nextClips,
    });
    res.json({ project: updated });
  });

  // Stage 5: Synthesize or re-synthesize WAV voiceover
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
        voiceName ?? project.voiceover?.voiceName,
        voiceStyle ?? project.voiceover?.voiceStyle,
        feedback,
        narrationText,
        project.narration
      );
      const updated = saveProject({
        ...project,
        voiceover: vo,
        checkpointStatus: "waiting_approval",
      });
      res.json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // Stage 6: Download complete DaVinci Resolve Free/Studio Automation ZIP
  app.get("/api/projects/:id/davinci/download", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });

    try {
      const zipBuffer = await generateDaVinciBundleZip(project);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="DaVinci_AutoEdit_${project.id}.zip"`
      );
      res.send(zipBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در ساخت بسته DaVinci Resolve";
      res.status(500).json({ error: msg });
    }
  });

  // Stage 6: Assemble playable Master MP4 from approved shots + WAV narration + -14 LUFS audio
  app.post("/api/projects/:id/davinci/assemble-master", async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });

    try {
      const assembled = await assembleApprovedProjectMasterMp4(project);
      const baseSummary = project.davinciPackage ?? buildDaVinciPackageSummary(project);
      const updated = saveProject({
        ...project,
        davinciPackage: {
          ...baseSummary,
          masterVideoUrl: assembled.masterVideoUrl,
          qaAudit: assembled.qaAudit,
          engineUsed: project.brief.preferredVideoEngine || "hyperframes_html",
          comfyuiWorkflowAvailable: true,
        },
      });
      res.json({
        project: updated,
        masterVideoUrl: assembled.masterVideoUrl,
        qaAudit: assembled.qaAudit,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در مونتاژ ویدیوی نهایی";
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/projects/:id", (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "پروژه یافت نشد." });
    const updated = saveProject({ ...project, ...req.body, id: project.id });
    res.json({ project: updated });
  });

  app.get("/api/video/preflight", (_req, res) => {
    res.json({ preflight: runPreflightCheck() });
  });

  app.get("/api/video/engines", async (_req, res) => {
    try {
      const engines = await getLocalEnginesStatus();
      res.json({ engines });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  app.get("/api/video/comfyui-workflow", (_req, res) => {
    const workflow = buildComfyUiLightweightWorkflow();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="comfyui_reels_lightweight_workflow.json"'
    );
    res.send(JSON.stringify(workflow, null, 2));
  });

  app.post("/api/studio/research", async (req, res) => {
    try {
      const { query } = req.body as { query?: string };
      if (!query?.trim()) {
        return res.status(400).json({ error: "متن پرسش پژوهشی الزامی است." });
      }
      const result = await runQuickSearchResearch(query.trim());
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  app.post("/api/studio/transcribe", async (req, res) => {
    try {
      const { audioBase64, mimeType } = req.body as {
        audioBase64?: string;
        mimeType?: string;
      };
      if (!audioBase64?.trim()) {
        return res.status(400).json({ error: "داده صوتی ارسال نشده است." });
      }
      const result = await runAudioTranscriptionAgent({
        audioBase64: audioBase64.trim(),
        mimeType: mimeType || "audio/webm",
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // ============================================================================
  // Windows Desktop Tauri + Python + Local Voice Clone Bundle
  // ============================================================================
  app.get("/api/windows-bundle/preview", (_req, res) => {
    res.json({ files: getWindowsBundlePreviews() });
  });

  app.get("/api/windows-bundle/download", async (_req, res) => {
    try {
      const zipBuffer = await generateWindowsBundleZip();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="ContentStudioDesktop-Windows-FreeAI.zip"'
      );
      res.send(zipBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در ساخت بسته ویندوز";
      res.status(500).json({ error: msg });
    }
  });

  // ============================================================================
  // Server-Env-Only Free AI Router (Zero Client API Key Entry)
  // ============================================================================
  app.get("/api/router/config", (_req, res) => {
    res.json({
      config: toPublicRouterConfig(),
    });
  });

  app.patch("/api/router/providers/:id", (req, res) => {
    try {
      const { enabled } = req.body as { enabled?: boolean };
      const config = toggleProviderEnabledServer(req.params.id, Boolean(enabled));
      res.json({ config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در تغییر وضعیت سرویس‌دهنده";
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
      const msg = err instanceof Error ? err.message : "خطا در کشف مدل‌های رایگان";
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
        return res.status(400).json({ error: "شناسه مدل الزامی است." });
      }
      const config = addManualModelToProvider(req.params.id, modelId.trim(), name, isFree);
      res.json({ config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطا در افزودن مدل";
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
        return res.status(400).json({ error: "آرایه مسیرها نامعتبر است." });
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
      const msg = err instanceof Error ? err.message : "خطا در تست زنجیره";
      res.status(500).json({ error: msg });
    }
  });

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
    void ensureRemotionBrowser().catch((err) => {
      console.warn(
        "[video-preflight] Remotion browser pre-warm deferred:",
        err instanceof Error ? err.message : err
      );
    });
  });
}

startServer();
