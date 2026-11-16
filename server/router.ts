import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type {
  AgentRouteTarget,
  GroundedSource,
  RouterConfigPublic,
  RouterModelEntry,
  RouterProviderAccount,
  RouterProviderKind,
  StudioAgentId,
} from "../src/types/studio.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const ROUTER_CONFIG_FILE = path.join(DATA_DIR, "router_config.json");

interface StoredProviderAccount extends Omit<RouterProviderAccount, "hasApiKey" | "maskedKey"> {
  apiKey: string;
}

interface StoredRouterConfig {
  providers: StoredProviderAccount[];
  agentRoutes: Record<StudioAgentId, AgentRouteTarget[]>;
  updatedAt: string;
}

export const PROVIDER_DEFAULT_URLS: Record<RouterProviderKind, string> = {
  google: "https://generativelanguage.googleapis.com/v1beta",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  huggingface: "https://router.huggingface.co/v1",
  openai_compatible: "",
};

const DEFAULT_GOOGLE_MODELS: RouterModelEntry[] = [
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen (اصلی استودیو)",
    isFree: true,
    enabled: true,
    lastTestedOk: null,
    lastLatencyMs: null,
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite (سریع و اقتصادی)",
    isFree: true,
    enabled: true,
    lastTestedOk: null,
    lastLatencyMs: null,
  },
];

function createDefaultStoredConfig(): StoredRouterConfig {
  const defaultTargets: AgentRouteTarget[] = [
    { providerId: "google_default", modelId: "gemini-4-hydrogen" },
    { providerId: "google_default", modelId: "gemini-3.1-flash-lite" },
  ];

  return {
    providers: [
      {
        id: "google_default",
        kind: "google",
        name: "گوگل جمینای (سرویس پیش‌فرض استودیو)",
        baseUrl: PROVIDER_DEFAULT_URLS.google,
        useServerEnv: true,
        apiKey: "",
        enabled: true,
        lastSyncedAt: null,
        lastTestStatus: process.env.GEMINI_API_KEY ? "ok" : "untested",
        lastTestMessage: process.env.GEMINI_API_KEY ? "کلید سرور استودیو متصل است" : null,
        models: DEFAULT_GOOGLE_MODELS,
      },
    ],
    agentRoutes: {
      research_script: [...defaultTargets],
      voiceover: [...defaultTargets],
      director: [...defaultTargets],
      visuals: [...defaultTargets],
    },
    updatedAt: new Date().toISOString(),
  };
}

function ensureStoredConfig(): StoredRouterConfig {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ROUTER_CONFIG_FILE)) {
    const def = createDefaultStoredConfig();
    fs.writeFileSync(ROUTER_CONFIG_FILE, JSON.stringify(def, null, 2), "utf-8");
    return def;
  }
  try {
    const raw = fs.readFileSync(ROUTER_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as StoredRouterConfig & {
      agentRoutes: Record<string, AgentRouteTarget[]>;
    };
    if (!Array.isArray(parsed.providers) || !parsed.agentRoutes) {
      throw new Error("invalid router config");
    }
    if ("strategist" in parsed.agentRoutes) {
      if (!parsed.agentRoutes.research_script?.length && parsed.agentRoutes.strategist?.length) {
        parsed.agentRoutes.research_script = parsed.agentRoutes.strategist;
      }
      delete parsed.agentRoutes.strategist;
      fs.writeFileSync(ROUTER_CONFIG_FILE, JSON.stringify(parsed, null, 2), "utf-8");
    }
    return parsed as StoredRouterConfig;
  } catch {
    const def = createDefaultStoredConfig();
    fs.writeFileSync(ROUTER_CONFIG_FILE, JSON.stringify(def, null, 2), "utf-8");
    return def;
  }
}

function saveStoredConfig(cfg: StoredRouterConfig): StoredRouterConfig {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const next: StoredRouterConfig = {
    ...cfg,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(ROUTER_CONFIG_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function maskSecret(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 10) return "••••••";
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`;
}

function resolveProviderKey(p: StoredProviderAccount): string {
  if (p.useServerEnv && p.kind === "google") {
    return (p.apiKey?.trim() || process.env.GEMINI_API_KEY || "").trim();
  }
  return (p.apiKey || "").trim();
}

export function toPublicRouterConfig(cfg?: StoredRouterConfig): RouterConfigPublic {
  const stored = cfg ?? ensureStoredConfig();
  return {
    providers: stored.providers.map((p) => {
      const effectiveKey = resolveProviderKey(p);
      return {
        id: p.id,
        kind: p.kind,
        name: p.name,
        baseUrl: p.baseUrl,
        useServerEnv: p.useServerEnv,
        hasApiKey: Boolean(effectiveKey),
        maskedKey:
          p.useServerEnv && !p.apiKey?.trim()
            ? process.env.GEMINI_API_KEY
              ? "کلید پیش‌فرض سرور استودیو"
              : "تنظیم‌نشده"
            : maskSecret(p.apiKey),
        enabled: p.enabled,
        lastSyncedAt: p.lastSyncedAt,
        lastTestStatus: p.lastTestStatus,
        lastTestMessage: p.lastTestMessage,
        models: p.models,
      };
    }),
    agentRoutes: stored.agentRoutes,
    updatedAt: stored.updatedAt,
  };
}

export function addOrUpdateProvider(input: {
  id?: string;
  kind: RouterProviderKind;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
}): { config: RouterConfigPublic; providerId: string } {
  const cfg = ensureStoredConfig();
  const baseUrl = (input.baseUrl?.trim() || PROVIDER_DEFAULT_URLS[input.kind] || "").replace(/\/+$/, "");

  if (input.id) {
    const idx = cfg.providers.findIndex((p) => p.id === input.id);
    if (idx < 0) throw new Error("سرویس‌دهنده موردنظر یافت نشد.");
    const existing = cfg.providers[idx];
    cfg.providers[idx] = {
      ...existing,
      name: input.name?.trim() || existing.name,
      baseUrl: baseUrl || existing.baseUrl,
      apiKey: input.apiKey !== undefined && input.apiKey.trim() !== "" ? input.apiKey.trim() : existing.apiKey,
      enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
    };
    const saved = saveStoredConfig(cfg);
    return { config: toPublicRouterConfig(saved), providerId: existing.id };
  }

  const id = `prov_${input.kind}_${Date.now().toString(36)}`;
  const newProvider: StoredProviderAccount = {
    id,
    kind: input.kind,
    name: input.name.trim() || input.kind,
    baseUrl,
    useServerEnv: false,
    apiKey: (input.apiKey || "").trim(),
    enabled: input.enabled ?? true,
    lastSyncedAt: null,
    lastTestStatus: "untested",
    lastTestMessage: null,
    models: input.kind === "google" ? [...DEFAULT_GOOGLE_MODELS] : [],
  };
  cfg.providers.push(newProvider);
  const saved = saveStoredConfig(cfg);
  return { config: toPublicRouterConfig(saved), providerId: id };
}

export function deleteProvider(providerId: string): RouterConfigPublic {
  const cfg = ensureStoredConfig();
  if (providerId === "google_default") {
    throw new Error("سرویس‌دهنده پیش‌فرض گوگل قابل حذف نیست؛ می‌توانید آن را غیرفعال یا اولویت آن را جابجا کنید.");
  }
  cfg.providers = cfg.providers.filter((p) => p.id !== providerId);
  for (const agentKey of Object.keys(cfg.agentRoutes) as StudioAgentId[]) {
    cfg.agentRoutes[agentKey] = cfg.agentRoutes[agentKey].filter((t) => t.providerId !== providerId);
  }
  return toPublicRouterConfig(saveStoredConfig(cfg));
}

export function toggleProviderModel(
  providerId: string,
  modelId: string,
  enabled: boolean
): RouterConfigPublic {
  const cfg = ensureStoredConfig();
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("سرویس‌دهنده یافت نشد.");

  const idx = provider.models.findIndex((m) => m.id === modelId);
  if (idx >= 0) {
    provider.models[idx] = { ...provider.models[idx], enabled };
  } else {
    provider.models.unshift({
      id: modelId,
      name: modelId,
      isFree: modelId.includes(":free"),
      enabled,
      lastTestedOk: null,
      lastLatencyMs: null,
    });
  }
  return toPublicRouterConfig(saveStoredConfig(cfg));
}

export function addManualModelToProvider(
  providerId: string,
  modelId: string,
  name?: string,
  isFree?: boolean
): RouterConfigPublic {
  const cfg = ensureStoredConfig();
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("سرویس‌دهنده یافت نشد.");
  const cleanId = modelId.trim();
  if (!cleanId) throw new Error("شناسه مدل نمی‌تواند خالی باشد.");

  const exists = provider.models.find((m) => m.id === cleanId);
  if (exists) {
    exists.enabled = true;
    if (name?.trim()) exists.name = name.trim();
  } else {
    provider.models.unshift({
      id: cleanId,
      name: name?.trim() || cleanId,
      isFree: isFree ?? cleanId.includes(":free"),
      enabled: true,
      lastTestedOk: null,
      lastLatencyMs: null,
    });
  }
  return toPublicRouterConfig(saveStoredConfig(cfg));
}

export function updateAgentRoutes(
  agentId: StudioAgentId,
  targets: AgentRouteTarget[]
): RouterConfigPublic {
  const cfg = ensureStoredConfig();
  const seen = new Set<string>();
  const cleaned: AgentRouteTarget[] = [];
  for (const t of targets) {
    if (!t.providerId || !t.modelId) continue;
    const key = `${t.providerId}::${t.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ providerId: t.providerId, modelId: t.modelId });
  }
  cfg.agentRoutes[agentId] = cleaned;
  return toPublicRouterConfig(saveStoredConfig(cfg));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isLikelyChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  const skip = [
    "whisper",
    "tts",
    "embed",
    "embedding",
    "rerank",
    "moderation",
    "guard",
    "flux",
    "dall-e",
    "stable-diffusion",
    "sdxl",
    "audio",
  ];
  return !skip.some((token) => lower.includes(token));
}

async function fetchLiveCatalogFromProvider(
  provider: StoredProviderAccount
): Promise<{ models: RouterModelEntry[]; accountNote: string }> {
  const key = resolveProviderKey(provider);
  if (!key) {
    throw new Error("کلید API برای این سرویس‌دهنده ثبت نشده است.");
  }

  if (provider.kind === "google") {
    const res = await fetchWithTimeout(
      `${provider.baseUrl || PROVIDER_DEFAULT_URLS.google}/models?key=${encodeURIComponent(key)}`,
      { method: "GET" },
      15000
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`خطا در دریافت لیست مدل‌های گوگل (${res.status}): ${errText.slice(0, 160)}`);
    }
    const data = (await res.json()) as {
      models?: Array<{
        name: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
        inputTokenLimit?: number;
      }>;
    };

    const existingMap = new Map(provider.models.map((m) => [m.id, m]));
    const mergedMap = new Map<string, RouterModelEntry>();

    for (const dm of DEFAULT_GOOGLE_MODELS) {
      const prev = existingMap.get(dm.id);
      mergedMap.set(dm.id, prev ? prev : dm);
    }

    for (const m of data.models ?? []) {
      const methods = m.supportedGenerationMethods ?? [];
      if (!methods.includes("generateContent")) continue;
      const cleanId = m.name.replace(/^models\//, "");
      if (
        cleanId.includes("embedding") ||
        cleanId.includes("aqa") ||
        cleanId.includes("imagen")
      ) {
        continue;
      }
      const prev = existingMap.get(cleanId);
      mergedMap.set(cleanId, {
        id: cleanId,
        name: m.displayName || cleanId,
        isFree: true,
        enabled: prev?.enabled ?? false,
        contextLength: m.inputTokenLimit,
        lastTestedOk: prev?.lastTestedOk ?? null,
        lastLatencyMs: prev?.lastLatencyMs ?? null,
      });
    }

    return {
      models: Array.from(mergedMap.values()),
      accountNote: `${mergedMap.size} مدل زنده از گوگل دریافت شد.`,
    };
  }

  // OpenAI-compatible & OpenRouter
  const baseUrl = (provider.baseUrl || PROVIDER_DEFAULT_URLS[provider.kind] || "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("آدرس پایه (Base URL) برای این سرویس‌دهنده وارد نشده است.");
  }

  let openRouterFreeTierNote = "";
  let preferFreeOnly = false;

  if (provider.kind === "openrouter") {
    try {
      const keyRes = await fetchWithTimeout(
        `${baseUrl}/auth/key`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${key}` },
        },
        10000
      );
      if (keyRes.ok) {
        const keyJson = (await keyRes.json()) as {
          data?: { is_free_tier?: boolean; limit_remaining?: number | null; usage?: number };
        };
        const isFree = keyJson.data?.is_free_tier;
        const remaining = keyJson.data?.limit_remaining;
        if (isFree || remaining === 0) {
          preferFreeOnly = true;
          openRouterFreeTierNote = "حساب OpenRouter رایگان شناسایی شد (فیلتر هوشمند مدل‌های رایگان فعال است).";
        } else {
          openRouterFreeTierNote = `حساب OpenRouter متصل است (اعتبار باقی‌مانده: ${remaining ?? "نامحدود"}).`;
        }
      }
    } catch {
      // Proceed cleanly even if /auth/key is unavailable
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  if (provider.kind === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:3000";
    headers["X-Title"] = "Content Studio Desktop";
  }

  const res = await fetchWithTimeout(`${baseUrl}/models`, { method: "GET", headers }, 18000);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`خطا در اتصال و دریافت مدل‌ها (${res.status}): ${errText.slice(0, 180)}`);
  }

  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
    }>;
  };

  const rawList = Array.isArray(json.data) ? json.data : [];
  const existingMap = new Map(provider.models.map((m) => [m.id, m]));

  const normalized: RouterModelEntry[] = rawList
    .filter((item) => item?.id && isLikelyChatModel(item.id))
    .map((item) => {
      const isFree =
        item.id.endsWith(":free") ||
        (item.pricing?.prompt === "0" && item.pricing?.completion === "0") ||
        provider.kind === "groq" ||
        provider.kind === "cerebras";
      const prev = existingMap.get(item.id);
      return {
        id: item.id,
        name: item.name || item.id,
        isFree,
        enabled: prev?.enabled ?? false,
        contextLength: item.context_length,
        lastTestedOk: prev?.lastTestedOk ?? null,
        lastLatencyMs: prev?.lastLatencyMs ?? null,
        lastError: prev?.lastError ?? null,
      };
    })
    .sort((a, b) => Number(b.isFree) - Number(a.isFree));

  const accountNote =
    openRouterFreeTierNote ||
    `${normalized.length} مدل به‌روز از سرویس‌دهنده دریافت شد.${preferFreeOnly ? " (مدل‌های رایگان اولویت دارند)" : ""}`;

  return { models: normalized, accountNote };
}

export async function probeSingleModel(
  provider: StoredProviderAccount,
  modelId: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  const key = resolveProviderKey(provider);
  if (!key) {
    return { ok: false, latencyMs: 0, error: "کلید API تنظیم نشده است." };
  }

  try {
    if (provider.kind === "google") {
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.models.generateContent({
        model: modelId,
        contents: "فقط عدد 1 را برگردان.",
      });
      if (res.text !== undefined) {
        return { ok: true, latencyMs: Date.now() - started };
      }
      return { ok: false, latencyMs: Date.now() - started, error: "پاسخ خالی از گوگل" };
    }

    const baseUrl = (provider.baseUrl || PROVIDER_DEFAULT_URLS[provider.kind] || "").replace(/\/+$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
    if (provider.kind === "openrouter") {
      headers["HTTP-Referer"] = "http://localhost:3000";
      headers["X-Title"] = "Content Studio Desktop";
    }

    const res = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "Reply with OK." }],
          max_tokens: 5,
          temperature: 0,
        }),
      },
      10000
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: `HTTP ${res.status}: ${txt.slice(0, 120)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (data.choices && data.choices.length > 0) {
      return { ok: true, latencyMs: Date.now() - started };
    }
    return { ok: false, latencyMs: Date.now() - started, error: "ساختار پاسخ نامعتبر است." };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message.slice(0, 140) : "خطا در ارتباط",
    };
  }
}

export async function testProviderConnection(providerId: string): Promise<{
  ok: boolean;
  message: string;
  config: RouterConfigPublic;
}> {
  const cfg = ensureStoredConfig();
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("سرویس‌دهنده یافت نشد.");

  try {
    const { models, accountNote } = await fetchLiveCatalogFromProvider(provider);
    const probeTarget =
      models.find((m) => m.enabled && m.isFree) ||
      models.find((m) => m.isFree) ||
      models[0];

    let probeNote = "";
    if (probeTarget) {
      const probe = await probeSingleModel(provider, probeTarget.id);
      probeTarget.lastTestedOk = probe.ok;
      probeTarget.lastLatencyMs = probe.latencyMs;
      probeTarget.lastError = probe.error ?? null;
      probeNote = probe.ok
        ? ` · تست مدل ${probeTarget.id} موفق (${probe.latencyMs}ms)`
        : ` · هشدار تست ${probeTarget.id}: ${probe.error}`;
    }

    provider.models = models;
    provider.lastSyncedAt = new Date().toISOString();
    provider.lastTestStatus = "ok";
    provider.lastTestMessage = `${accountNote}${probeNote}`;
    const saved = saveStoredConfig(cfg);
    return {
      ok: true,
      message: provider.lastTestMessage,
      config: toPublicRouterConfig(saved),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "خطا در تست ارتباط";
    provider.lastTestStatus = "error";
    provider.lastTestMessage = msg;
    const saved = saveStoredConfig(cfg);
    return {
      ok: false,
      message: msg,
      config: toPublicRouterConfig(saved),
    };
  }
}

export async function testSingleProviderModel(
  providerId: string,
  modelId: string
): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  config: RouterConfigPublic;
}> {
  const cfg = ensureStoredConfig();
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("سرویس‌دهنده یافت نشد.");

  const res = await probeSingleModel(provider, modelId);
  const idx = provider.models.findIndex((m) => m.id === modelId);
  if (idx >= 0) {
    provider.models[idx] = {
      ...provider.models[idx],
      lastTestedOk: res.ok,
      lastLatencyMs: res.latencyMs,
      lastError: res.error ?? null,
      enabled: res.ok ? true : provider.models[idx].enabled,
    };
  }
  const saved = saveStoredConfig(cfg);
  return {
    ...res,
    config: toPublicRouterConfig(saved),
  };
}

/**
 * Syncs live site catalog and optionally probes candidate/free models with the API key
 * so all responding models are automatically enabled in the system!
 */
export async function syncAndDiscoverProviderModels(
  providerId: string,
  mode: "auto_working" | "catalog"
): Promise<{
  config: RouterConfigPublic;
  totalCatalog: number;
  enabledWorkingCount: number;
  message: string;
}> {
  const cfg = ensureStoredConfig();
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("سرویس‌دهنده یافت نشد.");

  const { models, accountNote } = await fetchLiveCatalogFromProvider(provider);

  if (mode === "catalog") {
    provider.models = models;
    provider.lastSyncedAt = new Date().toISOString();
    provider.lastTestStatus = "ok";
    provider.lastTestMessage = accountNote;
    const saved = saveStoredConfig(cfg);
    return {
      config: toPublicRouterConfig(saved),
      totalCatalog: models.length,
      enabledWorkingCount: models.filter((m) => m.enabled).length,
      message: `${models.length} مدل زنده از سایت دریافت شد.`,
    };
  }

  // auto_working mode: probe free/candidate models to discover which ones respond with this key
  const freeModels = models.filter((m) => m.isFree);
  const candidates = (freeModels.length > 0 ? freeModels : models).slice(0, 10);

  let workingCount = 0;
  const results = await Promise.all(
    candidates.map(async (m) => {
      const probe = await probeSingleModel(provider, m.id);
      return { id: m.id, probe };
    })
  );

  for (const { id, probe } of results) {
    const target = models.find((m) => m.id === id);
    if (!target) continue;
    target.lastTestedOk = probe.ok;
    target.lastLatencyMs = probe.latencyMs;
    target.lastError = probe.error ?? null;
    if (probe.ok) {
      target.enabled = true;
      workingCount += 1;
    }
  }

  // If OpenRouter has more :free models beyond top 10, keep them available in catalog (and enabled if already enabled)
  if (workingCount === 0 && freeModels.length > 0) {
    // Rate-limit safe fallback: enable top 3 free models if probes hit instant burst throttling
    for (const fm of freeModels.slice(0, 3)) {
      fm.enabled = true;
    }
  }

  provider.models = models;
  provider.lastSyncedAt = new Date().toISOString();
  provider.lastTestStatus = workingCount > 0 ? "ok" : "error";
  provider.lastTestMessage =
    workingCount > 0
      ? `${workingCount} مدل پاسخگو با کلید شما شناسایی و به لیست فعال اضافه شد.`
      : `لیست سایت دریافت شد (${models.length} مدل)، اما مدل‌های تست‌شده در این لحظه پاسخ ندادند.`;

  const saved = saveStoredConfig(cfg);
  return {
    config: toPublicRouterConfig(saved),
    totalCatalog: models.length,
    enabledWorkingCount: models.filter((m) => m.enabled).length,
    message: provider.lastTestMessage,
  };
}

function extractJsonObject(rawText: string): string {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  if (firstObj < 0 && firstArr < 0) return cleaned;

  const isArr = firstArr >= 0 && (firstObj < 0 || firstArr < firstObj);
  const start = isArr ? firstArr : firstObj;
  const end = isArr ? cleaned.lastIndexOf("]") : cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return cleaned.slice(start, end + 1);
  }
  return cleaned;
}

/**
 * Executes a structured JSON agent prompt through the configured Multi-Provider Router
 * with automatic ordered Fallback Chain across all active targets.
 */
export async function executeAgentJsonWithRouter<T>(params: {
  agentId: StudioAgentId;
  prompt: string;
  systemInstruction?: string;
  googleResponseSchema?: Record<string, unknown>;
  expectedKeys?: string[];
  expectArray?: boolean;
}): Promise<{ data: T; usedProvider: string; usedModel: string }> {
  const cfg = ensureStoredConfig();
  const configuredChain = cfg.agentRoutes[params.agentId] ?? [];

  // Always guarantee fallback to studio's built-in Google models if user chain is empty or fails
  const fallbackTargets: AgentRouteTarget[] = [
    { providerId: "google_default", modelId: "gemini-4-hydrogen" },
    { providerId: "google_default", modelId: "gemini-3.1-flash-lite" },
  ];

  const seen = new Set<string>();
  const chain: AgentRouteTarget[] = [];
  for (const t of [...configuredChain, ...fallbackTargets]) {
    const key = `${t.providerId}::${t.modelId}`;
    if (seen.has(key)) continue;
    const provider = cfg.providers.find((p) => p.id === t.providerId);
    if (!provider || !provider.enabled) continue;
    if (!resolveProviderKey(provider)) continue;
    seen.add(key);
    chain.push(t);
  }

  if (chain.length === 0) {
    throw new Error("هیچ سرویس‌دهنده یا مدل فعالی در روتر برای این ایجنت در دسترس نیست.");
  }

  const errors: string[] = [];

  for (const target of chain) {
    const provider = cfg.providers.find((p) => p.id === target.providerId);
    if (!provider) continue;
    const key = resolveProviderKey(provider);
    if (!key) continue;

    try {
      if (provider.kind === "google") {
        const ai = new GoogleGenAI({
          apiKey: key,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });
        const config: Record<string, unknown> = {
          responseMimeType: "application/json",
        };
        if (params.systemInstruction) {
          config.systemInstruction = params.systemInstruction;
        }
        if (params.googleResponseSchema) {
          config.responseSchema = params.googleResponseSchema;
        }

        const res = await ai.models.generateContent({
          model: target.modelId,
          contents: params.prompt,
          config: config as never,
        });
        const text = extractJsonObject(res.text ?? "");
        const parsed = JSON.parse(text) as T;
        return { data: parsed, usedProvider: provider.name, usedModel: target.modelId };
      }

      // OpenAI-compatible provider (OpenRouter, Groq, Cerebras, Mistral, Together, Custom)
      const baseUrl = (provider.baseUrl || PROVIDER_DEFAULT_URLS[provider.kind] || "").replace(/\/+$/, "");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      };
      if (provider.kind === "openrouter") {
        headers["HTTP-Referer"] = "http://localhost:3000";
        headers["X-Title"] = "Content Studio Desktop";
      }

      const jsonGuide = params.expectArray
        ? "\n\nCRITICAL: Return ONLY a valid JSON array (no markdown fences, no commentary)."
        : params.expectedKeys?.length
          ? `\n\nCRITICAL: Return ONLY a valid JSON object containing these exact keys: ${params.expectedKeys.join(", ")}. No markdown fences or extra commentary.`
          : "\n\nCRITICAL: Return ONLY valid JSON with no markdown fences.";

      const bodyPayload: Record<string, unknown> = {
        model: target.modelId,
        messages: [
          ...(params.systemInstruction
            ? [{ role: "system", content: `${params.systemInstruction}${jsonGuide}` }]
            : [{ role: "system", content: `You are a helpful Persian content studio AI.${jsonGuide}` }]),
          { role: "user", content: params.prompt },
        ],
        temperature: 0.7,
      };
      if (!params.expectArray) {
        bodyPayload.response_format = { type: "json_object" };
      }

      let res = await fetchWithTimeout(
        `${baseUrl}/chat/completions`,
        { method: "POST", headers, body: JSON.stringify(bodyPayload) },
        60000
      );

      // Retry without response_format if provider rejects json_object parameter
      if (!res.ok && res.status === 400 && bodyPayload.response_format) {
        delete bodyPayload.response_format;
        res = await fetchWithTimeout(
          `${baseUrl}/chat/completions`,
          { method: "POST", headers, body: JSON.stringify(bodyPayload) },
          60000
        );
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 140)}`);
      }

      const jsonRes = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = jsonRes.choices?.[0]?.message?.content ?? "";
      const extracted = extractJsonObject(rawContent);
      const parsed = JSON.parse(extracted) as T;
      return { data: parsed, usedProvider: provider.name, usedModel: target.modelId };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name} (${target.modelId}): ${errMsg.slice(0, 120)}`);
    }
  }

  throw new Error(`همه مدل‌های زنجیره روتر با خطا مواجه شدند:\n${errors.join("\n")}`);
}

export async function testAgentChain(agentId: StudioAgentId): Promise<{
  ok: boolean;
  usedProvider?: string;
  usedModel?: string;
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    const res = await executeAgentJsonWithRouter<{ ok: boolean; note: string }>({
      agentId,
      prompt: 'یک آبجکت JSON ساده با کلیدهای "ok": true و "note": "آماده" برگردان.',
      expectedKeys: ["ok", "note"],
    });
    return {
      ok: true,
      usedProvider: res.usedProvider,
      usedModel: res.usedModel,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "خطا در تست زنجیره",
    };
  }
}

export function getGoogleApiKeyFromRouter(): string {
  const cfg = ensureStoredConfig();
  const googleProv = cfg.providers.find((p) => p.kind === "google" && p.enabled);
  if (googleProv) {
    const k = resolveProviderKey(googleProv);
    if (k) return k;
  }
  const envKey = process.env.GEMINI_API_KEY;
  if (!envKey) throw new Error("کلید API گوگل در تنظیمات سرور یا روتر یافت نشد.");
  return envKey;
}
