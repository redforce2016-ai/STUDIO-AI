import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type HardwareProfileId =
  | "wan_2_2_5b_gguf"
  | "wan_2_2_or_ltx_2_3_fp8"
  | "parallax_only";

export interface DetectedHardwareInfo {
  detectedAt: string;
  cpuModel: string;
  cpuCores: number;
  ramTotalMb: number;
  ramFreeMb: number;
  ramTotalGb: number;
  gpuAvailable: boolean;
  gpuVendor: "nvidia" | "amd" | "apple" | "none";
  gpuModel: string;
  vramTotalMb: number;
  vramFreeMb: number;
  vramTotalGb: number;
  comfyuiServerUrl: string;
  comfyuiReachable: boolean;
  comfyuiVersion: string | null;
  selectedProfile: HardwareProfileId;
  defaultProvider: "comfyui" | "parallax";
  profileReasonFa: string;
}

export interface ModelInstallInstruction {
  profile: HardwareProfileId;
  modelName: string;
  filename: string;
  targetDirectory: string;
  downloadUrl: string;
  cliCommand: string;
  vramRequirement: string;
  notesFa: string;
}

export interface LocalVideoConfigYaml {
  version: number;
  hardware_profile: HardwareProfileId;
  default_provider: "comfyui" | "parallax";
  detected_hardware: {
    gpu_model: string;
    vram_total_mb: number;
    vram_free_mb: number;
    vram_total_gb: number;
    ram_total_mb: number;
    ram_free_mb: number;
    ram_total_gb: number;
    cpu_model: string;
    cpu_cores: number;
  };
  comfyui: {
    enabled: boolean;
    base_url: string;
    workflow_template: string;
    timeout_ms: number;
    max_retries: number;
    poll_interval_ms: number;
    preview_resolution: [number, number];
    final_resolution: [number, number];
    fps: number;
  };
  parallax: {
    enabled: boolean;
    depth_method: "local_midas_or_sobel_depth";
    default_camera_motion: "push-in" | "pan" | "orbit";
    displacement_strength: number;
    fps: number;
  };
  quality_rules: {
    mode: "image_to_video_only";
    forbid_text_to_video: true;
    min_clip_duration_sec: number;
    max_clip_duration_sec: number;
    auto_split_longer_shots: boolean;
    preview_low_res_first: boolean;
    require_visual_critic_before_final: boolean;
    fallback_to_parallax_after_failures: number;
  };
  model_install_guide: ModelInstallInstruction[];
}

const CONFIG_YAML_PATH = path.resolve(process.cwd(), "config.yaml");

function safeExec(cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 4000,
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function selectHardwareProfileFromVram(
  vramTotalMb: number,
  gpuAvailable = vramTotalMb > 0
): HardwareProfileId {
  const vramGb = vramTotalMb / 1024;
  if (!gpuAvailable || vramGb < 8) return "parallax_only";
  if (vramGb >= 16) return "wan_2_2_or_ltx_2_3_fp8";
  return "wan_2_2_5b_gguf";
}

export function getModelInstallInstructions(_profile?: HardwareProfileId): ModelInstallInstruction[] {
  return [
    {
      profile: "wan_2_2_5b_gguf",
      modelName: "Wan 2.2 TI2V 5B (GGUF Q4_K_M) — پروفایل ۸ تا ۱۲ گیگابایت VRAM",
      filename: "Wan2.2-TI2V-5B-Q4_K_M.gguf",
      targetDirectory: "ComfyUI/models/unet/",
      downloadUrl:
        "https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q4_K_M.gguf",
      cliCommand:
        "wget -c https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q4_K_M.gguf -P ComfyUI/models/unet/",
      vramRequirement: "8GB - 12GB VRAM",
      notesFa:
        "مدل سبک Image-to-Video با کوانتیزاسیون GGUF مناسب کارت‌های ۸ تا ۱۲ گیگابایت در رزولوشن پایین (480p).",
    },
    {
      profile: "wan_2_2_5b_gguf",
      modelName: "Wan 2.2 VAE + UMT5 Text Encoder (FP8)",
      filename: "wan2.2_vae.safetensors",
      targetDirectory: "ComfyUI/models/vae/",
      downloadUrl:
        "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors",
      cliCommand:
        "wget -c https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors -P ComfyUI/models/vae/ && wget -c https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors -P ComfyUI/models/text_encoders/",
      vramRequirement: "8GB+ VRAM",
      notesFa: "فایل‌های رمزگشای تصویر (VAE) و انکودر متن موردنیاز گراف Wan 2.2 در ComfyUI.",
    },
    {
      profile: "wan_2_2_or_ltx_2_3_fp8",
      modelName: "Wan 2.1 / 2.2 I2V 14B (FP8) — پروفایل ۱۶ گیگابایت به بالا",
      filename: "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors",
      targetDirectory: "ComfyUI/models/diffusion_models/",
      downloadUrl:
        "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors",
      cliCommand:
        "wget -c https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors -P ComfyUI/models/diffusion_models/",
      vramRequirement: "16GB+ VRAM",
      notesFa: "مدل کامل ۱۴ میلیارد پارامتری FP8 برای کیفیت بالاتر در کارت‌های ۱۶ گیگابایت و بالاتر.",
    },
    {
      profile: "wan_2_2_or_ltx_2_3_fp8",
      modelName: "LTX-Video 2.3 / 0.9.5 (FP8) — جایگزین سریع ۱۶ گیگابایت به بالا",
      filename: "ltx-video-2b-v0.9.5-fp8.safetensors",
      targetDirectory: "ComfyUI/models/checkpoints/",
      downloadUrl:
        "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors",
      cliCommand:
        "wget -c https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors -P ComfyUI/models/checkpoints/",
      vramRequirement: "16GB+ VRAM",
      notesFa: "مدل بسیار سریع LTX-Video برای تولید کلیپ‌های ۳ تا ۵ ثانیه‌ای Image-to-Video.",
    },
  ];
}

export async function probeComfyUIServerStats(baseUrl = "http://127.0.0.1:8188"): Promise<{
  reachable: boolean;
  comfyuiVersion: string | null;
  gpuName: string | null;
  vramTotalMb: number;
  vramFreeMb: number;
  ramTotalMb: number;
  ramFreeMb: number;
}> {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${cleanUrl}/system_stats`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        reachable: false,
        comfyuiVersion: null,
        gpuName: null,
        vramTotalMb: 0,
        vramFreeMb: 0,
        ramTotalMb: 0,
        ramFreeMb: 0,
      };
    }
    const data = (await res.json()) as {
      system?: {
        comfyui_version?: string;
        ram_total?: number;
        ram_free?: number;
      };
      devices?: Array<{
        name?: string;
        type?: string;
        vram_total?: number;
        vram_free?: number;
      }>;
    };
    const dev = data.devices?.[0];
    return {
      reachable: true,
      comfyuiVersion: data.system?.comfyui_version || "installed",
      gpuName: dev?.name || null,
      vramTotalMb: dev?.vram_total ? Math.round(dev.vram_total / (1024 * 1024)) : 0,
      vramFreeMb: dev?.vram_free ? Math.round(dev.vram_free / (1024 * 1024)) : 0,
      ramTotalMb: data.system?.ram_total ? Math.round(data.system.ram_total / (1024 * 1024)) : 0,
      ramFreeMb: data.system?.ram_free ? Math.round(data.system.ram_free / (1024 * 1024)) : 0,
    };
  } catch {
    return {
      reachable: false,
      comfyuiVersion: null,
      gpuName: null,
      vramTotalMb: 0,
      vramFreeMb: 0,
      ramTotalMb: 0,
      ramFreeMb: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function detectHardwareSync(comfyuiUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188"): DetectedHardwareInfo {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() || "Generic x86_64 CPU";
  const cpuCores = cpus.length || 1;
  const ramTotalMb = Math.round(os.totalmem() / (1024 * 1024));
  const ramFreeMb = Math.round(os.freemem() / (1024 * 1024));
  const ramTotalGb = Math.round((ramTotalMb / 1024) * 10) / 10;

  let gpuAvailable = false;
  let gpuVendor: DetectedHardwareInfo["gpuVendor"] = "none";
  let gpuModel = "بدون کارت گرافیک مجزا (CPU Only)";
  let vramTotalMb = 0;
  let vramFreeMb = 0;

  // 1. Check NVIDIA GPU via nvidia-smi
  const nvidiaOut = safeExec(
    "nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits"
  );
  if (nvidiaOut) {
    const firstLine = nvidiaOut.split("\n")[0]?.trim();
    if (firstLine) {
      const parts = firstLine.split(",").map((s) => s.trim());
      if (parts.length >= 3) {
        gpuAvailable = true;
        gpuVendor = "nvidia";
        gpuModel = parts[0] || "NVIDIA GPU";
        vramTotalMb = Number(parts[1]) || 0;
        vramFreeMb = Number(parts[2]) || 0;
      }
    }
  }

  // 2. Check AMD ROCm via rocm-smi if NVIDIA not found
  if (!gpuAvailable) {
    const rocmOut = safeExec("rocm-smi --showmeminfo vram --csv");
    if (rocmOut && rocmOut.includes(",")) {
      const lines = rocmOut.split("\n").filter((l) => l.includes("card"));
      if (lines[0]) {
        const cols = lines[0].split(",");
        const totalBytes = Number(cols[1]) || 0;
        const usedBytes = Number(cols[2]) || 0;
        if (totalBytes > 0) {
          gpuAvailable = true;
          gpuVendor = "amd";
          gpuModel = "AMD Radeon ROCm GPU";
          vramTotalMb = Math.round(totalBytes / (1024 * 1024));
          vramFreeMb = Math.max(0, Math.round((totalBytes - usedBytes) / (1024 * 1024)));
        }
      }
    }
  }

  // 3. Optional override for testing hardware profiles via env var (e.g. SIMULATE_VRAM_GB)
  if (process.env.SIMULATE_VRAM_GB) {
    const simGb = Number(process.env.SIMULATE_VRAM_GB);
    if (Number.isFinite(simGb) && simGb > 0) {
      gpuAvailable = true;
      gpuVendor = "nvidia";
      gpuModel = `Simulated GPU (${simGb}GB VRAM)`;
      vramTotalMb = Math.round(simGb * 1024);
      vramFreeMb = Math.round(simGb * 1024 * 0.85);
    }
  }

  const vramTotalGb = Math.round((vramTotalMb / 1024) * 10) / 10;

  let selectedProfile: HardwareProfileId = "parallax_only";
  let defaultProvider: "comfyui" | "parallax" = "parallax";
  let profileReasonFa =
    "کارت گرافیک مجزا با حداقل ۸ گیگابایت VRAM یافت نشد؛ حالت پیش‌فرض روی Parallax محلی (بدون نیاز به GPU) تنظیم شد.";

  if (gpuAvailable && vramTotalGb >= 16) {
    selectedProfile = "wan_2_2_or_ltx_2_3_fp8";
    defaultProvider = "comfyui";
    profileReasonFa = `کارت گرافیک ${gpuModel} با ${vramTotalGb} گیگابایت VRAM شناسایی شد (۱۶ گیگ به بالا)؛ پروفایل Wan 2.2 / LTX-2.3 (FP8) انتخاب شد.`;
  } else if (gpuAvailable && vramTotalGb >= 8) {
    selectedProfile = "wan_2_2_5b_gguf";
    defaultProvider = "comfyui";
    profileReasonFa = `کارت گرافیک ${gpuModel} با ${vramTotalGb} گیگابایت VRAM شناسایی شد (بازه ۸ تا ۱۲+ گیگابایت)؛ پروفایل Wan 2.2 (5B / GGUF) با رزولوشن بهینه انتخاب شد.`;
  }

  return {
    detectedAt: new Date().toISOString(),
    cpuModel,
    cpuCores,
    ramTotalMb,
    ramFreeMb,
    ramTotalGb,
    gpuAvailable,
    gpuVendor,
    gpuModel,
    vramTotalMb,
    vramFreeMb,
    vramTotalGb,
    comfyuiServerUrl: comfyuiUrl,
    comfyuiReachable: false,
    comfyuiVersion: null,
    selectedProfile,
    defaultProvider,
    profileReasonFa,
  };
}

export async function detectHardwareAndWriteConfig(
  comfyuiUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188"
): Promise<{ hardware: DetectedHardwareInfo; configPath: string; config: LocalVideoConfigYaml }> {
  const hw = detectHardwareSync(comfyuiUrl);
  const comfyProbe = await probeComfyUIServerStats(comfyuiUrl);

  if (comfyProbe.reachable) {
    hw.comfyuiReachable = true;
    hw.comfyuiVersion = comfyProbe.comfyuiVersion;
    if (!hw.gpuAvailable && comfyProbe.vramTotalMb > 0) {
      hw.gpuAvailable = true;
      hw.gpuVendor = "nvidia";
      hw.gpuModel = comfyProbe.gpuName || "ComfyUI CUDA Device";
      hw.vramTotalMb = comfyProbe.vramTotalMb;
      hw.vramFreeMb = comfyProbe.vramFreeMb;
      hw.vramTotalGb = Math.round((comfyProbe.vramTotalMb / 1024) * 10) / 10;

      if (hw.vramTotalGb >= 16) {
        hw.selectedProfile = "wan_2_2_or_ltx_2_3_fp8";
        hw.defaultProvider = "comfyui";
        hw.profileReasonFa = `سرور ComfyUI با کارت ${hw.gpuModel} (${hw.vramTotalGb}GB VRAM) فعال است؛ پروفایل Wan 2.2 / LTX-2.3 (FP8) انتخاب شد.`;
      } else if (hw.vramTotalGb >= 8) {
        hw.selectedProfile = "wan_2_2_5b_gguf";
        hw.defaultProvider = "comfyui";
        hw.profileReasonFa = `سرور ComfyUI با کارت ${hw.gpuModel} (${hw.vramTotalGb}GB VRAM) فعال است؛ پروفایل Wan 2.2 (5B / GGUF) انتخاب شد.`;
      }
    }
  }

  const workflowTemplate =
    hw.selectedProfile === "wan_2_2_or_ltx_2_3_fp8"
      ? "server/video/workflows/ltx23_fp8_i2v_api.json"
      : "server/video/workflows/wan22_5b_gguf_i2v_api.json";

  const config: LocalVideoConfigYaml = {
    version: 1,
    hardware_profile: hw.selectedProfile,
    default_provider: hw.defaultProvider,
    detected_hardware: {
      gpu_model: hw.gpuModel,
      vram_total_mb: hw.vramTotalMb,
      vram_free_mb: hw.vramFreeMb,
      vram_total_gb: hw.vramTotalGb,
      ram_total_mb: hw.ramTotalMb,
      ram_free_mb: hw.ramFreeMb,
      ram_total_gb: hw.ramTotalGb,
      cpu_model: hw.cpuModel,
      cpu_cores: hw.cpuCores,
    },
    comfyui: {
      enabled: hw.selectedProfile !== "parallax_only",
      base_url: comfyuiUrl,
      workflow_template: workflowTemplate,
      timeout_ms: 180000,
      max_retries: 3,
      poll_interval_ms: 1500,
      preview_resolution: [480, 854],
      final_resolution: hw.selectedProfile === "wan_2_2_or_ltx_2_3_fp8" ? [720, 1280] : [480, 854],
      fps: 16,
    },
    parallax: {
      enabled: true,
      depth_method: "local_midas_or_sobel_depth",
      default_camera_motion: "push-in",
      displacement_strength: 0.045,
      fps: 30,
    },
    quality_rules: {
      mode: "image_to_video_only",
      forbid_text_to_video: true,
      min_clip_duration_sec: 3,
      max_clip_duration_sec: 5,
      auto_split_longer_shots: true,
      preview_low_res_first: true,
      require_visual_critic_before_final: true,
      fallback_to_parallax_after_failures: 3,
    },
    model_install_guide: getModelInstallInstructions(),
  };

  const yamlText = serializeConfigToYaml(config, hw);
  fs.writeFileSync(CONFIG_YAML_PATH, yamlText, "utf-8");

  return {
    hardware: hw,
    configPath: CONFIG_YAML_PATH,
    config,
  };
}

function serializeConfigToYaml(cfg: LocalVideoConfigYaml, hw: DetectedHardwareInfo): string {
  const lines: string[] = [
    "# ============================================================================",
    "# Content Studio Desktop — Local Keyframe Animation & Hardware Profile Config",
    `# Auto-generated by server/video/hardware.ts at ${hw.detectedAt}`,
    "# Note: Models are NEVER auto-downloaded. See model_install_guide below.",
    "# ============================================================================",
    "",
    `version: ${cfg.version}`,
    `hardware_profile: "${cfg.hardware_profile}"`,
    `default_provider: "${cfg.default_provider}"`,
    `profile_reason_fa: "${hw.profileReasonFa.replace(/"/g, '\\"')}"`,
    "",
    "detected_hardware:",
    `  gpu_model: "${cfg.detected_hardware.gpu_model.replace(/"/g, '\\"')}"`,
    `  vram_total_mb: ${cfg.detected_hardware.vram_total_mb}`,
    `  vram_free_mb: ${cfg.detected_hardware.vram_free_mb}`,
    `  vram_total_gb: ${cfg.detected_hardware.vram_total_gb}`,
    `  ram_total_mb: ${cfg.detected_hardware.ram_total_mb}`,
    `  ram_free_mb: ${cfg.detected_hardware.ram_free_mb}`,
    `  ram_total_gb: ${cfg.detected_hardware.ram_total_gb}`,
    `  cpu_model: "${cfg.detected_hardware.cpu_model.replace(/"/g, '\\"')}"`,
    `  cpu_cores: ${cfg.detected_hardware.cpu_cores}`,
    "",
    "comfyui:",
    `  enabled: ${cfg.comfyui.enabled}`,
    `  base_url: "${cfg.comfyui.base_url}"`,
    `  workflow_template: "${cfg.comfyui.workflow_template}"`,
    `  timeout_ms: ${cfg.comfyui.timeout_ms}`,
    `  max_retries: ${cfg.comfyui.max_retries}`,
    `  poll_interval_ms: ${cfg.comfyui.poll_interval_ms}`,
    `  preview_resolution: [${cfg.comfyui.preview_resolution[0]}, ${cfg.comfyui.preview_resolution[1]}]`,
    `  final_resolution: [${cfg.comfyui.final_resolution[0]}, ${cfg.comfyui.final_resolution[1]}]`,
    `  fps: ${cfg.comfyui.fps}`,
    "",
    "parallax:",
    `  enabled: ${cfg.parallax.enabled}`,
    `  depth_method: "${cfg.parallax.depth_method}"`,
    `  default_camera_motion: "${cfg.parallax.default_camera_motion}"`,
    `  displacement_strength: ${cfg.parallax.displacement_strength}`,
    `  fps: ${cfg.parallax.fps}`,
    "",
    "quality_rules:",
    `  mode: "${cfg.quality_rules.mode}"`,
    `  forbid_text_to_video: ${cfg.quality_rules.forbid_text_to_video}`,
    `  min_clip_duration_sec: ${cfg.quality_rules.min_clip_duration_sec}`,
    `  max_clip_duration_sec: ${cfg.quality_rules.max_clip_duration_sec}`,
    `  auto_split_longer_shots: ${cfg.quality_rules.auto_split_longer_shots}`,
    `  preview_low_res_first: ${cfg.quality_rules.preview_low_res_first}`,
    `  require_visual_critic_before_final: ${cfg.quality_rules.require_visual_critic_before_final}`,
    `  fallback_to_parallax_after_failures: ${cfg.quality_rules.fallback_to_parallax_after_failures}`,
    "",
    "model_install_guide:",
  ];

  for (const item of cfg.model_install_guide) {
    lines.push(`  - profile: "${item.profile}"`);
    lines.push(`    model_name: "${item.modelName.replace(/"/g, '\\"')}"`);
    lines.push(`    filename: "${item.filename}"`);
    lines.push(`    target_directory: "${item.targetDirectory}"`);
    lines.push(`    vram_requirement: "${item.vramRequirement}"`);
    lines.push(`    download_url: "${item.downloadUrl}"`);
    lines.push(`    cli_command: "${item.cliCommand.replace(/"/g, '\\"')}"`);
  }

  return lines.join("\n") + "\n";
}

// Allow running directly as CLI script: npx tsx server/video/hardware.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  detectHardwareAndWriteConfig().then(({ hardware, configPath }) => {
    console.log("=== Hardware Auto-Detection Report ===");
    console.log(`CPU: ${hardware.cpuModel} (${hardware.cpuCores} cores)`);
    console.log(`RAM: ${hardware.ramTotalGb} GB total (${hardware.ramFreeMb} MB free)`);
    console.log(
      `GPU: ${hardware.gpuModel} | VRAM: ${hardware.vramTotalGb} GB (${hardware.vramTotalMb} MB)`
    );
    console.log(
      `ComfyUI Server (${hardware.comfyuiServerUrl}): ${
        hardware.comfyuiReachable ? `ONLINE (v${hardware.comfyuiVersion})` : "OFFLINE"
      }`
    );
    console.log(`Selected Profile: ${hardware.selectedProfile}`);
    console.log(`Default Provider: ${hardware.defaultProvider}`);
    console.log(`Reason: ${hardware.profileReasonFa}`);
    console.log(`Saved configuration to: ${configPath}`);
  });
}
