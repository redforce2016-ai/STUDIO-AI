import { useEffect, useState } from "react";
import {
  Brain,
  Check,
  ExternalLink,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  CompetitorViralReport,
  PageProfile,
  PlatformOption,
} from "../types/studio";

interface ViralCompetitorRadarViewProps {
  pages: PageProfile[];
  activePageId: string | null;
  onUseViralPatternAsIdea: (ideaText: string, pageId: string | null) => void;
}

export function ViralCompetitorRadarView({
  pages,
  activePageId,
  onUseViralPatternAsIdea,
}: ViralCompetitorRadarViewProps) {
  const [reports, setReports] = useState<CompetitorViralReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string>(
    activePageId || pages[0]?.id || ""
  );
  const [customQuery, setCustomQuery] = useState("");
  const [platform, setPlatform] = useState<PlatformOption>("instagram");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [savedRuleKey, setSavedRuleKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/viral-radar");
        const data = await res.json();
        if (res.ok && Array.isArray(data.reports)) {
          setReports(data.reports);
          if (data.reports[0]) setSelectedReportId(data.reports[0].id);
        }
      } catch {
        // ignore initial fetch error
      }
    })();
  }, []);

  const chosenPage = pages.find((p) => p.id === selectedPageId) || null;
  const activeReport =
    reports.find((r) => r.id === selectedReportId) || reports[0] || null;

  const handleRunAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAnalyzing(true);
    setErrorMsg(null);
    try {
      const effectiveQuery = customQuery.trim() || chosenPage?.niche || "";
      const res = await fetch("/api/viral-radar/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nicheQuery: effectiveQuery,
          platform: chosenPage?.platform || platform,
          pageProfileId: chosenPage?.id || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در تحلیل رقبا و الگوهای وایرال");
      setReports(data.reports);
      setSelectedReportId(data.report.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "خطا در تحلیل");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveToMemory = async (
    key: string,
    ruleText: string,
    agentId: "scriptwriter_agent" | "director_agent"
  ) => {
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          scope: activeReport?.pageProfileId ? "page" : "global",
          category: "viral_pattern",
          ruleText,
          sourceEvent: `رادار وایرال: ${activeReport?.nicheQuery || "تحلیل رقبا"}`,
          pageProfileId: activeReport?.pageProfileId || null,
          initialStrength: 9,
        }),
      });
      if (res.ok) {
        setSavedRuleKey(key);
        setTimeout(() => setSavedRuleKey(null), 2200);
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-100">
            رادار هوشمند رقبا و الگوهای وایرال هفته
          </h1>
          <p className="mt-1 text-xs leading-6 text-slate-400">
            کالبدشکافی قلاب رقبا، شکاف‌های محتوایی بازار و پست‌های وایرال روز با جستجوی زنده گوگل — بدون لاگین رباتیک در پیج شما و بدون ریسک شادوبن.
          </p>
        </div>
      </div>

      {/* Safe Search Analyzer Bar */}
      <form
        onSubmit={handleRunAnalysis}
        className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="mb-1 block text-xs text-slate-300">انتخاب پروفایل پیج هدف</label>
            <select
              value={selectedPageId}
              onChange={(e) => {
                setSelectedPageId(e.target.value);
                const found = pages.find((p) => p.id === e.target.value);
                if (found) setPlatform(found.platform);
              }}
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.handle})
                </option>
              ))}
              <option value="">حوزه آزاد (بدون پیج خاص)</option>
            </select>
          </div>

          <div className="md:col-span-5">
            <label className="mb-1 block text-xs text-slate-300">
              موضوع یا کلیدواژه خاص برای آنالیز رقبا (اختیاری — پیش‌فرض حوزه پیج)
            </label>
            <input
              type="text"
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              placeholder={chosenPage ? chosenPage.niche : "مثلاً: آموزش تعمیرات برد آیفون یا انیمیشن کوتاه علمی"}
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex items-end md:col-span-3">
            <button
              type="submit"
              disabled={isAnalyzing}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Radar className={`h-4 w-4 ${isAnalyzing ? "animate-spin" : ""}`} />
              <span>{isAnalyzing ? "در حال جستجوی وب و آنالیز..." : "آنالیز زنده رقبا و ترند هفته"}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-emerald-400">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>
            محافظت ۱۰۰٪ از امنیت اکانت شما: تمام تحلیل‌ها از ایندکس عمومی وب انجام می‌شود و هیچ ربات اسکرپری به اینستاگرام یا یوتیوب شما وصل نمی‌گردد.
          </span>
        </div>
      </form>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          {errorMsg}
        </div>
      )}

      {/* Report Selector Tabs if multiple reports exist */}
      {reports.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {reports.map((rep) => (
            <button
              key={rep.id}
              type="button"
              onClick={() => setSelectedReportId(rep.id)}
              className={`rounded-lg border px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                activeReport?.id === rep.id
                  ? "border-amber-500 bg-amber-500/15 text-amber-300"
                  : "border-[#262B38] bg-[#14171F] text-slate-400 hover:text-slate-200"
              }`}
            >
              {rep.nicheQuery.slice(0, 42)}
            </button>
          ))}
        </div>
      )}

      {/* Active Report Display */}
      {activeReport && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-[#262B38] bg-[#14171F] p-6">
            <div className="text-xs text-amber-400">
              گزارش استراتژیک · {activeReport.platform} ·{" "}
              <span className="font-mono-tabular">
                {new Date(activeReport.analyzedAt).toLocaleDateString("fa-IR")}
              </span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-slate-100">{activeReport.nicheQuery}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-200">{activeReport.executiveSummary}</p>
          </div>

          {/* Competitor Gap Matrix */}
          <section className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-6">
            <h3 className="text-sm font-bold text-slate-100">
              کالبدشکافی رقبا و شکاف طلایی برای پیج شما
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-right text-xs">
                <thead>
                  <tr className="border-b border-[#262B38] text-slate-400">
                    <th className="py-3 pl-4 font-medium">رقیب / تیپ پیج</th>
                    <th className="py-3 px-4 font-medium">نقطه قوت فعلی</th>
                    <th className="py-3 px-4 font-medium">فرمول قلاب آن‌ها</th>
                    <th className="py-3 pr-4 font-medium text-emerald-400">ضعف آن‌ها (فرصت برنده شدن ما)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#262B38]/70">
                  {activeReport.competitors.map((comp, idx) => (
                    <tr key={idx} className="align-top">
                      <td className="py-3.5 pl-4 font-semibold text-slate-100">
                        <span dir="ltr" className="font-mono-tabular">
                          {comp.nameOrHandle}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 leading-6 text-slate-300">{comp.coreStrength}</td>
                      <td className="py-3.5 px-4 leading-6 text-amber-300">{comp.winningHookFormula}</td>
                      <td className="py-3.5 pr-4 leading-6 text-emerald-300">
                        {comp.weaknessOrGapForUs}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Weekly Top Viral Patterns */}
          <section className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100">
                الگوهای پست‌های وایرال برتر (آماده تبدیل به پست یا ذخیره در حافظه ایجنت)
              </h3>
            </div>

            <div className="divide-y divide-[#262B38]">
              {activeReport.weeklyTopViralPatterns.map((pat) => {
                const memKey = `pat_${activeReport.id}_${pat.rank}`;
                return (
                  <div key={pat.rank} className="space-y-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-amber-400 font-mono-tabular">
                          الگوی وایرال شماره ۰{pat.rank}
                        </div>
                        <h4 className="mt-0.5 text-sm font-bold text-slate-100">
                          {pat.patternTitle}
                        </h4>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleSaveToMemory(
                              memKey,
                              `الگوی قلاب «${pat.patternTitle}»: ${pat.hookStructureFa} — مکانیزم نگهداشت: ${pat.retentionMechanismFa}`,
                              "scriptwriter_agent"
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs text-slate-200 hover:border-amber-500/50 whitespace-nowrap shrink-0"
                        >
                          {savedRuleKey === memKey ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="text-emerald-300">به حافظه ایجنت اضافه شد</span>
                            </>
                          ) : (
                            <>
                              <Brain className="h-3.5 w-3.5 text-amber-400" />
                              <span>آموزش این الگو به ایجنت سناریونویس</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            onUseViralPatternAsIdea(
                              `ساخت ویدیو بر اساس الگوی وایرال «${pat.patternTitle}» — ساختار قلاب: ${pat.hookStructureFa}`,
                              activeReport.pageProfileId
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>ساخت پست با این الگو</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 text-xs leading-6 text-slate-300 md:grid-cols-3">
                      <div>
                        <span className="font-semibold text-slate-100">ساختار قلاب: </span>
                        {pat.hookStructureFa}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-100">نگهداشت مخاطب: </span>
                        {pat.retentionMechanismFa}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-100">ریتم تصویر و کات‌ها: </span>
                        {pat.visualRhythmNote}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Algorithm Guardrails & Sources */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <section className="space-y-3 rounded-2xl border border-[#262B38] bg-[#14171F] p-6 lg:col-span-7">
              <h3 className="text-sm font-bold text-slate-100">
                قوانین الگوریتم و خطوط قرمز جلوگیری از افت بازدید پیج
              </h3>
              <ul className="space-y-2 text-xs leading-6 text-slate-300">
                {activeReport.algorithmRulesAndRedLines.map((rule, idx) => (
                  <li key={idx} className="flex items-start justify-between gap-3 border-b border-[#262B38]/60 pb-2 last:border-b-0">
                    <span>• {rule}</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleSaveToMemory(`alg_${idx}`, rule, "director_agent")
                      }
                      className="text-[11px] text-amber-400 hover:text-amber-300 whitespace-nowrap shrink-0"
                    >
                      {savedRuleKey === `alg_${idx}` ? "ذخیره شد" : "+ ثبت در حافظه"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-3 rounded-2xl border border-[#262B38] bg-[#14171F] p-6 lg:col-span-5">
              <h3 className="text-sm font-bold text-slate-100">منابع وب بررسی‌شده</h3>
              {activeReport.sources.length === 0 ? (
                <p className="text-xs text-slate-400">گزارش پایه آماده است؛ برای دریافت منابع وب جدید دکمه آنالیز زنده را بزنید.</p>
              ) : (
                <div className="space-y-2">
                  {activeReport.sources.map((src, i) => (
                    <a
                      key={i}
                      href={src.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-2 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-300 hover:border-amber-500/40 hover:text-amber-300"
                    >
                      <span className="truncate">{src.title}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    </a>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
