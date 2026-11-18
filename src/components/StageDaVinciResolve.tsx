import { useState } from "react";
import {
  CheckCircle2,
  Download,
  Film,
  RefreshCw,
  Sliders,
} from "lucide-react";
import type { DaVinciPackageSummary, ProjectRecord } from "../types/studio";
import { QualityAuditBadge } from "./QualityAuditBadge";

interface StageDaVinciResolveProps {
  project: ProjectRecord;
  pkg: DaVinciPackageSummary;
  isRunning: boolean;
  onAssembleMasterMp4: () => Promise<void>;
  onCompleteProject: () => Promise<void>;
}

export function StageDaVinciResolve({
  project,
  pkg,
  isRunning,
  onAssembleMasterMp4,
  onCompleteProject,
}: StageDaVinciResolveProps) {
  const [codeTab, setCodeTab] = useState<"fcpxml" | "python" | "srt">("fcpxml");
  const [isAssembling, setIsAssembling] = useState(false);

  const handleAssemble = async () => {
    setIsAssembling(true);
    try {
      await onAssembleMasterMp4();
    } finally {
      setIsAssembling(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <span>مرحله ۶ از ۶ · ایجنت ۲ (تدوین خودکار در DaVinci Resolve رایگان)</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono-tabular text-slate-300">
              {pkg.width}×{pkg.height} · {pkg.fps}fps · {pkg.targetLoudnessLufs} LUFS
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            پکیج آماده DaVinci Resolve + مونتاژ خودکار ویدیوی نهایی (MP4)
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/video/comfyui-workflow"
            download="comfyui_reels_lightweight_workflow.json"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs font-medium text-slate-200 hover:border-amber-500/40 hover:text-amber-300 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>ورک‌فلو سبک ComfyUI (.JSON)</span>
          </a>

          <a
            href={`/api/projects/${project.id}/davinci/download`}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4" />
            <span>دانلود پکیج خودکار DaVinci Resolve (.ZIP)</span>
          </a>
        </div>
      </div>

      <QualityAuditBadge audit={pkg.qaAudit} />

      {/* Engineering Specs Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-4">
          <div className="text-[11px] text-slate-400">همگام‌سازی شات و صدا</div>
          <div className="mt-1 font-mono-tabular text-base font-bold text-slate-100">
            {pkg.sfxCuesCount} شات · {pkg.totalDurationSeconds}s
          </div>
        </div>
        <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-4">
          <div className="text-[11px] text-slate-400">استاندارد بلندی صدا و حذف نویز</div>
          <div className="mt-1 font-mono-tabular text-base font-bold text-emerald-400">
            {pkg.targetLoudnessLufs} LUFS + Denoise
          </div>
        </div>
        <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-4">
          <div className="text-[11px] text-slate-400">اصلاح رنگ سینمایی</div>
          <div className="mt-1 truncate text-xs font-bold text-amber-300">
            {pkg.colorGradePreset}
          </div>
        </div>
        <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-4">
          <div className="text-[11px] text-slate-400">زیرنویس فارسی همگام</div>
          <div className="mt-1 font-mono-tabular text-base font-bold text-sky-300">
            {pkg.subtitleLinesCount} خط SRT
          </div>
        </div>
      </div>

      {/* Instant Local Master MP4 Assembly + DaVinci 10-Second Guide */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-6">
          <div className="flex items-center justify-between border-b border-[#262B38] pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
              <Film className="h-4 w-4 text-amber-400" />
              <span>خروجی مستقیم ویدیوی نهایی داخل مرورگر (FFmpeg رایگان)</span>
            </div>
          </div>

          <p className="text-xs leading-6 text-slate-400">
            علاوه بر پکیج DaVinci Resolve، می‌توانید همین الان با یک کلیک تمام شات‌های تاییدشده، صدای گوینده، ترنزیشن‌ها و استاندارد بلندی صدای <span className="font-mono-tabular text-slate-200">-14 LUFS</span> را به ویدیوی نهایی MP4 تبدیل و دانلود کنید.
          </p>

          <button
            type="button"
            disabled={isAssembling || isRunning}
            onClick={() => void handleAssemble()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 py-2.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`h-4 w-4 ${isAssembling ? "animate-spin" : ""}`} />
            <span>
              {isAssembling
                ? "در حال مونتاژ شات‌ها، صدا و تنظیم -14 LUFS..."
                : pkg.masterVideoUrl
                  ? "مونتاژ مجدد ویدیوی نهایی (MP4)"
                  : "مونتاژ و ساخت ویدیوی نهایی پست (MP4)"}
            </span>
          </button>

          {pkg.masterVideoUrl && (
            <div className="space-y-3 rounded-xl border border-[#262B38] bg-[#0B0D11] p-3">
              <video
                key={pkg.masterVideoUrl}
                controls
                playsInline
                src={pkg.masterVideoUrl}
                className="max-h-[360px] w-full rounded-lg object-contain"
              />
              <div className="flex justify-end">
                <a
                  href={pkg.masterVideoUrl}
                  download={`${project.id}_final_post.mp4`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>دانلود مستقیم فایل MP4 نهایی</span>
                </a>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-6">
          <div className="flex items-center gap-2 border-b border-[#262B38] pb-3 text-sm font-bold text-slate-100">
            <Sliders className="h-4 w-4 text-amber-400" />
            <span>راهنمای ۱۰ ثانیه‌ای باز کردن در DaVinci Resolve (نسخه رایگان)</span>
          </div>

          <div className="space-y-3 text-xs leading-7 text-slate-300">
            <div className="rounded-xl border border-[#262B38] bg-[#0B0D11] p-3.5">
              <div className="font-bold text-amber-300">
                روش ۱ (بدون کدنویسی — مخصوص افراد غیرفنی):
              </div>
              <ol className="mt-1 list-decimal space-y-1 pr-4">
                <li>دکمه «دانلود پکیج خودکار DaVinci Resolve (.ZIP)» بالا را بزنید و از حالت فشرده خارج کنید.</li>
                <li>نرم‌افزار رایگان DaVinci Resolve را باز کنید و از منوی بالا <span dir="ltr" className="font-mono-tabular text-slate-100">File &gt; Import &gt; Timeline...</span> را بزنید.</li>
                <li>فایل <span dir="ltr" className="font-mono-tabular text-amber-300">timeline.fcpxml</span> را انتخاب کنید؛ تمام شات‌ها، صدای گوینده و مارکرهای افکت صوتی خودکار چیده می‌شوند!</li>
              </ol>
            </div>

            <div className="rounded-xl border border-[#262B38] bg-[#0B0D11] p-3.5">
              <div className="font-bold text-sky-300">
                روش ۲ (اتوماسیون ۱۰۰٪ با اسکریپت پایتون ایجنت کارگردان):
              </div>
              <p className="mt-1">
                در حالی که DaVinci Resolve باز است، فایل{" "}
                <span dir="ltr" className="font-mono-tabular text-sky-300">
                  davinci_auto_edit.py
                </span>{" "}
                را اجرا کنید تا پروژه، ابعاد عمودی/افقی، رنگ، زیرنویس فارسی و مارکرهای ترنزیشن خودکار ساخته شود.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Generated Automation Files Preview */}
      <section className="space-y-3 rounded-2xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262B38] pb-3">
          <span className="text-sm font-bold text-slate-100">
            فایل‌های تولیدشده داخل پکیج DaVinci Resolve
          </span>
          <div className="flex items-center gap-1.5">
            {[
              { id: "fcpxml", label: "timeline.fcpxml" },
              { id: "python", label: "davinci_auto_edit.py" },
              { id: "srt", label: "subtitles_fa.srt" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setCodeTab(t.id as typeof codeTab)}
                dir="ltr"
                className={`font-mono-tabular rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  codeTab === t.id
                    ? "bg-amber-500 text-slate-950 font-semibold"
                    : "bg-[#0B0D11] text-slate-300 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <pre
          dir={codeTab === "srt" ? "rtl" : "ltr"}
          className="max-h-[260px] overflow-auto rounded-xl border border-[#262B38] bg-[#0B0D11] p-4 font-mono-tabular text-xs leading-6 text-slate-300"
        >
          {codeTab === "fcpxml"
            ? pkg.fcpxmlPreview
            : codeTab === "python"
              ? pkg.pythonScriptPreview
              : pkg.srtPreview}
        </pre>
      </section>

      {project.currentStage !== "completed" && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={isRunning}
            onClick={() => void onCompleteProject()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>ثبت نهایی و آرشیو پست در مغز دوم Obsidian</span>
          </button>
        </div>
      )}
    </div>
  );
}
