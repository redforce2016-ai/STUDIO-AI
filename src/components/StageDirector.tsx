import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import type {
  DirectorOutput,
  DirectorShot,
  VisualAssetsOutput,
} from "../types/studio";
import { QualityAuditBadge } from "./QualityAuditBadge";

interface StageDirectorProps {
  data: DirectorOutput;
  visuals: VisualAssetsOutput | null;
  isRunning: boolean;
  isCurrentGate: boolean;
  onSaveEdits: (updated: DirectorOutput) => void;
  onRegenerateSingleShotFrames: (
    shotNumber: number,
    updatedPrompt?: string,
    feedback?: string
  ) => Promise<void>;
  onApprove: (updated: DirectorOutput) => Promise<void>;
  onRegenerate: (feedback: string) => Promise<void>;
}

export function StageDirector({
  data,
  visuals,
  isRunning,
  isCurrentGate,
  onSaveEdits,
  onRegenerateSingleShotFrames,
  onApprove,
  onRegenerate,
}: StageDirectorProps) {
  const [draft, setDraft] = useState<DirectorOutput>(data);
  const [feedback, setFeedback] = useState("");
  const [regeneratingShotNum, setRegeneratingShotNum] = useState<number | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [showCrewNotes, setShowCrewNotes] = useState(true);
  const [expandedBibleShots, setExpandedBibleShots] = useState<Record<number, boolean>>({});
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDraft(data);
  }, [data]);

  const updateShot = (shotNumber: number, patch: Partial<DirectorShot>) => {
    const shots = draft.shots.map((s) => {
      if (s.shotNumber !== shotNumber) return s;
      const merged = { ...s, ...patch };
      if (patch.durationSeconds !== undefined) {
        merged.durationSeconds = Math.min(8, Math.max(3, Math.round(Number(patch.durationSeconds) || 5)));
      }
      return merged;
    });
    const totalEstimatedSeconds = shots.reduce(
      (sum, s) => sum + (Number(s.durationSeconds) || 5),
      0
    );
    setDraft({ ...draft, shots, totalEstimatedSeconds });
  };

  const addShot = () => {
    const nextNum = draft.shots.length + 1;
    const startSec = draft.totalEstimatedSeconds;
    const endSec = startSec + 5;
    const fmt = (sec: number) =>
      `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

    const newShot: DirectorShot = {
      shotNumber: nextNum,
      timecode: `${fmt(startSec)} - ${fmt(endSec)}`,
      durationSeconds: 5,
      cameraAngle: "نمای متوسط تخصصی",
      cameraMovement: "زوم نرم به مرکز سوژه",
      sceneDescriptionFa: "شرح صحنه جدید ۵ ثانیه‌ای...",
      startFrameDescriptionFa: "فریم شروع با نمایش سوژه اصلی",
      endFrameDescriptionFa: "فریم پایان با نمایش جزئیات کلیدی",
      spokenSegment: "",
      onScreenText: "",
      sfxCueFa: "افکت انتقال نرم (Whoosh)",
      transitionToNext: "cut",
      lightingAndMood: "نورپردازی سینمایی کنتراست بالا",
      visualPromptFa: "کادر عمودی سینمایی با تمرکز بر سوژه",
    };
    const shots = [...draft.shots, newShot];
    setDraft({
      ...draft,
      shots,
      totalEstimatedSeconds: endSec,
    });
  };

  const removeShot = (shotNumber: number) => {
    if (draft.shots.length <= 1) return;
    const shots = draft.shots
      .filter((s) => s.shotNumber !== shotNumber)
      .map((s, idx) => ({ ...s, shotNumber: idx + 1 }));
    const totalEstimatedSeconds = shots.reduce(
      (sum, s) => sum + (Number(s.durationSeconds) || 5),
      0
    );
    setDraft({ ...draft, shots, totalEstimatedSeconds });
  };

  const handleRefreshFrames = async (shot: DirectorShot) => {
    setRegeneratingShotNum(shot.shotNumber);
    try {
      await onRegenerateSingleShotFrames(shot.shotNumber, shot.visualPromptFa);
    } finally {
      setRegeneratingShotNum(null);
    }
  };

  const handleSave = () => {
    onSaveEdits(draft);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <span>مرحله ۳ از ۶ · ایجنت ۲ (کارگردان و طراح استوری‌بورد)</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono-tabular text-slate-400">
              {draft.shots.length} شات (هر شات ۳ تا ۸ ثانیه · مجموع {draft.totalEstimatedSeconds} ثانیه)
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            دکوپاژ شات‌های ۳ تا ۸ ثانیه‌ای + ۲ فریم پیش‌نمایش برای هر شات
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addShot}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5 text-amber-400" />
            <span>افزودن شات</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
          >
            <Check className="h-3.5 w-3.5 text-emerald-400" />
            <span>{savedNotice ? "ذخیره شد" : "ذخیره دکوپاژ"}</span>
          </button>
        </div>
      </div>

      <QualityAuditBadge audit={draft.qaAudit} />

      {/* 5-Role Film Directing Crew Notes */}
      {draft.directingCrewNotes && (
        <section className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
              <Users className="h-4 w-4 text-amber-400" />
              <span>دپارتمان ۵ نفره کارگردانی (Showrunner · DOP · طراح صحنه · تدوینگر · صدا)</span>
            </div>
            <button
              type="button"
              aria-expanded={showCrewNotes}
              onClick={() => setShowCrewNotes((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 whitespace-nowrap shrink-0"
            >
              <span>{showCrewNotes ? "جمع کردن یادداشت تیم" : "نمایش یادداشت ۵ بخش"}</span>
              {showCrewNotes ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {showCrewNotes && (
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[#262B38] pt-4 text-xs leading-6 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
                <div className="mb-1 font-semibold text-amber-300">شورانر و درام</div>
                <p className="text-slate-300">{draft.directingCrewNotes.showrunnerNoteFa}</p>
              </div>
              <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
                <div className="mb-1 font-semibold text-sky-300">مدیر فیلم‌برداری (DOP)</div>
                <p className="text-slate-300">{draft.directingCrewNotes.dopCinematographyNoteFa}</p>
              </div>
              <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
                <div className="mb-1 font-semibold text-emerald-300">طراحی صحنه و اکسسوار</div>
                <p className="text-slate-300">{draft.directingCrewNotes.artDirectionNoteFa}</p>
              </div>
              <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
                <div className="mb-1 font-semibold text-amber-300">تدوینگر ریتم و قلاب</div>
                <p className="text-slate-300">{draft.directingCrewNotes.editorRhythmNoteFa}</p>
              </div>
              <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
                <div className="mb-1 font-semibold text-sky-300">طراحی صدا و فضای صوتی</div>
                <p className="text-slate-300">{draft.directingCrewNotes.soundDesignNoteFa}</p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Direction Summary */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
          <Clapperboard className="h-4 w-4 text-amber-400" />
          <span>خط مشی کارگردانی بصری، نورپردازی و ریتم تدوین</span>
        </div>
        <textarea
          rows={2}
          value={draft.visualDirectionSummary}
          disabled={isRunning}
          onChange={(e) => setDraft({ ...draft, visualDirectionSummary: e.target.value })}
          className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs leading-6 text-slate-200 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {/* Shots + Dual Preview Frames */}
      <div className="space-y-5">
        {draft.shots.map((shot) => {
          const visualAsset = visuals?.shots.find((v) => v.shotNumber === shot.shotNumber);
          const isShotBusy = regeneratingShotNum === shot.shotNumber;

          return (
            <div
              key={shot.shotNumber}
              className="rounded-2xl border border-[#262B38] bg-[#14171F] p-5"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#262B38] pb-3">
                <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-100">
                  <span className="font-mono-tabular text-amber-400">
                    شات {String(shot.shotNumber).padStart(2, "0")}
                  </span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="font-mono-tabular text-xs text-slate-300">{shot.timecode}</span>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <div className="flex items-center gap-1.5 text-xs text-slate-300">
                    <span>طول شات (۳ تا ۸ ثانیه):</span>
                    <input
                      type="number"
                      min={3}
                      max={8}
                      value={shot.durationSeconds}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, { durationSeconds: Number(e.target.value) })
                      }
                      className="font-mono-tabular w-14 rounded border border-[#262B38] bg-[#0B0D11] px-2 py-1 text-center text-xs text-amber-300 focus:border-amber-500 focus:outline-none"
                    />
                    <span>ثانیه</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isRunning || isShotBusy}
                    onClick={() => void handleRefreshFrames(shot)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs text-slate-200 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isShotBusy ? "animate-spin" : ""}`} />
                    <span>{isShotBusy ? "در حال طراحی ۲ فریم..." : "بازسازی ۲ فریم این شات"}</span>
                  </button>

                  {draft.shots.length > 1 && (
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => removeShot(shot.shotNumber)}
                      aria-label={`حذف شات ${shot.shotNumber}`}
                      className="rounded-md p-1.5 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                {/* Dual Preview Frames (2 Frames per Shot) */}
                <div className="space-y-3 lg:col-span-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-amber-300">
                        فریم ۱ · شروع شات
                      </div>
                      <div className="aspect-[9/16] overflow-hidden rounded-xl border border-[#262B38] bg-[#0B0D11]">
                        {visualAsset?.imageUrl && !brokenImages[`f1_${shot.shotNumber}`] ? (
                          <img
                            src={visualAsset.imageUrl}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setBrokenImages((prev) => ({
                                ...prev,
                                [`f1_${shot.shotNumber}`]: true,
                              }))
                            }
                            alt={`شات ${shot.shotNumber} فریم شروع`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center p-3 text-center text-[11px] text-slate-400">
                            {shot.startFrameDescriptionFa || "فریم شروع آماده تولید"}
                          </div>
                        )}
                      </div>
                      {shot.startFrameDescriptionFa && (
                        <p className="text-[11px] leading-5 text-slate-400">
                          {shot.startFrameDescriptionFa}
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-sky-300">
                        فریم ۲ · اوج حرکت / پایان
                      </div>
                      <div className="aspect-[9/16] overflow-hidden rounded-xl border border-[#262B38] bg-[#0B0D11]">
                        {(visualAsset?.secondaryImageUrl || visualAsset?.imageUrl) &&
                        !brokenImages[`f2_${shot.shotNumber}`] ? (
                          <img
                            src={visualAsset?.secondaryImageUrl || visualAsset?.imageUrl || ""}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setBrokenImages((prev) => ({
                                ...prev,
                                [`f2_${shot.shotNumber}`]: true,
                              }))
                            }
                            alt={`شات ${shot.shotNumber} فریم پایان`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center p-3 text-center text-[11px] text-slate-400">
                            {shot.endFrameDescriptionFa || "فریم دوم آماده تولید"}
                          </div>
                        )}
                      </div>
                      {shot.endFrameDescriptionFa && (
                        <p className="text-[11px] leading-5 text-slate-400">
                          {shot.endFrameDescriptionFa}
                        </p>
                      )}
                    </div>
                  </div>

                  {visualAsset?.qaAudit && (
                    <QualityAuditBadge audit={visualAsset.qaAudit} compact />
                  )}
                </div>

                {/* Editable Decoupage Metadata */}
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:col-span-7">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">زاویه دوربین</label>
                    <input
                      type="text"
                      value={shot.cameraAngle}
                      disabled={isRunning}
                      onChange={(e) => updateShot(shot.shotNumber, { cameraAngle: e.target.value })}
                      className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-slate-400">حرکت دوربین</label>
                    <input
                      type="text"
                      value={shot.cameraMovement}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, { cameraMovement: e.target.value })
                      }
                      className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-slate-400">زیرنویس روی تصویر (کپشن شات)</label>
                    <input
                      type="text"
                      value={shot.onScreenText}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, { onScreenText: e.target.value })
                      }
                      className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-amber-300 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-slate-400">افکت صوتی (SFX در DaVinci)</label>
                    <input
                      type="text"
                      value={shot.sfxCueFa || ""}
                      disabled={isRunning}
                      onChange={(e) => updateShot(shot.shotNumber, { sfxCueFa: e.target.value })}
                      className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-emerald-300 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs text-slate-400">بخشی از صدای گوینده که روی این شات پخش می‌شود</label>
                    <textarea
                      rows={2}
                      value={shot.spokenSegment}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, { spokenSegment: e.target.value })
                      }
                      className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs leading-6 text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs text-slate-400">دستور تصویرسازی و چیدمان صحنه</label>
                    <textarea
                      rows={2}
                      value={shot.visualPromptFa}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, { visualPromptFa: e.target.value })
                      }
                      className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs leading-6 text-slate-200 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  {(shot.microScenarioFa || shot.lensAndFramingFa || shot.photorealPromptStartEn) && (
                    <div className="md:col-span-2 rounded-xl border border-[#262B38] bg-[#0B0D11]/80 p-3">
                      <button
                        type="button"
                        aria-expanded={Boolean(expandedBibleShots[shot.shotNumber])}
                        onClick={() =>
                          setExpandedBibleShots((prev) => ({
                            ...prev,
                            [shot.shotNumber]: !prev[shot.shotNumber],
                          }))
                        }
                        className="flex w-full items-center justify-between text-xs font-semibold text-amber-300 hover:text-amber-200"
                      >
                        <span>
                          شناسنامه فنی و سناریوی خرد شات (کارگردانی، لنز، نور و پرامپت واقعی)
                        </span>
                        {expandedBibleShots[shot.shotNumber] ? (
                          <ChevronUp className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        )}
                      </button>

                      {expandedBibleShots[shot.shotNumber] && (
                        <div className="mt-3 space-y-2 border-t border-[#262B38] pt-3 text-[11px] leading-6 text-slate-300">
                          {shot.dramaticBeatFa && (
                            <div>
                              <span className="font-semibold text-amber-300">هدف دراماتیک: </span>
                              <span>{shot.dramaticBeatFa}</span>
                            </div>
                          )}
                          {shot.microScenarioFa && (
                            <div>
                              <span className="font-semibold text-slate-100">سناریوی خرد صحنه: </span>
                              <span>{shot.microScenarioFa}</span>
                            </div>
                          )}
                          {shot.lensAndFramingFa && (
                            <div>
                              <span className="font-semibold text-sky-300">لنز و کادربندی: </span>
                              <span>{shot.lensAndFramingFa}</span>
                            </div>
                          )}
                          {shot.lightingRigFa && (
                            <div>
                              <span className="font-semibold text-amber-200">چیدمان نورپردازی: </span>
                              <span>{shot.lightingRigFa}</span>
                            </div>
                          )}
                          {shot.continuityLockFa && (
                            <div>
                              <span className="font-semibold text-emerald-300">قفل تداوم (راکورد): </span>
                              <span>{shot.continuityLockFa}</span>
                            </div>
                          )}
                          {shot.photorealPromptStartEn && (
                            <div dir="ltr" className="rounded-lg border border-[#262B38] bg-[#14171F] p-2 font-mono-tabular text-[11px] text-sky-300">
                              Start Prompt: {shot.photorealPromptStartEn}
                            </div>
                          )}
                          {shot.photorealPromptEndEn && (
                            <div dir="ltr" className="rounded-lg border border-[#262B38] bg-[#14171F] p-2 font-mono-tabular text-[11px] text-slate-300">
                              End Prompt: {shot.photorealPromptEndEn}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gate 3 Bar */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={feedback}
              disabled={isRunning}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="بازخورد برای کارگردان (مثلاً: شات اول را ۳ ثانیه کن و کلوزآپ‌تر بگیر)..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onRegenerate(feedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              <span>بازسازی دکوپاژ و فریم‌ها</span>
            </button>
          </div>

          <button
            type="button"
            disabled={isRunning}
            onClick={() => onApprove(draft)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <span>
              {isRunning
                ? "در حال باز کردن میز ویدیوی شات‌ها..."
                : isCurrentGate
                  ? "تایید شات‌ها و ورود به ساخت ویدیوی شات‌به‌شات"
                  : "ذخیره و رفتن به ویدیوی شات‌ها"}
            </span>
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
