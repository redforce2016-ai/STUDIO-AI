import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Cloud,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  Play,
  PowerOff,
  Server,
  Terminal,
  UserPlus,
} from "lucide-react";
import type {
  AgentBrowserCommandType,
  AgentBrowserState,
  CloudGpuModelPreset,
  CloudGpuNotebookMode,
  CloudGpuPlatform,
  CloudGpuState,
} from "../types/studio";

interface CloudGpuNotebookPanelProps {
  browserState: AgentBrowserState | null;
  isExecutingBrowserCmd: boolean;
  onSwitchProfile: (profileId: string) => Promise<void>;
  onDispatchBrowserCommand: (
    command: AgentBrowserCommandType,
    target: string,
    agentName?: string
  ) => Promise<void>;
  onOpenBrowserDrawer: () => void;
}

export function CloudGpuNotebookPanel({
  browserState,
  isExecutingBrowserCmd,
  onSwitchProfile,
  onDispatchBrowserCommand,
  onOpenBrowserDrawer,
}: CloudGpuNotebookPanelProps) {
  const [cloudGpu, setCloudGpu] = useState<CloudGpuState | null>(null);
  const [platform, setPlatform] = useState<CloudGpuPlatform>("molab");
  const [mode, setMode] = useState<CloudGpuNotebookMode>("comfyui_i2v_worker");
  const [modelPreset, setModelPreset] = useState<CloudGpuModelPreset>("wan22_fp8_14b");
  const [repoUrl, setRepoUrl] = useState("");
  const [mountDrive, setMountDrive] = useState(true);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [notebookPreview, setNotebookPreview] = useState<{
    filename: string;
    content: string;
  } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    kind: "ok" | "warn" | "error";
    text: string;
  } | null>(null);
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);

  const profiles = browserState?.profiles || [];
  const activeProfile =
    profiles.find((p) => p.id === browserState?.activeProfileId) || profiles[0];

  const fetchCloudGpuState = useCallback(async () => {
    try {
      const res = await fetch("/api/gpu-notebooks/state");
      if (!res.ok) return;
      const data = (await res.json()) as { cloudGpu?: CloudGpuState };
      if (data.cloudGpu) {
        setCloudGpu(data.cloudGpu);
        if (data.cloudGpu.activeTunnelUrl) {
          setTunnelUrl((prev) => prev || data.cloudGpu!.activeTunnelUrl || "");
        }
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void fetchCloudGpuState();
  }, [fetchCloudGpuState]);

  const handlePlatformChange = (next: CloudGpuPlatform) => {
    setPlatform(next);
    setModelPreset(next === "molab" ? "wan22_fp8_14b" : "wan22_5b_gguf");
    setNotebookPreview(null);
  };

  const buildDownloadQuery = () => {
    const qs = new URLSearchParams({
      platform,
      mode,
      modelPreset,
      mountGoogleDrive: String(mountDrive),
    });
    if (activeProfile?.email) qs.set("profileEmail", activeProfile.email);
    if (repoUrl.trim()) qs.set("repoUrl", repoUrl.trim());
    return qs.toString();
  };

  const handleLoadPreview = async () => {
    try {
      const res = await fetch(`/api/gpu-notebooks/preview?${buildDownloadQuery()}`);
      if (!res.ok) return;
      const data = (await res.json()) as { filename: string; content: string };
      setNotebookPreview(data);
      setShowPreview(true);
    } catch {
      // ignore
    }
  };

  const handleCopyNotebook = async () => {
    let code = notebookPreview?.content;
    if (!code) {
      const res = await fetch(`/api/gpu-notebooks/preview?${buildDownloadQuery()}`);
      if (res.ok) {
        const data = (await res.json()) as { filename: string; content: string };
        setNotebookPreview(data);
        code = data.content;
      }
    }
    if (code) {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    }
  };

  const handleConnectTunnel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tunnelUrl.trim()) {
      setStatusMessage({
        kind: "error",
        text: "لطفاً آدرس تونل سرور GPU (مثلاً https://xxxx.trycloudflare.com) را وارد کنید.",
      });
      return;
    }
    setIsConnecting(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/gpu-notebooks/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: activeProfile?.id || "prof_google_1",
          platform,
          tunnelUrl: tunnelUrl.trim(),
        }),
      });
      const data = (await res.json()) as {
        cloudGpu?: CloudGpuState;
        probeOk?: boolean;
        messageFa?: string;
        error?: string;
      };
      if (!res.ok) {
        setStatusMessage({
          kind: "error",
          text: data.error || "خطا در اتصال به سرور GPU ابری.",
        });
        return;
      }
      if (data.cloudGpu) setCloudGpu(data.cloudGpu);
      setStatusMessage({
        kind: data.probeOk ? "ok" : "warn",
        text: data.messageFa || "وضعیت اتصال به‌روزرسانی شد.",
      });
    } catch (err) {
      setStatusMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "خطا در ارتباط با سرور",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const res = await fetch("/api/gpu-notebooks/disconnect", { method: "POST" });
    if (res.ok) {
      const data = (await res.json()) as { cloudGpu?: CloudGpuState };
      if (data.cloudGpu) setCloudGpu(data.cloudGpu);
      setStatusMessage({ kind: "warn", text: "اتصال به سرور GPU ابری قطع شد." });
    }
  };

  const handleRegisterOnPlatform = async (
    profileId: string,
    targetPlatform: CloudGpuPlatform
  ) => {
    setBusyProfileId(profileId);
    try {
      await onSwitchProfile(profileId);
      const url =
        targetPlatform === "molab"
          ? "https://molab.marimo.io"
          : "https://colab.research.google.com";
      await onDispatchBrowserCommand(
        "register",
        url,
        `Cloud GPU Agent (${targetPlatform})`
      );
      onOpenBrowserDrawer();
    } finally {
      setBusyProfileId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Live Cloud GPU Connection Banner */}
      <section className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#262B38] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <Cloud className="h-4 w-4" />
              <span>اتصال به سرورهای GPU ابری رایگان (Marimo Molab و Google Colab)</span>
            </div>
            <p className="text-xs leading-6 text-slate-300 max-w-3xl">
              با استفاده از نوتبوک‌های متن‌باز آماده (بر پایه{" "}
              <span className="font-mono text-amber-300">marimo-team/marimo</span>،{" "}
              <span className="font-mono text-amber-300">ComfyUI-WanVideoWrapper</span> و{" "}
              <span className="font-mono text-amber-300">cloudflared</span>) یک نوتبوک GPU در{" "}
              <strong>Molab (تا ۹۶GB VRAM رایگان)</strong> یا{" "}
              <strong>Google Colab (T4 15GB)</strong> اجرا کنید و لینک تونل را اینجا متصل کنید تا
              تمام شات‌های استوری‌بورد روی GPU ابری رندر شوند.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {cloudGpu?.connected ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
                <Cpu className="h-4 w-4" />
                <span>
                  متصل: {cloudGpu.activeGpuModel || "Cloud GPU"}{" "}
                  {cloudGpu.activeVramTotalGb > 0 ? `(${cloudGpu.activeVramTotalGb}GB)` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  className="mr-1 rounded bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/30"
                  title="قطع اتصال GPU ابری"
                >
                  <PowerOff className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
                ● GPU ابری هنوز متصل نشده (رندر فعلی با Parallax محلی انجام می‌شود)
              </div>
            )}
          </div>
        </div>

        {/* Step 1: Notebook Generator for Molab & Colab */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-3 rounded-xl border border-[#262B38] bg-[#0B0D11] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
                <Terminal className="h-4 w-4 text-amber-400" />
                <span>گام ۱ · ساخت و دانلود نوتبوک آماده اجرای GPU</span>
              </h3>
              <a
                href={
                  platform === "molab"
                    ? "https://molab.new"
                    : "https://colab.research.google.com/#create=true"
                }
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
              >
                <span>باز کردن {platform === "molab" ? "molab.new" : "Google Colab"}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label htmlFor="cloud-gpu-platform" className="block text-[11px] text-slate-400">
                  پلتفرم نوتبوک ابری:
                </label>
                <select
                  id="cloud-gpu-platform"
                  value={platform}
                  onChange={(e) => handlePlatformChange(e.target.value as CloudGpuPlatform)}
                  className="w-full rounded-lg border border-[#262B38] bg-[#14171F] px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="molab">Marimo Molab (GPU رایگان تا 96GB)</option>
                  <option value="google_colab">Google Colab (T4 / L4 GPU)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="cloud-gpu-mode" className="block text-[11px] text-slate-400">
                  حالت اجرا در نوتبوک:
                </label>
                <select
                  id="cloud-gpu-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as CloudGpuNotebookMode)}
                  className="w-full rounded-lg border border-[#262B38] bg-[#14171F] px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="comfyui_i2v_worker">
                    موتور GPU ویدیوساز (ComfyUI + Tunnel)
                  </option>
                  <option value="full_studio_server">
                    اجرای کامل نرم‌افزار Content Studio روی سرور
                  </option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="cloud-gpu-model" className="block text-[11px] text-slate-400">
                  مدل Image-to-Video:
                </label>
                <select
                  id="cloud-gpu-model"
                  value={modelPreset}
                  onChange={(e) => setModelPreset(e.target.value as CloudGpuModelPreset)}
                  className="w-full rounded-lg border border-[#262B38] bg-[#14171F] px-2.5 py-2 text-xs text-amber-300 focus:border-amber-500 focus:outline-none"
                >
                  <option value="wan22_fp8_14b">Wan 2.1/2.2 14B FP8 (بهترین برای Molab)</option>
                  <option value="wan22_5b_gguf">Wan 2.2 5B GGUF (بهینه برای Colab T4)</option>
                  <option value="ltx_video_fp8">LTX-Video FP8 (رندر سریع ۳-۵ ثانیه)</option>
                </select>
              </div>
            </div>

            {mode === "full_studio_server" && (
              <div className="space-y-1">
                <label htmlFor="cloud-gpu-repo" className="block text-[11px] text-slate-400">
                  آدرس ریپازیتوری گیت‌هاب پروژه (برای کلون روی Molab/Colab):
                </label>
                <input
                  id="cloud-gpu-repo"
                  type="url"
                  dir="ltr"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/YOUR_USERNAME/fixstudio.git"
                  className="w-full rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
            )}

            {platform === "google_colab" && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={mountDrive}
                  onChange={(e) => setMountDrive(e.target.checked)}
                  className="rounded border-slate-600 bg-[#14171F] text-amber-500"
                />
                <span>اتصال Google Drive جهت ذخیره دائمی وزن مدل‌ها</span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href={`/api/gpu-notebooks/download?${buildDownloadQuery()}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>
                  دانلود نوتبوک {platform === "molab" ? "Molab (.py)" : "Google Colab (.ipynb)"}
                </span>
              </a>

              <button
                type="button"
                onClick={() => void handleCopyNotebook()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#1B1F2A] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 whitespace-nowrap"
              >
                {copiedCode ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedCode ? "کپی شد" : "کپی کد نوتبوک"}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  showPreview ? setShowPreview(false) : void handleLoadPreview()
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs text-slate-300 hover:text-white whitespace-nowrap"
              >
                <span>{showPreview ? "بستن پیش‌نمایش کد" : "پیش‌نمایش کد نوتبوک"}</span>
              </button>
            </div>
          </div>

          {/* Step 2: Live Tunnel Connection */}
          <form
            onSubmit={(e) => void handleConnectTunnel(e)}
            className="lg:col-span-5 space-y-3 rounded-xl border border-[#262B38] bg-[#0B0D11] p-4 flex flex-col justify-between"
          >
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-emerald-400" />
                <span>گام ۲ · اتصال لینک تونل زنده سرور GPU به استودیو</span>
              </h3>
              <p className="text-[11px] leading-5 text-slate-400">
                پس از اجرای نوتبوک در Molab یا Colab، آدرس چاپ‌شده{" "}
                <span className="font-mono text-sky-400">https://xxxx.trycloudflare.com</span>{" "}
                را اینجا وارد کنید تا موتور ویدیوساز به آن متصل شود.
              </p>
              <div className="space-y-1">
                <label htmlFor="cloud-gpu-tunnel-input" className="block text-[11px] text-slate-400">
                  آدرس تونل ComfyUI GPU:
                </label>
                <input
                  id="cloud-gpu-tunnel-input"
                  type="url"
                  dir="ltr"
                  value={tunnelUrl}
                  onChange={(e) => setTunnelUrl(e.target.value)}
                  placeholder="https://example-gpu.trycloudflare.com"
                  className="w-full rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {statusMessage && (
                <div
                  className={`rounded-lg border px-3 py-2 text-[11px] leading-5 ${
                    statusMessage.kind === "ok"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : statusMessage.kind === "warn"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                  }`}
                >
                  {statusMessage.text}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isConnecting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Server className="h-4 w-4" />
              )}
              <span>اتصال و تست زنده کارت گرافیک ابری</span>
            </button>
          </form>
        </div>

        {showPreview && notebookPreview && (
          <div className="rounded-xl border border-[#262B38] bg-[#080A0E] p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-mono text-amber-300">{notebookPreview.filename}</span>
              <span>آماده اجرا در {platform === "molab" ? "Molab" : "Google Colab"}</span>
            </div>
            <pre
              dir="ltr"
              className="max-h-72 overflow-auto rounded-lg bg-[#0B0D11] p-3 font-mono text-[11px] leading-5 text-slate-200"
            >
              {notebookPreview.content}
            </pre>
          </div>
        )}
      </section>

      {/* Step 3: 10 Gmail Profiles Pool for Molab & Google Colab */}
      <section className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262B38] pb-3">
          <div>
            <h3 className="text-xs font-bold text-slate-100">
              استخر ۱۰ پروفایل جیمیل متصل به Molab و Google Colab (با چرخش سهمیه GPU روزانه)
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              هر پروفایل دارای پوشه سشن ایزوله در <span className="font-mono">vercel-labs/agent-browser</span> است. برای ثبت‌نام/ورود واقعی، با جیمیل واقعی خود روی دکمه Molab یا Colab هر پروفایل کلیک کنید تا نشست در همان پوشه ذخیره بماند.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenBrowserDrawer}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 whitespace-nowrap"
          >
            <span>مدیریت رمزها و نمای مرورگر</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {profiles.map((prof) => {
            const session = cloudGpu?.sessions.find((s) => s.profileId === prof.id);
            const isActive = prof.id === activeProfile?.id;
            const isProfBusy = busyProfileId === prof.id || isExecutingBrowserCmd;

            return (
              <div
                key={prof.id}
                className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                  isActive
                    ? "border-amber-500/60 bg-amber-500/5"
                    : "border-[#262B38] bg-[#0B0D11]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: prof.avatarColor }}
                      />
                      <span className="truncate text-xs font-bold text-slate-100">
                        {prof.name}
                      </span>
                    </div>
                    <div dir="ltr" className="mt-1 truncate font-mono text-[11px] text-emerald-400 text-right">
                      {prof.email}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${
                      session?.status === "connected"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : isActive
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {session?.status === "connected"
                      ? `GPU متصل (${session.vramTotalGb}GB)`
                      : isActive
                        ? "پروفایل فعال"
                        : "آماده چرخش"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    disabled={isProfBusy}
                    onClick={() => void handleRegisterOnPlatform(prof.id, "molab")}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    <UserPlus className="h-3 w-3" />
                    <span>ورود / ثبت‌نام Molab</span>
                  </button>
                  <button
                    type="button"
                    disabled={isProfBusy}
                    onClick={() => void handleRegisterOnPlatform(prof.id, "google_colab")}
                    className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3" />
                    <span>ورود / ثبت‌نام Colab</span>
                  </button>
                  {!isActive && (
                    <button
                      type="button"
                      disabled={isProfBusy}
                      onClick={() => void onSwitchProfile(prof.id)}
                      className="rounded-md border border-[#262B38] bg-[#14171F] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white disabled:opacity-50"
                    >
                      فعال‌سازی
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
