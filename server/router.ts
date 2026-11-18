import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type {
  AgentRouteTarget,
  RouterConfigPublic,
  RouterModelEntry,
  RouterProviderAccount,
  RouterProviderKind,
  StudioAgentId,
} from "../src/types/studio.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const ROUTER_CONFIG_FILE = path.join(DATA_DIR, "router_config.json");

interface StoredProviderAccount extends Omit<RouterProviderAccount, "hasApiKey" | "maskedKey"> {
  envVarName: string;
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

const PROVIDER_ENV_VARS: Record<RouterProviderKind, string> = {
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  together: "TOGETHER_API_KEY",
  huggingface: "HUGGINGFACE_API_KEY",
  openai_compatible: "CUSTOM_OPENAI_API_KEY",
};

const DEFAULT_GOOGLE_MODELS: RouterModelEntry[] = [
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen (رایگان · استدلال بالا)",
    isFree: true,
    enabled: true,
    lastTestedOk: null,
    lastLatencyMs: null,
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite (رایگان · فوق‌سریع و سهمیه بالا)",
    isFree: true,
    enabled: true,
    lastTestedOk: null,
    lastLatencyMs: null,
  },
];

const DEFAULT_OPENROUTER_FREE_MODELS: RouterModelEntry[] = [
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B Instruct (:free)",
    isFree: true,
    enabled: true,
    lastTestedOk: null,
    lastLatencyMs: null,
  },
  {
    id: "qwen/qwen-2.5-72b-instruct:free",
    name: "Qwen 2.5 72B Instruct (:free)",
    isFree: true,
    enabled: true,
    lastTestedOk: null,
    lastLatencyMs: null,
  },
];

const DEFAULT_GROQ_MODELS: RouterModelEntry[] = [
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B Versatile (Groq Free)",
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
        name: "Google Gemini (سرور پیش‌فرض رایگان)",
        baseUrl: PROVIDER_DEFAULT_URLS.google,
        useServerEnv: true,
        envVarName: "GEMINI_API_KEY",
        enabled: true,
        lastSyncedAt: null,
        lastTestStatus: process.env.GEMINI_API_KEY ? "ok" : "untested",
        lastTestMessage: process.env.GEMINI_API_KEY
          ? "متصل به محیط سرور استودیو"
          : "در انتظار متغیر محیطی سرور",
        models: [...DEFAULT_GOOGLE_MODELS],
      },
      {
        id: "openrouter_env",
        kind: "openrouter",
        name: "OpenRouter Free Models (محیط سرور)",
        baseUrl: PROVIDER_DEFAULT_URLS.openrouter,
        useServerEnv: true,
        envVarName: "OPENROUTER_API_KEY",
        enabled: true,
        lastSyncedAt: null,
        lastTestStatus: process.env.OPENROUTER_API_KEY ? "ok" : "untested",
        lastTestMessage: process.env.OPENROUTER_API_KEY
          ? "متصل از طریق متغیر محیطی OPENROUTER_API_KEY"
          : "در صورت تعریف OPENROUTER_API_KEY در سرور به زنجیره فالبک اضافه می‌شود",
        models: [...DEFAULT_OPENROUTER_FREE_MODELS],
      },
      {
        id: "groq_env",
        kind: "groq",
        name: "Groq Ultra-Fast Free Tier (محیط سرور)",
        baseUrl: PROVIDER_DEFAULT_URLS.groq,
        useServerEnv: true,
        envVarName: "GROQ_API_KEY",
        enabled: true,
        lastSyncedAt: null,
        lastTestStatus: process.env.GROQ_API_KEY ? "ok" : "untested",
        lastTestMessage: process.env.GROQ_API_KEY
          ? "متصل از طریق متغیر محیطی GROQ_API_KEY"
          : "در صورت تعریف GROQ_API_KEY در سرور فعال می‌شود",
        models: [...DEFAULT_GROQ_MODELS],
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
    const parsed = JSON.parse(raw) as StoredRouterConfig;
    if (!Array.isArray(parsed.providers) || !parsed.agentRoutes) {
      throw new Error("invalid router config");
    }
    // Strip any legacy stored plaintext apiKey field and enforce server-side envVarName
    const sanitizedProviders: StoredProviderAccount[] = parsed.providers.map((p) => {
      const envVarName = p.envVarName || PROVIDER_ENV_VARS[p.kind] || "GEMINI_API_KEY";
      return {
        id: p.id,
        kind: p.kind,
        name: p.name,
        baseUrl: p.baseUrl,
        useServerEnv: true,
        envVarName,
        enabled: p.enabled,
        lastSyncedAt: p.lastSyncedAt,
        lastTestStatus: p.lastTestStatus,
        lastTestMessage: p.lastTestMessage,
        models: Array.isArray(p.models) ? p.models : [],
      };
    });
    return {
      providers: sanitizedProviders,
      agentRoutes: parsed.agentRoutes,
      updatedAt: parsed.updatedAt,
    };
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

function resolveProviderKey(p: StoredProviderAccount): string {
  const envName = p.envVarName || PROVIDER_ENV_VARS[p.kind];
  if (!envName) return "";
  return (process.env[envName] || "").trim();
}

export function toPublicRouterConfig(cfg?: StoredRouterConfig): RouterConfigPublic {
  const stored = cfg ?? ensureStoredConfig();
  return {
    providers: stored.providers.map((p) => {
      const envName = p.envVarName || PROVIDER_ENV_VARS[p.kind];
      const effectiveKey = resolveProviderKey(p);
      return {
        id: p.id,
        kind: p.kind,
        name: p.name,
        baseUrl: p.baseUrl,
        useServerEnv: true,
        envVarName: envName,
        hasApiKey: Boolean(effectiveKey),
        maskedKey: effectiveKey ? `متصل (${envName})` : `تنظیم‌نشده در سرور (${envName})`,
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

export function toggleProviderEnabledServer(
  providerId: string,
  enabled: boolean
): RouterConfigPublic {
  const cfg = ensureStoredConfig();
  const prov = cfg.providers.find((p) => p.id === providerId);
  if (!prov) throw new Error("سرویس‌دهنده یافت نشد.");
  prov.enabled = enabled;
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
      isFree: isFree ?? true,
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 15000
): Promise<Response> {
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
    throw new Error(`متغیر محیطی ${provider.envVarName} روی سرور تنظیم نشده است.`);
  }

  if (provider.kind === "google") {
    const existingMap = new Map(provider.models.map((m) => [m.id, m]));
    const merged = DEFAULT_GOOGLE_MODELS.map((dm) => existingMap.get(dm.id) ?? dm);
    return {
      models: merged,
      accountNote: `${merged.length} مدل رایگان Gemini آماده سرویس‌دهی در سرور است.`,
    };
  }

  const baseUrl = (provider.baseUrl || PROVIDER_DEFAULT_URLS[provider.kind] || "").replace(
    /\/+$/,
    ""
  );
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
    throw new Error(`خطا در دریافت لیست مدل‌ها (${res.status}): ${errText.slice(0, 160)}`);
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

  return {
    models: normalized,
    accountNote: `${normalized.length} مدل به‌روز از سرویس‌دهنده دریافت شد.`,
  };
}

export async function probeSingleModel(
  provider: StoredProviderAccount,
  modelId: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  const key = resolveProviderKey(provider);
  if (!key) {
    return {
      ok: false,
      latencyMs: 0,
      error: `متغیر ${provider.envVarName} در محیط سرور تعریف نشده است.`,
    };
  }

  try {
    if (provider.kind === "google") {
      const ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      const res = await ai.models.generateContent({
        model: modelId,
        contents: "فقط عدد 1 را برگردان.",
      });
      if (res.text !== undefined) {
        return { ok: true, latencyMs: Date.now() - started };
      }
      return { ok: false, latencyMs: Date.now() - started, error: "پاسخ خالی دریافت شد" };
    }

    const baseUrl = (provider.baseUrl || PROVIDER_DEFAULT_URLS[provider.kind] || "").replace(
      /\/+$/,
      ""
    );
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

    return { ok: true, latencyMs: Date.now() - started };
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
      models.find((m) => m.enabled && m.isFree) || models.find((m) => m.isFree) || models[0];

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
      message: `${models.length} مدل از سرویس دریافت شد.`,
    };
  }

  const freeModels = models.filter((m) => m.isFree);
  const candidates = (freeModels.length > 0 ? freeModels : models).slice(0, 8);

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

  provider.models = models;
  provider.lastSyncedAt = new Date().toISOString();
  provider.lastTestStatus = workingCount > 0 ? "ok" : "error";
  provider.lastTestMessage =
    workingCount > 0
      ? `${workingCount} مدل رایگان پاسخگو شناسایی و فعال شد.`
      : `لیست دریافت شد (${models.length} مدل).`;

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
    throw new Error("هیچ سرویس‌دهنده فعالی در محیط سرور یافت نشد. متغیر GEMINI_API_KEY را در تنظیمات سرور بررسی کنید.");
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

      const baseUrl = (provider.baseUrl || PROVIDER_DEFAULT_URLS[provider.kind] || "").replace(
        /\/+$/,
        ""
      );
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
          ? `\n\nCRITICAL: Return ONLY a valid JSON object containing these exact keys: ${params.expectedKeys.join(
              ", "
            )}. No markdown fences or extra commentary.`
          : "\n\nCRITICAL: Return ONLY valid JSON with no markdown fences.";

      const bodyPayload: Record<string, unknown> = {
        model: target.modelId,
        messages: [
          ...(params.systemInstruction
            ? [{ role: "system", content: `${params.systemInstruction}${jsonGuide}` }]
            : [{ role: "system", content: `You are a Persian content studio AI.${jsonGuide}` }]),
          { role: "user", content: params.prompt },
        ],
      };
      if (!params.expectArray) {
        bodyPayload.response_format = { type: "json_object" };
      }

      let res = await fetchWithTimeout(
        `${baseUrl}/chat/completions`,
        { method: "POST", headers, body: JSON.stringify(bodyPayload) },
        60000
      );

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
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (!envKey) {
    throw new Error("کلید محیطی GEMINI_API_KEY در بخش Settings > Secrets سرور تنظیم نشده است.");
  }
  return envKey;
}
