import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  PauseCircle,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  FORMATS_BY_PLATFORM,
  GuidedStudioChat,
  type ChatTimelineMessage,
} from "./components/GuidedStudioChat";
import { MediaStudioView } from "./components/MediaStudioView";
import { ProjectsAndDesktopView } from "./components/ProjectsAndDesktopView";
import { RouterSettingsView } from "./components/RouterSettingsView";
import { StageDirector } from "./components/StageDirector";
import { StageResearchScript } from "./components/StageResearchScript";
import { StageVisuals } from "./components/StageVisuals";
import { StageVoiceover } from "./components/StageVoiceover";
import {
  deleteMediaAssetFromFirestore,
  deleteProjectFromFirestore,
  signInWithGoogle,
  signOutUser,
  subscribeAuthState,
  subscribeUserCloudProjects,
  syncMediaAssetToFirestore,
  syncProjectToFirestore,
  type CloudProjectSummary,
} from "./lib/firebase";
import type {
  ContentFormatOption,
  DirectorOutput,
  PageMaturityOption,
  PipelineStage,
  PlatformOption,
  ProjectBrief,
  ProjectRecord,
  ResearchAndScriptOutput,
  StudioMediaAsset,
  TopicAnalysisResponse,
  ViralTopicProposal,
  VoicePersona,
  VoiceoverOutput,
} from "./types/studio";
import type { VideoAspectFormat, VideoQualityMode } from "./types/videoPipeline";

type AppTab = "workspace" | "studio" | "projects" | "router";

const STEP_ITEMS: Array<{ stage: PipelineStage; num: string; label: string }> = [
  { stage: "research_script", num: "۱", label: "سناریو" },
  { stage: "voiceover", num: "۲", label: "صدای گوینده" },
  { stage: "director", num: "۳", label: "چیدمان صحنه" },
  { stage: "visuals", num: "۴", label: "تصویرسازی" },
];

const STAGE_RANK: Record<PipelineStage, number> = {
  input: 0,
  research_script: 1,
  voiceover: 2,
  director: 3,
  visuals: 4,
  completed: 5,
};

const PLATFORM_NAMES: Record<string, string> = {
  instagram: "اینستاگرام",
  youtube: "یوتیوب",
  tiktok: "تیک‌تاک",
  reels: "اینستاگرام",
  shorts: "یوتیوب",
};

const FORMAT_NAMES: Record<string, string> = {
  reels: "ریلز",
  post: "پست",
  story: "استوری",
  shorts: "شورتس",
  long_video: "ویدیوی کامل",
  tiktok_video: "ویدیو کوتاه",
  carousel: "اسلاید",
};

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("workspace");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [viewingStage, setViewingStage] = useState<PipelineStage>("input");
  const [isRunning, setIsRunning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Firebase Auth & Cloud state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([]);

  // Guided Chat Composer state (Right Pane)
  const [platform, setPlatform] = useState<PlatformOption>("instagram");
  const [contentFormat, setContentFormat] = useState<ContentFormatOption>("reels");
  const [pageMaturity, setPageMaturity] = useState<PageMaturityOption>("new_page");
  const [draftIdea, setDraftIdea] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<ChatTimelineMessage[]>([]);
  const [pendingBrief, setPendingBrief] = useState<ProjectBrief | null>(null);
  const [pendingAnalysis, setPendingAnalysis] = useState<TopicAnalysisResponse | null>(null);

  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  useEffect(() => {
    const unsub = subscribeAuthState((user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setCloudProjects([]);
      return;
    }
    const unsub = subscribeUserCloudProjects(
      firebaseUser.uid,
      (items) => setCloudProjects(items),
      (err) => setErrorBanner(`خطای همگام‌سازی ابری: ${err.message}`)
    );
    return () => unsub();
  }, [authReady, firebaseUser]);

  const syncProjectIfSignedIn = useCallback(
    async (proj: ProjectRecord) => {
      if (!firebaseUser) return;
      try {
        await syncProjectToFirestore(firebaseUser.uid, proj);
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? `خطا در ذخیره ابری پروژه: ${err.message}` : "خطا در ذخیره ابری"
        );
      }
    },
    [firebaseUser]
  );

  const handleGoogleSignIn = async () => {
    setErrorBanner(null);
    try {
      const user = await signInWithGoogle();
      if (projects.length > 0) {
        for (const proj of projects.slice(0, 5)) {
          await syncProjectToFirestore(user.uid, proj);
        }
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? `ورود با گوگل ناموفق بود: ${err.message}` : "خطا در ورود گوگل");
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutUser();
  };

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      const list = (data.projects ?? []) as ProjectRecord[];
      setProjects(list);
    } catch {
      setErrorBanner("بارگذاری پروژه‌ها با خطا مواجه شد.");
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const upsertProject = (proj: ProjectRecord) => {
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === proj.id);
      if (exists) return prev.map((p) => (p.id === proj.id ? proj : p));
      return [proj, ...prev];
    });
    setSelectedProjectId(proj.id);
    setViewingStage(proj.currentStage === "completed" ? "visuals" : proj.currentStage);
  };

  const handleStartNewProject = () => {
    setSelectedProjectId(null);
    setViewingStage("input");
    setActiveTab("workspace");
    setChatMessages([]);
    setPendingBrief(null);
    setPendingAnalysis(null);
    setDraftIdea("");
    setErrorBanner(null);
  };

  const handleUseTranscriptAsIdea = (text: string) => {
    handleStartNewProject();
    setDraftIdea(text);
  };

  const handleOpenProject = (proj: ProjectRecord) => {
    setSelectedProjectId(proj.id);
    setViewingStage(proj.currentStage === "completed" ? "visuals" : proj.currentStage);
    setPendingBrief(null);
    setPendingAnalysis(null);
    setChatMessages([
      {
        id: `open_${proj.id}`,
        role: "assistant",
        metaLabel: `${PLATFORM_NAMES[proj.brief.platform] || "پروژه"} · ${
          proj.brief.contentFormat ? FORMAT_NAMES[proj.brief.contentFormat] || "" : ""
        }`,
        text: `پروژه «${proj.brief.title}» باز شد. هر تغییری در مرحله فعلی خواستید، همین‌جا بنویسید.`,
      },
    ]);
    setActiveTab("workspace");
    setErrorBanner(null);
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (firebaseUser) {
        await deleteProjectFromFirestore(id).catch(() => {});
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (selectedProjectId === id) {
        handleStartNewProject();
      }
    } catch {
      setErrorBanner("حذف پروژه انجام نشد.");
    }
  };

  // Step 1 from Right Chat Box: Analyze idea from 3 perspectives & propose 3 viral topics
  const handleAnalyzeIdea = async (ideaText: string) => {
    setIsAnalyzing(true);
    setErrorBanner(null);

    const maturityLabel =
      pageMaturity === "new_page" ? "شروع پیج (پست‌های ۱ تا ۵)" : "پیج فعال (۱۰ تا ۲۰+ پست)";

    const brief: ProjectBrief = {
      title: ideaText.split(/[\n.!؟]/)[0]?.trim().slice(0, 80) || "ایده جدید",
      idea: ideaText,
      platform,
      contentFormat,
      pageMaturity,
      tone: "educational",
      targetDurationSeconds: contentFormat === "story" ? 20 : contentFormat === "long_video" ? 240 : 45,
    };

    const userMsg: ChatTimelineMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      metaLabel: `${PLATFORM_NAMES[platform] || platform} · ${FORMAT_NAMES[contentFormat] || contentFormat} · ${maturityLabel}`,
      text: ideaText,
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setPendingBrief(brief);

    try {
      const res = await fetch("/api/projects/propose-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "بررسی ایده با خطا مواجه شد.");
      }
      const analysis = data.analysis as TopicAnalysisResponse;
      setPendingAnalysis(analysis);

      const assistantMsg: ChatTimelineMessage = {
        id: `a_${Date.now()}`,
        role: "assistant",
        metaLabel: "تحلیل تخصصی ایجنت سناریونویس (استراتژی، پژوهش و روانشناسی)",
        text: analysis.strategistSummary,
        analysis,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در تحلیل ایده");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Step 2 from Right Chat Box: User selects 1 of 3 viral topics (or null for exact brief) -> runs Stage 1
  const handleSelectProposalAndStart = async (proposal: ViralTopicProposal | null) => {
    if (!pendingBrief) return;
    setIsRunning(true);
    setErrorBanner(null);

    const chosenTone = proposal
      ? proposal.recommendedTone
      : pendingAnalysis?.defaultRecommendedTone || "educational";
    const chosenToneLabel = proposal
      ? proposal.recommendedToneLabelFa
      : pendingAnalysis?.defaultRecommendedToneLabelFa;
    const chosenDuration = proposal
      ? proposal.recommendedDurationSeconds
      : pendingAnalysis?.defaultRecommendedDurationSeconds || pendingBrief.targetDurationSeconds;

    const finalBrief: ProjectBrief = {
      ...pendingBrief,
      title: proposal ? proposal.title : pendingBrief.title,
      tone: chosenTone,
      toneLabelFa: chosenToneLabel,
      targetDurationSeconds: chosenDuration,
      selectedTopicAngle: proposal,
    };

    const choiceMsg: ChatTimelineMessage = {
      id: `u_pick_${Date.now()}`,
      role: "user",
      text: proposal
        ? `موضوع انتخابی من: «${proposal.title}»`
        : "سناریو را دقیقاً بر اساس متن و توضیحات خودم بنویس.",
    };
    setChatMessages((prev) => [...prev, choiceMsg]);

    try {
      const res = await fetch("/api/projects/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalBrief),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.project) upsertProject(data.project);
        throw new Error(data.error || "نگارش سناریو با خطا مواجه شد.");
      }
      upsertProject(data.project);
      setPendingBrief(null);
      setPendingAnalysis(null);
      setDraftIdea("");
      setChatMessages((prev) => [
        ...prev,
        {
          id: `a_ready_${Date.now()}`,
          role: "assistant",
          text: "سناریو و نکات کلیدی در کادر سمت چپ آماده شد! می‌توانید متنش را مستقیماً ویرایش کنید، تغییر جدیدی همین‌جا بنویسید، یا تایید کنید تا صدای گوینده ساخته شود.",
        },
      ]);
      void syncProjectIfSignedIn(data.project);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در شروع پروژه");
    } finally {
      setIsRunning(false);
    }
  };

  const handleSaveInline = async (patch: Partial<ProjectRecord>) => {
    if (!activeProject) return;
    try {
      const res = await fetch(`/api/projects/${activeProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok && data.project) {
        setProjects((prev) => prev.map((p) => (p.id === data.project.id ? data.project : p)));
        void syncProjectIfSignedIn(data.project);
      }
    } catch {
      setErrorBanner("ذخیره تغییرات با خطا مواجه شد.");
    }
  };

  const handleResumeCheckpoint = async (payload: {
    action: "approve" | "regenerate";
    feedback?: string;
    researchScript?: ResearchAndScriptOutput;
    voiceover?: VoiceoverOutput;
    director?: DirectorOutput;
  }) => {
    if (!activeProject) return;
    setIsRunning(true);
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.project) upsertProject(data.project);
        throw new Error(data.error || "ادامه پردازش با خطا مواجه شد.");
      }
      const nextProj = data.project as ProjectRecord;
      upsertProject(nextProj);
      void syncProjectIfSignedIn(nextProj);

      if (payload.action === "approve") {
        const nextStageMsg =
          nextProj.currentStage === "voiceover"
            ? "صدای گوینده و متن گفتار آماده شد. گوش دهید و اگر مناسب بود تایید کنید."
            : nextProj.currentStage === "director"
              ? "چیدمان صحنه‌ها و زاویه دوربین آماده شد."
              : nextProj.currentStage === "visuals"
                ? "تصاویر پیش‌نمایش صحنه‌ها آماده است."
                : "تبریک! پروژه شما با موفقیت نهایی و آماده شد.";
        setChatMessages((prev) => [
          ...prev,
          { id: `a_adv_${Date.now()}`, role: "assistant", text: nextStageMsg },
        ]);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در ادامه مراحل");
    } finally {
      setIsRunning(false);
    }
  };

  // Conversational feedback from the Right Chat Box for the active stage
  const handleSendStageFeedback = async (feedbackText: string) => {
    if (!activeProject) return;
    setChatMessages((prev) => [
      ...prev,
      { id: `u_fb_${Date.now()}`, role: "user", text: feedbackText },
    ]);
    await handleResumeCheckpoint({ action: "regenerate", feedback: feedbackText });
    setChatMessages((prev) => [
      ...prev,
      {
        id: `a_fb_${Date.now()}`,
        role: "assistant",
        text: "تغییرات درخواستی شما اعمال و نسخه جدید در سمت چپ نمایش داده شد.",
      },
    ]);
  };

  const handleResynthesizeAudio = async (params: {
    narrationText: string;
    voiceName: VoicePersona;
    voiceStyle: string;
  }) => {
    if (!activeProject) return;
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/voiceover/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تولید مجدد صدا با خطا مواجه شد.");
      if (data.project) {
        upsertProject(data.project);
        void syncProjectIfSignedIn(data.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در تولید صدا");
    }
  };

  const handleRegenerateSingleShot = async (
    shotNumber: number,
    updatedPrompt?: string,
    feedback?: string
  ) => {
    if (!activeProject) return;
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/shots/${shotNumber}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updatedPrompt, feedback }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "بازتولید تصویر صحنه با خطا مواجه شد.");
      if (data.project) {
        upsertProject(data.project);
        void syncProjectIfSignedIn(data.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در بازتولید صحنه");
    }
  };

  const handleStartVideoRender = async (opts: {
    aspectRatio: VideoAspectFormat;
    qualityMode: VideoQualityMode;
    burnSubtitles: boolean;
    includeBackgroundMusic: boolean;
  }) => {
    if (!activeProject) return;
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/video/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "شروع پایپ‌لاین رندر ویدیو با خطا مواجه شد.");
      if (data.project) {
        setProjects((prev) => prev.map((p) => (p.id === data.project.id ? data.project : p)));
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در شروع رندر ویدیو");
    }
  };

  const handleRetryVideoShot = async (shotId: string, humanInstruction?: string) => {
    if (!activeProject) return;
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/video/shots/${shotId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ humanInstruction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "بازسازی شات با خطا مواجه شد.");
      if (data.project) {
        setProjects((prev) => prev.map((p) => (p.id === data.project.id ? data.project : p)));
        void syncProjectIfSignedIn(data.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در بازسازی شات");
    }
  };

  useEffect(() => {
    if (
      !activeProject?.id ||
      (activeProject.videoProduction?.status !== "running" &&
        activeProject.videoProduction?.status !== "assembling")
    ) {
      return;
    }
    const targetId = activeProject.id;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${targetId}/video/status`);
        const data = await res.json();
        if (res.ok && data.videoProduction) {
          setProjects((prev) =>
            prev.map((p) =>
              p.id === targetId ? { ...p, videoProduction: data.videoProduction } : p
            )
          );
        }
      } catch {
        // ignore transient poll failure
      }
    }, 2200);
    return () => clearInterval(timer);
  }, [activeProject?.id, activeProject?.videoProduction?.status]);

  const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = (proj: ProjectRecord) => {
    const lines: string[] = [
      `# ${proj.brief.title}`,
      ``,
      `- **پلتفرم:** ${PLATFORM_NAMES[proj.brief.platform] || proj.brief.platform}`,
      `- **مدت هدف:** ${proj.brief.targetDurationSeconds} ثانیه`,
      ``,
    ];
    if (proj.researchScript) {
      lines.push(`## ۱. پژوهش و سناریو (${proj.researchScript.videoTitle})`);
      lines.push(`### خلاصه پژوهش`, proj.researchScript.researchSummary, "");
      lines.push(`### قلاب (Hook)`, proj.researchScript.hook, "");
      lines.push(`### بدنه`, proj.researchScript.body, "");
      lines.push(`### دعوت به اقدام (CTA)`, proj.researchScript.cta, "");
    }
    if (proj.voiceover) {
      lines.push(`## ۲. متن نریشن (گوینده: ${proj.voiceover.voiceName})`);
      lines.push(proj.voiceover.narrationText, "");
    }
    if (proj.director) {
      lines.push(`## ۳. چیدمان صحنه‌ها`);
      for (const s of proj.director.shots) {
        lines.push(
          `### صحنه ${s.shotNumber} (${s.timecode} · ${s.durationSeconds} ثانیه)`,
          `- **دوربین:** ${s.cameraAngle} — ${s.cameraMovement}`,
          `- **متن روی تصویر:** ${s.onScreenText}`,
          `- **گفتار:** ${s.spokenSegment}`,
          `- **شرح صحنه:** ${s.sceneDescriptionFa}`,
          ``
        );
      }
    }
    downloadFile(`${proj.id}_scenario.md`, lines.join("\n"), "text/markdown;charset=utf-8");
  };

  const handleExportJson = (proj: ProjectRecord) => {
    downloadFile(
      `${proj.id}_project.json`,
      JSON.stringify(proj, null, 2),
      "application/json;charset=utf-8"
    );
  };

  const isStageAccessible = (stage: PipelineStage): boolean => {
    if (!activeProject) return false;
    if (stage === "research_script") return Boolean(activeProject.researchScript);
    if (stage === "voiceover") return Boolean(activeProject.voiceover);
    if (stage === "director") return Boolean(activeProject.director);
    if (stage === "visuals") return Boolean(activeProject.visuals);
    return false;
  };

  const currentPlatformKey =
    platform === "reels" ? "instagram" : platform === "shorts" ? "youtube" : platform;
  const activeFormatLabel =
    FORMATS_BY_PLATFORM[currentPlatformKey]?.find((f) => f.id === contentFormat)?.label || "ریلز";

  return (
    <div className="flex min-h-screen flex-col bg-[#0B0D11] text-slate-100">
      {/* Ultra-Clean 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-6 border-b border-[#262B38] bg-[#0B0D11]/95 px-6 py-3.5 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setActiveTab("workspace")}
          className="text-base font-bold tracking-tight text-slate-100 transition-colors hover:text-amber-400 whitespace-nowrap shrink-0"
        >
          استودیو محتوا
        </button>

        <nav className="flex items-center gap-7 overflow-x-auto text-xs font-medium text-slate-400">
          {[
            { id: "workspace", label: "میز کار هوشمند" },
            { id: "studio", label: "تصویر، ویدیو و ۳بعدی" },
            { id: "projects", label: "پروژه‌ها و نسخه ویندوز" },
            { id: "router", label: "روتر مدل‌ها" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as AppTab)}
              className={`border-b-2 py-1 whitespace-nowrap shrink-0 transition-colors ${
                activeTab === tab.id
                  ? "border-amber-500 text-slate-100"
                  : "border-transparent hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <button
          type="button"
          onClick={handleStartNewProject}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>شروع ایده جدید</span>
        </button>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 p-5 lg:p-7">
        {errorBanner && (
          <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-red-300 underline hover:text-white"
            >
              بستن
            </button>
          </div>
        )}

        {activeTab === "studio" ? (
          <MediaStudioView
            userUid={firebaseUser?.uid ?? null}
            activeProject={activeProject}
            onSyncAssetToCloud={async (asset: StudioMediaAsset) => {
              if (firebaseUser) await syncMediaAssetToFirestore(firebaseUser.uid, asset);
            }}
            onDeleteCloudAsset={async (id: string) => {
              if (firebaseUser) await deleteMediaAssetFromFirestore(id);
            }}
            onUseTextAsIdea={handleUseTranscriptAsIdea}
          />
        ) : activeTab === "projects" ? (
          <ProjectsAndDesktopView
            projects={projects}
            selectedProjectId={selectedProjectId}
            firebaseUser={firebaseUser}
            cloudProjectCount={cloudProjects.length}
            onGoogleSignIn={handleGoogleSignIn}
            onGoogleSignOut={handleGoogleSignOut}
            onOpenProject={handleOpenProject}
            onDeleteProject={handleDeleteProject}
            onExportMarkdown={handleExportMarkdown}
            onExportJson={handleExportJson}
          />
        ) : activeTab === "router" ? (
          <RouterSettingsView />
        ) : (
          /* Two-Pane Guided Workspace: Right = Chat Box, Left = Progressive Output Canvas */
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            {/* RIGHT PANE (first in RTL grid): Guided Chat Box */}
            <div className="lg:sticky lg:top-20 lg:col-span-5">
              <GuidedStudioChat
                activeStage={activeProject ? viewingStage : "input"}
                hasActiveProject={Boolean(activeProject)}
                isAnalyzing={isAnalyzing}
                isRunningPipeline={isRunning}
                initialDraftIdea={draftIdea}
                platform={platform}
                contentFormat={contentFormat}
                pageMaturity={pageMaturity}
                messages={chatMessages}
                pendingBrief={pendingBrief}
                pendingAnalysis={pendingAnalysis}
                onChangePlatform={setPlatform}
                onChangeFormat={setContentFormat}
                onChangePageMaturity={setPageMaturity}
                onAnalyzeIdea={handleAnalyzeIdea}
                onSelectProposalAndStart={handleSelectProposalAndStart}
                onSendStageFeedback={handleSendStageFeedback}
              />
            </div>

            {/* LEFT PANE (second in RTL grid): Clean 4-Step Progressive Output Canvas */}
            <div className="space-y-5 lg:col-span-7">
              {/* Calm 4-Step Horizontal Progress Strip */}
              <div className="grid grid-cols-4 gap-2 rounded-2xl border border-[#262B38] bg-[#14171F] p-2">
                {STEP_ITEMS.map((step) => {
                  const accessible = isStageAccessible(step.stage);
                  const isViewing = Boolean(activeProject) && viewingStage === step.stage;
                  const currentRank = activeProject ? STAGE_RANK[activeProject.currentStage] : 0;
                  const stepRank = STAGE_RANK[step.stage];
                  const isDone =
                    Boolean(activeProject) &&
                    (currentRank > stepRank || activeProject?.currentStage === "completed");
                  const isPausedHere =
                    Boolean(activeProject) &&
                    activeProject?.currentStage === step.stage &&
                    activeProject?.checkpointStatus === "waiting_approval";

                  return (
                    <button
                      key={step.stage}
                      type="button"
                      disabled={!accessible}
                      onClick={() => setViewingStage(step.stage)}
                      className={`flex items-center justify-center gap-2 rounded-xl px-2.5 py-2.5 text-xs font-medium transition-colors ${
                        isViewing
                          ? "bg-amber-500 text-slate-950 font-semibold"
                          : accessible
                            ? "bg-[#0B0D11]/60 text-slate-200 hover:bg-[#1B1F2A]"
                            : "text-slate-500 opacity-60 cursor-not-allowed"
                      }`}
                    >
                      {isDone && !isViewing ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      ) : isPausedHere && !isViewing ? (
                        <PauseCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      ) : !isViewing ? (
                        <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      ) : null}
                      <span className="truncate">
                        {step.num}. {step.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Left Canvas Content */}
              {isRunning && !activeProject ? (
                <div className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-8">
                  <div className="flex items-center gap-3 text-sm font-semibold text-amber-400">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                    <span>در حال تحقیق در وب و نگارش بهترین سناریو برای شما...</span>
                  </div>
                  <div className="h-48 animate-pulse rounded-xl bg-[#1B1F2A]" />
                  <div className="h-48 animate-pulse rounded-xl bg-[#1B1F2A]" />
                </div>
              ) : !activeProject && pendingAnalysis ? (
                /* Deep Domain & Audience Intelligence + Comparison View of 3 Distinct Viral Angles */
                <div className="space-y-6 rounded-2xl border border-[#262B38] bg-[#14171F] p-6">
                  <div className="border-b border-[#262B38] pb-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-amber-400">
                      <span>تحلیل تخصصی ایجنت سناریونویس</span>
                      <span aria-hidden="true">·</span>
                      <span>{PLATFORM_NAMES[platform]} ({activeFormatLabel})</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {(pendingBrief?.pageMaturity || pageMaturity) === "new_page"
                          ? "شروع پیج (پست‌های ۱ تا ۵)"
                          : "پیج فعال (۱۰ تا ۲۰+ پست)"}
                      </span>
                    </div>
                    <h2 className="mt-1 text-lg font-bold text-slate-100">
                      شناخت مخاطب دقیق و ۳ زاویه متمایز وایرال
                    </h2>
                  </div>

                  {/* Deep Keyword Domain, Exact Target Audience Persona & Core Pain Points */}
                  {(pendingAnalysis.keywordDomainAnalysis ||
                    pendingAnalysis.exactTargetAudience ||
                    pendingAnalysis.pageStrategyRecommendation ||
                    (pendingAnalysis.corePainPoints && pendingAnalysis.corePainPoints.length > 0)) && (
                    <div className="space-y-4 border-b border-[#262B38] pb-5 text-xs leading-6">
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        {pendingAnalysis.keywordDomainAnalysis && (
                          <div>
                            <div className="mb-1 font-semibold text-amber-300">حوزه تخصصی و ماهیت واقعی بازار</div>
                            <p className="text-slate-300">{pendingAnalysis.keywordDomainAnalysis}</p>
                          </div>
                        )}
                        {pendingAnalysis.exactTargetAudience && (
                          <div>
                            <div className="mb-1 font-semibold text-emerald-300">پرسونای دقیق مخاطب هدف</div>
                            <p className="text-slate-300">{pendingAnalysis.exactTargetAudience}</p>
                          </div>
                        )}
                      </div>

                      {pendingAnalysis.pageStrategyRecommendation && (
                        <div className="border-t border-[#262B38]/60 pt-3">
                          <div className="mb-1 font-semibold text-sky-300">
                            استراتژی متناسب با وضعیت فعلی پیج
                          </div>
                          <p className="text-slate-300">{pendingAnalysis.pageStrategyRecommendation}</p>
                        </div>
                      )}

                      {pendingAnalysis.corePainPoints && pendingAnalysis.corePainPoints.length > 0 && (
                        <div>
                          <div className="mb-1.5 font-semibold text-slate-200">
                            دغدغه‌ها، ریسک‌ها و سوالات پنهان مخاطب هدف:
                          </div>
                          <ul className="grid grid-cols-1 gap-1.5 text-slate-300 sm:grid-cols-2">
                            {pendingAnalysis.corePainPoints.map((pain, pIdx) => (
                              <li key={pIdx} className="flex items-start gap-2">
                                <span className="mt-1 text-amber-400">•</span>
                                <span>{pain}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3 Sharply Differentiated Viral Proposals */}
                  <div className="divide-y divide-[#262B38]">
                    {pendingAnalysis.proposals.map((prop, idx) => (
                      <div key={prop.id} className="space-y-4 py-5 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              <span className="font-semibold text-amber-400">
                                {prop.angleArchetype || `زاویه ${idx + 1}`}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>لحن: {prop.recommendedToneLabelFa}</span>
                              <span aria-hidden="true">·</span>
                              <span>زمان: {prop.recommendedDurationLabelFa}</span>
                            </div>
                            <h3 className="text-base font-bold text-slate-100">
                              {idx + 1}. {prop.title}
                            </h3>
                            {prop.targetAudienceSegment && (
                              <p className="text-xs leading-6 text-emerald-300">
                                مخاطب دقیق این موضوع: {prop.targetAudienceSegment}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={isRunning}
                            onClick={() => handleSelectProposalAndStart(prop)}
                            className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                          >
                            انتخاب و ساخت سناریو
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 border-t border-[#262B38]/60 pt-3 text-xs leading-6 md:grid-cols-2">
                          <div>
                            <div className="font-semibold text-amber-300">قلاب کلامی ۳ ثانیه اول</div>
                            <p className="mt-0.5 text-slate-200">«{prop.sampleHook}»</p>
                          </div>
                          {prop.openingVisualHook && (
                            <div>
                              <div className="font-semibold text-slate-200">تصویر و صحنه شروع برای توقف اسکرول</div>
                              <p className="mt-0.5 text-slate-300">{prop.openingVisualHook}</p>
                            </div>
                          )}
                        </div>

                        {prop.keyFactsAndDataPoints && prop.keyFactsAndDataPoints.length > 0 && (
                          <div className="border-t border-[#262B38]/60 pt-3 text-xs leading-6">
                            <div className="mb-1.5 font-semibold text-slate-200">
                              نکات تخصصی، استانداردها و داده‌های کلیدی داخل سناریو:
                            </div>
                            <ul className="space-y-1 text-slate-300">
                              {prop.keyFactsAndDataPoints.map((fact, fIdx) => (
                                <li key={fIdx} className="flex items-start gap-2">
                                  <span className="text-amber-400">–</span>
                                  <span>{fact}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 border-t border-[#262B38]/60 pt-3 text-xs leading-6 text-slate-300 md:grid-cols-3">
                          <div>
                            <div className="mb-1 font-semibold text-slate-100">استراتژی محتوا</div>
                            <p>{prop.strategistAngle}</p>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold text-slate-100">روانشناسی سوشال مدیا</div>
                            <p>{prop.psychologyTrigger}</p>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold text-slate-100">اجرا و کارگردانی</div>
                            <p>{prop.creatorExecutionTip}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#262B38]/60 pt-2.5 text-[11px] leading-6">
                          {prop.ctaStrategy && (
                            <span className="text-amber-300">
                              دعوت به اقدام (CTA): {prop.ctaStrategy}
                            </span>
                          )}
                          <span className="text-emerald-400">{prop.viralPotentialNote}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {pendingAnalysis.sources.length > 0 && (
                    <div className="space-y-2 border-t border-[#262B38] pt-4">
                      <div className="text-xs font-medium text-slate-400">منابع بررسی‌شده در وب:</div>
                      <div className="flex flex-wrap gap-2">
                        {pendingAnalysis.sources.map((src) => (
                          <a
                            key={src.uri}
                            href={src.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs text-slate-300 hover:border-amber-500/40 hover:text-amber-300"
                          >
                            <span className="max-w-[220px] truncate">{src.title}</span>
                            <ExternalLink className="h-3 w-3 text-slate-500" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : !activeProject ? (
                /* Calm Guided Welcome State before any idea is submitted */
                <div className="space-y-6 rounded-2xl border border-[#262B38] bg-[#14171F] p-8">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-400">
                      <Sparkles className="h-4 w-4" />
                      <span>مسیر ساده تولید محتوای حرفه‌ای</span>
                    </div>
                    <h1 className="text-xl font-bold text-slate-100">
                      از ایده خام تا سناریو، صدا و تصویرسازی در ۴ قدم ساده
                    </h1>
                    <p className="text-xs leading-7 text-slate-400">
                      بدون نیاز به تنظیمات پیچیده؛ کافی است در کادر چت سمت راست ایده خود را بنویسید.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-[#262B38] bg-[#0B0D11]/60 p-4">
                      <div className="text-xs font-bold text-amber-400">۱. پلتفرم و فرمت را انتخاب کنید</div>
                      <p className="mt-1.5 text-xs leading-6 text-slate-300">
                        بگویید برای اینستاگرام (ریلز، پست، استوری)، یوتیوب یا تیک‌تاک تولید می‌کنید.
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#262B38] bg-[#0B0D11]/60 p-4">
                      <div className="text-xs font-bold text-amber-400">۲. ۳ پیشنهاد وایرال بگیرید</div>
                      <p className="mt-1.5 text-xs leading-6 text-slate-300">
                        ایده شما از نگاه استراتژیست، روانشناسی و تولیدکننده حرفه‌ای بررسی و ۳ زاویه پربازدید پیشنهاد می‌شود.
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#262B38] bg-[#0B0D11]/60 p-4">
                      <div className="text-xs font-bold text-amber-400">۳. سناریو و صدای گوینده</div>
                      <p className="mt-1.5 text-xs leading-6 text-slate-300">
                        متن کامل سناریو همراه با فایل صوتی گوینده آماده می‌شود و هر قسمتی را بخواهید ویرایش می‌کنید.
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#262B38] bg-[#0B0D11]/60 p-4">
                      <div className="text-xs font-bold text-amber-400">۴. صحنه‌بندی و تصویرسازی</div>
                      <p className="mt-1.5 text-xs leading-6 text-slate-300">
                        برنامه دقیق هر صحنه، زاویه دوربین، زیرنویس و پیش‌نمایش تصویری شات‌ها تحویل می‌گیرید.
                      </p>
                    </div>
                  </div>
                </div>
              ) : viewingStage === "research_script" && activeProject.researchScript ? (
                <StageResearchScript
                  data={activeProject.researchScript}
                  isRunning={isRunning}
                  isCurrentGate={activeProject.currentStage === "research_script"}
                  onSaveEdits={(updated) => handleSaveInline({ researchScript: updated })}
                  onApprove={(updated) =>
                    handleResumeCheckpoint({ action: "approve", researchScript: updated })
                  }
                  onRegenerate={(feedback) =>
                    handleResumeCheckpoint({ action: "regenerate", feedback })
                  }
                />
              ) : viewingStage === "voiceover" && activeProject.voiceover ? (
                <StageVoiceover
                  data={activeProject.voiceover}
                  isRunning={isRunning}
                  isCurrentGate={activeProject.currentStage === "voiceover"}
                  onSaveEdits={(updated) => handleSaveInline({ voiceover: updated })}
                  onResynthesizeAudio={handleResynthesizeAudio}
                  onApprove={(updated) =>
                    handleResumeCheckpoint({ action: "approve", voiceover: updated })
                  }
                  onRegenerateTextAndAudio={(feedback) =>
                    handleResumeCheckpoint({ action: "regenerate", feedback })
                  }
                />
              ) : viewingStage === "director" && activeProject.director ? (
                <StageDirector
                  data={activeProject.director}
                  isRunning={isRunning}
                  isCurrentGate={activeProject.currentStage === "director"}
                  onSaveEdits={(updated) => handleSaveInline({ director: updated })}
                  onApprove={(updated) =>
                    handleResumeCheckpoint({ action: "approve", director: updated })
                  }
                  onRegenerate={(feedback) =>
                    handleResumeCheckpoint({ action: "regenerate", feedback })
                  }
                />
              ) : viewingStage === "visuals" && activeProject.visuals ? (
                <StageVisuals
                  projectId={activeProject.id}
                  platform={activeProject.brief.platform}
                  contentFormat={activeProject.brief.contentFormat}
                  data={activeProject.visuals}
                  directorShots={activeProject.director?.shots ?? []}
                  videoProduction={activeProject.videoProduction}
                  isRunning={isRunning}
                  isCompleted={activeProject.currentStage === "completed"}
                  onRegenerateShot={handleRegenerateSingleShot}
                  onRegenerateAll={(feedback) =>
                    handleResumeCheckpoint({ action: "regenerate", feedback })
                  }
                  onFinalize={() => handleResumeCheckpoint({ action: "approve" })}
                  onExportBible={() => handleExportMarkdown(activeProject)}
                  onStartVideoRender={handleStartVideoRender}
                  onRetryVideoShot={handleRetryVideoShot}
                />
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
