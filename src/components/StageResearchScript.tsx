import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Check, ExternalLink, RefreshCw } from "lucide-react";
import type { ResearchAndScriptOutput } from "../types/studio";

interface StageResearchScriptProps {
  data: ResearchAndScriptOutput;
  isRunning: boolean;
  isCurrentGate: boolean;
  onSaveEdits: (updated: ResearchAndScriptOutput) => void;
  onApprove: (updated: ResearchAndScriptOutput) => Promise<void>;
  onRegenerate: (feedback: string) => Promise<void>;
}

export function StageResearchScript({
  data,
  isRunning,
  isCurrentGate,
  onSaveEdits,
  onApprove,
  onRegenerate,
}: StageResearchScriptProps) {
  const [draft, setDraft] = useState<ResearchAndScriptOutput>(data);
  const [feedback, setFeedback] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(data);
  }, [data]);

  const updateField = <K extends keyof ResearchAndScriptOutput>(
    key: K,
    value: ResearchAndScriptOutput[K]
  ) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
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
            <span>مرحله ۱ · پژوهش و سناریو</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">
              {isCurrentGate ? "آماده بررسی و تایید شما" : "بازبینی و ویرایش"}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            سناریوی پیشنهادی و نکات کلیدی تحقیق
          </h2>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isRunning}
          className="inline-flex items-center gap-2 rounded-lg border border-[#262B38] bg-[#14171F] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
        >
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span>{savedNotice ? "تغییرات ذخیره شد" : "ذخیره پیش‌نویس"}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Research Panel */}
        <section className="space-y-5 rounded-xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-5">
          <div className="flex items-center gap-2 border-b border-[#262B38] pb-3 text-sm font-semibold text-slate-100">
            <BookOpen className="h-4 w-4 text-amber-400" />
            <span>گزارش پژوهشگر</span>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-400">جمع‌بندی پژوهش و زمینه موضوع</div>
            <p className="text-sm leading-7 text-slate-200">{draft.researchSummary}</p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-400">آمار و یافته‌های کلیدی</div>
            <ul className="space-y-2">
              {draft.keyInsights.map((insight, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2.5 border-b border-[#262B38]/60 pb-2 text-xs leading-6 text-slate-300 last:border-b-0"
                >
                  <span className="font-mono-tabular mt-0.5 text-amber-400">
                    {String(idx + 1).padStart(2, "0")}.
                  </span>
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-400">زاویه‌های جذاب پیشنهادی</div>
            <ul className="space-y-1.5 text-xs leading-6 text-slate-300">
              {draft.trendingAngles.map((angle, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-slate-500">—</span>
                  <span>{angle}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5 border-t border-[#262B38] pt-3">
            <div className="text-xs font-medium text-slate-400">مخاطب هدف</div>
            <p className="text-xs leading-6 text-slate-300">{draft.targetAudienceNote}</p>
          </div>

          {draft.sources.length > 0 && (
            <div className="space-y-2 border-t border-[#262B38] pt-3">
              <div className="text-xs font-medium text-slate-400">منابع جستجوی وب (Grounded Sources)</div>
              <div className="space-y-1.5">
                {draft.sources.map((src, idx) => (
                  <a
                    key={idx}
                    href={src.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 rounded-md border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-300 transition-colors hover:border-amber-500/40 hover:text-amber-300"
                  >
                    <span className="truncate">{src.title}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Editable Scriptwriter Panel */}
        <section className="space-y-5 rounded-xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-7">
          <div className="border-b border-[#262B38] pb-3">
            <h3 className="text-sm font-semibold text-slate-100">سناریوی تدوین‌شده (قابل ویرایش مستقیم)</h3>
            <p className="mt-1 text-xs text-slate-400">
              متن قلاب، بدنه و دعوت به اقدام را قبل از ارسال به ایجنت گوینده بررسی و در صورت نیاز اصلاح کنید.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="script-title" className="block text-xs font-medium text-slate-300">
              عنوان پیشنهادی ویدیو
            </label>
            <input
              id="script-title"
              type="text"
              value={draft.videoTitle}
              disabled={isRunning}
              onChange={(e) => updateField("videoTitle", e.target.value)}
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-sm font-medium text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="script-hook" className="font-medium text-amber-400">
                ۰۱. قلاب (Hook — ۳ ثانیه طلایی اول)
              </label>
              <span className="font-mono-tabular text-slate-500">
                {draft.hook.split(/\s+/).filter(Boolean).length} کلمه
              </span>
            </div>
            <textarea
              id="script-hook"
              rows={2}
              value={draft.hook}
              disabled={isRunning}
              onChange={(e) => updateField("hook", e.target.value)}
              className="w-full resize-y rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-sm leading-7 text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="script-body" className="font-medium text-slate-200">
                ۰۲. بدنه اصلی سناریو (Body)
              </label>
              <span className="font-mono-tabular text-slate-500">
                {draft.body.split(/\s+/).filter(Boolean).length} کلمه
              </span>
            </div>
            <textarea
              id="script-body"
              rows={6}
              value={draft.body}
              disabled={isRunning}
              onChange={(e) => updateField("body", e.target.value)}
              className="w-full resize-y rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-sm leading-7 text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="script-cta" className="font-medium text-emerald-400">
                ۰۳. دعوت به اقدام پایانی (CTA)
              </label>
              <span className="font-mono-tabular text-slate-500">
                {draft.cta.split(/\s+/).filter(Boolean).length} کلمه
              </span>
            </div>
            <textarea
              id="script-cta"
              rows={2}
              value={draft.cta}
              disabled={isRunning}
              onChange={(e) => updateField("cta", e.target.value)}
              className="w-full resize-y rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-sm leading-7 text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="border-t border-[#262B38] pt-3 text-xs text-slate-400">
            کلیدواژه‌ها: <span className="text-slate-200">{draft.keywords.join(" · ")}</span>
          </div>
        </section>
      </div>

      {/* Human-in-the-Loop Checkpoint Bar */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={feedback}
              disabled={isRunning}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="دستور اصلاحی برای بازتولید (مثلاً: قلاب را جنجالی‌تر کن و آمار بیشتری بیاور)..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onRegenerate(feedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              <span>بازتولید پژوهش و سناریو</span>
            </button>
          </div>

          <button
            type="button"
            disabled={isRunning}
            onClick={() => onApprove(draft)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <span>{isRunning ? "در حال ارسال به گوینده..." : "تایید سناریو و ارسال به گوینده"}</span>
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
