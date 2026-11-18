import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Download,
  Film,
  Lock,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type {
  DirectorOutput,
  LocalEngineStatus,
  LocalVideoEngineId,
  ShotVideoApprovalStatus,
  ShotVideoClipRecord,
  VisualAssetsOutput,
} from "../types/studio";
import { QualityAuditBadge } from "./QualityAuditBadge";

interface StageShotVideosProps {
  director: DirectorOutput;
  visuals: VisualAssetsOutput | null;
  shotClips: ShotVideoClipRecord[];
  preferredEngine?: LocalVideoEngineId;
  isRunning: boolean;
  onRenderShotVideo: (
    shotNumber: number,
    revisionNote?: string,
    engineId?: LocalVideoEngineId
  ) => Promise<void>;
  onRenderAllShots?: (engineId: LocalVideoEngineId) => Promise<void>;
  onApproveShotVideo: (
    shotNumber: number,
    status: ShotVideoApprovalStatus,
    revisionNote?: string
  ) => Promise<void>;
  onAdvanceToVoiceover: () => Promise<void>;
}

export function StageShotVideos({
  director,
  visuals,
  shotClips,
  preferredEngine,
  isRunning,
  onRenderShotVideo,
  onRenderAllShots,
  onApproveShotVideo,
  onAdvanceToVoiceover,
}: StageShotVideosProps) {
  const [renderingShotNum, setRenderingShotNum] = useState<number | null>(null);
  const [isRenderingAll, setIsRenderingAll] = useState(false);
  const [revisionInputs, setRevisionInputs] = useState<Record<number, string>>({});
  const [engines, setEngines] = useState<LocalEngineStatus[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<LocalVideoEngineId>(
    preferredEngine || "hyperframes_html"
  );
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    fetch("/api/video/engines")
      .then((res) => res.json())
      .then((data) => {
        if (active && Array.isArray(data.engines)) {
          setEngines(data.engines as LocalEngineStatus[]);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Compute sequential unlock state: Shot K unlocks once Shots 1..K-1 are approved
  const progress = useMemo(() => {
    const total = director.shots.length;
    let approvedCount = 0;
    let activeUnlockShotNumber = total;
    let foundUnapproved = false;

    for (let i = 1; i <= total; i++) {
      const clip = shotClips.find((c) => c.shotNumber === i);
      if (clip?.approvalStatus === "approved" && clip.videoUrl) {
        approvedCount += 1;
      } else if (!foundUnapproved) {
        activeUnlockShotNumber = i;
        foundUnapproved = true;
      }
    }

    return {
      approvedCount,
      totalShots: total,
      allApproved: total > 0 && approvedCount === total,
      activeUnlockShotNumber,
    };
  }, [director.shots.length, shotClips]);

  const handleRender = async (shotNumber: number) => {
    setRenderingShotNum(shotNumber);
    try {
      await onRenderShotVideo(shotNumber, revisionInputs[shotNumber], selectedEngine);
    } finally {
      setRenderingShotNum(null);
    }
  };

  const handleRenderAll = async () => {
    if (!onRenderAllShots) return;
    setIsRenderingAll(true);
    try {
      await onRenderAllShots(selectedEngine);
    } finally {
      setIsRenderingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <span>مرحله ۴ از ۶ · ایجنت ۲ (تولید ویدیوی شات‌به‌شات)</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono-tabular text-slate-300">
              تاییدشده: {progress.approvedCount} از {progress.totalShots} شات
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            ساخت و تایید مرحله‌به‌مرحله ویدیوی هر شات (بدون هدررفت زمان و رندر)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            ابتدا ویدیوی شات ۱ را بسازید و تماشا کنید؛ به محض تایید شات ۱، قفل ساخت شات ۲ باز می‌شود تا تمام شات‌ها دقیقاً مطابق سلیقه شما نهایی شوند.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/video/comfyui-workflow"
            download="comfyui_reels_lightweight_workflow.json"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-slate-300 hover:border-amber-500/40 hover:text-amber-300 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>ورک‌فلو سبک ComfyUI (.JSON)</span>
          </a>

          {onRenderAllShots && (
            <button
              type="button"
              disabled={isRunning || isRenderingAll || renderingShotNum !== null}
              onClick={() => void handleRenderAll()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles className={`h-3.5 w-3.5 ${isRenderingAll ? "animate-spin" : ""}`} />
              <span>
                {isRenderingAll
                  ? "در حال رندر و بازبینی تمام شات‌ها..."
                  : "رندر و بازبینی خودکار همه شات‌ها"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Local Lightweight Video Engine Selector */}
      {engines.length > 0 && (
        <section className="rounded-xl border border-[#262B38] bg-[#0B0D11]/75 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-slate-100">
              <Cpu className="h-4 w-4 text-amber-400" />
              <span>انتخاب موتور ساخت ویدیوی لوکال (سازگار با CPU بدون نیاز به گرافیک سنگین)</span>
            </div>
            <span className="text-[11px] text-slate-400">
              فال‌بک هوشمند به HyperFrames در صورت خاموش بودن ComfyUI یا Blender
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            {engines.map((eng) => {
              const active = selectedEngine === eng.id;
              return (
                <button
                  key={eng.id}
                  type="button"
                  disabled={isRunning || isRenderingAll}
                  onClick={() => setSelectedEngine(eng.id)}
                  className={`flex flex-col items-start justify-between rounded-xl border p-3 text-right transition-colors ${
                    active
                      ? "border-amber-500 bg-amber-500/10 text-slate-100"
                      : "border-[#262B38] bg-[#14171F] text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <div className="w-full space-y-1">
                    <div className="flex items-center justify-between gap-1 text-xs font-bold">
                      <span>{eng.labelFa}</span>
                      <span
                        className={`text-[10px] font-mono-tabular ${
                          eng.available ? "text-emerald-400" : "text-amber-300"
                        }`}
                      >
                        {eng.available ? "آماده" : "فال‌بک خودکار"}
                      </span>
                    </div>
                    <p className="text-[11px] leading-5 text-slate-400">{eng.descriptionFa}</p>
                  </div>
                  <div className="mt-2 border-t border-[#262B38] pt-1.5 text-[10px] text-slate-400 w-full">
                    {eng.hardwareNoteFa}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Sequential Shot Cards */}
      <div className="space-y-4">
        {director.shots.map((shot) => {
          const clip = shotClips.find((c) => c.shotNumber === shot.shotNumber);
          const previewFrames = visuals?.shots.find((v) => v.shotNumber === shot.shotNumber);
          const isUnlocked = shot.shotNumber <= progress.activeUnlockShotNumber;
          const isApproved = clip?.approvalStatus === "approved" && Boolean(clip.videoUrl);
          const isRenderingThis = renderingShotNum === shot.shotNumber;

          return (
            <div
              key={shot.shotNumber}
              data-testid={`shot-video-card-${shot.shotNumber}`}
              className={`rounded-2xl border p-5 transition-colors ${
                isApproved
                  ? "border-emerald-500/40 bg-[#14171F]"
                  : isUnlocked
                    ? "border-amber-500/50 bg-[#14171F]"
                    : "border-[#262B38] bg-[#14171F]/50 opacity-65"
              }`}
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#262B38] pb-3">
                <div className="flex items-center gap-2.5 text-sm font-bold text-slate-100">
                  <span className="font-mono-tabular text-amber-400">
                    شات {String(shot.shotNumber).padStart(2, "0")}
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="font-mono-tabular text-xs text-slate-300">
                    {shot.durationSeconds} ثانیه ({shot.timecode})
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="text-xs font-medium text-slate-300">{shot.cameraAngle}</span>
                </div>

                <div className="text-xs">
                  {isApproved ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>شات تایید شد</span>
                    </span>
                  ) : !isUnlocked ? (
                    <span className="inline-flex items-center gap-1.5 text-slate-400">
                      <Lock className="h-3.5 w-3.5" />
                      <span>پس از تایید شات قبلی باز می‌شود</span>
                    </span>
                  ) : (
                    <span className="font-medium text-amber-300">نوبت ساخت و بررسی این شات</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                {/* Video Player or Storyboard Reference */}
                <div className="lg:col-span-5">
                  {clip?.videoUrl ? (
                    <div className="overflow-hidden rounded-xl border border-[#262B38] bg-[#0B0D11]">
                      <video
                        key={clip.videoUrl}
                        controls
                        playsInline
                        src={clip.videoUrl}
                        className="max-h-[340px] w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5">
                        {previewFrames?.imageUrl && !brokenImages[`sv_f1_${shot.shotNumber}`] && (
                        <div className="space-y-1">
                          <div className="text-[11px] font-medium text-amber-300">
                            فریم ۱ · شروع شات
                          </div>
                          <div className="relative aspect-[9/16] overflow-hidden rounded-lg border border-[#262B38] bg-[#0B0D11]">
                            <img
                              src={previewFrames.imageUrl}
                              referrerPolicy="no-referrer"
                              onError={() =>
                                setBrokenImages((prev) => ({
                                  ...prev,
                                  [`sv_f1_${shot.shotNumber}`]: true,
                                }))
                              }
                              alt={`فریم اول شات ${shot.shotNumber}`}
                              className="h-full w-full object-cover"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0B0D11] via-[#0B0D11]/85 to-transparent p-2 text-[10px] leading-4 text-slate-200">
                              {shot.startFrameDescriptionFa || shot.onScreenText}
                            </div>
                          </div>
                        </div>
                      )}
                      {(previewFrames?.secondaryImageUrl || previewFrames?.imageUrl) &&
                        !brokenImages[`sv_f2_${shot.shotNumber}`] && (
                        <div className="space-y-1">
                          <div className="text-[11px] font-medium text-sky-300">
                            فریم ۲ · اوج حرکت
                          </div>
                          <div className="relative aspect-[9/16] overflow-hidden rounded-lg border border-[#262B38] bg-[#0B0D11]">
                            <img
                              src={previewFrames?.secondaryImageUrl || previewFrames?.imageUrl || ""}
                              referrerPolicy="no-referrer"
                              onError={() =>
                                setBrokenImages((prev) => ({
                                  ...prev,
                                  [`sv_f2_${shot.shotNumber}`]: true,
                                }))
                              }
                              alt={`فریم دوم شات ${shot.shotNumber}`}
                              className="h-full w-full object-cover"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0B0D11] via-[#0B0D11]/85 to-transparent p-2 text-[10px] leading-4 text-slate-200">
                              {shot.endFrameDescriptionFa || shot.cameraMovement}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Controls & Per-Shot Gate */}
                <div className="flex flex-col justify-between space-y-4 lg:col-span-7">
                  <div className="space-y-2 text-xs leading-6">
                    <div>
                      <span className="font-semibold text-amber-300">متن روی تصویر: </span>
                      <span className="text-slate-100">{shot.onScreenText || "—"}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-300">گفتار شات: </span>
                      <span className="text-slate-300">{shot.spokenSegment}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-emerald-300">افکت صوتی و ترنزیشن: </span>
                      <span className="text-slate-300">
                        {shot.sfxCueFa || "افکت انتقال"} · {shot.transitionToNext || "cut"}
                      </span>
                    </div>
                    {clip?.engineUsed && (
                      <div>
                        <span className="font-semibold text-sky-300">موتور رندر استفاده‌شده: </span>
                        <span dir="ltr" className="font-mono-tabular text-slate-200">
                          {clip.engineUsed}
                        </span>
                      </div>
                    )}
                    {clip?.qaAudit && (
                      <div className="pt-1">
                        <QualityAuditBadge audit={clip.qaAudit} compact />
                      </div>
                    )}
                  </div>

                  {isUnlocked && (
                    <div className="space-y-3 border-t border-[#262B38] pt-3">
                      <input
                        type="text"
                        value={revisionInputs[shot.shotNumber] || ""}
                        disabled={isRenderingThis || isRunning}
                        onChange={(e) =>
                          setRevisionInputs((prev) => ({
                            ...prev,
                            [shot.shotNumber]: e.target.value,
                          }))
                        }
                        placeholder="یادداشت اصلاحی مخصوص همین شات (اختیاری — در حافظه کارگردان هم ذخیره می‌شود)..."
                        className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                      />

                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          disabled={isRenderingThis || isRunning}
                          onClick={() => void handleRender(shot.shotNumber)}
                          className="inline-flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          {isRenderingThis ? (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              <span>در حال رندر MP4 شات {shot.shotNumber}...</span>
                            </>
                          ) : clip?.videoUrl ? (
                            <>
                              <Film className="h-3.5 w-3.5" />
                              <span>رندر مجدد ویدیوی شات {shot.shotNumber}</span>
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5" />
                              <span>ساخت ویدیوی شات {shot.shotNumber} (MP4)</span>
                            </>
                          )}
                        </button>

                        {clip?.videoUrl && !isApproved && (
                          <button
                            type="button"
                            disabled={isRenderingThis || isRunning}
                            onClick={() =>
                              void onApproveShotVideo(
                                shot.shotNumber,
                                "approved",
                                revisionInputs[shot.shotNumber]
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>
                              تایید شات {shot.shotNumber}
                              {shot.shotNumber < director.shots.length
                                ? ` و باز کردن شات ${shot.shotNumber + 1}`
                                : " (تکمیل شات‌ها)"}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Stage 4 Final Progression Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="text-xs text-slate-300">
          {progress.allApproved
            ? "تمام شات‌های ویدیویی تایید شدند! اکنون وارد مرحله کلون صدا و ساخت فایل صوتی نریشن شوید."
            : `برای رفتن به مرحله بعد، شات‌های ویدیویی را بسازید و تایید کنید (${progress.approvedCount} از ${progress.totalShots} تایید شده).`}
        </div>

        <button
          type="button"
          disabled={!progress.allApproved || isRunning}
          onClick={() => void onAdvanceToVoiceover()}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap shrink-0"
        >
          <span>
            {isRunning
              ? "در حال آماده‌سازی استودیو صدا..."
              : "تایید نهایی شات‌ها و رفتن به کلون صدا"}
          </span>
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
