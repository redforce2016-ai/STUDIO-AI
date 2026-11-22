import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  Layers,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Unplug,
  Wrench,
} from "lucide-react";

type EngineStackId =
  | "blender"
  | "remotion"
  | "hyperframes"
  | "comfyui"
  | "ffmpeg"
  | "nle_finishing";

type ToolchainItemKind = "mcp" | "plugin" | "skill";

interface ToolchainAddonItem {
  id: string;
  engineId: EngineStackId;
  kind: ToolchainItemKind;
  name: string;
  repoOrPackage: string;
  installCommand: string;
  purposeFa: string;
  requiredFor: string[];
  enabled: boolean;
  agentDirective: string;
}

interface EngineStackDefinition {
  id: EngineStackId;
  name: string;
  labelFa: string;
  categoryFa: string;
  costModel: "free_open_source" | "free_pro_nle";
  executionHost: "local_server" | "google_colab_gpu" | "desktop_nle" | "local_or_colab";
  descriptionFa: string;
  capabilities: string[];
}

interface EngineRuntimeProbe {
  engineId: EngineStackId;
  localAvailable: boolean;
  colabCapable: boolean;
  colabConnected: boolean;
  detailFa: string;
}

interface McpToolchainState {
  omniFlashPolicy: "disabled_by_default" | "manual_override_only";
  updatedAt: string;
  engines: EngineStackDefinition[];
  addons: ToolchainAddonItem[];
  runtimeProbes: EngineRuntimeProbe[];
}

interface ColabRuntimeHealth {
  reachable: boolean;
  checkedAt: string;
  bridgeUrl: string;
  gpuModel: string | null;
  vramTotalGb: number;
  ramTotalGb: number;
  engines: {
    comfyui: boolean;
    blender: boolean;
    blenderVersion: string | null;
    ffmpeg: boolean;
    persianFonts: boolean;
  };
  errorFa: string | null;
}

interface ColabConnectionConfig {
  bridgeUrl: string | null;
  authToken: string | null;
  colabAccountEmail: string | null;
  connected: boolean;
  lastHealth: ColabRuntimeHealth | null;
  updatedAt: string;
}

const ENGINE_FILTER_TABS: Array<{ id: "all" | EngineStackId; label: string }> = [
  { id: "all", label: "همه ابزارها" },
  { id: "hyperframes", label: "HyperFrames" },
  { id: "remotion", label: "Remotion" },
  { id: "blender", label: "Blender 3D" },
  { id: "comfyui", label: "ComfyUI GPU" },
  { id: "ffmpeg", label: "FFmpeg" },
  { id: "nle_finishing", label: "DaVinci و After Effects" },
];

const KIND_LABELS: Record<ToolchainItemKind, string> = {
  mcp: "MCP Server",
  plugin: "Plugin",
  skill: "Agent Skill",
};

const HOST_LABELS: Record<EngineStackDefinition["executionHost"], string> = {
  local_server: "اجرای محلی رایگان روی سرور",
  local_or_colab: "سرور محلی یا Google Colab GPU",
  google_colab_gpu: "Google Colab GPU واقعی",
  desktop_nle: "پروژه آماده NLE دسکتاپ + MCP",
};

export function ToolchainAndColabView() {
  const [toolchain, setToolchain] = useState<McpToolchainState | null>(null);
  const [colab, setColab] = useState<ColabConnectionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEngine, setSelectedEngine] = useState<"all" | EngineStackId>("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Colab form state
  const [notebookPreset, setNotebookPreset] = useState<
    "wan22_5b_gguf" | "wan22_fp8_14b" | "ltx_video_fp8"
  >("wan22_5b_gguf");
  const [bridgeUrl, setBridgeUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [colabEmail, setColabEmail] = useState("");
  const [colabBusy, setColabBusy] = useState(false);
  const [colabFeedback, setColabFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tcRes, colabRes] = await Promise.all([
        fetch("/api/toolchain/state"),
        fetch("/api/colab/status"),
      ]);
      if (tcRes.ok) {
        const tcData = (await tcRes.json()) as { toolchain?: McpToolchainState };
        if (tcData.toolchain) setToolchain(tcData.toolchain);
      }
      if (colabRes.ok) {
        const cData = (await colabRes.json()) as { colab?: ColabConnectionConfig };
        if (cData.colab) {
          setColab(cData.colab);
          setBridgeUrl((prev) => prev || cData.colab?.bridgeUrl || "");
          setAuthToken((prev) => prev || cData.colab?.authToken || "");
          setColabEmail((prev) => prev || cData.colab?.colabAccountEmail || "");
        }
      }
    } catch {
      // Keep honest UI error state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleToggleAddon = async (addon: ToolchainAddonItem) => {
    setTogglingId(addon.id);
    try {
      const res = await fetch("/api/toolchain/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addonId: addon.id, enabled: !addon.enabled }),
      });
      const data = (await res.json()) as { toolchain?: McpToolchainState; error?: string };
      if (res.ok && data.toolchain) {
        setToolchain(data.toolchain);
      }
    } finally {
      setTogglingId(null);
    }
  };

  const handleConnectColab = async () => {
    setColabBusy(true);
    setColabFeedback(null);
    try {
      const res = await fetch("/api/colab/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bridgeUrl: bridgeUrl.trim(),
          authToken: authToken.trim() || undefined,
          colabAccountEmail: colabEmail.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        colab?: ColabConnectionConfig;
        health?: ColabRuntimeHealth;
        toolchain?: McpToolchainState;
        error?: string;
      };
      if (!res.ok) {
        setColabFeedback({
          ok: false,
          message: data.error || "اتصال به Google Colab GPU برقرار نشد.",
        });
        return;
      }
      if (data.colab) setColab(data.colab);
      if (data.toolchain) setToolchain(data.toolchain);

      if (data.health?.reachable) {
        setColabFeedback({
          ok: true,
          message: `اتصال واقعی به GPU برقرار شد: ${data.health.gpuModel || "NVIDIA Colab GPU"} (${data.health.vramTotalGb} GB VRAM)`,
        });
      } else {
        setColabFeedback({
          ok: false,
          message:
            data.health?.errorFa ||
            "تونل Colab پاسخ نداد. مطمئن شوید سلول FastAPI Bridge + cloudflared در Colab در حال اجرا است.",
        });
      }
    } catch (err) {
      setColabFeedback({
        ok: false,
        message: err instanceof Error ? err.message : "خطا در برقراری ارتباط شبکه با Colab",
      });
    } finally {
      setColabBusy(false);
    }
  };

  const handleProbeColab = async () => {
    setColabBusy(true);
    setColabFeedback(null);
    try {
      const res = await fetch("/api/colab/probe", { method: "POST" });
      const data = (await res.json()) as {
        colab?: ColabConnectionConfig;
        health?: ColabRuntimeHealth;
        toolchain?: McpToolchainState;
        error?: string;
      };
      if (!res.ok) {
        setColabFeedback({
          ok: false,
          message: data.error || "ابتدا آدرس تونل Colab را ثبت کنید.",
        });
        return;
      }
      if (data.colab) setColab(data.colab);
      if (data.toolchain) setToolchain(data.toolchain);
      setColabFeedback({
        ok: Boolean(data.health?.reachable),
        message: data.health?.reachable
          ? `سرور Google Colab آنلاین است (${data.health.gpuModel || "GPU"})`
          : data.health?.errorFa || "سرور Colab در دسترس نیست.",
      });
    } finally {
      setColabBusy(false);
    }
  };

  const handleDisconnectColab = async () => {
    setColabBusy(true);
    setColabFeedback(null);
    try {
      const res = await fetch("/api/colab/disconnect", { method: "POST" });
      const data = (await res.json()) as {
        colab?: ColabConnectionConfig;
        toolchain?: McpToolchainState;
      };
      if (data.colab) setColab(data.colab);
      if (data.toolchain) setToolchain(data.toolchain);
      setColabFeedback({
        ok: true,
        message: "اتصال Colab GPU قطع شد. موتورهای محلی رایگان (HyperFrames، Remotion و FFmpeg) همچنان فعال هستند.",
      });
    } finally {
      setColabBusy(false);
    }
  };

  const filteredAddons = (toolchain?.addons || []).filter(
    (a) => selectedEngine === "all" || a.engineId === selectedEngine
  );
  const enabledCount = (toolchain?.addons || []).filter((a) => a.enabled).length;
  const totalAddons = toolchain?.addons.length || 0;
  const isColabLive = Boolean(colab?.connected && colab?.lastHealth?.reachable);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#262B38] pb-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-amber-400">
            <span>زیرساخت رایگان تولید ویدیو و تدوین حرفه‌ای</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">
              قفل پیش‌فرض روی موتورهای رایگان (عدم مصرف خودکار OmniFlash)
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            موتورهای رندر، MCP / Plugin / Skill و اتصال واقعی Google Colab GPU
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="/api/toolchain/mcp-config"
            download="content_studio_mcp_servers.json"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/50 hover:text-amber-300 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-amber-400" />
            <span>دانلود فایل mcp_servers.json</span>
          </a>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadAll()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#1B1F2A] whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>بررسی مجدد موتورها</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: Real Google Colab GPU Runtime (Zero Mockup) */}
      <section className="rounded-xl border border-[#262B38] bg-[#14171F] p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#262B38] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-sky-400 font-medium">
              <Cpu className="h-4 w-4" />
              <span>محیط اجرای واقعی روی اکانت Google Colab شما (بدون موکاپ و شبیه‌سازی)</span>
            </div>
            <h2 className="text-base font-bold text-slate-100">
              نصب و اجرای واقعی ComfyUI + Blender 4.2 GPU + FFmpeg + فونت فارسی روی Colab
            </h2>
          </div>

          <div className="text-xs font-medium tabular-nums">
            {isColabLive ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  متصل به GPU واقعی ({colab?.lastHealth?.gpuModel || "NVIDIA"})
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-slate-400">
                <Server className="h-4 w-4 text-slate-500" />
                <span>قطع · منتظر اجرای نوتبوک واقعی روی Google Colab</span>
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Step 1 Download Notebook */}
          <div className="space-y-4 rounded-xl border border-[#262B38] bg-[#0B0D11] p-4 lg:col-span-5">
            <div className="text-xs font-bold text-slate-100">
              گام ۱ · دانلود و اجرای نوتبوک All-in-One در Google Colab
            </div>
            <p className="text-xs leading-6 text-slate-400">
              این نوتبوک واقعی به‌صورت خودکار{" "}
              <strong className="text-slate-200">Blender 4.2 LTS Headless GPU</strong>،{" "}
              <strong className="text-slate-200">ComfyUI + پلاگین‌های Wan2.2/GGUF/VHS/ControlNet/IPAdapter</strong>،{" "}
              <strong className="text-slate-200">فونت‌های Vazirmatn و Lalezar</strong> و{" "}
              <strong className="text-slate-200">FastAPI GPU Bridge + Cloudflare Tunnel</strong> را روی GPU واقعی اکانت Colab شما نصب و اجرا می‌کند.
            </p>

            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-slate-400">
                انتخاب مدل ویدیوساز ComfyUI متناسب با کارت گرافیک Colab
              </label>
              <select
                value={notebookPreset}
                onChange={(e) =>
                  setNotebookPreset(
                    e.target.value as "wan22_5b_gguf" | "wan22_fp8_14b" | "ltx_video_fp8"
                  )
                }
                className="w-full rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="wan22_5b_gguf">
                  Wan 2.2 TI2V-5B GGUF (پیشنهادی برای Colab رایگان T4 15GB)
                </option>
                <option value="wan22_fp8_14b">
                  Wan 2.2 14B FP8 High-Cinema (برای Colab Pro L4 / A100)
                </option>
                <option value="ltx_video_fp8">
                  LTX-Video 2B FP8 Fast (سرعت بالا روی T4)
                </option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href={`/api/colab/notebook?preset=${notebookPreset}`}
                download={`ContentStudio_AllInOne_Colab_${notebookPreset}.ipynb`}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-400"
              >
                <Download className="h-3.5 w-3.5" />
                <span>دانلود نوتبوک Colab (.ipynb)</span>
              </a>
              <a
                href="https://colab.research.google.com/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-sky-500/50 hover:text-sky-300"
              >
                <span>باز کردن Google Colab</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* Right: Step 2 Live Connection & Honest Health Check */}
          <div className="space-y-4 rounded-xl border border-[#262B38] bg-[#0B0D11] p-4 lg:col-span-7">
            <div className="text-xs font-bold text-slate-100">
              گام ۲ · وارد کردن لینک تونل واقعی خروجی Colab و تست زنده سلامت سرور
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] text-slate-400">
                  آدرس تونل Cloudflare یا FastAPI Bridge کولب (الزامی)
                </label>
                <input
                  type="url"
                  dir="ltr"
                  value={bridgeUrl}
                  onChange={(e) => setBridgeUrl(e.target.value)}
                  placeholder="https://example-gpu-bridge.trycloudflare.com"
                  className="w-full rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-slate-400">
                  توکن امنیتی Bridge (چاپ‌شده در سلول آخر Colab)
                </label>
                <input
                  type="password"
                  dir="ltr"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="Bearer Token (Optional)"
                  className="w-full rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-slate-400">
                  ایمیل اکانت Google Colab (جهت ثبت در گزارش)
                </label>
                <input
                  type="email"
                  dir="ltr"
                  value={colabEmail}
                  onChange={(e) => setColabEmail(e.target.value)}
                  placeholder="you@gmail.com"
                  className="w-full rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={colabBusy || !bridgeUrl.trim()}
                onClick={() => void handleConnectColab()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-50"
              >
                <Plug className="h-3.5 w-3.5" />
                <span>
                  {colabBusy ? "در حال بررسی زنده..." : "تست و اتصال واقعی به Colab GPU"}
                </span>
              </button>

              {colab?.bridgeUrl && (
                <button
                  type="button"
                  disabled={colabBusy}
                  onClick={() => void handleProbeColab()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs font-medium text-slate-200 hover:border-sky-500/50 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${colabBusy ? "animate-spin" : ""}`} />
                  <span>بررسی مجدد سلامت</span>
                </button>
              )}

              {isColabLive && (
                <button
                  type="button"
                  disabled={colabBusy}
                  onClick={() => void handleDisconnectColab()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  <span>قطع اتصال</span>
                </button>
              )}
            </div>

            {colabFeedback && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs leading-6 ${
                  colabFeedback.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-red-500/40 bg-red-500/10 text-red-200"
                }`}
              >
                {colabFeedback.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                )}
                <span>{colabFeedback.message}</span>
              </div>
            )}

            {/* Honest Live Hardware Matrix */}
            {colab?.lastHealth && (
              <div className="grid grid-cols-2 gap-3 border-t border-[#262B38] pt-3 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-[11px] text-slate-500">GPU / VRAM</div>
                  <div className="mt-0.5 font-mono text-slate-200 tabular-nums">
                    {colab.lastHealth.reachable
                      ? `${colab.lastHealth.gpuModel || "GPU"} · ${colab.lastHealth.vramTotalGb}GB`
                      : "آفلاین"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Blender 4.2 GPU</div>
                  <div
                    className={`mt-0.5 font-medium ${
                      colab.lastHealth.engines.blender ? "text-emerald-400" : "text-slate-500"
                    }`}
                  >
                    {colab.lastHealth.engines.blender
                      ? colab.lastHealth.engines.blenderVersion || "آماده اجرا"
                      : "غیرفعال"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">ComfyUI + Wan 2.2</div>
                  <div
                    className={`mt-0.5 font-medium ${
                      colab.lastHealth.engines.comfyui ? "text-emerald-400" : "text-slate-500"
                    }`}
                  >
                    {colab.lastHealth.engines.comfyui ? "آنلاین و آماده" : "غیرفعال"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">فونت‌های فارسی + FFmpeg</div>
                  <div
                    className={`mt-0.5 font-medium ${
                      colab.lastHealth.engines.persianFonts
                        ? "text-emerald-400"
                        : "text-slate-500"
                    }`}
                  >
                    {colab.lastHealth.engines.persianFonts ? "نصب‌شده" : "غیرفعال"}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 2: Free Open-Source Engine Matrix */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-amber-400" />
            <h2 className="text-base font-bold text-slate-100">
              موتورهای رایگان تولید ویدیو، سه‌بعدی و ادیت نهایی (جایگزین مصرف مداوم OmniFlash)
            </h2>
          </div>
          <span className="text-xs text-slate-400 tabular-nums">
            سیاست روتر: OmniFlash خاموش پیش‌فرض · {enabledCount} از {totalAddons} ابزار فعال
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(toolchain?.engines || []).map((eng) => {
            const probe = toolchain?.runtimeProbes.find((p) => p.engineId === eng.id);
            const isReady = Boolean(probe?.localAvailable || probe?.colabConnected);

            return (
              <div
                key={eng.id}
                className="flex flex-col justify-between rounded-xl border border-[#262B38] bg-[#14171F] p-5"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] text-slate-400">
                        {eng.categoryFa} · {HOST_LABELS[eng.executionHost]}
                      </div>
                      <h3 className="mt-1 text-sm font-bold text-slate-100">{eng.name}</h3>
                    </div>
                    <span
                      className={`text-xs font-semibold shrink-0 ${
                        isReady ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {isReady ? "فعال" : "نیازمند Colab"}
                    </span>
                  </div>

                  <p className="text-xs leading-6 text-slate-300">{eng.descriptionFa}</p>

                  <ul className="space-y-1 text-[11px] text-slate-400">
                    {eng.capabilities.map((cap, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-amber-400">•</span>
                        <span>{cap}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {probe && (
                  <div className="mt-4 border-t border-[#262B38] pt-3 text-[11px] leading-5 text-slate-400">
                    <span className="font-semibold text-slate-300">وضعیت واقعی: </span>
                    {probe.detailFa}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION 3: Curated Essential MCPs, Plugins & Agent Skills */}
      <section className="rounded-xl border border-[#262B38] bg-[#14171F] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] px-5 py-4">
          <div className="space-y-0.5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
              <Wrench className="h-4 w-4 text-amber-400" />
              <span>MCPها، پلاگین‌ها و اسکیل‌های منتخب و ضروری (فقط موارد کاربردی استودیو)</span>
            </h2>
            <p className="text-xs text-slate-400">
              هر اسکیل و MCP فعال مستقیماً در دستورالعمل کارگردان، رندر Blender 3D / Live Skeleton، HyperFrames، ComfyUI و خروجی After Effects / DaVinci تزریق می‌شود.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {ENGINE_FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedEngine(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedEngine === tab.id
                    ? "bg-amber-500 text-slate-950 font-semibold"
                    : "border border-[#262B38] bg-[#0B0D11] text-slate-300 hover:text-slate-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-[#262B38]">
          {filteredAddons.map((addon) => {
            const busy = togglingId === addon.id;
            return (
              <div
                key={addon.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-slate-100">{addon.name}</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono text-[11px] text-amber-400">
                      {KIND_LABELS[addon.kind]}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono text-[11px] text-sky-400">
                      {addon.engineId}
                    </span>
                  </div>

                  <p className="text-xs leading-6 text-slate-300">{addon.purposeFa}</p>

                  <div className="flex flex-wrap items-center gap-3 pt-0.5 font-mono text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <Terminal className="h-3 w-3" />
                      <span dir="ltr">{addon.installCommand}</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span dir="ltr" className="truncate max-w-md">
                      {addon.repoOrPackage}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 pt-1">
                  <span
                    className={`text-xs font-medium ${
                      addon.enabled ? "text-emerald-400" : "text-slate-500"
                    }`}
                  >
                    {addon.enabled ? "فعال در پایپ‌لاین" : "غیرفعال"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={addon.enabled}
                    aria-label={`تغییر وضعیت ${addon.name}`}
                    disabled={busy}
                    onClick={() => void handleToggleAddon(addon)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                      addon.enabled
                        ? "border-emerald-500/60 bg-emerald-500/25"
                        : "border-[#262B38] bg-[#0B0D11]"
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        addon.enabled
                          ? "-translate-x-5 bg-emerald-400"
                          : "-translate-x-1 bg-slate-500"
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#262B38] bg-[#0B0D11]/70 px-5 py-3 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>
              همه ابزارهای این فهرست براساس نیاز واقعی استودیو (Blender 3D PBR + Live 3D Skeleton، Remotion، HyperFrames، ComfyUI Wan 2.2، FFmpeg ASS، DaVinci Resolve، After Effects و Video Effects Craft) گزینش شده‌اند.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
