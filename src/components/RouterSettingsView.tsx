import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FolderOpen,
  ListFilter,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import type {
  AgentRouteTarget,
  ProjectRecord,
  RouterConfigPublic,
  RouterProviderAccount,
  StudioAgentId,
} from "../types/studio";
import { ProjectsAndDesktopView } from "./ProjectsAndDesktopView";

interface RouterSettingsViewProps {
  projects?: ProjectRecord[];
  selectedProjectId?: string | null;
  firebaseUser?: User | null;
  cloudProjectCount?: number;
  onGoogleSignIn?: () => Promise<void>;
  onGoogleSignOut?: () => Promise<void>;
  onOpenProject?: (project: ProjectRecord) => void;
  onDeleteProject?: (id: string) => Promise<void>;
  onExportMarkdown?: (project: ProjectRecord) => void;
  onExportJson?: (project: ProjectRecord) => void;
}

const AGENT_META: Array<{
  id: StudioAgentId;
  superAgentBadge: string;
  title: string;
  subtitle: string;
}> = [
  {
    id: "research_script",
    superAgentBadge: "ابر-ایجنت ۱: سناریونویس",
    title: "۱. هسته پژوهشگر وب، استراتژیست وایرال، روانشناسی مخاطب و سناریونویس",
    subtitle: "تحلیل موضوع خام، پیشنهاد ۳ گزینه برتر و نگارش سناریوی کامل با رعایت الگوریتم",
  },
  {
    id: "voiceover",
    superAgentBadge: "ابر-ایجنت ۱ و ۲: متن اعراب‌گذاری‌شده و هدایت لحن",
    title: "۲. هسته نگارش متن گویندگی فارسی (اعراب‌گذاری دقیق و راهنمای فن بیان)",
    subtitle: "تنظیم کسره‌های اضافه، مکث‌های تنفسی و منحنی احساسی هماهنگ با تصویر",
  },
  {
    id: "director",
    superAgentBadge: "ابر-ایجنت ۲: کارگردان و تدوینگر",
    title: "۳. هسته دکوپاژ شات‌های ۳ تا ۸ ثانیه و طراحی صحنه و افکت صوتی",
    subtitle: "خرد کردن سناریو به شات‌های کوتاه ۳ تا ۸ ثانیه‌ای با افکت‌های صوتی و برنامه تدوین DaVinci",
  },
  {
    id: "visuals",
    superAgentBadge: "ابر-ایجنت ۲: کارگردان بصری",
    title: "۴. هسته تولید ۲ فریم پیش‌نمایش برای هر شات (فریم شروع + فریم اوج)",
    subtitle: "ساخت کادرهای پیش‌نمایش استوری‌بورد دوفریمی قبل از رندر ویدیوی هر شات",
  },
];

export function RouterSettingsView({
  projects = [],
  selectedProjectId = null,
  firebaseUser = null,
  cloudProjectCount = 0,
  onGoogleSignIn,
  onGoogleSignOut,
  onOpenProject,
  onDeleteProject,
  onExportMarkdown,
  onExportJson,
}: RouterSettingsViewProps) {
  const hasProjectsEmbed = Boolean(
    onOpenProject && onDeleteProject && onExportMarkdown && onExportJson && onGoogleSignIn && onGoogleSignOut
  );
  const [topSection, setTopSection] = useState<"projects" | "router">("router");
  const [subTab, setSubTab] = useState<"providers" | "governance" | "agents">("providers");
  const [config, setConfig] = useState<RouterConfigPublic | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [resettingCooldowns, setResettingCooldowns] = useState(false);

  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);

  // Live Catalog Modal state
  const [catalogProviderId, setCatalogProviderId] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<"all" | "free" | "enabled">("free");
  const [manualModelId, setManualModelId] = useState("");
  const [testingModelKey, setTestingModelKey] = useState<string | null>(null);

  // Agent Chain Testing state
  const [testingAgentId, setTestingAgentId] = useState<StudioAgentId | null>(null);
  const [agentTestResults, setAgentTestResults] = useState<
    Partial<Record<StudioAgentId, { ok: boolean; text: string }>>
  >({});

  const loadRouterConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/router/config");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در دریافت تنظیمات روتر");
      setConfig(data.config);
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در بارگذاری روتر مدل‌های رایگان",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRouterConfig();
  }, [loadRouterConfig]);

  const activeModelOptions = useMemo(() => {
    if (!config) return [];
    const options: Array<{
      value: string;
      providerId: string;
      modelId: string;
      label: string;
    }> = [];
    for (const p of config.providers) {
      if (!p.enabled || !p.hasApiKey) continue;
      for (const m of p.models) {
        if (!m.enabled) continue;
        options.push({
          value: `${p.id}::${m.id}`,
          providerId: p.id,
          modelId: m.id,
          label: `${p.name} — ${m.name}${m.isFree ? " (رایگان)" : ""}`,
        });
      }
    }
    return options;
  }, [config]);

  const handleToggleProviderEnabled = async (provider: RouterProviderAccount) => {
    try {
      const res = await fetch(`/api/router/providers/${provider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !provider.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تغییر وضعیت انجام نشد.");
      setConfig(data.config);
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در تغییر وضعیت سرویس",
      });
    }
  };

  const handleResetCooldowns = async (providerId?: string) => {
    setResettingCooldowns(true);
    setBanner(null);
    try {
      const res = await fetch("/api/router/cooldowns/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerId ? { providerId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "بازنشانی محدودیت انجام نشد.");
      setConfig(data.config);
      setBanner({
        type: "ok",
        text: providerId
          ? "محدودیت موقت این اکانت بازنشانی شد و دوباره وارد چرخه فالبک شد."
          : "محدودیت موقت همه اکانت‌ها بازنشانی شد.",
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در بازنشانی محدودیت موقت",
      });
    } finally {
      setResettingCooldowns(false);
    }
  };

  const handleTestProvider = async (providerId: string) => {
    setBusyProviderId(providerId);
    setBanner(null);
    try {
      const res = await fetch(`/api/router/providers/${providerId}/test`, { method: "POST" });
      const data = await res.json();
      if (data.config) setConfig(data.config);
      setBanner({
        type: data.ok ? "ok" : "error",
        text: data.message || (data.ok ? "ارتباط سرور برقرار است." : "تست ناموفق بود."),
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در تست ارتباط",
      });
    } finally {
      setBusyProviderId(null);
    }
  };

  const handleDiscoverProvider = async (
    providerId: string,
    mode: "auto_working" | "catalog"
  ) => {
    setBusyProviderId(providerId);
    setBanner(null);
    try {
      const res = await fetch(`/api/router/providers/${providerId}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "دریافت مدل‌های رایگان ناموفق بود.");
      setConfig(data.config);
      if (mode === "catalog") {
        setCatalogProviderId(providerId);
        setCatalogSearch("");
        const prov = (data.config as RouterConfigPublic).providers.find(
          (p) => p.id === providerId
        );
        const hasFree = prov?.models.some((m) => m.isFree);
        setCatalogFilter(hasFree ? "free" : "all");
      } else {
        setBanner({ type: "ok", text: data.message });
      }
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در دریافت کاتالوگ مدل‌ها",
      });
    } finally {
      setBusyProviderId(null);
    }
  };

  const handleToggleModel = async (providerId: string, modelId: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/router/providers/${providerId}/models/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در تغییر وضعیت مدل");
      setConfig(data.config);
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در تغییر وضعیت مدل",
      });
    }
  };

  const handleAddManualModel = async (providerId: string) => {
    if (!manualModelId.trim()) return;
    try {
      const res = await fetch(`/api/router/providers/${providerId}/models/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: manualModelId.trim(), isFree: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "افزودن مدل انجام نشد.");
      setConfig(data.config);
      setManualModelId("");
      setBanner({ type: "ok", text: "مدل به لیست فعال اضافه شد." });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در افزودن مدل",
      });
    }
  };

  const handleTestSingleModel = async (providerId: string, modelId: string) => {
    const k = `${providerId}::${modelId}`;
    setTestingModelKey(k);
    try {
      const res = await fetch(`/api/router/providers/${providerId}/models/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json();
      if (data.config) setConfig(data.config);
      if (!data.ok && data.error) {
        setBanner({ type: "error", text: `مدل ${modelId}: ${data.error}` });
      }
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در تست مدل",
      });
    } finally {
      setTestingModelKey(null);
    }
  };

  const saveAgentTargets = async (agentId: StudioAgentId, targets: AgentRouteTarget[]) => {
    try {
      const res = await fetch(`/api/router/agents/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ذخیره زنجیره انجام نشد.");
      setConfig(data.config);
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در ذخیره اولویت مدل‌ها",
      });
    }
  };

  const handleAgentTargetChange = (
    agentId: StudioAgentId,
    slotIndex: number,
    comboValue: string
  ) => {
    if (!config) return;
    const [providerId, ...rest] = comboValue.split("::");
    const modelId = rest.join("::");
    if (!providerId || !modelId) return;

    const current = [...(config.agentRoutes[agentId] ?? [])];
    current[slotIndex] = { providerId, modelId };
    void saveAgentTargets(agentId, current);
  };

  const handleAddFallbackSlot = (agentId: StudioAgentId) => {
    if (!config || activeModelOptions.length === 0) {
      setBanner({
        type: "error",
        text: "هیچ مدل فعالی یافت نشد؛ ابتدا یک سرویس متصل در سرور را فعال کنید.",
      });
      return;
    }
    const current = [...(config.agentRoutes[agentId] ?? [])];
    const usedSet = new Set(current.map((t) => `${t.providerId}::${t.modelId}`));
    const nextOption =
      activeModelOptions.find((opt) => !usedSet.has(opt.value)) || activeModelOptions[0];
    current.push({ providerId: nextOption.providerId, modelId: nextOption.modelId });
    void saveAgentTargets(agentId, current);
  };

  const handleMoveSlot = (agentId: StudioAgentId, idx: number, dir: -1 | 1) => {
    if (!config) return;
    const current = [...(config.agentRoutes[agentId] ?? [])];
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= current.length) return;
    [current[idx], current[targetIdx]] = [current[targetIdx], current[idx]];
    void saveAgentTargets(agentId, current);
  };

  const handleRemoveSlot = (agentId: StudioAgentId, idx: number) => {
    if (!config) return;
    const current = [...(config.agentRoutes[agentId] ?? [])];
    if (current.length <= 1) return;
    current.splice(idx, 1);
    void saveAgentTargets(agentId, current);
  };

  const handleApplyChainToAllAgents = async () => {
    if (!config) return;
    const template = config.agentRoutes.research_script ?? [];
    if (template.length === 0) return;
    try {
      for (const meta of AGENT_META) {
        if (meta.id === "research_script") continue;
        await fetch(`/api/router/agents/${meta.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: template }),
        });
      }
      await loadRouterConfig();
      setBanner({
        type: "ok",
        text: "زنجیره مدل‌های رایگان با موفقیت روی تمام هسته‌های هر ۲ ابر-ایجنت اعمال شد.",
      });
    } catch {
      setBanner({ type: "error", text: "اعمال همگانی با خطا مواجه شد." });
    }
  };

  const handleTestAgentChain = async (agentId: StudioAgentId) => {
    setTestingAgentId(agentId);
    try {
      const res = await fetch(`/api/router/agents/${agentId}/test`, { method: "POST" });
      const data = await res.json();
      setAgentTestResults((prev) => ({
        ...prev,
        [agentId]: {
          ok: Boolean(data.ok),
          text: data.ok
            ? `پاسخگو: ${data.usedProvider} · ${data.usedModel} (${data.latencyMs}ms)`
            : data.error || "تست ناموفق بود",
        },
      }));
    } catch (err) {
      setAgentTestResults((prev) => ({
        ...prev,
        [agentId]: {
          ok: false,
          text: err instanceof Error ? err.message : "خطا در تست زنجیره",
        },
      }));
    } finally {
      setTestingAgentId(null);
    }
  };

  const catalogProvider = useMemo(
    () => config?.providers.find((p) => p.id === catalogProviderId) ?? null,
    [config, catalogProviderId]
  );

  const filteredCatalogModels = useMemo(() => {
    if (!catalogProvider) return [];
    const q = catalogSearch.trim().toLowerCase();
    return catalogProvider.models.filter((m) => {
      if (catalogFilter === "free" && !m.isFree) return false;
      if (catalogFilter === "enabled" && !m.enabled) return false;
      if (q && !m.id.toLowerCase().includes(q) && !m.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [catalogProvider, catalogSearch, catalogFilter]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Top Mode Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5">
        <div>
          <h1 className="text-lg font-bold text-slate-100">
            روتر هوشمند ۱۰ اکانت جیمیل، فالبک خودکار و قوانین ضد توکن‌سوزی
          </h1>
          <p className="mt-1 text-xs leading-6 text-slate-400">
            مدیریت پایدار سهمیه ۱۰ حساب جیمیل سرور، چرخش خودکار بدون خطا در صورت محدودیت (429) و سیاست انتخاب مدل برای هر مرحله.
          </p>
        </div>

        {hasProjectsEmbed && (
          <div className="flex items-center gap-1.5 rounded-xl border border-[#262B38] bg-[#0B0D11] p-1">
            <button
              type="button"
              onClick={() => setTopSection("projects")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                topSection === "projects"
                  ? "bg-amber-500 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>پروژه‌ها و نسخه دسکتاپ ({projects.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTopSection("router")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                topSection === "router"
                  ? "bg-amber-500 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Server className="h-3.5 w-3.5" />
              <span>روتر مدل‌های رایگان سرور</span>
            </button>
          </div>
        )}
      </div>

      {topSection === "projects" && hasProjectsEmbed ? (
        <ProjectsAndDesktopView
          projects={projects}
          selectedProjectId={selectedProjectId}
          firebaseUser={firebaseUser}
          cloudProjectCount={cloudProjectCount}
          onGoogleSignIn={onGoogleSignIn!}
          onGoogleSignOut={onGoogleSignOut!}
          onOpenProject={onOpenProject!}
          onDeleteProject={onDeleteProject!}
          onExportMarkdown={onExportMarkdown!}
          onExportJson={onExportJson!}
        />
      ) : isLoading || !config ? (
        <div className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-8">
          <div className="h-6 w-56 animate-pulse rounded bg-[#1B1F2A]" />
          <div className="h-32 animate-pulse rounded-xl bg-[#1B1F2A]" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Persistent Pool & Anti-Token-Burn Summary Strip */}
          {config.quotaSummary && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-4">
                <div className="text-[11px] text-slate-400">کلیدهای واقعی فعال سرور</div>
                <div className="mt-1 font-mono-tabular text-lg font-bold text-emerald-400">
                  {config.quotaSummary.activeRealGoogleKeyCount} / {config.quotaSummary.totalConfiguredGoogleSlots}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  ذخیره دائمی در Settings &gt; Secrets (بدون کلید موک)
                </div>
              </div>
              <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-4">
                <div className="text-[11px] text-slate-400">درخواست‌های امروز کل استخر</div>
                <div className="mt-1 font-mono-tabular text-lg font-bold text-slate-100">
                  {config.quotaSummary.totalRequestsToday.toLocaleString("en-US")}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  تاریخ سهمیه UTC: {config.quotaSummary.dateKey}
                </div>
              </div>
              <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-4">
                <div className="text-[11px] text-slate-400">مصرف توکن ثبت‌شده امروز</div>
                <div className="mt-1 font-mono-tabular text-lg font-bold text-amber-300">
                  {config.quotaSummary.totalTokensToday.toLocaleString("en-US")}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  قفل ضد توکن‌سوزی ThinkingLevel فعال است
                </div>
              </div>
              <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-4">
                <div className="text-[11px] text-slate-400">چرخش خودکار فالبک امروز</div>
                <div className="mt-1 font-mono-tabular text-lg font-bold text-sky-300">
                  {config.quotaSummary.failoverCountToday}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  سوییچ بی‌خطا هنگام محدودیت سهمیه (429)
                </div>
              </div>
            </div>
          )}

          {/* Sub-navigation inside Multi-Account Router */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#262B38] bg-[#14171F] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                پایداری پس از ریستارت و امنیت: تمام کلیدهای واقعی در محیط سرور (
                <code className="font-mono-tabular text-slate-200">GEMINI_API_KEY</code> و{" "}
                <code className="font-mono-tabular text-slate-200">GEMINI_API_KEY_1..10</code>) نگهداری می‌شوند و هرگز کلید موک یا کلاینتی مجاز نیست.
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] p-1">
              <button
                type="button"
                onClick={() => setSubTab("providers")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  subTab === "providers"
                    ? "bg-amber-500 text-slate-950"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                ۱۰ اکانت جیمیل و فالبک ({config.providers.length})
              </button>
              <button
                type="button"
                onClick={() => setSubTab("governance")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  subTab === "governance"
                    ? "bg-amber-500 text-slate-950"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                قوانین مدل و ضد توکن‌سوزی ({config.governancePolicy?.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setSubTab("agents")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  subTab === "agents"
                    ? "bg-amber-500 text-slate-950"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                زنجیره فالبک ایجنت‌ها
              </button>
            </div>
          </div>

          {banner && (
            <div
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
                banner.type === "ok"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-red-500/40 bg-red-500/10 text-red-200"
              }`}
            >
              <div className="flex items-center gap-2">
                {banner.type === "ok" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                )}
                <span className="leading-6">{banner.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="text-slate-300 underline hover:text-white"
              >
                بستن
              </button>
            </div>
          )}

          {subTab === "agents" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#262B38] bg-[#14171F]/70 px-4 py-3 text-xs text-slate-300">
                <span>
                  اگر سهمیه رایگان مدل اول موقتاً پر شود، روتر بدون توقف کار سراغ مدل جایگزین بعدی می‌رود.
                </span>
                <button
                  type="button"
                  onClick={handleApplyChainToAllAgents}
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 whitespace-nowrap shrink-0"
                >
                  کپی زنجیره اول روی همه هسته‌ها
                </button>
              </div>

              {AGENT_META.map((agent) => {
                const chain = config.agentRoutes[agent.id] ?? [];
                const testResult = agentTestResults[agent.id];

                return (
                  <div
                    key={agent.id}
                    className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-amber-400">
                          {agent.superAgentBadge}
                        </div>
                        <h2 className="text-sm font-bold text-slate-100">{agent.title}</h2>
                        <p className="text-xs text-slate-400">{agent.subtitle}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={testingAgentId === agent.id}
                          onClick={() => handleTestAgentChain(agent.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50 whitespace-nowrap"
                        >
                          <Play className="h-3.5 w-3.5" />
                          <span>{testingAgentId === agent.id ? "در حال تست..." : "تست زنده"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddFallbackSlot(agent.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25 whitespace-nowrap"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>افزودن مدل جایگزین</span>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {chain.map((target, idx) => {
                        const currentVal = `${target.providerId}::${target.modelId}`;
                        const existsInActive = activeModelOptions.some(
                          (o) => o.value === currentVal
                        );

                        return (
                          <div
                            key={`${agent.id}_${idx}_${currentVal}`}
                            className="flex flex-wrap items-center gap-2 rounded-xl border border-[#262B38] bg-[#0B0D11]/70 p-2.5"
                          >
                            <span
                              className={`min-w-[92px] rounded-lg px-2.5 py-1.5 text-center text-[11px] font-semibold ${
                                idx === 0
                                  ? "bg-amber-500 text-slate-950"
                                  : "bg-[#1B1F2A] text-slate-300"
                              }`}
                            >
                              {idx === 0 ? "مدل اصلی" : `جایگزین ${idx}`}
                            </span>

                            <select
                              value={currentVal}
                              onChange={(e) =>
                                handleAgentTargetChange(agent.id, idx, e.target.value)
                              }
                              className="min-w-[240px] flex-1 rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                            >
                              {!existsInActive && (
                                <option value={currentVal}>
                                  {target.modelId} (نیازمند فعال‌سازی متغیر سرور)
                                </option>
                              )}
                              {activeModelOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMoveSlot(agent.id, idx, -1)}
                                title="افزایش اولویت"
                                className="rounded-lg border border-[#262B38] bg-[#14171F] p-1.5 text-slate-300 hover:text-white disabled:opacity-30"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === chain.length - 1}
                                onClick={() => handleMoveSlot(agent.id, idx, 1)}
                                title="کاهش اولویت"
                                className="rounded-lg border border-[#262B38] bg-[#14171F] p-1.5 text-slate-300 hover:text-white disabled:opacity-30"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={chain.length <= 1}
                                onClick={() => handleRemoveSlot(agent.id, idx)}
                                title="حذف از زنجیره"
                                className="rounded-lg border border-[#262B38] bg-[#14171F] p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-30"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {testResult && (
                      <div
                        className={`rounded-lg px-3 py-2 text-xs ${
                          testResult.ok
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-red-500/10 text-red-300"
                        }`}
                      >
                        {testResult.text}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : subTab === "governance" ? (
            /* Anti-Token-Burn Model Governance Matrix */
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-6 text-amber-100">
                <div className="font-bold text-amber-300 mb-1">
                  ماتریس دقیق مجوز مصرف مدل‌ها (قفل سخت‌افزاری ضد توکن‌سوزی)
                </div>
                روتر پیش از هر فراخوانی، نقش وظیفه و مدل انتخابی را کنترل می‌کند: مدل‌های منسوخ و مدل‌های سنگین استدلال عمیق (Neon/Carbon/Argon) در مراحل عادی تولید مسدود هستند و تمام فراخوانی‌های JSON روی ThinkingLevel.LOW یا MINIMAL قفل می‌شوند.
              </div>

              <div className="space-y-3">
                {(config.governancePolicy ?? []).map((rule) => (
                  <div
                    key={rule.taskRole}
                    className="rounded-2xl border border-[#262B38] bg-[#14171F] p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-bold text-slate-100">{rule.titleFa}</div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                        <span
                          className={`rounded-md px-2 py-0.5 font-semibold ${
                            rule.allowedByDefault
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-red-500/15 text-red-300"
                          }`}
                        >
                          {rule.allowedByDefault ? "مجاز با شرط" : "مسدود به‌صورت پیش‌فرض"}
                        </span>
                        <span className="rounded-md bg-[#0B0D11] px-2 py-0.5 text-amber-300 border border-[#262B38]">
                          مدل اصلی: {rule.primaryModel}
                        </span>
                        {rule.fallbackModel && (
                          <span className="rounded-md bg-[#0B0D11] px-2 py-0.5 text-sky-300 border border-[#262B38]">
                            فالبک: {rule.fallbackModel}
                          </span>
                        )}
                        <span className="rounded-md bg-[#0B0D11] px-2 py-0.5 text-slate-300 border border-[#262B38]">
                          Thinking: {rule.thinkingLevel}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs leading-6">
                      <div className="rounded-xl bg-[#0B0D11]/70 p-3 text-slate-300">
                        <span className="font-semibold text-sky-300">شرط مجاز بودن اجرا: </span>
                        {rule.allowedWhenFa}
                      </div>
                      <div className="rounded-xl bg-[#0B0D11]/70 p-3 text-slate-300">
                        <span className="font-semibold text-emerald-300">محدودیت ضد توکن‌سوزی: </span>
                        {rule.antiTokenBurnRuleFa}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* 10-Account Persistent Server-Env Key Pool & Auto-Failover Dashboard (Zero Client Key Inputs) */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#262B38] bg-[#14171F]/80 px-4 py-3 text-xs text-slate-300">
                <span>
                  هر اکانت جیمیل مرورگر ایجنت به متغیر دائمی خود (<code className="font-mono text-amber-300">GEMINI_API_KEY_1..10</code>) متصل است. هنگام خطای 429 یا پر شدن سهمیه، چرخش به اکانت بعدی خودکار و بدون خطاست.
                </span>
                <button
                  type="button"
                  disabled={resettingCooldowns}
                  onClick={() => void handleResetCooldowns()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${resettingCooldowns ? "animate-spin" : ""}`} />
                  <span>بازنشانی محدودیت موقت همه اکانت‌ها</span>
                </button>
              </div>

              {config.providers.map((provider) => {
                const activeCount = provider.models.filter((m) => m.enabled).length;
                const isBusy = busyProviderId === provider.id;
                const reqUsed = provider.requestsToday ?? 0;
                const reqMax = provider.dailyRequestLimit ?? 250;
                const tokUsed = provider.tokensToday ?? 0;
                const tokMax = provider.dailyTokenBudget ?? 400_000;

                return (
                  <div
                    key={provider.id}
                    className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <h3 className="text-sm font-bold text-slate-100">{provider.name}</h3>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span
                            className={
                              provider.hasApiKey ? "text-emerald-400 font-semibold" : "text-slate-400"
                            }
                          >
                            {provider.maskedKey}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="font-mono-tabular text-amber-300">
                            {activeCount} مدل فعال از {provider.models.length}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                          {provider.linkedProfileEmail && (
                            <span dir="ltr" className="font-mono text-sky-300">
                              {provider.linkedProfileEmail}
                            </span>
                          )}
                          <span className="font-mono-tabular">
                            درخواست امروز: {reqUsed}/{reqMax}
                          </span>
                          <span className="font-mono-tabular">
                            توکن امروز: {tokUsed.toLocaleString("en-US")}/{tokMax.toLocaleString("en-US")}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleProviderEnabled(provider)}
                        className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                          provider.enabled
                            ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                            : "bg-slate-700/40 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {provider.enabled ? "فعال در چرخه فالبک" : "غیرفعال"}
                      </button>
                    </div>

                    {provider.cooldownUntil && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        <span>
                          در حالت انتظار موقت فالبک: {provider.cooldownReasonFa || "محدودیت سهمیه"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleResetCooldowns(provider.id)}
                          className="rounded-md bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/30"
                        >
                          بازنشانی فوری
                        </button>
                      </div>
                    )}

                    {provider.lastTestMessage && (
                      <div
                        className={`rounded-lg px-3 py-2 text-xs ${
                          provider.lastTestStatus === "error"
                            ? "bg-red-500/10 text-red-300"
                            : "bg-[#0B0D11]/70 text-slate-300"
                        }`}
                      >
                        {provider.lastTestMessage}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isBusy || !provider.hasApiKey}
                        onClick={() => handleDiscoverProvider(provider.id, "auto_working")}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-40 whitespace-nowrap"
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                        <span>
                          {isBusy ? "در حال بررسی..." : "یافتن خودکار مدل‌های رایگان پاسخگو"}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDiscoverProvider(provider.id, "catalog")}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40 whitespace-nowrap"
                      >
                        <ListFilter className="h-3.5 w-3.5" />
                        <span>مدیریت لیست مدل‌ها</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy || !provider.hasApiKey}
                        onClick={() => handleTestProvider(provider.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40 whitespace-nowrap"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`} />
                        <span>تست کم‌مصرف اتصال</span>
                      </button>
                    </div>
                  </div>
                );
              })}

              {config.quotaSummary?.recentFailovers && config.quotaSummary.recentFailovers.length > 0 && (
                <div className="rounded-2xl border border-[#262B38] bg-[#14171F] p-5 space-y-2.5">
                  <h3 className="text-xs font-bold text-sky-300">
                    گزارش چرخش‌های خودکار اخیر بین اکانت‌ها (Auto-Failover Log)
                  </h3>
                  <div className="space-y-1.5">
                    {config.quotaSummary.recentFailovers.slice(0, 6).map((ev) => (
                      <div
                        key={ev.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#0B0D11] px-3 py-2 text-[11px] text-slate-300"
                      >
                        <span className="font-mono text-amber-300">
                          {ev.fromProviderId} → {ev.toProviderId} ({ev.modelId})
                        </span>
                        <span>{ev.reasonFa}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Live Model Catalog Modal */}
      {catalogProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#262B38] bg-[#14171F]">
            <div className="flex items-center justify-between border-b border-[#262B38] px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  مدل‌های در دسترس — {catalogProvider.name}
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  مدل‌های رایگان دلخواه را روشن کنید تا در زنجیره فالبک ایجنت‌ها قرار بگیرند.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCatalogProviderId(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 border-b border-[#262B38] bg-[#0B0D11]/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="جستجوی نام یا شناسه مدل..."
                    className="w-full rounded-xl border border-[#262B38] bg-[#14171F] py-2 pr-9 pl-3 text-xs text-slate-100 outline-none focus:border-amber-500"
                  />
                </div>
                {(["free", "enabled", "all"] as const).map((flt) => (
                  <button
                    key={flt}
                    type="button"
                    onClick={() => setCatalogFilter(flt)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 ${
                      catalogFilter === flt
                        ? "bg-amber-500 text-slate-950 font-semibold"
                        : "border border-[#262B38] bg-[#14171F] text-slate-300"
                    }`}
                  >
                    {flt === "free" ? "فقط رایگان" : flt === "enabled" ? "فعال‌ها" : "همه"}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  dir="ltr"
                  value={manualModelId}
                  onChange={(e) => setManualModelId(e.target.value)}
                  placeholder="افزودن دستی شناسه مدل (مثلاً gemini-2.5-flash)"
                  className="flex-1 rounded-xl border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={() => handleAddManualModel(catalogProvider.id)}
                  className="rounded-xl bg-amber-500/20 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 whitespace-nowrap shrink-0"
                >
                  افزودن مدل
                </button>
              </div>
            </div>

            <div className="flex-1 divide-y divide-[#262B38] overflow-y-auto p-4">
              {filteredCatalogModels.map((m) => {
                const testKey = `${catalogProvider.id}::${m.id}`;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-100">{m.name}</div>
                      <div dir="ltr" className="truncate text-right text-[11px] text-slate-500">
                        {m.id}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {catalogProvider.hasApiKey && (
                        <button
                          type="button"
                          disabled={testingModelKey === testKey}
                          onClick={() => handleTestSingleModel(catalogProvider.id, m.id)}
                          className="rounded-lg border border-[#262B38] bg-[#0B0D11] px-2.5 py-1 text-[11px] text-slate-300 hover:text-amber-300"
                        >
                          {testingModelKey === testKey ? "..." : "تست"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleToggleModel(catalogProvider.id, m.id, !m.enabled)}
                        className={`rounded-lg px-3 py-1 text-[11px] font-semibold ${
                          m.enabled
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-[#0B0D11] text-slate-400"
                        }`}
                      >
                        {m.enabled ? "فعال" : "غیرفعال"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
