import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  Maximize2,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type {
  CinematicSevenLayerSpec,
  DirectorOutput,
  DirectorShot,
  PreferredFreeEngine,
  VisualAssetShot,
  VisualAssetsOutput,
} from "../types/studio";

interface StageStoryboardProps {
  director: DirectorOutput;
  visuals: VisualAssetsOutput | null;
  isRunning: boolean;
  isCurrentGate: boolean;
  onSaveEdits: (updated: DirectorOutput) => void;
  onRegenerateShot: (
    shotNumber: number,
    updatedPrompt?: string,
    feedback?: string
  ) => Promise<void>;
  onApprove: (updated: DirectorOutput) => Promise<void>;
  onRegenerateAll: (feedback: string) => Promise<void>;
}

export function StageStoryboard({
  director,
  visuals,
  isRunning,
  isCurrentGate,
  onSaveEdits,
  onRegenerateShot,
  onApprove,
  onRegenerateAll,
}: StageStoryboardProps) {
  const [draft, setDraft] = useState<DirectorOutput>(director);
  const [feedback, setFeedback] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [busyShot, setBusyShot] = useState<number | null>(null);
  const [shotFeedback, setShotFeedback] = useState<Record<number, string>>({});
  const [lightboxShot, setLightboxShot] = useState<{
    asset: VisualAssetShot | undefined;
    director: DirectorShot;
  } | null>(null);

  useEffect(() => {
    setDraft(director);
  }, [director]);

  const updateShot = (shotNumber: number, patch: Partial<DirectorShot>) => {
    const shots = draft.shots.map((s) =>
      s.shotNumber === shotNumber ? { ...s, ...patch } : s
    );
    const totalEstimatedSeconds = shots.reduce(
      (sum, s) => sum + (Number(s.durationSeconds) || 0),
      0
    );
    setDraft({ ...draft, shots, totalEstimatedSeconds });
  };

  const updateShotSevenLayer = (
    shotNumber: number,
    layerKey: keyof CinematicSevenLayerSpec,
    value: string
  ) => {
    const target = draft.shots.find((s) => s.shotNumber === shotNumber);
    if (!target) return;
    const baseSpec: CinematicSevenLayerSpec = target.sevenLayerSpec || {
      scene: target.sceneDescriptionFa || "",
      objects: "",
      animation: "",
      camera: `${target.cameraAngle} — ${target.cameraMovement}`,
      lighting: target.lightingAndMood || "",
      transition: "ترنزیشن نرم کنترل‌شده",
      soundDesign: "آمبیانس سینمایی + افکت صوتی متناسب با حرکت",
      typographyNoteFa: target.onScreenText || "",
    };
    updateShot(shotNumber, {
      sevenLayerSpec: {
        ...baseSpec,
        [layerKey]: value,
      },
    });
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
      sceneDescriptionFa: "توصیف صحنه جدید در استوری‌بورد...",
      spokenSegment: "",
      onScreenText: "",
      lightingAndMood: "نورپردازی گرم استودیویی",
      visualPromptFa: "کادر سینمایی با تمرکز دقیق بر سوژه اصلی",
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
    const totalEstimatedSeconds = shots.reduce(
      (sum, s) => sum + (Number(s.durationSeconds) || 0),
      0
    );
    setDraft({ ...draft, shots, totalEstimatedSeconds });
  };

  const handleSave = () => {
    onSaveEdits(draft);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleRegenShot = async (shot: DirectorShot) => {
    setBusyShot(shot.shotNumber);
    try {
      await onRegenerateShot(
        shot.shotNumber,
        shot.visualPromptFa,
        shotFeedback[shot.shotNumber]
      );
    } finally {
      setBusyShot(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <span>مرحله ۲ · استوری‌بورد و دکوپاژ تصویری</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono-tabular text-slate-400">
              {draft.shots.length} شات · حدود {draft.totalEstimatedSeconds} ثانیه
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            طراحی فریم‌به‌فریم شات‌ها، زاویه دوربین و کادر استوری‌بورد
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCaptions((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
          >
            {showCaptions ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            <span>{showCaptions ? "مخفی‌سازی تیتر شات" : "نمایش تیتر روی فریم"}</span>
          </button>

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

      {/* Visual Direction Summary & Global 6-Point Production Blueprint */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 space-y-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
          <Clapperboard className="h-4 w-4 text-amber-400" />
          <span>چشم‌انداز کارگردانی بصری و سند مرجع تولید (بدون حدس و توهم ایجنت‌ها)</span>
        </div>
        <textarea
          rows={2}
          value={draft.visualDirectionSummary}
          disabled={isRunning}
          onChange={(e) =>
            setDraft({ ...draft, visualDirectionSummary: e.target.value })
          }
          className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-sm leading-7 text-slate-200 focus:border-amber-500 focus:outline-none"
        />

        {draft.visualDirectionBlueprint && (
          <div className="grid grid-cols-1 gap-3 border-t border-[#262B38] pt-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
              <div className="text-[11px] font-semibold text-amber-400">پس‌زمینه و اتمسفر</div>
              <p className="mt-1 leading-5 text-slate-300">
                {draft.visualDirectionBlueprint.backgroundAndAtmosphere}
              </p>
            </div>
            <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
              <div className="text-[11px] font-semibold text-amber-400">متریال و محصول واقع‌گرایانه</div>
              <p className="mt-1 leading-5 text-slate-300">
                {draft.visualDirectionBlueprint.materialAndProductStyle}
              </p>
            </div>
            <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
              <div className="text-[11px] font-semibold text-sky-400">امضای نورپردازی و سایه</div>
              <p className="mt-1 leading-5 text-slate-300">
                {draft.visualDirectionBlueprint.lightingSignature}
              </p>
            </div>
            <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
              <div className="text-[11px] font-semibold text-sky-400">زبان و حرکت دوربین</div>
              <p className="mt-1 leading-5 text-slate-300">
                {draft.visualDirectionBlueprint.cameraLanguage}
              </p>
            </div>
            <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
              <div className="text-[11px] font-semibold text-emerald-400">ذرات معلق و افکت‌های ظریف</div>
              <p className="mt-1 leading-5 text-slate-300">
                {draft.visualDirectionBlueprint.particlesAndEffects}
              </p>
            </div>
            <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3">
              <div className="text-[11px] font-semibold text-emerald-400">سیستم تایپوگرافی مدرن</div>
              <p className="mt-1 leading-5 text-slate-300">
                {draft.visualDirectionBlueprint.typographySystem}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Shot List with Paired Storyboard Keyframe Preview */}
      <div className="space-y-4">
        {draft.shots.map((shot) => {
          const visualAsset = visuals?.shots.find(
            (v) => v.shotNumber === shot.shotNumber
          );
          const isShotBusy = busyShot === shot.shotNumber || isRunning;

          return (
            <div
              key={shot.shotNumber}
              className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 transition-colors hover:border-[#343B4E]"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#262B38] pb-3">
                <div className="flex items-center gap-3 text-sm font-semibold text-slate-100">
                  <span className="font-mono-tabular text-amber-400">
                    شات {String(shot.shotNumber).padStart(2, "0")}
                  </span>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  <input
                    type="text"
                    value={shot.timecode}
                    disabled={isRunning}
                    onChange={(e) =>
                      updateShot(shot.shotNumber, { timecode: e.target.value })
                    }
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
                        updateShot(shot.shotNumber, {
                          durationSeconds: Number(e.target.value) || 1,
                        })
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

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
                {/* Keyframe Storyboard Preview Card */}
                <div className="lg:col-span-4 space-y-2.5">
                  <div className="relative aspect-[9/16] max-h-[340px] w-full overflow-hidden rounded-xl border border-[#262B38] bg-[#0B0D11]">
                    {visualAsset?.imageUrl ? (
                      <img
                        src={visualAsset.imageUrl}
                        alt={`استوری‌بورد شات ${shot.shotNumber}`}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-4 text-center text-xs text-slate-500">
                        فریم استوری‌بورد در حال آماده‌سازی...
                      </div>
                    )}

                    {showCaptions && shot.onScreenText && (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-4 pt-8 text-center">
                        <div className="text-xs font-bold leading-5 text-white drop-shadow">
                          {shot.onScreenText}
                        </div>
                      </div>
                    )}

                    {visualAsset?.imageUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxShot({ asset: visualAsset, director: shot })
                        }
                        aria-label={`بزرگ‌نمایی شات ${shot.shotNumber}`}
                        className="absolute bottom-2.5 left-2.5 rounded-md border border-white/15 bg-black/65 p-1.5 text-slate-200 transition-colors hover:bg-black/85 hover:text-amber-400"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={shotFeedback[shot.shotNumber] || ""}
                      disabled={isShotBusy}
                      onChange={(e) =>
                        setShotFeedback((prev) => ({
                          ...prev,
                          [shot.shotNumber]: e.target.value,
                        }))
                      }
                      placeholder="دستور تغییر فریم شات..."
                      className="min-w-0 flex-1 rounded-md border border-[#262B38] bg-[#0B0D11] px-2.5 py-1.5 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={isShotBusy}
                      onClick={() => void handleRegenShot(shot)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#262B38] bg-[#1B1F2A] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:border-amber-500/50 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${isShotBusy ? "animate-spin" : ""}`}
                      />
                      <span>بازتولید تصویر شات</span>
                    </button>
                  </div>
                </div>

                {/* Editable Director / Decoupage Spec */}
                <div className="lg:col-span-8 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      زاویه و قاب دوربین
                    </label>
                    <input
                      type="text"
                      value={shot.cameraAngle}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, {
                          cameraAngle: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      حرکت دوربین
                    </label>
                    <input
                      type="text"
                      value={shot.cameraMovement}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, {
                          cameraMovement: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      گفتار / موضوع این شات
                    </label>
                    <textarea
                      rows={2}
                      value={shot.spokenSegment}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, {
                          spokenSegment: e.target.value,
                        })
                      }
                      className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs leading-6 text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-400">
                      تیتر / زیرنویس روی تصویر
                    </label>
                    <input
                      type="text"
                      value={shot.onScreenText}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, {
                          onScreenText: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs font-medium text-amber-300 focus:border-amber-500 focus:outline-none"
                    />
                    <label className="block pt-1 text-xs text-slate-400">
                      نورپردازی و اتمسفر
                    </label>
                    <input
                      type="text"
                      value={shot.lightingAndMood}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, {
                          lightingAndMood: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="block text-xs text-slate-400">
                      شرح صحنه (فارسی)
                    </label>
                    <textarea
                      rows={2}
                      value={shot.sceneDescriptionFa}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, {
                          sceneDescriptionFa: e.target.value,
                        })
                      }
                      className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs leading-6 text-slate-200 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="block text-xs text-slate-400">
                      پرامپت تصویری و استوری‌بورد شات (آماده ورود به مرحله ساخت ویدیو)
                    </label>
                    <textarea
                      rows={2}
                      value={shot.visualPromptFa}
                      disabled={isRunning}
                      onChange={(e) =>
                        updateShot(shot.shotNumber, {
                          visualPromptFa: e.target.value,
                        })
                      }
                      className="w-full resize-none rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs leading-6 text-slate-200 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  {/* Mandatory 7-Layer Director Blueprint & Free Engine Selector */}
                  <div className="md:col-span-2 rounded-lg border border-[#262B38] bg-[#0B0D11] p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262B38] pb-2.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span>مشخصات قفل‌شده ۷ لایه کارگردانی (بدون حدس و توهم)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">موتور رایگان رندر:</span>
                        <select
                          value={shot.preferredFreeEngine || "hyperframes"}
                          disabled={isRunning}
                          onChange={(e) =>
                            updateShot(shot.shotNumber, {
                              preferredFreeEngine: e.target.value as PreferredFreeEngine,
                            })
                          }
                          className="rounded-md border border-[#262B38] bg-[#14171F] px-2.5 py-1 text-[11px] text-slate-100 focus:border-amber-500 focus:outline-none"
                        >
                          <option value="hyperframes">HyperFrames (موشن + ذرات + تایپوگرافی)</option>
                          <option value="blender">Blender 3D (PBR + اسکلت سه‌بعدی)</option>
                          <option value="remotion">Remotion v4 (نمودار / مقایسه کینتیک)</option>
                          <option value="comfyui">ComfyUI Colab GPU (Wan 2.2 I2V)</option>
                          <option value="ffmpeg_live">FFmpeg + فوتیج واقعی</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {(
                        [
                          ["scene", "۱. Scene (صحنه و پس‌زمینه)"],
                          ["objects", "۲. Objects (اشیا، متریال، متن، لوگو)"],
                          ["animation", "۳. Animation (حرکت اشیا و ذرات معلق)"],
                          ["camera", "۴. Camera (زاویه، لنز و حرکت نرم دوربین)"],
                          ["lighting", "۵. Lighting (نورپردازی سفید/آبی و سایه‌ها)"],
                          ["transition", "۶. Transition (انتقال به صحنه بعد)"],
                          ["soundDesign", "۷. Sound Design (موسیقی و افکت صوتی)"],
                        ] as Array<[keyof CinematicSevenLayerSpec, string]>
                      ).map(([layerKey, label]) => (
                        <div
                          key={layerKey}
                          className={layerKey === "soundDesign" ? "sm:col-span-2" : ""}
                        >
                          <label className="mb-1 block text-[11px] text-slate-400">{label}</label>
                          <input
                            type="text"
                            disabled={isRunning}
                            value={shot.sevenLayerSpec?.[layerKey] || ""}
                            onChange={(e) =>
                              updateShotSevenLayer(shot.shotNumber, layerKey, e.target.value)
                            }
                            placeholder={`مشخصات دقیق ${label}...`}
                            className="w-full rounded-md border border-[#262B38] bg-[#14171F] px-2.5 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>

                    {visualAsset?.qaSevenLayerAudit && (
                      <div className="border-t border-[#262B38] pt-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            <span>
                              ممیزی QA هفت‌لایه تصویر شات:{" "}
                              {visualAsset.qaSevenLayerAudit.passed ? "تایید شد" : "نیازمند اصلاح"}
                            </span>
                          </span>
                          <span className="font-mono text-slate-300 tabular-nums">
                            نمره کل: {visualAsset.qaSevenLayerAudit.overallScore}/100 · فهم مخاطب:{" "}
                            {visualAsset.qaSevenLayerAudit.userComprehensionScore}/100 · جذابیت:{" "}
                            {visualAsset.qaSevenLayerAudit.visualAppealScore}/100
                          </span>
                        </div>
                        <p className="text-[11px] leading-5 text-slate-400">
                          {visualAsset.qaSevenLayerAudit.summaryFa}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Checkpoint 2 Bar */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={feedback}
              disabled={isRunning}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="بازخورد برای تغییر استوری‌بورد (مثلاً: شات اول کلوزآپ‌تر باشد و کادرهای صنعتی اضافه کن)..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onRegenerateAll(feedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`}
              />
              <span>بازتولید استوری‌بورد</span>
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
                ? "در حال ورود به مرحله ساخت شات‌ها..."
                : isCurrentGate
                  ? "تایید استوری‌بورد و ورود به ساخت شات‌های ویدیو"
                  : "بروزرسانی و ورود به ساخت شات‌های ویدیو"}
            </span>
            <ArrowLeft className="h-4 w-4" />
          </button>
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
              {lightboxShot.asset?.imageUrl && (
                <img
                  src={lightboxShot.asset.imageUrl}
                  alt={`نمای کامل شات ${lightboxShot.director.shotNumber}`}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain"
                />
              )}
            </div>
            <div className="flex flex-col justify-between p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-[#262B38] pb-3">
                  <span className="font-mono-tabular text-sm font-semibold text-amber-400">
                    شات {String(lightboxShot.director.shotNumber).padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLightboxShot(null)}
                    className="rounded-md p-1 text-slate-400 hover:bg-[#1B1F2A] hover:text-slate-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div>
                  <div className="text-xs text-slate-400">زمان‌بندی و دوربین</div>
                  <div className="mt-1 text-sm text-slate-100">
                    <span className="font-mono-tabular">
                      {lightboxShot.director.timecode}
                    </span>{" "}
                    · {lightboxShot.director.cameraAngle}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">شرح صحنه</div>
                  <p className="mt-1 text-sm leading-7 text-slate-200">
                    {lightboxShot.director.sceneDescriptionFa}
                  </p>
                </div>
                <div>
                  <div className="text-xs text-slate-400">متن گفتار شات</div>
                  <p className="mt-1 text-sm leading-7 text-slate-300">
                    {lightboxShot.director.spokenSegment || "—"}
                  </p>
                </div>
              </div>
              {lightboxShot.asset?.imageUrl && (
                <a
                  href={lightboxShot.asset.imageUrl}
                  download={`storyboard_shot_${lightboxShot.director.shotNumber}.${
                    lightboxShot.asset.imageUrl.split(".").pop()?.split("?")[0] || "png"
                  }`}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Download className="h-4 w-4" />
                  <span>دانلود فریم استوری‌بورد</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
