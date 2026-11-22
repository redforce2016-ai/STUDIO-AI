import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type EngineStackId =
  | "blender"
  | "remotion"
  | "hyperframes"
  | "comfyui"
  | "ffmpeg"
  | "nle_finishing";

export type ToolchainItemKind = "mcp" | "plugin" | "skill";

export interface ToolchainAddonItem {
  id: string;
  engineId: EngineStackId;
  kind: ToolchainItemKind;
  name: string;
  repoOrPackage: string;
  installCommand: string;
  purposeFa: string;
  requiredFor: string[];
  enabled: boolean;
  /** Prompt/rule snippet injected into agents when enabled */
  agentDirective: string;
  /** Optional MCP server definition for mcp_servers.json export */
  mcpServerConfig?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
}

export interface EngineStackDefinition {
  id: EngineStackId;
  name: string;
  labelFa: string;
  categoryFa: string;
  costModel: "free_open_source" | "free_pro_nle";
  executionHost: "local_server" | "google_colab_gpu" | "desktop_nle" | "local_or_colab";
  descriptionFa: string;
  capabilities: string[];
}

export interface EngineRuntimeProbe {
  engineId: EngineStackId;
  localAvailable: boolean;
  colabCapable: boolean;
  colabConnected: boolean;
  detailFa: string;
}

export interface McpToolchainState {
  omniFlashPolicy: "disabled_by_default" | "manual_override_only";
  updatedAt: string;
  engines: EngineStackDefinition[];
  addons: ToolchainAddonItem[];
  runtimeProbes: EngineRuntimeProbe[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const TOOLCHAIN_STATE_PATH = path.join(DATA_DIR, "mcp_toolchain.json");

export const ENGINE_STACKS: EngineStackDefinition[] = [
  {
    id: "hyperframes",
    name: "HyperFrames",
    labelFa: "HyperFrames (موتور موشن و تایپوگرافی HTML/GSAP/Canvas)",
    categoryFa: "تولید ویدیوی رایگان محلی",
    costModel: "free_open_source",
    executionHost: "local_server",
    descriptionFa:
      "رندر فریم‌به‌فریم دقیق (1080×1920) با Chromium Headless + Canvas ذرات معلق + تایپوگرافی مدرن فارسی و FFmpeg بدون مصرف توکن OmniFlash.",
    capabilities: [
      "رندر 1080×1920 با فونت‌های Vazirmatn و Lalezar",
      "افکت ذرات معلق، نورهای آبی و سفید روی فلز، گرافیک صنعتی",
      "اجرای ۱۰۰٪ محلی و رایگان روی همین سرور",
    ],
  },
  {
    id: "remotion",
    name: "Remotion v4",
    labelFa: "Remotion (موشن‌گرافیک، نمودار، زیرنویس کینتیک)",
    categoryFa: "تولید ویدیوی رایگان محلی",
    costModel: "free_open_source",
    executionHost: "local_server",
    descriptionFa:
      "فریم‌ورک React برای ویدیو با ترنزیشن‌های نرم، کامپوننت‌های مقایسه و تایپوگرافی کینتیک فارسی RTL.",
    capabilities: [
      "تایپوگرافی پویا و انیمیشن spring",
      "نمودارها، مقایسه رده ۴۰/۸۰ و تایم‌لاین",
      "پشتیبانی بومی از زیرنویس کلمه‌به‌کلمه",
    ],
  },
  {
    id: "blender",
    name: "Blender 4.2 LTS",
    labelFa: "Blender 3D (رندر PBR صنعتی + اسکلت سه‌بعدی زنده)",
    categoryFa: "رندر سه‌بعدی رایگان (Colab GPU / محلی)",
    costModel: "free_open_source",
    executionHost: "local_or_colab",
    descriptionFa:
      "ساخت صحنه‌های سه‌بعدی واقعی (لوله فولادی با متریال PBR، نور سفید و آبی، ذرات معلق، دوربین دالی و اسکلت متحرک) و رندر روی GPU کولب یا سیستم محلی.",
    capabilities: [
      "متریال PBR فلز، فولاد برس‌خورده و بازتاب نور واقعی",
      "ریگ اسکلت زنده سه‌بعدی (Live 3D Skeleton / Armature)",
      "رندر واقعی Cycles/EEVEE روی Google Colab GPU",
    ],
  },
  {
    id: "comfyui",
    name: "ComfyUI GPU",
    labelFa: "ComfyUI (Wan 2.1/2.2 + Flux روی Google Colab GPU)",
    categoryFa: "تولید ویدیو و تصویر AI رایگان روی Colab GPU",
    costModel: "free_open_source",
    executionHost: "google_colab_gpu",
    descriptionFa:
      "اجرای مدل‌های ویدیوساز متن‌باز Wan 2.2 / LTX-Video / Flux روی GPU واقعی اکانت Google Colab شما بدون محدودیت مدل‌های پولی.",
    capabilities: [
      "تبدیل کی‌فریم تاییدشده QA به ویدیو (I2V) با Wan 2.2",
      "کنترل عمق و نور با ControlNet و IPAdapter",
      "اتصال مستقیم از طریق تونل واقعی Cloudflare به Colab",
    ],
  },
  {
    id: "ffmpeg",
    name: "FFmpeg Cinema Master",
    labelFa: "FFmpeg (مسترینگ سینمایی، ترنزیشن، زیرنویس ASS و صدا)",
    categoryFa: "تدوین و مسترینگ رایگان محلی",
    costModel: "free_open_source",
    executionHost: "local_server",
    descriptionFa:
      "مسترینگ نهایی 1080p با بیت‌ریت بالا، 3D LUT، ترنزیشن‌های xfade، سوختن زیرنویس کینتیک ASS با فونت‌های فارسی نصب‌شده و تراز صدای -14 LUFS.",
    capabilities: [
      "زیرنویس کینتیک ASS همگام با صدای واقعی نریشن",
      "ترنزیشن‌های سینمایی xfade + رنگ‌آمیزی 3D .cube LUT",
      "میکس صدای داکینگ حرفه‌ای (-14 LUFS)",
    ],
  },
  {
    id: "nle_finishing",
    name: "DaVinci Resolve / After Effects / Video Effects Craft",
    labelFa: "تدوین و میکس نهایی (DaVinci Resolve + After Effects + Video Effects Craft)",
    categoryFa: "ادیت نهایی و خروجی پروژه NLE",
    costModel: "free_pro_nle",
    executionHost: "desktop_nle",
    descriptionFa:
      "تولید خروجی پروژه آماده ویرایش برای DaVinci Resolve (.otio / .fcpxml / .cube) و اسکریپت خودکار Adobe After Effects (.jsx) به همراه پریست‌های نور و ترنزیشن Video Effects Craft.",
    capabilities: [
      "اسکریپت خودکار After Effects (.jsx) با لایه تایپوگرافی فارسی و دوربین سه‌بعدی",
      "تایم‌لاین کامل DaVinci Resolve (.otio + .fcpxml + .cube LUT)",
      "پریست‌های Light-Leak، هاله نور و رنگ سینمایی Video Effects Craft",
    ],
  },
];

/**
 * Curated, high-signal open-source MCP servers, plugins, and skills.
 * Zero bloat — strictly selected for industrial/commercial Reels video production.
 */
export const DEFAULT_TOOLCHAIN_ADDONS: ToolchainAddonItem[] = [
  // ---- BLENDER ----
  {
    id: "blender_mcp_core",
    engineId: "blender",
    kind: "mcp",
    name: "Blender MCP (ahujasid/blender-mcp)",
    repoOrPackage: "https://github.com/ahujasid/blender-mcp",
    installCommand: "uvx blender-mcp",
    purposeFa: "اتصال مستقیم ایجنت کارگردان به Blender برای ساخت و اجرای صحنه سه‌بعدی، متریال، دوربین و رندر واقعی.",
    requiredFor: ["3d_product", "industrial_pipe", "camera_rig"],
    enabled: true,
    agentDirective:
      "Blender MCP فعال است: شات‌های سه‌بعدی محصول/لوله فولادی باید با اسکریپت bpy دقیق شامل Principled BSDF Metallic=0.95، نور Area سفید و Rim آبی، ذرات معلق و انیمیشن نرم دوربین ساخته شوند.",
    mcpServerConfig: {
      command: "uvx",
      args: ["blender-mcp"],
    },
  },
  {
    id: "blender_skill_pbr_3d",
    engineId: "blender",
    kind: "skill",
    name: "Blender 3D Industrial PBR & Cycles Skill",
    repoOrPackage: "skill://blender-3d-pbr-industrial",
    installCommand: "built-in skill + Poly Haven HDRI/PBR",
    purposeFa: "اسکیل تخصصی طراحی متریال فلز واقع‌گرایانه، پس‌زمینه تاریک سینمایی، نور سفید/آبی و شیدینگ Cycles/EEVEE.",
    requiredFor: ["pbr_metal", "studio_lighting", "industrial_commercial"],
    enabled: true,
    agentDirective:
      "اسکیل Blender 3D PBR: برای سطوح فولادی از Anisotropic Brushed Steel، پس‌زمینه تاریک استودیویی (#06090F) و نورهای Key سفید سرد + Rim آبی استفاده شود.",
  },
  {
    id: "blender_skill_live_3d_skeleton",
    engineId: "blender",
    kind: "skill",
    name: "Live 3D Skeleton & Armature Rigging Skill",
    repoOrPackage: "skill://blender-live-3d-skeleton-rig",
    installCommand: "bpy Armature + DampedTrack + Geometry Nodes",
    purposeFa: "اسکیل ریگ و اسکلت زنده سه‌بعدی برای متحرک‌سازی نرم اجزای مکانیکی، کولیس، لوله و حرکت کنترل‌شده دوربین.",
    requiredFor: ["skeleton_rig", "mechanical_motion", "caliper_animation"],
    enabled: true,
    agentDirective:
      "اسکیل Live 3D Skeleton: برای اجزای متحرک (مانند کولیس اندازه‌گیری، غلتک مانیسمان یا حرکت دوربین) از استخوان‌بندی Armature و قید DampedTrack با منحنی Bezier نرم استفاده شود.",
  },
  {
    id: "blender_plugin_polyhaven_geonodes",
    engineId: "blender",
    kind: "plugin",
    name: "Poly Haven Assets & Geometry Nodes Particles",
    repoOrPackage: "https://polyhaven.com/api (integrated in blender-mcp)",
    installCommand: "Auto-enabled inside Colab Blender 4.2 setup",
    purposeFa: "تأمین بافت‌های PBR واقعی فلز و ایجاد ذرات معلق سینمایی (گردوغبار نوری و جرقه ظریف) با Geometry Nodes.",
    requiredFor: ["floating_particles", "realistic_textures"],
    enabled: true,
    agentDirective:
      "پلاگین Geometry Nodes: در پس‌زمینه تاریک صنعتی ذرات معلق ظریف با عمق میدان (DOF) و درخشش ملایم اضافه شود.",
  },

  // ---- REMOTION ----
  {
    id: "remotion_official_skills",
    engineId: "remotion",
    kind: "skill",
    name: "Remotion Official Agent Skills (remotion-dev/skills)",
    repoOrPackage: "https://github.com/remotion-dev/skills",
    installCommand: "npx skills add remotion-dev/skills",
    purposeFa: "اسکیل رسمی Remotion برای انیمیشن‌های دقیق فریم‌محور، فیزیک spring بدون لرزش و تایپوگرافی مدرن.",
    requiredFor: ["kinetic_typography", "charts", "comparison"],
    enabled: true,
    agentDirective:
      "اسکیل Remotion: تمام انیمیشن‌ها فقط با spring/interpolate و فونت‌های محلی Vazirmatn/Lalezar طراحی شوند؛ هیچ متن بدون حاشیه امن رندر نشود.",
  },
  {
    id: "remotion_plugin_transitions_captions",
    engineId: "remotion",
    kind: "plugin",
    name: "@remotion/transitions + @remotion/captions",
    repoOrPackage: "@remotion/transitions @remotion/captions",
    installCommand: "npm i @remotion/transitions @remotion/captions",
    purposeFa: "پلاگین ترنزیشن‌های سینمایی نرم و زیرنویس کینتیک همگام با زمان‌بندی گفتار.",
    requiredFor: ["audio_synced_captions", "smooth_transitions"],
    enabled: true,
    agentDirective:
      "پلاگین Remotion Captions & Transitions: زیرنویس‌ها در بسته‌های ۳ تا ۵ کلمه‌ای با هایلایت کلمه فعال و ترنزیشن نرم بین صحنه‌ها اجرا شوند.",
  },

  // ---- HYPERFRAMES ----
  {
    id: "hyperframes_core_skill",
    engineId: "hyperframes",
    kind: "skill",
    name: "HyperFrames Deterministic Renderer (heygen-com/hyperframes)",
    repoOrPackage: "https://github.com/heygen-com/hyperframes",
    installCommand: "npx skills add heygen-com/hyperframes (native Playwright+FFmpeg engine installed)",
    purposeFa: "تبدیل مستقیم HTML5/CSS/Canvas/SVG به ویدیوی 1080×1920 شفاف با نور فلزی، ذرات معلق و تایپوگرافی مدرن فارسی.",
    requiredFor: ["zero_cost_motion", "industrial_title_cards", "animated_overlays"],
    enabled: true,
    agentDirective:
      "اسکیل HyperFrames: برای شات‌های گرافیکی، نمایش مشخصات فنی، تایپوگرافی قدرتمند و انیمیشن ذرات معلق روی پس‌زمینه تاریک به‌جای OmniFlash از HyperFrames استفاده شود.",
  },

  // ---- COMFYUI ----
  {
    id: "comfyui_mcp_server",
    engineId: "comfyui",
    kind: "mcp",
    name: "ComfyUI MCP Server",
    repoOrPackage: "https://github.com/joenorton/comfyui-mcp-server",
    installCommand: "Installed & bridged via Google Colab FastAPI GPU Runtime",
    purposeFa: "ارسال گراف‌های JSON تولید تصویر و ویدیو (Wan 2.2 / Flux) از ایجنت به ComfyUI روی GPU کولب.",
    requiredFor: ["colab_gpu_i2v", "workflow_automation"],
    enabled: true,
    agentDirective:
      "ComfyUI MCP: در صورت اتصال GPU کولب، شات‌های فتورئالیستی I2V از طریق گراف Wan 2.2 / LTX-Video روی Colab GPU اجرا شوند.",
    mcpServerConfig: {
      command: "python3",
      args: ["-m", "comfyui_mcp_server"],
      env: { COMFYUI_URL: "http://127.0.0.1:8188" },
    },
  },
  {
    id: "comfyui_plugin_wan_vhs_gguf",
    engineId: "comfyui",
    kind: "plugin",
    name: "WanVideoWrapper + VideoHelperSuite + ComfyUI-GGUF",
    repoOrPackage: "kijai/ComfyUI-WanVideoWrapper + Kosinkadink/ComfyUI-VideoHelperSuite + city96/ComfyUI-GGUF",
    installCommand: "Auto-installed by Content Studio Google Colab Notebook",
    purposeFa: "نودهای کلیدی تولید ویدیوی سینمایی با مدل رایگان Wan 2.2 5B/14B روی کارت‌های T4/L4 کولب.",
    requiredFor: ["wan22_video", "gguf_low_vram", "mp4_encode"],
    enabled: true,
    agentDirective:
      "پلاگین WanVideoWrapper+GGUF: شات‌های صنعتی با کلیدفریم تاییدشده QA و پرامپت ۷ لایه به نود Wan2.2 ارسال می‌شوند.",
  },
  {
    id: "comfyui_plugin_controlnet_ipadapter",
    engineId: "comfyui",
    kind: "plugin",
    name: "ControlNet Aux (DepthAnythingV2) + IPAdapter Plus",
    repoOrPackage: "Fannovel16/comfyui_controlnet_aux + cubiq/ComfyUI_IPAdapter_plus",
    installCommand: "Auto-installed by Content Studio Google Colab Notebook",
    purposeFa: "حفظ یکپارچگی شکل لوله فولادی، زاویه دوربین و نورپردازی دقیق بین شات‌های پشت‌سرهم.",
    requiredFor: ["shot_consistency", "depth_control"],
    enabled: true,
    agentDirective:
      "پلاگین ControlNet & IPAdapter: برای حفظ ثبات ظاهر محصول (لوله فولادی و نور آبی-سفید) در شات‌های متوالی از رفرنس عمق و استایل استفاده شود.",
  },

  // ---- FFMPEG ----
  {
    id: "ffmpeg_mcp_master",
    engineId: "ffmpeg",
    kind: "mcp",
    name: "FFmpeg MCP + Kinetic ASS Libass Engine",
    repoOrPackage: "https://github.com/video-creator/ffmpeg-mcp",
    installCommand: "Built-in FFmpeg + libass + Vazirmatn/Lalezar TTF fonts",
    purposeFa: "تدوین، ترنزیشن‌های سینمایی xfade، زیرنویس کینتیک همگام با صدا (ASS Karaoke) و تراز صدای -14 LUFS.",
    requiredFor: ["cinema_mastering", "kinetic_ass_subtitles", "audio_sync"],
    enabled: true,
    agentDirective:
      "FFmpeg Master: همیشه از فونت‌های واقعی assets/fonts (Vazirmatn-ExtraBold و Lalezar)، همگام‌سازی واقعی زیرنویس با صدای WAV و بیت‌ریت سینمایی CRF 19 استفاده شود.",
    mcpServerConfig: {
      command: "uvx",
      args: ["ffmpeg-mcp"],
    },
  },

  // ---- NLE FINISHING (DAVINCI + AFTER EFFECTS + VIDEO EFFECTS CRAFT) ----
  {
    id: "davinci_resolve_mcp",
    engineId: "nle_finishing",
    kind: "mcp",
    name: "DaVinci Resolve MCP (lordhoell/davinci-resolve-mcp)",
    repoOrPackage: "https://github.com/lordhoell/davinci-resolve-mcp",
    installCommand: "uvx davinci-resolve-mcp + .otio / .fcpxml / .cube export",
    purposeFa: "اتصال به DaVinci Resolve Studio/Free برای تدوین نهایی، رنگ‌آمیزی حرفه‌ای با .cube LUT و تایم‌لاین OTIO.",
    requiredFor: ["davinci_color", "otio_timeline"],
    enabled: true,
    agentDirective:
      "DaVinci Resolve MCP: خروجی هر پروژه شامل تایم‌لاین .otio، فایل .fcpxml و فایل رنگ 3D .cube LUT آماده ایمپورت مستقیم باشد.",
    mcpServerConfig: {
      command: "uvx",
      args: ["davinci-resolve-mcp"],
    },
  },
  {
    id: "after_effects_mcp_jsx",
    engineId: "nle_finishing",
    kind: "mcp",
    name: "After Effects MCP + Automated ExtendScript (.jsx)",
    repoOrPackage: "https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt",
    installCommand: "npx aftereffects-mcp + built-in ExtendScript .jsx exporter",
    purposeFa: "تولید خودکار پروژه After Effects شامل کامپوزیشن 1080×1920، لایه‌های تایپوگرافی کینتیک فارسی، دوربین سه‌بعدی، Glow و همگام‌سازی صوتی.",
    requiredFor: ["after_effects_finish", "kinetic_titles", "vfx_compositing"],
    enabled: true,
    agentDirective:
      "After Effects MCP: برای هر پروژه فایل اجرایی ExtendScript (.jsx) با کی‌فریم‌های Easy Ease، فونت Vazirmatn، دوربین سه‌بعدی و افکت Glow/Lumetri تولید شود.",
    mcpServerConfig: {
      command: "npx",
      args: ["-y", "aftereffects-mcp-imt"],
    },
  },
  {
    id: "video_effects_craft_presets",
    engineId: "nle_finishing",
    kind: "plugin",
    name: "Video Effects Craft (Cinema LUTs, Light-Leaks & Transition Pack)",
    repoOrPackage: "builtin://video-effects-craft-presets",
    installCommand: "Built-in Cinema Mastering & Transition Shader Pack",
    purposeFa: "مجموعه افکت‌های نوری، هاله درخشش (Halation)، گرین فیلم ۳۵ میلی‌متری و ترنزیشن‌های نرم مخصوص ریلز صنعتی و تبلیغاتی.",
    requiredFor: ["halation_glow", "cinema_transitions", "steel_blue_grade"],
    enabled: true,
    agentDirective:
      "Video Effects Craft: استفاده از ترنزیشن‌های نرم کنترل‌شده، هاله ملایم روی بازتاب‌های سفید/آبی فلز و گریدینگ سینمایی یکپارچه در تمام شات‌ها.",
  },
];

function commandExists(cmd: string): boolean {
  try {
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }).trim();
    return Boolean(out);
  } catch {
    return false;
  }
}

function loadEnabledOverrides(): Record<string, boolean> {
  try {
    if (fs.existsSync(TOOLCHAIN_STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(TOOLCHAIN_STATE_PATH, "utf-8")) as {
        enabledMap?: Record<string, boolean>;
      };
      if (raw?.enabledMap && typeof raw.enabledMap === "object") {
        return raw.enabledMap;
      }
    }
  } catch {
    // ignore malformed file
  }
  return {};
}

function saveEnabledOverrides(enabledMap: Record<string, boolean>): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    TOOLCHAIN_STATE_PATH,
    JSON.stringify({ enabledMap, updatedAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );
}

export function probeLocalAndColabEngines(colabConnected = false, colabEngines?: {
  blender?: boolean;
  comfyui?: boolean;
  ffmpeg?: boolean;
  gpuName?: string | null;
}): EngineRuntimeProbe[] {
  const ffmpegOk = commandExists("which ffmpeg");
  const blenderLocal = commandExists("which blender");
  const remotionLocal = fs.existsSync(path.resolve(process.cwd(), "node_modules/@remotion/renderer/package.json"));
  const playwrightLocal = fs.existsSync(path.resolve(process.cwd(), "node_modules/playwright-core/package.json"));
  const fontsLocal = fs.existsSync(path.resolve(process.cwd(), "assets/fonts/Vazirmatn-ExtraBold.ttf"));

  return [
    {
      engineId: "hyperframes",
      localAvailable: playwrightLocal && ffmpegOk && fontsLocal,
      colabCapable: true,
      colabConnected,
      detailFa:
        playwrightLocal && ffmpegOk && fontsLocal
          ? "آماده اجرای واقعی روی سرور (Chromium + FFmpeg + فونت‌های Vazirmatn و Lalezar)"
          : "نیازمند Chromium یا فونت فارسی در assets/fonts",
    },
    {
      engineId: "remotion",
      localAvailable: remotionLocal && ffmpegOk,
      colabCapable: true,
      colabConnected,
      detailFa: remotionLocal
        ? "پکیج @remotion/renderer v4 نصب و آماده رندر محلی است"
        : "پکیج Remotion نصب نیست",
    },
    {
      engineId: "blender",
      localAvailable: blenderLocal,
      colabCapable: true,
      colabConnected: Boolean(colabConnected && colabEngines?.blender),
      detailFa: blenderLocal
        ? "Blender روی سرور محلی نصب و فعال است"
        : colabConnected && colabEngines?.blender
          ? `متصل به Blender 4.2 GPU روی Google Colab (${colabEngines.gpuName || "GPU"})`
          : "روی این کانتینر نصب نیست — با اتصال Google Colab GPU به‌صورت واقعی رندر می‌شود",
    },
    {
      engineId: "comfyui",
      localAvailable: false,
      colabCapable: true,
      colabConnected: Boolean(colabConnected && colabEngines?.comfyui),
      detailFa:
        colabConnected && colabEngines?.comfyui
          ? `متصل به ComfyUI + Wan 2.2 روی Google Colab (${colabEngines.gpuName || "GPU"})`
          : "نیازمند اتصال زنده به Google Colab GPU (بدون حالت جعلی/موکاپ)",
    },
    {
      engineId: "ffmpeg",
      localAvailable: ffmpegOk && fontsLocal,
      colabCapable: true,
      colabConnected,
      detailFa:
        ffmpegOk && fontsLocal
          ? "FFmpeg + libass + فونت‌های فارسی Vazirmatn/Lalezar فعال است"
          : "FFmpeg نصب نیست",
    },
    {
      engineId: "nle_finishing",
      localAvailable: true,
      colabCapable: false,
      colabConnected: false,
      detailFa:
        "خروجی واقعی DaVinci Resolve (.otio / .fcpxml / .cube) و After Effects (.jsx) آماده دانلود و اتصال MCP است",
    },
  ];
}

export function getMcpToolchainState(colabContext?: {
  connected: boolean;
  blenderAvailable?: boolean;
  comfyuiAvailable?: boolean;
  gpuName?: string | null;
}): McpToolchainState {
  const overrides = loadEnabledOverrides();
  const addons = DEFAULT_TOOLCHAIN_ADDONS.map((item) => ({
    ...item,
    enabled: typeof overrides[item.id] === "boolean" ? overrides[item.id] : item.enabled,
  }));

  return {
    omniFlashPolicy: "disabled_by_default",
    updatedAt: new Date().toISOString(),
    engines: ENGINE_STACKS,
    addons,
    runtimeProbes: probeLocalAndColabEngines(Boolean(colabContext?.connected), {
      blender: colabContext?.blenderAvailable,
      comfyui: colabContext?.comfyuiAvailable,
      gpuName: colabContext?.gpuName,
    }),
  };
}

export function toggleToolchainAddon(addonId: string, enabled: boolean): McpToolchainState {
  const exists = DEFAULT_TOOLCHAIN_ADDONS.some((a) => a.id === addonId);
  if (!exists) {
    throw new Error(`افزونه یا MCP با شناسه ${addonId} یافت نشد.`);
  }
  const overrides = loadEnabledOverrides();
  overrides[addonId] = enabled;
  saveEnabledOverrides(overrides);
  return getMcpToolchainState();
}

/**
 * Exports standard `mcp_servers.json` containing all enabled MCP servers for desktop/IDE/Colab runners.
 */
export function buildMcpServersConfigJson(): string {
  const state = getMcpToolchainState();
  const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const addon of state.addons) {
    if (addon.enabled && addon.kind === "mcp" && addon.mcpServerConfig) {
      mcpServers[addon.id] = addon.mcpServerConfig;
    }
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

/**
 * Generates a concise Skill & Tool directive block injected into Director, Blender, Remotion, and QA prompts.
 */
export function buildActiveSkillsDirectivePrompt(engineFilter?: EngineStackId[]): string {
  const state = getMcpToolchainState();
  const active = state.addons.filter(
    (a) => a.enabled && (!engineFilter || engineFilter.includes(a.engineId))
  );
  if (active.length === 0) return "";
  return [
    "اسکیل‌ها، پلاگین‌ها و MCPهای فعال استودیو (رعایت دقیق الزامی است):",
    ...active.map((a) => `- [${a.engineId.toUpperCase()} / ${a.kind.toUpperCase()}] ${a.name}: ${a.agentDirective}`),
  ].join("\n");
}
