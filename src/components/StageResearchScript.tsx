import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { ResearchAndScriptOutput } from "../types/studio";
import { QualityAuditBadge } from "./QualityAuditBadge";

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
    setDraft({ ...draft, [key]: value });
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
            <span>مرحله ۱ از ۵ · ایجنت ۱ (سناریونویس)</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">
              {isCurrentGate ? "ایستگاه تایید انسانی سناریو" : "بازبینی و ویرایش"}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            سناریوی کامل، روانشناسی مخاطب و ایمنی الگوریتم
          </h2>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isRunning}
          className="inline-flex items-center gap-2 rounded-lg border border-[#262B38] bg-[#14171F] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
        >
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span>{savedNotice ? "ذخیره شد" : "ذخیره پیش‌نویس"}</span>
        </button>
      </div>

      <QualityAuditBadge audit={draft.qaAudit} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Research, Psychology & Algorithm Safety Panel */}
        <section className="space-y-5 rounded-xl border border-[#262B38] bg-[#14171F] p-5 lg:col-span-5">
          <div className="flex items-center gap-2 border-b border-[#262B38] pb-3 text-sm font-semibold text-slate-100">
            <BookOpen className="h-4 w-4 text-amber-400" />
            <span>اعتبارسنجی علمی، روانشناسی و الگوریتم</span>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-400">خلاصه پژوهش بازار</div>
            <p className="text-xs leading-6 text-slate-200">{draft.researchSummary}</p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-400">فکت‌ها و اعداد کلیدی داخل سناریو</div>
            <ul className="space-y-2">
              {draft.keyInsights.map((insight, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 border-b border-[#262B38]/60 pb-2 text-xs leading-6 text-slate-300 last:border-b-0"
                >
                  <span className="font-mono-tabular mt-0.5 text-amber-400">
                    {String(idx + 1).padStart(2, "0")}.
                  </span>
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          </div>

          {draft.psychologicalTriggersUsed && draft.psychologicalTriggersUsed.length > 0 && (
            <div className="space-y-1.5 border-t border-[#262B38] pt-3">
              <div className="text-xs font-medium text-amber-300">محرک‌های روانشناسی به‌کاررفته</div>
              <ul className="space-y-1 text-xs leading-6 text-slate-300">
                {draft.psychologicalTriggersUsed.map((tr, idx) => (
                  <li key={idx}>• {tr}</li>
                ))}
              </ul>
            </div>
          )}

          {draft.algorithmComplianceChecklist && draft.algorithmComplianceChecklist.length > 0 && (
            <div className="space-y-1.5 border-t border-[#262B38] pt-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>چک‌لیست محافظت از الگوریتم پیج</span>
              </div>
              <ul className="space-y-1 text-xs leading-6 text-slate-300">
                {draft.algorithmComplianceChecklist.map((chk, idx) => (
                  <li key={idx}>✓ {chk}</li>
                ))}
              </ul>
            </div>
          )}

          {draft.sources.length > 0 && (
            <div className="space-y-2 border-t border-[#262B38] pt-3">
              <div className="text-xs font-medium text-slate-400">منابع وب بررسی‌شده</div>
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
            <h3 className="text-sm font-semibold text-slate-100">متن کامل سناریو (قابل ویرایش مستقیم)</h3>
            <p className="mt-1 text-xs text-slate-400">
              پس از تایید شما، کارگردان ۷ لایه دکوپاژ کامل، کی‌فریم‌ها و ممیزی QA هر شات (مرحله ۲) را آماده می‌کند.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="script-title" className="block text-xs font-medium text-slate-300">
              عنوان نهایی پست
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
                ۰۱. قلاب (Hook — ۱.۵ تا ۳ ثانیه اول برای توقف اسکرول)
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
                ۰۳. دعوت به اقدام هوشمند (CTA)
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

      {/* Human-in-the-Loop Gate 1 */}
      <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={feedback}
              disabled={isRunning}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="نکته اصلاحی (یادگیری خودکار در حافظه ایجنت ۱ — مثلاً: قلاب را کوتاه‌تر و صنعتی‌تر کن)..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onRegenerate(feedback)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-4 py-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              <span>بازنویسی سناریو</span>
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
                ? "در حال طراحی استوری‌بورد ۷ لایه و کی‌فریم‌ها..."
                : "تایید سناریو و ساخت استوری‌بورد (مرحله ۲)"}
            </span>
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
