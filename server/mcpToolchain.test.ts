import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveSkillsDirectivePrompt,
  buildMcpServersConfigJson,
  getMcpToolchainState,
} from "./mcpToolchain.js";
import { resolveFreeEngineRoute } from "./video/graph.js";
import { buildBlenderSevenLayerPythonScript } from "./video/providers/blender.js";
import { generateAfterEffectsExtendScriptJsx } from "./video/afterEffectsExporter.js";
import { generateGoogleColabNotebookIpynb } from "./cloudGpuNotebooks.js";
import { auditSevenLayerSpecCompleteness } from "./video/shotQaGate.js";
import type { DirectorShot, ProjectRecord } from "../src/types/studio.js";

test("getMcpToolchainState exposes all 6 free/pro engines with OmniFlash disabled by default", () => {
  const state = getMcpToolchainState();
  assert.equal(state.omniFlashPolicy, "disabled_by_default");
  const ids = state.engines.map((e) => e.id);
  for (const required of [
    "hyperframes",
    "remotion",
    "blender",
    "comfyui",
    "ffmpeg",
    "nle_finishing",
  ]) {
    assert.ok(ids.includes(required as never), `Missing engine ${required}`);
  }

  const addonIds = state.addons.map((a) => a.id);
  assert.ok(addonIds.includes("blender_mcp_core"));
  assert.ok(addonIds.includes("blender_skill_pbr_3d"));
  assert.ok(addonIds.includes("blender_skill_live_3d_skeleton"));
  assert.ok(addonIds.includes("remotion_official_skills"));
  assert.ok(addonIds.includes("hyperframes_core_skill"));
  assert.ok(addonIds.includes("comfyui_mcp_server"));
  assert.ok(addonIds.includes("davinci_resolve_mcp"));
  assert.ok(addonIds.includes("after_effects_mcp_jsx"));
  assert.ok(addonIds.includes("video_effects_craft_presets"));

  const mcpJson = JSON.parse(buildMcpServersConfigJson()) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  assert.ok(mcpJson.mcpServers.blender_mcp_core);
  assert.ok(mcpJson.mcpServers.davinci_resolve_mcp);
  assert.ok(mcpJson.mcpServers.after_effects_mcp_jsx);

  const directive = buildActiveSkillsDirectivePrompt(["blender"]);
  assert.match(directive, /Live 3D Skeleton/);
});

test("resolveFreeEngineRoute blocks automatic omni_flash and routes across free engines", () => {
  // Never auto-routes to omni_flash
  const blocked = resolveFreeEngineRoute({
    requestedTool: "omni_flash",
    hasKeyframe: true,
    localBlenderAvailable: false,
    colabBlenderAvailable: false,
    remoteComfyUrl: null,
  });
  assert.equal(blocked.tool, "hyperframes");
  assert.match(blocked.fallbackReason, /HyperFrames/);

  // Uses Blender when Colab GPU Blender is connected
  const blenderColab = resolveFreeEngineRoute({
    requestedTool: "blender",
    hasKeyframe: false,
    localBlenderAvailable: false,
    colabBlenderAvailable: true,
    remoteComfyUrl: null,
  });
  assert.equal(blenderColab.tool, "blender");
  assert.equal(blenderColab.fallbackUsed, false);

  // Uses ComfyUI when Colab ComfyUI is connected
  const comfyColab = resolveFreeEngineRoute({
    requestedTool: "comfyui",
    hasKeyframe: true,
    localBlenderAvailable: false,
    colabBlenderAvailable: false,
    remoteComfyUrl: "https://example.trycloudflare.com",
  });
  assert.equal(comfyColab.tool, "comfyui");
  assert.equal(comfyColab.fallbackUsed, false);

  // Gracefully falls back to HyperFrames when Blender/Colab offline
  const blenderFallback = resolveFreeEngineRoute({
    requestedTool: "blender",
    hasKeyframe: false,
    localBlenderAvailable: false,
    colabBlenderAvailable: false,
    remoteComfyUrl: null,
  });
  assert.equal(blenderFallback.tool, "hyperframes");
  assert.equal(blenderFallback.fallbackUsed, true);
});

test("buildBlenderSevenLayerPythonScript generates PBR steel pipe, Live 3D Skeleton Armature, white/blue lights & particles", () => {
  const script = buildBlenderSevenLayerPythonScript({
    shotId: "shot_01",
    blenderPrompt: "Industrial seamless steel pipe with cool blue rim light and dark background",
    durationSec: 4,
    width: 1080,
    height: 1920,
    fps: 24,
    outputPath: "/tmp/shot_01.mp4",
  });
  assert.match(script, /Pipe_Rig_Armature/);
  assert.match(script, /BrushedSteelPBR/);
  assert.match(script, /Metallic/);
  assert.match(script, /key_light/);
  assert.match(script, /rim_light_1/);
  assert.match(script, /TRACK_TO/);
  assert.match(script, /use_dof = True/);
});

test("generateAfterEffectsExtendScriptJsx builds executable AE ExtendScript with Vazirmatn & 3D Camera", () => {
  const mockProject = {
    id: "proj_test_ae",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentStage: "assembly",
    checkpointStatus: "waiting_approval",
    brief: {
      title: "تبلیغ صنعتی لوله فولادی مانیسمان",
      idea: "ساخت لوله بدون درز",
      platform: "instagram",
      tone: "cinematic_story",
      targetDurationSeconds: 30,
    },
    researchScript: null,
    voiceover: {
      narrationText: "لوله بدون درز فولادی",
      voiceName: "Charon",
      voiceStyle: "cinematic",
      estimatedSeconds: 10,
      wordCount: 4,
      pacingNotes: "",
      audioUrl: "/api/media/voice.wav",
      audioFilename: "voice.wav",
    },
    director: {
      visualDirectionSummary: "پس‌زمینه تاریک سینمایی با نور سفید و آبی",
      totalEstimatedSeconds: 8,
      shots: [
        {
          shotNumber: 1,
          timecode: "00:00 - 00:04",
          durationSeconds: 4,
          cameraAngle: "Close-up",
          cameraMovement: "Slow Push-in",
          sceneDescriptionFa: "لوله فولادی روی پس‌زمینه تاریک",
          spokenSegment: "لوله بدون درز",
          onScreenText: "فولاد بدون درز",
          lightingAndMood: "نور سفید و آبی روی فلز",
          visualPromptFa: "لوله فولادی در تاریکی",
        },
      ],
    },
    visuals: null,
    i2vPlans: null,
    videoProduction: null,
    stageHistory: [],
    lastError: null,
  } as unknown as ProjectRecord;

  const jsx = generateAfterEffectsExtendScriptJsx({ project: mockProject });
  assert.match(jsx, /addComp/);
  assert.match(jsx, /addCamera/);
  assert.match(jsx, /Vazirmatn-ExtraBold/);
  assert.match(jsx, /ADBE Glo2/);
  assert.match(jsx, /فولاد بدون درز/);
});

test("generateGoogleColabNotebookIpynb returns valid nbformat 4 notebook with Blender 4.2, ComfyUI plugins, FastAPI Bridge & cloudflared", () => {
  const raw = generateGoogleColabNotebookIpynb({
    platform: "google_colab",
    mode: "comfyui_i2v_worker",
    modelPreset: "wan22_5b_gguf",
  });
  const nb = JSON.parse(raw) as { nbformat: number; cells: Array<{ source: string[] }> };
  assert.equal(nb.nbformat, 4);
  assert.ok(nb.cells.length >= 6);
  const fullSource = nb.cells.map((c) => c.source.join("")).join("\n");
  assert.match(fullSource, /blender-4\.2/i);
  assert.match(fullSource, /ComfyUI-WanVideoWrapper/);
  assert.match(fullSource, /ComfyUI-GGUF/);
  assert.match(fullSource, /studio_gpu_bridge\.py/);
  assert.match(fullSource, /\/blender\/render/);
  assert.match(fullSource, /cloudflared/);
});

test("auditSevenLayerSpecCompleteness validates complete 7-layer industrial spec and flags empty specs", () => {
  const detailedShot: DirectorShot = {
    shotNumber: 1,
    timecode: "00:00 - 00:04",
    durationSeconds: 4,
    cameraAngle: "کلوزآپ ۴۵ درجه",
    cameraMovement: "حرکت دالی بسیار نرم به جلو",
    sceneDescriptionFa: "فضای تاریک استودیوی صنعتی با پس‌زمینه ذغالی و عمق میدان سینمایی",
    spokenSegment: "فولاد توپر چطور لوله بدون درز می‌شود؟",
    onScreenText: "فولاد بدون درز مانیسمان",
    lightingAndMood: "نور سفید سرد از بالا و نور حاشیه‌ای آبی روی سطح فلز",
    visualPromptFa: "لوله فولادی در پس‌زمینه تاریک با نور آبی و سفید",
    sevenLayerSpec: {
      scene: "پس‌زمینه تاریک و سینمایی استودیوی صنعتی با عمق میدان نرم و مه‌آلود ظریف",
      objects: "لوله فولادی بدون درز با متریال فلز برس‌خورده واقع‌گرایانه و تایپوگرافی فارسی",
      animation: "چرخش میلی‌متری لوله، درخشش متحرک روی سطح فلز و ذرات معلق ظریف در هوا",
      camera: "زاویه ۴۵ درجه لنز ۸۵ میلی‌متری با حرکت نرم و کنترل‌شده دالی رو به جلو",
      lighting: "نورهای سفید کلیدی و نور حاشیه‌ای آبی روی سطح فلز با سایه‌های عمیق و تمیز",
      transition: "ترنزیشن نرم اسلاید سینمایی همگام با ضرباهنگ به نمای مقطع لوله",
      soundDesign: "آمبیانس بم صنعتی، افکت ووش ملایم حرکت دوربین و ضربه فلزی دقیق",
    },
  };
  const passRes = auditSevenLayerSpecCompleteness(detailedShot);
  assert.equal(passRes.passed, true);
  assert.equal(passRes.missingLayers.length, 0);
  assert.ok(passRes.score >= 8.5);

  const vagueShot: DirectorShot = {
    shotNumber: 2,
    timecode: "00:04 - 00:07",
    durationSeconds: 3,
    cameraAngle: "باز",
    cameraMovement: "ثابت",
    sceneDescriptionFa: "کارخانه",
    spokenSegment: "تست",
    onScreenText: "",
    lightingAndMood: "نور",
    visualPromptFa: "لوله",
    sevenLayerSpec: {
      scene: "کارخانه",
      objects: "لوله",
      animation: "ندارد",
      camera: "ثابت",
      lighting: "عادی",
      transition: "کات",
      soundDesign: "موزیک",
    },
  };
  const failRes = auditSevenLayerSpecCompleteness(vagueShot);
  assert.equal(failRes.passed, false);
  assert.ok(failRes.missingLayers.length >= 5);
});
