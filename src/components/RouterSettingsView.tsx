import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  ListFilter,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import type {
  AgentRouteTarget,
  RouterConfigPublic,
  RouterModelEntry,
  RouterProviderAccount,
  RouterProviderKind,
  StudioAgentId,
} from "../types/studio";

interface ProviderPreset {
  kind: RouterProviderKind;
  label: string;
  defaultBaseUrl: string;
  placeholderKey: string;
  hintFa: string;
}

const AGENT_META: Array<{
  id: StudioAgentId;
  title: string;
  subtitle: string;
}> = [
  {
    id: "research_script",
    title: "۱. ایجنت سناریونویس حرفه‌ای (استراتژیست، پژوهشگر، ویرال و روانشناسی)",
    subtitle: "تحلیل استراتژیک ایده، روانشناسی سوشال مدیا، پژوهش و اعتبارسنجی وب و نگارش کامل سناریو",
  },
  {
    id: "voiceover",
    title: "۲. ایجنت گوینده و کارگردان صدا",
    subtitle: "آماده‌سازی متن گفتار روان، مکث‌ها و راهنمای لحن اجرا",
  },
  {
    id: "director",
    title: "۳. ایجنت کارگردان و چیدمان صحنه‌ها",
    subtitle: "شکستن سناریو به شات‌ها، زاویه دوربین، حرکت و متن روی تصویر",
  },
  {
    id: "visuals",
    title: "۴. ایجنت تولیدکننده بصری و استوری‌بورد",
    subtitle: "طراحی ترکیب‌بندی استوری‌بورد و کادرهای تصویری هر صحنه",
  },
];

export function RouterSettingsView() {
  const [subTab, setSubTab] = useState<"agents" | "providers">("agents");
  const [config, setConfig] = useState<RouterConfigPublic | null>(null);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // Add Provider Panel state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKind, setNewKind] = useState<RouterProviderKind>("openrouter");
  const [newName, setNewName] = useState("OpenRouter شخصی");
  const [newBaseUrl, setNewBaseUrl] = useState("https://openrouter.ai/api/v1");
  const [newApiKey, setNewApiKey] = useState("");
  const [showNewKey, setShowNewKey] = useState(false);
  const [isSavingProvider, setIsSavingProvider] = useState(false);

  // Inline Key Update modal/inline state
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editKeyValue, setEditKeyValue] = useState("");
  const [editBaseUrlValue, setEditBaseUrlValue] = useState("");
  const [editNameValue, setEditNameValue] = useState("");

  // Provider busy state (test / discover)
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Live Catalog Modal state
  const [catalogProviderId, setCatalogProviderId] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<"all" | "free" | "enabled">("free");
  const [manualModelId, setManualModelId] = useState("");
  const [testingModelKey, setTestingModelKey] = useState<string | null>(null);

  // Agent Chain Testing state
  const [testingAgentId, setTestingAgentId] = useState<StudioAgentId | null>(null);
  const [agentTestResults, setAgentTestResults] = useState<
    Partial<
      Record<
        StudioAgentId,
        { ok: boolean; text: string }
      >
    >
  >({});

  const loadRouterConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/router/config");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا در دریافت تنظیمات روتر");
      setConfig(data.config);
      setPresets(data.presets ?? []);
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در بارگذاری روتر",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRouterConfig();
  }, [loadRouterConfig]);

  // All selectable active models across active providers for Combo Lists
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

  const handleSelectPreset = (kind: RouterProviderKind) => {
    setNewKind(kind);
    const p = presets.find((item) => item.kind === kind);
    if (p) {
      setNewBaseUrl(p.defaultBaseUrl);
      const shortLabel = p.label.split("(")[0].trim();
      setNewName(shortLabel);
    }
  };

  const handleCreateProvider = async (autoDiscoverWorking: boolean) => {
    if (!newName.trim()) {
      setBanner({ type: "error", text: "لطفاً یک نام برای حساب سرویس‌دهنده وارد کنید." });
      return;
    }
    if (!newApiKey.trim()) {
      setBanner({ type: "error", text: "لطفاً کلید API را وارد کنید." });
      return;
    }
    setIsSavingProvider(true);
    setBanner(null);
    try {
      const res = await fetch("/api/router/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: newKind,
          name: newName.trim(),
          baseUrl: newBaseUrl.trim(),
          apiKey: newApiKey.trim(),
          enabled: true,
          autoDiscoverWorking,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ثبت حساب ناموفق بود.");
      setConfig(data.config);
      setShowAddForm(false);
      setNewApiKey("");
      setBanner({
        type: "ok",
        text:
          data.discoveryMessage ||
          "حساب جدید با موفقیت در سرور ذخیره شد.",
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در افزودن سرویس‌دهنده",
      });
    } finally {
      setIsSavingProvider(false);
    }
  };

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

  const handleSaveProviderEdit = async (providerId: string) => {
    setBusyProviderId(providerId);
    setBanner(null);
    try {
      const res = await fetch(`/api/router/providers/${providerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editNameValue.trim() || undefined,
          baseUrl: editBaseUrlValue.trim() || undefined,
          apiKey: editKeyValue.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "بروزرسانی حساب ناموفق بود.");
      setConfig(data.config);
      setEditingProviderId(null);
      setEditKeyValue("");
      setBanner({ type: "ok", text: "تنظیمات حساب با موفقیت بروزرسانی شد." });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در ویرایش حساب",
      });
    } finally {
      setBusyProviderId(null);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    setBusyProviderId(providerId);
    try {
      const res = await fetch(`/api/router/providers/${providerId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "حذف انجام نشد.");
      setConfig(data.config);
      setConfirmDeleteId(null);
      setBanner({ type: "ok", text: "حساب سرویس‌دهنده حذف شد." });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "خطا در حذف حساب",
      });
    } finally {
      setBusyProviderId(null);
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
        text: data.message || (data.ok ? "ارتباط برقرار است." : "تست ناموفق بود."),
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
      if (!res.ok) throw new Error(data.error || "دریافت مدل‌ها ناموفق بود.");
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
        text: err instanceof Error ? err.message : "خطا در دریافت لیست مدل‌ها",
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
        body: JSON.stringify({ modelId: manualModelId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "افزودن مدل انجام نشد.");
      setConfig(data.config);
      setManualModelId("");
      setBanner({ type: "ok", text: "مدل دلخواه به لیست فعال اضافه شد." });
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
        text: "ابتدا در بخش «حساب‌های API و مدل‌ها» حداقل یک مدل را فعال کنید.",
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
        text: "زنجیره مدل اصلی و جایگزین‌ها با موفقیت روی همه ۴ ایجنت اعمال شد.",
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
            ? `متصل شد: ${data.usedProvider} · ${data.usedModel} (${data.latencyMs}ms)`
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

  if (isLoading || !config) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-8">
        <div className="h-6 w-56 animate-pulse rounded bg-[#1B1F2A]" />
        <div className="h-32 animate-pulse rounded-xl bg-[#1B1F2A]" />
        <div className="h-32 animate-pulse rounded-xl bg-[#1B1F2A]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Calm Header & Simple 2-Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5">
        <div>
          <h1 className="text-lg font-bold text-slate-100">روتر هوشمند مدل‌ها و آداپتور API</h1>
          <p className="mt-1 text-xs leading-6 text-slate-400">
            حساب‌های OpenRouter، Groq، گوگل یا هر سرویس سازگار دیگری را متصل کنید و برای هر ایجنت مدل اصلی و جایگزین (فالبک) بچینید.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-[#262B38] bg-[#0B0D11] p-1">
          <button
            type="button"
            onClick={() => setSubTab("agents")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              subTab === "agents"
                ? "bg-amber-500 text-slate-950"
                : "text-slate-300 hover:text-white"
            }`}
          >
            ۱. اتصال مدل به ایجنت‌ها ({AGENT_META.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab("providers")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
              subTab === "providers"
                ? "bg-amber-500 text-slate-950"
                : "text-slate-300 hover:text-white"
            }`}
          >
            ۲. حساب‌های API و مدل‌ها ({config.providers.length})
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
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

      {/* TAB 1: Agent Combo List & Fallback Priority */}
      {subTab === "agents" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#262B38] bg-[#14171F]/70 px-4 py-3 text-xs text-slate-300">
            <span>
              در صورت خطا یا اتمام سهمیه «مدل اصلی»، ایجنت به‌صورت خودکار سراغ «جایگزین ۱» و سپس «جایگزین ۲» می‌رود.
            </span>
            <button
              type="button"
              onClick={handleApplyChainToAllAgents}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
            >
              اعمال زنجیره سناریونویس روی همه ایجنت‌ها
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
                  <div>
                    <h2 className="text-sm font-bold text-slate-100">{agent.title}</h2>
                    <p className="mt-0.5 text-xs text-slate-400">{agent.subtitle}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={testingAgentId === agent.id}
                      onClick={() => handleTestAgentChain(agent.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>{testingAgentId === agent.id ? "در حال تست..." : "تست زنجیره"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddFallbackSlot(agent.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>افزودن جایگزین (فالبک)</span>
                    </button>
                  </div>
                </div>

                {/* Ordered Combo List */}
                <div className="space-y-2.5">
                  {chain.map((target, idx) => {
                    const currentVal = `${target.providerId}::${target.modelId}`;
                    const existsInActive = activeModelOptions.some((o) => o.value === currentVal);

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
                          onChange={(e) => handleAgentTargetChange(agent.id, idx, e.target.value)}
                          className="min-w-[240px] flex-1 rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                        >
                          {!existsInActive && (
                            <option value={currentVal}>
                              {target.modelId} (سرویس یا مدل غیرفعال)
                            </option>
                          )}
                          {activeModelOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>

                        <div className="flex items-center gap-1">
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
      ) : (
        /* TAB 2: Provider Accounts, Key Auto-Discovery & Live Site Catalog */
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              تمامی کلیدهای API به‌صورت امن در سرور نگهداری می‌شوند و به مرورگر ارسال نمی‌گردند.
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            >
              <Plus className="h-4 w-4" />
              <span>{showAddForm ? "بستن فرم افزودن" : "افزودن حساب یا سرویس جدید"}</span>
            </button>
          </div>

          {/* Add New Account Drawer */}
          {showAddForm && (
            <div className="space-y-4 rounded-2xl border border-amber-500/40 bg-[#14171F] p-5">
              <div className="text-sm font-bold text-slate-100">اتصال حساب جدید هوش مصنوعی</div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    انتخاب سرویس‌دهنده
                  </label>
                  <select
                    value={newKind}
                    onChange={(e) => handleSelectPreset(e.target.value as RouterProviderKind)}
                    className="w-full rounded-xl border border-[#262B38] bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-100 outline-none focus:border-amber-500"
                  >
                    {presets.map((p) => (
                      <option key={p.kind} value={p.kind}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    نام دلخواه حساب (برای نمایش در لیست‌ها)
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="مثلاً OpenRouter رایگان من"
                    className="w-full rounded-xl border border-[#262B38] bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-100 outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    کلید API
                  </label>
                  <div className="relative">
                    <input
                      type={showNewKey ? "text" : "password"}
                      value={newApiKey}
                      onChange={(e) => setNewApiKey(e.target.value)}
                      dir="ltr"
                      placeholder={
                        presets.find((p) => p.kind === newKind)?.placeholderKey || "sk-..."
                      }
                      className="w-full rounded-xl border border-[#262B38] bg-[#0B0D11] px-3 py-2.5 pl-10 text-xs text-slate-100 outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewKey((s) => !s)}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {showNewKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    آدرس پایه (Base URL)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={newBaseUrl}
                    onChange={(e) => setNewBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="w-full rounded-xl border border-[#262B38] bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-100 outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                {presets.find((p) => p.kind === newKind)?.hintFa}
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={isSavingProvider}
                  onClick={() => handleCreateProvider(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                >
                  <Wand2 className="h-4 w-4" />
                  <span>
                    {isSavingProvider
                      ? "در حال بررسی و یافتن مدل‌های پاسخگو..."
                      : "ذخیره و افزودن خودکار مدل‌های پاسخگو با این کلید"}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isSavingProvider}
                  onClick={() => handleCreateProvider(false)}
                  className="rounded-xl border border-[#262B38] bg-[#0B0D11] px-4 py-2.5 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:opacity-50"
                >
                  فقط ذخیره حساب
                </button>
              </div>
            </div>
          )}

          {/* Connected Provider Cards */}
          <div className="space-y-3">
            {config.providers.map((provider) => {
              const activeCount = provider.models.filter((m) => m.enabled).length;
              const isBusy = busyProviderId === provider.id;
              const isEditing = editingProviderId === provider.id;

              return (
                <div
                  key={provider.id}
                  className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="text-sm font-bold text-slate-100">{provider.name}</h3>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                            provider.hasApiKey
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-red-500/15 text-red-300"
                          }`}
                        >
                          {provider.hasApiKey ? provider.maskedKey : "کلید ثبت نشده"}
                        </span>
                        <span className="rounded-md bg-[#0B0D11] px-2 py-0.5 text-[11px] text-amber-300">
                          {activeCount} مدل فعال از {provider.models.length} مدل
                        </span>
                      </div>
                      <div dir="ltr" className="text-right text-[11px] text-slate-500">
                        {provider.baseUrl || "سرویس استاندارد"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleProviderEnabled(provider)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                          provider.enabled
                            ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                            : "bg-slate-700/40 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {provider.enabled ? "روشن" : "خاموش"}
                      </button>

                      {provider.id !== "google_default" &&
                        (confirmDeleteId === provider.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDeleteProvider(provider.id)}
                              className="rounded-lg bg-red-500 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                            >
                              تایید حذف
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-lg bg-[#0B0D11] px-2.5 py-1.5 text-[11px] text-slate-300"
                            >
                              انصراف
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(provider.id)}
                            className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-1.5 text-slate-400 hover:text-red-400"
                            title="حذف حساب"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ))}
                    </div>
                  </div>

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

                  {/* Clean Action Row */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDiscoverProvider(provider.id, "auto_working")}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      <span>
                        {isBusy ? "در حال بررسی..." : "افزودن خودکار مدل‌های پاسخگو"}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDiscoverProvider(provider.id, "catalog")}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50"
                    >
                      <ListFilter className="h-3.5 w-3.5" />
                      <span>انتخاب از لیست به‌روز سایت</span>
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleTestProvider(provider.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`} />
                      <span>تست ارتباط</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (isEditing) {
                          setEditingProviderId(null);
                        } else {
                          setEditingProviderId(provider.id);
                          setEditNameValue(provider.name);
                          setEditBaseUrlValue(provider.baseUrl);
                          setEditKeyValue("");
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>ویرایش کلید / آدرس</span>
                    </button>
                  </div>

                  {/* Inline Edit Key Drawer */}
                  {isEditing && (
                    <div className="space-y-3 rounded-xl border border-[#262B38] bg-[#0B0D11]/90 p-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <input
                          type="text"
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          placeholder="نام حساب"
                          className="rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                        />
                        <input
                          type="text"
                          dir="ltr"
                          value={editBaseUrlValue}
                          onChange={(e) => setEditBaseUrlValue(e.target.value)}
                          placeholder="Base URL"
                          className="rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                        />
                        <input
                          type="password"
                          dir="ltr"
                          value={editKeyValue}
                          onChange={(e) => setEditKeyValue(e.target.value)}
                          placeholder="کلید API جدید (در صورت نیاز به تغییر)"
                          className="rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleSaveProviderEdit(provider.id)}
                          className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                        >
                          ذخیره تغییرات
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingProviderId(null)}
                          className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                        >
                          انصراف
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Clean Focused Modal: Live Site Model Catalog Picker */}
      {catalogProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[#262B38] bg-[#14171F] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#262B38] px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  لیست به‌روز مدل‌های {catalogProvider.name}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  مدل‌های دلخواه را روشن یا خاموش کنید؛ مدل‌های روشن در کومبولیست ایجنت‌ها ظاهر می‌شوند.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCatalogProviderId(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-[#1B1F2A] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search & Filter Controls */}
            <div className="flex flex-wrap items-center gap-3 border-b border-[#262B38] px-5 py-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="جستجوی نام یا شناسه مدل..."
                  className="w-full rounded-xl border border-[#262B38] bg-[#0B0D11] py-2 pr-9 pl-3 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center gap-1 rounded-xl border border-[#262B38] bg-[#0B0D11] p-1 text-[11px]">
                {[
                  { id: "free", label: "رایگان‌ها" },
                  { id: "enabled", label: "فعال‌های من" },
                  { id: "all", label: "همه مدل‌ها" },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setCatalogFilter(f.id as "all" | "free" | "enabled")}
                    className={`rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
                      catalogFilter === f.id
                        ? "bg-amber-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Model Rows */}
            <div className="flex-1 space-y-2 overflow-y-auto p-5">
              {filteredCatalogModels.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  مدلی با این فیلتر یافت نشد. فیلتر را روی «همه مدل‌ها» بگذارید یا نام مدل دلخواه را در کادر پایین اضافه کنید.
                </div>
              ) : (
                filteredCatalogModels.map((m: RouterModelEntry) => {
                  const isTesting = testingModelKey === `${catalogProvider.id}::${m.id}`;
                  return (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#262B38] bg-[#0B0D11]/70 px-3.5 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-xs font-semibold text-slate-100">
                            {m.name}
                          </span>
                          {m.isFree && (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                              رایگان
                            </span>
                          )}
                          {m.lastTestedOk === true && (
                            <span className="text-[10px] text-emerald-400">
                              پاسخگو ({m.lastLatencyMs}ms)
                            </span>
                          )}
                          {m.lastTestedOk === false && (
                            <span className="text-[10px] text-red-400">خطا در تست</span>
                          )}
                        </div>
                        <div dir="ltr" className="truncate text-right text-[11px] text-slate-500">
                          {m.id}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isTesting}
                          onClick={() => handleTestSingleModel(catalogProvider.id, m.id)}
                          className="rounded-lg border border-[#262B38] bg-[#14171F] px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50"
                        >
                          {isTesting ? "تست..." : "تست"}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleToggleModel(catalogProvider.id, m.id, !m.enabled)
                          }
                          className={`min-w-[70px] rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                            m.enabled
                              ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
                              : "bg-[#1B1F2A] text-slate-300 hover:text-white"
                          }`}
                        >
                          {m.enabled ? "فعال ✓" : "افزودن +"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Manual Model Add Footer */}
            <div className="flex flex-wrap items-center gap-2 border-t border-[#262B38] px-5 py-3.5">
              <input
                type="text"
                dir="ltr"
                value={manualModelId}
                onChange={(e) => setManualModelId(e.target.value)}
                placeholder="افزودن دستی شناسه مدل (مثلاً: meta-llama/llama-3.3-70b-instruct:free)"
                className="min-w-[240px] flex-1 rounded-xl border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => handleAddManualModel(catalogProvider.id)}
                className="rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
              >
                افزودن مدل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
