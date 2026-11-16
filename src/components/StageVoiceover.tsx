import { useEffect, useState } from "react";
import { ArrowLeft, Check, Download, Mic, RefreshCw, Volume2 } from "lucide-react";
import type { VoicePersona, VoiceoverOutput } from "../types/studio";

interface StageVoiceoverProps {
  data: VoiceoverOutput;
  isRunning: boolean;
  isCurrentGate: boolean;
  onSaveEdits: (updated: VoiceoverOutput) => void;
  onResynthesizeAudio: (params: {
    narrationText: string;
    voiceName: VoicePersona;
    voiceStyle: string;
  }) => Promise<void>;
  onApprove: (updated: VoiceoverOutput) => Promise<void>;
  onRegenerateTextAndAudio: (feedback: string) => Promise<void>;
}

const VOICE_OPTIONS: Array<{ id: VoicePersona; label: string; desc: string }> = [
  { id: "Kore", label: "Kore — متعادل و مستند", desc: "مناسب ویدیوهای آموزشی و توضیحی" },
  { id: "Puck", label: "Puck — سریع و پرانرژی", desc: "مناسب قلاب‌های وایرال و ریتم تند" },
  { id: "Charon", label: "Charon — عمیق و سینمایی", desc: "مناسب روایت‌های داستانی و جدی" },
  { id: "Fenrir", label: "Fenrir — قاطع و خبری", desc: "مناسب تحلیل‌ها و گزارش‌های خبری" },
  { id: "Zephyr", label: "Zephyr — گرم و صمیمی", desc: "مناسب گفتگوی دوستانه و لایف‌استایل" },
];

export function StageVoiceover({
  data,
  isRunning,
  isCurrentGate,
  onSaveEdits,
  onResynthesizeAudio,
  onApprove,
  onRegenerateTextAndAudio,
}: StageVoiceoverProps) {
  const [draft, setDraft] = useState<VoiceoverOutput>(data);
  const [feedback, setFeedback] = useState("");
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(data);
  }, [data]);

  const handleAudioRefresh = async () => {
    setIsSynthesizing(true);
    try {
      await onResynthesizeAudio({
        narrationText: draft.narrationText,
        voiceName: draft.voiceName,
        voiceStyle: draft.voiceStyle,
      });
    } finally {
      setIsSynthesizing(false);
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
            <span>مرحله ۲ · صدای گوینده</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">
              {isCurrentGate ? "آماده گوش دادن و تایید شما" : "بازبینی متن و صدا"}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            متن گفتاری و فایل صدای نریشن
          </h2>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isRunning || isSynthesizing}
          className="inline-flex items-center gap-2 rounded-lg border border-[#262B38] bg-[#14171F] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
        >
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span>{savedNotice ? "ذخیره شد" : "ذخیره متن نریشن"}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Narration Script Editor */}
        <section className="space-y-4 rounded-xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262B38] pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Mic className="h-4 w-4 text-amber-400" />
              <span>متن گفتاری نریشن (با نشانگرهای مکث)</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="font-mono-tabular">{draft.wordCount} کلمه</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">حدود {draft.estimatedSeconds} ثانیه</span>
            </div>
          </div>

          <textarea
            rows={8}
            value={draft.narrationText}
            disabled={isRunning || isSynthesizing}
            onChange={(e) => {
              const text = e.target.value;
              const words = text.replace(/\[[^\]]*\]/g, " ").trim().split(/\s+/).filter(Boolean).length;
              setDraft({ ...draft, narrationText: text, wordCount: words });
            }}
            className="w-full resize-y rounded-lg border border-[#262B38] bg-[#0B0D11] px-4 py-3 text-sm leading-8 text-slate-100 focus:border-amber-500 focus:outline-none"
          />

          <div className="space-y-1.5 border-t border-[#262B38] pt-3">
            <div className="text-xs font-medium text-slate-400">راهنمای ریتم و تاکید گوینده</div>
            <p className="text-xs leading-6 text-slate-300">{draft.pacingNotes}</p>
          </div>
        </section>

        {/* Audio Studio & Voice Config */}
        <section className="space-y-5 rounded-xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-5">
          <div className="flex items-center gap-2 border-b border-[#262B38] pb-3 text-sm font-semibold text-slate-100">
            <Volume2 className="h-4 w-4 text-amber-400" />
            <span>تنظیمات و پخش صدا</span>
          </div>

          <div className="space-y-2">
            <label htmlFor="voice-persona" className="block text-xs font-medium text-slate-300">
              انتخاب صدای گوینده
            </label>
            <select
              id="voice-persona"
              value={draft.voiceName}
              disabled={isRunning || isSynthesizing}
              onChange={(e) => setDraft({ ...draft, voiceName: e.target.value as VoicePersona })}
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.desc})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="voice-style" className="block text-xs font-medium text-slate-300">
              دستورالعمل لحن اجرا
            </label>
            <input
              id="voice-style"
              type="text"
              value={draft.voiceStyle}
              disabled={isRunning || isSynthesizing}
              onChange={(e) => setDraft({ ...draft, voiceStyle: e.target.value })}
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <button
            type="button"
            disabled={isRunning || isSynthesizing}
            onClick={handleAudioRefresh}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSynthesizing ? "animate-spin" : ""}`} />
            <span>{isSynthesizing ? "در حال ضبط صوت جدید..." : "تولید مجدد فایل صوتی با تنظیمات فعلی"}</span>
          </button>

          <div className="space-y-3 rounded-lg border border-[#262B38] bg-[#0B0D11] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>پیش‌نمایش فایل صوتی نریشن (WAV)</span>
              {draft.audioUrl && (
                <a
                  href={draft.audioUrl}
                  download={draft.audioFilename || "narration.wav"}
                  className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>دانلود WAV</span>
                </a>
              )}
            </div>

            {draft.audioUrl ? (
              <audio controls src={draft.audioUrl} className="w-full accent-amber-500" />
            ) : (
              <div className="py-3 text-xs text-slate-400">
                {draft.audioError || "فایل صوتی هنوز تولید نشده است؛ دکمه تولید مجدد را بزنید."}
              </div>
            )}

            {draft.audioError && draft.audioUrl && (
              <div className="text-xs text-amber-300">{draft.audioError}</div>
            )}
          </div>
        </section>
      </div>

      {/* Checkpoint 2 Bar */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={feedback}
              disabled={isRunning || isSynthesizing}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="بازخورد برای بازنویسی متن نریشن (مثلاً: لحن را صمیمی‌تر کن و مکث‌ها را بیشتر کن)..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning || isSynthesizing}
              onClick={() => onRegenerateTextAndAudio(feedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              <span>بازتولید متن و صدا</span>
            </button>
          </div>

          <button
            type="button"
            disabled={isRunning || isSynthesizing}
            onClick={() => onApprove(draft)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <span>{isRunning ? "در حال تدوین دکوپاژ..." : "تایید نریشن و ارسال به کارگردان"}</span>
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
