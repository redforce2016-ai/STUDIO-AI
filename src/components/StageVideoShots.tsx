import { useState } from "react";
import {
  ArrowLeft,
  Box,
  Film,
  Globe,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import type {
  AgentBrowserState,
  DirectorShot,
  ProjectRecord,
  VisualAssetsOutput,
  WebStudioGenerationMode,
  WebStudioModelOption,
  WebStudioSiteId,
} from "../types/studio";
import { ThreeSceneView } from "./ThreeSceneView";

interface StageVideoShotsProps {
  project: ProjectRecord;
  visuals: VisualAssetsOutput | null;
  directorShots: DirectorShot[];
  browserState: AgentBrowserState | null;
  isRunning: boolean;
  isExecutingBrowserCmd: boolean;
  isCurrentGate: boolean;
  onRegenerateShot: (
    shotNumber: number,
    updatedPrompt?: string,
    feedback?: string
  ) => Promise<void>;
  onGenerateWebStudioShot: (params: {
    rawPrompt: string;
    projectId?: string | null;
    shotNumber?: number | null;
    siteId: WebStudioSiteId;
    mode: WebStudioGenerationMode;
    modelId: WebStudioModelOption;
    aspectRatio: "9:16" | "16:9" | "1:1";
    resolution: "720p" | "1080p";
  }) => Promise<void>;
  onOpenBrowserDrawer: () => void;
  onRegenerateAll: (feedback: string) => Promise<void>;
  onApprove: () => Promise<void>;
}

const SITE_MODELS_MAP: Record<
  WebStudioSiteId,
  Array<{ id: WebStudioModelOption; labelFa: string }>
> = {
  google_flow: [
    { id: "veo_2", labelFa: "Google Veo 2 (ویدیو سینمایی)" },
    { id: "omni_flash", labelFa: "Gemini Omni Flash (ویدیو سریع)" },
    { id: "imagen_3", labelFa: "Google Imagen 3 (تصویر کلیدی)" },
  ],
  leonardo_ai: [
    { id: "leonardo_motion", labelFa: "Leonardo Motion 2.0 (ویدیو)" },
    { id: "leonardo_phoenix", labelFa: "Leonardo Phoenix 1.0 (تصویر)" },
    { id: "leonardo_kino_xl", labelFa: "Leonardo Kino XL (سینمایی)" },
  ],
  kling_web: [{ id: "kling_1_6", labelFa: "Kling 1.6 Pro (ویدیو)" }],
  runway_web: [{ id: "runway_gen3_turbo", labelFa: "Runway Gen-3 Turbo (ویدیو)" }],
  general_web: [{ id: "imagen_3", labelFa: "پیش‌فرض" }],
};

export function StageVideoShots({
  project,
  visuals,
  directorShots,
  browserState,
  isRunning,
  isExecutingBrowserCmd,
  isCurrentGate,
  onRegenerateShot,
  onGenerateWebStudioShot,
  onOpenBrowserDrawer,
  onRegenerateAll,
  onApprove,
}: StageVideoShotsProps) {
  const defaultAspect: "9:16" | "16:9" | "1:1" =
    project.brief.contentFormat === "long_video" ||
    project.brief.platform === "youtube"
      ? "16:9"
      : "9:16";

  const [subTab, setSubTab] = useState<"shots" | "three3d">("shots");
  const [siteId, setSiteId] = useState<WebStudioSiteId>(
    browserState?.siteConfig.siteId || "google_flow"
  );
  const [mode, setMode] = useState<WebStudioGenerationMode>("image_to_video");
  const [modelId, setModelId] = useState<WebStudioModelOption>("veo_2");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1">(
    defaultAspect
  );
  const [busyShotNum, setBusyShotNum] = useState<number | null>(null);
  const [busyMode, setBusyMode] = useState<"web" | "local" | null>(null);
  const [shotPrompts, setShotPrompts] = useState<Record<number, string>>({});
  const [globalFeedback, setGlobalFeedback] = useState("");

  const availableModels = SITE_MODELS_MAP[siteId] || SITE_MODELS_MAP.google_flow;
  const activeProfile = browserState?.profiles.find(
    (p) => p.id === browserState.activeProfileId
  );

  const handleSiteChange = (nextSite: WebStudioSiteId) => {
    setSiteId(nextSite);
    const firstModel = SITE_MODELS_MAP[nextSite]?.[0]?.id;
    if (firstModel) setModelId(firstModel);
  };

  const handleWebGenerateShot = async (shot: DirectorShot) => {
    const prompt = (
      shotPrompts[shot.shotNumber] ?? shot.visualPromptFa
    ).trim();
    if (!prompt) return;
    setBusyShotNum(shot.shotNumber);
    setBusyMode("web");
    try {
      await onGenerateWebStudioShot({
        rawPrompt: prompt,
        projectId: project.id,
        shotNumber: shot.shotNumber,
        siteId,
        mode,
        modelId,
        aspectRatio,
        resolution: "1080p",
      });
    } finally {
      setBusyShotNum(null);
      setBusyMode(null);
    }
  };

  const handleLocalShotRefresh = async (shot: DirectorShot) => {
    const prompt = (
      shotPrompts[shot.shotNumber] ?? shot.visualPromptFa
    ).trim();
    setBusyShotNum(shot.shotNumber);
    setBusyMode("local");
    try {
      await onRegenerateShot(shot.shotNumber, prompt);
    } finally {
      setBusyShotNum(null);
      setBusyMode(null);
    }
  };

  const shotJobs = browserState?.shotJobs || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <span>مرحله ۳ · ساخت شات‌های ویدیو و صحنه‌های سه‌بعدی</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono-tabular text-slate-400">
              {directorShots.length} شات آماده تولید
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            تولید واقعی کلیپ‌های شات (مرورگر ایجنت گوگل فلو / لئوناردو + چیدمان ۳بعدی)
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[#262B38] bg-[#0B0D11] p-1 text-xs">
            <button
              type="button"
              onClick={() => setSubTab("shots")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                subTab === "shots"
                  ? "bg-amber-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              <span>ساخت شات‌های ویدیویی ({directorShots.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab("three3d")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                subTab === "three3d"
                  ? "bg-amber-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Box className="h-3.5 w-3.5" />
              <span>صحنه و دوربین سه‌بعدی (Three.js)</span>
            </button>
          </div>
        </div>
      </div>

      {subTab === "three3d" ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#262B38] bg-[#14171F] px-4 py-3 text-xs text-slate-300">
            استودیوی سه‌بعدی مستقیماً به دکوپاژ همین پروژه متصل است تا نورپردازی و زوایای دوربین هر شات را قبل از رندر نهایی بررسی و تنظیم کنید.
          </div>
          <ThreeSceneView project={project} />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Web Studio & Agent Browser Quick Config Bar */}
          <section className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262B38] pb-3">
              <div>
                <h3 className="text-xs font-bold text-amber-300 flex items-center gap-2">
                  <Wand2 className="h-4 w-4" />
                  <span>
                    پیکربندی مرورگر ایجنت (vercel-labs/agent-browser) برای ساخت شات‌ها در وب‌سایت‌ها
                  </span>
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  ایجنت ابتدا پرامپت شات را کامل و قفل می‌کند، با اکانت جیمیل فعال (
                  <span className="font-mono text-emerald-400">
                    {activeProfile?.email || "studio.agent.01@gmail.com"}
                  </span>
                  {activeProfile
                    ? ` · مصرف امروز: ${activeProfile.usedToday}/${activeProfile.dailyLimit}`
                    : ""}
                  ) وارد سایت می‌شود و در صورت پر شدن سهمیه، بین ۱۰ جیمیل چرخش می‌کند.
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenBrowserDrawer}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 whitespace-nowrap shrink-0"
              >
                <Globe className="h-3.5 w-3.5" />
                <span>مدیریت ۱۰ جیمیل و نمای مرورگر</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <label className="block text-[11px] text-slate-400">
                  سایت تولید ویدیو / تصویر:
                </label>
                <select
                  value={siteId}
                  onChange={(e) =>
                    handleSiteChange(e.target.value as WebStudioSiteId)
                  }
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="google_flow">Google Flow / LabsFX (گوگل فلو)</option>
                  <option value="leonardo_ai">Leonardo.ai Studio (لئوناردو)</option>
                  <option value="kling_web">Kling AI Web Studio</option>
                  <option value="runway_web">RunwayML Gen-3 Web</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-slate-400">
                  نوع تبدیل شات:
                </label>
                <select
                  value={mode}
                  onChange={(e) =>
                    setMode(e.target.value as WebStudioGenerationMode)
                  }
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="image_to_video">
                    تبدیل عکس به ویدیو (Image-to-Video)
                  </option>
                  <option value="text_to_video">
                    تبدیل متن به ویدیو (Text-to-Video)
                  </option>
                  <option value="text_to_image">
                    تبدیل متن به عکس کلیدی (Text-to-Image)
                  </option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-slate-400">
                  مدل هدف در سایت:
                </label>
                <select
                  value={modelId}
                  onChange={(e) =>
                    setModelId(e.target.value as WebStudioModelOption)
                  }
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs font-semibold text-amber-300 focus:border-amber-500 focus:outline-none"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.labelFa}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-slate-400">
                  نسبت کادر خروجی:
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) =>
                    setAspectRatio(e.target.value as "9:16" | "16:9" | "1:1")
                  }
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs font-mono text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="9:16">9:16 (عمودی ریلز/شورتس)</option>
                  <option value="16:9">16:9 (افقی یوتیوب)</option>
                  <option value="1:1">1:1 (مربع)</option>
                </select>
              </div>
            </div>
          </section>

          {/* Per-Shot Video Clip Production Cards */}
          <div className="space-y-4">
            {directorShots.map((shot) => {
              const visualAsset = visuals?.shots.find(
                (v) => v.shotNumber === shot.shotNumber
              );
              const latestWebJob = shotJobs.find(
                (j) =>
                  j.shotNumber === shot.shotNumber &&
                  (!j.projectId || j.projectId === project.id)
              );
              const currentPrompt =
                shotPrompts[shot.shotNumber] ?? shot.visualPromptFa;
              const isThisBusy =
                busyShotNum === shot.shotNumber ||
                isRunning ||
                isExecutingBrowserCmd;

              return (
                <article
                  key={shot.shotNumber}
                  className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262B38] pb-3">
                    <div className="flex items-center gap-2.5 text-xs">
                      <span className="font-mono-tabular font-bold text-amber-400">
                        شات {String(shot.shotNumber).padStart(2, "0")}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="font-mono-tabular text-slate-300">
                        {shot.timecode} ({shot.durationSeconds}s)
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-300">
                        {shot.cameraAngle} ({shot.cameraMovement})
                      </span>
                    </div>
                    {latestWebJob && (
                      <span className="text-[11px] font-semibold text-emerald-400">
                        ● خروجی {latestWebJob.modelLabelFa} آماده شد (
                        {latestWebJob.profileUsedEmail})
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
                    {/* Visual Output / Video Clip Player or Keyframe Preview */}
                    <div className="lg:col-span-4 rounded-xl border border-[#262B38] bg-[#0B0D11] p-2">
                      {latestWebJob?.outputMediaUrl &&
                      latestWebJob.outputKind === "video" &&
                      latestWebJob.outputMediaUrl.endsWith(".mp4") ? (
                        <video
                          controls
                          loop
                          muted
                          playsInline
                          src={latestWebJob.outputMediaUrl}
                          className="w-full max-h-64 rounded-lg bg-black object-contain"
                        />
                      ) : latestWebJob?.outputMediaUrl ? (
                        <img
                          src={latestWebJob.outputMediaUrl}
                          alt={`خروجی شات ${shot.shotNumber}`}
                          className="w-full max-h-64 rounded-lg object-contain"
                        />
                      ) : visualAsset?.imageUrl ? (
                        <img
                          src={visualAsset.imageUrl}
                          alt={`کی‌فریم استوری‌بورد شات ${shot.shotNumber}`}
                          className="w-full max-h-64 rounded-lg object-contain"
                        />
                      ) : (
                        <div className="flex h-44 items-center justify-center text-xs text-slate-500">
                          پیش‌نمایش شات آماده رندر
                        </div>
                      )}
                    </div>

                    {/* Shot Prompt Finalizer & Production Controls */}
                    <div className="lg:col-span-8 space-y-3">
                      <p className="text-xs leading-6 text-slate-300">
                        {shot.sceneDescriptionFa}
                      </p>

                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-medium text-slate-400">
                          پرامپت شات (پیش از ارسال توسط Prompt Refiner نهایی و قفل می‌شود):
                        </label>
                        <textarea
                          rows={2}
                          value={currentPrompt}
                          disabled={isThisBusy}
                          onChange={(e) =>
                            setShotPrompts((prev) => ({
                              ...prev,
                              [shot.shotNumber]: e.target.value,
                            }))
                          }
                          className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs leading-6 text-slate-100 focus:border-amber-500 focus:outline-none"
                        />
                      </div>

                      {latestWebJob && (
                        <div
                          dir="ltr"
                          className="rounded-lg border border-[#1E2536] bg-[#0B0D11] px-3 py-2 font-mono text-[11px] text-slate-300 line-clamp-2"
                        >
                          {latestWebJob.finalizedPrompt}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={isThisBusy || !currentPrompt.trim()}
                          onClick={() => void handleWebGenerateShot(shot)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          {busyShotNum === shot.shotNumber &&
                          busyMode === "web" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          <span>
                            ساخت شات در مرورگر ایجنت ({siteId === "google_flow" ? "Google Flow" : siteId})
                          </span>
                        </button>

                        <button
                          type="button"
                          disabled={isThisBusy || !currentPrompt.trim()}
                          onClick={() => void handleLocalShotRefresh(shot)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${
                              busyShotNum === shot.shotNumber &&
                              busyMode === "local"
                                ? "animate-spin"
                                : ""
                            }`}
                          />
                          <span>بازسازی فریم کلیدی شات</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Checkpoint 3 Bar */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={globalFeedback}
              disabled={isRunning}
              onChange={(e) => setGlobalFeedback(e.target.value)}
              placeholder="بازخورد برای اصلاح کلی شات‌های ویدیو (مثلاً: نور سینمایی گرم‌تر برای کل شات‌ها)..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onRegenerateAll(globalFeedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`}
              />
              <span>بازتولید شات‌ها</span>
            </button>
          </div>

          <button
            type="button"
            disabled={isRunning}
            onClick={onApprove}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <span>
              {isRunning
                ? "در حال تولید متن و صدای متناسب با شات‌ها..."
                : isCurrentGate
                  ? "تایید شات‌های ویدیو و ساخت صدا"
                  : "بروزرسانی و ساخت صدا برای ویدیو"}
            </span>
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
