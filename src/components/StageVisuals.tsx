import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Film,
  Maximize2,
  RefreshCw,
  ShieldCheck,
  Volume2,
  X,
  XCircle,
} from "lucide-react";
import type {
  ContentFormatOption,
  DirectorShot,
  PlatformOption,
  VisualAssetShot,
  VisualAssetsOutput,
} from "../types/studio";
import type {
  ShotExecutionRecord,
  VideoAspectFormat,
  VideoPipelineRun,
  VideoPreflightStatus,
  VideoQualityMode,
} from "../types/videoPipeline";

interface StageVisualsProps {
  projectId: string;
  platform: PlatformOption;
  contentFormat?: ContentFormatOption;
  data: VisualAssetsOutput;
  directorShots: DirectorShot[];
  videoProduction?: VideoPipelineRun | null;
  isRunning: boolean;
  isCompleted: boolean;
  onRegenerateShot: (shotNumber: number, updatedPrompt?: string, feedback?: string) => Promise<void>;
  onRegenerateAll: (feedback: string) => Promise<void>;
  onFinalize: () => Promise<void>;
  onExportBible: () => void;
  onStartVideoRender: (opts: {
    aspectRatio: VideoAspectFormat;
    qualityMode: VideoQualityMode;
    burnSubtitles: boolean;
    includeBackgroundMusic: boolean;
  }) => Promise<void>;
  onRetryVideoShot: (shotId: string, humanInstruction?: string) => Promise<void>;
}

const NODE_LABELS_FA: Record<string, string> = {
  START: "آماده‌سازی پایپ‌لاین",
  scenario_parser: "۱. تجزیه ساختاریافته سناریو",
  shot_planner: "۲. طراحی چیدمان و حرکت دوربین",
  tool_router: "۳. مسیریابی ابزار رندر",
  builder: "۴. ترکیب کامپوننت‌های Remotion",
  renderer: "۵. رندر واقعی MP4",
  frame_extractor: "۶. استخراج فریم و تست FFmpeg",
  visual_critic: "۷. ممیزی بصری (Vision QA)",
  decision: "۸. تصمیم‌گیری و حلقه اصلاح",
  assembler: "۹. مونتاژ نهایی و تراز صدا (-14 LUFS)",
  final_qa: "۱۰. تایید نهایی ویدیوی کامل",
  human_retry: "تلاش مجدد با دستور کاربر",
};

const SHOT_STATUS_FA: Record<ShotExecutionRecord["status"], { label: string; color: string }> = {
  pending: { label: "در صف", color: "text-slate-400" },
  planning: { label: "برنامه‌ریزی", color: "text-sky-400" },
  building: { label: "ساخت کامپوننت", color: "text-amber-300" },
  rendering: { label: "در حال رندر MP4", color: "text-amber-400" },
  extracting: { label: "بررسی FFmpeg", color: "text-sky-300" },
  critiquing: { label: "ممیزی بینایی QA", color: "text-purple-300" },
  passed: { label: "تایید QA شد", color: "text-emerald-400" },
  retrying: { label: "رد شد · در حال اصلاح", color: "text-amber-400" },
  needs_human_review: { label: "نیاز به بازبینی انسانی", color: "text-red-400" },
  needs_clarification: { label: "نیازمند شفاف‌سازی", color: "text-amber-400" },
  error: { label: "خطای اجرا", color: "text-red-400" },
};

export function StageVisuals({
  platform,
  contentFormat,
  data,
  directorShots,
  videoProduction,
  isRunning,
  isCompleted,
  onRegenerateShot,
  onRegenerateAll,
  onFinalize,
  onExportBible,
  onStartVideoRender,
  onRetryVideoShot,
}: StageVisualsProps) {
  const defaultAspect: VideoAspectFormat =
    contentFormat === "long_video" || platform === "youtube" ? "16:9" : "9:16";

  const [aspectRatio, setAspectRatio] = useState<VideoAspectFormat>(
    videoProduction?.aspectRatio || defaultAspect
  );
  const [qualityMode, setQualityMode] = useState<VideoQualityMode>(
    videoProduction?.qualityMode || "preview_480p"
  );
  const [burnSubtitles, setBurnSubtitles] = useState(false);
  const [includeMusic, setIncludeMusic] = useState(false);
  const [preflight, setPreflight] = useState<VideoPreflightStatus | null>(null);
  const [isLaunchingRender, setIsLaunchingRender] = useState(false);
  const [retryingShotId, setRetryingShotId] = useState<string | null>(null);
  const [retryInstruction, setRetryInstruction] = useState<Record<string, string>>({});

  // Storyboard SVG inspection states
  const [showCaptions, setShowCaptions] = useState(true);
  const [busyShot, setBusyShot] = useState<number | null>(null);
  const [lightboxShot, setLightboxShot] = useState<{
    asset: VisualAssetShot;
    director?: DirectorShot;
  } | null>(null);
  const [shotFeedback, setShotFeedback] = useState<Record<number, string>>({});
  const [globalFeedback, setGlobalFeedback] = useState("");
  const [activeSubView, setActiveSubView] = useState<"video_pipeline" | "storyboard">(
    "video_pipeline"
  );

  useEffect(() => {
    fetch("/api/video/preflight")
      .then((r) => r.json())
      .then((d) => {
        if (d.preflight) setPreflight(d.preflight);
      })
      .catch(() => {});
  }, []);

  const handleLaunchVideoPipeline = async () => {
    setIsLaunchingRender(true);
    try {
      await onStartVideoRender({
        aspectRatio,
        qualityMode,
        burnSubtitles,
        includeBackgroundMusic: includeMusic,
      });
    } finally {
      setIsLaunchingRender(false);
    }
  };

  const handleRetryShot = async (shotId: string) => {
    setRetryingShotId(shotId);
    try {
      await onRetryVideoShot(shotId, retryInstruction[shotId]);
    } finally {
      setRetryingShotId(null);
    }
  };

  const handleRegenOne = async (shotNumber: number) => {
    setBusyShot(shotNumber);
    try {
      await onRegenerateShot(shotNumber, undefined, shotFeedback[shotNumber]);
    } finally {
      setBusyShot(null);
    }
  };

  const isVideoRunning =
    isLaunchingRender ||
    videoProduction?.status === "running" ||
    videoProduction?.status === "assembling";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <span>مرحله ۴ · تولید ویدیو MP4 و کنترل کیفیت بصری</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">
              {isCompleted ? "پروژه تکمیل‌شده" : "گراف ۱۰ مرحله‌ای Remotion + FFmpeg + Vision QA"}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            استودیو رندر واقعی و ممیزی فریم‌به‌فریم شات‌ها
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[#262B38] bg-[#0B0D11] p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveSubView("video_pipeline")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeSubView === "video_pipeline"
                  ? "bg-amber-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              تولید ویدیو MP4 و QA
            </button>
            <button
              type="button"
              onClick={() => setActiveSubView("storyboard")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeSubView === "storyboard"
                  ? "bg-amber-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              پیش‌طرح استوری‌بورد ({data.shots.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onExportBible}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-amber-400" />
            <span>خروجی سناریو</span>
          </button>
        </div>
      </div>

      {activeSubView === "video_pipeline" ? (
        <div className="space-y-6">
          {/* Render Controls & Tool Preflight Strip (Flat 1px Border Surface) */}
          <section className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-4">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Clapperboard className="h-4 w-4 text-amber-400" />
                  <span>تنظیمات رندر و مونتاژ MP4</span>
                </h3>
                {preflight && (
                  <p className="text-xs text-slate-400">
                    موتورهای محلی: Remotion v4 {preflight.remotionAvailable ? "✓" : "✕"} · FFmpeg{" "}
                    {preflight.ffmpegAvailable ? "✓" : "✕"} · فونت Vazirmatn{" "}
                    {preflight.localFontsAvailable ? "✓" : "✕"} · Blender{" "}
                    {preflight.blenderAvailable ? "نصب" : "فال‌بک خودکار به Remotion"}
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={isVideoRunning || isRunning || preflight?.ready === false}
                onClick={handleLaunchVideoPipeline}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Film className={`h-4 w-4 ${isVideoRunning ? "animate-pulse" : ""}`} />
                <span>
                  {isVideoRunning
                    ? "در حال رندر و ممیزی بصری..."
                    : videoProduction
                      ? "رندر مجدد ویدیوی نهایی MP4"
                      : "ساخت ویدیوی نهایی MP4 با QA بصری"}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  نسبت تصویر خروجی
                </label>
                <select
                  value={aspectRatio}
                  disabled={isVideoRunning}
                  onChange={(e) => setAspectRatio(e.target.value as VideoAspectFormat)}
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="9:16">عمودی ۹:۱۶ (ریلز / شورتس / تیک‌تاک)</option>
                  <option value="16:9">افقی ۱۶:۹ (یوتیوب / وب)</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  کیفیت و سرعت رندر
                </label>
                <select
                  value={qualityMode}
                  disabled={isVideoRunning}
                  onChange={(e) => setQualityMode(e.target.value as VideoQualityMode)}
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="preview_480p">پیش‌نمایش سریع (480p)</option>
                  <option value="final_1080p">کیفیت نهایی انتشار (1080p)</option>
                </select>
              </div>

              <label className="flex items-center gap-2.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={burnSubtitles}
                  disabled={isVideoRunning}
                  onChange={(e) => setBurnSubtitles(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>حک دائمی زیرنویس فارسی (Burn-in)</span>
              </label>

              <label className="flex items-center gap-2.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMusic}
                  disabled={isVideoRunning}
                  onChange={(e) => setIncludeMusic(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>لایه صوتی پس‌زمینه + Ducking</span>
              </label>
            </div>

            {preflight && !preflight.ready && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                پیش‌نیازهای بحرانی ناقص است: {preflight.missingCritical.join(" · ")}
              </div>
            )}
          </section>

          {/* Active Pipeline Status & Final Video Player */}
          {videoProduction ? (
            <div className="space-y-6">
              {/* Progress Bar / Execution Status */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#262B38] bg-[#14171F] px-5 py-4">
                <div className="flex items-center gap-3">
                  {videoProduction.status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  ) : videoProduction.status === "error" ||
                    videoProduction.status === "needs_human_review" ? (
                    <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
                  ) : (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent shrink-0" />
                  )}
                  <div>
                    <div className="text-sm font-bold text-slate-100">
                      {NODE_LABELS_FA[videoProduction.currentNode] || videoProduction.currentNode}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      وضعیت کل:{" "}
                      {videoProduction.status === "completed"
                        ? "تاییدشده و آماده انتشار"
                        : videoProduction.status === "needs_human_review"
                          ? "توقف امن: یک یا چند شات نیاز به بازبینی انسانی دارند"
                          : videoProduction.status === "error"
                            ? videoProduction.errorMessage || "خطا در اجرای پایپ‌لاین"
                            : "در حال پردازش موازی شات‌ها و کنترل کیفیت..."}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 font-mono-tabular text-xs text-slate-300">
                  <span>فرمت: {videoProduction.aspectRatio}</span>
                  <span>·</span>
                  <span>
                    کیفیت: {videoProduction.qualityMode === "final_1080p" ? "1080p" : "480p"}
                  </span>
                  <span>·</span>
                  <span>
                    شات‌های تاییدشده:{" "}
                    {videoProduction.shots.filter((s) => s.status === "passed").length}/
                    {videoProduction.shots.length}
                  </span>
                </div>
              </div>

              {/* Final Assembled MP4 Theater & Report */}
              {videoProduction.finalVideoUrl && (
                <section className="rounded-xl border border-emerald-500/35 bg-[#14171F] p-5 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                      <ShieldCheck className="h-5 w-5" />
                      <span>ویدیوی نهایی MP4 تاییدشده توسط Final QA</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={videoProduction.finalVideoUrl}
                        download={`${videoProduction.runId}_final.mp4`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>دانلود ویدیو MP4</span>
                      </a>
                      {videoProduction.srtUrl && (
                        <a
                          href={videoProduction.srtUrl}
                          download={`${videoProduction.runId}_subtitles.srt`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/40 whitespace-nowrap shrink-0"
                        >
                          <Download className="h-3.5 w-3.5 text-amber-400" />
                          <span>فایل زیرنویس SRT</span>
                        </a>
                      )}
                      {videoProduction.reportUrl && (
                        <a
                          href={videoProduction.reportUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/40 whitespace-nowrap shrink-0"
                        >
                          <FileCode2 className="h-3.5 w-3.5 text-sky-400" />
                          <span>گزارش JSON</span>
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
                    <div className="lg:col-span-5 flex justify-center rounded-xl border border-[#262B38] bg-[#0B0D11] p-3">
                      <video
                        key={videoProduction.finalVideoUrl}
                        controls
                        src={videoProduction.finalVideoUrl}
                        className={`rounded-lg bg-black ${
                          videoProduction.aspectRatio === "9:16"
                            ? "max-h-[460px] w-auto"
                            : "w-full aspect-video"
                        }`}
                      />
                    </div>

                    <div className="lg:col-span-7 space-y-4">
                      {videoProduction.finalQa && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 border-b border-[#262B38] pb-4">
                            <div>
                              <div className="text-[11px] text-slate-400">مدت دقیق (ffprobe)</div>
                              <div className="mt-1 font-mono-tabular text-sm font-bold text-slate-100">
                                {videoProduction.finalQa.duration_sec}s
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-400">ابعاد و FPS</div>
                              <div className="mt-1 font-mono-tabular text-sm font-bold text-slate-100">
                                {videoProduction.finalQa.width}×{videoProduction.finalQa.height} ·{" "}
                                {videoProduction.finalQa.fps}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-400">تراز صدا (volumedetect)</div>
                              <div className="mt-1 font-mono-tabular text-sm font-bold text-slate-100 flex items-center gap-1">
                                <Volume2 className="h-3.5 w-3.5 text-amber-400" />
                                <span>
                                  {videoProduction.finalQa.mean_volume_db !== null
                                    ? `${videoProduction.finalQa.mean_volume_db} dB`
                                    : "بی‌کلام"}
                                </span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-400">نمره پیوستگی Final QA</div>
                              <div className="mt-1 font-mono-tabular text-sm font-bold text-emerald-400">
                                {videoProduction.finalQa.continuity_score}/10
                              </div>
                            </div>
                          </div>

                          <div className="text-xs leading-6 text-slate-300">
                            {videoProduction.finalQa.summary}
                          </div>

                          {videoProduction.finalQa.issues.length > 0 && (
                            <ul className="space-y-1 text-xs text-amber-300">
                              {videoProduction.finalQa.issues.map((iss, idx) => (
                                <li key={idx}>• {iss}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* Per-Shot QA Execution Grid & Visual Critic Scores */}
              {videoProduction.shots.length > 0 && (
                <section className="rounded-xl border border-[#262B38] bg-[#14171F] overflow-hidden">
                  <div className="border-b border-[#262B38] px-5 py-3.5 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-100">
                      ممیزی فریم‌به‌فریم شات‌ها (Visual Critic + FFmpeg)
                    </h3>
                    <span className="text-xs text-slate-400">
                      حد نصاب عبور: انطباق ≥ ۸ · سایر امتیازها ≥ ۷
                    </span>
                  </div>

                  <div className="divide-y divide-[#262B38]">
                    {videoProduction.shots.map((shot) => {
                      const st = SHOT_STATUS_FA[shot.status];
                      const scores = shot.criticReport?.scores;
                      const isRetrying = retryingShotId === shot.shot_id;

                      return (
                        <div key={shot.shot_id} className="p-5 space-y-4">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                                <span className="font-mono-tabular font-bold text-amber-400">
                                  {shot.shot_id}
                                </span>
                                <span className="text-slate-600">·</span>
                                <span className={`font-semibold ${st.color}`}>{st.label}</span>
                                <span className="text-slate-600">·</span>
                                <span className="font-mono-tabular text-slate-300">
                                  تلاش {shot.attempts}/{shot.maxAttempts}
                                </span>
                                <span className="text-slate-600">·</span>
                                <span className="text-slate-400">
                                  ابزار: {shot.toolUsed}
                                  {shot.fallbackUsed ? " (فال‌بک)" : ""}
                                  {shot.cacheHit ? " (کش)" : ""}
                                </span>
                              </div>
                              <div className="text-sm font-semibold text-slate-100">
                                {shot.spec.intent}
                              </div>
                            </div>

                            {shot.renderUrl && (
                              <a
                                href={shot.renderUrl}
                                download={`${shot.shot_id}.mp4`}
                                className="inline-flex items-center gap-1.5 rounded-md border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs text-slate-300 hover:text-amber-400 whitespace-nowrap shrink-0"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>دانلود شات MP4</span>
                              </a>
                            )}
                          </div>

                          {/* 5 Scores Tabular Row + Deterministic Check */}
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
                            {shot.renderUrl && (
                              <div className="lg:col-span-3 rounded-lg border border-[#262B38] bg-[#0B0D11] p-1.5">
                                <video
                                  controls
                                  src={shot.renderUrl}
                                  className="w-full max-h-56 rounded bg-black"
                                />
                              </div>
                            )}

                            <div
                              className={`${
                                shot.renderUrl ? "lg:col-span-9" : "lg:col-span-12"
                              } space-y-3`}
                            >
                              {scores && (
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 border-b border-[#262B38] pb-3 text-xs">
                                  {[
                                    { label: "انطباق با هدف", val: scores.intent_match, min: 8 },
                                    { label: "خوانایی فارسی", val: scores.readability, min: 7 },
                                    { label: "ترکیب‌بندی", val: scores.composition, min: 7 },
                                    { label: "کیفیت حرکت", val: scores.motion_quality, min: 7 },
                                    { label: "پرداخت بصری", val: scores.polish, min: 7 },
                                  ].map((m) => (
                                    <div key={m.label}>
                                      <div className="text-[11px] text-slate-400">{m.label}</div>
                                      <div
                                        className={`mt-0.5 font-mono-tabular text-sm font-bold ${
                                          m.val >= m.min ? "text-emerald-400" : "text-red-400"
                                        }`}
                                      >
                                        {m.val}/10
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {shot.deterministicCheck && (
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-tabular text-xs text-slate-300">
                                  <span
                                    className={
                                      shot.deterministicCheck.passed
                                        ? "text-emerald-400"
                                        : "text-red-400"
                                    }
                                  >
                                    FFmpeg Check:{" "}
                                    {shot.deterministicCheck.passed ? "PASS" : "FAIL"}
                                  </span>
                                  <span>مدت: {shot.deterministicCheck.duration_sec}s</span>
                                  <span>
                                    فریم سیاه:{" "}
                                    {shot.deterministicCheck.black_frames_detected ? "دارد ✕" : "ندارد ✓"}
                                  </span>
                                  <span>
                                    فریز:{" "}
                                    {shot.deterministicCheck.frozen_frames_detected ? "دارد ✕" : "ندارد ✓"}
                                  </span>
                                </div>
                              )}

                              {shot.criticReport && (
                                <div className="space-y-2 text-xs">
                                  <p className="text-slate-200 leading-6">
                                    <span className="font-semibold text-amber-300">حکم ناظر QA: </span>
                                    {shot.criticReport.verdict_reason}
                                  </p>
                                  {shot.criticReport.issues.length > 0 && (
                                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-1.5">
                                      {shot.criticReport.issues.map((iss, idx) => (
                                        <div key={idx} className="text-xs leading-5 text-red-200">
                                          <span className="font-semibold">{iss.frame}:</span>{" "}
                                          {iss.problem}{" "}
                                          <span className="text-amber-300">← اصلاح: {iss.fix}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Extracted Frames Filmstrip */}
                              {shot.frameUrls.length > 0 && (
                                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                                  {shot.frameUrls.map((fUrl, fIdx) => (
                                    <img
                                      key={fIdx}
                                      src={fUrl}
                                      alt={`${shot.shot_id} frame ${fIdx + 1}`}
                                      className="h-20 w-auto rounded border border-[#262B38] bg-[#0B0D11] object-contain shrink-0"
                                    />
                                  ))}
                                </div>
                              )}

                              {/* Human-in-the-loop manual retry control */}
                              {(shot.status === "needs_human_review" ||
                                shot.status === "error" ||
                                shot.status === "passed") && (
                                <div className="flex flex-col gap-2 border-t border-[#262B38] pt-3 sm:flex-row sm:items-center">
                                  <input
                                    type="text"
                                    value={retryInstruction[shot.shot_id] || ""}
                                    disabled={isRetrying || isVideoRunning}
                                    onChange={(e) =>
                                      setRetryInstruction((prev) => ({
                                        ...prev,
                                        [shot.shot_id]: e.target.value,
                                      }))
                                    }
                                    placeholder="دستور اصلاح دستی این شات (مثلاً: فونت تیتر بزرگ‌تر و داده‌ها روی نمودار)..."
                                    className="w-full rounded-md border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    disabled={isRetrying || isVideoRunning}
                                    onClick={() => handleRetryShot(shot.shot_id)}
                                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#262B38] bg-[#1B1F2A] px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    <RefreshCw
                                      className={`h-3.5 w-3.5 ${isRetrying ? "animate-spin" : ""}`}
                                    />
                                    <span>
                                      {isRetrying ? "در حال بازسازی..." : "اصلاح و بازسازی شات"}
                                    </span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-8 text-center space-y-2">
              <Film className="mx-auto h-8 w-8 text-amber-400" />
              <div className="text-sm font-bold text-slate-100">
                آماده ساخت ویدیوی واقعی MP4 از دکوپاژ تاییدشده
              </div>
              <p className="mx-auto max-w-xl text-xs leading-6 text-slate-400">
                با زدن دکمه بالا، پایپ‌لاین ۱۰ مرحله‌ای LangGraph هر شات را در Remotion رندر می‌کند،
                فریم‌ها را با FFmpeg می‌سنجد و پیش از مونتاژ نهایی، با مدل بینایی ممیزی می‌کند.
              </p>
            </div>
          )}
        </div>
      ) : (
        /* Preserved SVG Storyboard Sub-View */
        <div className="space-y-6">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowCaptions((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
            >
              {showCaptions ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span>{showCaptions ? "مخفی کردن زیرنویس" : "نمایش زیرنویس روی شات"}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {data.shots.map((asset) => {
              const dirShot = directorShots.find((d) => d.shotNumber === asset.shotNumber);
              const isShotBusy = busyShot === asset.shotNumber || isRunning;

              return (
                <article
                  key={asset.shotNumber}
                  className="flex flex-col overflow-hidden rounded-xl border border-[#262B38] bg-[#14171F]"
                >
                  <div className="relative aspect-[9/16] w-full overflow-hidden bg-[#0B0D11]">
                    {asset.imageUrl ? (
                      <img
                        src={asset.imageUrl}
                        alt={`استوری‌بورد شات ${asset.shotNumber}`}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                        در انتظار تصویرسازی شات
                      </div>
                    )}

                    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/75 to-transparent px-3.5 py-3 text-xs">
                      <span className="font-mono-tabular font-semibold text-amber-400">
                        شات {String(asset.shotNumber).padStart(2, "0")}
                      </span>
                      {dirShot && (
                        <span className="font-mono-tabular text-slate-200">{dirShot.timecode}</span>
                      )}
                    </div>

                    {showCaptions && dirShot?.onScreenText && (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-5 pt-10 text-center">
                        <div className="text-sm font-bold leading-6 text-white drop-shadow">
                          {dirShot.onScreenText}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setLightboxShot({ asset, director: dirShot })}
                      aria-label={`بزرگ‌نمایی شات ${asset.shotNumber}`}
                      className="absolute bottom-3 left-3 rounded-md border border-white/15 bg-black/60 p-1.5 text-slate-200 transition-colors hover:bg-black/85 hover:text-amber-400"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex flex-1 flex-col justify-between space-y-3 p-4">
                    <div className="space-y-2">
                      <div className="text-xs text-slate-400">
                        {dirShot?.cameraAngle} · {asset.motionCue}
                      </div>
                      <p className="text-xs leading-6 text-slate-300">
                        {dirShot?.sceneDescriptionFa || asset.colorPaletteNote}
                      </p>
                    </div>

                    <div className="space-y-2 border-t border-[#262B38] pt-3">
                      <input
                        type="text"
                        value={shotFeedback[asset.shotNumber] || ""}
                        disabled={isShotBusy}
                        onChange={(e) =>
                          setShotFeedback((prev) => ({
                            ...prev,
                            [asset.shotNumber]: e.target.value,
                          }))
                        }
                        placeholder="تغییر بصری این شات (مثلاً: زاویه بسته‌تر و نور آبی)..."
                        className="w-full rounded-md border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={isShotBusy}
                          onClick={() => handleRegenOne(asset.shotNumber)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#262B38] bg-[#1B1F2A] px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/50 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${isShotBusy ? "animate-spin" : ""}`}
                          />
                          <span>{isShotBusy ? "در حال بازساخت..." : "بازتولید این شات"}</span>
                        </button>

                        {asset.imageUrl && (
                          <a
                            href={asset.imageUrl}
                            download={`shot_${asset.shotNumber}.svg`}
                            className="inline-flex items-center justify-center rounded-md border border-[#262B38] bg-[#0B0D11] p-2 text-slate-300 transition-colors hover:text-amber-400"
                            title="دانلود فایل استوری‌بورد SVG"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Checkpoint 4 Finalization Bar */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={globalFeedback}
              disabled={isRunning}
              onChange={(e) => setGlobalFeedback(e.target.value)}
              placeholder="اصلاح کلی سبک بصری همه شات‌ها..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onRegenerateAll(globalFeedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              <span>بازتولید کل استوری‌بورد</span>
            </button>
          </div>

          {!isCompleted ? (
            <button
              type="button"
              disabled={isRunning}
              onClick={onFinalize}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>تایید نهایی و تکمیل پروژه</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              <span>پروژه با موفقیت نهایی شد</span>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxShot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setLightboxShot(null)}
        >
          <div
            className="relative grid max-h-[90vh] w-full max-w-3xl grid-cols-1 overflow-hidden rounded-xl border border-[#262B38] bg-[#14171F] md:grid-cols-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="aspect-[9/16] max-h-[82vh] w-full bg-[#0B0D11]">
              {lightboxShot.asset.imageUrl && (
                <img
                  src={lightboxShot.asset.imageUrl}
                  alt={`نمای کامل شات ${lightboxShot.asset.shotNumber}`}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain"
                />
              )}
            </div>
            <div className="flex flex-col justify-between p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-[#262B38] pb-3">
                  <span className="font-mono-tabular text-sm font-semibold text-amber-400">
                    شات {String(lightboxShot.asset.shotNumber).padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLightboxShot(null)}
                    className="rounded-md p-1 text-slate-400 hover:bg-[#1B1F2A] hover:text-slate-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {lightboxShot.director && (
                  <>
                    <div>
                      <div className="text-xs text-slate-400">زمان‌بندی و دوربین</div>
                      <div className="mt-1 text-sm text-slate-100">
                        <span className="font-mono-tabular">{lightboxShot.director.timecode}</span> ·{" "}
                        {lightboxShot.director.cameraAngle}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">شرح صحنه</div>
                      <p className="mt-1 text-sm leading-7 text-slate-200">
                        {lightboxShot.director.sceneDescriptionFa}
                      </p>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">متن گفتار</div>
                      <p className="mt-1 text-sm leading-7 text-slate-300">
                        {lightboxShot.director.spokenSegment}
                      </p>
                    </div>
                  </>
                )}
              </div>
              {lightboxShot.asset.imageUrl && (
                <a
                  href={lightboxShot.asset.imageUrl}
                  download={`shot_${lightboxShot.asset.shotNumber}.svg`}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Download className="h-4 w-4" />
                  <span>دانلود استوری‌بورد این شات</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
