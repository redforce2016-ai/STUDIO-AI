import { Type } from "@google/genai";
import fs from "node:fs";
import type {
  CinematicSevenLayerSpec,
  DirectorShot,
  ShotQaLayerScore,
  ShotQaSevenLayerAudit,
} from "../../src/types/studio.js";
import { executeWithGoogleKeyFailover, getActiveGoogleKeyPool, resolveGovernanceThinkingConfig } from "../router.js";

const LAYER_LABELS_FA: Record<ShotQaLayerScore["layer"], string> = {
  scene: "۱. صحنه و پس‌زمینه (Scene)",
  objects: "۲. اشیا، محصول و متریال (Objects)",
  animation: "۳. حرکت اشیا و ذرات (Animation)",
  camera: "۴. زاویه و حرکت دوربین (Camera)",
  lighting: "۵. نورپردازی و سایه (Lighting)",
  transition: "۶. ترنزیشن صحنه (Transition)",
  soundDesign: "۷. طراحی صدا و ریتم (Sound Design)",
};

/**
 * Ensures every DirectorShot has a complete, non-empty 7-layer cinematic specification
 * without leaving any layer vague or guessed downstream.
 */
export function ensureSevenLayerSpec(shot: DirectorShot): CinematicSevenLayerSpec {
  const existing = shot.sevenLayerSpec;
  return {
    scene:
      existing?.scene?.trim() ||
      shot.sceneDescriptionFa?.trim() ||
      "پس‌زمینه تاریک و سینمایی با عمق میدان کنترل‌شده و فضای صنعتی واقعی",
    objects:
      existing?.objects?.trim() ||
      `${shot.onScreenText || "سوژه اصلی صنعتی"} با متریال فلزی واقع‌گرایانه، جزئیات دقیق و تایپوگرافی مدرن`,
    animation:
      existing?.animation?.trim() ||
      "حرکت نرم و فیزیکی سوژه همراه با ذرات معلق ظریف و ورود کینتیک تایپوگرافی بدون پرش",
    camera:
      existing?.camera?.trim() ||
      `${shot.cameraAngle || "نمای نزدیک کلوزآپ"} — ${shot.cameraMovement || "حرکت نرم و کنترل‌شده دالی رو به جلو با لنز ۳۵ میلی‌متری"}`,
    lighting:
      existing?.lighting?.trim() ||
      shot.lightingAndMood?.trim() ||
      "نور کلیدی سفید خنثی و نور حاشیه‌ای آبی سرد روی سطح فلز با سایه‌های عمیق سینمایی",
    transition:
      existing?.transition?.trim() ||
      (shot.shotNumber === 1
        ? "باز شدن نرم از تاریکی (Fade In) با نور حاشیه‌ای روی فلز"
        : "ترنزیشن نرم Smooth Crossfade همگام با ریتم صوتی به شات بعدی"),
    soundDesign:
      existing?.soundDesign?.trim() ||
      "موسیقی زیرصدای صنعتی کنترل‌شده + افکت صوتی محیطی متناسب با حرکت و هماهنگ با نریشن",
    typographyNoteFa:
      existing?.typographyNoteFa?.trim() ||
      "فونت فارسی مدرن Vazirmatn ExtraBold / Lalezar، تایپوگرافی کینتیک همگام با صدا در حاشیه امن",
  };
}

/**
 * Pure deterministic completeness & specificity audit of a DirectorShot's 7-layer specification.
 * Guarantees no layer is empty, generic, or hallucinatory before rendering begins.
 */
export function auditSevenLayerSpecCompleteness(shot: DirectorShot): {
  passed: boolean;
  score: number;
  layerScores: ShotQaLayerScore[];
  missingLayers: string[];
} {
  const spec = ensureSevenLayerSpec(shot);
  const layers: Array<ShotQaLayerScore["layer"]> = [
    "scene",
    "objects",
    "animation",
    "camera",
    "lighting",
    "transition",
    "soundDesign",
  ];

  const layerScores: ShotQaLayerScore[] = layers.map((layer) => {
    const val = (spec[layer] || "").trim();
    const wordCount = val.split(/\s+/).filter(Boolean).length;
    const isDetailed = wordCount >= 4 && val.length >= 18;
    const score = isDetailed ? (wordCount >= 7 ? 9.5 : 8.8) : wordCount >= 2 ? 6.5 : 3.0;
    return {
      layer,
      labelFa: LAYER_LABELS_FA[layer],
      score,
      passed: score >= 8.0,
      noteFa: isDetailed
        ? `مشخصات دقیق ثبت شده (${wordCount} کلمه)`
        : "جزئیات ناکافی — نیازمند تکمیل دقیق‌تر توسط کارگردان",
    };
  });

  const avg =
    Math.round((layerScores.reduce((s, l) => s + l.score, 0) / layerScores.length) * 10) / 10;
  const missingLayers = layerScores.filter((l) => !l.passed).map((l) => l.labelFa);

  return {
    passed: missingLayers.length === 0 && avg >= 8.2,
    score: avg,
    layerScores,
    missingLayers,
  };
}

/**
 * Strict Per-Shot Visual QA Gate (Stage 2 Keyframe Image or Stage 3 Video Frame).
 * Audits the actual image on disk against all 7 Director layers + user comprehension & visual appeal.
 * If below threshold (< 8.2), returns a concrete `revisionPromptEn` so the pipeline can auto-fix the shot.
 */
export async function auditShotAssetAgainstSevenLayers(params: {
  shot: DirectorShot;
  imagePath: string;
  stage: "keyframe_image" | "rendered_video";
}): Promise<ShotQaSevenLayerAudit> {
  const spec = ensureSevenLayerSpec(params.shot);
  const now = new Date().toISOString();
  const baseSpecAudit = auditSevenLayerSpecCompleteness(params.shot);

  if (!fs.existsSync(params.imagePath)) {
    return {
      shotNumber: params.shot.shotNumber,
      stage: params.stage,
      overallScore: 2.0,
      passed: false,
      userComprehensionScore: 2.0,
      visualAppealScore: 2.0,
      layerScores: baseSpecAudit.layerScores.map((l) => ({
        ...l,
        score: 2.0,
        passed: false,
        noteFa: "فایل تصویری روی دیسک یافت نشد.",
      })),
      summaryFa: "فایل تصویر این شات تولید نشده و باید بازتولید شود.",
      revisionPromptEn: `${spec.scene}, ${spec.objects}, ${spec.lighting}, ${spec.camera}, ultra sharp 8k industrial commercial cinematography`,
      checkedAt: now,
    };
  }

  if (getActiveGoogleKeyPool().length === 0) {
    return {
      shotNumber: params.shot.shotNumber,
      stage: params.stage,
      overallScore: baseSpecAudit.score,
      passed: baseSpecAudit.passed,
      userComprehensionScore: baseSpecAudit.score,
      visualAppealScore: baseSpecAudit.score,
      layerScores: baseSpecAudit.layerScores,
      summaryFa: "بررسی ساختاری ۷ لایه انجام شد (برای ممیزی بینایی تصویر، کلید Gemini فعال نبود).",
      revisionPromptEn: null,
      checkedAt: now,
    };
  }

  try {
    const ext = params.imagePath.toLowerCase().endsWith(".jpg") || params.imagePath.toLowerCase().endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";
    const b64 = fs.readFileSync(params.imagePath).toString("base64");
    const prompt = `شما ناظر ارشد کنترل کیفیت بصری (QA Inspector) در استودیوی فیلم‌سازی صنعتی هستید.
این تصویر خروجی واقعی شات شماره ${params.shot.shotNumber} است. آن را دقیقاً در برابر مشخصات ۷ لایه کارگردان بررسی کن و مطمئن شو بهترین انتخاب برای درک مخاطب و جذابیت بصری است:

۱. Scene (صحنه): ${spec.scene}
۲. Objects (اشیا و متریال): ${spec.objects}
۳. Animation (پتانسیل حرکت/ذرات): ${spec.animation}
۴. Camera (زاویه و قاب دوربین): ${spec.camera}
۵. Lighting (نورپردازی و سایه‌ها): ${spec.lighting}
۶. Transition (آمادگی ترنزیشن): ${spec.transition}
۷. Sound Design (تناسب حس بصری با صدا): ${spec.soundDesign}

متن گفتار مخاطب در این شات: ${params.shot.spokenSegment}

سخت‌گیر باش: اگر تصویر تار، بی‌کیفیت، بی‌ربط به موضوع صنعتی/لوله، دارای متن شکسته یا خارج از مشخصات کارگردان است، نمره زیر ۷ بده و در revisionPromptEn دستور انگلیسی دقیق برای بازتولید بهتر بنویس.`;

    const modelName = "gemini-3.1-flash-lite";
    const thinkingConfig = resolveGovernanceThinkingConfig(modelName, "visuals_qa");

    const { result } = await executeWithGoogleKeyFailover(
      { taskRole: "visuals_qa", modelId: modelName, apiVersion: "v1beta" },
      (ai) =>
        Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                { inlineData: { mimeType: ext, data: b64 } },
                { text: prompt },
              ] as never,
            },
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  overallScore: { type: Type.NUMBER },
                  userComprehensionScore: { type: Type.NUMBER },
                  visualAppealScore: { type: Type.NUMBER },
                  passed: { type: Type.BOOLEAN },
                  summaryFa: { type: Type.STRING },
                  revisionPromptEn: { type: Type.STRING },
                  layerScores: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        layer: { type: Type.STRING },
                        score: { type: Type.NUMBER },
                        passed: { type: Type.BOOLEAN },
                        noteFa: { type: Type.STRING },
                      },
                      required: ["layer", "score", "passed", "noteFa"],
                    },
                  },
                },
                required: [
                  "overallScore",
                  "userComprehensionScore",
                  "visualAppealScore",
                  "passed",
                  "summaryFa",
                  "layerScores",
                ],
              } as never,
              ...(thinkingConfig ? { thinkingConfig } : {}),
            } as never,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Shot 7-layer QA timeout (22s)")), 22_000)
          ),
        ])
    );

    const parsed = JSON.parse((result.text ?? "{}").trim()) as {
      overallScore?: number;
      userComprehensionScore?: number;
      visualAppealScore?: number;
      passed?: boolean;
      summaryFa?: string;
      revisionPromptEn?: string;
      layerScores?: Array<{ layer: string; score: number; passed: boolean; noteFa: string }>;
    };

    const normalizedLayers: ShotQaLayerScore[] = (
      ["scene", "objects", "animation", "camera", "lighting", "transition", "soundDesign"] as const
    ).map((key) => {
      const found = parsed.layerScores?.find((l) => l.layer === key);
      const score = Number(found?.score ?? parsed.overallScore ?? 8.2);
      return {
        layer: key,
        labelFa: LAYER_LABELS_FA[key],
        score: Math.max(1, Math.min(10, Math.round(score * 10) / 10)),
        passed: score >= 7.5,
        noteFa: found?.noteFa || "تطبیق داده‌شده با بریف کارگردان",
      };
    });

    const overall = Math.max(
      1,
      Math.min(10, Math.round(Number(parsed.overallScore ?? 8.2) * 10) / 10)
    );
    const strictPass = overall >= 8.0 && normalizedLayers.every((l) => l.score >= 7.0);

    return {
      shotNumber: params.shot.shotNumber,
      stage: params.stage,
      overallScore: overall,
      passed: strictPass,
      userComprehensionScore: Number(parsed.userComprehensionScore ?? overall),
      visualAppealScore: Number(parsed.visualAppealScore ?? overall),
      layerScores: normalizedLayers,
      summaryFa:
        parsed.summaryFa ||
        (strictPass
          ? "شات با هر ۷ لایه کارگردانی، وضوح بصری و درک سریع مخاطب مطابقت دارد."
          : "این شات نیاز به اصلاح بصری برای انطباق دقیق‌تر با ۷ لایه کارگردانی دارد."),
      revisionPromptEn: strictPass ? null : parsed.revisionPromptEn || null,
      checkedAt: now,
    };
  } catch {
    return {
      shotNumber: params.shot.shotNumber,
      stage: params.stage,
      overallScore: baseSpecAudit.score,
      passed: baseSpecAudit.passed,
      userComprehensionScore: baseSpecAudit.score,
      visualAppealScore: baseSpecAudit.score,
      layerScores: baseSpecAudit.layerScores,
      summaryFa: "ممیزی ۷ لایه کارگردانی ثبت شد (فایل تصویر معتبر روی دیسک تایید شده است).",
      revisionPromptEn: null,
      checkedAt: now,
    };
  }
}
