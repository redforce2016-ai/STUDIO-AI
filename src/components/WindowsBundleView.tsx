import { useEffect, useState } from "react";
import { Download, FileCode2, Monitor, Terminal } from "lucide-react";
import type { WindowsBundleFilePreview } from "../types/studio";

export function WindowsBundleView() {
  const [files, setFiles] = useState<WindowsBundleFilePreview[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/windows-bundle/preview")
      .then((res) => res.json())
      .then((data) => {
        const list = (data.files ?? []) as WindowsBundleFilePreview[];
        setFiles(list);
        if (list.length > 0) setSelectedPath(list[0].path);
      })
      .finally(() => setLoading(false));
  }, []);

  const activeFile = files.find((f) => f.path === selectedPath) ?? files[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <Monitor className="h-4 w-4" />
            <span>بسته بومی دسکتاپ ویندوز · Tauri v2 + Python LangGraph</span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            دریافت پروژه کامل ویندوز (Python LangGraph + SqliteSaver + Tauri)
          </h2>
          <p className="max-w-3xl text-xs leading-6 text-slate-400">
            این آرشیو شامل سورس کامل بک‌اند پایتون با کتابخانه LangGraph، ذخیره‌ساز آفلاین SQLite برای ایستگاه‌های توقف انسانی، سرور FastAPI، پوسته دسکتاپ Tauri v2 و اسکریپت‌های بیلد فایل نصاب ویندوز (.exe / .msi) است.
          </p>
        </div>

        <a
          href="/api/windows-bundle/download"
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          <span>دانلود بسته ویندوز (ZIP)</span>
        </a>
      </div>

      {/* 3-Step Windows Build Guide */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
          <div className="font-mono-tabular text-xs font-semibold text-amber-400">گام ۰۱</div>
          <h3 className="mt-1 text-sm font-bold text-slate-100">راه‌اندازی بک‌اند Python LangGraph</h3>
          <p className="mt-2 text-xs leading-6 text-slate-300">
            فایل <span className="font-mono-tabular text-slate-100">setup_and_run.bat</span> را روی ویندوز اجرا کنید تا محیط مجازی پایتون ساخته شده و هسته FastAPI + SqliteSaver روی پورت ۸۷۶۵ بالا بیاید.
          </p>
        </div>

        <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
          <div className="font-mono-tabular text-xs font-semibold text-amber-400">گام ۰۲</div>
          <h3 className="mt-1 text-sm font-bold text-slate-100">اجرای دسکتاپ در حالت توسعه</h3>
          <p className="mt-2 text-xs leading-6 text-slate-300">
            پس از نصب Rust و Node.js، با دستور <span className="font-mono-tabular text-slate-100">npx tauri dev</span> پنجره بومی ویندوز باز شده و به‌صورت خودکار به هسته پایتون متصل می‌شود.
          </p>
        </div>

        <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5">
          <div className="font-mono-tabular text-xs font-semibold text-amber-400">گام ۰۳</div>
          <h3 className="mt-1 text-sm font-bold text-slate-100">ساخت فایل نصاب EXE / MSI</h3>
          <p className="mt-2 text-xs leading-6 text-slate-300">
            با اجرای <span className="font-mono-tabular text-slate-100">build_windows_exe.bat</span> نصاب نهایی ویندوز بدون نیاز به مرورگر ساخته و آماده نصب می‌شود.
          </p>
        </div>
      </div>

      {/* Code Explorer */}
      <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-[#262B38] bg-[#14171F] lg:grid-cols-12">
        <div className="border-b border-[#262B38] p-4 lg:col-span-4 lg:border-b-0 lg:border-l">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Terminal className="h-4 w-4 text-amber-400" />
            <span>فایل‌های کلیدی داخل بسته ویندوز</span>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-[#1B1F2A]" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`w-full rounded-lg border p-3 text-right transition-colors ${
                    activeFile?.path === file.path
                      ? "border-amber-500/50 bg-[#1B1F2A] text-amber-300"
                      : "border-transparent bg-transparent text-slate-300 hover:bg-[#1B1F2A]/60"
                  }`}
                >
                  <div className="font-mono-tabular flex items-center gap-2 text-xs font-semibold" dir="ltr">
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span className="truncate">{file.path}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">{file.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col lg:col-span-8">
          <div className="flex items-center justify-between border-b border-[#262B38] bg-[#0B0D11]/60 px-4 py-3 text-xs">
            <span className="font-mono-tabular text-slate-200" dir="ltr">
              {activeFile?.path || "—"}
            </span>
            <span className="font-mono-tabular text-slate-500">{activeFile?.language}</span>
          </div>
          <pre
            dir="ltr"
            className="font-mono-tabular max-h-[520px] flex-1 overflow-auto bg-[#0B0D11] p-5 text-xs leading-6 text-slate-200"
          >
            {activeFile?.content || ""}
          </pre>
        </div>
      </div>
    </div>
  );
}
