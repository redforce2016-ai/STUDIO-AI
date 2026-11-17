import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Download,
  FileCode2,
  Film,
  RefreshCw,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import type { ContentFormatOption, PlatformOption } from "../types/studio";
import type {
  ShotExecutionRecord,
  VideoAspectFormat,
  VideoPipelineRun,
  VideoPreflightStatus,
  VideoQualityMode,
} from "../types/videoPipeline";

interface StageAssemblyProps {
  platform: PlatformOption;
  contentFormat?: ContentFormatOption;
  videoProduction?: VideoPipelineRun | null;
  isRunning: boolean;
  isCompleted: boolean;
  onStartVideoRender: (opts: {
    aspectRatio: VideoAspectFormat;
    qualityMode: VideoQualityMode;
    burnSubtitles: boolean;
    includeBackgroundMusic: boolean;
  }) => Promise<void>;
  onRetryVideoShot: (
    shotId: string,
    humanInstruction?: string
  ) => Promise<void>;
  onExportBible: () => void;
  onFinalize: () => Promise<void>;
}

const NODE_LABELS_FA: Record<string, string> = {
  START: "آماده‌سازی تایم‌لاین تدوین",
  scenario_parser: "۱. تطبیق تایم‌کد سناریو و شات‌ها",
  shot_planner: "۲. چیدمان تایم‌لاین و ترنزیشن‌ها",
  tool_router: "۳. مسیریابی موتور رندر و صدا",
  builder: "۴. ترکیب کامپوننت‌های Remotion",
  renderer: "۵. رندر واقعی سکانس‌های MP4",
  frame_extractor: "۶. استخراج فریم و تست FFmpeg",
  visual_critic: "۷. ممیزی بصری (Vision QA)",
  decision: "۸. حلقه کنترل و رفع خطا",
  assembler: "۹. میکس صدا، موزیک، زیرنویس و تراز -14 LUFS",
  final_qa: "۱۰. تایید نهایی ویدیوی آماده انتشار",
  human_retry: "بازسازی شات با دستور تدوینگر",
};

const SHOT_STATUS_FA: Record<
  ShotExecutionRecord["status"],
  { label: string; color: string }
> = {
  pending: { label: "در صف", color: "text-slate-400" },
  planning: { label: "برنامه‌ریزی", color: "text-sky-400" },
  building: { label: "ساخت کامپوننت", color: "text-amber-300" },
  rendering: { label: "در حال رندر MP4", color: "text-amber-400" },
  extracting: { label: "بررسی FFmpeg", color: "text-sky-300" },
  critiquing: { label: "ممیزی بینایی QA", color: "text-purple-300" },
  passed: { label: "تایید QA شد", color: "text-emerald-400" },
  retrying: { label: "در حال اصلاح", color: "text-amber-400" },
  needs_human_review: { label: "نیاز به بازبینی انسانی", color: "text-red-400" },
  needs_clarification: { label: "نیازمند بررسی", color: "text-amber-400" },
  error: { label: "خطای اجرا", color: "text-red-400" },
};

export function StageAssembly({
  platform,
  contentFormat,
  videoProduction,
  isRunning,
  isCompleted,
  onStartVideoRender,
  onRetryVideoShot,
  onExportBible,
  onFinalize,
}: StageAssemblyProps) {
  const defaultAspect: VideoAspectFormat =
    contentFormat === "long_video" || platform === "youtube" ? "16:9" : "9:16";

  const [aspectRatio, setAspectRatio] = useState<VideoAspectFormat>(
    videoProduction?.aspectRatio || defaultAspect
  );
  const [qualityMode, setQualityMode] = useState<VideoQualityMode>(
    videoProduction?.qualityMode || "preview_480p"
  );
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [includeMusic, setIncludeMusic] = useState(true);
  const [preflight, setPreflight] = useState<VideoPreflightStatus | null>(null);
  const [isLaunchingRender, setIsLaunchingRender] = useState(false);
  const [retryingShotId, setRetryingShotId] = useState<string | null>(null);
  const [retryInstruction, setRetryInstruction] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    fetch("/api/video/preflight")
      .then((r) => r.json())
      .then((d) => {
        if (d.preflight) setPreflight(d.preflight);
      })
      .catch(() => {});
  }, []);

  const handleLaunchAssembly = async () => {
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
            <span>مرحله ۵ · تدوین، میکس صدا و مونتاژ نهایی</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="text-slate-400">
              {isCompleted
                ? "پروژه نهایی و تکمیل‌شده"
                : "مونتاژ Remotion + FFmpeg + تراز صدا و خروجی MP4"}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            میز تدوین نهایی، میکس نریشن و خروجی ویدیوی آماده انتشار
          </h2>
        </div>

        <button
          type="button"
          onClick={onExportBible}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5 text-amber-400" />
          <span>خروجی متنی پروژه (MD)</span>
        </button>
      </div>

      {/* Render & Mixing Controls */}
      <section className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-4">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
              <Clapperboard className="h-4 w-4 text-amber-400" />
              <span>تنظیمات تدوین، میکس صدا و رندر MP4</span>
            </h3>
            {preflight && (
              <p className="text-xs text-slate-400">
                موتورهای تدوین: Remotion v4{" "}
                {preflight.remotionAvailable ? "✓" : "✕"} · FFmpeg{" "}
                {preflight.ffmpegAvailable ? "✓" : "✕"} · ComfyUI محلی{" "}
                {preflight.comfyuiAvailable
                  ? "آنلاین ✓"
                  : "آفلاین (فال‌بک خودکار به Parallax)"}{" "}
                · پروفایل سخت‌افزار:{" "}
                {preflight.hardwareProfile || "parallax_only"}
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={isVideoRunning || isRunning || preflight?.ready === false}
            onClick={() => void handleLaunchAssembly()}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Film
              className={`h-4 w-4 ${isVideoRunning ? "animate-pulse" : ""}`}
            />
            <span>
              {isVideoRunning
                ? "در حال تدوین، میکس و رندر نهایی..."
                : videoProduction
                  ? "مونتاژ و رندر مجدد ویدیوی نهایی MP4"
                  : "شروع تدوین، میکس صدا و رندر نهایی MP4"}
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
              onChange={(e) =>
                setAspectRatio(e.target.value as VideoAspectFormat)
              }
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            >
              <option value="9:16">عمودی ۹:۱۶ (ریلز / شورتس / تیک‌تاک)</option>
              <option value="16:9">افقی ۱۶:۹ (یوتیوب / وب)</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              کیفیت خروجی تدوین
            </label>
            <select
              value={qualityMode}
              disabled={isVideoRunning}
              onChange={(e) =>
                setQualityMode(e.target.value as VideoQualityMode)
              }
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            >
              <option value="preview_480p">پیش‌نمایش سریع (480p)</option>
              <option value="final_1080p">کیفیت نهایی انتشار (1080p)</option>
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={burnSubtitles}
              disabled={isVideoRunning}
              onChange={(e) => setBurnSubtitles(e.target.checked)}
              className="accent-amber-500"
            />
            <span>حک دائمی زیرنویس فارسی (Burn-in)</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={includeMusic}
              disabled={isVideoRunning}
              onChange={(e) => setIncludeMusic(e.target.checked)}
              className="accent-amber-500"
            />
            <span>میکس موزیک پس‌زمینه + Ducking</span>
          </label>
        </div>

        {preflight && !preflight.ready && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            پیش‌نیازهای بحرانی ناقص است: {preflight.missingCritical.join(" · ")}
          </div>
        )}
      </section>

      {/* Active Assembly & Final Player */}
      {videoProduction ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#262B38] bg-[#14171F] px-5 py-4">
            <div className="flex items-center gap-3">
              {videoProduction.status === "completed" ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              ) : videoProduction.status === "error" ||
                videoProduction.status === "needs_human_review" ? (
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
              ) : (
                <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              )}
              <div>
                <div className="text-sm font-bold text-slate-100">
                  {NODE_LABELS_FA[videoProduction.currentNode] ||
                    videoProduction.currentNode}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  وضعیت مونتاژ:{" "}
                  {videoProduction.status === "completed"
                    ? "تاییدشده و آماده انتشار"
                    : videoProduction.status === "needs_human_review"
                      ? "توقف امن: یک یا چند شات نیاز به بازبینی دارند"
                      : videoProduction.status === "error"
                        ? videoProduction.errorMessage || "خطا در اجرای مونتاژ"
                        : "در حال میکس صدا، تصویر و ممیزی نهایی..."}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 font-mono-tabular text-xs text-slate-300">
              <span>فرمت: {videoProduction.aspectRatio}</span>
              <span>·</span>
              <span>
                کیفیت:{" "}
                {videoProduction.qualityMode === "final_1080p"
                  ? "1080p"
                  : "480p"}
              </span>
              <span>·</span>
              <span>
                شات‌های تاییدشده:{" "}
                {videoProduction.shots.filter((s) => s.status === "passed").length}/
                {videoProduction.shots.length}
              </span>
            </div>
          </div>

          {videoProduction.finalVideoUrl && (
            <section className="space-y-5 rounded-xl border border-emerald-500/35 bg-[#14171F] p-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-4">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                  <ShieldCheck className="h-5 w-5" />
                  <span>خروجی ویدیوی مونتاژشده نهایی MP4</span>
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
                      <span>دانلود زیرنویس SRT</span>
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
                      <span>گزارش QA</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
                <div className="flex justify-center rounded-xl border border-[#262B38] bg-[#0B0D11] p-3 lg:col-span-5">
                  <video
                    key={videoProduction.finalVideoUrl}
                    controls
                    src={videoProduction.finalVideoUrl}
                    className={`rounded-lg bg-black ${
                      videoProduction.aspectRatio === "9:16"
                        ? "max-h-[460px] w-auto"
                        : "aspect-video w-full"
                    }`}
                  />
                </div>

                <div className="space-y-4 lg:col-span-7">
                  {videoProduction.finalQa && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3 border-b border-[#262B38] pb-4 sm:grid-cols-4">
                        <div>
                          <div className="text-[11px] text-slate-400">
                            مدت دقیق
                          </div>
                          <div className="mt-1 font-mono-tabular text-sm font-bold text-slate-100">
                            {videoProduction.finalQa.duration_sec}s
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-400">
                            رزولوشن و FPS
                          </div>
                          <div className="mt-1 font-mono-tabular text-sm font-bold text-slate-100">
                            {videoProduction.finalQa.width}×
                            {videoProduction.finalQa.height} ·{" "}
                            {videoProduction.finalQa.fps}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-400">
                            بلندی صدا (Mean)
                          </div>
                          <div className="mt-1 flex items-center gap-1 font-mono-tabular text-sm font-bold text-slate-100">
                            <Volume2 className="h-3.5 w-3.5 text-amber-400" />
                            <span>
                              {videoProduction.finalQa.mean_volume_db !== null
                                ? `${videoProduction.finalQa.mean_volume_db} dB`
                                : "بی‌کلام"}
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-400">
                            نمره پیوستگی QA
                          </div>
                          <div className="mt-1 font-mono-tabular text-sm font-bold text-emerald-400">
                            {videoProduction.finalQa.continuity_score}/10
                          </div>
                        </div>
                      </div>

                      <div className="text-xs leading-6 text-slate-300">
                        {videoProduction.finalQa.summary}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {videoProduction.shots.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-[#262B38] bg-[#14171F]">
              <div className="flex items-center justify-between border-b border-[#262B38] px-5 py-3.5">
                <h3 className="text-sm font-bold text-slate-100">
                  جزئیات شات‌های رندرشده داخل تایم‌لاین تدوین
                </h3>
              </div>

              <div className="divide-y divide-[#262B38]">
                {videoProduction.shots.map((shot) => {
                  const st = SHOT_STATUS_FA[shot.status];
                  const isRetrying = retryingShotId === shot.shot_id;
                  return (
                    <div key={shot.shot_id} className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono-tabular font-bold text-amber-400">
                            {shot.shot_id}
                          </span>
                          <span className={`font-semibold ${st.color}`}>
                            {st.label}
                          </span>
                          <span className="text-slate-400">
                            ({shot.toolUsed})
                          </span>
                        </div>
                        <span className="text-slate-300">{shot.spec.intent}</span>
                      </div>

                      {(shot.status === "needs_human_review" ||
                        shot.status === "error" ||
                        shot.status === "passed") && (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                            placeholder="دستور اصلاح دستی این سکانس در تدوین..."
                            className="w-full rounded-md border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={isRetrying || isVideoRunning}
                            onClick={() => void handleRetryShot(shot.shot_id)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#262B38] bg-[#1B1F2A] px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${isRetrying ? "animate-spin" : ""}`}
                            />
                            <span>
                              {isRetrying
                                ? "در حال بازسازی..."
                                : "بازسازی و تدوین مجدد"}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-[#262B38] bg-[#14171F] p-8 text-center">
          <Film className="mx-auto h-8 w-8 text-amber-400" />
          <div className="text-sm font-bold text-slate-100">
            همه شات‌ها و فایل صوتی نریشن آماده مونتاژ نهایی است
          </div>
          <p className="mx-auto max-w-xl text-xs leading-6 text-slate-400">
            دکمه «شروع تدوین، میکس صدا و رندر نهایی MP4» را بزنید تا شات‌های تاییدشده، صدای نریشن مرحله ۴، موزیک پس‌زمینه و زیرنویس فارسی در قالب یک ویدیوی نهایی MP4 مونتاژ شوند.
          </p>
        </div>
      )}

      {/* Final Project Approval Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="text-xs leading-6 text-slate-300">
          پس از بررسی و دانلود خروجی تدوین نهایی، پروژه را تکمیل و آرشیو کنید.
        </div>

        {!isCompleted ? (
          <button
            type="button"
            disabled={isRunning || isVideoRunning}
            onClick={onFinalize}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>تایید نهایی و تکمیل پروژه</span>
          </button>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            <span>پروژه با موفقیت تکمیل و نهایی شد</span>
          </div>
        )}
      </div>
    </div>
  );
}
