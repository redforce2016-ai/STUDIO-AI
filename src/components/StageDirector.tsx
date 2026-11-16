import { useEffect, useState } from "react";
import { ArrowLeft, Check, Clapperboard, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { DirectorOutput, DirectorShot } from "../types/studio";

interface StageDirectorProps {
  data: DirectorOutput;
  isRunning: boolean;
  isCurrentGate: boolean;
  onSaveEdits: (updated: DirectorOutput) => void;
  onApprove: (updated: DirectorOutput) => Promise<void>;
  onRegenerate: (feedback: string) => Promise<void>;
}

export function StageDirector({
  data,
  isRunning,
  isCurrentGate,
  onSaveEdits,
  onApprove,
  onRegenerate,
}: StageDirectorProps) {
  const [draft, setDraft] = useState<DirectorOutput>(data);
  const [feedback, setFeedback] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(data);
  }, [data]);

  const updateShot = (shotNumber: number, patch: Partial<DirectorShot>) => {
    const shots = draft.shots.map((s) => (s.shotNumber === shotNumber ? { ...s, ...patch } : s));
    const totalEstimatedSeconds = shots.reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0);
    setDraft({ ...draft, shots, totalEstimatedSeconds });
  };

  const addShot = () => {
    const nextNum = draft.shots.length + 1;
    const newShot: DirectorShot = {
      shotNumber: nextNum,
      timecode: `00:${String(draft.totalEstimatedSeconds).padStart(2, "0")} - 00:${String(
        draft.totalEstimatedSeconds + 4
      ).padStart(2, "0")}`,
      durationSeconds: 4,
      cameraAngle: "نمای متوسط روبرو",
      cameraMovement: "حرکت آرام به جلو",
      sceneDescriptionFa: "توصیف صحنه جدید...",
      spokenSegment: "",
      onScreenText: "",
      lightingAndMood: "نورپردازی گرم استودیویی",
      visualPromptFa: "کادر عمودی سینمایی با تمرکز بر سوژه اصلی",
    };
    const shots = [...draft.shots, newShot];
    setDraft({
      ...draft,
      shots,
      totalEstimatedSeconds: draft.totalEstimatedSeconds + 4,
    });
  };

  const removeShot = (shotNumber: number) => {
    if (draft.shots.length <= 1) return;
    const shots = draft.shots
      .filter((s) => s.shotNumber !== shotNumber)
      .map((s, idx) => ({ ...s, shotNumber: idx + 1 }));
    const totalEstimatedSeconds = shots.reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0);
    setDraft({ ...draft, shots, totalEstimatedSeconds });
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
            <span>مرحله ۳ · چیدمان صحنه‌ها</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono-tabular text-slate-400">
              {draft.shots.length} صحنه · حدود {draft.totalEstimatedSeconds} ثانیه
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            برنامه تصویربرداری، زاویه دوربین و متن روی صفحه
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addShot}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5 text-amber-400" />
            <span>افزودن شات</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
          >
            <Check className="h-3.5 w-3.5 text-emerald-400" />
            <span>{savedNotice ? "ذخیره شد" : "ذخیره تغییرات"}</span>
          </button>
        </div>
      </div>

      {/* Visual Direction Summary */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
          <Clapperboard className="h-4 w-4 text-amber-400" />
          <span>چشم‌انداز کارگردانی بصری کل ویدیو</span>
        </div>
        <textarea
          rows={2}
          value={draft.visualDirectionSummary}
          disabled={isRunning}
          onChange={(e) => setDraft({ ...draft, visualDirectionSummary: e.target.value })}
          className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-sm leading-7 text-slate-200 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {/* Shot List */}
      <div className="space-y-4">
        {draft.shots.map((shot) => (
          <div
            key={shot.shotNumber}
            className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 transition-colors hover:border-[#343B4E]"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#262B38] pb-3">
              <div className="flex items-center gap-3 text-sm font-semibold text-slate-100">
                <span className="font-mono-tabular text-amber-400">
                  شات {String(shot.shotNumber).padStart(2, "0")}
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <input
                  type="text"
                  value={shot.timecode}
                  disabled={isRunning}
                  onChange={(e) => updateShot(shot.shotNumber, { timecode: e.target.value })}
                  className="font-mono-tabular w-32 rounded border border-[#262B38] bg-[#0B0D11] px-2 py-1 text-center text-xs text-slate-300 focus:border-amber-500 focus:outline-none"
                />
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={shot.durationSeconds}
                    disabled={isRunning}
                    onChange={(e) =>
                      updateShot(shot.shotNumber, { durationSeconds: Number(e.target.value) || 1 })
                    }
                    className="font-mono-tabular w-14 rounded border border-[#262B38] bg-[#0B0D11] px-2 py-1 text-center text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                  />
                  <span>ثانیه</span>
                </div>
              </div>

              {draft.shots.length > 1 && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => removeShot(shot.shotNumber)}
                  aria-label={`حذف شات ${shot.shotNumber}`}
                  className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs text-slate-400">زاویه و قاب دوربین</label>
                <input
                  type="text"
                  value={shot.cameraAngle}
                  disabled={isRunning}
                  onChange={(e) => updateShot(shot.shotNumber, { cameraAngle: e.target.value })}
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs text-slate-400">حرکت دوربین</label>
                <input
                  type="text"
                  value={shot.cameraMovement}
                  disabled={isRunning}
                  onChange={(e) => updateShot(shot.shotNumber, { cameraMovement: e.target.value })}
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs text-slate-400">متن نریشن در این شات</label>
                <textarea
                  rows={2}
                  value={shot.spokenSegment}
                  disabled={isRunning}
                  onChange={(e) => updateShot(shot.shotNumber, { spokenSegment: e.target.value })}
                  className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs leading-6 text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs text-slate-400">تیتر / زیرنویس روی تصویر</label>
                <input
                  type="text"
                  value={shot.onScreenText}
                  disabled={isRunning}
                  onChange={(e) => updateShot(shot.shotNumber, { onScreenText: e.target.value })}
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-amber-300 focus:border-amber-500 focus:outline-none"
                />
                <label className="block pt-1 text-xs text-slate-400">نورپردازی و اتمسفر</label>
                <input
                  type="text"
                  value={shot.lightingAndMood}
                  disabled={isRunning}
                  onChange={(e) => updateShot(shot.shotNumber, { lightingAndMood: e.target.value })}
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="block text-xs text-slate-400">شرح صحنه و پرامپت استوری‌بورد شات</label>
                <textarea
                  rows={2}
                  value={shot.visualPromptFa}
                  disabled={isRunning}
                  onChange={(e) => updateShot(shot.shotNumber, { visualPromptFa: e.target.value })}
                  className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs leading-6 text-slate-200 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Checkpoint 3 Bar */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={feedback}
              disabled={isRunning}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="بازخورد برای تغییر دکوپاژ (مثلاً: شات‌های اول را سریع‌تر و کلوزآپ‌تر کن)..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onRegenerate(feedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              <span>بازتولید دکوپاژ</span>
            </button>
          </div>

          <button
            type="button"
            disabled={isRunning}
            onClick={() => onApprove(draft)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <span>
              {isRunning
                ? "در حال ساخت استوری‌بورد شات‌ها..."
                : isCurrentGate
                  ? "تایید دکوپاژ و ساخت استوری‌بورد"
                  : "بروزرسانی و بازساخت استوری‌بورد"}
            </span>
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
