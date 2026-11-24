import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  AgentRouteTarget,
  GovernanceTaskRole,
  ModelGovernanceRule,
  RouterConfigPublic,
  RouterFailoverEvent,
  RouterModelEntry,
  RouterProviderAccount,
  RouterProviderKind,
  StudioAgentId,
} from "../src/types/studio.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const ROUTER_CONFIG_FILE = path.join(DATA_DIR, "router_config.json");
const ROUTER_LEDGER_FILE = path.join(DATA_DIR, "router_quota_ledger.json");

interface StoredProviderAccount
  extends Omit<
    RouterProviderAccount,
    | "hasApiKey"
    | "maskedKey"
    | "requestsToday"
    | "tokensToday"
    | "cooldownUntil"
    | "cooldownReasonFa"
  > {
  envVarName: string;
  dailyRequestLimit: number;
  dailyTokenBudget: number;
}

interface StoredRouterConfig {
  providers: StoredProviderAccount[];
  agentRoutes: Record<StudioAgentId, AgentRouteTarget[]>;
  updatedAt: string;
}

interface ProviderLedgerEntry {
  requestsToday: number;
  tokensToday: number;
  cooldownUntil: string | null;
  cooldownReasonFa: string | null;
  lastUsedAt: string | null;
  modelCooldowns?: Record<string, { cooldownUntil: string; reasonFa: string }>;
}

interface StoredQuotaLedger {
  dateKey: string;
  entries: Record<string, ProviderLedgerEntry>;
  recentFailovers: RouterFailoverEvent[];
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

const DEPRECATED_OR_FORBIDDEN_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-pro",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-2.0-flash-thinking",
]);

const HEAVY_DEEP_REASONING_MODELS = new Set([
  "gemini-4-neon",
  "gemini-4-carbon",
  "gemini-4-argon",
]);

/**
 * Canonical, code-enforced Model Governance & Anti-Token-Burn Policy.
 * Explicitly declares which model is allowed for each studio role, under what
 * exact condition it may run, and how thinking/retry budgets prevent token burn.
 */
export const MODEL_GOVERNANCE_RULES: ModelGovernanceRule[] = [
  {
    taskRole: "health_probe",
    titleFa: "تست اتصال، پینگ سلامت و کارهای کم‌هزینه",
    primaryModel: "gemini-3.1-flash-lite",
    fallbackModel: null,
    thinkingLevel: "MINIMAL",
    allowedByDefault: true,
    allowedWhenFa:
      "فقط هنگام کلیک دستی کاربر روی «تست ارتباط» یا بازیابی سلامت اکانت (هرگز در لوپ‌های پس‌زمینه اجرا نمی‌شود).",
    antiTokenBurnRuleFa:
      "حالت ThinkingLevel.MINIMAL (صفر توکن تفکر اضافی)، پرامپت زیر ۲۰ کلمه و حداکثر ۱ تلاش روی هر کلید.",
    maxCallsPerProjectStage: 1,
  },
  {
    taskRole: "research_script",
    titleFa: "مرحله ۱ · پژوهش بازار، استراتژی و نگارش سناریو",
    primaryModel: "gemini-4-hydrogen",
    fallbackModel: "gemini-3.5-flash",
    thinkingLevel: "LOW",
    allowedByDefault: true,
    allowedWhenFa:
      "فقط هنگام تحلیل ایده جدید یا بازتولید صریح مرحله ۱ توسط کاربر؛ در صورت خطای سهمیه (429) بین کلیدها و مدل‌های فعال (gemini-3.5-flash و gemini-3.1-flash-lite) چرخش می‌کند.",
    antiTokenBurnRuleFa:
      "سطح تفکر بهینه‌شده روی LOW (جلوگیری از تایم‌اوت و مصرف بی‌رویه) + ۱ فراخوانی ساختاریافته JSON با responseSchema.",
    maxCallsPerProjectStage: 2,
  },
  {
    taskRole: "director",
    titleFa: "مرحله ۲ · دکوپاژ شات‌ها، زمان‌بندی و پلان تدوین DaVinci",
    primaryModel: "gemini-4-hydrogen",
    fallbackModel: "gemini-3.1-flash-lite",
    thinkingLevel: "LOW",
    allowedByDefault: true,
    allowedWhenFa:
      "فقط یک‌بار پس از تایید مرحله ۱ یا درخواست بازتولید صریح کاربر روی دکوپاژ.",
    antiTokenBurnRuleFa:
      "سطح تفکر LOW برای کاهش ۴۰ تا ۶۰ درصدی مصرف توکن در خروجی JSON دکوپاژ.",
    maxCallsPerProjectStage: 2,
  },
  {
    taskRole: "visuals_qa",
    titleFa: "مرحله ۳ · مهندسی پرامپت Image-to-Video و بازبینی ناظر QA",
    primaryModel: "gemini-4-hydrogen",
    fallbackModel: "gemini-3.1-flash-lite",
    thinkingLevel: "LOW",
    allowedByDefault: true,
    allowedWhenFa:
      "فقط برای شات‌هایی که هنوز امتیاز QA >= 9.5 نگرفته‌اند یا کاربر بازسازی شات را زده است.",
    antiTokenBurnRuleFa:
      "حداکثر ۲ دور بازبینی به ازای هر شات، قفل روی ThinkingLevel.LOW و توقف خودکار به‌محض تایید کیفیت.",
    maxCallsPerProjectStage: 2,
  },
  {
    taskRole: "voiceover",
    titleFa: "مرحله ۴ (متن) · تنظیم متن گویندگی فارسی و ریتم خوانش",
    primaryModel: "gemini-4-hydrogen",
    fallbackModel: "gemini-3.1-flash-lite",
    thinkingLevel: "LOW",
    allowedByDefault: true,
    allowedWhenFa:
      "فقط پس از تایید شات‌های ویدیو و ورود به مرحله ۴ (در ویرایش دستی متن توسط کاربر مجدداً مدل متنی صدا زده نمی‌شود).",
    antiTokenBurnRuleFa:
      "سطح تفکر LOW و کش کامل متن تاییدشده در پروژه.",
    maxCallsPerProjectStage: 1,
  },
  {
    taskRole: "tts_audio",
    titleFa: "مرحله ۴ (صدا) · تبدیل متن فارسی نهایی به صوت WAV",
    primaryModel: "gemini-3.8-flash-lite-tts",
    fallbackModel: null,
    thinkingLevel: "NONE",
    allowedByDefault: true,
    allowedWhenFa:
      "فقط پس از نهایی شدن متن نریشن یا کلیک صریح «تولید مجدد صدا»؛ فایل صوتی روی دیسک ذخیره می‌شود.",
    antiTokenBurnRuleFa:
      "چرخش خودکار بین اکانت‌های جیمیل هنگام خطای 429؛ جلوگیری از رندر تکراری صوتی که قبلاً ذخیره شده است.",
    maxCallsPerProjectStage: 1,
  },
  {
    taskRole: "image_keyframe",
    titleFa: "مرحله ۲ · تولید کی‌فریم تصویری استوری‌بورد",
    primaryModel: "gemini-3.1-flash-lite-image",
    fallbackModel: "gemini-nano-banana-2.1",
    thinkingLevel: "NONE",
    allowedByDefault: true,
    allowedWhenFa:
      "فقط برای شات بدون کی‌فریم؛ مدل سنگین‌تر gemini-nano-banana-2.1 فقط در درخواست صریح کاربر برای کیفیت 2K/4K مجاز است.",
    antiTokenBurnRuleFa:
      "شات‌های دارای ویدیو یا کی‌فریم تاییدشده هرگز به‌صورت خودکار بازتولید نمی‌شوند.",
    maxCallsPerProjectStage: 1,
  },
  {
    taskRole: "video_omni",
    titleFa: "مرحله ۳ · تولید ویدیو با Gemini Omni Flash",
    primaryModel: "gemini-omni-1.2-flash",
    fallbackModel: null,
    thinkingLevel: "NONE",
    allowedByDefault: false,
    allowedWhenFa:
      "فقط زمانی مجاز است که کاربر صراحتاً موتور Gemini Omni را انتخاب کرده باشد و کلید Paid فعال باشد؛ در حالت پیش‌فرض از موتور ۰-توکن فیلم زنده HD یا GPU ابری استفاده می‌شود.",
    antiTokenBurnRuleFa:
      "پیش‌فرض سیستم روی موتور بدون مصرف توکن است تا هیچ توکن ویدیویی ناخواسته‌ای مصرف نشود.",
    maxCallsPerProjectStage: 1,
  },
  {
    taskRole: "music_lyria",
    titleFa: "مرحله ۵ · ساخت موسیقی پس‌زمینه مستند با Lyria",
    primaryModel: "lyria-3-clip-preview",
    fallbackModel: null,
    thinkingLevel: "NONE",
    allowedByDefault: true,
    allowedWhenFa:
      "فقط یک‌بار در مرحله ۵ تدوین نهایی و در صورت نبود فایل کش‌شده روی دیسک؛ در غیر این صورت از موزیک محلی ۰-توکن استفاده می‌شود.",
    antiTokenBurnRuleFa:
      "سقف مطلق ۱ کلیپ ۳۰ ثانیه‌ای به ازای هر پروژه و کش دائمی روی دیسک.",
    maxCallsPerProjectStage: 1,
  },
  {
    taskRole: "deep_reasoning",
    titleFa: "مدل‌های سنگین استدلال عمیق (Neon / Carbon / Argon)",
    primaryModel: "gemini-4-neon",
    fallbackModel: "gemini-4-carbon",
    thinkingLevel: "BLOCKED",
    allowedByDefault: false,
    allowedWhenFa:
      "مسدود به‌صورت پیش‌فرض در تمام مراحل تولید محتوا. تنها در صورت فعال‌سازی صریح توسعه‌دهنده برای ممیزی امنیتی یا عیب‌یابی پیچیده مجاز است.",
    antiTokenBurnRuleFa:
      "قفل سخت‌افزاری در کد روتر (`assertModelAllowedForTask`) برای جلوگیری قطعی از توکن‌سوزی سنگین.",
    maxCallsPerProjectStage: 0,
  },
];

const DEFAULT_GOOGLE_MODELS: RouterModelEntry[] = [
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen (اصلی · سناریو، دکوپاژ، QA)",
    isFree: true,
    enabled: true,
    lastTestedOk: null,
    lastLatencyMs: null,
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash (سریع و دقیق · فالبک اصلی)",
    isFree: true,
    enabled: true,
    lastTestedOk: null,
    lastLatencyMs: null,
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite (کم‌مصرف · تست، فالبک سریع)",
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

const AGENT_BROWSER_GOOGLE_SLOTS = Array.from({ length: 10 }, (_, idx) => {
  const num = idx + 1;
  const padded = String(num).padStart(2, "0");
  return {
    id: `google_acct_${num}`,
    envVarName: `GEMINI_API_KEY_${num}`,
    linkedBrowserProfileId: `prof_google_${num}`,
    linkedProfileEmail: `studio.agent.${padded}@gmail.com`,
    name: `اکانت جیمیل ${num} مرورگر ایجنت (Google AI Studio)`,
  };
});

/**
 * Strictly rejects empty, short, or placeholder/mock API keys.
 * Guarantees the router NEVER uses fake or mock keys.
 */
export function isValidNonMockApiKey(rawKey: string | undefined | null): boolean {
  if (typeof rawKey !== "string") return false;
  const key = rawKey.trim();
  if (key.length < 20) return false;
  if (
    /^(mock|fake|demo|test|dummy|placeholder|your[_-]|changeme|replace[_-]|sample|example|none|null|undefined|xxxx|0000|12345)/i.test(
      key
    )
  ) {
    return false;
  }
  if (/mock|fake|dummy|placeholder|your_api_key/i.test(key)) {
    return false;
  }
  return true;
}

export function isQuotaOrRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  );
}

export function isTransientOverloadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("500") ||
    msg.includes("internal error")
  );
}

export function isInvalidKeyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("api_key_invalid") ||
    msg.includes("api key not valid") ||
    msg.includes("permission_denied") ||
    msg.includes("403") ||
    msg.includes("401")
  );
}

/**
 * Enforces the Anti-Token-Burn Model Governance policy before any model call.
 */
export function assertModelAllowedForTask(params: {
  modelId: string;
  taskRole: GovernanceTaskRole;
  allowDeepReasoningOverride?: boolean;
}): void {
  const clean = params.modelId.trim().toLowerCase();
  if (DEPRECATED_OR_FORBIDDEN_MODELS.has(clean)) {
    throw new Error(
      `مدل منسوخ‌شده «${params.modelId}» طبق قوانین سیستم مسدود است. فقط مدل‌های فعال (gemini-4-hydrogen / gemini-3.1-flash-lite) مجاز هستند.`
    );
  }
  if (
    HEAVY_DEEP_REASONING_MODELS.has(clean) &&
    !params.allowDeepReasoningOverride
  ) {
    throw new Error(
      `قفل ضد توکن‌سوزی: استفاده از مدل سنگین «${params.modelId}» در نقش «${params.taskRole}» مجاز نیست. از gemini-4-hydrogen یا gemini-3.1-flash-lite استفاده کنید.`
    );
  }
}

export function resolveGovernanceThinkingConfig(
  modelId: string,
  taskRole: GovernanceTaskRole
): { thinkingLevel: ThinkingLevel } | undefined {
  const m = modelId.trim().toLowerCase();
  const rule = MODEL_GOVERNANCE_RULES.find((r) => r.taskRole === taskRole);

  if (m === "gemini-3.1-flash-lite") {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  if (m === "gemini-3.5-flash") {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  if (m === "gemini-4-hydrogen") {
    if (rule?.thinkingLevel === "MEDIUM") {
      return { thinkingLevel: ThinkingLevel.MEDIUM };
    }
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}

function getTodayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyLedger(): StoredQuotaLedger {
  return {
    dateKey: getTodayUtcKey(),
    entries: {},
    recentFailovers: [],
    updatedAt: new Date().toISOString(),
  };
}

function loadQuotaLedger(): StoredQuotaLedger {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const today = getTodayUtcKey();
  if (!fs.existsSync(ROUTER_LEDGER_FILE)) {
    const fresh = createEmptyLedger();
    fs.writeFileSync(ROUTER_LEDGER_FILE, JSON.stringify(fresh, null, 2), "utf-8");
    return fresh;
  }
  try {
    const raw = fs.readFileSync(ROUTER_LEDGER_FILE, "utf-8");
    const parsed = JSON.parse(raw) as StoredQuotaLedger;
    if (!parsed || typeof parsed !== "object" || !parsed.entries) {
      throw new Error("invalid ledger");
    }
    if (parsed.dateKey !== today) {
      // Automatic UTC daily reset while keeping recent failover log trimmed
      const rolled: StoredQuotaLedger = {
        dateKey: today,
        entries: {},
        recentFailovers: Array.isArray(parsed.recentFailovers)
          ? parsed.recentFailovers.slice(0, 15)
          : [],
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(ROUTER_LEDGER_FILE, JSON.stringify(rolled, null, 2), "utf-8");
      return rolled;
    }
    return parsed;
  } catch {
    const fresh = createEmptyLedger();
    fs.writeFileSync(ROUTER_LEDGER_FILE, JSON.stringify(fresh, null, 2), "utf-8");
    return fresh;
  }
}

function saveQuotaLedger(ledger: StoredQuotaLedger): StoredQuotaLedger {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const next: StoredQuotaLedger = {
    ...ledger,
    recentFailovers: (ledger.recentFailovers || []).slice(0, 40),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(ROUTER_LEDGER_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function getLedgerEntry(ledger: StoredQuotaLedger, providerId: string): ProviderLedgerEntry {
  if (!ledger.entries[providerId]) {
    ledger.entries[providerId] = {
      requestsToday: 0,
      tokensToday: 0,
      cooldownUntil: null,
      cooldownReasonFa: null,
      lastUsedAt: null,
      modelCooldowns: {},
    };
  }
  if (!ledger.entries[providerId].modelCooldowns) {
    ledger.entries[providerId].modelCooldowns = {};
  }
  return ledger.entries[providerId];
}

function isProviderInCooldown(entry: ProviderLedgerEntry, modelId?: string): boolean {
  if (entry.cooldownUntil) {
    const untilMs = Date.parse(entry.cooldownUntil);
    if (Number.isFinite(untilMs) && untilMs > Date.now()) return true;
  }
  if (modelId && entry.modelCooldowns?.[modelId]?.cooldownUntil) {
    const mUntilMs = Date.parse(entry.modelCooldowns[modelId].cooldownUntil);
    if (Number.isFinite(mUntilMs) && mUntilMs > Date.now()) return true;
  }
  return false;
}

function resolveProviderKey(p: StoredProviderAccount): string {
  const envName = p.envVarName || PROVIDER_ENV_VARS[p.kind];
  if (!envName) return "";
  const candidate = (process.env[envName] || "").trim();
  return isValidNonMockApiKey(candidate) ? candidate : "";
}

function createDefaultGoogleAccountProviders(): StoredProviderAccount[] {
  return AGENT_BROWSER_GOOGLE_SLOTS.map((slot) => {
    const validKey = isValidNonMockApiKey(process.env[slot.envVarName]);
    return {
      id: slot.id,
      kind: "google",
      name: slot.name,
      baseUrl: PROVIDER_DEFAULT_URLS.google,
      useServerEnv: true,
      envVarName: slot.envVarName,
      linkedBrowserProfileId: slot.linkedBrowserProfileId,
      linkedProfileEmail: slot.linkedProfileEmail,
      enabled: true,
      lastSyncedAt: null,
      lastTestStatus: validKey ? "ok" : "untested",
      lastTestMessage: validKey
        ? `کلید واقعی از متغیر سرور ${slot.envVarName} متصل و آماده چرخش است`
        : `در انتظار ثبت کلید واقعی این اکانت در Settings > Secrets با نام ${slot.envVarName}`,
      dailyRequestLimit: 250,
      dailyTokenBudget: 400_000,
      models: DEFAULT_GOOGLE_MODELS.map((m) => ({ ...m })),
    };
  });
}

function createDefaultStoredConfig(): StoredRouterConfig {
  const googleAcctProviders = createDefaultGoogleAccountProviders();
  const hasDefaultKey = isValidNonMockApiKey(process.env.GEMINI_API_KEY);

  const defaultStudioProvider: StoredProviderAccount = {
    id: "google_default",
    kind: "google",
    name: "Google AI Studio (کلید اصلی سرور GEMINI_API_KEY)",
    baseUrl: PROVIDER_DEFAULT_URLS.google,
    useServerEnv: true,
    envVarName: "GEMINI_API_KEY",
    linkedBrowserProfileId: null,
    linkedProfileEmail: null,
    enabled: true,
    lastSyncedAt: null,
    lastTestStatus: hasDefaultKey ? "ok" : "untested",
    lastTestMessage: hasDefaultKey
      ? "متصل به کلید واقعی GEMINI_API_KEY در محیط سرور"
      : "کلید GEMINI_API_KEY در محیط سرور تنظیم نشده است",
    dailyRequestLimit: 500,
    dailyTokenBudget: 1_000_000,
    models: DEFAULT_GOOGLE_MODELS.map((m) => ({ ...m })),
  };

  const defaultTargets: AgentRouteTarget[] = [
    { providerId: "google_acct_1", modelId: "gemini-4-hydrogen" },
    { providerId: "google_default", modelId: "gemini-4-hydrogen" },
    { providerId: "google_default", modelId: "gemini-3.5-flash" },
    { providerId: "google_default", modelId: "gemini-3.1-flash-lite" },
  ];

  return {
    providers: [
      ...googleAcctProviders,
      defaultStudioProvider,
      {
        id: "openrouter_env",
        kind: "openrouter",
        name: "OpenRouter Free Models (محیط سرور)",
        baseUrl: PROVIDER_DEFAULT_URLS.openrouter,
        useServerEnv: true,
        envVarName: "OPENROUTER_API_KEY",
        linkedBrowserProfileId: null,
        linkedProfileEmail: null,
        enabled: true,
        lastSyncedAt: null,
        lastTestStatus: isValidNonMockApiKey(process.env.OPENROUTER_API_KEY) ? "ok" : "untested",
        lastTestMessage: isValidNonMockApiKey(process.env.OPENROUTER_API_KEY)
          ? "متصل از طریق متغیر محیطی OPENROUTER_API_KEY"
          : "در صورت تعریف OPENROUTER_API_KEY در سرور به زنجیره فالبک اضافه می‌شود",
        dailyRequestLimit: 200,
        dailyTokenBudget: 500_000,
        models: DEFAULT_OPENROUTER_FREE_MODELS.map((m) => ({ ...m })),
      },
      {
        id: "groq_env",
        kind: "groq",
        name: "Groq Ultra-Fast Free Tier (محیط سرور)",
        baseUrl: PROVIDER_DEFAULT_URLS.groq,
        useServerEnv: true,
        envVarName: "GROQ_API_KEY",
        linkedBrowserProfileId: null,
        linkedProfileEmail: null,
        enabled: true,
        lastSyncedAt: null,
        lastTestStatus: isValidNonMockApiKey(process.env.GROQ_API_KEY) ? "ok" : "untested",
        lastTestMessage: isValidNonMockApiKey(process.env.GROQ_API_KEY)
          ? "متصل از طریق متغیر محیطی GROQ_API_KEY"
          : "در صورت تعریف GROQ_API_KEY در سرور فعال می‌شود",
        dailyRequestLimit: 300,
        dailyTokenBudget: 500_000,
        models: DEFAULT_GROQ_MODELS.map((m) => ({ ...m })),
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

    // Strip any legacy plaintext apiKey fields & ensure all 10 Agent Browser Google slots exist
    const existingById = new Map<string, StoredProviderAccount>();
    for (const p of parsed.providers) {
      const envVarName = p.envVarName || PROVIDER_ENV_VARS[p.kind] || "GEMINI_API_KEY";
      existingById.set(p.id, {
        id: p.id,
        kind: p.kind,
        name: p.name,
        baseUrl: p.baseUrl || PROVIDER_DEFAULT_URLS[p.kind] || "",
        useServerEnv: true,
        envVarName,
        linkedBrowserProfileId: p.linkedBrowserProfileId ?? null,
        linkedProfileEmail: p.linkedProfileEmail ?? null,
        enabled: typeof p.enabled === "boolean" ? p.enabled : true,
        lastSyncedAt: p.lastSyncedAt ?? null,
        lastTestStatus: p.lastTestStatus ?? "untested",
        lastTestMessage: p.lastTestMessage ?? null,
        dailyRequestLimit: Number.isFinite(p.dailyRequestLimit) ? p.dailyRequestLimit : 250,
        dailyTokenBudget: Number.isFinite(p.dailyTokenBudget) ? p.dailyTokenBudget : 400_000,
        models:
          Array.isArray(p.models) && p.models.length > 0
            ? p.models.filter((m) => !DEPRECATED_OR_FORBIDDEN_MODELS.has(m.id.toLowerCase()))
            : p.kind === "google"
              ? DEFAULT_GOOGLE_MODELS.map((m) => ({ ...m }))
              : [],
      });
    }

    const defaults = createDefaultStoredConfig();
    let mutated = false;
    const mergedProviders: StoredProviderAccount[] = [];

    // Ensure all 10 Gmail slots + default studio + openrouter + groq are present in canonical order
    for (const defProv of defaults.providers) {
      const existing = existingById.get(defProv.id);
      if (existing) {
        mergedProviders.push({
          ...defProv,
          ...existing,
          envVarName: defProv.envVarName,
          linkedBrowserProfileId:
            existing.linkedBrowserProfileId ?? defProv.linkedBrowserProfileId,
          linkedProfileEmail: existing.linkedProfileEmail ?? defProv.linkedProfileEmail,
        });
        existingById.delete(defProv.id);
      } else {
        mergedProviders.push(defProv);
        mutated = true;
      }
    }

    // Preserve any additional custom server-env providers
    for (const leftover of existingById.values()) {
      mergedProviders.push(leftover);
    }

    const nextConfig: StoredRouterConfig = {
      providers: mergedProviders,
      agentRoutes: parsed.agentRoutes,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };

    if (mutated) {
      fs.writeFileSync(ROUTER_CONFIG_FILE, JSON.stringify(nextConfig, null, 2), "utf-8");
    }
    return nextConfig;
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

export function toPublicRouterConfig(cfg?: StoredRouterConfig): RouterConfigPublic {
  const stored = cfg ?? ensureStoredConfig();
  const ledger = loadQuotaLedger();

  const googleProviders = stored.providers.filter((p) => p.kind === "google");
  const distinctRealGoogleKeyHashes = new Set<string>();
  let totalRequestsToday = 0;
  let totalTokensToday = 0;

  const publicProviders: RouterProviderAccount[] = stored.providers.map((p) => {
    const envName = p.envVarName || PROVIDER_ENV_VARS[p.kind];
    const effectiveKey = resolveProviderKey(p);
    const entry = getLedgerEntry(ledger, p.id);
    const inCooldown = isProviderInCooldown(entry);

    if (p.kind === "google" && effectiveKey) {
      const hash = crypto.createHash("sha256").update(effectiveKey).digest("hex");
      distinctRealGoogleKeyHashes.add(hash);
    }
    totalRequestsToday += entry.requestsToday;
    totalTokensToday += entry.tokensToday;

    return {
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      useServerEnv: true,
      envVarName: envName,
      linkedBrowserProfileId: p.linkedBrowserProfileId ?? null,
      linkedProfileEmail: p.linkedProfileEmail ?? null,
      hasApiKey: Boolean(effectiveKey),
      maskedKey: effectiveKey
        ? `کلید واقعی متصل (${envName})`
        : `تنظیم‌نشده در Settings > Secrets (${envName})`,
      enabled: p.enabled,
      lastSyncedAt: p.lastSyncedAt,
      lastTestStatus: effectiveKey ? p.lastTestStatus : "untested",
      lastTestMessage: p.lastTestMessage,
      requestsToday: entry.requestsToday,
      dailyRequestLimit: p.dailyRequestLimit,
      tokensToday: entry.tokensToday,
      dailyTokenBudget: p.dailyTokenBudget,
      cooldownUntil: inCooldown ? entry.cooldownUntil : null,
      cooldownReasonFa: inCooldown ? entry.cooldownReasonFa : null,
      models: p.models,
    };
  });

  return {
    providers: publicProviders,
    agentRoutes: stored.agentRoutes,
    governancePolicy: MODEL_GOVERNANCE_RULES,
    quotaSummary: {
      dateKey: ledger.dateKey,
      activeRealGoogleKeyCount: distinctRealGoogleKeyHashes.size,
      totalConfiguredGoogleSlots: googleProviders.length,
      totalRequestsToday,
      totalTokensToday,
      failoverCountToday: ledger.recentFailovers.filter((f) =>
        f.timestamp.startsWith(ledger.dateKey)
      ).length,
      strictNoMockEnforced: true,
      recentFailovers: ledger.recentFailovers.slice(0, 15),
    },
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

export function updateProviderSettingsServer(
  providerId: string,
  patch: {
    name?: string;
    enabled?: boolean;
    dailyRequestLimit?: number;
    dailyTokenBudget?: number;
    linkedProfileEmail?: string | null;
  }
): RouterConfigPublic {
  const cfg = ensureStoredConfig();
  const prov = cfg.providers.find((p) => p.id === providerId);
  if (!prov) throw new Error("سرویس‌دهنده یافت نشد.");
  if (typeof patch.name === "string" && patch.name.trim()) {
    prov.name = patch.name.trim().slice(0, 120);
  }
  if (typeof patch.enabled === "boolean") {
    prov.enabled = patch.enabled;
  }
  if (
    typeof patch.dailyRequestLimit === "number" &&
    Number.isFinite(patch.dailyRequestLimit) &&
    patch.dailyRequestLimit >= 5 &&
    patch.dailyRequestLimit <= 10_000
  ) {
    prov.dailyRequestLimit = Math.round(patch.dailyRequestLimit);
  }
  if (
    typeof patch.dailyTokenBudget === "number" &&
    Number.isFinite(patch.dailyTokenBudget) &&
    patch.dailyTokenBudget >= 10_000 &&
    patch.dailyTokenBudget <= 20_000_000
  ) {
    prov.dailyTokenBudget = Math.round(patch.dailyTokenBudget);
  }
  if (typeof patch.linkedProfileEmail === "string" || patch.linkedProfileEmail === null) {
    prov.linkedProfileEmail = patch.linkedProfileEmail;
  }
  return toPublicRouterConfig(saveStoredConfig(cfg));
}

export function resetRouterCooldowns(providerId?: string): RouterConfigPublic {
  const ledger = loadQuotaLedger();
  if (providerId) {
    const entry = getLedgerEntry(ledger, providerId);
    entry.cooldownUntil = null;
    entry.cooldownReasonFa = null;
    entry.modelCooldowns = {};
  } else {
    for (const entry of Object.values(ledger.entries)) {
      entry.cooldownUntil = null;
      entry.cooldownReasonFa = null;
      entry.modelCooldowns = {};
    }
  }
  saveQuotaLedger(ledger);
  return toPublicRouterConfig();
}

export function syncBrowserProfilesIntoRouter(
  profiles: Array<{ id: string; name: string; email: string }>
): RouterConfigPublic {
  const cfg = ensureStoredConfig();
  let changed = false;
  for (let i = 0; i < profiles.length; i++) {
    const prof = profiles[i];
    const match =
      cfg.providers.find((p) => p.linkedBrowserProfileId === prof.id) ||
      cfg.providers.find((p) => p.id === `google_acct_${i + 1}`);
    if (match) {
      if (match.linkedProfileEmail !== prof.email) {
        match.linkedProfileEmail = prof.email;
        changed = true;
      }
      if (!match.linkedBrowserProfileId) {
        match.linkedBrowserProfileId = prof.id;
        changed = true;
      }
    }
  }
  return toPublicRouterConfig(changed ? saveStoredConfig(cfg) : cfg);
}

export function toggleProviderModel(
  providerId: string,
  modelId: string,
  enabled: boolean
): RouterConfigPublic {
  if (enabled && DEPRECATED_OR_FORBIDDEN_MODELS.has(modelId.trim().toLowerCase())) {
    throw new Error(`مدل منسوخ «${modelId}» قابل فعال‌سازی نیست.`);
  }
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
      isFree: modelId.includes(":free") || provider.kind === "google",
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
  const cleanId = modelId.trim();
  if (!cleanId) throw new Error("شناسه مدل نمی‌تواند خالی باشد.");
  if (DEPRECATED_OR_FORBIDDEN_MODELS.has(cleanId.toLowerCase())) {
    throw new Error(`مدل منسوخ «${cleanId}» توسط سیاست ضدخطای روتر مسدود است.`);
  }

  const cfg = ensureStoredConfig();
  const provider = cfg.providers.find((p) => p.id === providerId);
  if (!provider) throw new Error("سرویس‌دهنده یافت نشد.");

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
    if (DEPRECATED_OR_FORBIDDEN_MODELS.has(t.modelId.trim().toLowerCase())) continue;
    const key = `${t.providerId}::${t.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ providerId: t.providerId, modelId: t.modelId });
  }
  cfg.agentRoutes[agentId] = cleaned;
  return toPublicRouterConfig(saveStoredConfig(cfg));
}

interface ActiveGoogleKeyCandidate {
  provider: StoredProviderAccount;
  apiKey: string;
  keyFingerprint: string;
  inCooldown: boolean;
  overBudget: boolean;
  cooldownUntilMs: number;
}

/**
 * Returns the ordered, deduplicated pool of real, non-mock Google AI Studio keys
 * across all 10 Agent Browser Gmail slots (`GEMINI_API_KEY_1..10`) + `GEMINI_API_KEY`.
 */
export function getActiveGoogleKeyPool(preferredProviderId?: string): ActiveGoogleKeyCandidate[] {
  const cfg = ensureStoredConfig();
  const ledger = loadQuotaLedger();
  const googleProviders = cfg.providers.filter((p) => p.kind === "google" && p.enabled);

  // Put preferred provider first if specified, then google_acct_1..10, then google_default
  const ordered = [...googleProviders].sort((a, b) => {
    if (preferredProviderId) {
      if (a.id === preferredProviderId) return -1;
      if (b.id === preferredProviderId) return 1;
    }
    const aIsAcct = a.id.startsWith("google_acct_");
    const bIsAcct = b.id.startsWith("google_acct_");
    if (aIsAcct && !bIsAcct) return -1;
    if (!aIsAcct && bIsAcct) return 1;
    return 0;
  });

  const seenFingerprints = new Set<string>();
  const candidates: ActiveGoogleKeyCandidate[] = [];

  for (const prov of ordered) {
    const key = resolveProviderKey(prov);
    if (!key) continue;
    const fp = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
    if (seenFingerprints.has(fp)) continue;
    seenFingerprints.add(fp);

    const entry = getLedgerEntry(ledger, prov.id);
    const inCooldown = isProviderInCooldown(entry);
    const overBudget =
      entry.requestsToday >= prov.dailyRequestLimit ||
      entry.tokensToday >= prov.dailyTokenBudget;
    const cooldownUntilMs = entry.cooldownUntil ? Date.parse(entry.cooldownUntil) || 0 : 0;

    candidates.push({
      provider: prov,
      apiKey: key,
      keyFingerprint: fp,
      inCooldown,
      overBudget,
      cooldownUntilMs,
    });
  }

  // Healthy + under-budget accounts first; cooling/over-budget last (sorted by earliest cooldown expiry)
  return candidates.sort((a, b) => {
    const aHealthy = !a.inCooldown && !a.overBudget ? 0 : 1;
    const bHealthy = !b.inCooldown && !b.overBudget ? 0 : 1;
    if (aHealthy !== bHealthy) return aHealthy - bHealthy;
    return a.cooldownUntilMs - b.cooldownUntilMs;
  });
}

function recordSuccessfulGoogleCall(params: {
  providerId: string;
  modelId?: string;
  tokensUsed?: number;
}): void {
  const ledger = loadQuotaLedger();
  const entry = getLedgerEntry(ledger, params.providerId);
  entry.requestsToday += 1;
  if (typeof params.tokensUsed === "number" && Number.isFinite(params.tokensUsed) && params.tokensUsed > 0) {
    entry.tokensToday += Math.round(params.tokensUsed);
  }
  entry.cooldownUntil = null;
  entry.cooldownReasonFa = null;
  if (params.modelId && entry.modelCooldowns?.[params.modelId]) {
    delete entry.modelCooldowns[params.modelId];
  }
  entry.lastUsedAt = new Date().toISOString();
  saveQuotaLedger(ledger);
}

function markGoogleAccountCooldownAndFailover(params: {
  providerId: string;
  nextProviderId: string | null;
  taskRole: string;
  modelId: string;
  error: unknown;
}): void {
  const ledger = loadQuotaLedger();
  const entry = getLedgerEntry(ledger, params.providerId);
  const rawMsg = params.error instanceof Error ? params.error.message : String(params.error);

  let cooldownMs = 90_000; // 90 seconds for per-minute RPM rate limits
  let reasonFa = `محدودیت نرخ لحظه‌ای روی ${params.modelId} (429) — جابه‌جایی به مدل/اکانت بعدی`;

  if (/per\s*day|daily|rpd/i.test(rawMsg)) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 2, 0, 0);
    cooldownMs = Math.max(300_000, tomorrow.getTime() - Date.now());
    reasonFa = `اتمام سهمیه روزانه مدل ${params.modelId} — جابه‌جایی خودکار به مدل/اکانت بعدی`;
  } else if (isInvalidKeyError(params.error)) {
    cooldownMs = 15 * 60_000;
    reasonFa = "کلید نامعتبر یا فاقد دسترسی (401/403) — کنارگذاری موقت و انتقال به اکانت بعدی";
  }

  const untilIso = new Date(Date.now() + cooldownMs).toISOString();
  if (isInvalidKeyError(params.error)) {
    entry.cooldownUntil = untilIso;
    entry.cooldownReasonFa = reasonFa;
  } else {
    // Scope rate/daily 429 cooldowns to the specific modelId so other active models (e.g. gemini-3.5-flash / tts) remain usable!
    entry.modelCooldowns = entry.modelCooldowns || {};
    entry.modelCooldowns[params.modelId] = { cooldownUntil: untilIso, reasonFa };
  }

  if (params.nextProviderId && params.nextProviderId !== params.providerId) {
    ledger.recentFailovers.unshift({
      id: `fo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      taskRole: params.taskRole,
      fromProviderId: params.providerId,
      toProviderId: params.nextProviderId,
      modelId: params.modelId,
      reasonFa,
    });
  }
  saveQuotaLedger(ledger);
}

function extractTotalTokensFromResult(res: unknown): number {
  if (!res || typeof res !== "object") return 0;
  const r = res as {
    usageMetadata?: {
      totalTokenCount?: number;
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  if (typeof r.usageMetadata?.totalTokenCount === "number") {
    return r.usageMetadata.totalTokenCount;
  }
  const p = r.usageMetadata?.promptTokenCount || 0;
  const c = r.usageMetadata?.candidatesTokenCount || 0;
  return p + c;
}

/**
 * Centralized Multi-Account Google AI Failover Executor.
 * Automatically rotates across GEMINI_API_KEY_1..10 + GEMINI_API_KEY whenever any account hits
 * 429 / RESOURCE_EXHAUSTED / quota / invalid-key errors, while enforcing anti-token-burn rules
 * and persisting daily token/request counters to disk.
 */
function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout after ${Math.round(timeoutMs / 1000)}s waiting for ${label}`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function executeWithGoogleKeyFailover<T>(
  options: {
    taskRole: GovernanceTaskRole;
    modelId: string;
    apiVersion?: "v1beta" | "v1alpha" | "v1";
    preferredProviderId?: string;
    allowDeepReasoningOverride?: boolean;
    timeoutMs?: number;
  },
  executor: (ai: GoogleGenAI, meta: { providerId: string; providerName: string; envVarName: string }) => Promise<T>
): Promise<{
  result: T;
  usedProviderId: string;
  usedProviderName: string;
  usedEnvVarName: string;
  usedModel: string;
  failoversTriggered: number;
}> {
  assertModelAllowedForTask({
    modelId: options.modelId,
    taskRole: options.taskRole,
    allowDeepReasoningOverride: options.allowDeepReasoningOverride,
  });

  const pool = getActiveGoogleKeyPool(options.preferredProviderId);
  if (pool.length === 0) {
    throw new Error(
      "هیچ کلید واقعی Google AI Studio در سرور ثبت نشده است (استفاده از کلید موک/فرضی مسدود است). لطفاً کلیدهای اکانت‌های جیمیل را در Settings > Secrets با نام‌های GEMINI_API_KEY و GEMINI_API_KEY_1 تا GEMINI_API_KEY_10 تنظیم کنید."
    );
  }

  const apiVersion = options.apiVersion ?? "v1beta";
  const defaultTimeoutMs =
    options.timeoutMs ??
    (options.modelId === "gemini-4-hydrogen"
      ? 28000
      : options.taskRole === "image_keyframe"
        ? 25000
        : options.taskRole === "tts_audio" ||
            options.taskRole === "video_omni" ||
            options.taskRole === "music_lyria"
          ? 90000
          : 45000);
  const errors: string[] = [];
  let failoversTriggered = 0;

  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[i];
    const nextCandidate = pool[i + 1] ?? null;
    const ai = new GoogleGenAI({
      apiKey: candidate.apiKey,
      apiVersion,
      httpOptions: {
        apiVersion,
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      try {
        const result = await runWithTimeout(
          executor(ai, {
            providerId: candidate.provider.id,
            providerName: candidate.provider.name,
            envVarName: candidate.provider.envVarName,
          }),
          defaultTimeoutMs,
          `${options.modelId} (${candidate.provider.envVarName})`
        );
        const tokensUsed = extractTotalTokensFromResult(result);
        recordSuccessfulGoogleCall({
          providerId: candidate.provider.id,
          modelId: options.modelId,
          tokensUsed,
        });
        return {
          result,
          usedProviderId: candidate.provider.id,
          usedProviderName: candidate.provider.name,
          usedEnvVarName: candidate.provider.envVarName,
          usedModel: options.modelId,
          failoversTriggered,
        };
      } catch (err) {
        if (attempt === 1 && isTransientOverloadError(err)) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${candidate.provider.envVarName}: ${msg.slice(0, 140)}`);

        if (isQuotaOrRateLimitError(err) || isInvalidKeyError(err)) {
          markGoogleAccountCooldownAndFailover({
            providerId: candidate.provider.id,
            nextProviderId: nextCandidate?.provider.id ?? null,
            taskRole: options.taskRole,
            modelId: options.modelId,
            error: err,
          });
          if (nextCandidate) {
            failoversTriggered += 1;
            break;
          }
        }
        // For non-quota errors (e.g., invalid request schema or 404 model), don't burn through all 10 accounts
        if (!isQuotaOrRateLimitError(err) && !isInvalidKeyError(err)) {
          throw err;
        }
        break;
      }
    }
  }

  throw new Error(
    `سهمیه تمام ${pool.length} کلید فعال Google AI Studio برای مدل ${options.modelId} موقتاً تکمیل شده است:\n${errors.join("\n")}`
  );
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
    throw new Error(
      `کلید واقعی در متغیر محیطی ${provider.envVarName} روی سرور تنظیم نشده است.`
    );
  }

  if (provider.kind === "google") {
    const existingMap = new Map(provider.models.map((m) => [m.id, m]));
    const merged = DEFAULT_GOOGLE_MODELS.map((dm) => existingMap.get(dm.id) ?? { ...dm });
    return {
      models: merged,
      accountNote: `${merged.length} مدل مجاز و بهینه Gemini روی کلید ${provider.envVarName} آماده سرویس‌دهی است.`,
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
      error: `متغیر ${provider.envVarName} با کلید واقعی در سرور تنظیم نشده است.`,
    };
  }

  try {
    if (provider.kind === "google") {
      // Anti-token-burn: always probe with minimal thinking on Flash Lite or low thinking on Hydrogen
      const thinkingConfig = resolveGovernanceThinkingConfig(modelId, "health_probe");
      const ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      const res = await ai.models.generateContent({
        model: modelId,
        contents: "فقط عدد 1 را برگردان.",
        config: thinkingConfig ? ({ thinkingConfig } as never) : undefined,
      });
      if (res.text !== undefined) {
        recordSuccessfulGoogleCall({
          providerId: provider.id,
          tokensUsed: extractTotalTokensFromResult(res),
        });
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
    // Anti-token-burn: prefer lightest model (`gemini-3.1-flash-lite`) for connection probes
    const probeTarget =
      models.find((m) => m.id === "gemini-3.1-flash-lite") ||
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
        ? ` · تست کم‌مصرف ${probeTarget.id} موفق (${probe.latencyMs}ms)`
        : ` · هشدار تست ${probeTarget.id}: ${probe.error}`;
      provider.lastTestStatus = probe.ok ? "ok" : "error";
    } else {
      provider.lastTestStatus = "ok";
    }

    provider.models = models;
    provider.lastSyncedAt = new Date().toISOString();
    provider.lastTestMessage = `${accountNote}${probeNote}`;
    const saved = saveStoredConfig(cfg);
    return {
      ok: provider.lastTestStatus === "ok",
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
  // Anti-token-burn: cap auto-discovery probes to 4 models max
  const candidates = (freeModels.length > 0 ? freeModels : models).slice(0, 4);

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

function mapAgentIdToGovernanceRole(agentId: StudioAgentId): GovernanceTaskRole {
  if (agentId === "research_script") return "research_script";
  if (agentId === "voiceover") return "voiceover";
  if (agentId === "director") return "director";
  return "visuals_qa";
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
  const taskRole = mapAgentIdToGovernanceRole(params.agentId);
  const configuredChain = cfg.agentRoutes[params.agentId] ?? [];

  // Build resilient multi-account chain:
  // 1) Configured agent targets
  // 2) All real Google accounts on gemini-4-hydrogen
  // 3) All real Google accounts on gemini-3.1-flash-lite (low-token fallback)
  // 4) Any enabled OpenRouter / Groq free server-env fallback
  const googlePool = getActiveGoogleKeyPool();
  const expandedGoogleFallback: AgentRouteTarget[] = [
    ...googlePool.map((c) => ({ providerId: c.provider.id, modelId: "gemini-4-hydrogen" })),
    ...googlePool.map((c) => ({ providerId: c.provider.id, modelId: "gemini-3.5-flash" })),
    ...googlePool.map((c) => ({ providerId: c.provider.id, modelId: "gemini-3.1-flash-lite" })),
  ];
  const nonGoogleFallbacks: AgentRouteTarget[] = cfg.providers
    .filter((p) => p.kind !== "google" && p.enabled && Boolean(resolveProviderKey(p)))
    .flatMap((p) =>
      p.models
        .filter((m) => m.enabled)
        .slice(0, 2)
        .map((m) => ({ providerId: p.id, modelId: m.id }))
    );

  const seen = new Set<string>();
  const chain: AgentRouteTarget[] = [];
  for (const t of [...configuredChain, ...expandedGoogleFallback, ...nonGoogleFallbacks]) {
    if (DEPRECATED_OR_FORBIDDEN_MODELS.has(t.modelId.toLowerCase())) continue;
    const provider = cfg.providers.find((p) => p.id === t.providerId);
    if (!provider || !provider.enabled) continue;
    const key = resolveProviderKey(provider);
    if (!key) continue;
    const keyFp = crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
    const dedupKey = `${provider.kind}::${keyFp}::${t.modelId}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    chain.push(t);
  }

  if (chain.length === 0) {
    throw new Error(
      "هیچ کلید واقعی فعالی در محیط سرور یافت نشد (کلید موک/فرضی مجاز نیست). لطفاً GEMINI_API_KEY یا GEMINI_API_KEY_1..10 را در Settings > Secrets تنظیم کنید."
    );
  }

  const errors: string[] = [];

  for (let i = 0; i < chain.length; i++) {
    const target = chain[i];
    const nextTarget = chain[i + 1] ?? null;
    const provider = cfg.providers.find((p) => p.id === target.providerId);
    if (!provider) continue;
    const key = resolveProviderKey(provider);
    if (!key) continue;

    // Skip a (provider, model) target in cooldown only if another target exists later in the chain
    if (provider.kind === "google") {
      const hasFallbackLater = i < chain.length - 1;
      if (hasFallbackLater) {
        const ledger = loadQuotaLedger();
        const entry = getLedgerEntry(ledger, provider.id);
        if (isProviderInCooldown(entry, target.modelId)) {
          continue;
        }
      }
    }

    try {
      if (provider.kind === "google") {
        assertModelAllowedForTask({ modelId: target.modelId, taskRole });
        const ai = new GoogleGenAI({
          apiKey: key,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });
        const config: Record<string, unknown> = {
          responseMimeType: "application/json",
        };
        const thinkingConfig = resolveGovernanceThinkingConfig(target.modelId, taskRole);
        if (thinkingConfig) {
          config.thinkingConfig = thinkingConfig;
        }
        if (params.systemInstruction) {
          config.systemInstruction = params.systemInstruction;
        }
        if (params.googleResponseSchema) {
          config.responseSchema = params.googleResponseSchema;
        }

        const perCallTimeoutMs = taskRole === "director" ? 75000 : 60000;
        const res = await runWithTimeout(
          ai.models.generateContent({
            model: target.modelId,
            contents: params.prompt,
            config: config as never,
          }),
          perCallTimeoutMs,
          `${target.modelId} (${provider.envVarName})`
        );
        const text = extractJsonObject(res.text ?? "");
        const parsed = JSON.parse(text) as T;
        recordSuccessfulGoogleCall({
          providerId: provider.id,
          modelId: target.modelId,
          tokensUsed: extractTotalTokensFromResult(res),
        });
        return { data: parsed, usedProvider: `${provider.name} (${provider.envVarName})`, usedModel: target.modelId };
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
      if (provider.kind === "google" && (isQuotaOrRateLimitError(err) || isInvalidKeyError(err))) {
        markGoogleAccountCooldownAndFailover({
          providerId: provider.id,
          nextProviderId: nextTarget?.providerId ?? null,
          taskRole,
          modelId: target.modelId,
          error: err,
        });
      }
      errors.push(`${provider.envVarName} (${target.modelId}): ${errMsg.slice(0, 120)}`);
    }
  }

  throw new Error(`همه کلیدها و مدل‌های زنجیره روتر با خطا مواجه شدند:\n${errors.join("\n")}`);
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
    // Anti-token-burn: test with tiny deterministic payload
    const res = await executeAgentJsonWithRouter<{ ok: boolean; note: string }>({
      agentId,
      prompt: 'فقط JSON: {"ok": true, "note": "آماده"}',
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

/**
 * Returns the healthiest active real Google AI Studio API key from the pool
 * (GEMINI_API_KEY_1..10 or GEMINI_API_KEY). Strictly refuses mock/placeholder keys.
 */
export function getGoogleApiKeyFromRouter(): string {
  const pool = getActiveGoogleKeyPool();
  if (pool.length === 0) {
    throw new Error(
      "هیچ کلید واقعی Google AI Studio (GEMINI_API_KEY یا GEMINI_API_KEY_1..10) در Settings > Secrets سرور تنظیم نشده است."
    );
  }
  return pool[0].apiKey;
}
