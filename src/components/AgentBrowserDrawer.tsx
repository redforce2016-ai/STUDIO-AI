import React, { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Compass,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Film,
  Globe,
  KeyRound,
  Loader2,
  MousePointerClick,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wand2,
  X,
} from "lucide-react";
import type {
  AgentBrowserCommandType,
  AgentBrowserState,
  ProjectRecord,
  WebStudioGenerationMode,
  WebStudioModelOption,
  WebStudioSiteConfig,
  WebStudioSiteId,
} from "../types/studio";

interface AgentBrowserDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  browserState: AgentBrowserState | null;
  activeProject: ProjectRecord | null;
  isExecutingCommand: boolean;
  onDispatchCommand: (
    command: AgentBrowserCommandType,
    target: string,
    agentName?: string
  ) => Promise<void>;
  onAddProfile: (input: {
    name: string;
    email: string;
    password?: string;
    dailyLimit: number;
  }) => Promise<void>;
  onSwitchProfile: (profileId: string) => Promise<void>;
  onResetQuota: (profileId?: string) => Promise<void>;
  onUpdateSiteConfig: (patch: Partial<WebStudioSiteConfig>) => Promise<void>;
  onGenerateStudioShot: (params: {
    rawPrompt: string;
    projectId?: string | null;
    shotNumber?: number | null;
    siteId: WebStudioSiteId;
    mode: WebStudioGenerationMode;
    modelId: WebStudioModelOption;
    aspectRatio: "9:16" | "16:9" | "1:1";
    resolution: "720p" | "1080p";
  }) => Promise<void>;
  onClearBrowser: () => Promise<void>;
  onRefreshState: () => Promise<void>;
  onApplyExtractedToIdea?: (extractedText: string) => void;
}

const SITE_MODELS_MAP: Record<
  WebStudioSiteId,
  Array<{ id: WebStudioModelOption; labelFa: string }>
> = {
  google_flow: [
    { id: "veo_2", labelFa: "Google Veo 2 (ویدیو سینمایی)" },
    { id: "omni_flash", labelFa: "Gemini Omni Flash (ویدیو سریع)" },
    { id: "imagen_3", labelFa: "Google Imagen 3 (تصویر کلیدی دقیق)" },
  ],
  molab: [
    { id: "molab_wan22_gpu", labelFa: "Molab GPU · Wan 2.2 I2V 14B (FP8)" },
    { id: "molab_ltx23_gpu", labelFa: "Molab GPU · LTX-Video 2.3 (سریع)" },
  ],
  google_colab: [
    { id: "colab_wan22_gguf", labelFa: "Colab T4 GPU · Wan 2.2 5B (GGUF)" },
    { id: "colab_ltx23_gpu", labelFa: "Colab GPU · LTX-Video (سریع)" },
  ],
  leonardo_ai: [
    { id: "leonardo_phoenix", labelFa: "Leonardo Phoenix 1.0 (تصویر حرفه‌ای)" },
    { id: "leonardo_kino_xl", labelFa: "Leonardo Kino XL (سینمایی)" },
    { id: "leonardo_motion", labelFa: "Leonardo Motion 2.0 (متحرک‌سازی)" },
  ],
  kling_web: [
    { id: "kling_1_6", labelFa: "Kling 1.6 Pro (ویدیو واقع‌گرایانه)" },
  ],
  runway_web: [
    { id: "runway_gen3_turbo", labelFa: "Runway Gen-3 Alpha Turbo" },
  ],
  general_web: [{ id: "imagen_3", labelFa: "پیش‌فرض" }],
};

export const AgentBrowserDrawer: React.FC<AgentBrowserDrawerProps> = ({
  isOpen,
  onClose,
  browserState,
  activeProject,
  isExecutingCommand,
  onDispatchCommand,
  onAddProfile,
  onSwitchProfile,
  onResetQuota,
  onUpdateSiteConfig,
  onGenerateStudioShot,
  onClearBrowser,
  onRefreshState,
  onApplyExtractedToIdea,
}) => {
  const [selectedCommand, setSelectedCommand] =
    useState<AgentBrowserCommandType>("mission");
  const [commandTarget, setCommandTarget] = useState("");
  const [activeTab, setActiveTab] = useState<
    "studio_accounts" | "viewport" | "extracted" | "logs"
  >("studio_accounts");
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Add Google Profile form state
  const [showAddProfileForm, setShowAddProfileForm] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileEmail, setNewProfileEmail] = useState("");
  const [newProfilePassword, setNewProfilePassword] = useState("");
  const [newProfileLimit, setNewProfileLimit] = useState(5);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [copiedCredId, setCopiedCredId] = useState<string | null>(null);

  // Studio Shot Generation state
  const [shotPrompt, setShotPrompt] = useState(
    "نمای نزدیک سینمایی از لوله فولادی بدون درز مانیسمان رده ۸۰ در پالایشگاه نفت با نورپردازی صنعتی و حرکت آرام دوربین به جلو"
  );
  const [selectedShotNumber, setSelectedShotNumber] = useState<number | "">("");

  if (!isOpen) {
    return null;
  }

  const state: AgentBrowserState = browserState || {
    engineName: "vercel-labs/agent-browser v0.43 + LangGraph (10 Gmail Profiles)",
    playwrightConnected: true,
    status: "idle",
    activeAgent: null,
    currentCommand: null,
    currentUrl: "https://labs.google/fx/tools/flow",
    pageTitle: "Google Flow Studio",
    viewportSvgUrl: null,
    viewportScreenshotUrl: null,
    scrollY: 0,
    maxScrollY: 0,
    searchQuery: "",
    searchResults: [],
    extractedPage: null,
    comprehensionSummaryFa: "",
    comprehensionFactsFa: [],
    profiles: [],
    activeProfileId: "prof_google_1",
    siteConfig: {
      siteId: "google_flow",
      siteLabelFa: "Google Flow / LabsFX (گوگل فلو)",
      targetUrl: "https://labs.google/fx/tools/flow",
      mode: "image_to_video",
      modelId: "veo_2",
      modelLabelFa: "Google Veo 2 (ویدیو سینمایی)",
      aspectRatio: "9:16",
      resolution: "1080p",
      durationSeconds: 5,
      cfgScaleOrCreativity: 7,
      autoSolveCloudflareAndCaptcha: true,
      autoRotateProfileOnQuota: true,
    },
    lastRefinedPrompt: null,
    obstacleHistory: [],
    shotJobs: [],
    history: [],
    actionLog: [],
    updatedAt: new Date().toISOString(),
  };

  const isBusy =
    isExecutingCommand ||
    state.status === "browsing" ||
    state.status === "extracting" ||
    state.status === "generating_media" ||
    state.status === "solving_obstacle";

  const activeProfile =
    state.profiles.find((p) => p.id === state.activeProfileId) ||
    state.profiles[0];

  const availableModels =
    SITE_MODELS_MAP[state.siteConfig.siteId] || SITE_MODELS_MAP.google_flow;

  const handleRunCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !commandTarget.trim() &&
      selectedCommand !== "extract" &&
      selectedCommand !== "solve_obstacles" &&
      selectedCommand !== "snapshot" &&
      selectedCommand !== "register"
    ) {
      return;
    }
    await onDispatchCommand(
      selectedCommand,
      commandTarget.trim(),
      "vercel-labs/agent-browser"
    );
  };

  const handleAddProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileEmail.trim()) return;
    await onAddProfile({
      name: newProfileName.trim() || newProfileEmail.trim(),
      email: newProfileEmail.trim(),
      password: newProfilePassword.trim() || undefined,
      dailyLimit: Number(newProfileLimit) || 5,
    });
    setNewProfileName("");
    setNewProfileEmail("");
    setNewProfilePassword("");
    setShowAddProfileForm(false);
  };

  const handleSelectProjectShot = (shotNumStr: string) => {
    if (!shotNumStr) {
      setSelectedShotNumber("");
      return;
    }
    const num = Number(shotNumStr);
    setSelectedShotNumber(num);
    const directorShot = activeProject?.director?.shots.find(
      (s) => s.shotNumber === num
    );
    if (directorShot) {
      setShotPrompt(
        directorShot.visualPromptFa || directorShot.sceneDescriptionFa
      );
    }
  };

  const handleCopyComprehension = async () => {
    const textToCopy = [
      state.comprehensionSummaryFa,
      state.comprehensionFactsFa.length > 0
        ? `\nنکات و داده‌های کلیدی:\n${state.comprehensionFactsFa
            .map((f, i) => `${i + 1}. ${f}`)
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (!textToCopy) return;
    await navigator.clipboard.writeText(textToCopy);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 1800);
  };

  const handleSendToIdea = () => {
    if (!onApplyExtractedToIdea) return;
    const payload = [
      `موضوع استخراج‌شده از وب (${state.pageTitle}):`,
      state.comprehensionSummaryFa,
      state.comprehensionFactsFa.length > 0
        ? `نکات فنی و فکت‌های معتبر:\n${state.comprehensionFactsFa
            .slice(0, 5)
            .map((f) => `- ${f}`)
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    onApplyExtractedToIdea(payload);
    onClose();
  };

  const placeholderByCommand: Record<AgentBrowserCommandType, string> = {
    mission:
      "موضوع تحقیق وب را بنویسید (مثلاً: استاندارد لوله مانیسمان رده ۸۰ و کاربرد در پتروشیمی)...",
    search: "عبارت جستجو در وب را وارد کنید...",
    goto: "آدرس کامل صفحه وب را وارد کنید (مثلاً https://labs.google/fx/tools/flow)...",
    snapshot: "اختیاری (اسنپ‌شات درخت دسترسی @eN از صفحه فعلی می‌گیرد)...",
    click: "رف عنصر (@e1 یا @e3) یا شماره لینک (1) یا متن دکمه...",
    fill: "فرمت پر کردن فرم: @e2=متن ورودی (مثلاً @e2=hello world)...",
    select: "فرمت انتخاب کشویی: @e4=گزینه موردنظر...",
    register: "آدرس صفحه ثبت‌نام/ورود (یا خالی بگذارید تا روی صفحه فعلی انجام شود)...",
    scroll: "جهت اسکرول (down, up, top, bottom)...",
    extract: "کلمه کلیدی اختیاری برای فیلتر محتوای صفحه فعلی...",
    comprehend: "موضوع تحلیل و درک محتوا...",
    solve_obstacles: "بررسی و عبور از Cloudflare Turnstile و I'm not a robot...",
    switch_profile: "شناسه پروفایل گوگل (مثلاً prof_google_2)...",
    refine_prompt: "پرامپت خام شات برای نهایی‌سازی و قفل کردن...",
    studio_generate: "پرامپت تولید عکس یا ویدیو در سایت انتخابی...",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-label="پنجره کشویی مرورگر مخفی ایجنت"
    >
      {/* Backdrop click area */}
      <div className="flex-1" onClick={onClose} />

      {/* Slide-over panel */}
      <aside className="flex h-full w-full max-w-4xl flex-col border-r border-[#262B38] bg-[#0B0E14] text-slate-100 shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-[#222734] bg-[#11151F] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
              <Globe className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-sm font-bold text-white">
                  مرورگر کرومیوم ایجنت (vercel-labs/agent-browser + LangGraph)
                </h2>
                <span
                  className={`text-[11px] font-semibold ${
                    isBusy
                      ? "text-amber-400"
                      : state.status === "error"
                        ? "text-rose-400"
                        : "text-emerald-400"
                  }`}
                >
                  {isBusy
                    ? `● در حال اجرا (${state.activeAgent || "ایجنت"})`
                    : state.status === "error"
                      ? "● خطا در آخرین دستور"
                      : `● متصل به کرومیوم CDP (${activeProfile?.email || "اکانت گوگل"})`}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">
                مبتنی بر مخزن متن‌باز <span className="font-mono text-slate-300">vercel-labs/agent-browser</span> با درخت دسترسی <span className="font-mono text-amber-300">@eN</span>، ثبت‌نام/پرکردن فرم و چرخش خودکار ۱۰ اکانت جیمیل.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onRefreshState()}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2A3040] bg-[#161B26] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`}
              />
              بروزرسانی
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2A3040] bg-[#161B26] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-200 whitespace-nowrap shrink-0"
            >
              <X className="h-3.5 w-3.5" />
              پنهان کردن مرورگر
            </button>
          </div>
        </div>

        {/* Browser Address Bar & Programmatic Command Console */}
        <div className="border-b border-[#222734] bg-[#0F131C] px-5 py-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#232938] bg-[#090C12] px-3 py-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Compass className="h-4 w-4 shrink-0 text-sky-400" />
              <span className="text-[11px] font-semibold text-slate-400 shrink-0">
                آدرس فعال کرومیوم:
              </span>
              <span
                dir="ltr"
                className="truncate font-mono text-xs text-sky-300"
                title={state.currentUrl}
              >
                {state.currentUrl}
              </span>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono tabular-nums shrink-0">
              <span className="text-emerald-400">
                اکانت: {activeProfile?.email} (
                {activeProfile?.usedToday ?? 0}/{activeProfile?.dailyLimit ?? 5})
              </span>
              <span>|</span>
              <span>مدل: {state.siteConfig.modelLabelFa}</span>
            </div>
          </div>

          <form
            onSubmit={handleRunCommand}
            className="flex flex-wrap items-center gap-2"
          >
            <select
              value={selectedCommand}
              onChange={(e) =>
                setSelectedCommand(e.target.value as AgentBrowserCommandType)
              }
              aria-label="نوع دستور برنامه‌نویسی مرورگر"
              className="rounded-lg border border-[#2A3142] bg-[#141925] px-3 py-2 text-xs font-semibold text-amber-300 focus:border-amber-500 focus:outline-none"
            >
              <option value="mission">
                ماموریت کامل وب‌گردی ایجنت (MISSION)
              </option>
              <option value="studio_generate">
                ورود به سایت و ساخت شات (STUDIO_GENERATE)
              </option>
              <option value="register">
                ثبت‌نام / ورود خودکار در سایت (REGISTER)
              </option>
              <option value="snapshot">
                اسنپ‌شات عناصر تعاملی @eN (SNAPSHOT)
              </option>
              <option value="fill">
                پر کردن فیلد فرم با @eN (FILL)
              </option>
              <option value="select">
                انتخاب گزینه کشویی با @eN (SELECT)
              </option>
              <option value="refine_prompt">
                نهایی‌سازی و قفل پرامپت (REFINE_PROMPT)
              </option>
              <option value="solve_obstacles">
                عبور از Cloudflare و کپچا (SOLVE_OBSTACLES)
              </option>
              <option value="search">جستجو در موتورهای وب (SEARCH)</option>
              <option value="goto">باز کردن مستقیم آدرس وب (GOTO)</option>
              <option value="click">کلیک واقعی روی @eN یا لینک (CLICK)</option>
              <option value="extract">
                استخراج و درک محتوای صفحه (EXTRACT)
              </option>
            </select>

            <input
              type="text"
              value={commandTarget}
              onChange={(e) => setCommandTarget(e.target.value)}
              placeholder={placeholderByCommand[selectedCommand]}
              className="min-w-[220px] flex-1 rounded-lg border border-[#2A3142] bg-[#0B0E14] px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />

            <button
              type="submit"
              disabled={
                isBusy ||
                (!commandTarget.trim() &&
                  selectedCommand !== "extract" &&
                  selectedCommand !== "solve_obstacles" &&
                  selectedCommand !== "snapshot" &&
                  selectedCommand !== "register")
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              اجرای دستور در مرورگر
            </button>
          </form>
        </div>

        {/* Navigation Tabs inside Drawer */}
        <div className="flex flex-wrap items-center justify-between border-b border-[#222734] bg-[#11151F] px-5">
          <div className="flex items-center gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab("studio_accounts")}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-bold transition whitespace-nowrap shrink-0 ${
                activeTab === "studio_accounts"
                  ? "border-amber-400 text-amber-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              گوگل فلو، لئوناردو و چرخش اکانت‌ها (
              <span className="font-mono tabular-nums">
                {state.profiles.length}
              </span>
              )
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("viewport")}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-bold transition whitespace-nowrap shrink-0 ${
                activeTab === "viewport"
                  ? "border-sky-400 text-sky-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              نمای زنده کرومیوم و ضدکپچا
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("extracted")}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-bold transition whitespace-nowrap shrink-0 ${
                activeTab === "extracted"
                  ? "border-emerald-400 text-emerald-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              درک محتوا و فکت‌ها (
              <span className="font-mono tabular-nums">
                {state.comprehensionFactsFa.length}
              </span>
              )
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-bold transition whitespace-nowrap shrink-0 ${
                activeTab === "logs"
                  ? "border-purple-400 text-purple-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              گزارش دستورات ایجنت (
              <span className="font-mono tabular-nums">
                {state.actionLog.length}
              </span>
              )
            </button>
          </div>

          {onApplyExtractedToIdea && state.comprehensionSummaryFa && (
            <button
              type="button"
              onClick={handleSendToIdea}
              className="my-1.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-500/30 whitespace-nowrap shrink-0"
            >
              افزودن یافته‌ها به ایده استودیو
            </button>
          )}
        </div>

        {/* Main Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {activeTab === "studio_accounts" && (
            <div className="space-y-5">
              {/* Section 1: Multi-Account Google Profile Pool & Daily Quota Tracker */}
              <div className="rounded-xl border border-[#242B3D] bg-[#10141F] p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2536] pb-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-emerald-400" />
                    <div>
                      <h3 className="text-xs font-bold text-white">
                        اکانت‌های گوگل متصل و مدیریت سهمیه روزانه (Auto-Switch Profile Pool)
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        به محض پر شدن مصرف روزانه یک اکانت، ایجنت به صورت خودکار به اکانت بعدی سوییچ می‌کند.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onResetQuota()}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#2A3142] bg-[#161B26] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="h-3 w-3" />
                      صفر کردن مصرف امروز همه
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddProfileForm((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/30 whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      افزودن اکانت گوگل جدید
                    </button>
                  </div>
                </div>

                {showAddProfileForm && (
                  <form
                    onSubmit={handleAddProfileSubmit}
                    className="grid grid-cols-1 gap-2.5 rounded-lg border border-emerald-500/30 bg-[#0B0E14] p-3 sm:grid-cols-5"
                  >
                    <input
                      type="text"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      placeholder="نام پروفایل (مثلاً اکانت ۱۱)"
                      className="rounded-lg border border-[#2A3142] bg-[#141925] px-3 py-1.5 text-xs text-white placeholder-slate-500"
                    />
                    <input
                      type="email"
                      required
                      value={newProfileEmail}
                      onChange={(e) => setNewProfileEmail(e.target.value)}
                      placeholder="ایمیل جیمیل (example@gmail.com)"
                      dir="ltr"
                      className="rounded-lg border border-[#2A3142] bg-[#141925] px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono"
                    />
                    <input
                      type="text"
                      value={newProfilePassword}
                      onChange={(e) => setNewProfilePassword(e.target.value)}
                      placeholder="رمز عبور جیمیل"
                      dir="ltr"
                      className="rounded-lg border border-[#2A3142] bg-[#141925] px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 shrink-0">
                        سقف:
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={newProfileLimit}
                        onChange={(e) =>
                          setNewProfileLimit(Number(e.target.value) || 5)
                        }
                        className="w-full rounded-lg border border-[#2A3142] bg-[#141925] px-2.5 py-1.5 text-xs text-white font-mono tabular-nums"
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 whitespace-nowrap shrink-0"
                    >
                      ثبت و اتصال پروفایل
                    </button>
                  </form>
                )}

                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {state.profiles.map((prof) => {
                    const isCurrent = prof.id === state.activeProfileId;
                    const isExhausted = prof.usedToday >= prof.dailyLimit;
                    const usagePct = Math.min(
                      100,
                      Math.round((prof.usedToday / prof.dailyLimit) * 100)
                    );
                    const isPassVisible = Boolean(revealedPasswords[prof.id]);
                    return (
                      <div
                        key={prof.id}
                        className={`flex flex-col justify-between rounded-xl border p-3.5 transition ${
                          isCurrent
                            ? "border-emerald-500/60 bg-emerald-500/5"
                            : isExhausted
                              ? "border-rose-500/40 bg-rose-500/5"
                              : "border-[#22293A] bg-[#0B0E14]"
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-100 truncate">
                              {prof.name}
                            </span>
                            <span
                              className={`text-[11px] font-semibold shrink-0 ${
                                isCurrent
                                  ? "text-emerald-400"
                                  : isExhausted
                                    ? "text-rose-400"
                                    : "text-slate-400"
                              }`}
                            >
                              {isCurrent
                                ? "● اکانت فعال"
                                : isExhausted
                                  ? "● سهمیه پر شده"
                                  : "○ آماده جایگزینی"}
                            </span>
                          </div>
                          <div
                            dir="ltr"
                            className="truncate font-mono text-[11px] text-sky-300"
                          >
                            {prof.email}
                          </div>
                          <div className="flex items-center justify-between gap-2 rounded border border-[#1E2536] bg-[#10141F] px-2.5 py-1 text-[11px]">
                            <span className="inline-flex items-center gap-1 text-slate-400 shrink-0">
                              <KeyRound className="h-3 w-3 text-amber-400" />
                              رمز:
                            </span>
                            <span
                              dir="ltr"
                              className="truncate font-mono text-amber-300"
                            >
                              {isPassVisible ? prof.password : "••••••••••••"}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setRevealedPasswords((prev) => ({
                                    ...prev,
                                    [prof.id]: !prev[prof.id],
                                  }))
                                }
                                className="rounded p-0.5 text-slate-400 hover:text-white"
                                title={isPassVisible ? "مخفی کردن رمز" : "نمایش رمز"}
                              >
                                {isPassVisible ? (
                                  <EyeOff className="h-3 w-3" />
                                ) : (
                                  <Eye className="h-3 w-3" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void navigator.clipboard.writeText(
                                    `${prof.email} | ${prof.password}`
                                  );
                                  setCopiedCredId(prof.id);
                                  setTimeout(() => setCopiedCredId(null), 1500);
                                }}
                                className="rounded p-0.5 text-slate-400 hover:text-emerald-300"
                                title="کپی جیمیل و رمز"
                              >
                                {copiedCredId === prof.id ? (
                                  <Check className="h-3 w-3 text-emerald-400" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-5">
                            {prof.notesFa}
                          </p>
                        </div>

                        <div className="mt-3 space-y-2 pt-2 border-t border-[#1E2536]">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400">
                              مصرف سهمیه امروز:
                            </span>
                            <span className="font-mono font-bold text-slate-200 tabular-nums">
                              {prof.usedToday} / {prof.dailyLimit}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1E2536]">
                            <div
                              className={`h-full transition-all ${
                                isExhausted
                                  ? "bg-rose-500"
                                  : isCurrent
                                    ? "bg-emerald-400"
                                    : "bg-sky-400"
                              }`}
                              style={{ width: `${usagePct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <span
                              dir="ltr"
                              className="truncate font-mono text-[10px] text-slate-500"
                            >
                              {prof.userDataDir}
                            </span>
                            {!isCurrent && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void onSwitchProfile(prof.id)}
                                className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                              >
                                <UserCheck className="h-3 w-3" />
                                سوییچ به این اکانت
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Web Studio & Model Configurator (Google Flow / Veo 2 / Omni Flash / Leonardo.ai) */}
              <div className="rounded-xl border border-[#242B3D] bg-[#10141F] p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2536] pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-amber-300">
                      تنظیمات وب‌سایت مقصد، مدل هوش مصنوعی و نهایی‌ساز پرامپت شات‌ها
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      ایجنت پیش از ارسال پرامپت آن را نهایی و قفل می‌کند، وارد سایت شده و مدل (مثلاً Veo 2 یا Omni Flash) و مشخصات را دقیق انتخاب می‌کند.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void onDispatchCommand(
                        "solve_obstacles",
                        state.siteConfig.targetUrl,
                        "ایجنت ضدتشخیص Playwright"
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] font-bold text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    تست عبور از Cloudflare و I&apos;m not a robot
                  </button>
                </div>

                {/* Site, Mode, Model, Aspect Ratio, Resolution Selectors */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-300">
                      ۱. وب‌سایت هدف:
                    </label>
                    <select
                      value={state.siteConfig.siteId}
                      onChange={(e) =>
                        void onUpdateSiteConfig({
                          siteId: e.target.value as WebStudioSiteId,
                        })
                      }
                      className="w-full rounded-lg border border-[#2A3142] bg-[#0B0E14] px-2.5 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                    >
                      <option value="molab">
                        Marimo Molab GPU (مولب — تا ۹۶GB VRAM)
                      </option>
                      <option value="google_colab">
                        Google Colab GPU (گوگل کولب — T4 / L4)
                      </option>
                      <option value="google_flow">
                        Google Flow / LabsFX (گوگل فلو)
                      </option>
                      <option value="leonardo_ai">
                        Leonardo.ai Studio (لئوناردو)
                      </option>
                      <option value="kling_web">
                        Kling AI Web Studio (کلینگ)
                      </option>
                      <option value="runway_web">
                        RunwayML Gen-3 Web (ران‌وی)
                      </option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-300">
                      ۲. نوع عملیات شات:
                    </label>
                    <select
                      value={state.siteConfig.mode}
                      onChange={(e) =>
                        void onUpdateSiteConfig({
                          mode: e.target.value as WebStudioGenerationMode,
                        })
                      }
                      className="w-full rounded-lg border border-[#2A3142] bg-[#0B0E14] px-2.5 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                    >
                      <option value="image_to_video">
                        تبدیل عکس به ویدیو (Image-to-Video)
                      </option>
                      <option value="text_to_image">
                        تبدیل متن به عکس (Text-to-Image)
                      </option>
                      <option value="text_to_video">
                        تبدیل متن به ویدیو (Text-to-Video)
                      </option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-300">
                      ۳. انتخاب مدل داخل سایت:
                    </label>
                    <select
                      value={state.siteConfig.modelId}
                      onChange={(e) =>
                        void onUpdateSiteConfig({
                          modelId: e.target.value as WebStudioModelOption,
                        })
                      }
                      className="w-full rounded-lg border border-[#2A3142] bg-[#0B0E14] px-2.5 py-2 text-xs text-amber-300 font-semibold focus:border-amber-500 focus:outline-none"
                    >
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.labelFa}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-300">
                      ۴. ابعاد کادر:
                    </label>
                    <select
                      value={state.siteConfig.aspectRatio}
                      onChange={(e) =>
                        void onUpdateSiteConfig({
                          aspectRatio: e.target.value as "9:16" | "16:9" | "1:1",
                        })
                      }
                      className="w-full rounded-lg border border-[#2A3142] bg-[#0B0E14] px-2.5 py-2 text-xs text-white font-mono focus:border-amber-500 focus:outline-none"
                    >
                      <option value="9:16">9:16 (عمودی ریلز/شورتس)</option>
                      <option value="16:9">16:9 (افقی سینمایی)</option>
                      <option value="1:1">1:1 (مربع پست)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-300">
                      ۵. رزولوشن خروجی:
                    </label>
                    <select
                      value={state.siteConfig.resolution}
                      onChange={(e) =>
                        void onUpdateSiteConfig({
                          resolution: e.target.value as "720p" | "1080p",
                        })
                      }
                      className="w-full rounded-lg border border-[#2A3142] bg-[#0B0E14] px-2.5 py-2 text-xs text-white font-mono focus:border-amber-500 focus:outline-none"
                    >
                      <option value="1080p">1080p Full HD</option>
                      <option value="720p">720p Fast Preview</option>
                    </select>
                  </div>
                </div>

                {/* Optional Project Shot Picker + Raw Prompt Input */}
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-200">
                      متن پرامپت شات (ایجنت قبل از ارسال به سایت، این پرامپت را کامل و قطعی می‌کند):
                    </label>
                    {activeProject?.director?.shots &&
                      activeProject.director.shots.length > 0 && (
                        <select
                          value={selectedShotNumber}
                          onChange={(e) =>
                            handleSelectProjectShot(e.target.value)
                          }
                          className="rounded-lg border border-[#2A3142] bg-[#0B0E14] px-2.5 py-1 text-xs text-sky-300"
                        >
                          <option value="">
                            انتخاب از شات‌های دکوپاژ پروژه فعال...
                          </option>
                          {activeProject.director.shots.map((s) => (
                            <option key={s.shotNumber} value={s.shotNumber}>
                              شات شماره {s.shotNumber} ({s.timecode}) —{" "}
                              {s.cameraAngle}
                            </option>
                          ))}
                        </select>
                      )}
                  </div>

                  <textarea
                    rows={3}
                    value={shotPrompt}
                    onChange={(e) => setShotPrompt(e.target.value)}
                    placeholder="توضیح صحنه یا شات موردنظر را بنویسید..."
                    className="w-full rounded-lg border border-[#2A3142] bg-[#0B0E14] p-3 text-xs leading-6 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={isBusy || !shotPrompt.trim()}
                      onClick={() =>
                        void onDispatchCommand(
                          "refine_prompt",
                          shotPrompt.trim(),
                          "ایجنت نهایی‌ساز پرامپت"
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      ۱. پیش‌نمایش و قفل کردن پرامپت نهایی
                    </button>

                    <button
                      type="button"
                      disabled={isBusy || !shotPrompt.trim()}
                      onClick={() =>
                        void onGenerateStudioShot({
                          rawPrompt: shotPrompt.trim(),
                          projectId: activeProject?.id ?? null,
                          shotNumber:
                            selectedShotNumber !== ""
                              ? Number(selectedShotNumber)
                              : null,
                          siteId: state.siteConfig.siteId,
                          mode: state.siteConfig.mode,
                          modelId: state.siteConfig.modelId,
                          aspectRatio: state.siteConfig.aspectRatio,
                          resolution: state.siteConfig.resolution,
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      ۲. ورود خودکار به سایت، تنظیم مدل و ساخت شات (LangGraph)
                    </button>
                  </div>
                </div>

                {/* Display Locked & Finalized Prompt if available */}
                {state.lastRefinedPrompt && (
                  <div className="rounded-lg border border-amber-500/30 bg-[#0B0E14] p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-400">
                        پرامپت نهایی و قفل‌شده برای ارسال به{" "}
                        {state.siteConfig.siteLabelFa} (
                        {state.siteConfig.modelLabelFa}):
                      </span>
                      <span className="font-mono text-[11px] text-emerald-400">
                        LOCKED & READY
                      </span>
                    </div>
                    <p
                      dir="ltr"
                      className="rounded border border-[#1E2536] bg-[#10141F] p-2.5 font-mono text-xs leading-5 text-slate-200"
                    >
                      {state.lastRefinedPrompt.finalizedPrompt}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {state.lastRefinedPrompt.enhancementsFa.map(
                        (note, idx) => (
                          <span
                            key={idx}
                            className="text-[11px] text-slate-400"
                          >
                            ✓ {note}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Generated Web Studio Shots History */}
              {state.shotJobs.length > 0 && (
                <div className="rounded-xl border border-[#242B3D] bg-[#10141F] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#1E2536] pb-2.5">
                    <h3 className="text-xs font-bold text-emerald-300">
                      شات‌های ساخته‌شده توسط مرورگر ایجنت در وب‌سایت‌ها
                    </h3>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {state.shotJobs.length} شات
                    </span>
                  </div>

                  <div className="space-y-3">
                    {state.shotJobs.map((job) => (
                      <div
                        key={job.id}
                        className="grid grid-cols-1 gap-4 rounded-xl border border-[#22293A] bg-[#0B0E14] p-3.5 md:grid-cols-12"
                      >
                        <div className="md:col-span-5">
                          {job.outputMediaUrl &&
                            (job.outputKind === "video" &&
                            job.outputMediaUrl.endsWith(".mp4") ? (
                              <video
                                src={job.outputMediaUrl}
                                controls
                                loop
                                muted
                                playsInline
                                className="w-full max-h-56 rounded-lg border border-[#1E2536] bg-black object-contain"
                              />
                            ) : (
                              <img
                                src={job.outputMediaUrl}
                                alt={job.rawPrompt}
                                className="w-full max-h-56 rounded-lg border border-[#1E2536] bg-black object-contain"
                              />
                            ))}
                        </div>
                        <div className="md:col-span-7 flex flex-col justify-between space-y-2 text-xs">
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold text-white">
                                {job.siteLabelFa} — {job.modelLabelFa}
                              </span>
                              <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
                                {job.mode} · {job.aspectRatio} ·{" "}
                                {job.resolution}
                              </span>
                            </div>

                            <div className="text-[11px] text-sky-300">
                              اکانت استفاده‌شده:{" "}
                              <span className="font-mono font-bold">
                                {job.profileUsedEmail}
                              </span>
                              {job.profileSwitchedFromEmail && (
                                <span className="mr-2 text-amber-400">
                                  (چرخش خودکار از اکانت{" "}
                                  {job.profileSwitchedFromEmail} به دلیل اتمام
                                  سهمیه)
                                </span>
                              )}
                            </div>

                            <div
                              dir="ltr"
                              className="rounded border border-[#1E2536] bg-[#10141F] p-2 font-mono text-[11px] text-slate-300 line-clamp-2"
                            >
                              {job.finalizedPrompt}
                            </div>

                            <div className="text-[11px] text-slate-400">
                              موانع برطرف‌شده:{" "}
                              {job.obstaclesResolved.join(" ، ")}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1E2536] pt-2 text-[11px] text-slate-400 font-mono">
                            <span>
                              گره‌های LangGraph:{" "}
                              {job.langGraphNodesExecuted.length} گره اجرا شد
                            </span>
                            {job.outputMediaUrl && (
                              <a
                                href={job.outputMediaUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-amber-400 hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                باز کردن فایل خروجی
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "viewport" && (
            <>
              {/* Visual Viewport Snapshot */}
              <div className="rounded-xl border border-[#242B3D] bg-[#0D111A] overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2536] bg-[#131824] px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-white truncate">
                      {state.pageTitle}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-400 font-mono tabular-nums shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void onDispatchCommand(
                          "snapshot",
                          "",
                          "vercel-labs/agent-browser"
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300 hover:bg-amber-500/20"
                    >
                      <RefreshCw className="h-3 w-3" />
                      اسنپ‌شات @eN
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void onDispatchCommand(
                          "register",
                          state.currentUrl,
                          "ایجنت ثبت‌نام خودکار"
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-300 hover:bg-emerald-500/20"
                    >
                      <UserPlus className="h-3 w-3" />
                      ثبت‌نام / ورود خودکار در سایت
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void onDispatchCommand(
                          "scroll",
                          "down",
                          "کنترل مستقیم کرومیوم"
                        )
                      }
                      className="inline-flex items-center gap-1 text-sky-400 hover:text-white"
                    >
                      <ArrowDown className="h-3 w-3" />
                      اسکرول پایین
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void onDispatchCommand(
                          "scroll",
                          "up",
                          "کنترل مستقیم کرومیوم"
                        )
                      }
                      className="inline-flex items-center gap-1 text-sky-400 hover:text-white"
                    >
                      <ArrowUp className="h-3 w-3" />
                      اسکرول بالا
                    </button>
                    <a
                      href={state.currentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-amber-400 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      صفحه اصلی
                    </a>
                  </div>
                </div>

                {state.viewportScreenshotUrl ? (
                  <div className="space-y-2 bg-[#090C12] p-2">
                    <div className="text-[11px] font-semibold text-emerald-400 px-1">
                      اسکرین‌شات زنده کرومیوم واقعی (agent-browser screenshot):
                    </div>
                    <img
                      src={state.viewportScreenshotUrl}
                      alt={state.pageTitle}
                      className="w-full rounded-lg border border-[#1E2536] object-contain"
                    />
                  </div>
                ) : state.viewportSvgUrl ? (
                  <div className="relative bg-[#090C12] p-2">
                    <img
                      src={state.viewportSvgUrl}
                      alt={state.pageTitle}
                      className="w-full rounded-lg border border-[#1E2536] object-contain"
                    />
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    پیش‌نمایش تصویری صفحه آماده است.
                  </div>
                )}
              </div>

              {/* Interactive @eN Accessibility Refs from vercel-labs/agent-browser */}
              {state.extractedPage?.interactiveRefs &&
                state.extractedPage.interactiveRefs.length > 0 && (
                  <div className="rounded-xl border border-[#242B3D] bg-[#10141F] p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-[#1E2536] pb-2.5">
                      <h3 className="text-xs font-bold text-amber-300">
                        عناصر تعاملی درخت دسترسی صفحه (vercel-labs/agent-browser @eN Refs)
                      </h3>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {state.extractedPage.interactiveRefs.length} عنصر @eN
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {state.extractedPage.interactiveRefs
                        .slice(0, 18)
                        .map((item) => {
                          const isInput =
                            item.role === "textbox" ||
                            item.role === "searchbox" ||
                            item.role === "combobox";
                          return (
                            <button
                              key={item.ref}
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                if (isInput) {
                                  setSelectedCommand("fill");
                                  setCommandTarget(`${item.ref}=`);
                                } else {
                                  void onDispatchCommand(
                                    "click",
                                    item.ref,
                                    "vercel-labs/agent-browser"
                                  );
                                }
                              }}
                              className="flex items-center justify-between gap-2 rounded-lg border border-[#22293A] bg-[#0B0E14] px-3 py-2 text-right transition hover:border-amber-500/40 hover:bg-[#141925] disabled:opacity-50"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-slate-200">
                                  <span className="ml-1.5 font-mono text-amber-400">
                                    {item.ref}
                                  </span>
                                  {item.name || item.role}
                                </div>
                                <div className="font-mono text-[10px] text-slate-500">
                                  role: {item.role} {isInput ? "· کلیک برای fill" : "· کلیک برای اجرا"}
                                </div>
                              </div>
                              <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}

              {/* Obstacle / Cloudflare Bypass Log */}
              {state.obstacleHistory.length > 0 && (
                <div className="rounded-xl border border-[#242B3D] bg-[#10141F] p-4 space-y-2.5">
                  <h3 className="text-xs font-bold text-emerald-300 border-b border-[#1E2536] pb-2">
                    گزارش عبور از Cloudflare Turnstile، کپچا و چرخش سهمیه
                  </h3>
                  <div className="divide-y divide-[#1E2536]">
                    {state.obstacleHistory.slice(0, 6).map((obs) => (
                      <div
                        key={obs.id}
                        className="flex items-center justify-between gap-3 py-2 text-xs"
                      >
                        <div className="space-y-0.5">
                          <span className="font-mono text-[11px] font-bold text-amber-400">
                            [{obs.kind}]
                          </span>{" "}
                          <span className="text-slate-200">
                            {obs.strategyUsedFa}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-emerald-400 tabular-nums shrink-0">
                          {obs.durationMs}ms · حل شد
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Results List (if any) */}
              {state.searchResults.length > 0 && (
                <div className="rounded-xl border border-[#242B3D] bg-[#10141F] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#1E2536] pb-2.5">
                    <h3 className="text-xs font-bold text-sky-300">
                      نتایج جستجوی وب برای «{state.searchQuery}»
                    </h3>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {state.searchResults.length} نتیجه
                    </span>
                  </div>
                  <div className="divide-y divide-[#1E2536]">
                    {state.searchResults.map((hit) => (
                      <div
                        key={`${hit.index}_${hit.url}`}
                        className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-amber-400 tabular-nums">
                              [{hit.index}]
                            </span>
                            <span className="text-xs font-bold text-slate-100">
                              {hit.title}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              ({hit.sourceEngine})
                            </span>
                          </div>
                          <p className="text-xs leading-5 text-slate-300">
                            {hit.snippet}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void onDispatchCommand(
                              "goto",
                              hit.url,
                              "ایجنت مرورگر Playwright"
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          <MousePointerClick className="h-3.5 w-3.5" />
                          ورود ایجنت به صفحه
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive Links Extracted from Current Page */}
              {state.extractedPage && state.extractedPage.links.length > 0 && (
                <div className="rounded-xl border border-[#242B3D] bg-[#10141F] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#1E2536] pb-2.5">
                    <h3 className="text-xs font-bold text-slate-200">
                      عناصر و لینک‌های قابل کلیک داخل صفحه فعلی (دستور CLICK ایجنت)
                    </h3>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {state.extractedPage.links.length} لینک
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {state.extractedPage.links.slice(0, 12).map((lnk) => (
                      <button
                        key={`${lnk.index}_${lnk.href}`}
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void onDispatchCommand(
                            "click",
                            String(lnk.index),
                            "ایجنت مرورگر Playwright"
                          )
                        }
                        className="flex items-center justify-between gap-2 rounded-lg border border-[#22293A] bg-[#0B0E14] px-3 py-2 text-right transition hover:border-amber-500/40 hover:bg-[#141925] disabled:opacity-50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-slate-200">
                            <span className="ml-1.5 font-mono text-amber-400 tabular-nums">
                              #{lnk.index}
                            </span>
                            {lnk.text}
                          </div>
                          <div
                            dir="ltr"
                            className="truncate font-mono text-[10px] text-slate-400"
                          >
                            {lnk.href}
                          </div>
                        </div>
                        <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === "extracted" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#242B3D] bg-[#10141F] p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-[#1E2536] pb-2.5">
                  <h3 className="text-xs font-bold text-amber-300">
                    خلاصه درک محتوا توسط ایجنت (Synthesized Web Comprehension)
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void onDispatchCommand(
                          "mission",
                          "لوله مانیسمان رده ۸۰ و استانداردهای نفت و گاز",
                          "ایجنت پژوهشگر صنعتی"
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-300 hover:bg-sky-500/20 whitespace-nowrap shrink-0"
                    >
                      <Search className="h-3 w-3" />
                      اجرای ماموریت نمونه: لوله مانیسمان
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyComprehension()}
                      className="inline-flex items-center gap-1.5 rounded border border-[#2A3142] bg-[#161B26] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white whitespace-nowrap shrink-0"
                    >
                      {copiedSummary ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          کپی شد
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          کپی متن استخراج‌شده
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <p className="whitespace-pre-line text-xs leading-6 text-slate-200">
                  {state.comprehensionSummaryFa ||
                    "هنوز صفحه‌ای توسط ایجنت استخراج نشده است."}
                </p>
              </div>

              <div className="rounded-xl border border-[#242B3D] bg-[#10141F] p-4 space-y-3">
                <h3 className="text-xs font-bold text-emerald-300 border-b border-[#1E2536] pb-2.5">
                  فکت‌ها، اعداد و نکات تخصصی استخراج‌شده از متن صفحه
                </h3>
                {state.comprehensionFactsFa.length > 0 ? (
                  <ul className="space-y-2">
                    {state.comprehensionFactsFa.map((fact, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2.5 rounded-lg border border-[#1E2536] bg-[#0B0E14] p-3 text-xs leading-6 text-slate-200"
                      >
                        <span className="font-mono font-bold text-emerald-400 tabular-nums">
                          {idx + 1}.
                        </span>
                        <span>{fact}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">
                    پس از باز شدن مقاله یا اجرای ماموریت، نکات عددی و استانداردهای فنی اینجا فهرست می‌شوند.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "logs" && (
            <div className="rounded-xl border border-[#242B3D] bg-[#10141F] overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#1E2536] px-4 py-3">
                <h3 className="text-xs font-bold text-slate-200">
                  تاریخچه دستورات برنامه‌نویسی اجراشده روی مرورگر کرومیوم
                </h3>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void onClearBrowser()}
                  className="inline-flex items-center gap-1 rounded border border-[#262D3D] bg-[#141925] px-2.5 py-1 text-[11px] text-slate-400 hover:border-rose-500/40 hover:text-rose-300 whitespace-nowrap shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                  پاک‌سازی تاریخچه
                </button>
              </div>

              {state.actionLog.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  هنوز دستوری در این جلسه اجرا نشده است.
                </div>
              ) : (
                <div className="divide-y divide-[#1E2536]">
                  {state.actionLog.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start justify-between gap-4 px-4 py-3 text-xs"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`font-mono text-[11px] font-bold uppercase ${
                              log.status === "error"
                                ? "text-rose-400"
                                : "text-amber-400"
                            }`}
                          >
                            [{log.command}]
                          </span>
                          <span className="font-semibold text-slate-200">
                            {log.agentName}
                          </span>
                          <span className="text-[11px] text-slate-400 truncate">
                            — {log.target}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-5">
                          {log.detailFa}
                        </p>
                      </div>
                      <div className="text-left font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                        <div>{log.durationMs}ms</div>
                        <div>
                          {new Date(log.timestamp).toLocaleTimeString("fa-IR")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
