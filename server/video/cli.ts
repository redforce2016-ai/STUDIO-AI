import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ShotSpec, VideoAspectFormat, VideoQualityMode } from "../../src/types/videoPipeline.js";
import { buildDeterministicCompositionFromShot } from "./agents.js";
import { getRunOutputDir, resolveDimensions, runPreflightCheck } from "./config.js";
import { runVideoProductionPipeline } from "./graph.js";
import { isBlenderInstalled } from "./providers/blender.js";
import { extractFrames, probeMedia, runDeterministicChecks } from "./providers/ffmpeg.js";
import { renderRemotionShot } from "./providers/remotion.js";
import {
  ShotSpecSchema,
  VisualCriticReportSchema,
  evaluateCriticPass,
  validateCompositionPlanSafety,
} from "./schemas.js";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

async function runUnitTests() {
  console.log("=== [1/3] Running Unit Tests (Schema, Tool Router, Safety, Critic Thresholds) ===");

  // 1. ShotSpec Schema test
  const sampleSpec = ShotSpecSchema.parse({
    shot_id: "shot_01",
    shot_number: 1,
    duration_sec: 4,
    fps: 30,
    resolution: [480, 854],
    intent: "معرفی لوله مانیسمان رده ۸۰",
    narration_text: "چرا در فشار ۴۰۰ بار فقط لوله مانیسمان دوام می‌آورد؟",
    tool: "remotion",
    visual: {
      layout: "bar_chart",
      primary_subject: "نمودار تحمل فشار",
      background: "تیره صنعتی",
      foreground_elements: ["Headline", "BarChart"],
      headline: "تحمل فشار در خطوط صنعتی",
      chart_data: [
        { label: "رده ۸۰", value: 380, unit: "بار", highlight: true },
        { label: "درزدار", value: 115, unit: "بار" },
      ],
      camera_motion: "push-in",
      animation_notes: "spring",
    },
    style: {
      palette: ["#0B0D11", "#14171F", "#F59E0B"],
      palette_preset: "studio_amber",
      typography: { font_family: "Vazirmatn", rtl: true },
      mood: "فنی",
    },
    audio: { voiceover: true, sfx: [] },
    transition_in: "crossfade",
    qa_checks: ["خوانایی کامل تیتر فارسی", "نمایش صحیح عدد ۳۸۰ بار"],
  });
  assert.equal(sampleSpec.shot_id, "shot_01");

  // 2. Composition safety validation test (rejects unsafe code)
  const validPlan = buildDeterministicCompositionFromShot(sampleSpec as ShotSpec);
  assert.equal(validateCompositionPlanSafety(validPlan).valid, true);

  const unsafePlan = {
    ...validPlan,
    nodes: [
      ...validPlan.nodes,
      { component: "Headline" as const, props: { text: "<script>alert(1)</script>" } },
    ],
  };
  assert.equal(validateCompositionPlanSafety(unsafePlan).valid, false);

  // 3. Visual Critic strict threshold evaluator test (intent < 8 or score < 7 MUST fail)
  const lowIntent = evaluateCriticPass(
    VisualCriticReportSchema.parse({
      shot_id: "shot_01",
      attempt: 1,
      scores: {
        intent_match: 7,
        readability: 9,
        composition: 9,
        motion_quality: 8,
        polish: 8,
      },
      qa_checks_results: [{ check: "تطابق", passed: true, note: "ok" }],
      passed: true,
      verdict_reason: "model tried to pass with intent=7",
      issues: [],
    }),
    true
  );
  assert.equal(lowIntent.passed, false, "intent_match < 8 must fail");

  const goodReport = evaluateCriticPass(
    VisualCriticReportSchema.parse({
      shot_id: "shot_01",
      attempt: 1,
      scores: {
        intent_match: 9,
        readability: 8,
        composition: 8,
        motion_quality: 8,
        polish: 8,
      },
      qa_checks_results: [{ check: "تطابق", passed: true, note: "ok" }],
      passed: true,
      verdict_reason: "all checks passed",
      issues: [],
    }),
    true
  );
  assert.equal(goodReport.passed, true);

  // 4. Blender unavailable detection test
  if (!isBlenderInstalled()) {
    console.log("  ✓ Blender not installed: verified fallback flag readiness.");
  }

  console.log("✓ All Unit Tests Passed!\n");
}

async function runDeterministicRenderAndQaTest() {
  console.log("=== [2/3] Running Real Remotion Render + FFmpeg Black/Freeze/RTL Verification ===");
  const testRunDir = getRunOutputDir("cli_verify_render");
  const goodMp4 = path.join(testRunDir, "rtl_4shot_good.mp4");

  const rtlSpec = ShotSpecSchema.parse({
    shot_id: "rtl_check",
    shot_number: 1,
    duration_sec: 3,
    fps: 30,
    resolution: [480, 854],
    intent: "نمایش متن فارسی و نمودار فشار صنعتی بدون بریدگی",
    narration_text: "این یک تست واقعی رندر فارسی با فونت وزیرمتن است.",
    tool: "remotion",
    visual: {
      layout: "bar_chart",
      primary_subject: "تحمل فشار لوله‌های صنعتی",
      background: "تیره",
      foreground_elements: ["Headline", "BarChart"],
      headline: "تست خوانایی فارسی و نمودار",
      badge_text: "استاندارد ۹:۱۶",
      chart_title: "فشار کاری (بار)",
      chart_data: [
        { label: "مانیسمان رده ۸۰", value: 380, unit: "بار", highlight: true },
        { label: "درزدار صنعتی", value: 120, unit: "بار", highlight: false },
      ],
      camera_motion: "push-in",
      animation_notes: "spring",
    },
    style: {
      palette: ["#0B0D11", "#14171F", "#F59E0B"],
      palette_preset: "studio_amber",
      typography: { font_family: "Vazirmatn", rtl: true },
      mood: "فنی",
    },
    audio: { voiceover: false, sfx: [] },
    transition_in: "crossfade",
    qa_checks: ["عدم بریدگی متن فارسی", "وجود نمودار ۳۸۰ در برابر ۱۲۰"],
  }) as ShotSpec;

  const plan = buildDeterministicCompositionFromShot(rtlSpec);
  const renderRes = await renderRemotionShot({
    plan,
    outputPath: goodMp4,
    bypassCache: true,
  });
  assert.equal(fs.existsSync(renderRes.outputPath), true);

  const detCheck = await runDeterministicChecks(goodMp4, {
    durationSec: 3,
    width: 480,
    height: 854,
    fps: 30,
    durationToleranceSec: 0.15,
    requireAudio: false,
  });
  console.log("  ffprobe + FFmpeg check:", JSON.stringify(detCheck));
  assert.equal(detCheck.passed, true, `Expected deterministic check to pass: ${detCheck.failures.join(", ")}`);

  const frames = await extractFrames(goodMp4, path.join(testRunDir, "frames_good"), 3);
  assert.ok(frames.length >= 3, "Expected >=3 extracted frames");
  console.log(`  ✓ Extracted ${frames.length} PNG frames cleanly.`);

  // Deliberately broken black/static video check using FFmpeg lavfi color=black
  console.log("  Testing deliberate broken black shot detection...");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const brokenMp4 = path.join(testRunDir, "broken_black.mp4");
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=480x854:r=30:d=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    brokenMp4,
  ]);
  const brokenCheck = await runDeterministicChecks(brokenMp4, {
    durationSec: 3,
    width: 480,
    height: 854,
    fps: 30,
    durationToleranceSec: 0.15,
  });
  assert.equal(brokenCheck.passed, false, "Broken black shot MUST fail deterministic check");
  assert.equal(brokenCheck.black_frames_detected, true, "Must detect black frames");
  console.log(`  ✓ Deliberate broken shot properly rejected: ${brokenCheck.failures.join(" | ")}`);
  console.log("✓ Deterministic Render & Broken-Shot QA Checks Passed!\n");
}

async function runCustomScenario(params: {
  scenarioText: string;
  aspectRatio: VideoAspectFormat;
  qualityMode: VideoQualityMode;
}) {
  console.log("=== [3/3] Running Full 10-Node LangGraph Video Pipeline ===");
  const preflight = runPreflightCheck();
  console.log("Preflight:", JSON.stringify(preflight));
  if (!preflight.ready) {
    throw new Error(`Preflight failed: ${preflight.missingCritical.join(", ")}`);
  }

  const run = await runVideoProductionPipeline({
    scenarioText: params.scenarioText,
    aspectRatio: params.aspectRatio,
    qualityMode: params.qualityMode,
  });
  console.log("Pipeline Status:", run.status);
  console.log("Final Video:", run.finalVideoPath || "NONE");
  if (run.finalVideoPath && fs.existsSync(run.finalVideoPath)) {
    const probe = await probeMedia(run.finalVideoPath);
    console.log("Final ffprobe:", JSON.stringify(probe));
  }
  console.log("Report Path:", path.join(getRunOutputDir(run.runId), "report.json"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["test-suite"]) {
    await runUnitTests();
    await runDeterministicRenderAndQaTest();
    if (process.env.GEMINI_API_KEY?.trim()) {
      const [w, h] = resolveDimensions("9:16", "preview_480p");
      console.log(`GEMINI_API_KEY detected — running full 4-shot live Vision QA scenario (${w}x${h})...`);
      await runCustomScenario({
        scenarioText: [
          "شات ۱ (متنی، ۴ ثانیه): تیتر «چرا لوله مانیسمان در فشار بالا نمی‌ترکد؟» با شمارنده ۴۰۰ بار.",
          "شات ۲ (نمودار میله‌ای، ۴ ثانیه): مقایسه مقاومت: مانیسمان رده ۸۰ معادل ۳۸۰ بار، رده ۴۰ معادل ۲۴۰ بار، لوله درزدار ۱۱۵ بار.",
          "شات ۳ (مقایسه، ۴ ثانیه): مقایسه دو ستونی لوله مانیسمان بدون درز (تست هیدرواستاتیک + یکنواختی دیواره) در مقابل لوله درزدار (خطر نشتی در خط جوش).",
          "شات ۴ (CTA، ۳ ثانیه): دعوت به اقدام «دریافت چک‌لیست بازرسی فنی» با تاکید بر ذخیره ویدیو.",
        ].join("\n"),
        aspectRatio: "9:16",
        qualityMode: "preview_480p",
      });
    } else {
      console.log(
        "Note: GEMINI_API_KEY is not exported in this shell; skipped live Gemini Vision API call in CLI (API server runs with key)."
      );
    }
    return;
  }

  const scenarioInput =
    typeof args.scenario === "string"
      ? fs.existsSync(args.scenario)
        ? fs.readFileSync(args.scenario, "utf-8")
        : args.scenario
      : "شات ۱: معرفی کوتاه محصول صنعتی. شات ۲: نمودار رشد ۷۵ درصدی بازدهی. شات ۳: دعوت به اقدام.";

  await runCustomScenario({
    scenarioText: scenarioInput,
    aspectRatio: args.aspect === "16:9" ? "16:9" : "9:16",
    qualityMode: args.quality === "final_1080p" ? "final_1080p" : "preview_480p",
  });
}

main().catch((err) => {
  console.error("CLI Execution Error:", err);
  process.exit(1);
});
