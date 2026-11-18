import test from "node:test";
import assert from "node:assert/strict";
import {
  compileAgentMemoryPromptBlock,
  evaluateShotApprovalProgress,
  normalizeDirectorShots3To8s,
  upsertLearnedMemory,
} from "./agentMemory";
import { buildVaultSnapshot, parseWikilinks } from "./vaultEngine";
import {
  generateDaVinciFcpxml,
  generateDaVinciResolvePythonScript,
  generatePersianSrtFromShots,
} from "./davinciResolve";
import {
  buildComfyUiLightweightWorkflow,
  getLocalEnginesStatus,
} from "./localVideoEngines";
import {
  auditDirectorCrewPlan,
  auditNarrationOutput,
  auditScenarioOutput,
} from "./qualityAssurance";
import type {
  AgentMemoryEntry,
  DirectorOutput,
  DirectorShot,
  NarrationScriptOutput,
  PageProfile,
  ProjectBrief,
  ProjectRecord,
  ResearchAndScriptOutput,
  ShotVideoClipRecord,
} from "../src/types/studio";

test("normalizeDirectorShots3To8s strictly clamps durations to 3-8s and builds contiguous timecodes", () => {
  const rawShots: DirectorShot[] = [
    {
      shotNumber: 1,
      timecode: "00:00 - 00:01",
      durationSeconds: 1, // too short -> should clamp to 3
      cameraAngle: "کلوزآپ",
      cameraMovement: "زوم سریع",
      sceneDescriptionFa: "نمایش برش لوله فولادی",
      spokenSegment: "این لوله تقلبی است!",
      onScreenText: "تقلب میلیاردی!",
      lightingAndMood: "کنتراست بالا",
      visualPromptFa: "کلوزآپ لوله فولادی",
    },
    {
      shotNumber: 2,
      timecode: "00:01 - 00:19",
      durationSeconds: 15, // too long -> should clamp to 8
      cameraAngle: "مدیوم شات",
      cameraMovement: "پن نرم",
      sceneDescriptionFa: "تست ضخامت با کولیس دیجیتال",
      spokenSegment: "با کولیس دیجیتال در سه ثانیه مچش را بگیرید.",
      onScreenText: "تست ۳ ثانیه‌ای",
      lightingAndMood: "نور کارگاهی",
      visualPromptFa: "کولیس روی لوله",
    },
  ];

  const { shots, totalEstimatedSeconds } = normalizeDirectorShots3To8s(rawShots);
  assert.equal(shots[0].durationSeconds, 3);
  assert.equal(shots[0].timecode, "00:00 - 00:03");
  assert.equal(shots[1].durationSeconds, 8);
  assert.equal(shots[1].timecode, "00:03 - 00:11");
  assert.equal(totalEstimatedSeconds, 11);
});

test("evaluateShotApprovalProgress enforces sequential per-shot approval gate", () => {
  const clips: ShotVideoClipRecord[] = [
    {
      shotNumber: 1,
      shotId: "shot_01",
      durationSeconds: 4,
      videoUrl: "/api/media/videos/s1.mp4",
      approvalStatus: "approved",
    },
    {
      shotNumber: 2,
      shotId: "shot_02",
      durationSeconds: 5,
      videoUrl: "/api/media/videos/s2.mp4",
      approvalStatus: "waiting_approval",
    },
  ];

  const state1 = evaluateShotApprovalProgress(3, clips);
  assert.equal(state1.approvedCount, 1);
  assert.equal(state1.allApproved, false);
  assert.equal(state1.activeUnlockShotNumber, 2);

  const allDoneClips: ShotVideoClipRecord[] = [
    { ...clips[0] },
    { ...clips[1], approvalStatus: "approved" },
    {
      shotNumber: 3,
      shotId: "shot_03",
      durationSeconds: 4,
      videoUrl: "/api/media/videos/s3.mp4",
      approvalStatus: "approved",
    },
  ];
  const state2 = evaluateShotApprovalProgress(3, allDoneClips);
  assert.equal(state2.approvedCount, 3);
  assert.equal(state2.allApproved, true);
});

test("upsertLearnedMemory deduplicates, reinforces strength, and compiles scoped agent prompt", () => {
  let memories: AgentMemoryEntry[] = [];

  memories = upsertLearnedMemory(memories, {
    agentId: "scriptwriter_agent",
    scope: "page",
    pageProfileId: "page_steel",
    category: "mistake_repaired",
    ruleText: "هرگز لوله مانیسمان صنعتی را به شوفاژ خانگی ربط نده",
    sourceEvent: "اصلاح کاربر در مرحله سناریو",
    initialStrength: 7,
  });

  // Duplicate feedback should reinforce strength from 7 -> 8 instead of adding duplicate
  memories = upsertLearnedMemory(memories, {
    agentId: "scriptwriter_agent",
    scope: "page",
    pageProfileId: "page_steel",
    category: "mistake_repaired",
    ruleText: "هرگز لوله مانیسمان صنعتی را به شوفاژ خانگی ربط نده",
    sourceEvent: "تاکید مجدد کاربر",
  });

  assert.equal(memories.length, 1);
  assert.equal(memories[0].strength, 8);
  assert.equal(memories[0].appliedCount, 2);

  const blockForSteel = compileAgentMemoryPromptBlock({
    memories,
    agentId: "scriptwriter_agent",
    pageProfileId: "page_steel",
  });
  assert.ok(blockForSteel.includes("لوله مانیسمان صنعتی"));

  const blockForOtherPage = compileAgentMemoryPromptBlock({
    memories,
    agentId: "scriptwriter_agent",
    pageProfileId: "page_mobile_repair",
  });
  assert.equal(blockForOtherPage, "");
});

test("Obsidian Vault parses [[wikilinks]] and builds bidirectional knowledge graph edges", () => {
  const links = parseWikilinks("مراجعه به [[پیج — آهن‌آلات مدرن]] و [[حافظه ایجنت سناریونویس|حافظه]]");
  assert.deepEqual(links, ["پیج — آهن‌آلات مدرن", "حافظه ایجنت سناریونویس"]);

  const samplePage: PageProfile = {
    id: "p1",
    name: "آهن‌آلات مدرن",
    handle: "@ahan_modern",
    platform: "instagram",
    defaultFormat: "reels",
    pageMaturity: "new_page",
    niche: "فروش مقاطع فولادی، تیرآهن و لوله صنعتی",
    contentStyle: "مستند صنعتی و تست کارگاهی",
    targetAudiencePersona: "پیمانکاران ساختمانی و مدیران خرید صنایع",
    audiencePainPoints: ["نوسان قیمت روزانه", "تشخیص بار تقلبی از اصل کارخانه"],
    brandTone: "educational",
    brandToneNoteFa: "متخصص، قاطع و قابل اعتماد",
    visualAestheticFa: "نور کارگاهی گرم با کنتراست بالا",
    tabooRedLines: ["قیمت‌دهی قطعی بدون تاریخ روز"],
    algorithmGuardrails: ["حفظ ریتم زیر ۵ ثانیه در هر کات"],
    competitorHandles: ["@ahanonline"],
    voiceProfile: {
      speakerName: "صدای مدیر فنی",
      voicePersona: "Fenrir",
      prosodyStyle: "قاطع، شمرده و صنعتی",
      sampleAudioUrl: null,
      cloneEnginePreference: "gemini_persona",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const snapshot = buildVaultSnapshot({
    pages: [samplePage],
    viralReports: [],
    memories: [],
    projects: [],
  });

  assert.equal(snapshot.nodes.length, 3); // 1 page + 2 agent memory hubs
  assert.equal(snapshot.edges.length, 2);
  const scriptMemNote = snapshot.notes.find((n) => n.title === "حافظه ایجنت سناریونویس");
  assert.ok(scriptMemNote?.backlinks.includes("پیج — آهن‌آلات مدرن"));
});

test("DaVinci Resolve generators output valid FCPXML v1.9, SRT timecodes, and Python script", () => {
  const mockProj: ProjectRecord = {
    id: "proj_test",
    threadId: "thread_test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    brief: {
      title: "تشخیص آی‌سی شارژ اصلی موبایل",
      idea: "تست جریان کشی برد موبایل",
      platform: "instagram",
      contentFormat: "reels",
      tone: "educational",
      targetDurationSeconds: 10,
    },
    currentStage: "davinci",
    checkpointStatus: "waiting_approval",
    waitingNode: null,
    errorMessage: null,
    researchScript: null,
    voiceover: null,
    director: {
      visualDirectionSummary: "کلوزآپ میکروسکوپی تعمیرات موبایل",
      totalEstimatedSeconds: 9,
      shots: [
        {
          shotNumber: 1,
          timecode: "00:00 - 00:04",
          durationSeconds: 4,
          cameraAngle: "ماکرو میکروسکوپ",
          cameraMovement: "ثابت",
          sceneDescriptionFa: "نمای آی‌سی زیر لوپ",
          spokenSegment: "این آی‌سی تقلبی گوشی مشتری را خاموش کرد.",
          onScreenText: "آی‌سی تقلبی!",
          sfxCueFa: "جرقه کوتاه",
          lightingAndMood: "نور سرد آزمایشگاهی",
          visualPromptFa: "برد موبایل زیر میکروسکوپ",
        },
        {
          shotNumber: 2,
          timecode: "00:04 - 00:09",
          durationSeconds: 5,
          cameraAngle: "روبرو",
          cameraMovement: "زوم نرم",
          sceneDescriptionFa: "نمایش عدد منبع تغذیه",
          spokenSegment: "عدد جریان کشی همه چیز را لو می‌دهد.",
          onScreenText: "تست منبع تغذیه",
          sfxCueFa: "بیپ دیجیتال",
          lightingAndMood: "نور نمایشگر",
          visualPromptFa: "منبع تغذیه دیجیتال تعمیرات",
        },
      ],
    },
    visuals: null,
    logs: [],
  };

  const srt = generatePersianSrtFromShots(mockProj.director!.shots);
  assert.ok(srt.includes("00:00:00,000 --> 00:00:03,920"));
  assert.ok(srt.includes("آی‌سی تقلبی!"));

  const fcpxml = generateDaVinciFcpxml(mockProj);
  assert.equal(fcpxml.width, 1080);
  assert.equal(fcpxml.height, 1920);
  assert.ok(fcpxml.xml.includes('<fcpxml version="1.9">'));
  assert.ok(fcpxml.xml.includes('ref="r_voiceover"'));

  const py = generateDaVinciResolvePythonScript(mockProj);
  assert.ok(py.includes("DaVinciResolveScript"));
  assert.ok(py.includes("ImportTimelineFromFile"));
});

test("auditScenarioOutput flags encyclopedic 'چیست' titles and approves tight hook/body/CTA scripts", () => {
  const brief: ProjectBrief = {
    title: "تشخیص لوله مانیسمان اصلی",
    idea: "تست رده چهل مانیسمان",
    platform: "instagram",
    contentFormat: "reels",
    tone: "educational",
    targetDurationSeconds: 30,
  };

  const weakScript: ResearchAndScriptOutput = {
    videoTitle: "لوله مانیسمان چیست؟",
    targetAudienceNote: "پیمانکاران",
    researchSummary: "خلاصه",
    keyInsights: ["ضخامت رده چهل"],
    trendingAngles: [],
    sources: [],
    hook: "سلام",
    body: "متن کوتاه.",
    cta: "فالو",
    psychologicalTriggersUsed: [],
    algorithmComplianceChecklist: [],
    keywords: [],
  };
  const weakAudit = auditScenarioOutput(weakScript, brief);
  assert.equal(weakAudit.passed, false);
  assert.ok(weakAudit.score < 80);

  const strongScript: ResearchAndScriptOutput = {
    videoTitle: "۳ ترفند تشخیص لوله مانیسمان رده ۴۰ اصلی سر پروژه",
    targetAudienceNote: "پیمانکاران تاسیسات",
    researchSummary: "بررسی تفاوت جوش درز مخفی و لوله واقعی بدون درز اهواز",
    keyInsights: ["استاندارد ضخامت ۳.۹۱ میلی‌متر برای سایز ۲ اینچ", "تست سایه درز داخل لوله با چراغ‌قوه"],
    trendingAngles: ["افشای تقلب بازار آهن"],
    sources: [],
    hook: "اگر سر پروژه لوله مانیسمان می‌خری و با چراغ‌قوه داخلش را چک نمی‌کنی سرت کلاه می‌رود!",
    body:
      "خیلی از بارهای درزمخفی را به اسم مانیسمان اصل می‌فروشند که زیر فشار تست تاسیسات نشتی می‌دهد. " +
      "اولین کار این است که نوک چراغ‌قوه گوشی را داخل لبه لوله بیندازید تا خط جوش طولی لو برود. " +
      "دومین مرحله گرفتن ضخامت دیواره با کولیس دیجیتال در دو نقطه مقابل هم است تا یکنواختی لوله بدون درز تایید شود.",
    cta: "این ویدیو را ذخیره کن و برای مهندس خرید پروژه‌ات بفرست.",
    psychologicalTriggersUsed: ["ترس از ضرر مالی", "آموزش عملی ۳ ثانیه‌ای"],
    algorithmComplianceChecklist: ["قلاب زیر ۳ ثانیه", "ریتم جملات کوتاه", "سیگنال ذخیره بالا"],
    keywords: ["مانیسمان", "رده چهل"],
  };
  const strongAudit = auditScenarioOutput(strongScript, brief);
  assert.equal(strongAudit.passed, true);
  assert.ok(strongAudit.score >= 80);
});

test("auditNarrationOutput enforces Persian diacritics, breath pauses, and zero raw digits", () => {
  const brief: ProjectBrief = {
    title: "تست گویندگی",
    idea: "گویندگی فارسی",
    platform: "instagram",
    tone: "educational",
    targetDurationSeconds: 20,
  };

  const badNarration: NarrationScriptOutput = {
    plainNarrationText: "لوله 40 با قیمت 250000 تومان تست شد.",
    vocalizedNarrationText: "لوله 40 با قیمت 250000 تومان تست شد.",
    pronunciationGuide: [],
    rhythmAndPauseNotes: "",
    emotionArcSummary: "",
    estimatedSeconds: 18,
    wordCount: 7,
  };
  const badAudit = auditNarrationOutput(badNarration, brief);
  assert.equal(badAudit.passed, false);

  const goodNarration: NarrationScriptOutput = {
    plainNarrationText: "این لوله بدون درز تست فشار چهل را پاس کرد و آماده نصب است.",
    vocalizedNarrationText:
      "این لُولِهٔ بِدونِ دَرز [مکث کوتاه] تِستِ فِشارِ چِهِل را با قُدرَت پاس کَرد [مکث ۰.۴ ثانیه] وَ آمادِهٔ نَصب دَر پُروژِهٔ صَنعَتی اَست.",
    pronunciationGuide: [
      { word: "لوله", vocalized: "لُولِهٔ", emotionOrStressNote: "تاکید شمرده" },
      { word: "بدون درز", vocalized: "بِدونِ دَرز", emotionOrStressNote: "قاطع" },
      { word: "فشار", vocalized: "فِشارِ", emotionOrStressNote: "کسره اضافه" },
    ],
    rhythmAndPauseNotes: "مکث کوتاه قبل از عدد کیفی",
    emotionArcSummary: "شروع هشداردهنده و پایان مطمئن",
    estimatedSeconds: 18,
    wordCount: 18,
  };
  const goodAudit = auditNarrationOutput(goodNarration, brief);
  assert.equal(goodAudit.passed, true);
  assert.ok(goodAudit.score >= 80);
});

test("auditDirectorCrewPlan checks 5-role crew notes, Production Bible specs, and Reels <=8 word captions", () => {
  const director: DirectorOutput = {
    visualDirectionSummary: "مستند صنعتی کنتراست بالا",
    totalEstimatedSeconds: 9,
    directingCrewNotes: {
      showrunnerNoteFa: "بازگشایی راز تقلب لوله‌های درزدار",
      dopCinematographyNoteFa: "لنز ماکرو ۵۰ میلی‌متر با نور تنگستن کارگاهی",
      artDirectionNoteFa: "انبار فولاد واقعی بدون تزئین اضافه",
      editorRhythmNoteFa: "کات ضرب‌دار ۴ ثانیه‌ای",
      soundDesignNoteFa: "صدای ضربه فلز + نریشن خشک -14 LUFS",
    },
    shots: [
      {
        shotNumber: 1,
        timecode: "00:00 - 00:04",
        durationSeconds: 4,
        cameraAngle: "ماکرو صنعتی",
        cameraMovement: "پوش‌این نرم",
        sceneDescriptionFa: "نمای نزدیک دهانه برش خورده لوله",
        startFrameDescriptionFa: "دهانه برش‌خورده لوله فولادی در نور گرم",
        endFrameDescriptionFa: "فوکوس کامل روی خط مقطع فلز",
        spokenSegment: "این لوله تقلبی است!",
        onScreenText: "تقلب میلیاردی لوله",
        sfxCueFa: "ضربه فلز",
        lightingAndMood: "تنگستن کنتراست بالا",
        visualPromptFa: "نمای ماکرو لوله فولادی",
        microScenarioFa: "دست مهندس لوله را زیر نور می‌چرخاند",
        lensAndFramingFa: "50mm Macro f/2.8",
        lightingRigFa: "Key light 45deg tungsten",
        continuityLockFa: "لوله ۲ اینچ با دستکش چرمی صنعتی",
        photorealPromptStartEn: "Macro photograph of cut seamless steel pipe rim, tungsten workshop light, 9:16",
        photorealPromptEndEn: "Extreme closeup steel cross section grain focus, 9:16",
      },
      {
        shotNumber: 2,
        timecode: "00:04 - 00:09",
        durationSeconds: 5,
        cameraAngle: "زاویه دست مهندس",
        cameraMovement: "دالی آرام",
        sceneDescriptionFa: "اندازه‌گیری با کولیس دیجیتال",
        startFrameDescriptionFa: "فک کولیس روی دیواره لوله",
        endFrameDescriptionFa: "نمایش عدد ۳.۹۱ روی صفحه کولیس",
        spokenSegment: "با کولیس ضخامت را چک کن.",
        onScreenText: "تست کولیس ۳.۹۱",
        sfxCueFa: "بیپ دیجیتال",
        lightingAndMood: "نور تمیز کارگاهی",
        visualPromptFa: "کولیس دیجیتال روی لوله",
        microScenarioFa: "کولیس دیجیتال روی لبه لوله قفل می‌شود",
        lensAndFramingFa: "35mm f/2.0",
        lightingRigFa: "Top softbox + rim light",
        continuityLockFa: "همان لوله و دستکش از شات ۱",
        photorealPromptStartEn: "Engineer hands holding digital caliper measuring steel pipe wall, 9:16",
        photorealPromptEndEn: "Tight closeup LCD readout 3.91mm on caliper jaws, 9:16",
      },
    ],
  };

  const audit = auditDirectorCrewPlan(director);
  assert.equal(audit.passed, true);
  assert.equal(audit.score, 100);
});

test("buildComfyUiLightweightWorkflow & getLocalEnginesStatus provide vertical 4-step workflow and hyperframes default", async () => {
  const wf = buildComfyUiLightweightWorkflow();
  assert.equal(wf.prompt["4"].inputs.width, 576);
  assert.equal(wf.prompt["4"].inputs.height, 1024);
  assert.equal(wf.prompt["5"].inputs.steps, 4);

  const engines = await getLocalEnginesStatus();
  assert.ok(engines.some((e) => e.id === "hyperframes_html" && e.isDefault));
  assert.ok(engines.some((e) => e.id === "comfyui_light"));
});
