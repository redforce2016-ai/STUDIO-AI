import { z } from "zod";
import type { ShotCompositionPlan, ShotSpec, VisualCriticReport } from "../../src/types/videoPipeline.js";

export const ChartDatumSchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      const m = v.match(/(-?\d+(?:\.\d+)?)/);
      return { label: v.slice(0, 40), value: m ? Number(m[1]) : 50 };
    }
    return v;
  },
  z.object({
    label: z.string().min(1).max(60),
    value: z.preprocess((n) => (Number.isFinite(Number(n)) ? Number(n) : 0), z.number().finite()),
    unit: z.string().max(24).optional(),
    highlight: z.boolean().optional(),
  })
);

export const ComparisonSideSchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      return { title: v.slice(0, 60), points: [v.slice(0, 90)] };
    }
    return v;
  },
  z.object({
    title: z.string().min(1).max(70),
    subtitle: z.string().max(100).optional(),
    points: z.array(z.string().min(1).max(110)).min(1).max(5),
    metricLabel: z.string().max(50).optional(),
    isWinner: z.boolean().optional(),
  })
);

export const FeatureGridItemSchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      const parts = v.split(/[:،\-–]/);
      return {
        title: (parts[0] || v).trim().slice(0, 60) || "ویژگی",
        description: (parts.slice(1).join(" ") || v).trim().slice(0, 120) || v.trim(),
      };
    }
    return v;
  },
  z.object({
    title: z.string().min(1).max(60),
    description: z.string().min(1).max(130),
    metric: z.string().max(32).optional(),
  })
);

export const TimelineStepItemSchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      return { stepLabel: "گام", title: v.slice(0, 60), detail: v.slice(0, 120) };
    }
    return v;
  },
  z.object({
    stepLabel: z.string().min(1).max(32),
    title: z.string().min(1).max(65),
    detail: z.string().min(1).max(130),
  })
);

function normCameraMotion(val: unknown): "static" | "push-in" | "pan" | "orbit" {
  const s = String(val || "")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-");
  if (s === "static" || s === "fixed" || s === "none") return "static";
  if (s === "pan" || s === "slide" || s === "tracking" || s === "dolly") return "pan";
  if (s === "orbit" || s === "rotate" || s === "3d" || s === "arc") return "orbit";
  return "push-in";
}

function normTransition(val: unknown): "cut" | "crossfade" | "slide" | "zoom" | "wipe" {
  const s = String(val || "")
    .toLowerCase()
    .trim();
  if (s === "cut" || s === "hard") return "cut";
  if (s === "slide" || s === "push") return "slide";
  if (s === "zoom" || s === "scale") return "zoom";
  if (s === "wipe" || s === "reveal") return "wipe";
  return "crossfade";
}

function normLayout(val: unknown) {
  const s = String(val || "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, "_");
  const valid = [
    "hero",
    "split_screen",
    "comparison",
    "bar_chart",
    "line_chart",
    "feature_grid",
    "timeline",
    "device_mockup",
    "logo_reveal",
    "cta",
    "generative_clip",
  ];
  if (valid.includes(s)) return s;
  if (s.includes("bar")) return "bar_chart";
  if (s.includes("line")) return "line_chart";
  if (s.includes("compar")) return "comparison";
  if (s.includes("split")) return "split_screen";
  if (s.includes("grid") || s.includes("feature")) return "feature_grid";
  if (s.includes("time")) return "timeline";
  if (s.includes("device") || s.includes("mockup")) return "device_mockup";
  if (s.includes("logo")) return "logo_reveal";
  if (s.includes("cta") || s.includes("action")) return "cta";
  return "hero";
}

export const ShotSpecSchema = z.object({
  shot_id: z.string().min(1).max(40),
  shot_number: z.number().int().min(1),
  duration_sec: z.preprocess((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(1.5, Math.min(60, n)) : 4;
  }, z.number().min(1.5).max(60)),
  fps: z.preprocess((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(24, Math.min(60, Math.round(n))) : 30;
  }, z.number().int().min(24).max(60)).default(30),
  resolution: z.tuple([z.number().int().min(240), z.number().int().min(240)]),
  intent: z.string().min(4),
  narration_text: z.string().default(""),
  tool: z.preprocess((v) => {
    const s = String(v || "remotion").toLowerCase().trim();
    if (s === "blender" || s === "generative_api" || s === "remotion") return s;
    return "remotion";
  }, z.enum(["remotion", "blender", "generative_api"])).default("remotion"),
  fallback_used: z.boolean().optional(),
  fallback_reason: z.string().nullable().optional(),
  visual: z.object({
    layout: z.preprocess(
      normLayout,
      z.enum([
        "hero",
        "split_screen",
        "comparison",
        "bar_chart",
        "line_chart",
        "feature_grid",
        "timeline",
        "device_mockup",
        "logo_reveal",
        "cta",
        "generative_clip",
      ])
    ),
    primary_subject: z.string().min(2),
    background: z.string().min(2),
    foreground_elements: z.array(z.string()).default([]),
    headline: z.string().max(110).optional(),
    subtitle: z.string().max(220).optional(),
    badge_text: z.string().max(60).optional(),
    cta_label: z.string().max(80).optional(),
    device_title: z.string().max(80).optional(),
    chart_title: z.string().max(100).optional(),
    chart_data: z.array(ChartDatumSchema).max(8).optional(),
    comparison_left: ComparisonSideSchema.optional(),
    comparison_right: ComparisonSideSchema.optional(),
    feature_items: z.array(FeatureGridItemSchema).max(6).optional(),
    timeline_steps: z.array(TimelineStepItemSchema).max(5).optional(),
    kpi_counter: z
      .object({
        value: z.number().finite(),
        prefix: z.string().max(16).optional(),
        suffix: z.string().max(20).optional(),
        label: z.string().min(1).max(80),
      })
      .optional(),
    camera_motion: z.preprocess(normCameraMotion, z.enum(["static", "push-in", "pan", "orbit"])).default("push-in"),
    animation_notes: z.string().default("ورود نرم با فیزیک spring و سلسله‌مراتب تایپوگرافی"),
    blender_prompt: z.string().optional(),
    generative_prompt: z.string().optional(),
  }),
  style: z.object({
    palette: z.preprocess(
      (v) => (Array.isArray(v) && v.length === 3 ? v.map(String) : ["#0B0D11", "#14171F", "#F59E0B"]),
      z.tuple([z.string(), z.string(), z.string()])
    ),
    palette_preset: z.preprocess(
      (v) => {
        const s = String(v || "").toLowerCase().trim();
        return ["slate_sky", "studio_amber", "emerald_tech", "crimson_alert"].includes(s)
          ? s
          : "studio_amber";
      },
      z.enum(["slate_sky", "studio_amber", "emerald_tech", "crimson_alert"])
    ).default("studio_amber"),
    typography: z.object({
      font_family: z.preprocess(() => "Vazirmatn", z.literal("Vazirmatn")).default("Vazirmatn"),
      rtl: z.preprocess(() => true, z.literal(true)).default(true),
    }).default({ font_family: "Vazirmatn", rtl: true }),
    mood: z.string().default("حرفه‌ای و شفاف"),
  }),
  audio: z.object({
    voiceover: z.boolean().default(true),
    narration_path: z.string().nullable().optional(),
    music: z.string().nullable().optional(),
    sfx: z.array(z.string()).default([]),
  }).default({ voiceover: true, sfx: [] }),
  transition_in: z.preprocess(normTransition, z.enum(["cut", "crossfade", "slide", "zoom", "wipe"])).default("crossfade"),
  qa_checks: z.array(z.string().min(3)).min(1),
  needs_clarification: z.boolean().optional(),
  clarification_reason: z.string().nullable().optional(),
});

export const ScenarioParserResultSchema = z.object({
  needs_clarification: z.boolean().default(false),
  clarification_questions: z.array(z.string()).default([]),
  shots: z.array(ShotSpecSchema).min(1).max(20),
});

export const ALLOWED_COMPONENTS = [
  "Background",
  "Headline",
  "Subtitle",
  "BarChart",
  "LineChart",
  "Counter",
  "Card",
  "FeatureGrid",
  "Timeline",
  "SplitScreen",
  "Comparison",
  "LogoReveal",
  "DeviceMockup",
  "CaptionTrack",
  "CallToAction",
] as const;

export const ShotComponentNodeSchema = z.object({
  component: z.enum(ALLOWED_COMPONENTS),
  props: z.record(z.string(), z.unknown()),
});

export const ShotCompositionPlanSchema = z.object({
  shot_id: z.string().min(1),
  duration_sec: z.number().min(1.5).max(60),
  fps: z.number().int().min(24).max(60),
  width: z.number().int().min(240),
  height: z.number().int().min(240),
  palette_preset: z.enum(["slate_sky", "studio_amber", "emerald_tech", "crimson_alert"]),
  palette: z.tuple([z.string(), z.string(), z.string()]),
  transition_in: z.preprocess(normTransition, z.enum(["cut", "crossfade", "slide", "zoom", "wipe"])),
  camera_motion: z.preprocess(normCameraMotion, z.enum(["static", "push-in", "pan", "orbit"])),
  caption_text: z.string().default(""),
  nodes: z.array(ShotComponentNodeSchema).min(1).max(12),
  generative_video_url: z.string().nullable().optional(),
});

export const VisualCriticReportSchema = z.object({
  shot_id: z.string().min(1),
  attempt: z.number().int().min(1),
  scores: z.object({
    intent_match: z.number().min(1).max(10),
    readability: z.number().min(1).max(10),
    composition: z.number().min(1).max(10),
    motion_quality: z.number().min(1).max(10),
    polish: z.number().min(1).max(10),
  }),
  qa_checks_results: z
    .array(
      z.object({
        check: z.string().min(1),
        passed: z.boolean(),
        note: z.string().default(""),
      })
    )
    .default([]),
  passed: z.boolean(),
  verdict_reason: z.string().min(2),
  issues: z
    .array(
      z.object({
        frame: z.string().min(1),
        problem: z.string().min(1),
        fix: z.string().min(1),
      })
    )
    .default([]),
});

/**
 * Enforces strict deterministic pass thresholds (Section 7):
 * - all qa_checks passed
 * - no score < 7
 * - intent_match >= 8
 * - zero deterministic FFmpeg failures
 */
export function evaluateCriticPass(
  report: VisualCriticReport,
  deterministicPassed: boolean
): VisualCriticReport {
  const s = report.scores;
  const minScore = Math.min(
    s.intent_match,
    s.readability,
    s.composition,
    s.motion_quality,
    s.polish
  );
  const allChecksPassed =
    report.qa_checks_results.length === 0 ||
    report.qa_checks_results.every((c) => c.passed);

  const strictPassed =
    deterministicPassed &&
    s.intent_match >= 8 &&
    minScore >= 7 &&
    allChecksPassed;

  return {
    ...report,
    passed: strictPassed,
    verdict_reason:
      report.verdict_reason ||
      (strictPassed
        ? "تمامی معیارهای انطباق با سناریو، خوانایی و کیفیت فنی تایید شد."
        : "امتیاز یا یکی از شرط‌های QA به حد نصاب نرسید."),
  };
}

/**
 * Safety & layout validation for builder-generated composition plans.
 * Rejects disallowed code strings, empty content, oversized headlines, and unknown components.
 */
export function validateCompositionPlanSafety(plan: ShotCompositionPlan): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const parsed = ShotCompositionPlanSchema.safeParse(plan);
  if (!parsed.success) {
    errors.push(
      ...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    );
  }

  const serialized = JSON.stringify(plan);
  const forbiddenPatterns = [
    /<script/i,
    /\beval\s*\(/i,
    /\bFunction\s*\(/,
    /\brequire\s*\(/,
    /\bchild_process\b/,
    /\bfs\./,
    /\bprocess\.env\b/,
    /https?:\/\/fonts\.googleapis\.com/i,
  ];
  for (const pat of forbiddenPatterns) {
    if (pat.test(serialized)) {
      errors.push(`الگوی غیرمجاز امنیتی یا وابستگی خارجی در Spec یافت شد: ${pat.source}`);
    }
  }

  const hasBackground = plan.nodes.some((n) => n.component === "Background");
  if (!hasBackground) {
    errors.push("کامپوننت Background در چیدمان شات الزامی است.");
  }

  for (const node of plan.nodes) {
    if (node.component === "Headline") {
      const text = String(node.props?.text || "").trim();
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length > 10) {
        errors.push(`تیتر بیش از حد طولانی است (${words.length} کلمه) و خطر بریدگی دارد.`);
      }
      if (!text) {
        errors.push("مقدار Headline خالی است.");
      }
    }
    if (node.component === "BarChart" || node.component === "LineChart") {
      const data = node.props?.data;
      if (!Array.isArray(data) || data.length === 0) {
        errors.push(`کامپوننت ${node.component} فاقد داده عددی معتبر است.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Safe JSON extraction + Zod parser with automatic repair pass when LLM returns wrapped markdown.
 */
export function extractJsonCandidate(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced =
    trimmed.match(/```json\s*([\s\S]*?)\s*```/i) ||
    trimmed.match(/```\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const objMatch = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!objMatch) {
      throw new Error("خروجی مدل شامل JSON معتبر نبود.");
    }
    const cleaned = objMatch[1].replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(cleaned);
  }
}

export async function parseWithZodRetry<T>(
  schema: z.ZodType<T>,
  produceText: (attempt: number, lastError: string | null) => Promise<string>,
  maxAttempts = 2
): Promise<T> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await produceText(attempt, lastError);
      const parsedJson = extractJsonCandidate(raw);
      const validated = schema.safeParse(parsedJson);
      if (validated.success) {
        return validated.data;
      }
      lastError = validated.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(" | ");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`خطا در اعتبارسنجی ساختار JSON پس از ${maxAttempts} تلاش: ${lastError}`);
}

export function validateShotSpecStrict(input: unknown): ShotSpec {
  return ShotSpecSchema.parse(input) as ShotSpec;
}
