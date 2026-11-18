import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, ShieldAlert, Wrench } from "lucide-react";
import type { StageQualityAudit } from "../types/studio";

interface QualityAuditBadgeProps {
  audit?: StageQualityAudit | null;
  compact?: boolean;
}

export function QualityAuditBadge({ audit, compact = false }: QualityAuditBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  if (!audit) return null;

  const passedCount = audit.checks.filter((c) => c.passed).length;
  const totalCount = audit.checks.length;

  return (
    <div
      data-testid={`qa-audit-${audit.stage}`}
      className="rounded-xl border border-[#262B38] bg-[#0B0D11]/85 px-4 py-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {audit.passed ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
          )}
          <span className="font-semibold text-slate-100">
            گزارش لایه بازبینی فنی و کیفیت
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span
            className={`font-mono-tabular font-bold ${
              audit.score >= 85
                ? "text-emerald-400"
                : audit.score >= 65
                  ? "text-amber-300"
                  : "text-red-400"
            }`}
          >
            امتیاز {audit.score}%
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="font-mono-tabular text-slate-400">
            {passedCount} از {totalCount} معیار تاییدشده
          </span>
          {audit.selfHealed && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-sky-300">
                <Wrench className="h-3 w-3" />
                <span>اصلاح خودکار ({audit.attemptsRun} دور)</span>
              </span>
            </>
          )}
          {!compact && audit.inspectorModel && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span dir="ltr" className="font-mono-tabular text-[11px] text-slate-400">
                {audit.inspectorModel}
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 whitespace-nowrap shrink-0"
        >
          <span>{expanded ? "بستن جزئیات بازبینی" : "مشاهده جزئیات بازبینی"}</span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-[#262B38] pt-3">
          {audit.visionCritiqueFa && (
            <div className="rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs leading-6 text-slate-200">
              <span className="font-semibold text-sky-300">ارزیابی ناظر بینایی: </span>
              <span>{audit.visionCritiqueFa}</span>
            </div>
          )}

          {audit.fixesAppliedFa && audit.fixesAppliedFa.length > 0 && (
            <div className="rounded-lg border border-sky-500/30 bg-[#14171F] px-3 py-2 text-xs leading-6 text-sky-200">
              <div className="font-semibold text-sky-300">اصلاحات خودکار اعمال‌شده:</div>
              <ul className="mt-1 space-y-0.5 pr-4 list-disc">
                {audit.fixesAppliedFa.map((fx, idx) => (
                  <li key={idx}>{fx}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {audit.checks.map((chk, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between gap-2 rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 font-medium text-slate-100">
                    <span
                      className={chk.passed ? "text-emerald-400" : "text-amber-400"}
                    >
                      {chk.passed ? "✓" : "!"}
                    </span>
                    <span>{chk.nameFa}</span>
                  </div>
                  <div className="text-[11px] leading-5 text-slate-400">{chk.detailFa}</div>
                </div>
                {chk.metric && (
                  <span
                    dir="ltr"
                    className="font-mono-tabular shrink-0 text-[11px] font-semibold text-slate-300"
                  >
                    {chk.metric}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
