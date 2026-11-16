import { useState } from "react";
import type { User } from "firebase/auth";
import {
  Cloud,
  Download,
  FileText,
  FolderOpen,
  LogIn,
  LogOut,
  Monitor,
  Trash2,
} from "lucide-react";
import type { ProjectRecord } from "../types/studio";
import { WindowsBundleView } from "./WindowsBundleView";

interface ProjectsAndDesktopViewProps {
  projects: ProjectRecord[];
  selectedProjectId: string | null;
  firebaseUser: User | null;
  cloudProjectCount: number;
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  onOpenProject: (project: ProjectRecord) => void;
  onDeleteProject: (id: string) => Promise<void>;
  onExportMarkdown: (project: ProjectRecord) => void;
  onExportJson: (project: ProjectRecord) => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "اینستاگرام",
  youtube: "یوتیوب",
  tiktok: "تیک‌تاک",
  reels: "اینستاگرام ریلز",
  shorts: "یوتیوب شورتس",
};

const FORMAT_LABELS: Record<string, string> = {
  reels: "ریلز",
  post: "پست",
  story: "استوری",
  shorts: "شورتس",
  long_video: "ویدیوی کامل",
  tiktok_video: "ویدیو",
  carousel: "اسلاید",
};

export function ProjectsAndDesktopView({
  projects,
  selectedProjectId,
  firebaseUser,
  cloudProjectCount,
  onGoogleSignIn,
  onGoogleSignOut,
  onOpenProject,
  onDeleteProject,
  onExportMarkdown,
  onExportJson,
}: ProjectsAndDesktopViewProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showDesktopSource, setShowDesktopSource] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Cloud Sync & Windows Desktop Quick Strip */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Google Account Cloud Sync */}
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5">
          {firebaseUser ? (
            <>
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <Cloud className="h-4 w-4" />
                  <span>پشتیبان‌گیری ابری فعال ({cloudProjectCount} پروژه)</span>
                </div>
                <div className="truncate text-sm font-bold text-slate-100">
                  {firebaseUser.displayName || "کاربر گوگل"}
                </div>
                <div className="truncate text-xs text-slate-400">{firebaseUser.email}</div>
              </div>
              <button
                type="button"
                onClick={onGoogleSignOut}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-300 hover:text-red-400 whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>خروج</span>
              </button>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-100">ذخیره آنلاین پروژه‌ها</div>
                <p className="text-xs text-slate-400">
                  برای ذخیره همیشگی سناریوها و خروجی‌ها با حساب گوگل وارد شوید.
                </p>
              </div>
              <button
                type="button"
                onClick={onGoogleSignIn}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>ورود با گوگل</span>
              </button>
            </>
          )}
        </div>

        {/* Windows Desktop App Download */}
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
              <Monitor className="h-4 w-4" />
              <span>نسخه نصبی ویندوز</span>
            </div>
            <div className="text-sm font-bold text-slate-100">دریافت برنامه دسکتاپ ویندوز</div>
            <p className="text-xs text-slate-400">
              شامل کد کامل برنامه ویندوز برای نصب آفلاین روی کامپیوتر شما.
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <a
              href="/api/windows-bundle/download"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>دانلود فایل ZIP</span>
            </a>
            <button
              type="button"
              onClick={() => setShowDesktopSource((v) => !v)}
              className="text-[11px] text-slate-400 hover:text-amber-400"
            >
              {showDesktopSource ? "بستن راهنمای نصب ویندوز" : "مشاهده راهنمای نصب و فایل‌ها"}
            </button>
          </div>
        </div>
      </div>

      {/* Saved Projects List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-[#262B38] pb-3">
          <h2 className="text-base font-bold text-slate-100">پروژه‌های من</h2>
          <span className="font-mono-tabular text-xs text-slate-400">{projects.length} پروژه</span>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#262B38] p-10 text-center text-sm text-slate-500">
            <FolderOpen className="mx-auto mb-2 h-6 w-6 text-slate-600" />
            هنوز پروژه‌ای نساخته‌اید. از «میز کار هوشمند» اولین ایده‌تان را شروع کنید.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {projects.map((proj) => {
              const isSelected = proj.id === selectedProjectId;
              const platformLabel = PLATFORM_LABELS[proj.brief.platform] || proj.brief.platform;
              const formatLabel = proj.brief.contentFormat
                ? FORMAT_LABELS[proj.brief.contentFormat] || proj.brief.contentFormat
                : "";

              return (
                <div
                  key={proj.id}
                  className={`flex flex-col justify-between rounded-2xl border p-5 transition-colors ${
                    isSelected
                      ? "border-amber-500/50 bg-[#1B1F2A]"
                      : "border-[#262B38] bg-[#14171F] hover:border-slate-600"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-bold text-slate-100">{proj.brief.title}</h3>
                      <span
                        className={`shrink-0 text-xs font-medium ${
                          proj.currentStage === "completed" ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {proj.currentStage === "completed" ? "آماده" : "در حال ساخت"}
                      </span>
                    </div>

                    <p className="line-clamp-2 text-xs leading-6 text-slate-400">{proj.brief.idea}</p>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>{platformLabel}</span>
                      {formatLabel && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatLabel}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">{proj.brief.targetDurationSeconds} ثانیه</span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#262B38] pt-3">
                    <button
                      type="button"
                      onClick={() => onOpenProject(proj)}
                      className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                    >
                      باز کردن در میز کار
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onExportMarkdown(proj)}
                        title="دانلود متن سناریو"
                        className="inline-flex items-center gap-1 rounded-lg border border-[#262B38] bg-[#0B0D11] px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-amber-500/50"
                      >
                        <FileText className="h-3 w-3 text-amber-400" />
                        <span>خروجی متن</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onExportJson(proj)}
                        title="دانلود فایل کامل پروژه"
                        className="inline-flex items-center gap-1 rounded-lg border border-[#262B38] bg-[#0B0D11] px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-amber-500/50"
                      >
                        <Download className="h-3 w-3" />
                        <span>فایل کامل</span>
                      </button>

                      {confirmDeleteId === proj.id ? (
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteProject(proj.id);
                              setConfirmDeleteId(null);
                            }}
                            className="font-semibold text-red-400 hover:text-red-300"
                          >
                            حذف قطعی
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-slate-400"
                          >
                            لغو
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(proj.id)}
                          aria-label={`حذف ${proj.brief.title}`}
                          className="rounded-lg p-1.5 text-slate-500 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showDesktopSource && (
        <div className="border-t border-[#262B38] pt-6">
          <WindowsBundleView />
        </div>
      )}
    </div>
  );
}
