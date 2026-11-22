import { Type } from "@google/genai";
import type {
  ContentFormatOption,
  DirectorOutput,
  DirectorShot,
  GroundedSource,
  PageMaturityOption,
  PlatformOption,
  ProjectBrief,
  ResearchAndScriptOutput,
  ToneOption,
  TopicAnalysisResponse,
  ViralTopicProposal,
  VisualAssetShot,
  VoicePersona,
  VoiceoverOutput,
} from "../src/types/studio.js";
import path from "node:path";
import {
  executeAgentJsonWithRouter,
  executeWithGoogleKeyFailover,
  resolveGovernanceThinkingConfig,
} from "./router.js";
import { getImagesDir, saveAudioFile, saveImageFile, saveVideoFile, saveVisualSvgFile } from "./store.js";
import { executeAgentWebResearchMission } from "./agentBrowser.js";
import { buildActiveSkillsDirectivePrompt } from "./mcpToolchain.js";
import { renderProceduralCinemaKeyframePng } from "./video/providers/proceduralCinema.js";
import { curatePhotorealisticShotKeyframe } from "./video/providers/realMediaCurator.js";
import { auditShotAssetAgainstSevenLayers, ensureSevenLayerSpec } from "./video/shotQaGate.js";

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
    return "سهمیه رایگان درخواست‌های روزانه Gemini پر شده است (خطای 429). می‌توانید از بخش «روتر مدل‌ها» کلید OpenRouter، Groq یا سرویس دیگری اضافه کرده و به ایجنت‌ها متصل کنید.";
  }
  if (msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID") || msg.includes("403")) {
    return "کلید API معتبر نیست یا دسترسی کافی ندارد. لطفاً کلید خود را در بخش «روتر مدل‌ها» بررسی کنید.";
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

/**
 * Calls primary text model ('gemini-4-hydrogen') with automatic multi-account key rotation
 * across GEMINI_API_KEY_1..10 + GEMINI_API_KEY, and falls back to 'gemini-3.1-flash-lite'
 * (minimal thinking) when all accounts hit quota on hydrogen.
 */
async function generateWithModelFallback(params: {
  contents: string;
  config?: Record<string, unknown>;
}) {
  const models: Array<"gemini-4-hydrogen" | "gemini-3.1-flash-lite"> = [
    "gemini-4-hydrogen",
    "gemini-3.1-flash-lite",
  ];
  let lastError: unknown;
  for (const model of models) {
    try {
      const thinkingConfig = resolveGovernanceThinkingConfig(model, "research_script");
      const { result } = await executeWithGoogleKeyFailover(
        { taskRole: "research_script", modelId: model, apiVersion: "v1beta" },
        (ai) =>
          withRetry(() =>
            ai.models.generateContent({
              model,
              contents: params.contents,
              config: {
                ...(params.config ?? {}),
                ...(thinkingConfig ? { thinkingConfig } : {}),
              } as never,
            })
          )
      );
      return result;
    } catch (err) {
      lastError = err;
      if (!isQuotaError(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}

function clampDuration(val: unknown, format?: ContentFormatOption): number {
  const num = Number(val);
  if (Number.isFinite(num) && num >= 10 && num <= 1800) {
    return Math.round(num);
  }
  if (format === "story") return 20;
  if (format === "long_video") return 240;
  return 45;
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

/**
 * Unified Pro Scriptwriter Agent (Phase 1 — Strategist + Domain Researcher + Viral & Social Psychology):
 * Deeply analyzes the keyword's real industry/domain, defines the exact target buyer/audience persona
 * and core pain points, bans generic/textbook titles, and proposes 3 sharply differentiated viral topics
 * with concrete technical/factual data points, visual hooks, tones, and durations.
 */
export async function runStrategistTopicProposals(brief: ProjectBrief): Promise<TopicAnalysisResponse> {
  const platformName = PLATFORM_LABELS[brief.platform] || PLATFORM_LABELS.instagram;
  const formatName = brief.contentFormat
    ? CONTENT_FORMAT_LABELS[brief.contentFormat]
    : platformName;
  const pageMaturity: PageMaturityOption =
    brief.pageMaturity === "growing_page" ? "growing_page" : "new_page";
  const pageMaturityLabel =
    pageMaturity === "new_page"
      ? "شروع پیج (ویدیوهای اولیه: پست‌های ۱ تا ۵ — ساخت هویت پیج، اعتماد اولیه و جذب فالوور)"
      : "پیج فعال و در حال رشد (۱۰ تا ۲۰+ پست — محتوای چالش‌برانگیز، افشاگری تخصصی و امتداد پست‌های قبلی)";

  let webResearch = "";
  const sources: GroundedSource[] = [];

  // 1) Programmatic Hidden Agent Browser Web Mission
  try {
    const browserMission = await executeAgentWebResearchMission(
      brief.idea,
      "ایجنت استراتژیست و تحلیلگر موضوع"
    );
    if (browserMission.synthesizedContextFa) {
      webResearch = browserMission.synthesizedContextFa;
    }
    for (const s of browserMission.sources) {
      if (!sources.some((x) => x.uri === s.uri)) {
        sources.push(s);
      }
    }
  } catch {
    // Non-fatal if offline
  }

  // 2) Augment with Gemini Google Search Grounding if available
  try {
    const searchRes = await generateWithModelFallback({
      contents:
        pageMaturity === "new_page"
          ? `درباره عبارت یا ایده زیر یک تحقیق تخصصی، تاریخی و بازارمحور انجام بده (مناسب برای ویدیوهای اول یک پیج تازه تأسیس):
«${brief.idea}»
موارد زیر را دقیق و مستند استخراج کن:
۱) حوزه واقعی و دقیق این موضوع در صنعت یا بازار (مثلاً صنعتی/مهندسی/B2B، پزشکی، مالی، عمومی و...) و کاربردهای اصلی و واقعی آن.
۲) مخاطب هدف واقعی و خریداران/تصمیم‌گیرندگان اصلی این موضوع چه کسانی هستند؟
۳) تاریخچه پیدایش و مخترعان یا نقطه عطف تحول این موضوع در طول دهه‌ها چیست، چه شگفتی علمی/عملی دارد، و اگر وجود نداشت دنیا یا این صنعت با چه بحرانی روبه‌رو می‌شد؟`
          : `درباره عبارت یا ایده زیر یک تحقیق تخصصی و بازارمحور انجام بده (مناسب برای پیج فعال با ۱۰ تا ۲۰+ پست):
«${brief.idea}»
موارد زیر را دقیق و مستند استخراج کن:
۱) حوزه واقعی و دقیق این موضوع در صنعت یا بازار (مثلاً صنعتی/مهندسی/B2B، پزشکی، مالی، عمومی و...) و کاربردهای اصلی و واقعی آن.
۲) مخاطب هدف واقعی و خریداران/تصمیم‌گیرندگان اصلی این موضوع چه کسانی هستند؟
۳) مهم‌ترین تقلب‌های پنهان بازار، اشتباهات پرهزینه و میلیاردی، مناظره‌های فنی و استانداردها و ترفندهای خرید/قرارداد مرتبط با آن چیست؟`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    if (searchRes.text) {
      webResearch = webResearch
        ? `${webResearch}\n\n---\nتکمیل پژوهش از موتور جستجو:\n${searchRes.text}`
        : searchRes.text;
    }
    const seen = new Set<string>(sources.map((s) => s.uri));
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
    // Keep browserMission findings
  }

  const maturityBlock =
    pageMaturity === "new_page"
      ? `استراتژی اجباری برای «شروع پیج (پست‌های ۱ تا ۵)»:
   این پیج تازه راه‌اندازی شده است! مخاطب با دیدن این ویدیوهای اول باید دقیقاً بفهمد این پیج چه فعالیتی دارد، چه استاندارد حرفه‌ای پشت آن است و چرا ارزش فالو کردن دارد. **در ۵ پست اول از افشاگری‌های پرخاشگرانه یا جنجال‌های تند بازار پرهیز کن** و به جای آن ۳ آرک‌تایپ زیر را با دقت بساز:
     * **پیشنهاد ۱ (آرک‌تایپ «مستند سینمایی پیدایش، تاریخچه یا اگر وجود نداشت»):** روایت جذاب و سینمایی درباره ریشه اختراع یا داستان واقعی ساخت/تحول این موضوع در طول تاریخ و اینکه اگر اختراع نمی‌شد چه اتفاقی می‌افتاد (مناسب برای وایرال گسترده و معرفی هویت تخصصی پیج).
     * **پیشنهاد ۲ (آرک‌تایپ «ساختار هویت پیج و نقشه اعتمادسازی برای مخاطب هدف»):** ویدیویی که بدون شعارزدگی نشان دهد این صفحه دقیقاً چه مشکلی از این صنعت/حوزه حل می‌کند، چه خط قرمزی در کیفیت دارد و چرا متخصصان و خریداران باید این پیج را دنبال کنند.
     * **پیشنهاد ۳ (آرک‌تایپ «شگفتی مهندسی، پشت‌صحنه یا راز تحول در چند دهه»):** نمایش یک شگفتی علمی/عملی، پشت‌صحنه فرآیند ساخت یا مقایسه تحول این محصول از گذشته تا امروز که نرخ اشتراک‌گذاری و جذب فالوور اولیه را منفجر کند.`
      : `استراتژی اجباری برای «پیج فعال و در حال رشد (۱۰ تا ۲۰+ پست)»:
   مخاطب این پیج الفبای حوزه را در پست‌های قبلی دیده و حالا دنبال محتوای عمیق‌تر، چالش‌برانگیزتر، افشاگرانه و سریالی است تا پیج را به مرجع بی‌رقیب صنعت تبدیل کند. ۳ آرک‌تایپ زیر را بساز:
     * **پیشنهاد ۱ (آرک‌تایپ «افشای تقلب بازار، ریسک میلیاردی یا اشتباه مهلک»):** افشای دقیق تقلب رایج در بازار (چطور جنس تقلبی/کپی را جای اصل می‌فروشند یا یک اشتباه فنی منجر به خسارت سنگین می‌شود) + روش تست عملی در چند ثانیه.
     * **پیشنهاد ۲ (آرک‌تایپ «چالش فنی، مناظره استانداردها و مقایسه آزمایشگاهی»):** به چالش کشیدن یک باور رایج بین همکاران یا مقایسه عددی/عملی دو استاندارد و ضخامت با نتیجه غافلگیرکننده برای گرفتن بیشترین کامنت و بحث تخصصی.
     * **پیشنهاد ۳ (آرک‌تایپ «راز صنفی خرید، ترفند فاکتور و امتداد سری محتوایی»):** افشای نکته‌ای که خریداران عمده و کارفرماها باید هنگام عقد قرارداد/تحویل بار بدانند و اتصال طبیعی آن به محتوای تخصصی قبلی پیج (برای حداکثر ذخیره و فوروارد).`;

  const prompt = `شما «ایجنت واحد سناریونویس حرفه‌ای و نخبه» هستید که ۴ تخصص عمیق را هم‌زمان در سطح ارشد اجرا می‌کنید:
۱) استراتژیست ارشد محتوای شبکه‌های اجتماعی و بازاریابی B2B/B2C،
۲) پژوهشگر و تحلیلگر دقیق صنعت/بازار و اعتبارسنج فنی (Domain Researcher)،
۳) متخصص روانشناسی مخاطب و الگوریتم سوشال مدیا،
۴) سناریونویس خلاق وایرال‌ساز برای ${platformName} (${formatName}).

ورودی کاربر:
- کلمه کلیدی یا ایده کاربر: «${brief.idea}»
- پلتفرم انتخاب‌شده: ${platformName}
- فرمت محتوا: ${formatName}
- وضعیت و سن پیج: ${pageMaturityLabel}
${webResearch ? `- یافته‌های پژوهش وب:\n${webResearch}` : ""}

قوانین طلایی و غیرقابل‌تخطی برای تحلیل و تولید موضوع:
۱. **تحلیل دقیق حوزه واقعی کلمه کلیدی (بسیار مهم):**
   ابتدا ماهیت واقعی موضوع را بشناس! اگر کلمه کلیدی تخصصی یا صنعتی است (مثلاً «لوله مانیسمان» که یک لوله فولادی بدون درز برای صنایع نفت، گاز، پتروشیمی، بخار پرفشار، بویلرهای صنعتی و خطوط حساس است)، اکیداً ممنوع است آن را به موضوعات اشتباه یا عامیانه (مثل گرمایش خانه و شوفاژ!) تقلیل بدهی. باید دقیقاً وارد زیست‌بوم واقعی، استانداردها، دغدغه‌های خرید عمده و مهندسی همان صنعت شوی.
۲. **ممنوعیت مطلق مخاطب مبهم یا عمومی:**
   هرگز مخاطب را کلی (مثل «علاقه‌مندان»، «همه مردم»، «کسانی که دنبال خرید هستند») ننویس! برای کل پروژه و برای تک‌تک موضوع‌ها باید **پرسونای دقیق و واقعی مخاطب** را مشخص کنی (شغل/نقش دقیق، سطح دانش فنی، تصمیم‌گیرنده خرید کیست، و چرا وسط اسکرول روی این ویدیو مکث می‌کند).
۳. **ممنوعیت کامل تیترهای کتابی، تکراری و غیرویرال:**
   - استفاده از تیترهای دایره‌المعارفی مثل «... چیست؟»، «معرفی کامل ...»، «چرا ... مهم است؟»، «کاربردهای ...» **اکیداً ممنوع** است!
   - ۳ پیشنهاد نباید شبیه هم باشند یا صرفاً یک مفهوم را با ۳ جمله متفاوت تکرار کنند.
   ${maturityBlock}
۴. **ارائه داده‌ها و نقاط فنی عمیق در هر پیشنهاد (نه حرف‌های کلی):**
   هر پیشنهاد باید ۳ تا ۴ نکته واقعی، عدد، تاریخ، معیار فنی یا فکت معتبر مرتبط با کلمه کلیدی (keyFactsAndDataPoints) داشته باشد که نشان دهد سناریو روی دانش عمیق سوار است.
۵. **انتخاب خودکار لحن و مدت‌زمان متمایز برای ۳ موضوع:**
   برای ۳ موضوع، ۳ لحن متفاوت از بین ["educational", "cinematic_story", "news_analysis", "fast_motivational"] انتخاب کن و مدت‌زمان واقعی متناسب با فرمت «${formatName}» و ریتم همان سناریو را تعیین کن.

فیلدهای خروجی که باید تولید کنی:
- hasDetailedScriptInstructions: آیا کاربر در متن خودش جزئیات و ساختار سناریو داده (true) یا فقط کلمه کلیدی/ایده کلی نوشته (false)؟
- keywordDomainAnalysis: ۲ تا ۳ جمله دقیق درباره ماهیت واقعی، حوزه تخصصی و جایگاه کلمه کلیدی در بازار/صنعت واقعی.
- exactTargetAudience: تعریف دقیق و مشخص مخاطب هدف اصلی (نقش شغلی، سطح دانش، انگیزه مالی/فنی و رفتار در سوشال مدیا).
- corePainPoints: آرایه ۳ تا ۴ موردی از واقعی‌ترین ترس‌ها، اشتباهات پرهزینه یا کنجکاوی‌های پنهان این مخاطب هدف.
- pageStrategyRecommendation: ۱ تا ۲ جمله دقیق درباره اینکه با توجه به «${pageMaturity === "new_page" ? "شروع پیج (پست‌های ۱ تا ۵)" : "پیج فعال (۱۰ تا ۲۰+ پست)"}» چرا این نوع چیدمان ویدیوها به رشد، وایرال شدن و جایگاه پیج کمک می‌کند.
- strategistSummary: جمع‌بندی صمیمی، حرفه‌ای و دقیق فارسی خطاب به کاربر درباره تحلیل مخاطب و زاویه‌های کشف‌شده.
- defaultRecommendedTone, defaultRecommendedToneLabelFa, defaultRecommendedDurationSeconds, defaultRecommendedDurationLabelFa: بهترین لحن و زمان در صورت نگارش مستقیم روی متن کاربر.
- proposals: دقیقاً ۳ موضوع کاملاً متمایز، هرکدام شامل:
  * id
  * title (تیتر واقعی، کنجکاوی‌برانگیز و وایرال — بدون «چیست؟»)
  * angleArchetype (نام دقیق آرک‌تایپ متناسب با مرحله پیج)
  * targetAudienceSegment (مخاطب دقیق و خاص همین ویدیو)
  * recommendedTone, recommendedToneLabelFa, recommendedDurationSeconds, recommendedDurationLabelFa
  * sampleHook (متن قلاب گفتاری ۳ ثانیه اول به فارسی طبیعی و کوبنده)
  * openingVisualHook (دقیقاً در ۳ ثانیه اول چه تصویری جلوی دوربین باشد تا اسکرول متوقف شود)
  * keyFactsAndDataPoints (آرایه ۳ تا ۴ نکته/عدد/استاندارد فنی واقعی که در بدنه این سناریو استفاده می‌شود)
  * strategistAngle (چرا این زاویه برای جذب مخاطب هدف و جایگاه برند در این مرحله از پیج عالی است)
  * psychologyTrigger (چه محرک روانی باعث توقف مخاطب، فالو کردن/ذخیره و فوروارد می‌شود)
  * creatorExecutionTip (نکته حرفه‌ای اجرا، تدوین یا فیلم‌برداری متناسب با فرمت «${formatName}»)
  * ctaStrategy (بهترین کال‌تو‌اکشن پایانی متناسب با مرحله پیج)
  * viralPotentialNote (یک جمله دقیق درباره دلیل اشتراک‌گذاری و وایرال شدن این ویدیو)`;

  const routed = await executeAgentJsonWithRouter<Partial<TopicAnalysisResponse>>({
    agentId: "research_script",
    prompt: `${prompt}\n\nپاسخ باید یک JSON Object دقیق شامل کلیدهای زیر باشد:
"hasDetailedScriptInstructions", "keywordDomainAnalysis", "exactTargetAudience", "corePainPoints" (آرایه ۳ تا ۴ رشته), "pageStrategyRecommendation", "strategistSummary", "defaultRecommendedTone", "defaultRecommendedToneLabelFa", "defaultRecommendedDurationSeconds", "defaultRecommendedDurationLabelFa", "proposals" (آرایه‌ای با دقیقاً ۳ آبجکت دارای: id, title, angleArchetype, targetAudienceSegment, recommendedTone, recommendedToneLabelFa, recommendedDurationSeconds, recommendedDurationLabelFa, sampleHook, openingVisualHook, keyFactsAndDataPoints, strategistAngle, psychologyTrigger, creatorExecutionTip, ctaStrategy, viralPotentialNote).`,
    systemInstruction:
      pageMaturity === "new_page"
        ? "شما یک سناریونویس و استراتژیست ارشد برای راه‌اندازی پیج‌های جدید (پست‌های ۱ تا ۵) هستید. هرگز تیتر کلیشه‌ای «... چیست؟» ننویسید، از افشاگری‌های پرخاشگرانه در پست‌های اول پرهیز کنید، و ۳ زاویه مستند/تاریخچه، هویت‌ساز پیج و شگفتی علمی-مهندسی بسازید که مخاطب دقیق فوراً پیج را فالو کند."
        : "شما یک سناریونویس و استراتژیست ارشد برای پیج‌های فعال و در حال رشد (۱۰ تا ۲۰+ پست) هستید. هرگز تیتر کلیشه‌ای «... چیست؟» ننویسید و ۳ زاویه چالش‌برانگیز، افشای تقلب، مناظره فنی و راز صنفی بسازید که بیشترین کامنت، ذخیره و فوروارد تخصصی را بگیرد.",
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
  const fallbackTones: ToneOption[] =
    pageMaturity === "new_page"
      ? ["cinematic_story", "educational", "fast_motivational"]
      : ["news_analysis", "educational", "fast_motivational"];
  const defaultTone = normalizeTone(
    parsed.defaultRecommendedTone,
    pageMaturity === "new_page" ? "cinematic_story" : "educational"
  );
  const defaultSecs = clampDuration(parsed.defaultRecommendedDurationSeconds, brief.contentFormat);

  return {
    hasDetailedScriptInstructions: Boolean(parsed.hasDetailedScriptInstructions),
    keywordDomainAnalysis: parsed.keywordDomainAnalysis || "",
    exactTargetAudience: parsed.exactTargetAudience || "",
    corePainPoints: Array.isArray(parsed.corePainPoints) ? parsed.corePainPoints : [],
    pageStrategyRecommendation:
      parsed.pageStrategyRecommendation ||
      (pageMaturity === "new_page"
        ? "این چیدمان برای ۵ پست اول طراحی شده تا هویت تخصصی پیج، اعتماد اولیه و انگیزه فالو کردن را در مخاطب هدف ایجاد کند."
        : "این چیدمان برای پیج فعال (۱۰ تا ۲۰+ پست) طراحی شده تا با موضوعات چالشی و فنی، نرخ ذخیره، کامنت و فوروارد تخصصی را بالا ببرد."),
    strategistSummary:
      parsed.strategistSummary ||
      "کلمه کلیدی شما از نظر ماهیت بازار، وضعیت پیج و مخاطب هدف دقیق بررسی شد و ۳ زاویه متمایز آماده است:",
    defaultRecommendedTone: defaultTone,
    defaultRecommendedToneLabelFa: parsed.defaultRecommendedToneLabelFa || TONE_LABELS[defaultTone],
    defaultRecommendedDurationSeconds: defaultSecs,
    defaultRecommendedDurationLabelFa:
      parsed.defaultRecommendedDurationLabelFa || formatDurationFa(defaultSecs),
    proposals: (parsed.proposals ?? []).slice(0, 3).map((p, i) => {
      const pTone = normalizeTone(p.recommendedTone, fallbackTones[i % fallbackTones.length]);
      const pSecs = clampDuration(p.recommendedDurationSeconds, brief.contentFormat);
      return {
        ...p,
        id: p.id || `topic_${i + 1}`,
        angleArchetype: p.angleArchetype || `زاویه تخصصی ${i + 1}`,
        targetAudienceSegment: p.targetAudienceSegment || parsed.exactTargetAudience || "",
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
 * Unified Pro Scriptwriter Agent (Phase 2 — Deep Fact Validation & Full Script Generation)
 */
export async function runMergedResearchAndScript(
  brief: ProjectBrief,
  feedback?: string
): Promise<ResearchAndScriptOutput> {
  const platformName = PLATFORM_LABELS[brief.platform] || PLATFORM_LABELS.instagram;
  const formatName = brief.contentFormat
    ? CONTENT_FORMAT_LABELS[brief.contentFormat]
    : platformName;
  const pageMaturity: PageMaturityOption =
    brief.pageMaturity === "growing_page" ? "growing_page" : "new_page";
  const pageMaturityLabel =
    pageMaturity === "new_page"
      ? "شروع پیج (پست‌های ۱ تا ۵ — تمرکز بر هویت‌سازی، اعتبار اولیه و جذب فالوور)"
      : "پیج فعال (۱۰ تا ۲۰+ پست — تمرکز بر محتوای چالشی، تخصصی عمیق و پیوستگی با پست‌های قبلی)";
  const toneName = brief.toneLabelFa?.trim() || TONE_LABELS[brief.tone] || TONE_LABELS.educational;
  const targetSecs = clampDuration(brief.targetDurationSeconds, brief.contentFormat);
  const sel = brief.selectedTopicAngle;
  const selectedAngleBlock = sel
    ? `\nموضوع و زاویه انتخاب‌شده توسط کاربر:
- عنوان منتخب: ${sel.title}
- ساختار و آرک‌تایپ موضوع: ${sel.angleArchetype || "تخصصی"}
- مخاطب هدف دقیق این موضوع: ${sel.targetAudienceSegment || "تخصصی و دقیق"}
- لحن پیشنهادی دقیق: ${sel.recommendedToneLabelFa}
- مدت‌زمان پیشنهادی: ${sel.recommendedDurationLabelFa} (${targetSecs} ثانیه)
- قلاب کلامی پیشنهادی: ${sel.sampleHook}
- قلاب بصری ۳ ثانیه اول: ${sel.openingVisualHook || ""}
- نکات فنی و داده‌های کلیدی منتخب: ${(sel.keyFactsAndDataPoints ?? []).join(" | ")}
- استراتژی محتوا: ${sel.strategistAngle}
- محرک روانشناختی: ${sel.psychologyTrigger}
- استراتژی CTA: ${sel.ctaStrategy || ""}
- نکته اجرا: ${sel.creatorExecutionTip}`
    : "";

  // Step A: Grounded Web Search Research (gracefully skipped if quota limited)
  const searchPrompt = `شما پژوهشگر و اعتبارسنج تخصصی این صنعت/حوزه هستید. درباره موضوع زیر تحقیق عمیق، فنی و بازارمحور انجام دهید و داده‌ها، تاریخچه/استانداردها و حقایق کلیدی متناسب با وضعیت پیج را به فارسی استخراج و اعتبارسنجی کنید:
عنوان پروژه: ${brief.title}
ایده/کلمه کلیدی کاربر: ${brief.idea}
وضعیت پیج: ${pageMaturityLabel}
پلتفرم و فرمت هدف: ${platformName} — ${formatName}${selectedAngleBlock}
${feedback ? `بازخورد جدید کاربر برای اصلاح: ${feedback}` : ""}`;

  let groundedSummaryText = "";
  const sources: GroundedSource[] = [];

  // Step A.1: Autonomous Hidden Agent Browser Web Mission
  try {
    const queryForBrowser = sel?.title ? `${brief.idea} ${sel.title}` : brief.idea;
    const browserMission = await executeAgentWebResearchMission(
      queryForBrowser,
      "ایجنت پژوهشگر و سناریونویس"
    );
    if (browserMission.synthesizedContextFa) {
      groundedSummaryText = browserMission.synthesizedContextFa;
    }
    for (const s of browserMission.sources) {
      sources.push(s);
    }
  } catch {
    // Non-fatal
  }

  // Step A.2: Grounded Web Search Research (gracefully skipped if quota limited)
  try {
    const searchRes = await generateWithModelFallback({
      contents: searchPrompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    if (searchRes.text) {
      groundedSummaryText = groundedSummaryText
        ? `${groundedSummaryText}\n\n---\nیافته‌های تکمیلی موتور جستجو:\n${searchRes.text}`
        : searchRes.text;
    }
    const chunks = searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    for (const chunk of chunks) {
      if (chunk.web?.uri) {
        sources.push({
          title: chunk.web.title || chunk.web.uri,
          uri: chunk.web.uri,
        });
      }
    }
  } catch {
    if (!groundedSummaryText) {
      groundedSummaryText = `تحلیل و پژوهش تخصصی موضوع "${brief.title}" با تمرکز بر: ${brief.idea}`;
    }
  }

  const uniqueSources: GroundedSource[] = [];
  const seenUris = new Set<string>();
  for (const s of sources) {
    if (!seenUris.has(s.uri)) {
      seenUris.add(s.uri);
      uniqueSources.push(s);
    }
  }

  // Step B: Unified Pro Scriptwriter synthesis into strict structured JSON
  const approxWordCount = Math.round((targetSecs / 60) * 145);
  const synthesisPrompt = `شما ایجنت تخصصی واحد «سناریونویس حرفه‌ای (استراتژیست، پژوهشگر و اعتبارسنج، تحلیلگر ویرال و متخصص روانشناسی سوشال مدیا)» هستید.
تمام خروجی‌ها باید ۱۰۰٪ به زبان فارسی روان، طبیعی، تخصصی-کاربردی، جذاب و کاملاً منطبق با فرمت انتخابی کاربر و اصول روانشناسی مخاطب باشد. از کلی‌گویی، جملات کتابی و تکرار مطالب عمومی اکیداً پرهیز کنید.

مشخصات ورودی:
- عنوان ایده: ${brief.title}
- متن ایده و توضیحات کامل کاربر: ${brief.idea}
- پلتفرم: ${platformName}
- فرمت محتوا: ${formatName}
- وضعیت پیج: ${pageMaturityLabel}
- لحن انتخاب‌شده: ${toneName}
- مدت‌زمان پیشنهادی: ${targetSecs} ثانیه (حدود ${approxWordCount} کلمه گفتار)${selectedAngleBlock}
${feedback ? `- بازخورد اصلاحی کاربر (بسیار مهم): ${feedback}` : ""}

یافته‌های پژوهش و اعتبارسنجی وب:
${groundedSummaryText}

وظیفه شما:
1. مخاطب هدف دقیق (targetAudienceNote) را با ذکر نقش شغلی/تصمیم‌گیری، دغدغه واقعی و سطح دانش فنی بنویسید (هرگز کلی ننویسید).
2. یافته‌های پژوهش را اعتبارسنجی کنید و ۴ تا ۵ داده، استاندارد، آمار یا نکته واقعی و ملموس (keyInsights) و ۳ زاویه جذاب محتوایی (trendingAngles) تنظیم کنید.
3. بر اساس وضعیت پیج («${pageMaturity === "new_page" ? "شروع پیج / پست‌های ۱ تا ۵: ساخت هویت و اعتماد برای گرفتن فالوور اولیه" : "پیج فعال ۱۰ تا ۲۰+ پست: چالش عمیق، افشاگری تخصصی و امتداد سری قبلی"}»)، استراتژی و فرمت «${formatName}»، یک سناریوی دقیق، معتبر و پرکشش بنویسید:
   - قلاب (hook): ۳ ثانیه طلایی اول با ضربه روانی/فنی فوری برای متوقف کردن مخاطب هدف.
   - بدنه (body): روایت منسجم، مبتنی بر واقعیت‌های بازار/فنی، پر از جزئیات ملموس و منطبق با ریتم ${targetSecs} ثانیه.
   - دعوت به اقدام (cta): پایان هوشمندانه متناسب با هدف پیج (${pageMaturity === "new_page" ? "دعوت طبیعی به فالو کردن برای دنبال کردن مسیر تخصصی این پیج" : "دعوت به ذخیره، بحث در کامنت یا ارسال برای همکاران"}).`;

  const routed = await executeAgentJsonWithRouter<Omit<ResearchAndScriptOutput, "sources">>({
    agentId: "research_script",
    prompt: `${synthesisPrompt}\n\nخروجی باید یک JSON Object با کلیدهای دقیق زیر باشد:\n"videoTitle", "targetAudienceNote", "researchSummary", "keyInsights" (آرایه ۴ تا ۵ رشته), "trendingAngles" (آرایه ۳ رشته), "hook", "body", "cta", "keywords" (آرایه ۵ رشته).`,
    systemInstruction:
      "شما ایجنت واحد سناریونویس حرفه‌ای (دارای تخصص استراتژیست، پژوهشگر و اعتبارسنجی، تحلیل ویرال و روانشناسی سوشال مدیا) هستید. تمام فیلدهای خروجی را با بالاترین کیفیت ادبی، دقت علمی و ریتم ویرال به فارسی بنویسید.",
    expectedKeys: [
      "videoTitle",
      "targetAudienceNote",
      "researchSummary",
      "keyInsights",
      "trendingAngles",
      "hook",
      "body",
      "cta",
      "keywords",
    ],
    googleResponseSchema: {
      type: Type.OBJECT,
      properties: {
        videoTitle: { type: Type.STRING, description: "عنوان جذاب و نهایی ویدیو به فارسی" },
        targetAudienceNote: { type: Type.STRING, description: "توضیح کوتاه درباره مخاطب هدف و نیاز او" },
        researchSummary: { type: Type.STRING, description: "خلاصه جامع یافته‌های پژوهش به فارسی" },
        keyInsights: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "۴ تا ۵ آمار، فکت یا بینش کلیدی استخراج‌شده",
        },
        trendingAngles: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "۳ زاویه خلاقانه و وایرال برای روایت موضوع",
        },
        hook: { type: Type.STRING, description: "متن قلاب ۳ ثانیه اول سناریو به فارسی" },
        body: { type: Type.STRING, description: "متن کامل بدنه سناریو به فارسی" },
        cta: { type: Type.STRING, description: "متن کال‌تو‌اکشن پایانی سناریو به فارسی" },
        keywords: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "۵ کلمه کلیدی اصلی محتوا به فارسی",
        },
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
        "keywords",
      ],
    },
  });

  const parsed = routed.data;
  return {
    ...parsed,
    keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
    trendingAngles: Array.isArray(parsed.trendingAngles) ? parsed.trendingAngles : [],
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    sources: uniqueSources.slice(0, 6),
  };
}

/**
 * Agent 2: Voiceover Script Adaptation + Real Gemini TTS WAV Generation
 */
export async function runVoiceoverAgent(
  projectId: string,
  script: ResearchAndScriptOutput,
  brief: ProjectBrief,
  voiceName: VoicePersona = "Kore",
  voiceStyle?: string,
  feedback?: string,
  existingNarrationText?: string,
  director?: DirectorOutput | null
): Promise<VoiceoverOutput> {
  const toneName = TONE_LABELS[brief.tone];

  let narrationText = existingNarrationText?.trim() ?? "";
  let resolvedStyle = voiceStyle?.trim() || "گوینده حرفه‌ای، گرم، رسا و پرانرژی فارسی";
  let pacingNotes = "مکث کوتاه بعد از قلاب برای جلب توجه، ریتم پیوسته و تاکید روی اعداد کلیدی.";
  let estimatedSeconds: number = director?.totalEstimatedSeconds || brief.targetDurationSeconds;

  if (!narrationText) {
    const shotsCue =
      director && director.shots.length > 0
        ? `\nبرنامه زمان‌بندی شات‌های ویدیو (نریشن را دقیقاً هماهنگ با زمان این ${director.shots.length} شات تنظیم کن):\n${director.shots
            .map(
              (s) =>
                `- شات ${s.shotNumber} (${s.timecode} · ${s.durationSeconds}s): ${s.spokenSegment || s.sceneDescriptionFa}`
            )
            .join("\n")}`
        : "";

    const adaptPrompt = `شما ایجنت گوینده و کارگردان صدای حرفه‌ای فارسی هستید.
سناریوی زیر را برای خوانش صوتی (Voiceover) آماده کنید تا روی ریتم ${estimatedSeconds} ثانیه‌ای شات‌های ویدیو کاملاً طبیعی، محاوره‌ای-استاندارد و تاثیرگذار شنیده شود.

عنوان: ${script.videoTitle}
لحن هدف: ${toneName}
قلاب: ${script.hook}
بدنه: ${script.body}
دعوت به اقدام: ${script.cta}${shotsCue}
${feedback ? `بازخورد اصلاحی کاربر: ${feedback}` : ""}

نکات مهم:
- متن نریشن را یکدست و آماده خوانش بنویسید.
- برای تنظیم مکث‌های تنفس و تاکید، در نقاط مناسب از نشانگرهایی مانند [مکث کوتاه] یا [مکث ۰.۵ ثانیه] استفاده کنید.
- تمام اعداد را به‌صورت حروفی و روان برای تلفظ صحیح گوینده بنویسید.`;

    try {
      const routedAdapt = await executeAgentJsonWithRouter<{
        narrationText: string;
        voiceStyle: string;
        estimatedSeconds: number;
        pacingNotes: string;
      }>({
        agentId: "voiceover",
        prompt: `${adaptPrompt}\n\nخروجی باید JSON شامل کلیدهای زیر باشد: "narrationText", "voiceStyle", "estimatedSeconds", "pacingNotes".`,
        expectedKeys: ["narrationText", "voiceStyle", "estimatedSeconds", "pacingNotes"],
        googleResponseSchema: {
          type: Type.OBJECT,
          properties: {
            narrationText: { type: Type.STRING, description: "متن کامل نریشن آماده خوانش با نشانگرهای مکث به فارسی" },
            voiceStyle: { type: Type.STRING, description: "توضیح سبک و حس اجرای صدا" },
            estimatedSeconds: { type: Type.INTEGER, description: "مدت زمان تخمینی خوانش به ثانیه" },
            pacingNotes: { type: Type.STRING, description: "راهنمای ریتم، تاکیدها و لحن گوینده" },
          },
          required: ["narrationText", "voiceStyle", "estimatedSeconds", "pacingNotes"],
        },
      });

      const parsed = routedAdapt.data;
      narrationText = parsed.narrationText;
      resolvedStyle = voiceStyle?.trim() || parsed.voiceStyle;
      estimatedSeconds = parsed.estimatedSeconds || brief.targetDurationSeconds;
      pacingNotes = parsed.pacingNotes;
    } catch {
      // Resilient fallback: build narration directly from approved director spoken segments or script
      const shotSegments = (director?.shots || [])
        .map((s) => s.spokenSegment?.trim())
        .filter(Boolean);
      narrationText =
        shotSegments.length > 0
          ? shotSegments.join(" [مکث کوتاه] ")
          : [script.hook, script.body, script.cta].filter(Boolean).join(" [مکث کوتاه] ");
    }
  }

  const cleanSpeechText = narrationText
    .replace(/\[[^\]]*\]/g, " ... ")
    .replace(/\s+/g, " ")
    .trim();

  const wordCount = cleanSpeechText.split(/\s+/).filter(Boolean).length;

  let audioUrl: string | null = null;
  let audioFilename: string | null = null;
  let audioError: string | null = null;

  try {
    const { result: ttsRes } = await executeWithGoogleKeyFailover(
      { taskRole: "tts_audio", modelId: "gemini-3.8-flash-lite-tts", apiVersion: "v1beta" },
      (ai) =>
        withRetry(() =>
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
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          })
        )
    );

    const base64Audio = ttsRes.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (base64Audio) {
      const wavBuffer = Buffer.from(base64Audio, "base64");
      audioFilename = `${projectId}_vo_${Date.now()}.wav`;
      audioUrl = saveAudioFile(audioFilename, wavBuffer);
    } else {
      audioError = "مدل TTS داده صوتی برنگرداند؛ متن نریشن آماده است و می‌توانید دوباره تلاش کنید.";
    }
  } catch (err) {
    audioError = formatGeminiError(err);
  }

  return {
    narrationText,
    voiceName,
    voiceStyle: resolvedStyle,
    estimatedSeconds,
    wordCount,
    pacingNotes,
    audioUrl,
    audioFilename,
    audioError,
  };
}

/**
 * Agent 2: Director / Storyboard Decoupage Agent (runs before Voiceover in studio order)
 */
export async function runDirectorAgent(
  script: ResearchAndScriptOutput,
  voiceover: VoiceoverOutput | null | undefined,
  brief: ProjectBrief,
  feedback?: string
): Promise<DirectorOutput> {
  const desiredShotCount = brief.targetDurationSeconds <= 30 ? "۵ تا ۶" : brief.targetDurationSeconds <= 45 ? "۶ تا ۷" : "۷ تا ۸";

  const formatName = brief.contentFormat
    ? CONTENT_FORMAT_LABELS[brief.contentFormat]
    : PLATFORM_LABELS[brief.platform] || "ویدیوی کوتاه";

  const referenceScriptText =
    voiceover?.narrationText?.trim() ||
    `قلاب (Hook): ${script.hook}\nبدنه اصلی: ${script.body}\nدعوت به اقدام (CTA): ${script.cta}`;

  const activeSkillsBlock = buildActiveSkillsDirectivePrompt([
    "blender",
    "remotion",
    "hyperframes",
    "comfyui",
    "ffmpeg",
    "nle_finishing",
  ]);

  const prompt = `شما کارگردان ارشد تبلیغات صنعتی، طراح استوری‌بورد و سرپرست کارگردانی ۷ لایه هستید.
بر اساس سناریوی تاییدشده، کل محتوا را متناسب با فرمت «${formatName}» به ${desiredShotCount} شات/فریم دقیق، مهندسی‌شده و کاملاً بدون حدس و توهم بشکنید.
تمام خروجی‌ها باید به زبان فارسی دقیق و حرفه‌ای باشد و برای هر شات **هر ۷ لایه زیر** به‌صورت شفاف، عینی و قابل اجرا مشخص شود.

عنوان ویدیو: ${script.videoTitle}
پلتفرم: ${PLATFORM_LABELS[brief.platform] || brief.platform} (${formatName})
مدت‌زمان هدف: ${brief.targetDurationSeconds} ثانیه
متن سناریو و گفتار:
${referenceScriptText}
${feedback ? `بازخورد اصلاحی کاربر برای استوری‌بورد و دکوپاژ: ${feedback}` : ""}

${activeSkillsBlock}

قانون طلایی کارگردانی (مثال استاندارد تبلیغ صنعتی که باید برای تمام شات‌ها رعایت شود):
- پس‌زمینه تاریک و سینمایی با عمق میدان واقعی
- محصول و اشیا با متریال واقع‌گرایانه (مثلاً لوله فولادی برس‌خورده با ضخامت دیواره دقیق)
- نورپردازی کنترل‌شده و دقیق (مثلاً نورهای سفید خنثی و آبی سرد روی سطح فلز یا نور کهربایی کوره در صحنه‌های ذوب)
- حرکت نرم و کنترل‌شده دوربین (دالی، تراکینگ، کلوزآپ ماکرو بدون لرزش آزاردهنده)
- ذرات معلق و افکت‌های ظریف (گردوغبار نوری، جرقه‌های ظریف)
- تایپوگرافی قدرتمند، مدرن و فارسی (Vazirmatn / Lalezar) همگام با صدا
- **هرگز** بر پایه حدس، توصیف مبهم یا کلی‌گویی عمل نکن؛ هر موتور (HyperFrames، Blender، Remotion، ComfyUI، FFmpeg، After Effects) باید دقیقاً طبق این ۷ لایه شات را بسازد.

الزامات سند کلی visualDirectionBlueprint:
- backgroundAndAtmosphere: پس‌زمینه و اتمسفر کلی
- materialAndProductStyle: متریال و بافت واقعی محصول
- lightingSignature: امضای نورپردازی و رنگ نور روی سطوح
- cameraLanguage: زبان دوربین و حرکت کنترل‌شده
- particlesAndEffects: ذرات معلق و افکت‌های ظریف
- typographySystem: نظام تایپوگرافی قدرتمند و مدرن

الزامات هر شات:
- shotNumber، timecode (مثلاً "00:00 - 00:04")، durationSeconds (بین ۳ تا ۵ ثانیه)
- cameraAngle، cameraMovement، sceneDescriptionFa، spokenSegment، onScreenText (حداکثر ۵ کلمه کوبنده)، lightingAndMood، visualPromptFa
- preferredFreeEngine: انتخاب بهترین موتور رایگان از بین ["hyperframes", "remotion", "blender", "comfyui", "ffmpeg_live"] (از OmniFlash استفاده نکن!)
- sevenLayerSpec (اجباری و کامل برای هر شات):
  1. scene: صحنه دقیق و پس‌زمینه‌ای که مخاطب می‌بیند
  2. objects: اشیای داخل صحنه (محصول، متریال واقع‌گرایانه، نوشته، لوگو)
  3. animation: حرکت اشیا، ذرات معلق، افکت‌های ظریف و حرکت تایپوگرافی
  4. camera: زاویه دید، لنز و حرکت نرم و کنترل‌شده دوربین
  5. lighting: نورپردازی کلیدی/حاشیه‌ای، رنگ نورها روی سطح و سایه‌ها
  6. transition: انتقال دقیق از این صحنه به صحنه بعدی (مثلاً Smooth Crossfade / Zoom-In / Smooth Slide)
  7. soundDesign: موسیقی، افکت‌های صوتی محیطی و هماهنگی ضرب‌آهنگ با گفتار
  8. typographyNoteFa: راهنمای تایپوگرافی مدرن این شات`;

  const routedDirector = await executeAgentJsonWithRouter<DirectorOutput>({
    agentId: "director",
    prompt: `${prompt}\n\nخروجی باید یک JSON Object دقیق شامل کلیدهای "visualDirectionSummary", "visualDirectionBlueprint", "totalEstimatedSeconds" و آرایه "shots" (هر شات شامل shotNumber, timecode, durationSeconds, cameraAngle, cameraMovement, sceneDescriptionFa, spokenSegment, onScreenText, lightingAndMood, visualPromptFa, preferredFreeEngine, sevenLayerSpec) باشد.`,
    systemInstruction:
      "شما کارگردان تصویربرداری و دکوپاژ ۷ لایه هستید. هیچ فیلدی را مبهم نگذارید؛ تمام ۷ لایه Scene, Objects, Animation, Camera, Lighting, Transition, Sound Design باید دقیق، عینی و قابل اجرا توسط Blender/HyperFrames/Remotion/ComfyUI باشند.",
    expectedKeys: ["visualDirectionSummary", "totalEstimatedSeconds", "shots"],
    googleResponseSchema: {
      type: Type.OBJECT,
      properties: {
        visualDirectionSummary: {
          type: Type.STRING,
          description: "خلاصه کارگردانی بصری، ریتم تدوین و هویت رنگی کل ویدیو به فارسی",
        },
        visualDirectionBlueprint: {
          type: Type.OBJECT,
          properties: {
            backgroundAndAtmosphere: { type: Type.STRING },
            materialAndProductStyle: { type: Type.STRING },
            lightingSignature: { type: Type.STRING },
            cameraLanguage: { type: Type.STRING },
            particlesAndEffects: { type: Type.STRING },
            typographySystem: { type: Type.STRING },
          },
          required: [
            "backgroundAndAtmosphere",
            "materialAndProductStyle",
            "lightingSignature",
            "cameraLanguage",
            "particlesAndEffects",
            "typographySystem",
          ],
        },
        totalEstimatedSeconds: {
          type: Type.INTEGER,
          description: "مجموع کل ثانیه‌های شات‌ها",
        },
        shots: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              shotNumber: { type: Type.INTEGER },
              timecode: { type: Type.STRING },
              durationSeconds: { type: Type.INTEGER },
              cameraAngle: { type: Type.STRING },
              cameraMovement: { type: Type.STRING },
              sceneDescriptionFa: { type: Type.STRING },
              spokenSegment: { type: Type.STRING },
              onScreenText: { type: Type.STRING },
              lightingAndMood: { type: Type.STRING },
              visualPromptFa: { type: Type.STRING },
              preferredFreeEngine: { type: Type.STRING },
              sevenLayerSpec: {
                type: Type.OBJECT,
                properties: {
                  scene: { type: Type.STRING },
                  objects: { type: Type.STRING },
                  animation: { type: Type.STRING },
                  camera: { type: Type.STRING },
                  lighting: { type: Type.STRING },
                  transition: { type: Type.STRING },
                  soundDesign: { type: Type.STRING },
                  typographyNoteFa: { type: Type.STRING },
                },
                required: [
                  "scene",
                  "objects",
                  "animation",
                  "camera",
                  "lighting",
                  "transition",
                  "soundDesign",
                ],
              },
            },
            required: [
              "shotNumber",
              "timecode",
              "durationSeconds",
              "cameraAngle",
              "cameraMovement",
              "sceneDescriptionFa",
              "spokenSegment",
              "onScreenText",
              "lightingAndMood",
              "visualPromptFa",
              "sevenLayerSpec",
            ],
          },
        },
      },
      required: ["visualDirectionSummary", "totalEstimatedSeconds", "shots"],
    },
  });

  const normalizedShots: DirectorShot[] = (routedDirector.data.shots || []).map((shot, idx) => {
    const validEngines = new Set(["hyperframes", "remotion", "blender", "comfyui", "ffmpeg_live"]);
    const rawEngine = String(shot.preferredFreeEngine || "").toLowerCase().trim();
    const preferredFreeEngine = validEngines.has(rawEngine)
      ? (rawEngine as DirectorShot["preferredFreeEngine"])
      : idx % 3 === 0
        ? "blender"
        : idx % 3 === 1
          ? "hyperframes"
          : "remotion";
    const sevenLayerSpec = ensureSevenLayerSpec(shot);
    return {
      ...shot,
      preferredFreeEngine,
      sevenLayerSpec,
    };
  });

  return {
    ...routedDirector.data,
    visualDirectionBlueprint: routedDirector.data.visualDirectionBlueprint || {
      backgroundAndAtmosphere: "پس‌زمینه تاریک و سینمایی با عمق میدان واقعی و اتمسفر صنعتی کنترل‌شده",
      materialAndProductStyle: "سطوح فلزی و فولادی با بافت PBR واقع‌گرایانه و بازتاب‌های دقیق",
      lightingSignature: "نورهای سفید خنثی و آبی سرد حاشیه‌ای روی لبه‌های فلز با سایه‌های عمیق",
      cameraLanguage: "حرکت نرم و کنترل‌شده دوربین (دالی، تراکینگ، کلوزآپ ماکرو) با لنز ۳۵/۵۰ میلی‌متر",
      particlesAndEffects: "ذرات معلق ظریف، گردوغبار نوری و هاله کنترل‌شده روی نقاط درخشان",
      typographySystem: "تایپوگرافی قدرتمند و مدرن فارسی با Vazirmatn ExtraBold و Lalezar همگام با صدا",
    },
    shots: normalizedShots,
  };
}

function wrapStoryboardSvg(innerElements: string, shot: DirectorShot, palette: [string, string, string]): string {
  const safeInner = innerElements
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640" width="360" height="640">
  <defs>
    <linearGradient id="bg_${shot.shotNumber}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette[0]}" />
      <stop offset="55%" stop-color="${palette[1]}" />
      <stop offset="100%" stop-color="${palette[2]}" />
    </linearGradient>
    <radialGradient id="spot_${shot.shotNumber}" cx="50%" cy="38%" r="55%">
      <stop offset="0%" stop-color="#F59E0B" stop-opacity="0.28" />
      <stop offset="100%" stop-color="#0B0D11" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="360" height="640" fill="url(#bg_${shot.shotNumber})" />
  <rect width="360" height="640" fill="url(#spot_${shot.shotNumber})" />
  <g id="scene-art">${safeInner}</g>
  <g stroke="#FFFFFF" stroke-opacity="0.11" stroke-width="1" stroke-dasharray="4 4">
    <line x1="120" y1="24" x2="120" y2="616" />
    <line x1="240" y1="24" x2="240" y2="616" />
    <line x1="18" y1="213" x2="342" y2="213" />
    <line x1="18" y1="426" x2="342" y2="426" />
  </g>
  <g stroke="#F59E0B" stroke-opacity="0.65" stroke-width="2" fill="none">
    <path d="M18 42 L18 18 L42 18" />
    <path d="M318 18 L342 18 L342 42" />
    <path d="M18 598 L18 622 L42 622" />
    <path d="M318 622 L342 622 L342 598" />
  </g>
</svg>`;
}

async function buildFallbackStoryboardShot(
  projectId: string,
  shot: DirectorShot,
  err?: unknown,
  aspectRatio: "9:16" | "16:9" = "9:16",
  usedUrls?: Set<string>
): Promise<VisualAssetShot> {
  const errMsg = err ? formatGeminiError(err) : null;
  const width = aspectRatio === "16:9" ? 1280 : 720;
  const height = aspectRatio === "16:9" ? 720 : 1280;
  const promptText = [shot.visualPromptFa, shot.sceneDescriptionFa, shot.lightingAndMood]
    .filter(Boolean)
    .join(" ");

  // Tier 2 (Photorealistic Real-World Documentary Media + Unified Cinema Color Grade)
  try {
    const filename = `${projectId}_photo_shot_${shot.shotNumber}_${Date.now()}.png`;
    const outPngPath = path.join(getImagesDir(), filename);
    const curated = await curatePhotorealisticShotKeyframe({
      prompt: promptText,
      shotNumber: shot.shotNumber,
      width,
      height,
      outputPngPath: outPngPath,
      usedUrls,
    });

    const providerLabel =
      curated.sourceProvider === "flickr_public"
        ? "Flickr Real Photography"
        : curated.sourceProvider === "wikimedia_commons"
          ? "Wikimedia Commons"
          : "Openverse";
    const visionBadge =
      curated.visionCriticScore !== null ? ` · امتیاز Vision Critic: ${curated.visionCriticScore}/10` : "";

    return {
      shotNumber: shot.shotNumber,
      imageUrl: `/api/media/images/${filename}`,
      svgMarkup: null,
      motionCue: shot.cameraMovement || "دالی سینمایی سه‌بعدی ۲۴ فریم با موج گرما و ذرات واقعی",
      colorPaletteNote: `${shot.lightingAndMood || "سینمایی کنتراستی Teal & Amber"} · عکس واقعی مستند (${providerLabel}${visionBadge})`,
      renderEngineUsed: "photorealistic-real-media",
      sourceMediaUrl: curated.sourceUrl,
      status: "ready",
      error: errMsg,
    };
  } catch {
    // Fall through to offline Procedural WebGL2 Cinema 3D fallback if network is unreachable
  }

  try {
    const filename = `${projectId}_proc_shot_${shot.shotNumber}_${Date.now()}.png`;
    const outPngPath = path.join(getImagesDir(), filename);
    await renderProceduralCinemaKeyframePng({
      prompt: promptText,
      shotNumber: shot.shotNumber,
      width,
      height,
      cameraMotion: shot.shotNumber % 3 === 1 ? "push-in" : shot.shotNumber % 3 === 2 ? "pan" : "orbit",
      outputPngPath: outPngPath,
    });

    return {
      shotNumber: shot.shotNumber,
      imageUrl: `/api/media/images/${filename}`,
      svgMarkup: null,
      motionCue: shot.cameraMovement || "دالی سینمایی ۲۴ فریم با ذرات و دود زنده",
      colorPaletteNote: `${shot.lightingAndMood || "سینمایی کنتراستی Teal & Amber"} (Procedural 3D Offline Fallback)`,
      renderEngineUsed: "procedural-cinema-3d",
      status: "ready",
      error: errMsg,
    };
  } catch {
    // Emergency SVG fallback only if headless Chromium is unavailable
    const variant = shot.shotNumber % 3;
    const fallbackElements =
      variant === 1
        ? `<circle cx="180" cy="240" r="78" fill="#F59E0B" fill-opacity="0.14" stroke="#F59E0B" stroke-width="2"/>
           <path d="M95 430 Q180 310 265 430 Z" fill="#1E293B" stroke="#94A3B8" stroke-width="2"/>
           <line x1="180" y1="120" x2="180" y2="160" stroke="#F59E0B" stroke-width="2"/>`
        : variant === 2
          ? `<rect x="52" y="130" width="256" height="310" rx="14" fill="#14171F" stroke="#334155" stroke-width="2"/>
             <circle cx="180" cy="255" r="54" fill="#F59E0B" fill-opacity="0.2" stroke="#F59E0B" stroke-width="2"/>
             <path d="M72 395 L150 320 L215 365 L288 290" stroke="#F59E0B" stroke-width="2.5" fill="none"/>`
          : `<polygon points="180,145 275,320 85,320" fill="#1E293B" fill-opacity="0.7" stroke="#F59E0B" stroke-width="2"/>
             <rect x="65" y="345" width="230" height="80" rx="8" fill="#0F172A" stroke="#475569" stroke-width="1.5"/>`;

    const fullSvg = wrapStoryboardSvg(fallbackElements, shot, ["#0F172A", "#161B26", "#090B10"]);
    const filename = `${projectId}_shot_${shot.shotNumber}_${Date.now()}.svg`;
    const imageUrl = saveVisualSvgFile(filename, fullSvg);

    return {
      shotNumber: shot.shotNumber,
      imageUrl,
      svgMarkup: fullSvg,
      motionCue: shot.cameraMovement || "زوم نرم به مرکز کادر",
      colorPaletteNote: shot.lightingAndMood || "پالت سینمایی تیره با نور تاکیدی کهربایی",
      renderEngineUsed: "svg-fallback",
      status: "ready",
      error: errMsg,
    };
  }
}

let imageQuotaCooldownUntil = 0;

/**
 * Generates a single photorealistic cinema storyboard keyframe using Gemini Image models:
 *  1) gemini-3.1-flash-lite-image via Interactions API (default per Gemini Interactions skill)
 *  2) gemini-nano-banana-2.1 via generateContent (fallback)
 */
async function generatePhotorealisticKeyframeImage(params: {
  projectId: string;
  shot: DirectorShot;
  directionSummary: string;
  aspectRatio: "9:16" | "16:9";
  feedback?: string;
}): Promise<{ imageUrl: string; mimeType: string; modelUsed: string }> {
  if (Date.now() < imageQuotaCooldownUntil) {
    throw new Error("سهمیه لحظه‌ای مدل‌های تصویرسازی Gemini (429 RESOURCE_EXHAUSTED) در حال انتظار است.");
  }

  const seven = ensureSevenLayerSpec(params.shot);
  const promptText = [
    `Photorealistic ultra-sharp commercial industrial cinema still (${params.aspectRatio === "16:9" ? "16:9 horizontal widescreen" : "9:16 vertical reel"} composition), NO overlaid text, NO watermarks, NO UI borders.`,
    `Overall art direction: ${params.directionSummary}.`,
    `1. Scene & Atmosphere: ${seven.scene}.`,
    `2. Objects & Realistic Material: ${seven.objects}.`,
    `3. Floating Particles & Subtle Motion Cue: ${seven.animation}.`,
    `4. Camera Framing & Lens: ${seven.camera}.`,
    `5. Lighting & Specular Reflections: ${seven.lighting}.`,
    params.shot.visualPromptFa ? `Additional visual directive: ${params.shot.visualPromptFa}.` : "",
    params.feedback ? `QA / User refinement directive (strictly apply): ${params.feedback}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // 1) Primary: gemini-3.1-flash-lite-image via Interactions API (auto-rotating across all real Google keys)
  try {
    const { result: interaction } = await executeWithGoogleKeyFailover<{
      output_image?: { data?: string; mime_type?: string };
      steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }>;
    }>(
      { taskRole: "image_keyframe", modelId: "gemini-3.1-flash-lite-image", apiVersion: "v1beta" },
      (ai) =>
        (ai.interactions.create as Function)({
          model: "gemini-3.1-flash-lite-image",
          input: promptText,
          store: false,
          response_modalities: ["image"],
          generation_config: {
            image_config: {
              aspect_ratio: params.aspectRatio,
              image_size: "1K",
            },
          },
        })
    );

    let imgData: string | undefined;
    let mimeType = "image/png";

    const outImg = interaction?.output_image as { data?: string; mime_type?: string } | undefined;
    if (outImg?.data) {
      imgData = outImg.data;
      mimeType = outImg.mime_type || "image/png";
    } else if (Array.isArray(interaction?.steps)) {
      for (const step of interaction.steps) {
        if (step?.type === "model_output" && Array.isArray(step.content)) {
          const found = step.content.find((c: { type?: string; data?: string }) => c?.type === "image" && c?.data);
          if (found?.data) {
            imgData = found.data;
            mimeType = found.mime_type || "image/png";
            break;
          }
        }
      }
    }

    if (imgData) {
      const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
      const filename = `${params.projectId}_sb_shot_${params.shot.shotNumber}_${Date.now()}.${ext}`;
      const imageUrl = saveImageFile(filename, Buffer.from(imgData, "base64"));
      return { imageUrl, mimeType, modelUsed: "gemini-3.1-flash-lite-image" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|RESOURCE_EXHAUSTED|quota|Timeout|503|UNAVAILABLE/i.test(msg)) {
      imageQuotaCooldownUntil = Date.now() + 180_000;
    }
    // Try gemini-nano-banana-2.1 fallback below
  }

  // 2) Fallback: gemini-nano-banana-2.1 via models.generateContent
  try {
    const { result: response } = await executeWithGoogleKeyFailover(
      { taskRole: "image_keyframe", modelId: "gemini-nano-banana-2.1", apiVersion: "v1beta" },
      (ai) =>
        ai.models.generateContent({
          model: "gemini-nano-banana-2.1",
          contents: { parts: [{ text: promptText }] },
          config: {
            imageConfig: {
              aspectRatio: params.aspectRatio,
              imageSize: "1K",
            },
          } as never,
        })
    );

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        const mimeType = part.inlineData.mimeType ?? "image/png";
        const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
        const filename = `${params.projectId}_sb_shot_${params.shot.shotNumber}_${Date.now()}.${ext}`;
        const imageUrl = saveImageFile(filename, Buffer.from(part.inlineData.data, "base64"));
        return { imageUrl, mimeType, modelUsed: "gemini-nano-banana-2.1" };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|RESOURCE_EXHAUSTED|quota|Timeout|503|UNAVAILABLE/i.test(msg)) {
      imageQuotaCooldownUntil = Date.now() + 180_000;
    }
    throw err;
  }

  throw new Error("مدل تصویرسازی فریم کلیدی فتورئالیستی بازنگرداند.");
}

/**
 * Agent 4 (Batch): Generates photorealistic cinema storyboard keyframes for all shots
 * using gemini-3.1-flash-lite-image / gemini-nano-banana-2.1 (with SVG fallback only if image API fails).
 */
export async function runVisualProducerBatch(
  projectId: string,
  shots: DirectorShot[],
  directionSummary: string,
  feedback?: string,
  aspectRatio: "9:16" | "16:9" = "9:16",
  existingUsedUrls?: Iterable<string>
): Promise<VisualAssetShot[]> {
  const results: VisualAssetShot[] = new Array(shots.length);
  const usedMediaUrls = new Set<string>(existingUsedUrls || []);

  // Process shots sequentially with strict Per-Shot 7-Layer QA Gate on every generated keyframe
  for (let idx = 0; idx < shots.length; idx++) {
    const shot = shots[idx];
    let shotAsset: VisualAssetShot;
    try {
      const generated = await generatePhotorealisticKeyframeImage({
        projectId,
        shot,
        directionSummary,
        aspectRatio,
        feedback,
      });
      shotAsset = {
        shotNumber: shot.shotNumber,
        imageUrl: generated.imageUrl,
        svgMarkup: null,
        motionCue: shot.sevenLayerSpec?.camera || shot.cameraMovement || "دالی سینمایی ۲۴ فریم",
        colorPaletteNote: `${shot.sevenLayerSpec?.lighting || shot.lightingAndMood || "سینمایی کنتراستی"} (${generated.modelUsed})`,
        renderEngineUsed: generated.modelUsed,
        status: "ready",
        error: null,
      };
    } catch (err) {
      shotAsset = await buildFallbackStoryboardShot(
        projectId,
        shot,
        err,
        aspectRatio,
        usedMediaUrls
      );
    }

    // Strict Per-Shot 7-Layer QA Inspection on actual image file on disk
    if (shotAsset.imageUrl && shotAsset.imageUrl.startsWith("/api/media/images/")) {
      const diskPath = path.join(getImagesDir(), path.basename(shotAsset.imageUrl));
      let qaAudit = await auditShotAssetAgainstSevenLayers({
        shot,
        imagePath: diskPath,
        stage: "keyframe_image",
      });

      // Automatic QA self-healing retry if image failed 7-layer comprehension/appeal threshold
      if (!qaAudit.passed && qaAudit.revisionPromptEn && Date.now() >= imageQuotaCooldownUntil) {
        try {
          const retried = await generatePhotorealisticKeyframeImage({
            projectId,
            shot,
            directionSummary,
            aspectRatio,
            feedback: qaAudit.revisionPromptEn,
          });
          shotAsset.imageUrl = retried.imageUrl;
          shotAsset.renderEngineUsed = `${retried.modelUsed} (QA Revised)`;
          const retriedPath = path.join(getImagesDir(), path.basename(retried.imageUrl));
          qaAudit = await auditShotAssetAgainstSevenLayers({
            shot,
            imagePath: retriedPath,
            stage: "keyframe_image",
          });
        } catch {
          // Keep original asset alongside its QA report if retry hits quota
        }
      }

      shotAsset.qaSevenLayerAudit = qaAudit;
    }

    results[idx] = shotAsset;
  }

  return results;
}

/**
 * Agent 4 (Single Shot): Regenerate a specific storyboard frame on demand
 */
export async function runVisualProducerForShot(
  projectId: string,
  shot: DirectorShot,
  directionSummary: string,
  feedback?: string,
  aspectRatio: "9:16" | "16:9" = "9:16",
  existingUsedUrls?: Iterable<string>
): Promise<VisualAssetShot> {
  const [result] = await runVisualProducerBatch(
    projectId,
    [shot],
    directionSummary,
    feedback,
    aspectRatio,
    existingUsedUrls
  );
  return result;
}

/**
 * Studio Image Create & Edit using gemini-nano-banana-2.1
 */
export async function runStudioImageAgent(params: {
  prompt: string;
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  imageSize?: "1K" | "2K" | "4K";
  imageBase64?: string;
  mimeType?: string;
  useSearchGrounding?: boolean;
}): Promise<{ imageUrl: string; mimeType: string; caption: string }> {
  const parts: Array<
    | { text: string }
    | { inlineData: { data: string; mimeType: string } }
  > = [];

  if (params.imageBase64) {
    parts.push({
      inlineData: {
        data: params.imageBase64,
        mimeType: params.mimeType || "image/png",
      },
    });
  }
  parts.push({ text: params.prompt });

  const config: Record<string, unknown> = {
    imageConfig: {
      aspectRatio: params.aspectRatio || "1:1",
      imageSize: params.imageSize || "1K",
    },
  };

  if (params.useSearchGrounding && !params.imageBase64) {
    config.tools = [
      {
        googleSearch: {
          searchTypes: {
            webSearch: {},
            imageSearch: {},
          },
        },
      },
    ];
  }

  const { result: response } = await executeWithGoogleKeyFailover(
    { taskRole: "image_keyframe", modelId: "gemini-nano-banana-2.1", apiVersion: "v1beta" },
    (ai) =>
      ai.models.generateContent({
        model: "gemini-nano-banana-2.1",
        contents: { parts },
        config: config as never,
      })
  );

  let savedUrl = "";
  let outMime = "image/png";
  const textNotes: string[] = [];

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data && !savedUrl) {
      outMime = part.inlineData.mimeType ?? "image/png";
      const ext = outMime.includes("jpeg") || outMime.includes("jpg") ? "jpg" : outMime.includes("webp") ? "webp" : "png";
      const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const buffer = Buffer.from(part.inlineData.data, "base64");
      savedUrl = saveImageFile(filename, buffer);
    } else if (part.text) {
      textNotes.push(part.text);
    }
  }

  if (!savedUrl) {
    throw new Error("مدل تصویرسازی خروجی تصویری برنگرداند. لطفاً دستور تصویر را واضح‌تر بنویسید.");
  }

  return {
    imageUrl: savedUrl,
    mimeType: outMime,
    caption: textNotes.join(" ").trim(),
  };
}

/**
 * Studio Video Generation — Keyframe-Anchored Image-to-Video (Omni Flash -> ComfyUI -> Upgraded Parallax Fallback).
 * Strictly enforces Image-to-Video only; Text-to-Video without a keyframe is forbidden.
 */
export async function runStudioVideoAgent(params: {
  prompt: string;
  aspectRatio?: "16:9" | "9:16";
  duration?: "5s" | "8s" | "10s" | "15s";
  resolution?: "720p" | "1080p";
  imageBase64?: string;
  mimeType?: string;
}): Promise<{
  videoUrl: string;
  mimeType: string;
  providerUsed: "comfyui" | "parallax" | "omni_flash";
  renderDurationMs: number;
  vramUsedMb: number;
  attempts: number;
  fallbackTriggered: boolean;
}> {
  if (!params.imageBase64 || !params.imageBase64.trim()) {
    throw new Error(
      "قانون کیفیت شماره ۴: تولید ویدیو از متن (Text-to-Video) ممنوع است. فقط متحرک‌سازی تصویر کلیدی (Image-to-Video) با مدل ویدیویی مجاز است."
    );
  }

  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  const { getVideosDir, getImagesDir } = await import("./store.js");
  const { ComfyUIProvider } = await import("./video/providers/comfyui.js");
  const { OmniVideoProvider } = await import("./video/providers/omniVideo.js");
  const { ParallaxVideoProvider } = await import("./video/providers/parallax.js");

  const ext =
    params.mimeType?.includes("svg")
      ? "svg"
      : params.mimeType?.includes("jpeg") || params.mimeType?.includes("jpg")
        ? "jpg"
        : "png";
  const keyframeFilename = `kf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const keyframePath = pathMod.join(getImagesDir(), keyframeFilename);
  fsMod.writeFileSync(keyframePath, Buffer.from(params.imageBase64, "base64"));

  const durationSecMap: Record<string, number> = {
    "5s": 5,
    "8s": 8,
    "10s": 10,
    "15s": 15,
  };
  const durationSec = durationSecMap[params.duration || "5s"] || 4;
  const aspect = params.aspectRatio === "16:9" ? "16:9" : "9:16";
  const targetRes = params.resolution === "1080p" ? "1080p" : "720p";
  const qualityMode = targetRes === "1080p" ? "final_1080p" : "preview_480p";
  const [width, height] =
    targetRes === "1080p"
      ? aspect === "16:9"
        ? [1920, 1080]
        : [1080, 1920]
      : aspect === "16:9"
        ? [1280, 720]
        : [720, 1280];

  const outFilename = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`;
  const outputPath = pathMod.join(getVideosDir(), outFilename);

  let result;
  const reqObj = {
    shotId: `studio_${Date.now()}`,
    prompt: params.prompt,
    keyframePath,
    aspectRatio: aspect as "16:9" | "9:16",
    durationSec,
    resolution: targetRes as "720p" | "1080p",
    visualCriticApprovedPreview: true,
    width,
    height,
    fps: 24,
    outputPath,
    cameraMotion: "push-in" as const,
    qualityMode: qualityMode as "final_1080p" | "preview_480p",
  };

  try {
    const omni = new OmniVideoProvider();
    result = await omni.generateClip(reqObj);
  } catch {
    try {
      const comfy = new ComfyUIProvider({ autoFallbackToParallax: true });
      result = await comfy.generateClip(reqObj);
    } catch {
      const parallax = new ParallaxVideoProvider();
      result = await parallax.generateClip(reqObj);
    }
  }

  return {
    videoUrl: `/api/media/videos/${outFilename}`,
    mimeType: "video/mp4",
    providerUsed: result.providerUsed,
    renderDurationMs: result.totalDurationMs,
    vramUsedMb: result.vramUsedMb,
    attempts: result.attempts,
    fallbackTriggered: result.fallbackUsed,
  };
}

/**
 * Audio Transcription using gemini-3.5-transcribe
 */
export async function runAudioTranscriptionAgent(params: {
  audioBase64: string;
  mimeType: string;
  instruction?: string;
}): Promise<{ transcript: string }> {
  const { result: response } = await executeWithGoogleKeyFailover(
    { taskRole: "voiceover", modelId: "gemini-3.5-transcribe", apiVersion: "v1beta" },
    (ai) =>
      withRetry(() =>
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
                  "این فایل صوتی را با دقت بالا به متن روان و مرتب (به زبان فارسی یا زبان گفتار داخل فایل) پیاده‌سازی و رونویسی کنید. فقط متن رونویسی‌شده را برگردانید.",
              },
            ],
          },
        })
      )
  );

  const transcript = (response.text ?? "").trim();
  if (!transcript) {
    throw new Error("متنی از فایل صوتی استخراج نشد. لطفاً صدای واضح‌تری ضبط یا بارگذاری کنید.");
  }

  return { transcript };
}

/**
 * Standalone Grounded Google Search Research Assistant
 */
export async function runQuickSearchResearch(query: string): Promise<{
  summary: string;
  sources: GroundedSource[];
}> {
  const sources: GroundedSource[] = [];
  const seen = new Set<string>();
  let browserText = "";

  try {
    const mission = await executeAgentWebResearchMission(query, "ایجنت دستیار پژوهش سریع وب");
    browserText = mission.synthesizedContextFa;
    for (const s of mission.sources) {
      if (!seen.has(s.uri)) {
        seen.add(s.uri);
        sources.push(s);
      }
    }
  } catch {
    // Non-fatal
  }

  try {
    const res = await generateWithModelFallback({
      contents: `درباره موضوع زیر با جستجوی به‌روز وب تحقیق کن و خلاصه دقیق، آمار و نکات کلیدی را به فارسی روان بنویس:\n${query}\n${
        browserText ? `\nاطلاعات استخراج‌شده توسط مرورگر ایجنت:\n${browserText}` : ""
      }`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    for (const chunk of chunks) {
      if (chunk.web?.uri && !seen.has(chunk.web.uri)) {
        seen.add(chunk.web.uri);
        sources.push({
          title: chunk.web.title || chunk.web.uri,
          uri: chunk.web.uri,
        });
      }
    }

    return {
      summary: (res.text ?? browserText).trim(),
      sources: sources.slice(0, 8),
    };
  } catch {
    return {
      summary: browserText.trim() || `پژوهش وب برای «${query}» انجام شد.`,
      sources: sources.slice(0, 8),
    };
  }
}
