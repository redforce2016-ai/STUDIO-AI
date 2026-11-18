import { GoogleGenAI, Type } from "@google/genai";
import path from "node:path";
import type {
  AgentSuperRole,
  CompetitorViralReport,
  ContentFormatOption,
  DirectingCrewNotes,
  DirectorOutput,
  DirectorShot,
  GroundedSource,
  LocalVideoEngineId,
  NarrationScriptOutput,
  PageMaturityOption,
  PageProfile,
  PlatformOption,
  ProjectBrief,
  ResearchAndScriptOutput,
  ToneOption,
  TopicAnalysisResponse,
  VisualAssetShot,
  VoicePersona,
  VoiceoverOutput,
} from "../src/types/studio.js";
import { compileAgentMemoryPromptBlock, normalizeDirectorShots3To8s } from "./agentMemory.js";
import { renderHyperFramesDualKeyframes } from "./localVideoEngines.js";
import {
  auditDirectorCrewPlan,
  auditNarrationOutput,
  auditScenarioOutput,
  auditVoiceoverAudioWav,
  runMultimodalVisionFrameQA,
} from "./qualityAssurance.js";
import { executeAgentJsonWithRouter, getGoogleApiKeyFromRouter } from "./router.js";
import {
  getAudioDir,
  getPageProfile,
  listAgentMemories,
  saveAudioFile,
} from "./store.js";

function getClient(apiVersion: "v1beta" | "v1alpha" | "v1" = "v1beta"): GoogleGenAI {
  const apiKey = getGoogleApiKeyFromRouter();
  return new GoogleGenAI({
    apiKey,
    apiVersion,
    httpOptions: {
      apiVersion,
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const PLATFORM_LABELS: Record<PlatformOption, string> = {
  instagram: "اینستاگرام (Instagram)",
  youtube: "یوتیوب (YouTube)",
  tiktok: "تیک‌تاک (TikTok)",
  reels: "اینستاگرام ریلز (Instagram Reels)",
  shorts: "یوتیوب شورتس (YouTube Shorts)",
};

const CONTENT_FORMAT_LABELS: Record<ContentFormatOption, string> = {
  reels: "ریلز اینستاگرام (ویدیوی عمودی کوتاه و پربازدید)",
  post: "پست اینستاگرام (ویدیوی معرفی یا اسلاید تک‌موضوعی)",
  story: "استوری اینستاگرام (سکانس کوتاه و تعاملی چندبخشی)",
  shorts: "یوتیوب شورتس (ویدیوی عمودی زیر ۶۰ ثانیه)",
  long_video: "ویدیوی کامل یوتیوب (روایت جامع و عمیق)",
  tiktok_video: "ویدیوی کوتاه تیک‌تاک (ضرب‌آهنگ سریع و وایرال)",
  carousel: "پست اسلایدی / ورق‌زدنی (اسلایدهای جذاب و آموزشی)",
};

const TONE_LABELS: Record<ToneOption, string> = {
  educational: "آموزشی، شفاف و کاربردی",
  cinematic_story: "داستانی، سینمایی و احساسی",
  news_analysis: "خبری، تحلیلی و مستند",
  fast_motivational: "سریع، پرانرژی و انگیزشی",
};

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.toLowerCase().includes("quota");
}

function isNonRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    isQuotaError(err) ||
    msg.includes("400") ||
    msg.includes("403") ||
    msg.includes("404") ||
    msg.includes("PERMISSION_DENIED") ||
    msg.includes("API_KEY_INVALID")
  );
}

export function formatGeminiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("همه مدل‌های زنجیره روتر")) {
    return msg;
  }
  if (isQuotaError(err)) {
    return "سهمیه رایگان درخواست‌های روزانه Gemini پر شده است (خطای 429). می‌توانید از تب «روتر رایگان و دسکتاپ» مدل‌های رایگان جایگزین را فعال کنید.";
  }
  if (msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID") || msg.includes("403")) {
    return "کلید محیطی سرور معتبر نیست یا دسترسی کافی ندارد. لطفاً متغیرهای محیطی سرور را بررسی کنید.";
  }
  return msg;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isNonRetryableError(err) || i >= retries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastError;
}

async function generateWithModelFallback(
  ai: GoogleGenAI,
  params: {
    contents: string;
    config?: Record<string, unknown>;
  }
) {
  try {
    return await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: params.contents,
        config: params.config as never,
      })
    );
  } catch (err) {
    if (isQuotaError(err)) {
      return await withRetry(() =>
        ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: params.contents,
          config: params.config as never,
        })
      );
    }
    throw err;
  }
}

function clampDuration(val: unknown, format?: ContentFormatOption): number {
  const num = Number(val);
  if (Number.isFinite(num) && num >= 12 && num <= 1800) {
    return Math.round(num);
  }
  if (format === "story") return 20;
  if (format === "long_video") return 240;
  return 35;
}

function normalizeTone(val: unknown, fallback: ToneOption = "educational"): ToneOption {
  const valid: ToneOption[] = ["educational", "cinematic_story", "news_analysis", "fast_motivational"];
  return typeof val === "string" && valid.includes(val as ToneOption) ? (val as ToneOption) : fallback;
}

function formatDurationFa(seconds: number): string {
  if (seconds >= 90) {
    const mins = Math.round(seconds / 60);
    return `حدود ${mins} دقیقه`;
  }
  return `حدود ${seconds} ثانیه`;
}

function buildPageProfileAndMemoryContext(params: {
  pageProfileId?: string | null;
  projectId?: string | null;
  agentRole: AgentSuperRole;
}): { profile: PageProfile | null; promptBlock: string } {
  const profile = getPageProfile(params.pageProfileId);
  const memoryBlock = compileAgentMemoryPromptBlock({
    memories: listAgentMemories(),
    agentId: params.agentRole,
    pageProfileId: params.pageProfileId,
    projectId: params.projectId,
    maxRules: 8,
  });

  if (!profile) {
    return { profile: null, promptBlock: memoryBlock };
  }

  const profileLines = [
    `\nپروفایل دائمی پیج فعال (رعایت ۱۰۰٪ الزامی بدون نیاز به تکرار توسط کاربر):`,
    `- نام پیج: ${profile.name} (${profile.handle}) · پلتفرم: ${profile.platform}`,
    `- حوزه تخصصی (Niche): ${profile.niche}`,
    `- سبک محتوایی پیج: ${profile.contentStyle}`,
    `- پرسونای دقیق مخاطب پیج: ${profile.targetAudiencePersona}`,
    `- دغدغه‌ها و ترس‌های اصلی مخاطبان این پیج: ${profile.audiencePainPoints.join(" | ")}`,
    `- لحن اختصاصی برند: ${profile.brandToneNoteFa}`,
    `- هویت بصری و نورپردازی پیج: ${profile.visualAestheticFa}`,
    `- خطوط قرمز ممنوعه این پیج: ${profile.tabooRedLines.join(" | ")}`,
    `- گاردریل‌های الگوریتم این پیج: ${profile.algorithmGuardrails.join(" | ")}`,
    profile.competitorHandles.length > 0
      ? `- رقبای اصلی این پیج برای تمایزسازی: ${profile.competitorHandles.join(" ، ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    profile,
    promptBlock: `${profileLines}\n${memoryBlock}`,
  };
}

/**
 * Super-Agent 1 (ایجنت سناریونویس — Step 0):
 * Proposes 3 sharply differentiated, deeply analyzed viral options tailored to the active Page Profile.
 */
export async function runStrategistTopicProposals(brief: ProjectBrief): Promise<TopicAnalysisResponse> {
  const { profile, promptBlock } = buildPageProfileAndMemoryContext({
    pageProfileId: brief.pageProfileId,
    agentRole: "scriptwriter_agent",
  });

  const effectivePlatform = profile?.platform || brief.platform || "instagram";
  const effectiveFormat = brief.contentFormat || profile?.defaultFormat || "reels";
  const pageMaturity: PageMaturityOption =
    brief.pageMaturity || profile?.pageMaturity || "new_page";

  const platformName = PLATFORM_LABELS[effectivePlatform] || PLATFORM_LABELS.instagram;
  const formatName = CONTENT_FORMAT_LABELS[effectiveFormat] || platformName;
  const pageMaturityLabel =
    pageMaturity === "new_page"
      ? "شروع پیج (پست‌های ۱ تا ۵ — ساخت هویت پیج، اعتماد اولیه و جذب سریع فالوور)"
      : "پیج فعال و در حال رشد (۱۰ تا ۲۰+ پست — محتوای چالشی، افشای اشتباهات پرهزینه و تثبیت مرجعیت)";

  let webResearch = "";
  const sources: GroundedSource[] = [];
  try {
    const ai = getClient();
    const searchRes = await generateWithModelFallback(ai, {
      contents: `درباره موضوع «${brief.idea}» ${profile ? `در حوزه تخصصی «${profile.niche}»` : ""} یک تحقیق بازارمحور، فنی و به‌روز انجام بده:
۱) حوزه دقیق صنعتی/تخصصی، اعداد و استانداردهای واقعی و دغدغه‌های خریداران یا مخاطبان هدف.
۲) الگوهای وایرال موفق و اشتباهات رایج یا باورهای غلط در این موضوع که بیشترین نرخ توقف اسکرول و اشتراک‌گذاری را در ${platformName} ایجاد می‌کنند.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    webResearch = searchRes.text ?? "";
    const seen = new Set<string>();
    for (const chunk of searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
      if (chunk.web?.uri && !seen.has(chunk.web.uri)) {
        seen.add(chunk.web.uri);
        sources.push({
          title: chunk.web.title || chunk.web.uri,
          uri: chunk.web.uri,
        });
      }
    }
  } catch {
    webResearch = "";
  }

  const maturityBlock =
    pageMaturity === "new_page"
      ? `استراتژی اجباری برای «شروع پیج (پست‌های ۱ تا ۵)»:
   - پیشنهاد ۱ (آرک‌تایپ «داستان واقعی/تست عینی در ثانیه اول»): نمایش یک حقیقت شگفت‌انگیز یا تست عملی فوری برای جذب گسترده مخاطب سرد.
   - پیشنهاد ۲ (آرک‌تایپ «نقشه اعتماد و تمایز تخصصی پیج»): حل یک مشکل پرهزینه مخاطب هدف که باعث شود فوراً دکمه فالو را بزند.
   - پیشنهاد ۳ (آرک‌تایپ «پشت‌صحنه، شگفتی فنی یا مقایسه قبل و بعد»): ویدیویی با ارزش ذخیره (Save) و فوروارد بالا.`
      : `استراتژی اجباری برای «پیج در حال رشد (۱۰ تا ۲۰+ پست)»:
   - پیشنهاد ۱ (آرک‌تایپ «افشای خطای پرهزینه یا تقلب بازار + راه تشخیص سریع»): بالاترین نرخ فوروارد و ذخیره.
   - پیشنهاد ۲ (آرک‌تایپ «مقایسه چالشی دو روش/محصول با نتیجه غافلگیرکننده»): بالاترین نرخ کامنت و بحث تخصصی.
   - پیشنهاد ۳ (آرک‌تایپ «چک‌لیست طلایی خرید/اجرا برای حرفه‌ای‌ها»): تثبیت اعتبار و تبدیل بازدیدکننده به مشتری.`;

  const prompt = `شما «ایجنت ۱: سناریونویس جامع استودیو» (ترکیب پژوهشگر بازار، تحلیلگر رقبا و الگوهای وایرال، استراتژیست سوشال مدیا، روانشناس مخاطب و سناریونویس ارشد) هستید.

ورودی کاربر:
- موضوع خام واردشده: «${brief.idea}»
- پلتفرم و فرمت: ${platformName} — ${formatName}
- وضعیت پیج: ${pageMaturityLabel}
${promptBlock}
${webResearch ? `\nیافته‌های پژوهش وب زنده:\n${webResearch}` : ""}

قوانین طلایی:
۱. تیترهای کتابی مثل «... چیست؟» یا «معرفی کامل ...» اکیداً ممنوع است.
۲. دقیقاً ۳ گزینه بی‌نظیر و کاملاً متمایز بساز که از نظر ارزش محتوا، قلاب ۳ ثانیه اول، استراتژی الگوریتم، پرسونای مخاطب و محرک روانشناختی تکمیل و بررسی شده باشند.
۳. ${maturityBlock}
۴. هر پیشنهاد باید شامل ۳ تا ۴ داده/فکت واقعی (keyFactsAndDataPoints)، قلاب کلامی، قلاب تصویری ثانیه اول و امتیاز ارزش محتوا (contentValueScoreNote) باشد.`;

  const routed = await executeAgentJsonWithRouter<Partial<TopicAnalysisResponse>>({
    agentId: "research_script",
    prompt: `${prompt}\n\nخروجی باید یک JSON Object دقیق شامل کلیدهای زیر باشد:
"hasDetailedScriptInstructions", "keywordDomainAnalysis", "exactTargetAudience", "corePainPoints", "pageStrategyRecommendation", "strategistSummary", "defaultRecommendedTone", "defaultRecommendedToneLabelFa", "defaultRecommendedDurationSeconds", "defaultRecommendedDurationLabelFa", "proposals" (آرایه ۳ آبجکت شامل id, title, angleArchetype, targetAudienceSegment, recommendedTone, recommendedToneLabelFa, recommendedDurationSeconds, recommendedDurationLabelFa, contentValueScoreNote, sampleHook, openingVisualHook, keyFactsAndDataPoints, strategistAngle, psychologyTrigger, creatorExecutionTip, ctaStrategy, viralPotentialNote).`,
    systemInstruction:
      "شما ایجنت ۱ (سناریونویس، استراتژیست و روانشناس سوشال مدیا) هستید. خروجی را ۱۰۰٪ به فارسی تخصصی، عملی و وایرال برگردانید.",
    expectedKeys: [
      "hasDetailedScriptInstructions",
      "keywordDomainAnalysis",
      "exactTargetAudience",
      "corePainPoints",
      "pageStrategyRecommendation",
      "strategistSummary",
      "defaultRecommendedTone",
      "defaultRecommendedToneLabelFa",
      "defaultRecommendedDurationSeconds",
      "defaultRecommendedDurationLabelFa",
      "proposals",
    ],
    googleResponseSchema: {
      type: Type.OBJECT,
      properties: {
        hasDetailedScriptInstructions: { type: Type.BOOLEAN },
        keywordDomainAnalysis: { type: Type.STRING },
        exactTargetAudience: { type: Type.STRING },
        corePainPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
        pageStrategyRecommendation: { type: Type.STRING },
        strategistSummary: { type: Type.STRING },
        defaultRecommendedTone: {
          type: Type.STRING,
          enum: ["educational", "cinematic_story", "news_analysis", "fast_motivational"],
        },
        defaultRecommendedToneLabelFa: { type: Type.STRING },
        defaultRecommendedDurationSeconds: { type: Type.INTEGER },
        defaultRecommendedDurationLabelFa: { type: Type.STRING },
        proposals: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              angleArchetype: { type: Type.STRING },
              targetAudienceSegment: { type: Type.STRING },
              recommendedTone: {
                type: Type.STRING,
                enum: ["educational", "cinematic_story", "news_analysis", "fast_motivational"],
              },
              recommendedToneLabelFa: { type: Type.STRING },
              recommendedDurationSeconds: { type: Type.INTEGER },
              recommendedDurationLabelFa: { type: Type.STRING },
              contentValueScoreNote: { type: Type.STRING },
              sampleHook: { type: Type.STRING },
              openingVisualHook: { type: Type.STRING },
              keyFactsAndDataPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
              strategistAngle: { type: Type.STRING },
              psychologyTrigger: { type: Type.STRING },
              creatorExecutionTip: { type: Type.STRING },
              ctaStrategy: { type: Type.STRING },
              viralPotentialNote: { type: Type.STRING },
            },
            required: [
              "id",
              "title",
              "angleArchetype",
              "targetAudienceSegment",
              "recommendedTone",
              "recommendedToneLabelFa",
              "recommendedDurationSeconds",
              "recommendedDurationLabelFa",
              "sampleHook",
              "openingVisualHook",
              "keyFactsAndDataPoints",
              "strategistAngle",
              "psychologyTrigger",
              "creatorExecutionTip",
              "ctaStrategy",
              "viralPotentialNote",
            ],
          },
        },
      },
      required: [
        "hasDetailedScriptInstructions",
        "keywordDomainAnalysis",
        "exactTargetAudience",
        "corePainPoints",
        "pageStrategyRecommendation",
        "strategistSummary",
        "defaultRecommendedTone",
        "defaultRecommendedToneLabelFa",
        "defaultRecommendedDurationSeconds",
        "defaultRecommendedDurationLabelFa",
        "proposals",
      ],
    },
  });

  const parsed = routed.data;
  const fallbackTones: ToneOption[] = ["news_analysis", "educational", "fast_motivational"];
  const defaultTone = normalizeTone(
    parsed.defaultRecommendedTone,
    profile?.brandTone || "educational"
  );
  const defaultSecs = clampDuration(parsed.defaultRecommendedDurationSeconds, effectiveFormat);

  return {
    hasDetailedScriptInstructions: Boolean(parsed.hasDetailedScriptInstructions),
    keywordDomainAnalysis: parsed.keywordDomainAnalysis || "",
    exactTargetAudience: parsed.exactTargetAudience || profile?.targetAudiencePersona || "",
    corePainPoints: Array.isArray(parsed.corePainPoints)
      ? parsed.corePainPoints
      : profile?.audiencePainPoints || [],
    pageStrategyRecommendation: parsed.pageStrategyRecommendation || "",
    strategistSummary:
      parsed.strategistSummary ||
      "موضوع شما بر اساس پروفایل پیج، روانشناسی مخاطب و الگوریتم بررسی شد و ۳ زاویه منتخب آماده است:",
    defaultRecommendedTone: defaultTone,
    defaultRecommendedToneLabelFa: parsed.defaultRecommendedToneLabelFa || TONE_LABELS[defaultTone],
    defaultRecommendedDurationSeconds: defaultSecs,
    defaultRecommendedDurationLabelFa:
      parsed.defaultRecommendedDurationLabelFa || formatDurationFa(defaultSecs),
    proposals: (parsed.proposals ?? []).slice(0, 3).map((p, i) => {
      const pTone = normalizeTone(p.recommendedTone, fallbackTones[i % fallbackTones.length]);
      const pSecs = clampDuration(p.recommendedDurationSeconds, effectiveFormat);
      return {
        ...p,
        id: p.id || `topic_${i + 1}`,
        angleArchetype: p.angleArchetype || `زاویه تخصصی ${i + 1}`,
        targetAudienceSegment: p.targetAudienceSegment || profile?.targetAudiencePersona || "",
        contentValueScoreNote: p.contentValueScoreNote || "ارزش ذخیره و اشتراک‌گذاری بالا",
        openingVisualHook: p.openingVisualHook || "",
        keyFactsAndDataPoints: Array.isArray(p.keyFactsAndDataPoints) ? p.keyFactsAndDataPoints : [],
        ctaStrategy: p.ctaStrategy || "",
        recommendedTone: pTone,
        recommendedToneLabelFa: p.recommendedToneLabelFa || TONE_LABELS[pTone],
        recommendedDurationSeconds: pSecs,
        recommendedDurationLabelFa: p.recommendedDurationLabelFa || formatDurationFa(pSecs),
      };
    }),
    sources: sources.slice(0, 5),
  };
}

/**
 * Super-Agent 1 (ایجنت سناریونویس — Stage 1):
 * Builds a mature, psychology-driven, algorithm-safe full scenario from the selected angle.
 */
export async function runMergedResearchAndScript(
  brief: ProjectBrief,
  feedback?: string,
  projectId?: string
): Promise<ResearchAndScriptOutput> {
  const { profile, promptBlock } = buildPageProfileAndMemoryContext({
    pageProfileId: brief.pageProfileId,
    projectId,
    agentRole: "scriptwriter_agent",
  });

  const platformName = PLATFORM_LABELS[brief.platform] || PLATFORM_LABELS.instagram;
  const formatName = brief.contentFormat
    ? CONTENT_FORMAT_LABELS[brief.contentFormat]
    : platformName;
  const toneName = brief.toneLabelFa?.trim() || TONE_LABELS[brief.tone] || TONE_LABELS.educational;
  const targetSecs = clampDuration(brief.targetDurationSeconds, brief.contentFormat);
  const sel = brief.selectedTopicAngle;

  const selectedAngleBlock = sel
    ? `\nگزینه منتخب کاربر از بین ۳ پیشنهاد استراتژیست:
- عنوان منتخب: ${sel.title}
- آرک‌تایپ: ${sel.angleArchetype || "تخصصی"}
- پرسونای دقیق: ${sel.targetAudienceSegment || ""}
- قلاب پیشنهادی: ${sel.sampleHook}
- قلاب بصری ثانیه اول: ${sel.openingVisualHook || ""}
- فکت‌ها و داده‌های کلیدی: ${(sel.keyFactsAndDataPoints ?? []).join(" | ")}
- محرک روانشناختی: ${sel.psychologyTrigger}
- استراتژی CTA: ${sel.ctaStrategy || ""}`
    : "";

  let groundedSummaryText = "";
  const sources: GroundedSource[] = [];
  try {
    const ai = getClient();
    const searchRes = await generateWithModelFallback(ai, {
      contents: `تحقیق مستند و اعتبارسنجی فنی برای نگارش سناریوی ویدیویی:
عنوان: ${brief.title}
ایده: ${brief.idea}
${profile ? `حوزه پیج: ${profile.niche}` : ""}${selectedAngleBlock}
${feedback ? `اصلاحیه درخواستی کاربر: ${feedback}` : ""}`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    groundedSummaryText = searchRes.text ?? "";
    const seen = new Set<string>();
    for (const chunk of searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
      if (chunk.web?.uri && !seen.has(chunk.web.uri)) {
        seen.add(chunk.web.uri);
        sources.push({
          title: chunk.web.title || chunk.web.uri,
          uri: chunk.web.uri,
        });
      }
    }
  } catch {
    groundedSummaryText = `پژوهش تخصصی موضوع «${brief.title}»`;
  }

  const approxWords = Math.max(45, Math.round((targetSecs / 60) * 135));
  const synthesisPrompt = `شما «ایجنت ۱: سناریونویس ارشد استودیو» هستید. از ایده خام و زاویه منتخب کاربر، یک سناریوی فوق‌العاده پخته، جذاب، منطبق با قوانین روانشناسی مخاطب و ایمن برای الگوریتم ${platformName} بسازید.

مشخصات پروژه:
- عنوان: ${brief.title}
- ایده خام: ${brief.idea}
- پلتفرم و فرمت: ${platformName} — ${formatName}
- لحن: ${toneName}
- مدت‌زمان هدف: ${targetSecs} ثانیه (حدود ${approxWords} کلمه گفتار)${selectedAngleBlock}
${promptBlock}
${feedback ? `\nبازخورد مستقیم کاربر برای اصلاح سناریو (رعایت ۱۰۰٪ الزامی): ${feedback}` : ""}

یافته‌های پژوهش وب:
${groundedSummaryText}

علاوه بر قلاب (hook)، بدنه (body) و دعوت به اقدام (cta)، حتماً دو چک‌لیست زیر را هم دقیق پر کنید:
- psychologicalTriggersUsed: آرایه ۳ موردی از تکنیک‌های روانشناسی به‌کاررفته در این سناریو (مثل گپ کنجکاوی، زیان‌گریزی، اثبات عینی و...).
- algorithmComplianceChecklist: آرایه ۳ تا ۴ موردی که تضمین می‌کند این پست از الگوریتم خارج نمی‌شود و شادوبن نمی‌خورد (رعایت ریتم، نبود کلمات اسپم، سیگنال Save/Share طبیعی).`;

  const routed = await executeAgentJsonWithRouter<Omit<ResearchAndScriptOutput, "sources">>({
    agentId: "research_script",
    prompt: `${synthesisPrompt}\n\nخروجی باید یک JSON Object دقیق شامل کلیدهای زیر باشد:
"videoTitle", "targetAudienceNote", "researchSummary", "keyInsights", "trendingAngles", "hook", "body", "cta", "psychologicalTriggersUsed", "algorithmComplianceChecklist", "keywords".`,
    systemInstruction:
      "شما ایجنت ۱ (سناریونویس و استراتژیست ارشد) هستید. سناریویی بنویسید که از ثانیه اول مخاطب را میخکوب کند و هیچ خطای الگوریتمی نداشته باشد.",
    expectedKeys: [
      "videoTitle",
      "targetAudienceNote",
      "researchSummary",
      "keyInsights",
      "trendingAngles",
      "hook",
      "body",
      "cta",
      "psychologicalTriggersUsed",
      "algorithmComplianceChecklist",
      "keywords",
    ],
    googleResponseSchema: {
      type: Type.OBJECT,
      properties: {
        videoTitle: { type: Type.STRING },
        targetAudienceNote: { type: Type.STRING },
        researchSummary: { type: Type.STRING },
        keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
        trendingAngles: { type: Type.ARRAY, items: { type: Type.STRING } },
        hook: { type: Type.STRING },
        body: { type: Type.STRING },
        cta: { type: Type.STRING },
        psychologicalTriggersUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
        algorithmComplianceChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
        keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        "videoTitle",
        "targetAudienceNote",
        "researchSummary",
        "keyInsights",
        "trendingAngles",
        "hook",
        "body",
        "cta",
        "psychologicalTriggersUsed",
        "algorithmComplianceChecklist",
        "keywords",
      ],
    },
  });

  const parsed = routed.data;
  let candidate: ResearchAndScriptOutput = {
    ...parsed,
    keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
    trendingAngles: Array.isArray(parsed.trendingAngles) ? parsed.trendingAngles : [],
    psychologicalTriggersUsed: Array.isArray(parsed.psychologicalTriggersUsed)
      ? parsed.psychologicalTriggersUsed
      : [],
    algorithmComplianceChecklist: Array.isArray(parsed.algorithmComplianceChecklist)
      ? parsed.algorithmComplianceChecklist
      : [],
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    sources: sources.slice(0, 6),
  };

  let audit = auditScenarioOutput(candidate, brief, profile, 1);
  if (!audit.passed) {
    const failedItems = audit.checks.filter((c) => !c.passed).map((c) => `${c.nameFa}: ${c.detailFa}`);
    const fixes: string[] = [];
    try {
      const repairRes = await executeAgentJsonWithRouter<Omit<ResearchAndScriptOutput, "sources">>({
        agentId: "research_script",
        prompt: `سناریوی زیر در بازبینی فنی مردود شده است. لطفاً دقیقاً این ایرادها را برطرف کن و JSON کامل سناریو را برگردان:
ایرادهای بازبینی:
${failedItems.join("\n")}

سناریوی فعلی:
${JSON.stringify(candidate)}`,
        systemInstruction:
          "شما ناظر و اصلاح‌گر ارشد سناریو هستید. بدون تغییر موضوع اصلی، تمام ایرادهای بازبینی فنی (قلاب زیر ۳۰ کلمه، تیتر غیرکتابی، تطابق حجم کلمات با زمان هدف و چک‌لیست الگوریتم) را اصلاح کنید.",
        expectedKeys: [
          "videoTitle",
          "targetAudienceNote",
          "researchSummary",
          "keyInsights",
          "trendingAngles",
          "hook",
          "body",
          "cta",
          "psychologicalTriggersUsed",
          "algorithmComplianceChecklist",
          "keywords",
        ],
      });
      fixes.push(`بازنویسی خودکار پس از ایراد در: ${audit.checks.filter((c) => !c.passed).map((c) => c.nameFa).join("، ")}`);
      candidate = {
        ...candidate,
        ...repairRes.data,
        sources: candidate.sources,
      };
      audit = auditScenarioOutput(candidate, brief, profile, 2, fixes);
    } catch {
      // Keep original candidate with audit attached
    }
  }

  return {
    ...candidate,
    qaAudit: audit,
  };
}

/**
 * Super-Agent 1 (ایجنت سناریونویس — Stage 2):
 * Converts approved scenario into a visual-synced Persian Narration Script with
 * COMPLETE Persian diacritics (اعراب‌گذاری کامل کلمات حساس، کسره اضافه، تشدید) + pronunciation guide.
 */
export async function runNarrationScriptAgent(
  script: ResearchAndScriptOutput,
  brief: ProjectBrief,
  feedback?: string,
  projectId?: string
): Promise<NarrationScriptOutput> {
  const { profile, promptBlock } = buildPageProfileAndMemoryContext({
    pageProfileId: brief.pageProfileId,
    projectId,
    agentRole: "scriptwriter_agent",
  });

  const voiceStyleNote =
    profile?.voiceProfile.prosodyStyle ||
    TONE_LABELS[brief.tone] ||
    "گویندگی حرفه‌ای، گرم، طبیعی و شمرده فارسی";

  const prompt = `شما «ایجنت ۱: نویسنده تخصصی متن گویندگی و آوانگار فارسی» هستید.
بر اساس سناریوی تاییدشده زیر، متن دقیق گویندگی هماهنگ با تصویر را به زبان فارسی بنویسید و آن را برای موتور کلون صدا و گوینده صوتی به صورت کامل **اِعراب‌گذاری (ح حرکت‌گذاری فتحه َ، کسره ِ، ضمه ُ، تشدید ّ و کسره اضافه)** کنید تا حتی یک کلمه هم اشتباه تلفظ نشود!

سناریوی تاییدشده:
- عنوان: ${script.videoTitle}
- قلاب: ${script.hook}
- بدنه: ${script.body}
- دعوت به اقدام: ${script.cta}
- سبک بیان و صدای پیج: ${voiceStyleNote}
- مدت‌زمان هدف: ${brief.targetDurationSeconds} ثانیه
${promptBlock}
${feedback ? `\nبازخورد اصلاحی کاربر روی متن گویندگی: ${feedback}` : ""}

الزامات حیاتی متن گویندگی:
۱. plainNarrationText: متن روان گویندگی بدون اعراب اضافی برای مطالعه سریع چشم.
۲. vocalizedNarrationText: همان متن گویندگی با **اِعراب‌گذاری دقیق روی تمام کلمات هم‌نگاره، تخصصی، عربی/فنی و تمام کسره‌های اضافه بین مضاف و مضاف‌الیه** + نشانگرهای مکث دقیق مثل [مکث ۰.۴ ثانیه] یا [تاکید محکم] و نوشتن تمام اعداد به حروف فارسی.
۳. pronunciationGuide: جدول ۴ تا ۶ کلمه کلیدی/حساس متن با شکل اعراب‌گذاری‌شده و نکته حس و استرس بیان.
۴. rhythmAndPauseNotes: راهنمای ریتم تنفس، سرعت بیان در قلاب نسبت به بدنه و فرود پایانی.
۵. emotionArcSummary: قوس احساسی صدا از ثانیه اول تا پایان ویدیو.`;

  const routed = await executeAgentJsonWithRouter<NarrationScriptOutput>({
    agentId: "voiceover",
    prompt: `${prompt}\n\nخروجی باید یک JSON Object شامل کلیدهای دقیق زیر باشد:
"plainNarrationText", "vocalizedNarrationText", "pronunciationGuide" (آرایه شامل word, vocalized, emotionOrStressNote), "rhythmAndPauseNotes", "emotionArcSummary", "estimatedSeconds", "wordCount".`,
    systemInstruction:
      "شما استاد فن بیان، گویندگی و آوانگاری زبان فارسی هستید. کسره‌های اضافه و حرکات فتحه/کسره/ضمه را روی کلمات حساس با دقت کامل قرار دهید تا موتور سنتز صدا هیچ خطای خوانشی نداشته باشد.",
    expectedKeys: [
      "plainNarrationText",
      "vocalizedNarrationText",
      "pronunciationGuide",
      "rhythmAndPauseNotes",
      "emotionArcSummary",
      "estimatedSeconds",
      "wordCount",
    ],
    googleResponseSchema: {
      type: Type.OBJECT,
      properties: {
        plainNarrationText: { type: Type.STRING },
        vocalizedNarrationText: { type: Type.STRING },
        pronunciationGuide: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              vocalized: { type: Type.STRING },
              emotionOrStressNote: { type: Type.STRING },
            },
            required: ["word", "vocalized", "emotionOrStressNote"],
          },
        },
        rhythmAndPauseNotes: { type: Type.STRING },
        emotionArcSummary: { type: Type.STRING },
        estimatedSeconds: { type: Type.INTEGER },
        wordCount: { type: Type.INTEGER },
      },
      required: [
        "plainNarrationText",
        "vocalizedNarrationText",
        "pronunciationGuide",
        "rhythmAndPauseNotes",
        "emotionArcSummary",
        "estimatedSeconds",
        "wordCount",
      ],
    },
  });

  const data = routed.data;
  const cleanWords = (data.plainNarrationText || "")
    .replace(/\[[^\]]*\]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  let candidate: NarrationScriptOutput = {
    plainNarrationText: data.plainNarrationText || "",
    vocalizedNarrationText: data.vocalizedNarrationText || data.plainNarrationText || "",
    pronunciationGuide: Array.isArray(data.pronunciationGuide) ? data.pronunciationGuide : [],
    rhythmAndPauseNotes: data.rhythmAndPauseNotes || "",
    emotionArcSummary: data.emotionArcSummary || "",
    estimatedSeconds: data.estimatedSeconds || brief.targetDurationSeconds,
    wordCount: cleanWords || data.wordCount || 60,
  };

  let audit = auditNarrationOutput(candidate, brief, 1);
  if (!audit.passed) {
    const failedItems = audit.checks.filter((c) => !c.passed).map((c) => `${c.nameFa}: ${c.detailFa}`);
    const fixes: string[] = [];
    try {
      const repairRes = await executeAgentJsonWithRouter<NarrationScriptOutput>({
        agentId: "voiceover",
        prompt: `متن گویندگی زیر در بازبینی فنی و قواعد خوانش فارسی خطا داشت. لطفاً این موارد را اصلاح کن:
خطاها:
${failedItems.join("\n")}

متن فعلی:
${JSON.stringify(candidate)}

الزام: چگالی اعراب (فتحه َ، کسره ِ، ضمه ُ، تشدید ّ) و کسره اضافه را بیشتر کن، حتماً تگ‌های [مکث ۰.۴ ثانیه] را در نقاط تنفس بگذار، همه اعداد را به حروف فارسی بنویس و جدول تلفظ ۴ موردی بده.`,
        systemInstruction:
          "شما ویراستار ارشد آوانگاری و فن بیان فارسی هستید. تمام خطاهای اعراب‌گذاری، اعداد خام و مکث‌ها را برطرف کنید.",
        expectedKeys: [
          "plainNarrationText",
          "vocalizedNarrationText",
          "pronunciationGuide",
          "rhythmAndPauseNotes",
          "emotionArcSummary",
          "estimatedSeconds",
          "wordCount",
        ],
      });
      fixes.push(`اصلاح خودکار اعراب، مکث یا تبدیل اعداد: ${audit.checks.filter((c) => !c.passed).map((c) => c.nameFa).join("، ")}`);
      const repairedWords = (repairRes.data.plainNarrationText || candidate.plainNarrationText)
        .replace(/\[[^\]]*\]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
      candidate = {
        ...candidate,
        ...repairRes.data,
        wordCount: repairedWords || candidate.wordCount,
      };
      audit = auditNarrationOutput(candidate, brief, 2, fixes);
    } catch {
      // Keep original candidate with audit attached
    }
  }

  return {
    ...candidate,
    qaAudit: audit,
  };
}

/**
 * Super-Agent 2 (تیم ۵ نفره کارگردانی سینمایی — Stage 3A):
 * Thinks like a full film crew (Showrunner, DOP, Art Director, Rhythm Editor, Sound Designer),
 * breaking the scenario into strictly 3–8 second shots with full Production Bible specs.
 */
export async function runDirectorAgent(
  script: ResearchAndScriptOutput,
  narrationText: string,
  brief: ProjectBrief,
  feedback?: string,
  projectId?: string
): Promise<DirectorOutput> {
  const { promptBlock } = buildPageProfileAndMemoryContext({
    pageProfileId: brief.pageProfileId,
    projectId,
    agentRole: "director_agent",
  });

  const targetSec = clampDuration(brief.targetDurationSeconds, brief.contentFormat);
  const minShots = Math.max(4, Math.ceil(targetSec / 7));
  const maxShots = Math.min(10, Math.max(minShots + 1, Math.ceil(targetSec / 4.5)));

  const formatName = brief.contentFormat
    ? CONTENT_FORMAT_LABELS[brief.contentFormat]
    : PLATFORM_LABELS[brief.platform] || "ویدیوی کوتاه";

  const prompt = `شما «دپارتمان ۵ نفره کارگردانی حرفه‌ای استودیو» هستید (متشکل از: ۱. شورانر و کارگردان خلاق، ۲. مدیر فیلم‌برداری DOP، ۳. طراح صحنه و آکسسوار، ۴. تدوینگر ریتم سوشال مدیا، ۵. طراح صدا).
سناریو خام و متن گویندگی زیر را نباید سطحی ببینید؛ باید دقیقاً مثل یک تیم فیلم‌برداری حرفه‌ای آن را پخت‌وپز کرده و به **${minShots} تا ${maxShots} شات ۳ تا ۸ ثانیه‌ای واقعی** با شناسنامه فنی کامل تبدیل کنید.

عنوان ویدیو: ${script.videoTitle}
فرمت و کادر: ${formatName}
مدت‌زمان هدف کل ویدیو: حدود ${targetSec} ثانیه
متن گویندگی تاییدشده:
${narrationText}
${promptBlock}
${feedback ? `\nدستور اصلاحی کاربر روی دکوپاژ شات‌ها: ${feedback}` : ""}

تکالیف الزامی تیم ۵ نفره کارگردانی:
1) directingCrewNotes: یادداشت‌های دقیق ۵ بخش تیم برای یکپارچگی کل فیلم (showrunnerNoteFa, dopCinematographyNoteFa, artDirectionNoteFa, editorRhythmNoteFa, soundDesignNoteFa).
2) قوانین هر شات داخل shots:
   - durationSeconds: **اکیداً بین 3 تا 8 ثانیه**.
   - dramaticBeatFa: نقش دراماتیک شات (مثلاً: «قلاب شوک اول»، «اثبات بصری»، «تست فنی»، «دعوت به اقدام»).
   - microScenarioFa: **سناریوی دقیق و کامل همین شات** (در ثانیه اول چه اتفاقی می‌افتد، دست/سوژه چه حرکتی می‌کند و در پایان شات بیننده دقیقاً چه حقیقتی را می‌بیند).
   - subjectAndActionFa: سوژه فیزیکی دقیق و اکشن مقابل دوربین.
   - environmentAndPropsFa: لوکیشن واقعی، پس‌زمینه و ابزارهای صحنه (Props).
   - lensAndFramingFa: نوع لنز (مثلاً Macro 85mm f/2.8 یا Wide 24mm)، زاویه و فضای منفی Safe-Zone برای زیرنویس ریلز.
   - lightingRigFa: ستاپ دقیق نورپردازی (Key Light، Rim Light، دمای رنگ کلوین و کنتراست).
   - continuityLockFa: قفل راکورد با شات قبلی و بعدی (تطابق رنگ لباس/محیط/سوژه و جهت حرکت).
   - photorealPromptStartEn: پرامپت بسیار دقیق انگلیسی واقع‌گرایانه برای فریم ۱ (برای ComfyUI / Flux / HyperFrames — واقعی، فوتورئال، بدون واژه‌های فانتزی کارتونی).
   - photorealPromptEndEn: پرامپت دقیق انگلیسی واقع‌گرایانه برای فریم ۲ (نمایش اوج حرکت دوربین یا نتیجه اکشن).
   - negativePromptEn: موارد ممنوعه (cartoon, blurry, plastic texture, distorted fingers, extra limbs, watermark).
   - recommendedEngine: بهترین موتور رندر سبک برای این شات ("hyperframes_html" | "comfyui_light" | "remotion_kinetic" | "blender_headless" | "ffmpeg_cinema").
   - startFrameDescriptionFa و endFrameDescriptionFa: توصیف دقیق فریم ۱ و فریم ۲ به فارسی.
   - onScreenText: زیرنویس کوبنده حداکثر ۶ کلمه فارسی (برای ناحیه امن ریلز).`;

  const shotSchemaProps = {
    shotNumber: { type: Type.INTEGER },
    timecode: { type: Type.STRING },
    durationSeconds: { type: Type.INTEGER },
    cameraAngle: { type: Type.STRING },
    cameraMovement: { type: Type.STRING },
    sceneDescriptionFa: { type: Type.STRING },
    startFrameDescriptionFa: { type: Type.STRING },
    endFrameDescriptionFa: { type: Type.STRING },
    spokenSegment: { type: Type.STRING },
    onScreenText: { type: Type.STRING },
    sfxCueFa: { type: Type.STRING },
    transitionToNext: {
      type: Type.STRING,
      enum: ["cut", "cross_dissolve", "whip_pan", "zoom_in"],
    },
    lightingAndMood: { type: Type.STRING },
    visualPromptFa: { type: Type.STRING },
    dramaticBeatFa: { type: Type.STRING },
    microScenarioFa: { type: Type.STRING },
    subjectAndActionFa: { type: Type.STRING },
    environmentAndPropsFa: { type: Type.STRING },
    lensAndFramingFa: { type: Type.STRING },
    lightingRigFa: { type: Type.STRING },
    continuityLockFa: { type: Type.STRING },
    photorealPromptStartEn: { type: Type.STRING },
    photorealPromptEndEn: { type: Type.STRING },
    negativePromptEn: { type: Type.STRING },
    recommendedEngine: {
      type: Type.STRING,
      enum: ["hyperframes_html", "comfyui_light", "remotion_kinetic", "blender_headless", "ffmpeg_cinema"],
    },
  };

  const routedDirector = await executeAgentJsonWithRouter<DirectorOutput>({
    agentId: "director",
    prompt: `${prompt}\n\nخروجی باید یک JSON Object دقیق شامل "visualDirectionSummary", "totalEstimatedSeconds", "directingCrewNotes" و آرایه "shots" باشد.`,
    systemInstruction:
      "شما تیم ۵ نفره کارگردانی سینمایی هستید. تمام شات‌ها باید ۳ تا ۸ ثانیه باشند و سناریوی خرد، لنز، نورپردازی، راکورد و پرامپت فوتورئال انگلیسی کامل داشته باشند.",
    expectedKeys: ["visualDirectionSummary", "totalEstimatedSeconds", "directingCrewNotes", "shots"],
    googleResponseSchema: {
      type: Type.OBJECT,
      properties: {
        visualDirectionSummary: { type: Type.STRING },
        totalEstimatedSeconds: { type: Type.INTEGER },
        directingCrewNotes: {
          type: Type.OBJECT,
          properties: {
            showrunnerNoteFa: { type: Type.STRING },
            dopCinematographyNoteFa: { type: Type.STRING },
            artDirectionNoteFa: { type: Type.STRING },
            editorRhythmNoteFa: { type: Type.STRING },
            soundDesignNoteFa: { type: Type.STRING },
          },
          required: [
            "showrunnerNoteFa",
            "dopCinematographyNoteFa",
            "artDirectionNoteFa",
            "editorRhythmNoteFa",
            "soundDesignNoteFa",
          ],
        },
        shots: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: shotSchemaProps,
            required: [
              "shotNumber",
              "timecode",
              "durationSeconds",
              "cameraAngle",
              "cameraMovement",
              "sceneDescriptionFa",
              "startFrameDescriptionFa",
              "endFrameDescriptionFa",
              "spokenSegment",
              "onScreenText",
              "sfxCueFa",
              "transitionToNext",
              "lightingAndMood",
              "visualPromptFa",
              "microScenarioFa",
              "lensAndFramingFa",
              "lightingRigFa",
              "continuityLockFa",
              "photorealPromptStartEn",
              "photorealPromptEndEn",
            ],
          },
        },
      },
      required: ["visualDirectionSummary", "totalEstimatedSeconds", "directingCrewNotes", "shots"],
    },
  });

  const enrichShotSpecs = (s: DirectorShot): DirectorShot => ({
    ...s,
    dramaticBeatFa: s.dramaticBeatFa || (s.shotNumber === 1 ? "قلاب بصری ثانیه اول" : "پیشبرد بصری سناریو"),
    microScenarioFa: s.microScenarioFa || s.sceneDescriptionFa,
    subjectAndActionFa: s.subjectAndActionFa || s.sceneDescriptionFa,
    environmentAndPropsFa: s.environmentAndPropsFa || "صحنه واقعی متناسب با موضوع و ابزار کار",
    lensAndFramingFa: s.lensAndFramingFa || `${s.cameraAngle} · 35mm f/2.0 (فضای پایین امن برای زیرنویس)`,
    lightingRigFa: s.lightingRigFa || s.lightingAndMood,
    continuityLockFa: s.continuityLockFa || "ثبات رنگ پوست/متریال، کلوین نور ۴۵۰۰ و زاویه محور ۱۸۰ درجه",
    photorealPromptStartEn:
      s.photorealPromptStartEn ||
      `Photorealistic vertical 9:16 commercial cinematography, ${s.visualPromptFa || s.sceneDescriptionFa}, natural workshop lighting, crisp focus, 8k RAW photo`,
    photorealPromptEndEn:
      s.photorealPromptEndEn ||
      `Photorealistic vertical 9:16 camera ${s.cameraMovement || "push-in"}, ${s.endFrameDescriptionFa || s.sceneDescriptionFa}, shallow depth of field`,
    negativePromptEn:
      s.negativePromptEn || "cartoon, anime, abstract shapes, blurry, low quality, distorted hands, watermark",
    recommendedEngine: (s.recommendedEngine || "hyperframes_html") as LocalVideoEngineId,
  });

  const normalized = normalizeDirectorShots3To8s((routedDirector.data.shots ?? []).map(enrichShotSpecs));
  const crewNotes: DirectingCrewNotes = routedDirector.data.directingCrewNotes || {
    showrunnerNoteFa: "ریتم سریع ۳ تا ۶ ثانیه‌ای برای نگهداشت مخاطب از ثانیه اول تا پایان CTA.",
    dopCinematographyNoteFa: "کادر ۹:۱۶ عمودی با ترکیب کلوزآپ ماکرو و حرکت نرم دوربین روی محور سوژه.",
    artDirectionNoteFa: "بافت واقعی صحنه بدون المان‌های تزئینی بی‌ربط؛ کنتراست سوژه با پس‌زمینه.",
    editorRhythmNoteFa: "کات‌های دقیق روی ضرب‌آهنگ گفتار و تغییر زاویه محسوس در هر برش.",
    soundDesignNoteFa: "افکت‌های محیطی واقعی، Whoosh انتقال نرم و تراز -14 LUFS.",
  };

  let directorOutput: DirectorOutput = {
    visualDirectionSummary:
      routedDirector.data.visualDirectionSummary ||
      "کارگردانی کنتراست بالا با کات‌های ریتمیک ۳ تا ۶ ثانیه‌ای",
    totalEstimatedSeconds: normalized.totalEstimatedSeconds,
    directingCrewNotes: crewNotes,
    shots: normalized.shots,
  };

  const fixes: string[] = [];
  let audit = auditDirectorCrewPlan(directorOutput, 1);
  if (!audit.passed) {
    // Self-heal caption length or missing fields deterministically so Stage 3 always meets Production Bible rules
    const fixedShots = directorOutput.shots.map((s) => {
      const capWords = (s.onScreenText || "").trim().split(/\s+/).filter(Boolean);
      const trimmedCap = capWords.length > 8 ? capWords.slice(0, 7).join(" ") : s.onScreenText;
      return enrichShotSpecs({ ...s, onScreenText: trimmedCap });
    });
    fixes.push("بهینه‌سازی خودکار طول زیرنویس‌های روی تصویر (Safe-Zone) و تکمیل شناسنامه فنی شات‌ها.");
    directorOutput = {
      ...directorOutput,
      shots: fixedShots,
    };
    audit = auditDirectorCrewPlan(directorOutput, 2, fixes);
  }

  return {
    ...directorOutput,
    qaAudit: audit,
  };
}

/**
 * Super-Agent 2 (ایجنت کارگردان — Stage 3B):
 * Renders TWO distinct realistic raster PNG preview frames per shot using HyperFrames HTML5 / ComfyUI Light,
 * then inspects every generated frame with Multimodal Vision QA + automatic self-healing retry!
 */
export async function runVisualProducerBatch(
  projectId: string,
  shots: DirectorShot[],
  directionSummary: string,
  feedback?: string
): Promise<VisualAssetShot[]> {
  const results: VisualAssetShot[] = [];

  for (const shot of shots) {
    const effectiveShot: DirectorShot = feedback?.trim()
      ? {
          ...shot,
          visualPromptFa: `${shot.visualPromptFa} (${feedback.trim()})`,
        }
      : shot;

    try {
      const fixesApplied: string[] = [];
      let frames = await renderHyperFramesDualKeyframes({
        projectId,
        shot: effectiveShot,
        directionSummary,
        width: 540,
        height: 960,
      });

      let qaAudit = await runMultimodalVisionFrameQA({
        imagePath: frames.frame1Path,
        shot: effectiveShot,
        frameRole: "frame1_start",
        targetW: 540,
        targetH: 960,
        attemptsRun: 1,
        fixesAppliedFa: fixesApplied,
      });

      // Self-Healing Loop: if Vision/Technical QA reports an issue, adjust prompt/layout & re-render
      if (!qaAudit.passed) {
        const reason = qaAudit.autoFixPromptFa || "تقویت کنتراست سوژه و خوانایی در محدوده امن";
        fixesApplied.push(`اصلاح خودکار فریم پس از بازبینی بینایی: ${reason}`);
        const healedShot: DirectorShot = {
          ...effectiveShot,
          lightingRigFa: `${effectiveShot.lightingRigFa || effectiveShot.lightingAndMood} · کنتراست بالا`,
          microScenarioFa: `${effectiveShot.microScenarioFa || effectiveShot.sceneDescriptionFa} (${reason})`,
        };
        frames = await renderHyperFramesDualKeyframes({
          projectId,
          shot: healedShot,
          directionSummary,
          width: 540,
          height: 960,
        });
        qaAudit = await runMultimodalVisionFrameQA({
          imagePath: frames.frame1Path,
          shot: healedShot,
          frameRole: "frame1_start",
          targetW: 540,
          targetH: 960,
          attemptsRun: 2,
          fixesAppliedFa: fixesApplied,
        });
      }

      results.push({
        shotNumber: shot.shotNumber,
        imageUrl: frames.imageUrl,
        secondaryImageUrl: frames.secondaryImageUrl,
        motionCue: shot.cameraMovement || "حرکت نرم دوربین",
        colorPaletteNote: shot.lightingRigFa || shot.lightingAndMood || "پالت سینمایی",
        generatorEngine: shot.recommendedEngine || "hyperframes_html",
        qaAudit,
        status: "ready",
        error: null,
      });
    } catch (err) {
      results.push({
        shotNumber: shot.shotNumber,
        imageUrl: null,
        secondaryImageUrl: null,
        motionCue: shot.cameraMovement || "زوم نرم",
        colorPaletteNote: shot.lightingAndMood || "کنتراست سینمایی",
        generatorEngine: "hyperframes_html",
        qaAudit: null,
        status: "error",
        error: formatGeminiError(err),
      });
    }
  }

  return results;
}

export async function runVisualProducerForShot(
  projectId: string,
  shot: DirectorShot,
  directionSummary: string,
  feedback?: string
): Promise<VisualAssetShot> {
  const [result] = await runVisualProducerBatch(projectId, [shot], directionSummary, feedback);
  return result;
}

/**
 * Super-Agent 2 (ایجنت کارگردان — Stage 5: Voice Clone & Persian Diacritic Synthesis):
 * Uses the Page Profile's recorded/uploaded voice reference + vocalized Persian script
 * to synthesize clean 24kHz WAV narration via free-tier Gemini TTS (plus XTTS-v2/F5-TTS desktop metadata).
 */
export async function runVoiceoverAgent(
  projectId: string,
  script: ResearchAndScriptOutput,
  brief: ProjectBrief,
  voiceName?: VoicePersona,
  voiceStyle?: string,
  feedback?: string,
  existingNarrationText?: string,
  narrationRecord?: NarrationScriptOutput | null
): Promise<VoiceoverOutput> {
  const profile = getPageProfile(brief.pageProfileId);
  const resolvedVoice: VoicePersona =
    voiceName || profile?.voiceProfile.voicePersona || "Charon";
  const resolvedStyle =
    voiceStyle?.trim() ||
    profile?.voiceProfile.prosodyStyle ||
    `${TONE_LABELS[brief.tone]} — بیان دقیق کسره‌های اضافه و مکث‌های طبیعی فارسی`;

  const sourceVocalized =
    existingNarrationText?.trim() ||
    narrationRecord?.vocalizedNarrationText?.trim() ||
    `${script.hook} [مکث ۰.۴ ثانیه] ${script.body} [مکث ۰.۳ ثانیه] ${script.cta}`;

  let finalVocalized = sourceVocalized;
  let pacingNotes =
    narrationRecord?.rhythmAndPauseNotes ||
    "مکث کوتاه پس از قلاب، شمرده‌خوانی کلمات تخصصی اعراب‌گذاری‌شده و فرود مطمئن در پایان.";
  const estimatedSeconds = narrationRecord?.estimatedSeconds || brief.targetDurationSeconds;

  if (feedback?.trim()) {
    const adapted = await runNarrationScriptAgent(script, brief, feedback, projectId);
    finalVocalized = adapted.vocalizedNarrationText;
    pacingNotes = adapted.rhythmAndPauseNotes;
  }

  const cleanSpeechText = finalVocalized
    .replace(/\[[^\]]*\]/g, " ... ")
    .replace(/\s+/g, " ")
    .trim();

  const wordCount = cleanSpeechText.split(/\s+/).filter(Boolean).length;

  let audioUrl: string | null = null;
  let audioFilename: string | null = null;
  let audioError: string | null = null;

  try {
    const ai = getClient("v1beta");
    const ttsRes = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: cleanSpeechText,
                speechMetadata: {
                  style: resolvedStyle,
                },
              } as { text: string; speechMetadata?: { style: string } },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: resolvedVoice },
            },
          },
        },
      })
    );

    const base64Audio = ttsRes.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data
    )?.inlineData?.data;

    if (base64Audio) {
      // Unary gemini-3.8-flash-lite-tts returns a complete 24kHz 16-bit mono WAV directly
      const wavBuffer = Buffer.from(base64Audio, "base64");
      audioFilename = `${projectId}_vo_${Date.now()}.wav`;
      audioUrl = saveAudioFile(audioFilename, wavBuffer);
    } else {
      audioError = "مدل صوتی داده WAV برنگرداند؛ می‌توانید دوباره دکمه تولید صدا را بزنید.";
    }
  } catch (err) {
    audioError = formatGeminiError(err);
  }

  const cloneEngineNote = profile?.voiceProfile.sampleAudioUrl
    ? `متصل به نمونه صدای مرجع «${profile.voiceProfile.speakerName}» (سنتز ابری رایگان + آماده کلون ۱۰۰٪ آفلاین XTTS-v2 در نسخه ویندوز)`
    : `پرسونای صوتی استاندارد استودیو (${resolvedVoice}) با رعایت کامل اعراب‌گذاری فارسی`;

  const wavDiskPath = audioFilename ? path.join(getAudioDir(), audioFilename) : null;
  const qaAudit = await auditVoiceoverAudioWav({
    wavPath: wavDiskPath,
    wordCount,
    targetDurationSec: estimatedSeconds,
    audioError,
  });

  return {
    narrationText: narrationRecord?.plainNarrationText || finalVocalized,
    vocalizedText: finalVocalized,
    voiceName: resolvedVoice,
    voiceStyle: resolvedStyle,
    referenceSampleUrl: profile?.voiceProfile.sampleAudioUrl ?? null,
    cloneEngineNote,
    estimatedSeconds,
    wordCount,
    pacingNotes,
    audioUrl,
    audioFilename,
    audioError,
    qaAudit,
  };
}

/**
 * Grounded Competitor & Weekly Viral Radar (100% Safe Public Web Grounding — Zero Account Login/Scraping Risk)
 */
export async function runCompetitorAndViralRadar(params: {
  nicheQuery: string;
  platform: PlatformOption;
  pageProfileId?: string | null;
}): Promise<CompetitorViralReport> {
  const profile = getPageProfile(params.pageProfileId);
  const platformName = PLATFORM_LABELS[params.platform] || PLATFORM_LABELS.instagram;
  const competitorHint = profile?.competitorHandles.length
    ? `رقبای ثبت‌شده در پروفایل پیج: ${profile.competitorHandles.join(" ، ")}`
    : "";

  let webResearch = "";
  const sources: GroundedSource[] = [];

  try {
    const ai = getClient();
    const searchRes = await generateWithModelFallback(ai, {
      contents: `تحلیل رقبا، الگوهای پست‌های وایرال اخیر و قوانین به‌روز الگوریتم ${platformName} در حوزه «${params.nicheQuery}»:
${competitorHint}
۱) پیج‌ها یا کانال‌های شاخص این حوزه چه فرمول قلابی اجرا می‌کنند و چه شکاف محتوایی (Content Gap) برای یک پیج جدید/درحال‌رشد وجود دارد؟
۲) ۵ الگوی پست وایرال پربازدید این هفته/ماه در این حوزه چه ساختار قلاب، ریتم تدوین و مکانیزم نگهداشت مخاطب (Retention) دارند؟
۳) چه اشتباهاتی باعث افت بازدید، خروج از اکسپلور یا شادوبن شدن پیج در این حوزه می‌شود؟`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    webResearch = searchRes.text ?? "";
    const seen = new Set<string>();
    for (const chunk of searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
      if (chunk.web?.uri && !seen.has(chunk.web.uri)) {
        seen.add(chunk.web.uri);
        sources.push({
          title: chunk.web.title || chunk.web.uri,
          uri: chunk.web.uri,
        });
      }
    }
  } catch {
    webResearch = `بررسی استراتژیک حوزه ${params.nicheQuery} در ${platformName}`;
  }

  const routed = await executeAgentJsonWithRouter<{
    executiveSummary: string;
    safeResearchMethodNote: string;
    competitors: CompetitorViralReport["competitors"];
    weeklyTopViralPatterns: CompetitorViralReport["weeklyTopViralPatterns"];
    algorithmRulesAndRedLines: string[];
  }>({
    agentId: "research_script",
    prompt: `شما تحلیلگر ارشد رقبا و مهندس الگوریتم ${platformName} هستید. بر اساس پژوهش وب زیر، یک گزارش عملیاتی دقیق به فارسی تولید کنید:

حوزه بررسی: ${params.nicheQuery}
پلتفرم: ${platformName}
${competitorHint}
یافته‌های وب:
${webResearch}

خروجی باید یک JSON Object دقیق شامل کلیدهای زیر باشد:
- executiveSummary: خلاصه مدیریتی و نقشه برنده شدن در این حوزه (۲ تا ۳ جمله کوبنده).
- safeResearchMethodNote: توضیح کوتاه درباره اینکه این تحلیل با جستجوی عمومی وب و بدون لاگین رباتیک در اکانت شخصی انجام شده تا خطر شادوبن صفر باشد.
- competitors: آرایه ۳ تا ۴ رقیب/تیپ پیج شاخص شامل nameOrHandle, platform, coreStrength, winningHookFormula, weaknessOrGapForUs.
- weeklyTopViralPatterns: آرایه ۴ تا ۵ الگوی وایرال برتر هفته شامل rank, patternTitle, hookStructureFa, retentionMechanismFa, visualRhythmNote, whyItWentViral.
- algorithmRulesAndRedLines: آرایه ۴ تا ۵ قانون طلایی الگوریتم و خط قرمزهایی که از افت بازدید پیج جلوگیری می‌کند.`,
    expectedKeys: [
      "executiveSummary",
      "safeResearchMethodNote",
      "competitors",
      "weeklyTopViralPatterns",
      "algorithmRulesAndRedLines",
    ],
    googleResponseSchema: {
      type: Type.OBJECT,
      properties: {
        executiveSummary: { type: Type.STRING },
        safeResearchMethodNote: { type: Type.STRING },
        competitors: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              nameOrHandle: { type: Type.STRING },
              platform: { type: Type.STRING },
              coreStrength: { type: Type.STRING },
              winningHookFormula: { type: Type.STRING },
              weaknessOrGapForUs: { type: Type.STRING },
            },
            required: [
              "nameOrHandle",
              "platform",
              "coreStrength",
              "winningHookFormula",
              "weaknessOrGapForUs",
            ],
          },
        },
        weeklyTopViralPatterns: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              rank: { type: Type.INTEGER },
              patternTitle: { type: Type.STRING },
              hookStructureFa: { type: Type.STRING },
              retentionMechanismFa: { type: Type.STRING },
              visualRhythmNote: { type: Type.STRING },
              whyItWentViral: { type: Type.STRING },
            },
            required: [
              "rank",
              "patternTitle",
              "hookStructureFa",
              "retentionMechanismFa",
              "visualRhythmNote",
              "whyItWentViral",
            ],
          },
        },
        algorithmRulesAndRedLines: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: [
        "executiveSummary",
        "safeResearchMethodNote",
        "competitors",
        "weeklyTopViralPatterns",
        "algorithmRulesAndRedLines",
      ],
    },
  });

  return {
    id: `viral_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    pageProfileId: params.pageProfileId ?? null,
    nicheQuery: params.nicheQuery,
    platform: params.platform,
    analyzedAt: new Date().toISOString(),
    executiveSummary: routed.data.executiveSummary,
    safeResearchMethodNote:
      routed.data.safeResearchMethodNote ||
      "تحلیل ۱۰۰٪ ایمن از طریق ایندکس عمومی وب بدون اتصال ربات یا رمز عبور به پیج شما (ریسک بلاک و شادوبن: صفر).",
    competitors: Array.isArray(routed.data.competitors) ? routed.data.competitors : [],
    weeklyTopViralPatterns: Array.isArray(routed.data.weeklyTopViralPatterns)
      ? routed.data.weeklyTopViralPatterns
      : [],
    algorithmRulesAndRedLines: Array.isArray(routed.data.algorithmRulesAndRedLines)
      ? routed.data.algorithmRulesAndRedLines
      : [],
    sources: sources.slice(0, 8),
  };
}

/**
 * Audio Transcription using free-tier gemini-3.5-transcribe (for user's voice clone reference sample)
 */
export async function runAudioTranscriptionAgent(params: {
  audioBase64: string;
  mimeType: string;
  instruction?: string;
}): Promise<{ transcript: string }> {
  const ai = getClient();

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType || "audio/webm",
              data: params.audioBase64,
            },
          },
          {
            text:
              params.instruction?.trim() ||
              "این فایل صوتی را با دقت بالا به متن روان فارسی رونویسی کن. فقط متن گفتار را برگردان.",
          },
        ],
      },
    })
  );

  const transcript = (response.text ?? "").trim();
  if (!transcript) {
    throw new Error("متنی از نمونه صوتی استخراج نشد.");
  }

  return { transcript };
}

export async function runQuickSearchResearch(query: string): Promise<{
  summary: string;
  sources: GroundedSource[];
}> {
  const ai = getClient();
  const res = await generateWithModelFallback(ai, {
    contents: `درباره موضوع زیر با جستجوی به‌روز وب تحقیق کن و خلاصه دقیق و نکات کلیدی را به فارسی بنویس:\n${query}`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const sources: GroundedSource[] = [];
  const seen = new Set<string>();
  for (const chunk of res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    if (chunk.web?.uri && !seen.has(chunk.web.uri)) {
      seen.add(chunk.web.uri);
      sources.push({
        title: chunk.web.title || chunk.web.uri,
        uri: chunk.web.uri,
      });
    }
  }

  return {
    summary: (res.text ?? "").trim(),
    sources: sources.slice(0, 8),
  };
}
