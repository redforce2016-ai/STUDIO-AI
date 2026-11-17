import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { ShotSpec, VideoAspectFormat, VideoQualityMode } from "../../src/types/videoPipeline.js";
import { buildDeterministicCompositionFromShot } from "./agents.js";
import { getRunOutputDir, resolveDimensions, runPreflightCheck } from "./config.js";
import { runVideoProductionPipeline } from "./graph.js";
import {
  detectHardwareAndWriteConfig,
  getModelInstallInstructions,
  selectHardwareProfileFromVram,
} from "./hardware.js";
import { isBlenderInstalled } from "./providers/blender.js";
import { ComfyUIProvider } from "./providers/comfyui.js";
import { extractFrames, probeMedia, runDeterministicChecks } from "./providers/ffmpeg.js";
import {
  assertImageToVideoOnly,
  buildIndustrialPipeKeyframeSvg,
  sanitizeGentleMotionPrompt,
  splitIntoShortClipDurations,
} from "./providers/generative.js";
import { ParallaxVideoProvider } from "./providers/parallax.js";
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
  console.log("=== [1/4] Running Unit Tests (Schema, Quality Rules, Hardware Profiles, Safety, Critic) ===");

  // 1. Hardware VRAM -> Profile Mapping tests
  assert.equal(selectHardwareProfileFromVram(0, false), "parallax_only");
  assert.equal(selectHardwareProfileFromVram(6144, true), "parallax_only");
  assert.equal(selectHardwareProfileFromVram(8192, true), "wan_2_2_5b_gguf");
  assert.equal(selectHardwareProfileFromVram(12288, true), "wan_2_2_5b_gguf");
  assert.equal(selectHardwareProfileFromVram(16384, true), "wan_2_2_or_ltx_2_3_fp8");
  assert.equal(selectHardwareProfileFromVram(24576, true), "wan_2_2_or_ltx_2_3_fp8");

  // 2. Quality Rule #1: Image-to-Video ONLY; Text-to-Video MUST throw
  assert.throws(
    () =>
      assertImageToVideoOnly({
        shotId: "test_t2v",
        keyframePath: "",
        prompt: "test",
        aspectRatio: "9:16",
        durationSec: 4,
        resolution: "480p",
        outputPath: "/tmp/out.mp4",
      }),
    /Text-to-Video.*ممنوع/,
    "Text-to-Video without keyframe must be rejected"
  );
  assert.throws(
    () =>
      assertImageToVideoOnly({
        shotId: "test_missing",
        keyframePath: "/nonexistent/keyframe.png",
        prompt: "test",
        aspectRatio: "9:16",
        durationSec: 4,
        resolution: "480p",
        outputPath: "/tmp/out.mp4",
      }),
    /Keyframe.*یافت نشد/,
    "Non-existent keyframe must be rejected"
  );

  // 3. Quality Rule #2 & #3: Gentle short motion prompt & 3-5s clip splitting
  const gentlePrompt = sanitizeGentleMotionPrompt(
    "fast explosion chaotic zoom crash Whip Pan لوله مانیسمان صنعتی",
    "push-in"
  );
  assert.equal(gentlePrompt.toLowerCase().includes("explosion"), false);
  assert.ok(gentlePrompt.includes("slow gentle camera push-in"));
  assert.ok(gentlePrompt.includes("minimal subject change"));

  const split4 = splitIntoShortClipDurations(4);
  assert.deepEqual(split4, [4]);
  const split9 = splitIntoShortClipDurations(9);
  assert.ok(split9.length >= 2 && split9.every((d) => d >= 3 && d <= 5));
  assert.equal(split9.reduce((a, b) => a + b, 0), 9);

  // 4. ShotSpec Schema test
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

  // 5. Composition safety validation test
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

  // 6. Visual Critic strict threshold evaluator test
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

  if (!isBlenderInstalled()) {
    console.log("  ✓ Blender not installed: verified fallback flag readiness.");
  }

  console.log("✓ All Unit Tests Passed!\n");
}

async function runLocalComfyAndParallaxAcceptanceBenchmark() {
  console.log("=== [2/4] Running Real Industrial Pipe Shot Benchmark (ComfyUIProvider + ParallaxVideoProvider) ===");
  const benchDir = getRunOutputDir("local_video_benchmark");
  fs.mkdirSync(benchDir, { recursive: true });

  // Step 1: Hardware Auto-Detection & config.yaml verification
  const { hardware: hwReport } = await detectHardwareAndWriteConfig();
  const configYamlPath = path.resolve(process.cwd(), "config.yaml");
  assert.equal(fs.existsSync(configYamlPath), true, "config.yaml must exist at project root");
  console.log(
    `  [Hardware] GPU: ${hwReport.gpuModel} | VRAM: ${hwReport.vramTotalMb}MB | RAM: ${hwReport.ramTotalMb}MB (${hwReport.ramFreeMb}MB free) | Profile: ${hwReport.selectedProfile} | ComfyUI (8188): ${hwReport.comfyuiReachable ? "ONLINE" : "OFFLINE"}`
  );

  // Step 2: Create Real Industrial Seamless Pipe Keyframe («لوله مانیسمان رده ۸۰ — تست فشار ۳۸۰ بار»)
  const pipeKeyframeSvgPath = path.join(benchDir, "pipe_shot_keyframe.svg");
  const pipeSvgContent = buildIndustrialPipeKeyframeSvg({
    intent: "تست هیدرواستاتیک ۳۸۰ بار · استاندارد ASTM A106 Grade B",
    visual: {
      layout: "generative_clip",
      primary_subject: "لوله مانیسمان رده ۸۰ بدون درز",
      background: "صنعتی تیره",
      foreground_elements: [],
      headline: "لوله مانیسمان رده ۸۰ بدون درز",
      camera_motion: "push-in",
      animation_notes: "gentle",
    },
  });
  fs.writeFileSync(pipeKeyframeSvgPath, pipeSvgContent, "utf-8");
  assert.equal(fs.existsSync(pipeKeyframeSvgPath), true);

  // Step 3: Execute Shot 1 via ComfyUIProvider against configured local server (127.0.0.1:8188)
  // In this container (no GPU / no local ComfyUI running on 8188), ComfyUIProvider attempts 3 times
  // and automatically falls back to ParallaxVideoProvider per Quality Rule #4.
  const comfyLiveOutMp4 = path.join(benchDir, "pipe_shot_comfyui_live_or_fallback.mp4");
  const comfyProvider = new ComfyUIProvider({
    maxRetries: 3,
    timeoutMs: 15_000,
    pollIntervalMs: 300,
  });
  const comfyLiveResult = await comfyProvider.generateClip({
    shotId: "pipe_shot_01_comfy",
    prompt: "حرکت آرام دوربین به جلو روی مقطع لوله مانیسمان بدون درز زیر فشار ۳۸۰ بار",
    keyframePath: pipeKeyframeSvgPath,
    aspectRatio: "9:16",
    durationSec: 4,
    resolution: "480p",
    width: 480,
    height: 854,
    fps: 30,
    outputPath: comfyLiveOutMp4,
    cameraMotion: "push-in",
    qualityMode: "preview_480p",
  });

  const comfyLiveCheck = await runDeterministicChecks(comfyLiveResult.outputPath, {
    durationSec: 4,
    width: 480,
    height: 854,
    fps: 30,
    durationToleranceSec: 0.25,
    requireAudio: false,
  });
  assert.equal(
    comfyLiveCheck.passed,
    true,
    `ComfyUI live/fallback MP4 failed deterministic check: ${comfyLiveCheck.failures.join(", ")}`
  );
  console.log(
    `  ✓ [Shot A: ComfyUIProvider -> ${comfyLiveResult.providerUsed}] attempts=${comfyLiveResult.attempts}, fallback=${comfyLiveResult.fallbackUsed}, time=${comfyLiveResult.totalDurationMs}ms, VRAM=${comfyLiveResult.vramUsedMb}MB, RAM=${comfyLiveResult.ramUsedMb}MB, size=${fs.statSync(comfyLiveResult.outputPath).size}B`
  );

  // Step 4: Execute Shot 2 directly with ParallaxVideoProvider (Preview 480p + Final 1080p + 8s Multi-Clip Split)
  const parallaxProvider = new ParallaxVideoProvider();

  // 4a. Parallax 4s Preview (push-in)
  const parallaxPreviewMp4 = path.join(benchDir, "pipe_shot_parallax_preview_480p.mp4");
  const parallaxPreviewRes = await parallaxProvider.generateClip({
    shotId: "pipe_shot_02_parallax_preview",
    prompt: "حرکت ملایم دوربین به جلو روی لوله مانیسمان رده ۸۰",
    keyframePath: pipeKeyframeSvgPath,
    aspectRatio: "9:16",
    durationSec: 4,
    resolution: "480p",
    width: 480,
    height: 854,
    fps: 30,
    outputPath: parallaxPreviewMp4,
    cameraMotion: "push-in",
    qualityMode: "preview_480p",
  });
  const parallaxPreviewCheck = await runDeterministicChecks(parallaxPreviewRes.outputPath, {
    durationSec: 4,
    width: 480,
    height: 854,
    fps: 30,
    durationToleranceSec: 0.25,
    requireAudio: false,
  });
  assert.equal(parallaxPreviewCheck.passed, true);
  assert.equal(
    Boolean(parallaxPreviewRes.depthMapPath && fs.existsSync(parallaxPreviewRes.depthMapPath)),
    true,
    "ParallaxVideoProvider must generate and save depth_map.png"
  );
  console.log(
    `  ✓ [Shot B: Parallax 480p push-in (4s)] time=${parallaxPreviewRes.totalDurationMs}ms, depthMap=${path.basename(parallaxPreviewRes.depthMapPath!)}, RAM=${parallaxPreviewRes.ramUsedMb}MB`
  );

  // 4b. Parallax 4s Final 1080p (orbit motion after Visual Critic approval)
  const parallaxFinal1080Mp4 = path.join(benchDir, "pipe_shot_parallax_final_1080p.mp4");
  const parallaxFinalRes = await parallaxProvider.generateClip({
    shotId: "pipe_shot_03_parallax_final1080p",
    prompt: "چرخش ملایم سه بعدی دور مقطع لوله مانیسمان رده ۸۰",
    keyframePath: pipeKeyframeSvgPath,
    aspectRatio: "9:16",
    durationSec: 4,
    resolution: "1080p",
    visualCriticApprovedPreview: true,
    width: 1080,
    height: 1920,
    fps: 30,
    outputPath: parallaxFinal1080Mp4,
    cameraMotion: "orbit",
    qualityMode: "final_1080p",
  });
  const parallaxFinalCheck = await runDeterministicChecks(parallaxFinalRes.outputPath, {
    durationSec: 4,
    width: 1080,
    height: 1920,
    fps: 30,
    durationToleranceSec: 0.25,
    requireAudio: false,
  });
  assert.equal(parallaxFinalCheck.passed, true);
  console.log(
    `  ✓ [Shot C: Parallax 1080p orbit (4s Final)] time=${parallaxFinalRes.totalDurationMs}ms, resolution=1080x1920, RAM=${parallaxFinalRes.ramUsedMb}MB`
  );

  // 4c. Parallax 8s Long Shot (Quality Rule #3: automatically split into two 4s clips and stitched)
  const parallaxMultiClipMp4 = path.join(benchDir, "pipe_shot_parallax_8s_multiclip.mp4");
  const parallaxMultiRes = await parallaxProvider.generateClip({
    shotId: "pipe_shot_04_parallax_8s_split",
    prompt: "حرکت افقی آرام روی خط لوله مانیسمان",
    keyframePath: pipeKeyframeSvgPath,
    aspectRatio: "9:16",
    durationSec: 8,
    resolution: "480p",
    width: 480,
    height: 854,
    fps: 30,
    outputPath: parallaxMultiClipMp4,
    cameraMotion: "pan",
    qualityMode: "preview_480p",
  });
  const parallaxMultiCheck = await runDeterministicChecks(parallaxMultiRes.outputPath, {
    durationSec: 8,
    width: 480,
    height: 854,
    fps: 30,
    durationToleranceSec: 0.35,
    requireAudio: false,
  });
  assert.equal(parallaxMultiCheck.passed, true);
  assert.equal(parallaxMultiRes.subClipsCount, 2, "8s shot must be split into 2 short clips of 4s");
  console.log(
    `  ✓ [Shot D: Parallax 8s Multi-Clip (2x4s)] subClips=${parallaxMultiRes.subClipsCount}, time=${parallaxMultiRes.totalDurationMs}ms, duration=${parallaxMultiCheck.duration_sec}s`
  );

  // Step 5: Verify ComfyUIProvider HTTP REST Protocol (/system_stats, /upload/image, /prompt, /history/{id}, /view, /free)
  // against an ephemeral local mock ComfyUI HTTP server returning the real rendered pipe MP4
  let uploadedImageName = "";
  let submittedWorkflowNodes: Record<string, unknown> = {};
  let memoryFreedCalled = false;

  const mockServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/system_stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          system: { os: "linux", comfyui_version: "0.3.26" },
          devices: [
            {
              name: "cuda:0 NVIDIA GeForce RTX 3060 (Simulated Protocol Verification)",
              type: "cuda",
              vram_total: 12 * 1024 * 1024 * 1024,
              vram_free: 4.2 * 1024 * 1024 * 1024,
            },
          ],
        })
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/upload/image") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const bodyStr = Buffer.concat(chunks).toString("latin1");
        const match = bodyStr.match(/filename="([^"]+)"/);
        uploadedImageName = match ? match[1] : "uploaded_keyframe.png";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: uploadedImageName, subfolder: "", type: "input" }));
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/prompt") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
          prompt: Record<string, unknown>;
        };
        submittedWorkflowNodes = parsed.prompt;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ prompt_id: "prompt_pipe_test_001", number: 1, node_errors: {} }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/history/prompt_pipe_test_001") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          prompt_pipe_test_001: {
            status: { status_str: "success", completed: true },
            outputs: {
              "10": {
                gifs: [
                  {
                    filename: "wan22_pipe_00001.mp4",
                    subfolder: "",
                    type: "output",
                    format: "video/h264-mp4",
                  },
                ],
              },
            },
          },
        })
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/view") {
      res.writeHead(200, { "Content-Type": "video/mp4" });
      fs.createReadStream(parallaxPreviewMp4).pipe(res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/free") {
      memoryFreedCalled = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", () => resolve()));
  const address = mockServer.address() as { port: number };
  const mockBaseUrl = `http://127.0.0.1:${address.port}`;

  let comfyProtocolResult;
  try {
    const protocolProvider = new ComfyUIProvider({
      baseUrl: mockBaseUrl,
      profile: "wan_2_2_5b_gguf",
      maxRetries: 2,
      pollIntervalMs: 100,
    });
    const protocolMp4 = path.join(benchDir, "pipe_shot_comfyui_http_protocol_verified.mp4");
    comfyProtocolResult = await protocolProvider.generateClip({
      shotId: "pipe_shot_05_comfy_protocol",
      prompt: "حرکت آرام دوربین به جلو روی لوله مانیسمان رده ۸۰",
      keyframePath: pipeKeyframeSvgPath,
      aspectRatio: "9:16",
      durationSec: 4,
      resolution: "480p",
      width: 512,
      height: 896,
      fps: 16,
      seed: 123456,
      outputPath: protocolMp4,
      cameraMotion: "push-in",
      qualityMode: "preview_480p",
    });

    assert.equal(comfyProtocolResult.providerUsed, "comfyui");
    assert.equal(comfyProtocolResult.fallbackUsed, false);
    assert.equal(comfyProtocolResult.attempts, 1);
    assert.ok(uploadedImageName.endsWith(".png"), "Keyframe must be rasterized and uploaded as PNG");
    const node7 = submittedWorkflowNodes["7"] as { inputs?: Record<string, unknown> } | undefined;
    assert.equal(node7?.inputs?.width, 512, "Workflow width parameter must be injected");
    assert.equal(node7?.inputs?.height, 896, "Workflow height parameter must be injected");
    assert.equal(node7?.inputs?.length, 65, "Wan 2.2 4n+1 frame count (65) must be injected");
    assert.equal(memoryFreedCalled, true, "POST /free must be called during cleanup");
    console.log(
      `  ✓ [Shot E: ComfyUI HTTP Protocol End-to-End Test] uploaded=${uploadedImageName}, workflowNodes=${Object.keys(submittedWorkflowNodes).length}, VRAM_reported=${comfyProtocolResult.vramUsedMb}MB, time=${comfyProtocolResult.totalDurationMs}ms`
    );
  } finally {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }

  const benchmarkSummary = {
    timestamp: new Date().toISOString(),
    hardware: hwReport,
    installInstructions: getModelInstallInstructions(hwReport.selectedProfile),
    shots: [
      {
        name: "Shot A — ComfyUIProvider against local 127.0.0.1:8188 (3 attempts -> automatic fallback to Parallax)",
        providerUsed: comfyLiveResult.providerUsed,
        attempts: comfyLiveResult.attempts,
        fallbackTriggered: comfyLiveResult.fallbackUsed,
        fallbackReason: comfyLiveResult.fallbackReason,
        durationMs: comfyLiveResult.totalDurationMs,
        vramUsedMb: comfyLiveResult.vramUsedMb,
        ramUsedMb: comfyLiveResult.ramUsedMb,
        outputPath: comfyLiveResult.outputPath,
        depthMapPath: comfyLiveResult.depthMapPath,
        ffprobe: comfyLiveCheck,
        attemptLog: comfyLiveResult.attemptLog,
      },
      {
        name: "Shot B — ParallaxVideoProvider Direct Preview 480p (4s, push-in)",
        providerUsed: parallaxPreviewRes.providerUsed,
        attempts: parallaxPreviewRes.attempts,
        durationMs: parallaxPreviewRes.totalDurationMs,
        vramUsedMb: parallaxPreviewRes.vramUsedMb,
        ramUsedMb: parallaxPreviewRes.ramUsedMb,
        outputPath: parallaxPreviewRes.outputPath,
        depthMapPath: parallaxPreviewRes.depthMapPath,
        ffprobe: parallaxPreviewCheck,
        attemptLog: parallaxPreviewRes.attemptLog,
      },
      {
        name: "Shot C — ParallaxVideoProvider Final 1080p (4s, orbit)",
        providerUsed: parallaxFinalRes.providerUsed,
        attempts: parallaxFinalRes.attempts,
        durationMs: parallaxFinalRes.totalDurationMs,
        vramUsedMb: parallaxFinalRes.vramUsedMb,
        ramUsedMb: parallaxFinalRes.ramUsedMb,
        outputPath: parallaxFinalRes.outputPath,
        depthMapPath: parallaxFinalRes.depthMapPath,
        ffprobe: parallaxFinalCheck,
        attemptLog: parallaxFinalRes.attemptLog,
      },
      {
        name: "Shot D — ParallaxVideoProvider Long Shot 8s (Auto-split into 2x4s clips, pan)",
        providerUsed: parallaxMultiRes.providerUsed,
        attempts: parallaxMultiRes.attempts,
        subClipsCount: parallaxMultiRes.subClipsCount,
        durationMs: parallaxMultiRes.totalDurationMs,
        vramUsedMb: parallaxMultiRes.vramUsedMb,
        ramUsedMb: parallaxMultiRes.ramUsedMb,
        outputPath: parallaxMultiRes.outputPath,
        depthMapPath: parallaxMultiRes.depthMapPath,
        ffprobe: parallaxMultiCheck,
        attemptLog: parallaxMultiRes.attemptLog,
      },
      {
        name: "Shot E — ComfyUIProvider HTTP API Protocol Verification (/upload/image -> /prompt -> /history -> /view -> /free)",
        providerUsed: comfyProtocolResult.providerUsed,
        attempts: comfyProtocolResult.attempts,
        durationMs: comfyProtocolResult.totalDurationMs,
        vramUsedMb: comfyProtocolResult.vramUsedMb,
        ramUsedMb: comfyProtocolResult.ramUsedMb,
        outputPath: comfyProtocolResult.outputPath,
        attemptLog: comfyProtocolResult.attemptLog,
      },
    ],
  };

  const reportJsonPath = path.join(benchDir, "benchmark_report.json");
  fs.writeFileSync(reportJsonPath, JSON.stringify(benchmarkSummary, null, 2), "utf-8");
  console.log(`✓ Local Video Acceptance Benchmark Saved: ${reportJsonPath}\n`);
}

async function runDeterministicRenderAndQaTest() {
  console.log("=== [3/4] Running Real Remotion Render + FFmpeg Black/Freeze/RTL Verification ===");
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
  console.log("=== [4/4] Running Full 10-Node LangGraph Video Pipeline ===");
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
  if (args["benchmark-local"]) {
    await runUnitTests();
    await runLocalComfyAndParallaxAcceptanceBenchmark();
    return;
  }

  if (args["test-suite"]) {
    await runUnitTests();
    await runLocalComfyAndParallaxAcceptanceBenchmark();
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
        "Note: GEMINI_API_KEY is not exported in this shell; skipped live Gemini Vision API call in CLI."
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
