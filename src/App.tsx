import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  PauseCircle,
  Plus,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  FORMATS_BY_PLATFORM,
  GuidedStudioChat,
  type ChatTimelineMessage,
} from "./components/GuidedStudioChat";
import { PageProfilesView } from "./components/PageProfilesView";
import { RouterSettingsView } from "./components/RouterSettingsView";
import { StageDaVinciResolve } from "./components/StageDaVinciResolve";
import { StageDirector } from "./components/StageDirector";
import { StageNarration } from "./components/StageNarration";
import { StageResearchScript } from "./components/StageResearchScript";
import { StageShotVideos } from "./components/StageShotVideos";
import { StageVoiceover } from "./components/StageVoiceover";
import { VaultSecondBrainView } from "./components/VaultSecondBrainView";
import { ViralCompetitorRadarView } from "./components/ViralCompetitorRadarView";
import {
  deleteProjectFromFirestore,
  signInWithGoogle,
  signOutUser,
  subscribeAuthState,
  subscribeUserCloudProjects,
  syncProjectToFirestore,
  type CloudProjectSummary,
} from "./lib/firebase";
import type {
  ContentFormatOption,
  DirectorOutput,
  LocalVideoEngineId,
  NarrationScriptOutput,
  PageMaturityOption,
  PageProfile,
  PipelineStage,
  PlatformOption,
  ProjectBrief,
  ProjectRecord,
  ResearchAndScriptOutput,
  ShotVideoApprovalStatus,
  TopicAnalysisResponse,
  ViralTopicProposal,
  VoicePersona,
  VoiceoverOutput,
} from "./types/studio";

type AppTab = "workspace" | "pages" | "viral" | "vault" | "router";

const STEP_ITEMS: Array<{
  stage: PipelineStage;
  num: string;
  label: string;
  agentLabel: string;
}> = [
  { stage: "research_script", num: "۱", label: "سناریو", agentLabel: "ایجنت ۱" },
  { stage: "narration", num: "۲", label: "متن گویندگی", agentLabel: "ایجنت ۱" },
  { stage: "director", num: "۳", label: "دکوپاژ و ۲ فریم", agentLabel: "ایجنت ۲" },
  { stage: "shot_videos", num: "۴", label: "ویدیوی شات‌ها", agentLabel: "ایجنت ۲" },
  { stage: "voiceover", num: "۵", label: "کلون صدا", agentLabel: "ایجنت ۲" },
  { stage: "davinci", num: "۶", label: "تدوین DaVinci", agentLabel: "ایجنت ۲" },
];

const STAGE_RANK: Record<PipelineStage, number> = {
  input: 0,
  research_script: 1,
  narration: 2,
  director: 3,
  shot_videos: 4,
  voiceover: 5,
  davinci: 6,
  visuals: 6,
  completed: 7,
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

function resolveStageToView(stage: PipelineStage): PipelineStage {
  if (stage === "completed" || stage === "visuals") return "davinci";
  return stage;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("workspace");
  const [pages, setPages] = useState<PageProfile[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [viewingStage, setViewingStage] = useState<PipelineStage>("input");
  const [isRunning, setIsRunning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const initializedRef = useRef(false);

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
      setErrorBanner(
        err instanceof Error ? `ورود با گوگل ناموفق بود: ${err.message}` : "خطا در ورود گوگل"
      );
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutUser();
  };

  const applyPageProfileToComposer = useCallback((page: PageProfile | null) => {
    if (!page) {
      setSelectedPageId(null);
      return;
    }
    setSelectedPageId(page.id);
    setPlatform(page.platform);
    setContentFormat(page.defaultFormat);
    setPageMaturity(page.pageMaturity);
  }, []);

  const loadStudioInitialData = useCallback(async () => {
    try {
      const [pagesRes, projectsRes] = await Promise.all([
        fetch("/api/pages"),
        fetch("/api/projects"),
      ]);
      const pagesData = await pagesRes.json();
      const projectsData = await projectsRes.json();

      const pageList = (pagesData.pages ?? []) as PageProfile[];
      const projectList = (projectsData.projects ?? []) as ProjectRecord[];

      setPages(pageList);
      setProjects(projectList);

      if (!initializedRef.current) {
        initializedRef.current = true;
        if (pageList[0]) {
          applyPageProfileToComposer(pageList[0]);
        }
        if (projectList[0]) {
          const first = projectList[0];
          setSelectedProjectId(first.id);
          setViewingStage(resolveStageToView(first.currentStage));
          if (first.brief.pageProfileId) {
            const matchedPage = pageList.find((pg) => pg.id === first.brief.pageProfileId);
            if (matchedPage) applyPageProfileToComposer(matchedPage);
          }
          setChatMessages([
            {
              id: `seed_open_${first.id}`,
              role: "assistant",
              metaLabel: "پروژه نمونه آماده بررسی در ۶ مرحله",
              text: `پست «${first.brief.title}» باز است. می‌توانید مراحل ۱ تا ۶ (سناریو، متن اعراب‌گذاری‌شده، شات‌های ۳ تا ۸ ثانیه با ۲ فریم، تایید تک‌به‌تک ویدیوی شات‌ها، کلون صدا و خروجی DaVinci Resolve) را در سمت چپ ببینید یا با دکمه «پست جدید» در بالا موضوع تازه‌ای شروع کنید.`,
            },
          ]);
        }
      }
    } catch {
      setErrorBanner("بارگذاری اطلاعات استودیو با خطا مواجه شد.");
    }
  }, [applyPageProfileToComposer]);

  useEffect(() => {
    void loadStudioInitialData();
  }, [loadStudioInitialData]);

  const upsertProject = (proj: ProjectRecord, switchStage = true) => {
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === proj.id);
      if (exists) return prev.map((p) => (p.id === proj.id ? proj : p));
      return [proj, ...prev];
    });
    setSelectedProjectId(proj.id);
    if (switchStage) {
      setViewingStage(resolveStageToView(proj.currentStage));
    }
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

  const handleOpenProject = (proj: ProjectRecord) => {
    setSelectedProjectId(proj.id);
    setViewingStage(resolveStageToView(proj.currentStage));
    if (proj.brief.pageProfileId) {
      const pg = pages.find((item) => item.id === proj.brief.pageProfileId);
      if (pg) applyPageProfileToComposer(pg);
    }
    setPendingBrief(null);
    setPendingAnalysis(null);
    setChatMessages([
      {
        id: `open_${proj.id}`,
        role: "assistant",
        metaLabel: `${PLATFORM_NAMES[proj.brief.platform] || "پروژه"} · ${
          proj.brief.contentFormat ? FORMAT_NAMES[proj.brief.contentFormat] || "" : ""
        }`,
        text: `پروژه «${proj.brief.title}» باز شد. هر اصلاحی در مرحله فعلی خواستید بنویسید تا ایجنت اعمال کند و به حافظه بلندمدت بسپارد.`,
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

  // Step 0: Propose 3 deeply analyzed viral options tailored to the active Page Profile
  const handleAnalyzeIdea = async (ideaText: string) => {
    setIsAnalyzing(true);
    setErrorBanner(null);

    const activePage = pages.find((p) => p.id === selectedPageId) ?? null;
    const maturityLabel =
      pageMaturity === "new_page" ? "شروع پیج (پست‌های ۱ تا ۵)" : "پیج فعال (۱۰ تا ۲۰+ پست)";

    const brief: ProjectBrief = {
      title: ideaText.split(/[\n.!؟]/)[0]?.trim().slice(0, 80) || "پست تخصصی جدید",
      idea: ideaText,
      pageProfileId: selectedPageId,
      platform,
      contentFormat,
      pageMaturity,
      tone: activePage?.brandTone || "educational",
      targetDurationSeconds:
        contentFormat === "story" ? 20 : contentFormat === "long_video" ? 180 : 35,
    };

    const userMsg: ChatTimelineMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      metaLabel: `${activePage ? `${activePage.name} · ` : ""}${PLATFORM_NAMES[platform] || platform} · ${FORMAT_NAMES[contentFormat] || contentFormat} · ${maturityLabel}`,
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
        throw new Error(data.error || "بررسی موضوع با خطا مواجه شد.");
      }
      const analysis = data.analysis as TopicAnalysisResponse;
      setPendingAnalysis(analysis);

      const assistantMsg: ChatTimelineMessage = {
        id: `a_${Date.now()}`,
        role: "assistant",
        metaLabel: "ابر-ایجنت ۱ (پژوهشگر، استراتژیست و روانشناس سوشال مدیا)",
        text: analysis.strategistSummary,
        analysis,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در تحلیل موضوع");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // User picks 1 of 3 viral angles -> runs Stage 1 (Scenario)
  const handleSelectProposalAndStart = async (proposal: ViralTopicProposal | null) => {
    if (!pendingBrief) return;
    setIsRunning(true);
    setErrorBanner(null);

    const chosenTone = proposal
      ? proposal.recommendedTone
      : pendingAnalysis?.defaultRecommendedTone || pendingBrief.tone;
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

    setChatMessages((prev) => [
      ...prev,
      {
        id: `u_pick_${Date.now()}`,
        role: "user",
        text: proposal
          ? `انتخاب من: «${proposal.title}»`
          : "سناریو را دقیقاً بر اساس موضوع خام خودم بنویس.",
      },
    ]);

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
          text: "مرحله ۱ (سناریوی کامل و چک‌لیست الگوریتم) آماده شد! بررسی کنید و در صورت رضایت تایید کنید تا متن اعراب‌گذاری‌شده گویندگی ساخته شود.",
        },
      ]);
      void syncProjectIfSignedIn(data.project);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در شروع پروژه");
    } finally {
      setIsRunning(false);
    }
  };

  // Autonomous Autopilot: start directly from chosen angle to complete Stage 1-6 + Master MP4
  const handleStartAutopilot = async (proposal: ViralTopicProposal | null) => {
    if (!pendingBrief) return;
    setIsRunning(true);
    setErrorBanner(null);

    const chosenTone = proposal
      ? proposal.recommendedTone
      : pendingAnalysis?.defaultRecommendedTone || pendingBrief.tone;
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
      preferredVideoEngine: "hyperframes_html",
      autonomousMode: true,
    };

    setChatMessages((prev) => [
      ...prev,
      {
        id: `u_auto_${Date.now()}`,
        role: "user",
        text: `اجرای خودکار کامل (Autopilot) روی: «${finalBrief.title}»`,
      },
    ]);

    try {
      const res = await fetch("/api/projects/start-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalBrief),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.project) upsertProject(data.project);
        throw new Error(data.error || "اجرای خودکار پایپ‌لاین با خطا مواجه شد.");
      }
      upsertProject(data.project);
      setPendingBrief(null);
      setPendingAnalysis(null);
      setDraftIdea("");
      setChatMessages((prev) => [
        ...prev,
        {
          id: `a_auto_done_${Date.now()}`,
          role: "assistant",
          text: "تولید خودکار مراحل ۱ تا ۶ به همراه بازبینی بینایی و مونتاژ MP4 نهایی تکمیل شد!",
        },
      ]);
      void syncProjectIfSignedIn(data.project);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در اجرای خودکار پروژه");
    } finally {
      setIsRunning(false);
    }
  };

  // Run Autopilot on an existing active project to finish all remaining stages to Stage 6
  const handleRunProjectAutopilot = async () => {
    if (!activeProject) return;
    setIsRunning(true);
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/autopilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferredVideoEngine: activeProject.brief.preferredVideoEngine || "hyperframes_html",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.project) upsertProject(data.project);
        throw new Error(data.error || "تکمیل خودکار پروژه ناموفق بود.");
      }
      upsertProject(data.project);
      void syncProjectIfSignedIn(data.project);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `a_auto_cont_${Date.now()}`,
          role: "assistant",
          text: "تمام مراحل باقی‌مانده به صورت خودکار اجرا، بازبینی و در مرحله ۶ نهایی شدند.",
        },
      ]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در تکمیل خودکار پروژه");
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
    narration?: NarrationScriptOutput;
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
        throw new Error(data.error || "ادامه پایپ‌لاین با خطا مواجه شد.");
      }
      const nextProj = data.project as ProjectRecord;
      upsertProject(nextProj);
      void syncProjectIfSignedIn(nextProj);

      if (payload.action === "approve") {
        const msgByStage: Partial<Record<PipelineStage, string>> = {
          narration:
            "مرحله ۲ (متن گویندگی با اعراب‌گذاری دقیق فارسی و راهنمای فن بیان) آماده بررسی شماست.",
          director:
            "مرحله ۳ (دکوپاژ شات‌های ۳ تا ۸ ثانیه‌ای + ۲ فریم پیش‌نمایش برای هر شات) آماده شد.",
          shot_videos:
            "مرحله ۴ فعال شد: هر شات را رندر کنید، ببینید و تک‌به‌تک تایید کنید تا شات بعدی باز شود.",
          voiceover:
            "مرحله ۵ (تولید صدای گوینده با رعایت اعراب و لحن پروفایل پیج) آماده شنیدن است.",
          davinci:
            "مرحله ۶ آماده است! فایل اتوماسیون DaVinci Resolve (.fcpxml + اسکریپت پایتون + زیرنویس SRT) و مونتاژ MP4 نهایی در دسترس شماست.",
          completed: "تبریک! پست تخصصی شما در هر ۶ مرحله تکمیل و در مغز دوم (Vault) آرشیو شد.",
        };
        const text = msgByStage[nextProj.currentStage];
        if (text) {
          setChatMessages((prev) => [
            ...prev,
            { id: `a_adv_${Date.now()}`, role: "assistant", text },
          ]);
        }
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در اجرای مرحله");
    } finally {
      setIsRunning(false);
    }
  };

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
        text: "نسخه اصلاح‌شده آماده شد و این نکته در حافظه بلندمدت ایجنت ذخیره گردید تا در پست‌های بعدی هم رعایت شود.",
      },
    ]);
  };

  // Stage 3: Regenerate the 2 storyboard preview frames of a single 3-8s shot
  const handleRegenerateSingleShotFrames = async (
    shotNumber: number,
    updatedPrompt?: string,
    feedback?: string
  ) => {
    if (!activeProject) return;
    setErrorBanner(null);
    try {
      const res = await fetch(
        `/api/projects/${activeProject.id}/shots/${shotNumber}/regenerate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updatedPrompt, feedback }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "بازتولید ۲ فریم شات ناموفق بود.");
      if (data.project) {
        upsertProject(data.project, false);
        void syncProjectIfSignedIn(data.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در بازتولید فریم‌های شات");
    }
  };

  // Stage 4: Render playable MP4 for a single 3-8s shot
  const handleRenderShotVideo = async (
    shotNumber: number,
    revisionNote?: string,
    engineId?: LocalVideoEngineId
  ) => {
    if (!activeProject) return;
    setErrorBanner(null);
    try {
      const res = await fetch(
        `/api/projects/${activeProject.id}/shots/${shotNumber}/render-video`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revisionNote, engineId }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "رندر ویدیوی شات ناموفق بود.");
      if (data.project) {
        upsertProject(data.project, false);
        void syncProjectIfSignedIn(data.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در ساخت ویدیوی شات");
    }
  };

  // Stage 4: Render & QA-verify all shots in batch
  const handleRenderAllShots = async (engineId: LocalVideoEngineId) => {
    if (!activeProject) return;
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/shots/render-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineId, autoApprove: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "رندر دسته‌جمعی شات‌ها ناموفق بود.");
      if (data.project) {
        upsertProject(data.project, false);
        void syncProjectIfSignedIn(data.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در رندر خودکار همه شات‌ها");
    }
  };

  // Stage 4: Approve or mark needs_revision for a single shot video
  const handleApproveShotVideo = async (
    shotNumber: number,
    status: ShotVideoApprovalStatus,
    revisionNote?: string
  ) => {
    if (!activeProject) return;
    setErrorBanner(null);
    try {
      const res = await fetch(
        `/api/projects/${activeProject.id}/shots/${shotNumber}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, revisionNote }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ثبت وضعیت شات ناموفق بود.");
      if (data.project) {
        upsertProject(data.project, false);
        void syncProjectIfSignedIn(data.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در تایید شات");
    }
  };

  // Stage 5: Re-synthesize WAV voiceover
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
        upsertProject(data.project, false);
        void syncProjectIfSignedIn(data.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در تولید صدا");
    }
  };

  // Stage 6: Assemble playable Master MP4
  const handleAssembleMasterMp4 = async () => {
    if (!activeProject) return;
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/davinci/assemble-master`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "مونتاژ ویدیوی نهایی ناموفق بود.");
      if (data.project) {
        upsertProject(data.project, false);
        void syncProjectIfSignedIn(data.project);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "خطا در مونتاژ ویدیوی نهایی");
    }
  };

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
      lines.push(`## ۱. سناریو (${proj.researchScript.videoTitle})`);
      lines.push(`### قلاب (Hook)`, proj.researchScript.hook, "");
      lines.push(`### بدنه`, proj.researchScript.body, "");
      lines.push(`### دعوت به اقدام (CTA)`, proj.researchScript.cta, "");
    }
    if (proj.narration) {
      lines.push(`## ۲. متن گویندگی اعراب‌گذاری‌شده`);
      lines.push(proj.narration.vocalizedNarrationText, "");
    }
    if (proj.director) {
      lines.push(`## ۳. دکوپاژ شات‌های ۳ تا ۸ ثانیه`);
      for (const s of proj.director.shots) {
        lines.push(
          `### شات ${s.shotNumber} (${s.timecode} · ${s.durationSeconds} ثانیه)`,
          `- **دوربین:** ${s.cameraAngle} — ${s.cameraMovement}`,
          `- **متن روی تصویر:** ${s.onScreenText}`,
          `- **گفتار:** ${s.spokenSegment}`,
          `- **فریم شروع:** ${s.startFrameDescriptionFa || s.sceneDescriptionFa}`,
          `- **فریم اوج:** ${s.endFrameDescriptionFa || ""}`,
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
    if (stage === "narration") return Boolean(activeProject.narration);
    if (stage === "director") return Boolean(activeProject.director);
    if (stage === "shot_videos") return Boolean(activeProject.director);
    if (stage === "voiceover") return Boolean(activeProject.voiceover);
    if (stage === "davinci") return Boolean(activeProject.davinciPackage);
    return false;
  };

  const currentPlatformKey =
    platform === "reels" ? "instagram" : platform === "shorts" ? "youtube" : platform;
  const activeFormatLabel =
    FORMATS_BY_PLATFORM[currentPlatformKey]?.find((f) => f.id === contentFormat)?.label || "ریلز";

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-[#0B0D11] text-slate-100">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[#262B38] bg-[#0B0D11]/95 px-4 py-3.5 backdrop-blur-sm sm:gap-6 sm:px-6">
        <button
          type="button"
          onClick={() => setActiveTab("workspace")}
          className="text-base font-bold tracking-tight text-slate-100 transition-colors hover:text-amber-400 whitespace-nowrap shrink-0"
        >
          استودیو محتوا
        </button>

        <nav className="flex min-w-0 flex-1 items-center justify-center gap-5 overflow-x-auto text-xs font-medium text-slate-400 sm:gap-6">
          {[
            { id: "workspace", label: "میز کار تولید" },
            { id: "pages", label: "پروفایل پیج‌ها" },
            { id: "viral", label: "رادار رقبا و وایرال" },
            { id: "vault", label: "مغز دوم (Vault)" },
            { id: "router", label: "پروژه‌ها و روتر رایگان" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as AppTab)}
              className={`border-b-2 py-1 whitespace-nowrap shrink-0 transition-colors ${
                activeTab === tab.id
                  ? "border-amber-500 text-slate-100 font-semibold"
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
          <span>پست جدید</span>
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
              className="text-red-300 underline hover:text-white whitespace-nowrap shrink-0"
            >
              بستن
            </button>
          </div>
        )}

        {activeTab === "pages" ? (
          <PageProfilesView
            pages={pages}
            activePageId={selectedPageId}
            onSelectPageForProduction={(page) => {
              applyPageProfileToComposer(page);
              handleStartNewProject();
            }}
            onRefreshPages={(updated) => setPages(updated)}
          />
        ) : activeTab === "viral" ? (
          <ViralCompetitorRadarView
            pages={pages}
            activePageId={selectedPageId}
            onUseViralPatternAsIdea={(ideaText, pageId) => {
              if (pageId) {
                const matched = pages.find((p) => p.id === pageId) ?? null;
                if (matched) applyPageProfileToComposer(matched);
              }
              handleStartNewProject();
              setDraftIdea(ideaText);
            }}
          />
        ) : activeTab === "vault" ? (
          <VaultSecondBrainView pages={pages} />
        ) : activeTab === "router" ? (
          <RouterSettingsView
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
        ) : (
          /* Two-Pane Production Workspace: Right = Page & Topic Assistant, Left = 6-Stage Canvas */
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            {/* RIGHT PANE (first in RTL grid) */}
            <div className="min-w-0 lg:sticky lg:top-20 lg:col-span-4">
              <GuidedStudioChat
                pages={pages}
                selectedPageId={selectedPageId}
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
                onSelectPageProfile={applyPageProfileToComposer}
                onManagePages={() => setActiveTab("pages")}
                onChangePlatform={setPlatform}
                onChangeFormat={setContentFormat}
                onChangePageMaturity={setPageMaturity}
                onAnalyzeIdea={handleAnalyzeIdea}
                onSelectProposalAndStart={handleSelectProposalAndStart}
                onStartAutopilotFromProposal={handleStartAutopilot}
                onSendStageFeedback={handleSendStageFeedback}
              />
            </div>

            {/* LEFT PANE (second in RTL grid): 6-Step Studio Pipeline */}
            <div className="min-w-0 space-y-5 lg:col-span-8">
              {/* 6-Stage Horizontal Progress Strip */}
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#262B38] bg-[#14171F] p-2 sm:grid-cols-3 xl:grid-cols-6">
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
                      className={`flex flex-col items-start justify-center rounded-xl px-3 py-2 text-right transition-colors ${
                        isViewing
                          ? "bg-amber-500 text-slate-950"
                          : accessible
                            ? "bg-[#0B0D11]/60 text-slate-200 hover:bg-[#1B1F2A]"
                            : "cursor-not-allowed text-slate-500 opacity-60"
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-1 text-[10px]">
                        <span className={isViewing ? "font-semibold text-slate-900" : "text-slate-400"}>
                          {step.agentLabel}
                        </span>
                        {isDone && !isViewing ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        ) : isPausedHere && !isViewing ? (
                          <PauseCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        ) : !isViewing ? (
                          <Clock className="h-3 w-3 shrink-0 opacity-50" />
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-xs font-bold">
                        {step.num}. {step.label}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Left Canvas Body */}
              {isRunning && !activeProject ? (
                <div className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-8">
                  <div className="flex items-center gap-3 text-sm font-semibold text-amber-400">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                    <span>ایجنت سناریونویس در حال پژوهش در وب و نگارش سناریوی تخصصی شماست...</span>
                  </div>
                  <div className="h-44 animate-pulse rounded-xl bg-[#1B1F2A]" />
                  <div className="h-44 animate-pulse rounded-xl bg-[#1B1F2A]" />
                </div>
              ) : !activeProject && pendingAnalysis ? (
                /* Deep Comparison View of the 3 Viral Proposals */
                <div className="space-y-6 rounded-2xl border border-[#262B38] bg-[#14171F] p-6">
                  <div className="border-b border-[#262B38] pb-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-amber-400">
                      <span>تحلیل ۳۶۰ درجه ابر-ایجنت سناریونویس</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {PLATFORM_NAMES[platform]} ({activeFormatLabel})
                      </span>
                    </div>
                    <h2 className="mt-1 text-lg font-bold text-slate-100">
                      مقایسه ۳ گزینه برتر پیشنهادی (ارزش محتوا، قلاب، روانشناسی و استراتژی)
                    </h2>
                  </div>

                  {(pendingAnalysis.keywordDomainAnalysis ||
                    pendingAnalysis.exactTargetAudience ||
                    pendingAnalysis.pageStrategyRecommendation) && (
                    <div className="grid grid-cols-1 gap-4 border-b border-[#262B38] pb-5 text-xs leading-6 md:grid-cols-3">
                      {pendingAnalysis.keywordDomainAnalysis && (
                        <div>
                          <div className="mb-1 font-semibold text-amber-300">حوزه و بازار واقعی</div>
                          <p className="text-slate-300">{pendingAnalysis.keywordDomainAnalysis}</p>
                        </div>
                      )}
                      {pendingAnalysis.exactTargetAudience && (
                        <div>
                          <div className="mb-1 font-semibold text-emerald-300">پرسونای دقیق مخاطب</div>
                          <p className="text-slate-300">{pendingAnalysis.exactTargetAudience}</p>
                        </div>
                      )}
                      {pendingAnalysis.pageStrategyRecommendation && (
                        <div>
                          <div className="mb-1 font-semibold text-sky-300">استراتژی رشد پیج</div>
                          <p className="text-slate-300">{pendingAnalysis.pageStrategyRecommendation}</p>
                        </div>
                      )}
                    </div>
                  )}

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
                            {prop.contentValueScoreNote && (
                              <p className="text-xs text-emerald-300">
                                ارزش محتوا و جذب مخاطب: {prop.contentValueScoreNote}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={isRunning}
                              onClick={() => handleSelectProposalAndStart(prop)}
                              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              انتخاب و نگارش سناریوی کامل
                            </button>
                            <button
                              type="button"
                              disabled={isRunning}
                              onClick={() => handleStartAutopilot(prop)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              <Zap className="h-3.5 w-3.5" />
                              <span>تولید خودکار تا ریلز نهایی</span>
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 border-t border-[#262B38]/60 pt-3 text-xs leading-6 md:grid-cols-2">
                          <div>
                            <div className="font-semibold text-amber-300">قلاب کلامی ۳ ثانیه اول</div>
                            <p className="mt-0.5 text-slate-200">«{prop.sampleHook}»</p>
                          </div>
                          {prop.openingVisualHook && (
                            <div>
                              <div className="font-semibold text-slate-200">تصویر شروع (توقف اسکرول)</div>
                              <p className="mt-0.5 text-slate-300">{prop.openingVisualHook}</p>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 gap-4 border-t border-[#262B38]/60 pt-3 text-xs leading-6 text-slate-300 md:grid-cols-3">
                          <div>
                            <div className="mb-1 font-semibold text-slate-100">استراتژی پیج</div>
                            <p>{prop.strategistAngle}</p>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold text-slate-100">روانشناسی مخاطب</div>
                            <p>{prop.psychologyTrigger}</p>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold text-slate-100">اجرای بصری و تدوین</div>
                            <p>{prop.creatorExecutionTip}</p>
                          </div>
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
                /* Clean Guided Empty State when starting a brand-new post */
                <div className="space-y-6 rounded-2xl border border-[#262B38] bg-[#14171F] p-8">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-400">
                      <Sparkles className="h-4 w-4" />
                      <span>خط تولید ۶ مرحله‌ای بدون نیاز به تجربه قبلی تدوین یا گویندگی</span>
                    </div>
                    <h1 className="text-xl font-bold text-slate-100">
                      از موضوع خام تا ویدیوی آماده انتشار و پروژه DaVinci Resolve — ۱۰۰٪ رایگان
                    </h1>
                    <p className="text-xs leading-7 text-slate-400">
                      پروفایل پیج خود را در ستون سمت راست انتخاب کنید و موضوع امروز را بنویسید.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-xl border border-[#262B38] bg-[#0B0D11]/60 p-4">
                      <div className="text-xs font-bold text-amber-400">۱. ۳ پیشنهاد وایرال و سناریو</div>
                      <p className="mt-1.5 text-xs leading-6 text-slate-300">
                        تحلیل ارزش محتوا، قلاب ۳ ثانیه اول، روانشناسی مخاطب و رعایت خطوط قرمز الگوریتم.
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#262B38] bg-[#0B0D11]/60 p-4">
                      <div className="text-xs font-bold text-amber-400">۲. اعراب‌گذاری و کلون صدای شما</div>
                      <p className="mt-1.5 text-xs leading-6 text-slate-300">
                        نگارش متن گویندگی با کسره و حرکات دقیق فارسی + تولید صدا با لحن اختصاصی هر پیج.
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#262B38] bg-[#0B0D11]/60 p-4">
                      <div className="text-xs font-bold text-amber-400">
                        ۳. شات‌های ۳ تا ۸ ثانیه + DaVinci
                      </div>
                      <p className="mt-1.5 text-xs leading-6 text-slate-300">
                        ۲ فریم پیش‌نمایش و تایید ویدیوی تک‌تک شات‌ها + خروجی خودکار DaVinci Resolve رایگان.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                /* Active Project 6-Stage Canvas */
                <div className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-6">
                  {activeProject.currentStage !== "completed" &&
                    activeProject.currentStage !== "davinci" && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#262B38] bg-[#0B0D11]/70 px-4 py-3 text-xs">
                        <div className="min-w-0 text-slate-300">
                          <span className="font-semibold text-slate-100">
                            {activeProject.brief.title}
                          </span>
                          <span aria-hidden="true" className="mx-2 text-slate-600">
                            ·
                          </span>
                          <span className="text-slate-400">
                            می‌توانید گام‌به‌گام تایید کنید یا کل مراحل را تا ریلز نهایی خودکار بسازید
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={isRunning}
                          onClick={() => void handleRunProjectAutopilot()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          <Zap className="h-3.5 w-3.5" />
                          <span>
                            {isRunning
                              ? "در حال اجرای خودکار و بازبینی..."
                              : "تکمیل خودکار تا ریلز نهایی (Autopilot)"}
                          </span>
                        </button>
                      </div>
                    )}

                  {viewingStage === "research_script" && activeProject.researchScript && (
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
                  )}

                  {viewingStage === "narration" && activeProject.narration && (
                    <StageNarration
                      data={activeProject.narration}
                      isRunning={isRunning}
                      isCurrentGate={activeProject.currentStage === "narration"}
                      onSaveEdits={(updated) => handleSaveInline({ narration: updated })}
                      onApprove={(updated) =>
                        handleResumeCheckpoint({ action: "approve", narration: updated })
                      }
                      onRegenerate={(feedback) =>
                        handleResumeCheckpoint({ action: "regenerate", feedback })
                      }
                    />
                  )}

                  {viewingStage === "director" && activeProject.director && (
                    <StageDirector
                      data={activeProject.director}
                      visuals={activeProject.visuals}
                      isRunning={isRunning}
                      isCurrentGate={activeProject.currentStage === "director"}
                      onSaveEdits={(updated) => handleSaveInline({ director: updated })}
                      onRegenerateSingleShotFrames={handleRegenerateSingleShotFrames}
                      onApprove={(updated) =>
                        handleResumeCheckpoint({ action: "approve", director: updated })
                      }
                      onRegenerate={(feedback) =>
                        handleResumeCheckpoint({ action: "regenerate", feedback })
                      }
                    />
                  )}

                  {viewingStage === "shot_videos" && activeProject.director && (
                    <StageShotVideos
                      director={activeProject.director}
                      visuals={activeProject.visuals}
                      shotClips={activeProject.shotClips ?? []}
                      preferredEngine={activeProject.brief.preferredVideoEngine}
                      isRunning={isRunning}
                      onRenderShotVideo={handleRenderShotVideo}
                      onRenderAllShots={handleRenderAllShots}
                      onApproveShotVideo={handleApproveShotVideo}
                      onAdvanceToVoiceover={() => handleResumeCheckpoint({ action: "approve" })}
                    />
                  )}

                  {viewingStage === "voiceover" && activeProject.voiceover && (
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
                  )}

                  {viewingStage === "davinci" && activeProject.davinciPackage && (
                    <StageDaVinciResolve
                      project={activeProject}
                      pkg={activeProject.davinciPackage}
                      isRunning={isRunning}
                      onAssembleMasterMp4={handleAssembleMasterMp4}
                      onCompleteProject={() => handleResumeCheckpoint({ action: "approve" })}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
