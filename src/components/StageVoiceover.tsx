import { useEffect, useState } from "react";
import { ArrowLeft, Check, Download, Mic, RefreshCw, Volume2 } from "lucide-react";
import type { VoicePersona, VoiceoverOutput } from "../types/studio";
import { QualityAuditBadge } from "./QualityAuditBadge";

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
  { id: "Charon", label: "Charon — عمیق، صنعتی و سینمایی", desc: "مناسب پیج‌های فنی، آهن‌آلات و مستند" },
  { id: "Kore", label: "Kore — شفاف و آموزشی", desc: "مناسب آموزش‌های دقیق و تعمیرات" },
  { id: "Puck", label: "Puck — سریع و پرانرژی", desc: "مناسب تکنولوژی، هوش مصنوعی و قلاب‌های تند" },
  { id: "Fenrir", label: "Fenrir — قاطع و تحلیلی", desc: "مناسب اخبار و بررسی بازار" },
  { id: "Zephyr", label: "Zephyr — گرم و صمیمی", desc: "مناسب روایت داستانی و انیمیشن" },
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
        narrationText: draft.vocalizedText || draft.narrationText,
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
            <span>مرحله ۵ از ۶ · ایجنت ۲ (کلون صدا و ضبط نریشن فارسی)</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">
              {isCurrentGate ? "ایستگاه تایید صدای گوینده" : "بازبینی فایل صوتی"}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            تولید صدای گوینده با رعایت کامل اعراب‌گذاری، حس و ریتم فارسی
          </h2>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isRunning || isSynthesizing}
          className="inline-flex items-center gap-2 rounded-lg border border-[#262B38] bg-[#14171F] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
        >
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span>{savedNotice ? "ذخیره شد" : "ذخیره تنظیمات صدا"}</span>
        </button>
      </div>

      <QualityAuditBadge audit={draft.qaAudit} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Vocalized Narration Text */}
        <section className="space-y-4 rounded-xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262B38] pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Mic className="h-4 w-4 text-amber-400" />
              <span>متن اعراب‌گذاری‌شده ورودی موتور صوتی</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono-tabular">
              <span>{draft.wordCount} کلمه</span>
              <span aria-hidden="true">·</span>
              <span>حدود {draft.estimatedSeconds} ثانیه</span>
            </div>
          </div>

          <textarea
            rows={7}
            value={draft.vocalizedText || draft.narrationText}
            disabled={isRunning || isSynthesizing}
            onChange={(e) => {
              const text = e.target.value;
              const words = text
                .replace(/\[[^\]]*\]/g, " ")
                .trim()
                .split(/\s+/)
                .filter(Boolean).length;
              setDraft({
                ...draft,
                vocalizedText: text,
                narrationText: text,
                wordCount: words,
              });
            }}
            className="w-full resize-y rounded-lg border border-[#262B38] bg-[#0B0D11] px-4 py-3 text-base leading-9 text-slate-100 focus:border-amber-500 focus:outline-none"
          />

          {draft.cloneEngineNote && (
            <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-emerald-300">
              {draft.cloneEngineNote}
            </div>
          )}

          {draft.referenceSampleUrl && (
            <div className="space-y-1.5 border-t border-[#262B38] pt-3">
              <div className="text-xs text-slate-400">نمونه صدای مرجع متصل از پروفایل این پیج:</div>
              <audio controls src={draft.referenceSampleUrl} className="h-9 w-full accent-amber-500" />
            </div>
          )}
        </section>

        {/* Audio Synthesis & WAV Player */}
        <section className="space-y-5 rounded-xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-5">
          <div className="flex items-center gap-2 border-b border-[#262B38] pb-3 text-sm font-semibold text-slate-100">
            <Volume2 className="h-4 w-4 text-amber-400" />
            <span>خروجی صوتی WAV استودیو (24kHz)</span>
          </div>

          <div className="space-y-2">
            <label htmlFor="voice-persona" className="block text-xs font-medium text-slate-300">
              پرسونای صدا
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
              کارگردانی حس، ریتم و لحن بیان
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
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSynthesizing ? "animate-spin" : ""}`} />
            <span>{isSynthesizing ? "در حال سنتز فایل WAV..." : "تولید مجدد صدا با اعراب فعلی"}</span>
          </button>

          <div className="space-y-3 rounded-lg border border-[#262B38] bg-[#0B0D11] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>پخش صدای نهایی گوینده (WAV)</span>
              {draft.audioUrl && (
                <a
                  href={draft.audioUrl}
                  download={draft.audioFilename || "narration.wav"}
                  className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 whitespace-nowrap"
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
                {draft.audioError || "برای شنیدن صدا دکمه تولید مجدد صدا را بزنید."}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Gate 5 Bar */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={feedback}
              disabled={isRunning || isSynthesizing}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="بازخورد اصلاح لحن و صدا (مثلاً: با مکث بیشتر روی اعداد مهندسی بخوان)..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning || isSynthesizing}
              onClick={() => onRegenerateTextAndAudio(feedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              <span>بازتولید صدا</span>
            </button>
          </div>

          <button
            type="button"
            disabled={isRunning || isSynthesizing}
            onClick={() => onApprove(draft)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <span>
              {isRunning
                ? "در حال ساخت پکیج DaVinci Resolve..."
                : "تایید صدا و ساخت پروژه خودکار DaVinci Resolve"}
            </span>
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
