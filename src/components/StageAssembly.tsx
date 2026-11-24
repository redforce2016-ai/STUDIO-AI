import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Code2,
  Download,
  FileCode2,
  Film,
  Image as ImageIcon,
  Layers,
  Mic,
  RefreshCw,
  ShieldCheck,
  Video,
  Volume2,
} from "lucide-react";
import type {
  ContentFormatOption,
  PlatformOption,
  ProjectRecord,
} from "../types/studio";
import type {
  CinemaLookPreset,
  KineticSubtitleStylePreset,
  ShotExecutionRecord,
  VideoAspectFormat,
  VideoPipelineRun,
  VideoPreflightStatus,
  VideoQualityMode,
} from "../types/videoPipeline";
import { downloadFileReliably } from "../lib/downloadFile";

interface StageAssemblyProps {
  project: ProjectRecord;
  platform: PlatformOption;
  contentFormat?: ContentFormatOption;
  videoProduction?: VideoPipelineRun | null;
  isRunning: boolean;
  isCompleted: boolean;
  onStartVideoRender: (opts: {
    aspectRatio: VideoAspectFormat;
    qualityMode: VideoQualityMode;
    burnSubtitles: boolean;
    subtitleStylePreset: KineticSubtitleStylePreset;
    includeBackgroundMusic: boolean;
    colorGradePreset: CinemaLookPreset;
    musicSource: "lyria" | "ambient_cinema" | "none";
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
  project,
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
    videoProduction?.qualityMode || "final_1080p"
  );
  const [colorGradePreset, setColorGradePreset] = useState<CinemaLookPreset>(
    videoProduction?.colorGradePreset || "industrial_teal_amber"
  );
  const [musicSource, setMusicSource] = useState<"lyria" | "ambient_cinema" | "none">(
    videoProduction?.musicSource || "ambient_cinema"
  );
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [subtitleStylePreset, setSubtitleStylePreset] =
    useState<KineticSubtitleStylePreset>(
      videoProduction?.subtitleStylePreset || "industrial_steel_blue"
    );
  const [includeMusic, setIncludeMusic] = useState(true);
  const [preflight, setPreflight] = useState<VideoPreflightStatus | null>(null);
  const [isLaunchingRender, setIsLaunchingRender] = useState(false);
  const [retryingShotId, setRetryingShotId] = useState<string | null>(null);
  const [retryInstruction, setRetryInstruction] = useState<
    Record<string, string>
  >({});
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState<number>(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showProNleExports, setShowProNleExports] = useState(false);

  const handleReliableDownload = async (
    key: string,
    url: string,
    filename: string,
    mimeType?: string
  ) => {
    setDownloadError(null);
    setDownloadingKey(key);
    setDownloadPercent(1);
    try {
      await downloadFileReliably({
        url,
        filename,
        mimeType,
        onProgress: (pct) => setDownloadPercent(pct),
      });
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : "خطا در دانلود فایل."
      );
    } finally {
      setDownloadingKey(null);
      setDownloadPercent(0);
    }
  };

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
        subtitleStylePreset,
        includeBackgroundMusic: includeMusic && musicSource !== "none",
        colorGradePreset,
        musicSource: includeMusic ? musicSource : "none",
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

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/projects/${project.id}/export/all-zip`}
            download={`${project.id}_complete_studio_outputs.zip`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0"
          >
            <Archive className="h-3.5 w-3.5" />
            <span>دانلود یکجای همه خروجی‌ها (.ZIP)</span>
          </a>
          <button
            type="button"
            onClick={() => setShowProNleExports((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
          >
            <Layers className="h-3.5 w-3.5 text-sky-400" />
            <span>خروجی‌های تدوینگر حرفه‌ای</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showProNleExports ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {showProNleExports && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#262B38] bg-[#14171F] px-4 py-3">
          <span className="text-[11px] font-semibold text-slate-400 ml-2">فایل‌های پروژه NLE:</span>
          <a
            href={`/api/projects/${project.id}/export/davinci-fcpxml`}
            download={`${project.id}_davinci_timeline.fcpxml`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 whitespace-nowrap shrink-0"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>DaVinci (.fcpxml)</span>
          </a>
          <a
            href={videoProduction?.otioUrl || `/api/projects/${project.id}/export/davinci-otio`}
            download={`${project.id}_timeline.otio`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 whitespace-nowrap shrink-0"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>OpenTimelineIO (.otio)</span>
          </a>
          <a
            href={videoProduction?.cubeLutUrl || `/api/projects/${project.id}/export/cinema-lut?preset=${colorGradePreset}`}
            download={`${project.id}_cinema_grade.cube`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 whitespace-nowrap shrink-0"
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>LUT رنگی (.cube)</span>
          </a>
          <a
            href={videoProduction?.afterEffectsJsxUrl || `/api/projects/${project.id}/export/after-effects-jsx`}
            download={`${project.id}_after_effects_builder.jsx`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 transition-colors hover:bg-purple-500/20 whitespace-nowrap shrink-0"
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>After Effects (.jsx)</span>
          </a>
          <button
            type="button"
            onClick={onExportBible}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-amber-400" />
            <span>خروجی متنی پروژه (MD)</span>
          </button>
        </div>
      )}

      {/* Render & Mixing Controls */}
      <section className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
              <Clapperboard className="h-4 w-4 text-amber-400" />
              <span>ساخت و خروجی نهایی ویدیو (تنظیم خودکار بهترین کیفیت)</span>
            </h3>
            <p className="text-xs text-slate-400">
              پریست خودکار فعال: فرمت {aspectRatio} · کیفیت {qualityMode === "final_1080p" ? "1080p سینمایی" : "480p سریع"} · اصلاح رنگ سینمایی · زیرنویس فارسی همگام با صدا · میکس تراز ‎-14 LUFS
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvancedSettings((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs font-medium text-slate-300 hover:border-slate-500 whitespace-nowrap shrink-0"
            >
              <span>{showAdvancedSettings ? "بستن تنظیمات" : "تنظیمات پیشرفته (اختیاری)"}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvancedSettings ? "rotate-180" : ""}`} />
            </button>

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
        </div>

        {showAdvancedSettings && (
        <div className="grid grid-cols-1 gap-4 border-t border-[#262B38] pt-4 md:grid-cols-3">
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
              <option value="final_1080p">کیفیت مستر سینمایی (1080p · 24fps)</option>
              <option value="preview_480p">پیش‌نمایش سریع (480p)</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              پروفایل اصلاح رنگ و LUT 3D
            </label>
            <select
              value={colorGradePreset}
              disabled={isVideoRunning}
              onChange={(e) =>
                setColorGradePreset(e.target.value as CinemaLookPreset)
              }
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            >
              <option value="industrial_teal_amber">سینمایی صنعتی (Teal & Amber + هاله نور + گرین)</option>
              <option value="kodak_2383_film">فیلم سینمایی Kodak 2383</option>
              <option value="documentary_clean">مستند تمیز Rec.709</option>
              <option value="none">بدون اصلاح رنگ (خام)</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              موسیقی متن و آمبیانس صحنه
            </label>
            <select
              value={musicSource}
              disabled={isVideoRunning}
              onChange={(e) =>
                setMusicSource(e.target.value as "lyria" | "ambient_cinema" | "none")
              }
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            >
              <option value="lyria">Lyria AI + فال‌بک سینمایی چندلایه‌ای</option>
              <option value="ambient_cinema">موسیقی متن صنعتی سینمایی (FFmpeg)</option>
              <option value="none">بدون موسیقی متن</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              استایل تایپوگرافی و زیرنویس کینتیک همگام با صدا (ASS)
            </label>
            <select
              value={subtitleStylePreset}
              disabled={isVideoRunning || !burnSubtitles}
              onChange={(e) =>
                setSubtitleStylePreset(e.target.value as KineticSubtitleStylePreset)
              }
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none disabled:opacity-50"
            >
              <option value="industrial_steel_blue">
                تایپوگرافی صنعتی آبی-سفید (Vazirmatn + Lalezar + کارائوکه کلمه‌ای)
              </option>
              <option value="cinema_gold">
                سینمایی طلایی-سفید (Vazirmatn + Lalezar + هایلایت فعال)
              </option>
              <option value="viral_karaoke">
                تایپوگرافی کوبنده ریلز (Lalezar + انیمیشن فنری پاپ)
              </option>
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
            <span>حک زیرنویس کینتیک فارسی همگام با صدای واقعی (ASS + Vazirmatn)</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={includeMusic}
              disabled={isVideoRunning}
              onChange={(e) => setIncludeMusic(e.target.checked)}
              className="accent-amber-500"
            />
            <span>میکس صدا + صدای محیط شات‌ها + Ducking (-14 LUFS)</span>
          </label>
        </div>
        )}

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
                  <button
                    type="button"
                    disabled={downloadingKey !== null}
                    onClick={() =>
                      handleReliableDownload(
                        "mp4",
                        `/api/projects/${project.id}/video/download`,
                        `${project.id}_reel_1080p.mp4`,
                        "video/mp4"
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>
                      {downloadingKey === "mp4"
                        ? `در حال دانلود MP4 (${downloadPercent}%)...`
                        : "دانلود ویدیو MP4"}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={downloadingKey !== null}
                    onClick={() =>
                      handleReliableDownload(
                        "zip",
                        `/api/projects/${project.id}/export/all-zip`,
                        `${project.id}_complete_studio_outputs.zip`,
                        "application/zip"
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    <span>
                      {downloadingKey === "zip"
                        ? `در حال دانلود ZIP (${downloadPercent}%)...`
                        : "دانلود پکیج کامل (.ZIP)"}
                    </span>
                  </button>
                  {videoProduction.assSubtitleUrl && (
                    <button
                      type="button"
                      disabled={downloadingKey !== null}
                      onClick={() =>
                        handleReliableDownload(
                          "ass",
                          videoProduction.assSubtitleUrl!,
                          `${videoProduction.runId}_kinetic_subtitles.ass`,
                          "text/plain; charset=utf-8"
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3.5 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>زیرنویس کینتیک (.ASS)</span>
                    </button>
                  )}
                  {videoProduction.srtUrl && (
                    <button
                      type="button"
                      disabled={downloadingKey !== null}
                      onClick={() =>
                        handleReliableDownload(
                          "srt",
                          videoProduction.srtUrl!,
                          `${videoProduction.runId}_subtitles.srt`,
                          "text/plain; charset=utf-8"
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/40 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 text-amber-400" />
                      <span>دانلود زیرنویس SRT</span>
                    </button>
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

              {downloadError && (
                <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {downloadError}
                </div>
              )}

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

                  {/* Voiceover Master Track + DaVinci Resolve Native Export Box */}
                  {project.voiceover?.audioUrl && (
                    <div className="space-y-2 rounded-lg border border-[#262B38] bg-[#0B0D11] p-3.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                          <Mic className="h-3.5 w-3.5 text-amber-400" />
                          <span>صدای مستر نریشن فارسی ({project.voiceover.voiceName})</span>
                        </span>
                        <a
                          href={project.voiceover.audioUrl}
                          download={`${project.id}_voiceover.wav`}
                          className="text-[11px] font-medium text-amber-400 hover:underline"
                        >
                          دانلود WAV
                        </a>
                      </div>
                      <audio
                        controls
                        src={project.voiceover.audioUrl}
                        className="h-9 w-full"
                      />
                    </div>
                  )}

                  <div className="space-y-2.5 rounded-lg border border-sky-500/30 bg-sky-950/20 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-sky-300">
                        <Layers className="h-4 w-4" />
                        <span>خروجی تدوین و مسترینگ حرفه‌ای (DaVinci Resolve + After Effects + Video Effects Craft)</span>
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        LUT3D .cube · OTIO · FCPXML · ExtendScript .jsx
                      </span>
                    </div>
                    <p className="text-[11px] leading-5 text-slate-300">
                      موتور مسترینگ سینمایی علاوه بر رندر مستر MP4 با 3D LUT، هاله نور، ترنزیشن xfade، زیرنویس کینتیک ASS همگام با صدا و تراز ‎-14 LUFS‏، پروژه کامل قابل ادیت در DaVinci Resolve و اسکریپت خودکار Adobe After Effects (.jsx) را تولید می‌کند:
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={videoProduction.afterEffectsJsxUrl || `/api/projects/${project.id}/export/after-effects-jsx`}
                        download={`${project.id}_after_effects_builder.jsx`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-purple-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-purple-400"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                        <span>اسکریپت خودکار After Effects (.jsx)</span>
                      </a>
                      <a
                        href={`/api/projects/${project.id}/export/davinci-fcpxml`}
                        download={`${project.id}_davinci_timeline.fcpxml`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-sky-400"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>دانلود تایم‌لاین DaVinci (.fcpxml)</span>
                      </a>
                      <a
                        href={videoProduction.otioUrl || `/api/projects/${project.id}/export/davinci-otio`}
                        download={`${project.id}_timeline.otio`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/25"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        <span>دانلود OpenTimelineIO (.otio)</span>
                      </a>
                      <a
                        href={videoProduction.cubeLutUrl || `/api/projects/${project.id}/export/cinema-lut?preset=${colorGradePreset}`}
                        download={`${project.id}_cinema_grade.cube`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                        <span>دانلود 3D LUT سینمایی (.cube)</span>
                      </a>
                      <a
                        href={`/api/projects/${project.id}/export/davinci-script`}
                        download={`${project.id}_davinci_edit_grade.py`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                        <span>اسکریپت رنگ DaVinci (.py)</span>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Complete Visual Deliverable Gallery: 1) Storyboard Keyframes + 2) Per-Shot Videos */}
          {project.director && project.director.shots.length > 0 && (
            <div className="space-y-6">
              {/* Block 1: Storyboard Outputs */}
              <section
                aria-label="خروجی‌های تولیدشده در استوری‌بورد"
                className="space-y-4 rounded-xl border border-[#262B38] bg-[#14171F] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262B38] pb-3.5">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
                    <ImageIcon className="h-4 w-4 text-amber-400" />
                    <span>
                      ۱. خروجی‌های تولیدشده در استوری‌بورد ({project.director.shots.length} فریم کلیدی)
                    </span>
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    نسبت تصویر {aspectRatio} · فریم‌های پایه مرحله ۲
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
                  {project.director.shots.map((shot) => {
                    const vis = project.visuals?.shots.find(
                      (v) => v.shotNumber === shot.shotNumber
                    );
                    return (
                      <div
                        key={`sb_${shot.shotNumber}`}
                        className="overflow-hidden rounded-lg border border-[#262B38] bg-[#0B0D11]"
                      >
                        <div className="relative aspect-[9/16] w-full bg-black">
                          {vis?.imageUrl ? (
                            <img
                              src={vis.imageUrl}
                              alt={`فریم استوری‌بورد شات ${shot.shotNumber}: ${shot.onScreenText || shot.sceneDescriptionFa}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
                              بدون فریم
                            </div>
                          )}
                          <span className="absolute right-1.5 top-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-400">
                            شات {shot.shotNumber}
                          </span>
                        </div>
                        <div className="space-y-1 p-2">
                          <div className="font-mono text-[10px] text-slate-400">
                            {shot.timecode} · {shot.durationSeconds}s
                          </div>
                          <div className="line-clamp-2 text-[11px] font-medium leading-4 text-slate-200">
                            {shot.onScreenText || shot.sceneDescriptionFa}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Block 2: Individual Shot Videos */}
              <section
                aria-label="خروجی‌های ویدیویی هر شات"
                className="space-y-4 rounded-xl border border-[#262B38] bg-[#14171F] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262B38] pb-3.5">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
                    <Video className="h-4 w-4 text-emerald-400" />
                    <span>
                      ۲. خروجی‌های ویدیویی تولیدشده برای هر شات ({project.director.shots.length} کلیپ MP4)
                    </span>
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    تبدیل فریم‌های استوری‌بورد به کلیپ‌های متحرک مستقل
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {project.director.shots.map((shot) => {
                    const vis = project.visuals?.shots.find(
                      (v) => v.shotNumber === shot.shotNumber
                    );
                    const prodShot = videoProduction?.shots.find(
                      (s) => s.shot_number === shot.shotNumber
                    );
                    const clipUrl = vis?.videoUrl || prodShot?.renderUrl || null;
                    return (
                      <div
                        key={`vid_${shot.shotNumber}`}
                        className="flex flex-col overflow-hidden rounded-xl border border-[#262B38] bg-[#0B0D11]"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-[#262B38] px-3 py-2 text-xs">
                          <span className="font-bold text-amber-400 whitespace-nowrap shrink-0">
                            ویدیوی شات {shot.shotNumber}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                            {shot.timecode} · {shot.durationSeconds}s
                          </span>
                        </div>
                        <div className="flex flex-col items-center justify-center bg-black p-2">
                          {clipUrl ? (
                            <video
                              controls
                              loop
                              playsInline
                              poster={vis?.imageUrl || undefined}
                              src={clipUrl}
                              className="max-h-[280px] w-auto rounded bg-black"
                            />
                          ) : (
                            <div className="flex h-44 items-center justify-center text-xs text-slate-500">
                              ویدیوی این شات هنوز رندر نشده است
                            </div>
                          )}
                          {(vis?.renderEngineUsed || prodShot?.toolUsed) && (
                            <div className="mt-1.5 flex w-full items-center justify-between px-1 font-mono text-[10px] text-slate-400">
                              <span>{vis?.renderEngineUsed || prodShot?.toolUsed}</span>
                              {vis?.hasDiegeticAudio && (
                                <span className="text-emerald-400">صدای محیط ✓</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-[#262B38] px-3 py-2 text-[11px]">
                          <span
                            className="truncate text-slate-300"
                            title={shot.cameraMovement}
                          >
                            {shot.onScreenText || shot.sceneDescriptionFa}
                          </span>
                          {clipUrl && (
                            <a
                              href={clipUrl}
                              download={`shot_${String(shot.shotNumber).padStart(2, "0")}.mp4`}
                              className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-400 hover:underline whitespace-nowrap"
                            >
                              <Download className="h-3 w-3" />
                              <span>MP4</span>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
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
