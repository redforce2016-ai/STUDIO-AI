import { GoogleGenAI, Type } from "@google/genai";
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
import { executeAgentJsonWithRouter, getGoogleApiKeyFromRouter } from "./router.js";
import { saveAudioFile, saveImageFile, saveVideoFile, saveVisualSvgFile } from "./store.js";

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
 * Calls primary text model ('gemini-4-hydrogen') and automatically falls back
 * to 'gemini-3.1-flash-lite' when daily free-tier quota on hydrogen is exhausted.
 */
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
  try {
    const ai = getClient();
    const searchRes = await generateWithModelFallback(ai, {
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

  try {
    const ai = getClient();
    const searchRes = await generateWithModelFallback(ai, {
      contents: searchPrompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    groundedSummaryText = searchRes.text ?? "";
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
    groundedSummaryText = `تحلیل و پژوهش تخصصی موضوع "${brief.title}" با تمرکز بر: ${brief.idea}`;
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
  existingNarrationText?: string
): Promise<VoiceoverOutput> {
  const toneName = TONE_LABELS[brief.tone];

  let narrationText = existingNarrationText?.trim() ?? "";
  let resolvedStyle = voiceStyle?.trim() || "گوینده حرفه‌ای، گرم، رسا و پرانرژی فارسی";
  let pacingNotes = "مکث کوتاه بعد از قلاب برای جلب توجه، ریتم پیوسته و تاکید روی اعداد کلیدی.";
  let estimatedSeconds: number = brief.targetDurationSeconds;

  if (!narrationText) {
    const adaptPrompt = `شما ایجنت گوینده و کارگردان صدای حرفه‌ای فارسی هستید.
سناریوی زیر را برای خوانش صوتی (Voiceover) آماده کنید تا روی ریتم ${brief.targetDurationSeconds} ثانیه‌ای کاملاً طبیعی، محاوره‌ای-استاندارد و تاثیرگذار شنیده شود.

عنوان: ${script.videoTitle}
لحن هدف: ${toneName}
قلاب: ${script.hook}
بدنه: ${script.body}
دعوت به اقدام: ${script.cta}
${feedback ? `بازخورد اصلاحی کاربر: ${feedback}` : ""}

نکات مهم:
- متن نریشن را یکدست و آماده خوانش بنویسید.
- برای تنظیم مکث‌های تنفس و تاکید، در نقاط مناسب از نشانگرهایی مانند [مکث کوتاه] یا [مکث ۰.۵ ثانیه] استفاده کنید.
- تمام اعداد را به‌صورت حروفی و روان برای تلفظ صحیح گوینده بنویسید.`;

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
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      })
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
 * Agent 3: Director / Decoupage Agent
 */
export async function runDirectorAgent(
  script: ResearchAndScriptOutput,
  voiceover: VoiceoverOutput,
  brief: ProjectBrief,
  feedback?: string
): Promise<DirectorOutput> {
  const desiredShotCount = brief.targetDurationSeconds <= 30 ? "۵ تا ۶" : brief.targetDurationSeconds <= 45 ? "۶ تا ۷" : "۷ تا ۸";

  const formatName = brief.contentFormat
    ? CONTENT_FORMAT_LABELS[brief.contentFormat]
    : PLATFORM_LABELS[brief.platform] || "ویدیوی کوتاه";

  const prompt = `شما کارگردان و طراح دکوپاژ حرفه‌ای محتوای شبکه‌های اجتماعی هستید.
بر اساس سناریو و متن نریشن تاییدشده، کل محتوا را متناسب با فرمت «${formatName}» به ${desiredShotCount} شات/فریم دقیق و سینمایی بشکنید.
تمام خروجی‌ها باید به زبان فارسی دقیق و حرفه‌ای باشد.

عنوان ویدیو: ${script.videoTitle}
پلتفرم: ${PLATFORM_LABELS[brief.platform] || brief.platform} (${formatName})
مدت‌زمان هدف: ${brief.targetDurationSeconds} ثانیه
متن نریشن:
${voiceover.narrationText}
${feedback ? `بازخورد اصلاحی کاربر برای دکوپاژ: ${feedback}` : ""}

الزامات هر شات:
- shotNumber: شماره ترتیبی شات (۱، ۲، ...)
- timecode: بازه زمانی دقیق به فرمت "00:00 - 00:05"
- durationSeconds: مدت زمان شات به ثانیه
- cameraAngle: زاویه و قاب دوربین به فارسی
- cameraMovement: حرکت دوربین به فارسی
- sceneDescriptionFa: شرح کامل صحنه، سوژه، پس‌زمینه و اکشن داخل کادر به فارسی
- spokenSegment: بخش دقیق نریشن که در این شات شنیده می‌شود
- onScreenText: متن کوتاه و کوبنده زیرنویس یا تیتر روی تصویر (حداکثر ۵ کلمه فارسی)
- lightingAndMood: نورپردازی و اتمسفر رنگی صحنه به فارسی
- visualPromptFa: دستور تصویرسازی دقیق و غنی به فارسی برای ساخت استوری‌بورد شات`;

  const routedDirector = await executeAgentJsonWithRouter<DirectorOutput>({
    agentId: "director",
    prompt: `${prompt}\n\nخروجی باید یک JSON Object دقیق شامل کلیدهای "visualDirectionSummary", "totalEstimatedSeconds" و آرایه "shots" (دارای shotNumber, timecode, durationSeconds, cameraAngle, cameraMovement, sceneDescriptionFa, spokenSegment, onScreenText, lightingAndMood, visualPromptFa) باشد.`,
    systemInstruction:
      "شما کارگردان تصویربرداری و دکوپاژ هستید. مجموع durationSeconds شات‌ها باید نزدیک به مدت‌زمان هدف ویدیو باشد و زمان‌بندی‌ها کاملاً پیوسته و بدون همپوشانی باشند.",
    expectedKeys: ["visualDirectionSummary", "totalEstimatedSeconds", "shots"],
    googleResponseSchema: {
      type: Type.OBJECT,
      properties: {
        visualDirectionSummary: {
          type: Type.STRING,
          description: "خلاصه کارگردانی بصری، ریتم تدوین و هویت رنگی کل ویدیو به فارسی",
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
            ],
          },
        },
      },
      required: ["visualDirectionSummary", "totalEstimatedSeconds", "shots"],
    },
  });

  return routedDirector.data;
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

function buildFallbackStoryboardShot(projectId: string, shot: DirectorShot, err?: unknown): VisualAssetShot {
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
    status: "ready",
    error: err ? formatGeminiError(err) : null,
  };
}

/**
 * Agent 4 (Batch): Generate all storyboard shots in ONE single Gemini request to save quota!
 */
export async function runVisualProducerBatch(
  projectId: string,
  shots: DirectorShot[],
  directionSummary: string,
  feedback?: string
): Promise<VisualAssetShot[]> {
  const shotsBrief = shots
    .map(
      (s) =>
        `شات ${s.shotNumber}: زاویه=${s.cameraAngle} | حرکت=${s.cameraMovement} | صحنه=${s.sceneDescriptionFa} | نور=${s.lightingAndMood} | دستور=${s.visualPromptFa}`
    )
    .join("\n");

  const prompt = `شما طراح استوری‌بورد سینمایی و کارگردان هنری هستید.
برای همه ${shots.length} شات زیر، استوری‌بورد وکتوری (SVG) لایه‌لایه، زیبا و متمایز در کادر عمودی 360x640 (نسبت ۹:۱۶) بسازید.

سبک کلی پروژه: ${directionSummary}
${feedback ? `درخواست اصلاحی کاربر: ${feedback}` : ""}

فهرست شات‌ها:
${shotsBrief}

الزامات فنی خروجی:
- در svgElements هر شات فقط عناصر داخلی SVG (مانند <rect>, <circle>, <ellipse>, <path>, <polygon>, <g>, <line>) در مختصات 360x640 بنویسید. از تگ <svg> بیرونی یا <script> یا متن استفاده نکنید.
- برای هر شات ترکیب‌بندی منحصربه‌فرد (پس‌زمینه، عمق میانی، سوژه اصلی، نورپردازی حجمی و فلش حرکت دوربین) طراحی کنید.`;

  try {
    const routedVisuals = await executeAgentJsonWithRouter<
      Array<{
        shotNumber: number;
        bgTop: string;
        bgMid: string;
        bgBottom: string;
        svgElements: string;
        motionCue: string;
        colorPaletteNote: string;
      }>
    >({
      agentId: "visuals",
      prompt: `${prompt}\n\nخروجی باید دقیقاً یک آرایه JSON شامل آبجکت‌هایی با فیلدهای زیر باشد: shotNumber, bgTop, bgMid, bgBottom, svgElements, motionCue, colorPaletteNote.`,
      expectArray: true,
      googleResponseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            shotNumber: { type: Type.INTEGER },
            bgTop: { type: Type.STRING },
            bgMid: { type: Type.STRING },
            bgBottom: { type: Type.STRING },
            svgElements: { type: Type.STRING },
            motionCue: { type: Type.STRING },
            colorPaletteNote: { type: Type.STRING },
          },
          required: [
            "shotNumber",
            "bgTop",
            "bgMid",
            "bgBottom",
            "svgElements",
            "motionCue",
            "colorPaletteNote",
          ],
        },
      },
    });

    const parsedList = Array.isArray(routedVisuals.data) ? routedVisuals.data : [];

    const hexRegex = /^#[0-9A-Fa-f]{6}$/;

    return shots.map((shot) => {
      const match = parsedList.find((item) => item.shotNumber === shot.shotNumber);
      if (!match) return buildFallbackStoryboardShot(projectId, shot);

      const palette: [string, string, string] = [
        hexRegex.test(match.bgTop) ? match.bgTop : "#0F172A",
        hexRegex.test(match.bgMid) ? match.bgMid : "#1E293B",
        hexRegex.test(match.bgBottom) ? match.bgBottom : "#090B10",
      ];
      const fullSvg = wrapStoryboardSvg(match.svgElements || "", shot, palette);
      const filename = `${projectId}_shot_${shot.shotNumber}_${Date.now()}.svg`;
      const imageUrl = saveVisualSvgFile(filename, fullSvg);

      return {
        shotNumber: shot.shotNumber,
        imageUrl,
        svgMarkup: fullSvg,
        motionCue: match.motionCue,
        colorPaletteNote: match.colorPaletteNote,
        status: "ready",
        error: null,
      };
    });
  } catch (err) {
    return shots.map((shot) => buildFallbackStoryboardShot(projectId, shot, err));
  }
}

/**
 * Agent 4 (Single Shot): Regenerate a specific storyboard frame on demand
 */
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
  const ai = getClient();
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

  const response = await ai.models.generateContent({
    model: "gemini-nano-banana-2.1",
    contents: { parts },
    config: config as never,
  });

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
 * Studio Video Generation (Text-to-Video & Image-to-Video) using gemini-omni-1.2-flash via Interactions API
 */
export async function runStudioVideoAgent(params: {
  prompt: string;
  aspectRatio?: "16:9" | "9:16";
  duration?: "5s" | "8s" | "10s" | "15s";
  resolution?: "720p" | "1080p";
  imageBase64?: string;
  mimeType?: string;
}): Promise<{ videoUrl: string; mimeType: string }> {
  const ai = getClient();

  const input = params.imageBase64
    ? [
        {
          type: "image" as const,
          mime_type: params.mimeType || "image/png",
          data: params.imageBase64,
        },
        {
          type: "text" as const,
          text: params.prompt,
        },
      ]
    : params.prompt;

  const interaction = await ai.interactions.create(
    {
      model: "gemini-omni-1.2-flash",
      input: input as never,
      background: false,
      store: false,
      stream: false,
      response_format: {
        type: "video",
        aspect_ratio: params.aspectRatio || "16:9",
        duration: params.duration || "8s",
        resolution: params.resolution || "720p",
      } as never,
    },
    { timeout: 300000 }
  );

  const videoPart = interaction.output_video;
  if (!videoPart || !videoPart.data) {
    throw new Error("مدل ویدیوساز Omni 1.2 Flash فایل ویدیویی برنگرداند.");
  }

  const videoBuffer = Buffer.from(videoPart.data, "base64");
  const filename = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`;
  const videoUrl = saveVideoFile(filename, videoBuffer);

  return {
    videoUrl,
    mimeType: videoPart.mime_type || "video/mp4",
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
              "این فایل صوتی را با دقت بالا به متن روان و مرتب (به زبان فارسی یا زبان گفتار داخل فایل) پیاده‌سازی و رونویسی کنید. فقط متن رونویسی‌شده را برگردانید.",
          },
        ],
      },
    })
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
  const ai = getClient();
  const res = await generateWithModelFallback(ai, {
    contents: `درباره موضوع زیر با جستجوی به‌روز وب تحقیق کن و خلاصه دقیق، آمار و نکات کلیدی را به فارسی روان بنویس:\n${query}`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const sources: GroundedSource[] = [];
  const seen = new Set<string>();
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
    summary: (res.text ?? "").trim(),
    sources: sources.slice(0, 8),
  };
}
