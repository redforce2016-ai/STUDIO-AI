import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentMemoryEntry,
  AgentSuperRole,
  CompetitorViralReport,
  MemoryCategory,
  MemoryScope,
  PageProfile,
  ProjectBrief,
  ProjectRecord,
  StageQualityAudit,
  StudioMediaAsset,
  VaultNote,
  VaultSnapshot,
} from "../src/types/studio.js";
import { upsertLearnedMemory } from "./agentMemory.js";
import { buildDaVinciPackageSummary } from "./davinciResolve.js";
import { buildVaultSnapshot, parseWikilinks, slugifyVaultTitle } from "./vaultEngine.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const VISUALS_DIR = path.join(DATA_DIR, "visuals");
const IMAGES_DIR = path.join(DATA_DIR, "images");
const VIDEOS_DIR = path.join(DATA_DIR, "videos");
const VAULT_DIR = path.join(DATA_DIR, "vault");

const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const ASSETS_FILE = path.join(DATA_DIR, "studio_assets.json");
const PAGES_FILE = path.join(DATA_DIR, "page_profiles.json");
const VIRAL_REPORTS_FILE = path.join(DATA_DIR, "viral_reports.json");
const MEMORIES_FILE = path.join(DATA_DIR, "agent_memories.json");
const CUSTOM_VAULT_NOTES_FILE = path.join(DATA_DIR, "vault_custom_notes.json");

function buildStarterWavBuffer(durationSec = 3): Buffer {
  const sampleRate = 24000;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t * 8) * Math.max(0, 1 - t / durationSec);
    const freq = i < numSamples / 2 ? 196 : 246.94;
    const sample = Math.round(Math.sin(2 * Math.PI * freq * t) * 3200 * envelope);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

function createStarterSvgFrame(
  shotNum: number,
  frameIdx: 1 | 2,
  accentHex: string,
  bgMidHex: string
): string {
  const offset = frameIdx === 1 ? 0 : 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640" width="360" height="640">
  <defs>
    <linearGradient id="g_${shotNum}_${frameIdx}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B0D11"/>
      <stop offset="55%" stop-color="${bgMidHex}"/>
      <stop offset="100%" stop-color="#090B10"/>
    </linearGradient>
  </defs>
  <rect width="360" height="640" fill="url(#g_${shotNum}_${frameIdx})"/>
  <circle cx="${165 + offset}" cy="${245 - offset / 2}" r="${74 + (frameIdx === 2 ? 14 : 0)}" fill="${accentHex}" fill-opacity="0.16" stroke="${accentHex}" stroke-width="2.5"/>
  <rect x="${58 + offset / 2}" y="350" width="244" height="110" rx="14" fill="#14171F" stroke="#334155" stroke-width="2"/>
  <path d="M84 ${420 - offset} L168 ${375 - offset / 2} L268 ${395 - offset}" stroke="${accentHex}" stroke-width="3" fill="none"/>
  <g stroke="#F59E0B" stroke-opacity="0.6" stroke-width="2" fill="none">
    <path d="M18 42 L18 18 L42 18"/>
    <path d="M318 18 L342 18 L342 42"/>
    <path d="M18 598 L18 622 L42 622"/>
    <path d="M318 622 L342 622 L342 598"/>
  </g>
</svg>`;
}

function createStarterPageProfiles(): PageProfile[] {
  const now = "2026-03-10T09:00:00.000Z";
  return [
    {
      id: "page_steel_b2b",
      name: "پیج فروش آهن‌آلات و مقاطع فولادی",
      handle: "@ahan.pro.b2b",
      platform: "instagram",
      defaultFormat: "reels",
      pageMaturity: "new_page",
      niche: "فروش تخصصی تیرآهن، میلگرد، ورق و لوله مانیسمان صنعتی",
      contentStyle: "مستند کارگاهی، تست واقعی مقاطع در انبار، افشای خطاهای خرید عمده بدون لحن زرد",
      targetAudiencePersona:
        "پیمانکاران ساختمانی، مدیران تدارکات پروژه‌های نفت و گاز، سازندگان سوله و خریداران عمده آهن‌آلات",
      audiencePainPoints: [
        "ترس از خرید لوله درزدار رنگ‌شده به جای لوله مانیسمان بدون درز",
        "اختلاف وزن باسکول با جدول اشتال و ضررهای چندصد میلیونی در تناژ بالا",
        "نوسان لحظه‌ای قیمت و تشخیص بار اصلی کارخانه از بار کارگاهی",
      ],
      brandTone: "news_analysis",
      brandToneNoteFa: "معتبر، مهندسی، صریح، باتجربه بازار آهن شادآباد و بدون اغراق تبلیغاتی",
      visualAestheticFa: "نورپردازی صنعتی کنتراست بالا، کلوزآپ بافت فولاد، زیرنویس کهربایی درشت و خوانا",
      tabooRedLines: [
        "ممنوعیت تیترهای کتابی مثل «لوله مانیسمان چیست؟»",
        "ممنوعیت اعلام قیمت ریالی ثابت داخل ویدیو (به دلیل نوسان روزانه ارز)",
      ],
      algorithmGuardrails: [
        "قلاب بصری در ۱.۵ ثانیه اول با نمایش واقعی مقطع فولادی یا کولیس دیجیتال",
        "میانگین طول هر شات بین ۳ تا ۶ ثانیه برای حفظ نرخ تماشای کامل بالای ۶۵٪",
      ],
      competitorHandles: ["@ahanonline", "@foolad_iranian", "@markazeahan"],
      voiceProfile: {
        speakerName: "صدای مدیر فنی پیج آهن‌آلات",
        voicePersona: "Charon",
        prosodyStyle: "صدای مردانه عمیق، قاطع، مطمئن و با مکث‌های دقیق روی اعداد مهندسی",
        sampleAudioUrl: "/api/media/audio/seed_voice_sample_steel.wav",
        sampleTranscript: "در خرید تناژ بالای مقاطع فولادی، یک میلی‌متر خطا یعنی صدها میلیون خسارت.",
        cloneEnginePreference: "gemini_persona",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "page_ai_tech",
      name: "پیج هوش مصنوعی و تکنولوژی روز",
      handle: "@ai.farsi.lab",
      platform: "instagram",
      defaultFormat: "reels",
      pageMaturity: "growing_page",
      niche: "ابزارهای رایگان هوش مصنوعی، اتوماسیون کسب‌وکار و اخبار تحول‌آفرین تک",
      contentStyle: "اسکرین‌رکورد سریع + مقایسه قبل و بعد + معرفی جایگزین‌های ۱۰۰٪ رایگان",
      targetAudiencePersona:
        "فریلنسرها، تولیدکنندگان محتوا، برنامه‌نویسان جوان و صاحبان کسب‌وکارهای آنلاین در ایران",
      audiencePainPoints: [
        "محدودیت پرداخت دلاری برای اشتراک ابزارهای هوش مصنوعی",
        "سردرگمی بین صدها ابزار تبلیغاتی بی‌کیفیت و نیاز به ابزار واقعاً رایگان و کاربردی",
      ],
      brandTone: "fast_motivational",
      brandToneNoteFa: "پرانرژی، مدرن، کاربردی، بدون اصطلاحات پیچیده دانشگاهی",
      visualAestheticFa: "پس‌زمینه تیره مدرن، زوم سریع روی رابط کاربری، هایلایت فیروزه‌ای و کهربایی",
      tabooRedLines: [
        "معرفی ابزارهای پولی بدون نسخه رایگان واقعی ممنوع",
        "وعده‌های دروغین درآمد یک‌شبه با هوش مصنوعی ممنوع",
      ],
      algorithmGuardrails: [
        "نمایش خروجی شگفت‌انگیز ابزار در همان ثانیه اول قبل از معرفی نام ابزار",
        "دعوت به ذخیره پست (Save) برای استفاده بعدی جهت تقویت سیگنال الگوریتم",
      ],
      competitorHandles: ["@ai_tools_daily", "@tech_farsi_hub"],
      voiceProfile: {
        speakerName: "گوینده پیج هوش مصنوعی",
        voicePersona: "Puck",
        prosodyStyle: "ریتم تند، پرهیجان، جوان و شفاف در تلفظ نام ابزارهای انگلیسی",
        sampleAudioUrl: null,
        cloneEnginePreference: "local_xtts_v2",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "page_mobile_repair",
      name: "پیج تعمیرات تخصصی موبایل و برد",
      handle: "@mobile.micro.fix",
      platform: "instagram",
      defaultFormat: "reels",
      pageMaturity: "new_page",
      niche: "تعمیرات میکروسکوپی برد آیفون و اندروید، عیب‌یابی هارد و آی‌سی تغذیه",
      contentStyle: "نمای زیر میکروسکوپ (Macro ASMR)، داستان نجات گوشی‌های خاموش و آموزش نکات طلایی به کاربران",
      targetAudiencePersona:
        "کاربران گوشی‌های پرچمدار نگران سلامت دستگاه + کارآموزان تعمیرات موبایل",
      audiencePainPoints: [
        "ترس از پاک شدن اطلاعات حیاتی روی گوشی خاموش‌شده",
        "تشخیص اشتباه تعمیرکاران غیرحرفه‌ای و تعویض بی‌مورد کل برد",
      ],
      brandTone: "cinematic_story",
      brandToneNoteFa: "داستانی، دقیق، آرامش‌بخش و حس مهارت جراحی میکروسکوپی",
      visualAestheticFa: "تصاویر ماکرو زیر میکروسکوپ با صدای هویه و لحیم‌کاری تمیز و نور گرم",
      tabooRedLines: ["تخریب مستقیم همکاران به نام ممنوع؛ تمرکز فقط روی روش علمی عیب‌یابی"],
      algorithmGuardrails: ["شروع ویدیو با تصویر گوشی خاموش یا نمای میکروسکوپی اتصالی برد"],
      competitorHandles: ["@ipadrehab", "@mobilerepair_ir"],
      voiceProfile: {
        speakerName: "استادکار تعمیرات برد",
        voicePersona: "Kore",
        prosodyStyle: "گرم، صمیمی، داستان‌گو و دقیق",
        sampleAudioUrl: null,
        cloneEnginePreference: "gemini_persona",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "page_youtube_shorts_anim",
      name: "کانال یوتیوب انیمیشن و شورتس علمی-داستانی",
      handle: "@WhyWorldShorts",
      platform: "youtube",
      defaultFormat: "shorts",
      pageMaturity: "new_page",
      niche: "انیمیشن‌های کوتاه علمی، معماهای مهندسی و داستان‌های شگفت‌انگیز واقعی برای درآمد دلاری یوتیوب",
      contentStyle: "روایت سینمایی پرکشش با شات‌های ۴ ثانیه‌ای، افکت‌های صوتی عمیق و حلقه تکرار (Loop) در پایان",
      targetAudiencePersona:
        "مخاطبان کنجکاو ۱۸ تا ۴۰ ساله در یوتیوب شورتس که دنبال ویدیوهای کوتاه علمی و داستانی باکیفیت هستند",
      audiencePainPoints: ["خستگی از ویدیوهای کپی و تکراری بی‌کیفیت در شورتس"],
      brandTone: "cinematic_story",
      brandToneNoteFa: "کنجکاوی‌برانگیز، مستند سینمایی با تعلیق بالا تا ثانیه آخر",
      visualAestheticFa: "کادرهای استوری‌بوردی پرجزئیات، ترنزیشن زوم و کنتراست سینمایی",
      tabooRedLines: ["استفاده از موزیک‌های دارای کپی‌رایت یوتیوب اکیداً ممنوع"],
      algorithmGuardrails: [
        "ساختار Loop بین جمله آخر و جمله اول برای رساندن Retention به بالای ۱۰۰٪ در YouTube Shorts",
      ],
      competitorHandles: ["@zackdfilms", "@kurzgesagt"],
      voiceProfile: {
        speakerName: "راوی مستند یوتیوب",
        voicePersona: "Fenrir",
        prosodyStyle: "راوی مستند سینمایی با مکث‌های تعلیق‌آفرین",
        sampleAudioUrl: null,
        cloneEnginePreference: "local_f5_tts",
      },
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function createStarterMemories(): AgentMemoryEntry[] {
  const now = "2026-03-11T10:00:00.000Z";
  return [
    {
      id: "mem_seed_1",
      agentId: "scriptwriter_agent",
      scope: "global",
      pageProfileId: null,
      projectId: null,
      category: "learned_rule",
      ruleText:
        "هرگز از تیترهای دایره‌المعارفی مثل «... چیست؟» استفاده نکن؛ قلاب ۳ ثانیه اول باید روی یک ریسک واقعی، عدد ملموس یا تضاد بصری فوری سوار شود.",
      sourceEvent: "قانون پایه استودیو برای جلوگیری از رد شدن پست در الگوریتم",
      strength: 10,
      appliedCount: 12,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "mem_seed_2",
      agentId: "scriptwriter_agent",
      scope: "global",
      pageProfileId: null,
      projectId: null,
      category: "voice_and_edit_rule",
      ruleText:
        "در نگارش متن گویندگی فارسی، تمام کلمات هم‌نگاره (مثل بُرش، کِشش، مُهر، مِهر، دَرز) و کسره‌های اضافه باید اعراب‌گذاری دقیق شوند تا گوینده یا موتور کلون صدا بدون یک خطا متن را بخواند.",
      sourceEvent: "استاندارد خوانندگی و فن بیان فارسی",
      strength: 9,
      appliedCount: 8,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "mem_seed_3",
      agentId: "scriptwriter_agent",
      scope: "page",
      pageProfileId: "page_steel_b2b",
      projectId: null,
      category: "viral_pattern",
      ruleText:
        "در پیج فروش آهن‌آلات، ویدیوهایی که روش تشخیص جنس اصل از تقلبی را با ابزار ساده در انبار نشان می‌دهند ۳ برابر بیشتر توسط پیمانکاران ذخیره و برای همکاران فوروارد می‌شوند.",
      sourceEvent: "رادار رقبا و وایرال بازار مقاطع فولادی",
      strength: 9,
      appliedCount: 5,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "mem_seed_4",
      agentId: "director_agent",
      scope: "global",
      pageProfileId: null,
      projectId: null,
      category: "voice_and_edit_rule",
      ruleText:
        "هر شات ویدیویی باید اکیداً بین ۳ تا ۸ ثانیه باشد، ۲ فریم پیش‌نمایش (فریم شروع و فریم اوج حرکت) داشته باشد و تراز صدای نهایی در DaVinci Resolve روی -14 LUFS با حذف نویز تنظیم شود.",
      sourceEvent: "استاندارد کارگردانی و اتوماسیون DaVinci Resolve",
      strength: 10,
      appliedCount: 10,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function createStarterViralReports(): CompetitorViralReport[] {
  return [
    {
      id: "vrep_seed_steel",
      pageProfileId: "page_steel_b2b",
      nicheQuery: "فروش آهن‌آلات، لوله مانیسمان و مقاطع فولادی در اینستاگرام و یوتیوب",
      platform: "instagram",
      analyzedAt: "2026-03-12T08:30:00.000Z",
      executiveSummary:
        "صفحات موفق صنعتی در سال ۲۰۲۶ از حالت کاتالوگ خشک قیمت خارج شده‌اند و با نمایش «تست عملی بار در انبار»، «کالبدشکافی خسارت‌های واقعی پروژه‌ها» و «آموزش تشخیص بار کارخانه از تقلبی در ۳۰ ثانیه» اعتماد خریداران عمده را جذب می‌کنند.",
      safeResearchMethodNote:
        "استخراج‌شده از طریق جستجوی عمومی گوگل (Grounded Web Search) بدون لاگین به اکانت اینستاگرام یا ربات اسکرپر — ۱۰۰٪ امن و بدون ریسک شدوبن یا مسدودسازی پیج شما.",
      competitors: [
        {
          nameOrHandle: "صفحات خبری قیمت روز آهن",
          platform: "instagram",
          coreStrength: "انتشار سریع جدول قیمت روزانه در استوری",
          winningHookFormula: "اعلام نوسان ناگهانی بازار در ثانیه اول",
          weaknessOrGapForUs:
            "محتوای ویدیویی تخصصی کارگاهی و آموزش تشخیص اصالت بار ندارند؛ بهترین فرصت برای مرجعیت فنی پیج ما.",
        },
        {
          nameOrHandle: "تامین‌کنندگان سنتی شادآباد",
          platform: "instagram",
          coreStrength: "نمایش موجودی انبار و بارگیری تریلی",
          winningHookFormula: "تصویر واقعی بارگیری تناژ بالا",
          weaknessOrGapForUs:
            "صداگذاری پرنویز انبار و نبود سناریوی ساختاریافته؛ با نریشن تمیز و شات‌های ۴ ثانیه‌ای به‌راحتی از آن‌ها متمایز می‌شویم.",
        },
      ],
      weeklyTopViralPatterns: [
        {
          rank: 1,
          patternTitle: "تست ۱۰ ثانیه‌ای تشخیص بار اصل از تقلبی جلوی دوربین",
          hookStructureFa: "«اگر موقع تحویل بار این یک خط ریز داخل لوله رو نبینی، کل خط بخارت منفجر می‌شه!»",
          retentionMechanismFa: "مقایسه هم‌زمان دو قطعه ظاهراً یکسان و نمایش ترفند تشخیص در ثانیه پایانی",
          visualRhythmNote: "کات‌های ۴ ثانیه‌ای: کلوزآپ قطعه -> نمای کولیس/چراغ‌قوه -> جدول تحمل فشار",
          whyItWentViral: "نرخ ذخیره (Save) و ارسال در گروه‌های مهندسی و پیمانکاری فوق‌العاده بالاست.",
        },
        {
          rank: 2,
          patternTitle: "داستان واقعی یک اشتباه میلیاردی در خرید مقاطع ساختمانی",
          hookStructureFa: "«فقط به خاطر ۲۰۰ هزار تومن ارزون‌تر در هر شاخه، سقف این سوله فرو ریخت...»",
          retentionMechanismFa: "روایت تعلیق‌دار علت فنی حادثه و راه‌حل استاندارد در ۴۰ ثانیه",
          visualRhythmNote: "شروع با تصویر دراماتیک سازه -> زوم روی فاکتور و جدول اشتال -> جمع‌بندی قاطع",
          whyItWentViral: "ترکیب حس کنجکاوی عمومی و دغدغه مالی مستقیم کارفرمایان.",
        },
      ],
      algorithmRulesAndRedLines: [
        "هرگز از ربات‌های لاگین‌شونده به اکانت اصلی اینستاگرام برای آنالیز رقبا استفاده نکنید (عامل اصلی محدود شدن پیج).",
        "زیرنویس فارسی خوانا در مرکز-پایین کادر (بالاتر از دکمه‌های کپشن ریلز) نرخ تماشای بی‌صدا را ۴۲٪ افزایش می‌دهد.",
        "پرهیز از واترمارک سایر پلتفرم‌ها (مثل لوگوی تیک‌تاک روی ریلز اینستاگرام) که برد الگوریتمی را به شدت کاهش می‌دهد.",
      ],
      sources: [
        {
          title: "استاندارد لوله بدون درز مانیسمان ASME B36.10 و ASTM A106",
          uri: "https://en.wikipedia.org/wiki/Nominal_Pipe_Size",
        },
      ],
    },
  ];
}

function makeSeedAudit(stage: string, checks: StageQualityAudit["checks"], model: string, critique?: string): StageQualityAudit {
  return {
    stage,
    inspectedAt: "2026-03-12T11:05:00.000Z",
    inspectorModel: model,
    passed: true,
    score: 100,
    attemptsRun: 1,
    selfHealed: false,
    checks,
    visionCritiqueFa: critique,
    fixesAppliedFa: [],
  };
}

function seedShowcaseProjectAndMedia(): ProjectRecord {
  const projId = "proj_seed_mannesmann";
  const now = "2026-03-12T11:00:00.000Z";

  // Write starter WAV voiceover and voice sample so <audio> works offline immediately
  const wavBuf = buildStarterWavBuffer(4);
  const voFilename = `${projId}_seed_vo.wav`;
  const sampleFilename = "seed_voice_sample_steel.wav";
  fs.writeFileSync(path.join(AUDIO_DIR, voFilename), wavBuf);
  fs.writeFileSync(path.join(AUDIO_DIR, sampleFilename), wavBuf);

  const rawShots = [
    {
      shotNumber: 1,
      timecode: "00:00 - 00:04",
      durationSeconds: 4,
      cameraAngle: "کلوزآپ ماکرو از مقطع برش‌خورده دو لوله فولادی",
      cameraMovement: "زوم سریع به داخل مقطع لوله (Push-in)",
      sceneDescriptionFa:
        "نمای نزدیک دو لوله فولادی صنعتی کنار هم؛ یکی لوله درزدار رنگ‌شده و دیگری لوله مانیسمان بدون درز واقعی زیر نور کارگاهی.",
      startFrameDescriptionFa: "دو مقطع لوله فولادی در کنار هم روی میز کارگاه با نور کنتراست بالا",
      endFrameDescriptionFa: "زوم دقیق روی جداره داخلی لوله و نمایش خط جوش پنهان زیر لایه رنگ",
      spokenSegment: "موقع تحویل بار صنعتی، فقط ده ثانیه وقت داری بفهمی لوله واقعاً مانیسمانه یا درزدارِ رنگ‌شده!",
      onScreenText: "تشخیص مانیسمان اصل در ۱۰ ثانیه!",
      sfxCueFa: "افکت ضربه فلزی سنگین + Whoosh سریع",
      transitionToNext: "whip_pan" as const,
      lightingAndMood: "نورپردازی صنعتی تیره با هایلایت کهربایی روی لبه فولاد",
      visualPromptFa: "کلوزآپ صنعتی دو لوله فولادی ضخیم در انبار آهن‌آلات",
      dramaticBeatFa: "قلاب شوک ۳ ثانیه اول (Visual Hook)",
      microScenarioFa:
        "در ثانیه اول دو لوله فولادی سنگین کنار هم روی میز کارگاه قرار دارند؛ دوربین با حرکت سریع به دهانه لوله نزدیک می‌شود تا تضاد سطح براق مانیسمان بدون درز و درز پنهان لوله تقلبی بلافاصله چشم مخاطب را قفل کند.",
      subjectAndActionFa: "مقطع برش‌خورده دو لوله صنعتی سنگین کنار هم زیر نور جهت‌دار کارگاهی",
      environmentAndPropsFa: "میز فلزی کارگاه آهن‌آلات، بافت فولاد سیاه و محیط صنعتی کم‌نور در پس‌زمینه",
      lensAndFramingFa: "ماکرو ۸۵mm f/2.8 · کادر ۹:۱۶ عمودی با ۲۲٪ فضای امن پایین برای زیرنویس",
      lightingRigFa: "نور اصلی تنگستن ۴۵۰۰K از زاویه ۴۵ درجه + ریم‌لایت کهربایی روی لبه برش فولاد",
      continuityLockFa: "دمای رنگ ۴۵۰۰ کلوین و بافت فولاد تیره برای تطابق با شات ۲ حفظ شود",
      photorealPromptStartEn:
        "Ultra-realistic macro commercial photography of two heavy black seamless steel industrial pipe cross-sections on dark steel workbench, crisp metallic grain, warm amber rim lighting, vertical 9:16, 8k RAW",
      photorealPromptEndEn:
        "Extreme macro push-in on inner steel pipe wall texture showing seamless forged steel versus hidden ERW weld seam, shallow depth of field, tungsten workshop light, vertical 9:16",
      negativePromptEn: "cartoon, anime, blurry, plastic texture, text, watermark, illustration",
      recommendedEngine: "hyperframes_html" as const,
      photoAsset: "shot1_steel_macro_pipes_1794966385307.jpg",
    },
    {
      shotNumber: 2,
      timecode: "00:04 - 00:09",
      durationSeconds: 5,
      cameraAngle: "نمای نقطه‌نظر (POV) با چراغ‌قوه داخل دهانه لوله",
      cameraMovement: "حرکت آرام دورانی داخل دهانه لوله",
      sceneDescriptionFa:
        "تاباندن نور چراغ‌قوه صنعتی به دیواره داخلی لوله و کشیدن انگشت یا کولیس روی خط طولی داخل لوله برای کشف پلیسه جوش.",
      startFrameDescriptionFa: "تابش نور متمرکز به داخل دهانه تاریک لوله فولادی",
      endFrameDescriptionFa: "نمایش واضح برجستگی میلی‌متری خط جوش داخلی در لوله تقلبی در برابر سطح یکپارچه مانیسمان",
      spokenSegment: "سطح بیرونی رو می‌تونن سنگ بزنن و رنگ کنن؛ اما داخل لوله رو با چراغ‌قوه ببین: مانیسمان واقعی هیچ خط طولی نداره.",
      onScreenText: "تست ۱: خط جوش جداره داخلی",
      sfxCueFa: "کلیک روشن شدن چراغ‌قوه + افکت تمرکز صوتی",
      transitionToNext: "cut" as const,
      lightingAndMood: "پرتو نور تیز داخل بافت فلزی مات",
      visualPromptFa: "نمای داخلی لوله فولادی با تابش نور چراغ‌قوه صنعتی",
      dramaticBeatFa: "افشای راز فنی (Visual Proof)",
      microScenarioFa:
        "دست تکنسین با چراغ‌قوه صنعتی LED مستقیم به داخل حفره تاریک لوله می‌تابد؛ پرتو نور سطح یکپارچه جداره داخلی را روشن می‌کند و بیننده تفاوت لوله یک‌تکه نوردگرم را با چشم خود می‌بیند.",
      subjectAndActionFa: "پرتو نور چراغ‌قوه صنعتی روی دیواره داخلی لوله فولادی از نمای POV",
      environmentAndPropsFa: "دهانه لوله صنعتی، چراغ‌قوه فلزی کارگاهی و دستکش کار مهندسی",
      lensAndFramingFa: "۵۰mm f/2.0 نمای نزدیک POV با فضای تیره در بخش پایینی کادر",
      lightingRigFa: "نور تیز موضعی چراغ‌قوه (۵۶۰۰K) داخل تونل تاریک لوله + کنتراست بالا",
      continuityLockFa: "همان لوله فولادی شات اول با قطر و رنگ بدنه یکسان",
      photorealPromptStartEn:
        "Realistic first-person POV of industrial LED flashlight shining beam deep inside heavy carbon steel pipe bore in warehouse, dramatic light reflections on steel interior, vertical 9:16, 8k RAW",
      photorealPromptEndEn:
        "Tighter push-in inside steel pipe bore illuminated by crisp flashlight beam highlighting smooth seamless forged inner surface, shallow depth of field, vertical 9:16",
      negativePromptEn: "cartoon, abstract shapes, blurry, distorted hand, watermark",
      recommendedEngine: "hyperframes_html" as const,
      photoAsset: "shot2_pipe_flashlight_pov_1794966388346.jpg",
    },
    {
      shotNumber: 3,
      timecode: "00:09 - 00:15",
      durationSeconds: 6,
      cameraAngle: "نمای متوسط از کولیس دیجیتال و جدول رده (Schedule 40/80)",
      cameraMovement: "پن نرم از کولیس به سمت اعداد حک‌شده روی بدنه لوله",
      sceneDescriptionFa:
        "اندازه‌گیری ضخامت گوشت لوله با کولیس دیجیتال و نمایش کد حک‌شده ASTM A106 و رده ۴۰ روی بدنه لوله مانیسمان.",
      startFrameDescriptionFa: "کولیس دیجیتال روی لبه لوله مانیسمان با نمایش دقیق ضخامت گوشت",
      endFrameDescriptionFa: "نمای واضح حکاکی استاندارد ASTM A106 Grade B روی بدنه فولادی",
      spokenSegment: "قدم دوم، ضخامت گوشت لوله رو در چهار نقطه دور دهانه با کولیس بگیر و کد استاندارد ای‌اس‌تی‌ام صد و شش رو چک کن.",
      onScreenText: "تست ۲: کولیس + کد ASTM A106",
      sfxCueFa: "بیپ دیجیتال کولیس + تیک تایید مهندسی",
      transitionToNext: "zoom_in" as const,
      lightingAndMood: "نور دقیق کارگاهی با خوانایی کامل ارقام دیجیتال",
      visualPromptFa: "اندازه‌گیری ضخامت لوله فولادی با کولیس دیجیتال",
      dramaticBeatFa: "تست ابزار دقیق و اعتبارسنجی استاندارد",
      microScenarioFa:
        "فک‌های استیل کولیس دیجیتال روی لبه گوشت لوله قفل می‌شود و عدد دقیق ضخامت به میلی‌متر روی نمایشگر LCD خوانا ظاهر می‌گردد، سپس زاویه کمی چرخیده و کد استاندارد بدنه را تایید می‌کند.",
      subjectAndActionFa: "اندازه‌گیری دقیق دیواره لوله فولادی با کولیس دیجیتال توسط دست مهندس",
      environmentAndPropsFa: "کولیس دیجیتال استیل ضدزنگ، لوله ضخیم سیاه و میز بازرسی کیفیت انبار",
      lensAndFramingFa: "ماکرو ۶۰mm f/2.8 · تمرکز کامل روی صفحه دیجیتال کولیس و فک اندازه‌گیری",
      lightingRigFa: "سافت‌باکس سقفی ۵۰۰۰K بدون بازتاب مزاحم روی صفحه LCD کولیس",
      continuityLockFa: "هماهنگ با زاویه دست و بافت لوله از شات ۱ و ۲",
      photorealPromptStartEn:
        "Photorealistic close-up of stainless steel digital vernier caliper measuring wall thickness of thick industrial seamless steel pipe, sharp LCD readout, workshop background, vertical 9:16, 8k",
      photorealPromptEndEn:
        "Macro zoom focusing on locked digital caliper jaws and crisp stenciled industrial steel pipe body in clean workshop lighting, vertical 9:16",
      negativePromptEn: "cartoon, unreadable garbled display, blurry, plastic, watermark",
      recommendedEngine: "hyperframes_html" as const,
      photoAsset: "shot3_digital_caliper_steel_1794966389744.jpg",
    },
    {
      shotNumber: 4,
      timecode: "00:15 - 00:19",
      durationSeconds: 4,
      cameraAngle: "نمای روبرو از انبار مقاطع فولادی با کارت دعوت به اقدام",
      cameraMovement: "حرکت آرام به جلو (Dolly In)",
      sceneDescriptionFa:
        "نمایش منظم بندیل‌های لوله مانیسمان در انبار تخصصی به همراه چک‌لیست PDF بازرسی بار برای خریداران و پیمانکاران.",
      startFrameDescriptionFa: "ردیف منظم لوله‌های مانیسمان استاندارد در انبار",
      endFrameDescriptionFa: "کارت پایانی فالو کردن پیج برای دریافت چک‌لیست بازرسی مقاطع فولادی",
      spokenSegment: "این پست رو همین الان ذخیره کن تا سر پروژه خسارت میلیاردی ندی و برای نکات تخصصی بازار آهن، پیج ما رو دنبال کن.",
      onScreenText: "ذخیره کن + پیج رو دنبال کن",
      sfxCueFa: "افکت جمع‌بندی سینمایی نرم (Warm Bass Hit)",
      transitionToNext: "cut" as const,
      lightingAndMood: "پالت گرم و اعتمادساز صنعتی",
      visualPromptFa: "نمای سینمایی انبار مدرن مقاطع فولادی و لوله مانیسمان",
      dramaticBeatFa: "جمع‌بندی و تبدیل مخاطب (CTA & Retention Loop)",
      microScenarioFa:
        "دوربین با حرکت آرام Dolly In از میان راهروی منظم بندیل‌های لوله فولادی انبار عبور می‌کند و با نمایش اقتدار موجودی واقعی انبار، دعوت به ذخیره پست و فالو کردن پیج را به تصویر می‌کشد.",
      subjectAndActionFa: "ردیف‌های منظم بندیل لوله مانیسمان صنعتی در سوله انبار بزرگ فولاد",
      environmentAndPropsFa: "سوله صنعتی سقف‌بلند، جرثقیل سقفی و نور طبیعی از پنجره‌های بالایی",
      lensAndFramingFa: "واید ۲۴mm f/4 عمودی با خطوط پرسپکتیو قوی به سمت عمق سالن",
      lightingRigFa: "نور ترکیبی طلایی غروب با لامپ‌های صنعتی سقف سوله و کنتراست ملایم",
      continuityLockFa: "همان تم تیره صنعتی و هایلایت کهربایی ۳ شات قبل",
      photorealPromptStartEn:
        "Cinematic wide vertical 9:16 shot inside modern heavy steel pipe warehouse, neatly stacked bundles of black seamless industrial pipes, warm golden overhead industrial lights, 8k RAW photo",
      photorealPromptEndEn:
        "Smooth dolly-in down clean steel warehouse aisle framed for Instagram Reels safe-zone CTA, photorealistic commercial look, vertical 9:16",
      negativePromptEn: "cartoon, anime, messy rubble, blurry, watermark",
      recommendedEngine: "hyperframes_html" as const,
      photoAsset: "shot4_steel_warehouse_hero_1794966391203.jpg",
    },
  ];

  const srcAssetsDir = path.resolve(process.cwd(), "src", "assets", "images");

  const visualShots = rawShots.map((s) => {
    const srcImgPath = path.join(srcAssetsDir, s.photoAsset);
    const f1Name = `${projId}_shot_${s.shotNumber}_f1.jpg`;
    const f2Name = `${projId}_shot_${s.shotNumber}_f2.jpg`;
    const f1Dest = path.join(IMAGES_DIR, f1Name);
    const f2Dest = path.join(IMAGES_DIR, f2Name);

    let f1SvgFallback = false;
    if (fs.existsSync(srcImgPath)) {
      fs.copyFileSync(srcImgPath, f1Dest);
      try {
        execFileSync("ffmpeg", [
          "-y",
          "-i",
          srcImgPath,
          "-vf",
          "scale=540:960:force_original_aspect_ratio=increase,crop=540:960,crop=432:768:54:96,scale=540:960,eq=contrast=1.08:saturation=1.1",
          "-q:v",
          "3",
          f2Dest,
        ], { stdio: "ignore", timeout: 8000 });
      } catch {
        fs.copyFileSync(srcImgPath, f2Dest);
      }
    } else {
      f1SvgFallback = true;
      const svg1 = createStarterSvgFrame(s.shotNumber, 1, "#F59E0B", "#161B26");
      const svg2 = createStarterSvgFrame(s.shotNumber, 2, "#38BDF8", "#0F172A");
      fs.writeFileSync(path.join(VISUALS_DIR, `${projId}_shot_${s.shotNumber}_f1.svg`), svg1, "utf-8");
      fs.writeFileSync(path.join(VISUALS_DIR, `${projId}_shot_${s.shotNumber}_f2.svg`), svg2, "utf-8");
    }

    const imgUrl1 = f1SvgFallback
      ? `/api/media/visuals/${projId}_shot_${s.shotNumber}_f1.svg`
      : `/api/media/images/${f1Name}`;
    const imgUrl2 = f1SvgFallback
      ? `/api/media/visuals/${projId}_shot_${s.shotNumber}_f2.svg`
      : `/api/media/images/${f2Name}`;

    return {
      shotNumber: s.shotNumber,
      imageUrl: imgUrl1,
      secondaryImageUrl: imgUrl2,
      motionCue: s.cameraMovement,
      colorPaletteNote: s.lightingRigFa,
      generatorEngine: "hyperframes_html" as const,
      qaAudit: makeSeedAudit(
        `vision_frame_${s.shotNumber}`,
        [
          {
            nameFa: "هم‌خوانی معنایی تصویر با سناریوی شات (Vision AI)",
            passed: true,
            detailFa: "سوژه صنعتی واقعی دقیقاً منطبق با شرح صحنه تایید شد.",
            metric: "96/100",
          },
          {
            nameFa: "واقع‌گرایی بصری و کیفیت سینمایی فریم",
            passed: true,
            detailFa: "عکاسی فوتورئال ۹:۱۶ با بافت واقعی فولاد و نور کارگاهی تایید شد.",
            metric: "95/100",
          },
          {
            nameFa: "خوانایی تایپوگرافی و ناحیه امن ریلز",
            passed: true,
            detailFa: "۲۲٪ حاشیه امن پایین کادر برای زیرنویس ریلز آزاد است.",
            metric: "98/100",
          },
        ],
        "gemini-4-hydrogen (Vision QA)",
        "فریم کاملاً واقعی، هم‌راستا با سناریوی شات و با نورپردازی حرفه‌ای کارگاهی تایید شد."
      ),
      status: "ready" as const,
      error: null,
    };
  });

  const cleanDirectorShots = rawShots.map(({ photoAsset: _omit, ...rest }) => rest);

  const baseProject: ProjectRecord = {
    id: projId,
    threadId: `thread_${projId}`,
    createdAt: now,
    updatedAt: now,
    brief: {
      title: "راز تشخیص لوله مانیسمان اصل از درزدار مخفی در ۱۰ ثانیه",
      idea: "آموزش عملی تشخیص لوله مانیسمان بدون درز واقعی از لوله‌های درزدار رنگ‌شده برای پیمانکاران و خریداران عمده آهن‌آلات",
      pageProfileId: "page_steel_b2b",
      platform: "instagram",
      contentFormat: "reels",
      pageMaturity: "new_page",
      tone: "news_analysis",
      toneLabelFa: "مهندسی، صریح و مستند بازار آهن",
      targetDurationSeconds: 19,
      preferredVideoEngine: "hyperframes_html",
    },
    currentStage: "shot_videos",
    checkpointStatus: "waiting_approval",
    waitingNode: "checkpoint_4_shot_videos_gate",
    errorMessage: null,
    researchScript: {
      videoTitle: "راز تشخیص لوله مانیسمان اصل از درزدار مخفی در ۱۰ ثانیه",
      targetAudienceNote:
        "پیمانکاران تأسیسات، مدیران خرید پروژه‌های صنعتی و خریداران عمده آهن‌آلات که نگران اصالت لوله بدون درز هستند.",
      researchSummary:
        "لوله‌های مانیسمان (Seamless) طبق استاندارد ASTM A106 بدون هیچ‌گونه خط جوش ساخته می‌شوند تا فشارهای بالای خطوط بخار و نفت‌وگاز را تحمل کنند. یکی از تقلب‌های پرخسارت بازار، سنگ زدن خط جوش بیرونی لوله‌های درزدار ERW و رنگ‌آمیزی سیاه آن‌ها به جای مانیسمان است.",
      keyInsights: [
        "لوله مانیسمان واقعی در فرآیند نورد گرم از شمش توپر فولادی تولید می‌شود و هیچ درز جوشی ندارد.",
        "خط جوش داخلی لوله‌های تقلبی حتی پس از سنگ‌زنی بیرونی، با تابش نور به داخل دهانه قابل مشاهده است.",
        "تطابق ضخامت گوشت لوله با جدول Schedule 40/80 و کد ASTM A106 معیار قطعی تحویل بار است.",
      ],
      trendingAngles: [
        "تست عملی ۱۰ ثانیه‌ای پای تریلی قبل از تخلیه بار",
        "مقایسه ماکرو جداره داخلی مانیسمان اصل و درزدار رنگ‌شده",
      ],
      sources: [
        {
          title: "ASTM A106 Seamless Carbon Steel Pipe Specification",
          uri: "https://en.wikipedia.org/wiki/Nominal_Pipe_Size",
        },
      ],
      hook: "موقع تحویل بار صنعتی، فقط ده ثانیه وقت داری بفهمی لوله واقعاً مانیسمانه یا درزدارِ رنگ‌شده!",
      body: "سطح بیرونی لوله رو می‌تونن سنگ بزنن و رنگ مشکی بپاشن تا شبیه مانیسمان بشه؛ اما داخل لوله دروغ نمی‌گه! چراغ‌قوه گوشیت رو بنداز داخل دهانه لوله: مانیسمان واقعی هیچ خط طولی یا پلیسه جوشی نداره. قدم دوم، ضخامت گوشت لوله رو در چهار نقطه با کولیس چک کن و کد حک‌شده ASTM A106 رو با برگه آنالیز تطبیق بده.",
      cta: "این پست رو همین الان ذخیره کن تا سر پروژه خسارت میلیاردی ندی و برای نکات تخصصی بازار آهن، پیج ما رو دنبال کن.",
      psychologicalTriggersUsed: [
        "گریز از زیان مالی سنگین (Loss Aversion)",
        "حس تسلط فنی در ۱۰ ثانیه (Instant Mastery)",
      ],
      algorithmComplianceChecklist: [
        "قلاب زیر ۳ ثانیه با تضاد بصری فوری تایید شد",
        "بدون کلمات حساسیت‌زا یا وعده قیمتی غیرواقعی",
        "دعوت مستقیم به Save برای تقویت سیگنال الگوریتم ریلز",
      ],
      keywords: ["لوله مانیسمان", "تشخیص مانیسمان اصل", "خرید آهن‌آلات", "رده ۴۰", "ASTM A106"],
      qaAudit: makeSeedAudit(
        "research_script",
        [
          { nameFa: "پرهیز از تیتر کتابی و خسته‌کننده", passed: true, detailFa: "تیتر قلاب‌محور تایید شد." },
          { nameFa: "تناسب قلاب ۳ ثانیه اول", passed: true, detailFa: "۱۶ کلمه (مناسب ۲.۵ ثانیه اول)", metric: "16 کلمه" },
          { nameFa: "رعایت خطوط قرمز پروفایل پیج و الگوریتم", passed: true, detailFa: "چک‌لیست الگوریتم و Save CTA تایید شد." },
        ],
        "deterministic-script-auditor"
      ),
    },
    narration: {
      plainNarrationText:
        "موقع تحویل بار صنعتی، فقط ده ثانیه وقت داری بفهمی لوله واقعاً مانیسمانه یا درزدار رنگ‌شده! سطح بیرونی رو می‌تونن سنگ بزنن و رنگ کنن؛ اما داخل لوله رو با چراغ‌قوه ببین: مانیسمان واقعی هیچ خط طولی نداره. قدم دوم، ضخامت گوشت لوله رو در چهار نقطه دور دهانه با کولیس بگیر و کد استاندارد ای‌اس‌تی‌ام صد و شش رو چک کن. این پست رو همین الان ذخیره کن تا سر پروژه خسارت میلیاردی ندی و برای نکات تخصصی بازار آهن، پیج ما رو دنبال کن.",
      vocalizedNarrationText:
        "موقِعِ تَحویلِ بارِ صَنعَتی، فَقط دَه ثانیه وَقت داری بِفَهمی لوله واقِعاً مانیسمانه [مکث ۰.۳ ثانیه] یا دَرزدارِ رَنگ‌شده! سَطحِ بیرونی رو می‌تونَن سَنگ بِزَنَن و رَنگ کُنَن؛ اَمّا داخِلِ لوله رو با چِراغ‌قُوّه بِبین: [مکث ۰.۴ ثانیه] مانیسمانِ واقِعی هیچ خَطِّ طولی نَداره. قَدَمِ دُوُّم، ضِخامَتِ گوشتِ لوله رو دَر چَهار نُقطه دورِ دَهانه با کولیس بِگیر و کُدِ اِستانداردِ اِی‌اِس‌تی‌اِم صَد و شِش رو چِک کُن. [مکث ۰.۳ ثانیه] این پُست رو هَمین الان ذَخیره کُن تا سَرِ پروژه خِسارَتِ میلیاردی نَدی و بَرایِ نُکاتِ تَخَصُّصیِ بازارِ آهَن، پِیجِ ما رو دُنبال کُن.",
      pronunciationGuide: [
        {
          word: "درزدار رنگ‌شده",
          vocalized: "دَرزدارِ رَنگ‌شده",
          emotionOrStressNote: "تاکید هشداردهنده روی کسره اضافه و کلمه دَرزدار",
        },
        {
          word: "ضخامت گوشت لوله",
          vocalized: "ضِخامَتِ گوشتِ لوله",
          emotionOrStressNote: "بیان شمرده و مهندسی با کسره دقیق",
        },
        {
          word: "کد استاندارد",
          vocalized: "کُدِ اِستانداردِ",
          emotionOrStressNote: "جلوگیری از خوانش اشتباه کَد به جای کُد",
        },
      ],
      rhythmAndPauseNotes:
        "شروع تند و هشداردهنده در ۳ ثانیه اول، مکث ۰.۴ ثانیه‌ای قبل از افشای راز جداره داخلی، و فرود محکم و مطمئن در جمله پایانی.",
      emotionArcSummary: "هشدار فوری -> کنجکاوی فنی -> اطمینان مهندسی -> دعوت صمیمی به ذخیره و فالو",
      estimatedSeconds: 19,
      wordCount: 84,
      qaAudit: makeSeedAudit(
        "narration",
        [
          { nameFa: "چگالی اِعراب‌گذاری و کسره اضافه فارسی", passed: true, detailFa: "۶۸ حرکت فتحه/کسره/ضمه ثبت شد.", metric: "68 حرکت" },
          { nameFa: "نشانگرهای ریتم، مکث و تاکید صوتی", passed: true, detailFa: "۳ نشانگر مکث طبیعی گوینده تایید شد.", metric: "3 مکث" },
          { nameFa: "تبدیل اعداد به حروف فارسی", passed: true, detailFa: "اعداد «ده»، «چهار»، «صد و شش» به حروف نوشته شده‌اند." },
        ],
        "deterministic-prosody-auditor"
      ),
    },
    voiceover: {
      narrationText:
        "موقِعِ تَحویلِ بارِ صَنعَتی، فَقط دَه ثانیه وَقت داری بِفَهمی لوله واقِعاً مانیسمانه [مکث ۰.۳ ثانیه] یا دَرزدارِ رَنگ‌شده! سَطحِ بیرونی رو می‌تونَن سَنگ بِزَنَن و رَنگ کُنَن؛ اَمّا داخِلِ لوله رو با چِراغ‌قُوّه بِبین: مانیسمانِ واقِعی هیچ خَطِّ طولی نَداره. قَدَمِ دُوُّم، ضِخامَتِ گوشتِ لوله رو دَر چَهار نُقطه دورِ دَهانه با کولیس بِگیر و کُدِ اِستانداردِ اِی‌اِس‌تی‌اِم صَد و شِش رو چِک کُن. این پُست رو هَمین الان ذَخیره کُن تا سَرِ پروژه خِسارَتِ میلیاردی نَدی و بَرایِ نُکاتِ تَخَصُّصیِ بازارِ آهَن، پِیجِ ما رو دُنبال کُن.",
      vocalizedText:
        "موقِعِ تَحویلِ بارِ صَنعَتی، فَقط دَه ثانیه وَقت داری بِفَهمی لوله واقِعاً مانیسمانه یا دَرزدارِ رَنگ‌شده!",
      voiceName: "Charon",
      voiceStyle: "صدای مردانه عمیق، قاطع و مهندسی مطابق پروفایل پیج فروش آهن‌آلات",
      referenceSampleUrl: `/api/media/audio/${sampleFilename}`,
      cloneEngineNote: "متصل به نمونه صدای مرجع پیج + اعراب‌گذاری کامل فارسی",
      estimatedSeconds: 19,
      wordCount: 84,
      pacingNotes: "مکث کوتاه پس از قلاب و تاکید روی عبارت «هیچ خط طولی نداره».",
      audioUrl: `/api/media/audio/${voFilename}`,
      audioFilename: voFilename,
      audioError: null,
      qaAudit: makeSeedAudit(
        "voiceover",
        [
          { nameFa: "سلامت باینری و استریم صوتی WAV", passed: true, detailFa: "فایل WAV 24kHz آماده پخش است.", metric: "188 KB" },
        ],
        "ffprobe-audio-auditor"
      ),
    },
    director: {
      visualDirectionSummary:
        "کارگردانی مستند صنعتی پرکنتراست توسط تیم ۵ نفره تولید در ۴ شات ۴ تا ۶ ثانیه‌ای عمودی (۹:۱۶) با راکورد پیوسته نور و بافت فولاد.",
      totalEstimatedSeconds: 19,
      directingCrewNotes: {
        showrunnerNoteFa:
          "ریتم روایی از شوک تقلب در شات ۱ به اثبات با چراغ‌قوه (شات ۲)، تایید ابزار دقیق با کولیس (شات ۳) و اقتدار انبار واقعی (شات ۴) می‌رسد.",
        dopCinematographyNoteFa:
          "ترکیب لنز ماکرو ۸۵mm برای بافت برش فلز، POV ۵۰mm داخل دهانه لوله، و واید ۲۴mm عمودی در سوله با رعایت کامل ناحیه امن زیرنویس ریلز.",
        artDirectionNoteFa:
          "محیط کارگاه واقعی با میز فلزی تیره، کولیس دیجیتال استیل و لوله‌های نوردگرم مشکی بدون هیچ المان گرافیکی مصنوعی.",
        editorRhythmNoteFa:
          "برش‌های تند روی کلمات کلیدی («ده ثانیه»، «هیچ خط طولی نداره»، «کولیس») با مدت شات‌های ۴، ۵، ۶ و ۴ ثانیه.",
        soundDesignNoteFa:
          "ضربه فلزی سنگین در شروع، کلیک چراغ‌قوه، بیپ دیجیتال کولیس و بیس گرم فرود پایانی تراز شده روی -14 LUFS.",
      },
      qaAudit: makeSeedAudit(
        "director",
        [
          { nameFa: "قانون قطعی طول ۳ تا ۸ ثانیه برای تمام شات‌ها", passed: true, detailFa: "۴ شات (۴s · ۵s · ۶s · ۴s) تایید شد.", metric: "4 شات" },
          { nameFa: "تاییدیه تیم ۵ نفره کارگردانی", passed: true, detailFa: "هر ۵ بخش شو رانر، DOP، صحنه، تدوین و صدا تکمیل شده است." },
          { nameFa: "تکمیل شناسنامه فنی هر شات و پرامپت واقعی", passed: true, detailFa: "پرامپت فوتورئال، لنز، نور و قفل راکورد در همه شات‌ها کامل است." },
        ],
        "deterministic-crew-auditor"
      ),
      shots: cleanDirectorShots,
    },
    visuals: {
      styleGuideSummary:
        "تصاویر واقعی ۹:۱۶ با فریم شروع و فریم اوج حرکت دوربین، تاییدشده با لایه بازبینی بینایی",
      shots: visualShots,
    },
    shotClips: cleanDirectorShots.map((s) => ({
      shotNumber: s.shotNumber,
      shotId: `shot_0${s.shotNumber}`,
      durationSeconds: s.durationSeconds,
      videoUrl: null,
      videoPath: null,
      approvalStatus: "not_rendered",
      sfxLabel: s.sfxCueFa,
    })),
    davinciPackage: null,
    logs: [
      {
        id: "log_seed_1",
        timestamp: now,
        node: "scriptwriter_agent",
        agent: "scriptwriter_agent",
        event: "node_completed",
        message: "ایجنت سناریونویس سناریوی تخصصی و متن گویندگی اعراب‌گذاری‌شده را تولید و بازبینی کرد.",
      },
      {
        id: "log_seed_2",
        timestamp: now,
        node: "director_agent",
        agent: "director_agent",
        event: "node_completed",
        message: "تیم ۵ نفره کارگردانی شناسنامه فنی شات‌ها و ۸ فریم واقعی پیش‌نمایش را آماده و تایید کرد.",
      },
    ],
  };

  baseProject.davinciPackage = buildDaVinciPackageSummary(baseProject);
  return baseProject;
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
  if (!fs.existsSync(VISUALS_DIR)) fs.mkdirSync(VISUALS_DIR, { recursive: true });
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
  if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });

  if (!fs.existsSync(PAGES_FILE)) {
    fs.writeFileSync(PAGES_FILE, JSON.stringify(createStarterPageProfiles(), null, 2), "utf-8");
  }
  if (!fs.existsSync(MEMORIES_FILE)) {
    fs.writeFileSync(MEMORIES_FILE, JSON.stringify(createStarterMemories(), null, 2), "utf-8");
  }
  if (!fs.existsSync(VIRAL_REPORTS_FILE)) {
    fs.writeFileSync(VIRAL_REPORTS_FILE, JSON.stringify(createStarterViralReports(), null, 2), "utf-8");
  }
  if (!fs.existsSync(CUSTOM_VAULT_NOTES_FILE)) {
    fs.writeFileSync(CUSTOM_VAULT_NOTES_FILE, JSON.stringify([], null, 2), "utf-8");
  }
  if (!fs.existsSync(PROJECTS_FILE)) {
    const seeded = [seedShowcaseProjectAndMedia()];
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(seeded, null, 2), "utf-8");
  } else {
    // Auto-upgrade legacy SVG showcase seed cleanly while preserving any user projects
    try {
      const parsed = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8")) as ProjectRecord[];
      if (Array.isArray(parsed) && parsed.length === 0) {
        const seeded = [seedShowcaseProjectAndMedia()];
        fs.writeFileSync(PROJECTS_FILE, JSON.stringify(seeded, null, 2), "utf-8");
      } else if (Array.isArray(parsed)) {
        const legacyIdx = parsed.findIndex(
          (p) =>
            p.id === "proj_seed_mannesmann" &&
            (!p.director?.directingCrewNotes ||
              p.visuals?.shots?.[0]?.imageUrl?.endsWith(".svg"))
        );
        if (legacyIdx >= 0) {
          parsed[legacyIdx] = seedShowcaseProjectAndMedia();
          fs.writeFileSync(PROJECTS_FILE, JSON.stringify(parsed, null, 2), "utf-8");
        }
      }
    } catch {
      // ignore
    }
  }
  if (!fs.existsSync(ASSETS_FILE)) {
    fs.writeFileSync(ASSETS_FILE, JSON.stringify([], null, 2), "utf-8");
  }
}

export function getAudioDir(): string {
  ensureDirs();
  return AUDIO_DIR;
}

export function getVisualsDir(): string {
  ensureDirs();
  return VISUALS_DIR;
}

export function getImagesDir(): string {
  ensureDirs();
  return IMAGES_DIR;
}

export function getVideosDir(): string {
  ensureDirs();
  return VIDEOS_DIR;
}

export function getVaultDir(): string {
  ensureDirs();
  return VAULT_DIR;
}

// ============================================================================
// Page Profiles (Multi-Channel Identity & Personal Voice Reference)
// ============================================================================
export function listPageProfiles(): PageProfile[] {
  ensureDirs();
  try {
    const parsed = JSON.parse(fs.readFileSync(PAGES_FILE, "utf-8")) as PageProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getPageProfile(id?: string | null): PageProfile | null {
  if (!id) return null;
  return listPageProfiles().find((p) => p.id === id) ?? null;
}

export function savePageProfile(profile: PageProfile): PageProfile {
  ensureDirs();
  const all = listPageProfiles();
  const now = new Date().toISOString();
  const updated: PageProfile = {
    ...profile,
    createdAt: profile.createdAt || now,
    updatedAt: now,
  };
  const idx = all.findIndex((p) => p.id === profile.id);
  if (idx >= 0) {
    all[idx] = updated;
  } else {
    all.unshift(updated);
  }
  fs.writeFileSync(PAGES_FILE, JSON.stringify(all, null, 2), "utf-8");
  return updated;
}

export function deletePageProfile(id: string): boolean {
  ensureDirs();
  const all = listPageProfiles();
  const filtered = all.filter((p) => p.id !== id);
  if (filtered.length === all.length) return false;
  fs.writeFileSync(PAGES_FILE, JSON.stringify(filtered, null, 2), "utf-8");
  return true;
}

// ============================================================================
// Competitor & Weekly Viral Radar Reports
// ============================================================================
export function listViralReports(): CompetitorViralReport[] {
  ensureDirs();
  try {
    const parsed = JSON.parse(fs.readFileSync(VIRAL_REPORTS_FILE, "utf-8")) as CompetitorViralReport[];
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime())
      : [];
  } catch {
    return [];
  }
}

export function saveViralReport(report: CompetitorViralReport): CompetitorViralReport {
  ensureDirs();
  const all = listViralReports();
  const idx = all.findIndex((r) => r.id === report.id);
  if (idx >= 0) {
    all[idx] = report;
  } else {
    all.unshift(report);
  }
  fs.writeFileSync(VIRAL_REPORTS_FILE, JSON.stringify(all, null, 2), "utf-8");
  return report;
}

// ============================================================================
// Persistent Self-Evolving Agent Memory (Global / Page / Project)
// ============================================================================
export function listAgentMemories(): AgentMemoryEntry[] {
  ensureDirs();
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORIES_FILE, "utf-8")) as AgentMemoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordAgentLearning(input: {
  agentId: AgentSuperRole;
  scope: MemoryScope;
  category: MemoryCategory;
  ruleText: string;
  sourceEvent: string;
  pageProfileId?: string | null;
  projectId?: string | null;
  initialStrength?: number;
}): AgentMemoryEntry[] {
  ensureDirs();
  const current = listAgentMemories();
  const updated = upsertLearnedMemory(current, input);
  fs.writeFileSync(MEMORIES_FILE, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export function deleteAgentMemory(id: string): boolean {
  ensureDirs();
  const all = listAgentMemories();
  const filtered = all.filter((m) => m.id !== id);
  if (filtered.length === all.length) return false;
  fs.writeFileSync(MEMORIES_FILE, JSON.stringify(filtered, null, 2), "utf-8");
  return true;
}

// ============================================================================
// Obsidian Second Brain Vault (Disk Sync + Bidirectional Knowledge Graph)
// ============================================================================
export function listCustomVaultNotes(): VaultNote[] {
  ensureDirs();
  try {
    const parsed = JSON.parse(fs.readFileSync(CUSTOM_VAULT_NOTES_FILE, "utf-8")) as VaultNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomVaultNote(input: {
  id?: string;
  title: string;
  folder: VaultNote["folder"];
  contentMd: string;
  tags?: string[];
}): VaultNote {
  ensureDirs();
  const all = listCustomVaultNotes();
  const cleanTitle = input.title.trim();
  const id = input.id?.trim() || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const note: VaultNote = {
    id,
    slug: slugifyVaultTitle(cleanTitle),
    folder: input.folder,
    title: cleanTitle,
    tags: input.tags?.length ? input.tags : ["یادداشت_استودیو"],
    wikilinks: parseWikilinks(input.contentMd),
    backlinks: [],
    contentMd: input.contentMd,
    updatedAt: new Date().toISOString(),
  };

  const idx = all.findIndex((n) => n.id === id);
  if (idx >= 0) {
    all[idx] = note;
  } else {
    all.unshift(note);
  }
  fs.writeFileSync(CUSTOM_VAULT_NOTES_FILE, JSON.stringify(all, null, 2), "utf-8");
  return note;
}

export function getVaultSnapshotAndSyncDisk(): VaultSnapshot {
  ensureDirs();
  const snapshot = buildVaultSnapshot({
    pages: listPageProfiles(),
    viralReports: listViralReports(),
    memories: listAgentMemories(),
    projects: listProjects(),
    customNotes: listCustomVaultNotes(),
  });

  // Sync real Obsidian-compatible .md files on disk under data/vault/<folder>/<slug>.md
  for (const note of snapshot.notes) {
    const folderDir = path.join(VAULT_DIR, note.folder);
    if (!fs.existsSync(folderDir)) fs.mkdirSync(folderDir, { recursive: true });
    const mdFilePath = path.join(folderDir, `${note.slug}.md`);
    fs.writeFileSync(mdFilePath, note.contentMd, "utf-8");
  }

  return snapshot;
}

// ============================================================================
// Projects & Media Files
// ============================================================================
export function listProjects(): ProjectRecord[] {
  ensureDirs();
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as ProjectRecord[];
    return parsed.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch {
    return [];
  }
}

export function getProject(id: string): ProjectRecord | null {
  const all = listProjects();
  return all.find((p) => p.id === id) ?? null;
}

export function saveProject(project: ProjectRecord): ProjectRecord {
  ensureDirs();
  const all = listProjects();
  const updated = { ...project, updatedAt: new Date().toISOString() };
  const idx = all.findIndex((p) => p.id === project.id);
  if (idx >= 0) {
    all[idx] = updated;
  } else {
    all.unshift(updated);
  }
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(all, null, 2), "utf-8");
  return updated;
}

export function createProject(brief: ProjectBrief): ProjectRecord {
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const project: ProjectRecord = {
    id,
    threadId: `thread_${id}`,
    createdAt: now,
    updatedAt: now,
    brief,
    currentStage: "input",
    checkpointStatus: "idle",
    waitingNode: null,
    errorMessage: null,
    researchScript: null,
    narration: null,
    voiceover: null,
    director: null,
    visuals: null,
    shotClips: [],
    davinciPackage: null,
    logs: [],
  };
  return saveProject(project);
}

export function deleteProject(id: string): boolean {
  ensureDirs();
  const all = listProjects();
  const filtered = all.filter((p) => p.id !== id);
  if (filtered.length === all.length) return false;
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(filtered, null, 2), "utf-8");
  return true;
}

export function saveAudioFile(filename: string, buffer: Buffer): string {
  ensureDirs();
  const safeName = path.basename(filename);
  const fullPath = path.join(AUDIO_DIR, safeName);
  fs.writeFileSync(fullPath, buffer);
  return `/api/media/audio/${safeName}`;
}

export function saveVisualSvgFile(filename: string, svgContent: string): string {
  ensureDirs();
  const safeName = path.basename(filename);
  const fullPath = path.join(VISUALS_DIR, safeName);
  fs.writeFileSync(fullPath, svgContent, "utf-8");
  return `/api/media/visuals/${safeName}`;
}

export function saveImageFile(filename: string, buffer: Buffer): string {
  ensureDirs();
  const safeName = path.basename(filename);
  const fullPath = path.join(IMAGES_DIR, safeName);
  fs.writeFileSync(fullPath, buffer);
  return `/api/media/images/${safeName}`;
}

export function saveVideoFile(filename: string, buffer: Buffer): string {
  ensureDirs();
  const safeName = path.basename(filename);
  const fullPath = path.join(VIDEOS_DIR, safeName);
  fs.writeFileSync(fullPath, buffer);
  return `/api/media/videos/${safeName}`;
}

export function listStudioAssets(): StudioMediaAsset[] {
  ensureDirs();
  try {
    const raw = fs.readFileSync(ASSETS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as StudioMediaAsset[];
    return parsed.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

export function saveStudioAsset(asset: StudioMediaAsset): StudioMediaAsset {
  ensureDirs();
  const all = listStudioAssets();
  const idx = all.findIndex((a) => a.id === asset.id);
  if (idx >= 0) {
    all[idx] = asset;
  } else {
    all.unshift(asset);
  }
  fs.writeFileSync(ASSETS_FILE, JSON.stringify(all, null, 2), "utf-8");
  return asset;
}

export function deleteStudioAsset(id: string): boolean {
  ensureDirs();
  const all = listStudioAssets();
  const filtered = all.filter((a) => a.id !== id);
  if (filtered.length === all.length) return false;
  fs.writeFileSync(ASSETS_FILE, JSON.stringify(filtered, null, 2), "utf-8");
  return true;
}
