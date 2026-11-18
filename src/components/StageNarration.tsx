import { useEffect, useState } from "react";
import { ArrowLeft, Check, Languages, RefreshCw } from "lucide-react";
import type { NarrationScriptOutput } from "../types/studio";
import { QualityAuditBadge } from "./QualityAuditBadge";

interface StageNarrationProps {
  data: NarrationScriptOutput;
  isRunning: boolean;
  isCurrentGate: boolean;
  onSaveEdits: (updated: NarrationScriptOutput) => void;
  onApprove: (updated: NarrationScriptOutput) => Promise<void>;
  onRegenerate: (feedback: string) => Promise<void>;
}

export function StageNarration({
  data,
  isRunning,
  isCurrentGate,
  onSaveEdits,
  onApprove,
  onRegenerate,
}: StageNarrationProps) {
  const [draft, setDraft] = useState<NarrationScriptOutput>(data);
  const [feedback, setFeedback] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(data);
  }, [data]);

  const insertDiacritic = (mark: string) => {
    setDraft((prev) => ({
      ...prev,
      vocalizedNarrationText: `${prev.vocalizedNarrationText}${mark}`,
    }));
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
            <span>مرحله ۲ از ۶ · ایجنت ۱ (متن گویندگی و آوانگاری)</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono-tabular text-slate-400">
              {draft.wordCount} کلمه · حدود {draft.estimatedSeconds} ثانیه
            </span>
            {isCurrentGate && (
              <>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-emerald-400">منتظر تایید انسانی</span>
              </>
            )}
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            متن گویندگی هماهنگ با تصویر و اِعراب‌گذاری دقیق فارسی
          </h2>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isRunning}
          className="inline-flex items-center gap-2 rounded-lg border border-[#262B38] bg-[#14171F] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
        >
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span>{savedNotice ? "ذخیره شد" : "ذخیره متن گویندگی"}</span>
        </button>
      </div>

      <QualityAuditBadge audit={draft.qaAudit} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Vocalized Persian Script Editor */}
        <section className="space-y-4 rounded-xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262B38] pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Languages className="h-4 w-4 text-amber-400" />
              <span>متن اِعراب‌گذاری‌شده (آماده کلون صدا بدون خطای تلفظ)</span>
            </div>

            <div className="flex items-center gap-1">
              {[
                { label: "فتحه َ", ch: "َ" },
                { label: "کسره ِ", ch: "ِ" },
                { label: "ضمه ُ", ch: "ُ" },
                { label: "تشدید ّ", ch: "ّ" },
                { label: "+ مکث", ch: " [مکث ۰.۴ ثانیه] " },
              ].map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => insertDiacritic(m.ch)}
                  className="rounded border border-[#262B38] bg-[#0B0D11] px-2 py-1 text-[11px] text-slate-300 hover:border-amber-500/50 hover:text-amber-300 whitespace-nowrap"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            rows={8}
            value={draft.vocalizedNarrationText}
            disabled={isRunning}
            onChange={(e) => {
              const text = e.target.value;
              const words = text
                .replace(/\[[^\]]*\]/g, " ")
                .trim()
                .split(/\s+/)
                .filter(Boolean).length;
              setDraft({ ...draft, vocalizedNarrationText: text, wordCount: words });
            }}
            className="w-full resize-y rounded-lg border border-[#262B38] bg-[#0B0D11] px-4 py-3 text-base leading-9 text-slate-100 focus:border-amber-500 focus:outline-none"
          />

          <div className="space-y-1.5 border-t border-[#262B38] pt-3">
            <div className="text-xs font-medium text-slate-400">متن ساده (بدون اعراب برای مطالعه سریع)</div>
            <p className="text-xs leading-6 text-slate-300">{draft.plainNarrationText}</p>
          </div>
        </section>

        {/* Pronunciation Guide & Emotion Arc */}
        <section className="space-y-4 rounded-xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-5">
          <div className="border-b border-[#262B38] pb-3 text-sm font-semibold text-slate-100">
            جدول تلفظ کلمات حساس و قوس احساسی بیان
          </div>

          {draft.pronunciationGuide.length > 0 && (
            <div className="divide-y divide-[#262B38]/70 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2">
              {draft.pronunciationGuide.map((item, idx) => (
                <div key={idx} className="flex items-start justify-between gap-3 py-2.5 text-xs">
                  <div>
                    <span className="text-slate-400">{item.word}</span>
                    <span className="mx-2 text-slate-600">←</span>
                    <span className="font-bold text-amber-300 text-sm">{item.vocalized}</span>
                  </div>
                  <span className="text-[11px] text-slate-300 text-left">
                    {item.emotionOrStressNote}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5 border-t border-[#262B38] pt-3">
            <div className="text-xs font-medium text-amber-300">ریتم تنفس و مکث‌ها</div>
            <p className="text-xs leading-6 text-slate-300">{draft.rhythmAndPauseNotes}</p>
          </div>

          <div className="space-y-1.5 border-t border-[#262B38] pt-3">
            <div className="text-xs font-medium text-emerald-300">قوس احساسی گوینده از شروع تا پایان</div>
            <p className="text-xs leading-6 text-slate-300">{draft.emotionArcSummary}</p>
          </div>
        </section>
      </div>

      {/* Gate 2 Bar */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={feedback}
              disabled={isRunning}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="اصلاحیه متن گویندگی (مثلاً: جملات را کوتاه‌تر و محاوره‌ای‌تر کن یا اعراب کلمات فنی را بیشتر کن)..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onRegenerate(feedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              <span>بازنویسی متن گویندگی</span>
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
                ? "در حال شکستن به شات‌های ۳ تا ۸ ثانیه و ساخت ۲ فریم..."
                : "تایید متن گویندگی و تحویل به ایجنت کارگردان"}
            </span>
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
