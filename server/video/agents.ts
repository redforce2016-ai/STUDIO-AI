import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import fs from "node:fs";
import type {
  DirectorOutput,
  ResearchAndScriptOutput,
} from "../../src/types/studio.js";
import type {
  DeterministicVideoCheck,
  FinalQaReport,
  PalettePresetKind,
  ShotCompositionPlan,
  ShotSpec,
  VideoAspectFormat,
  VideoQualityMode,
  VisualCriticIssue,
  VisualCriticReport,
} from "../../src/types/videoPipeline.js";
import { executeAgentJsonWithRouter, getGoogleApiKeyFromRouter } from "../router.js";
import { getVideoConfig, resolveDimensions } from "./config.js";
import {
  COMPONENT_CATALOG_PROMPT,
  GOLDEN_SHOT_EXAMPLES,
} from "./golden_examples/index.js";
import { PALETTE_TOKENS } from "./remotion/tokens.js";
import {
  ScenarioParserResultSchema,
  ShotCompositionPlanSchema,
  VisualCriticReportSchema,
  evaluateCriticPass,
  parseWithZodRetry,
  validateCompositionPlanSafety,
} from "./schemas.js";

function getGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: getGoogleApiKeyFromRouter(),
    apiVersion: "v1beta",
    httpOptions: {
      apiVersion: "v1beta",
      headers: { "User-Agent": "aistudio-build" },
    },
  });
}

function getDefaultPalette(preset: PalettePresetKind): [string, string, string] {
  const t = PALETTE_TOKENS[preset] || PALETTE_TOKENS.studio_amber;
  return [t.bgPrimary, t.bgSecondary, t.accent];
}

/**
 * Node 1: scenario_parser
 * Converts a raw text scenario or Studio Director+Script output into strict Zod-validated ShotSpecs.
 * Never invents numbers/facts not present in the source scenario; flags unclear shots for clarification.
 */
export async function parseScenarioToShotSpecs(params: {
  scenarioText: string;
  aspectRatio: VideoAspectFormat;
  qualityMode: VideoQualityMode;
  director?: DirectorOutput | null;
  researchScript?: ResearchAndScriptOutput | null;
  narrationUrl?: string | null;
}): Promise<{
  needsClarification: boolean;
  clarificationQuestions: string[];
  shots: ShotSpec[];
}> {
  const cfg = getVideoConfig();
  const [width, height] = resolveDimensions(params.aspectRatio, params.qualityMode);

  const directorContext = params.director?.shots?.length
    ? `\n\nدکوپاژ موجود شات‌ها:\n${params.director.shots
        .map(
          (s) =>
            `- شات ${s.shotNumber} (${s.durationSeconds}s): هدف/صحنه=${s.sceneDescriptionFa} | گفتار=${s.spokenSegment} | تیتر=${s.onScreenText} | دوربین=${s.cameraAngle} / ${s.cameraMovement}`
        )
        .join("\n")}`
    : "";

  const parsed = await parseWithZodRetry(
    ScenarioParserResultSchema,
    async (attempt, lastError) => {
      const prompt = `شما تحلیلگر ساختاریافته سناریو (scenario_parser) برای پایپ‌لاین تولید ویدیو هستید.
متن سناریوی ورودی را به فهرست شات‌های دقیق و قابل رندر تبدیل کن.

قوانین سخت‌گیرانه (بسیار مهم):
1. هیچ عدد، آمار یا ادعای علمی از خودت اختراع نکن! فقط ارقام و حقایق موجود در متن سناریو را استفاده کن.
2. اگر سناریو مبهم، متناقض یا فاقد اطلاعات ضروری برای ساخت شات بود، فیلد needs_clarification را روی true بگذار و سوالات دقیق را در clarification_questions بنویس (اما فقط در ابهام واقعی).
3. برای هر شات فیلدهای زیر را کامل و دقیق پر کن:
   - shot_id: به شکل "shot_01", "shot_02", ...
   - shot_number: عدد ترتیبی ۱ به بالا
   - duration_sec: عدد بین ۲ تا ۱۵ ثانیه
   - fps: ${cfg.fps}
   - resolution: [${width}, ${height}]
   - intent: هدف دقیق ارتباطی و آموزشی این شات بر اساس سناریو
   - narration_text: متن دقیق گفتار یا نریشن همین شات به فارسی
   - tool: پیش‌فرض "remotion" (فقط اگر صراحتاً نیاز به شبیه‌سازی سه‌بعدی دارد "blender"، یا فقط اگر صراحتاً شات ویدیویی واقعی غیرممکن در موشن‌گرافیک است "generative_api")
   - visual: شامل layout از بین ["hero","split_screen","comparison","bar_chart","line_chart","feature_grid","timeline","device_mockup","logo_reveal","cta","generative_clip"]، primary_subject، background، foreground_elements (آرایه رشته)، headline (حداکثر ۸ کلمه فارسی)، subtitle، badge_text، chart_data (آرایه آبجکت {label, value, unit?, highlight?})، comparison_left و comparison_right (آبجکت {title, points: string[], isWinner?})، feature_items (آرایه آبجکت {title, description, metric?})، timeline_steps (آرایه آبجکت {stepLabel, title, detail})، kpi_counter ({value, label, prefix?, suffix?})، cta_label، camera_motion از بین ["static","push-in","pan","orbit"] و animation_notes
   - style: palette (آرایه ۳ رنگ hex)، palette_preset از ["studio_amber","slate_sky","emerald_tech","crimson_alert"]، typography: { font_family: "Vazirmatn", rtl: true }، mood
   - audio: { voiceover: true, music: null, sfx: [] }
   - transition_in: از ["cut","crossfade","slide","zoom","wipe"]
   - qa_checks: حداقل ۲ شرط قابل بررسی توسط منتقد بینایی (مثلاً «نمایش کامل تیتر بدون بریدگی»، «وجود اعداد دقیق سناریو روی نمودار»)
${attempt > 1 && lastError ? `\nخطای تلاش قبلی که باید اصلاح شود:\n${lastError}` : ""}

سناریوی ورودی:
${params.scenarioText}${directorContext}

فقط یک JSON Object معتبر مطابق اسکیما برگردان.`;

      const res = await executeAgentJsonWithRouter<unknown>({
        agentId: "director",
        prompt,
        systemInstruction:
          "شما فقط Spec ساختاریافته JSON تولید می‌کنید. هرگز عدد یا ادعای جدید نسازید. همه متون نمایشی باید فارسی روان و RTL باشند.",
        expectedKeys: ["shots"],
      });
      return JSON.stringify(res.data);
    },
    2
  );

  // Normalize resolution, fps, font, and shot_ids deterministically
  const normalizedShots: ShotSpec[] = parsed.shots.map((s, idx) => {
    const shotNum = idx + 1;
    const preset: PalettePresetKind = s.style?.palette_preset || "studio_amber";
    return {
      ...s,
      shot_id: s.shot_id || `shot_${String(shotNum).padStart(2, "0")}`,
      shot_number: shotNum,
      duration_sec: Math.max(2, Math.min(25, Number(s.duration_sec) || 4)),
      fps: cfg.fps,
      resolution: [width, height],
      style: {
        palette_preset: preset,
        palette: s.style?.palette?.length === 3 ? s.style.palette : getDefaultPalette(preset),
        typography: { font_family: "Vazirmatn", rtl: true },
        mood: s.style?.mood || "حرفه‌ای",
      },
      audio: {
        voiceover: s.audio?.voiceover ?? true,
        narration_path: params.narrationUrl ?? null,
        music: s.audio?.music ?? null,
        sfx: s.audio?.sfx ?? [],
      },
      qa_checks:
        s.qa_checks && s.qa_checks.length >= 2
          ? s.qa_checks
          : [
              "خوانایی کامل متن فارسی و اتصال حروف بدون بریدگی",
              `انطباق کامل تصویر با هدف شات: ${s.intent.slice(0, 60)}`,
            ],
    };
  });

  return {
    needsClarification: Boolean(parsed.needs_clarification),
    clarificationQuestions: parsed.clarification_questions || [],
    shots: normalizedShots,
  };
}

/**
 * Node 2: shot_planner
 * Completes missing visual details (safe margins, typography, layout hints, camera motion, transition pacing).
 */
export function planShotsForProduction(shots: ShotSpec[]): ShotSpec[] {
  return shots.map((shot, idx) => {
    const preset: PalettePresetKind =
      shot.style?.palette_preset ||
      (idx % 3 === 0 ? "studio_amber" : idx % 3 === 1 ? "slate_sky" : "emerald_tech");

    const palette = getDefaultPalette(preset);
    const headline =
      shot.visual.headline?.trim() ||
      shot.intent.split(/[.،:]/)[0]?.trim().split(/\s+/).slice(0, 8).join(" ") ||
      `صحنه ${shot.shot_number}`;

    // Ensure layout matches provided structured data so charts/comparisons render rich data
    let layout = shot.visual.layout;
    if (shot.visual.chart_data?.length && layout !== "line_chart") {
      layout = "bar_chart";
    } else if (shot.visual.comparison_left && shot.visual.comparison_right) {
      layout = "comparison";
    } else if (shot.visual.timeline_steps?.length) {
      layout = "timeline";
    } else if (shot.visual.feature_items?.length) {
      layout = "feature_grid";
    }

    return {
      ...shot,
      visual: {
        ...shot.visual,
        layout,
        headline,
        camera_motion:
          shot.visual.camera_motion || (idx === 0 ? "push-in" : idx % 2 === 0 ? "pan" : "static"),
        animation_notes:
          shot.visual.animation_notes ||
          "ورود با فیزیک spring، رعایت حاشیه امن، بدون هم‌پوشانی زیرنویس و تیتر",
      },
      style: {
        ...shot.style,
        palette_preset: preset,
        palette,
        typography: { font_family: "Vazirmatn", rtl: true },
      },
      transition_in: idx === 0 ? "crossfade" : shot.transition_in || "slide",
    };
  });
}

/**
 * Deterministic Composition Builder fallback if LLM returns malformed component props
 */
export function buildDeterministicCompositionFromShot(spec: ShotSpec): ShotCompositionPlan {
  const [width, height] = spec.resolution;
  const preset = spec.style.palette_preset;
  const palette = spec.style.palette;
  const v = spec.visual;
  const nodes: ShotCompositionPlan["nodes"] = [
    {
      component: "Background",
      props: { showGrid: true, glowPosition: spec.shot_number === 1 ? "top" : "center" },
    },
  ];

  if (v.layout === "bar_chart" && v.chart_data?.length) {
    if (v.headline) {
      nodes.push({
        component: "Headline",
        props: { text: v.headline, badge: v.badge_text, align: "center" },
      });
    }
    nodes.push({
      component: "BarChart",
      props: { title: v.chart_title || v.primary_subject, data: v.chart_data },
    });
  } else if (v.layout === "line_chart" && v.chart_data?.length) {
    if (v.headline) {
      nodes.push({
        component: "Headline",
        props: { text: v.headline, badge: v.badge_text, align: "center" },
      });
    }
    nodes.push({
      component: "LineChart",
      props: { title: v.chart_title || v.primary_subject, data: v.chart_data },
    });
  } else if (v.layout === "comparison" && v.comparison_left && v.comparison_right) {
    if (v.headline) {
      nodes.push({
        component: "Headline",
        props: { text: v.headline, badge: v.badge_text, align: "center" },
      });
    }
    nodes.push({
      component: "Comparison",
      props: { left: v.comparison_left, right: v.comparison_right },
    });
  } else if (v.layout === "feature_grid" && v.feature_items?.length) {
    if (v.headline) {
      nodes.push({
        component: "Headline",
        props: { text: v.headline, badge: v.badge_text, align: "center" },
      });
    }
    nodes.push({
      component: "FeatureGrid",
      props: { items: v.feature_items },
    });
  } else if (v.layout === "timeline" && v.timeline_steps?.length) {
    if (v.headline) {
      nodes.push({
        component: "Headline",
        props: { text: v.headline, badge: v.badge_text, align: "center" },
      });
    }
    nodes.push({
      component: "Timeline",
      props: { steps: v.timeline_steps },
    });
  } else if (v.layout === "split_screen") {
    nodes.push({
      component: "SplitScreen",
      props: {
        primaryTitle: v.headline || v.primary_subject,
        primaryBody: v.subtitle || spec.intent,
        secondaryTitle: v.badge_text || "نکته کلیدی",
        secondaryBody: v.foreground_elements.slice(0, 2).join(" · ") || spec.narration_text.slice(0, 80),
      },
    });
  } else if (v.layout === "device_mockup") {
    nodes.push({
      component: "DeviceMockup",
      props: {
        title: v.device_title || v.headline || "مشخصات فنی",
        lines: v.foreground_elements.length
          ? v.foreground_elements.slice(0, 4)
          : [v.primary_subject, v.subtitle || spec.intent],
      },
    });
  } else if (v.layout === "logo_reveal") {
    nodes.push({
      component: "LogoReveal",
      props: {
        brandName: v.headline || "استودیو",
        tagline: v.subtitle || spec.intent,
      },
    });
  } else if (v.layout === "cta") {
    nodes.push({
      component: "CallToAction",
      props: {
        headline: v.headline || "گام بعدی خود را دقیق بردارید",
        actionLabel: v.cta_label || "دریافت راهنمای کامل",
        subnote: v.subtitle,
      },
    });
  } else {
    nodes.push({
      component: "Headline",
      props: {
        text: v.headline || v.primary_subject,
        badge: v.badge_text,
        align: "center",
      },
    });
    if (v.kpi_counter) {
      nodes.push({
        component: "Counter",
        props: v.kpi_counter,
      });
    } else if (v.subtitle) {
      nodes.push({
        component: "Subtitle",
        props: { text: v.subtitle, align: "center" },
      });
    } else {
      nodes.push({
        component: "Card",
        props: {
          title: v.primary_subject,
          body: spec.intent,
          tag: v.badge_text,
        },
      });
    }
  }

  return {
    shot_id: spec.shot_id,
    duration_sec: spec.duration_sec,
    fps: spec.fps,
    width,
    height,
    palette_preset: preset,
    palette,
    transition_in: spec.transition_in,
    camera_motion: v.camera_motion,
    caption_text: spec.narration_text,
    nodes,
  };
}

/**
 * Node 4: builder
 * Composes strictly from the Remotion Component Library using Schema + Tokens + 3 Golden Examples + Critic fixes.
 */
export async function buildShotCompositionPlan(params: {
  spec: ShotSpec;
  attempt: number;
  priorIssues: VisualCriticIssue[];
  humanInstruction?: string;
}): Promise<ShotCompositionPlan> {
  const [width, height] = params.spec.resolution;
  const examplesSnippet = JSON.stringify(
    GOLDEN_SHOT_EXAMPLES.map((g) => ({ name: g.name, plan: g.plan })),
    null,
    2
  );

  const feedbackBlock =
    params.priorIssues.length > 0
      ? `\n\nایرادات گزارش‌شده توسط Visual Critic در تلاش قبلی (باید تک‌تک آن‌ها را با تغییرات واقعی برطرف کنی!):\n${params.priorIssues
          .map((i, idx) => `${idx + 1}. فریم: ${i.frame} | مشکل: ${i.problem} | راه‌حل: ${i.fix}`)
          .join("\n")}`
      : "";

  const humanBlock = params.humanInstruction?.trim()
    ? `\n\nدستور مستقیم کاربر برای اصلاح این شات:\n${params.humanInstruction.trim()}`
    : "";

  try {
    const plan = await parseWithZodRetry(
      ShotCompositionPlanSchema,
      async (tryIdx, lastErr) => {
        const prompt = `شما Node «builder» در پایپ‌لاین تولید ویدیوی Remotion هستید.
بر اساس ShotSpec زیر، یک ShotCompositionPlan دقیق بسازید که فقط از کامپوننت‌های کتابخانه استفاده کند.

${COMPONENT_CATALOG_PROMPT}

مثال‌های طلایی مرجع (الگوی چیدمان تمیز و بدون بیرون‌زدگی):
${examplesSnippet}

مشخصات شات فعلی (تلاش شماره ${params.attempt}):
${JSON.stringify(params.spec, null, 2)}
${feedbackBlock}${humanBlock}
${tryIdx > 1 && lastErr ? `\nخطای اعتبارسنجی قبلی: ${lastErr}` : ""}

الزامات عددی دقیق که نباید تغییر کنند:
- shot_id: "${params.spec.shot_id}"
- duration_sec: ${params.spec.duration_sec}
- fps: ${params.spec.fps}
- width: ${width}
- height: ${height}
- palette_preset: "${params.spec.style.palette_preset}"
- palette: ${JSON.stringify(params.spec.style.palette)}

فقط یک JSON Object مطابق ShotCompositionPlan برگردان.`;

        const res = await executeAgentJsonWithRouter<ShotCompositionPlan>({
          agentId: "visuals",
          prompt,
          systemInstruction:
            "شما طراح کد ساختاریافته Remotion هستید. فقط کامپوننت‌های فهرست مجاز را ترکیب کنید و هیچ عدد یا حقیقت جدیدی خارج از ShotSpec نسازید.",
          expectedKeys: ["shot_id", "nodes"],
        });

        const enforced: ShotCompositionPlan = {
          ...res.data,
          shot_id: params.spec.shot_id,
          duration_sec: params.spec.duration_sec,
          fps: params.spec.fps,
          width,
          height,
          palette_preset: params.spec.style.palette_preset,
          palette: params.spec.style.palette,
          transition_in: params.spec.transition_in,
          camera_motion: params.spec.visual.camera_motion,
          caption_text: res.data.caption_text ?? params.spec.narration_text,
        };

        const safety = validateCompositionPlanSafety(enforced);
        if (!safety.valid) {
          throw new Error(`خطای ایمنی/چیدمان کامپوننت: ${safety.errors.join(" | ")}`);
        }
        return JSON.stringify(enforced);
      },
      2
    );

    return plan;
  } catch {
    // Safe fallback composition built strictly from typed ShotSpec fields
    return buildDeterministicCompositionFromShot(params.spec);
  }
}

/**
 * Node 7: visual_critic
 * Inspects actual extracted video frames with Gemini Vision alongside intent, qa_checks, and deterministic FFmpeg check.
 */
export async function evaluateShotWithVisualCritic(params: {
  spec: ShotSpec;
  attempt: number;
  scenarioText: string;
  frameFiles: Array<{ label: string; timestampSec: number; filePath: string }>;
  deterministicCheck: DeterministicVideoCheck;
}): Promise<VisualCriticReport> {
  const cfg = getVideoConfig();
  const ai = getGeminiClient();

  const imageParts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  for (const frame of params.frameFiles) {
    if (fs.existsSync(frame.filePath)) {
      const b64 = fs.readFileSync(frame.filePath).toString("base64");
      imageParts.push({ text: `فریم: ${frame.label}` });
      imageParts.push({
        inlineData: {
          mimeType: "image/png",
          data: b64,
        },
      });
    }
  }

  if (imageParts.length === 0) {
    return evaluateCriticPass(
      {
        shot_id: params.spec.shot_id,
        attempt: params.attempt,
        scores: {
          intent_match: 1,
          readability: 1,
          composition: 1,
          motion_quality: 1,
          polish: 1,
        },
        qa_checks_results: params.spec.qa_checks.map((check) => ({
          check,
          passed: false,
          note: "ویدیو یا فریم معتبری از رندر استخراج نشد.",
        })),
        passed: false,
        verdict_reason:
          params.deterministicCheck.failures.join(" | ") ||
          "فریم معتبری از خروجی رندر برای ممیزی بصری استخراج نشد.",
        issues: [
          {
            frame: "همه فریم‌ها",
            problem:
              params.deterministicCheck.failures.join(" | ") || "خروجی رندر خالی یا معیوب بود.",
            fix: "بازتولید کامل ساختار کامپوننت با چیدمان امن و استاندارد.",
          },
        ],
      },
      false
    );
  }

  const rubricPrompt = `شما «Visual Critic» — منتقد بصری و ناظر سخت‌گیر کنترل کیفیت ویدیو هستید.
تصاویر پیوست‌شده فریم‌های واقعی رندرشده از شات «${params.spec.shot_id}» (تلاش ${params.attempt}) هستند. هیچ شات ضعیف، ناخوانا، بریده‌شده یا بی‌ربط به سناریو نباید عبور کند!

اطلاعات مرجع شات:
- هدف اصلی شات (intent): ${params.spec.intent}
- متن گفتار/زیرنویس شات: ${params.spec.narration_text}
- متن سناریوی کل: ${params.scenarioText.slice(0, 800)}
- چک‌لیست QA الزامی شات: ${params.spec.qa_checks.map((c, i) => `${i + 1}) ${c}`).join(" | ")}
- نتیجه بررسی فنی FFmpeg/ffprobe: ${JSON.stringify(params.deterministicCheck)}

معیارهای سخت‌گیرانه رد کردن شات (حتی اگر ظاهر قشنگی داشته باشد):
1. عدم انطباق با intent یا نمایش عدد/اطلاعات اشتباه.
2. بریدگی، هم‌پوشانی زیرنویس با کارت‌ها، شکستگی اتصال حروف فارسی یا بیرون‌زدگی متن از کادر.
3. کنتراست پایین متن با پس‌زمینه یا فریم خالی/سیاه/فریز.
4. عدم رعایت هر یک از موارد qa_checks یا خطای فنی deterministicCheck.

برای هر فریم ارسال‌شده با دقت قضاوت کن و خروجی را دقیقاً طبق این JSON بده:
- shot_id: "${params.spec.shot_id}"
- attempt: ${params.attempt}
- scores: { intent_match (1-10), readability (1-10), composition (1-10), motion_quality (1-10), polish (1-10) }
- qa_checks_results: آرایه بررسی تک‌تک موارد qa_checks با { check, passed, note }
- passed: boolean (فقط وقتی true که هیچ امتیازی زیر ۷ نباشد، intent_match >= 8 باشد، و همه qa_checks تایید شوند)
- verdict_reason: توضیح صریح و فارسی دلیل قبول یا رد
- issues: اگر مشکلی وجود دارد آرایه { frame, problem, fix } با دستور اصلاح دقیق برای Node سازنده (builder)`;

  imageParts.push({ text: rubricPrompt });

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      shot_id: { type: Type.STRING },
      attempt: { type: Type.INTEGER },
      scores: {
        type: Type.OBJECT,
        properties: {
          intent_match: { type: Type.NUMBER },
          readability: { type: Type.NUMBER },
          composition: { type: Type.NUMBER },
          motion_quality: { type: Type.NUMBER },
          polish: { type: Type.NUMBER },
        },
        required: ["intent_match", "readability", "composition", "motion_quality", "polish"],
      },
      qa_checks_results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            check: { type: Type.STRING },
            passed: { type: Type.BOOLEAN },
            note: { type: Type.STRING },
          },
          required: ["check", "passed", "note"],
        },
      },
      passed: { type: Type.BOOLEAN },
      verdict_reason: { type: Type.STRING },
      issues: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            frame: { type: Type.STRING },
            problem: { type: Type.STRING },
            fix: { type: Type.STRING },
          },
          required: ["frame", "problem", "fix"],
        },
      },
    },
    required: ["shot_id", "attempt", "scores", "qa_checks_results", "passed", "verdict_reason", "issues"],
  };

  let rawJsonText = "";
  const modelsToTry = [cfg.visionCriticModel, "gemini-3.1-flash-lite"];
  let lastErr: unknown = null;

  for (const modelName of modelsToTry) {
    try {
      const res = await ai.models.generateContent({
        model: modelName,
        contents: { parts: imageParts as never },
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema as never,
          thinkingConfig:
            modelName === "gemini-4-hydrogen"
              ? { thinkingLevel: ThinkingLevel.LOW }
              : undefined,
        } as never,
      });
      rawJsonText = (res.text ?? "").trim();
      if (rawJsonText) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!rawJsonText) {
    throw new Error(
      `مدل بینایی Visual Critic در دسترس نبود: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
    );
  }

  const parsedReport = await parseWithZodRetry(
    VisualCriticReportSchema,
    async () => rawJsonText,
    1
  );

  return evaluateCriticPass(
    {
      ...parsedReport,
      shot_id: params.spec.shot_id,
      attempt: params.attempt,
    },
    params.deterministicCheck.passed
  );
}

/**
 * Node 10: final_qa
 * Inspects sampled frames and technical probe of assembled final.mp4.
 */
export async function evaluateFinalVideoQa(params: {
  finalCheck: DeterministicVideoCheck;
  sampleFrames: Array<{ label: string; timestampSec: number; filePath: string }>;
  scenarioText: string;
}): Promise<FinalQaReport> {
  const ai = getGeminiClient();
  const issues: string[] = [...params.finalCheck.failures];
  let continuityScore = params.finalCheck.passed ? 9 : 4;
  let summary = params.finalCheck.passed
    ? "ویدیوی نهایی تمام تست‌های فنی FFmpeg و تراز صدا را با موفقیت گذراند."
    : "ویدیوی نهایی در بررسی فنی FFmpeg با خطا مواجه شد.";

  if (params.sampleFrames.length > 0 && process.env.GEMINI_API_KEY?.trim()) {
    try {
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      for (const f of params.sampleFrames.slice(0, 5)) {
        if (fs.existsSync(f.filePath)) {
          parts.push({ text: f.label });
          parts.push({
            inlineData: {
              mimeType: "image/png",
              data: fs.readFileSync(f.filePath).toString("base64"),
            },
          });
        }
      }
      parts.push({
        text: `این فریم‌ها از فایل نهایی مونتاژشده استخراج شده‌اند. یکپارچگی رنگ، خوانایی متن فارسی و پیوستگی بین شات‌ها را با نمره ۱ تا ۱۰ بسنج و اگر پرش، بریدگی یا مشکل بصری وجود دارد در issues بنویس.\nسناریو: ${params.scenarioText.slice(0, 500)}`,
      });

      const res = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: { parts: parts as never },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              continuity_score: { type: Type.NUMBER },
              summary: { type: Type.STRING },
              issues: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["continuity_score", "summary", "issues"],
          } as never,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        } as never,
      });

      const parsed = JSON.parse((res.text ?? "{}").trim()) as {
        continuity_score?: number;
        summary?: string;
        issues?: string[];
      };
      if (typeof parsed.continuity_score === "number") {
        continuityScore = parsed.continuity_score;
      }
      if (parsed.summary) summary = parsed.summary;
      if (Array.isArray(parsed.issues)) issues.push(...parsed.issues);
    } catch {
      // Keep deterministic FFmpeg check result if Vision summary call hits transient quota
    }
  }

  return {
    passed: params.finalCheck.passed && continuityScore >= 7,
    duration_sec: params.finalCheck.duration_sec,
    width: params.finalCheck.width,
    height: params.finalCheck.height,
    fps: params.finalCheck.fps,
    mean_volume_db: params.finalCheck.mean_volume_db,
    black_frames_detected: params.finalCheck.black_frames_detected,
    frozen_frames_detected: params.finalCheck.frozen_frames_detected,
    continuity_score: continuityScore,
    summary,
    issues,
  };
}
