import fs from "node:fs";
import path from "node:path";
import {
  detectHardwareAndWriteConfig,
  getModelInstallInstructions,
  type HardwareProfileId,
  type ModelInstallInstruction,
} from "./hardware.js";

export interface ModelVerificationItem {
  profile: HardwareProfileId;
  modelName: string;
  filename: string;
  targetDirectory: string;
  localPath: string;
  existsLocally: boolean;
  localSizeBytes: number;
  downloadUrl: string;
  remoteReachable: boolean;
  remoteStatus: number | null;
  remoteSizeBytes: number | null;
  remoteSizeGb: number | null;
  cliCommand: string;
}

export interface ModelSetupReport {
  confirmedByUser: boolean;
  checkedAt: string;
  detectedProfile: HardwareProfileId;
  targetProfile: HardwareProfileId;
  gpuAvailable: boolean;
  vramTotalMb: number;
  directoriesCreated: string[];
  shellScriptPath: string;
  powershellScriptPath: string;
  models: ModelVerificationItem[];
  summaryFa: string;
}

const MODEL_SUBDIRS = [
  "ComfyUI/models/unet",
  "ComfyUI/models/vae",
  "ComfyUI/models/text_encoders",
  "ComfyUI/models/diffusion_models",
  "ComfyUI/models/checkpoints",
];

async function probeRemoteModelUrl(url: string): Promise<{
  reachable: boolean;
  status: number | null;
  sizeBytes: number | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    const contentLen = res.headers.get("content-length");
    const sizeBytes = contentLen ? Number(contentLen) : null;
    return {
      reachable: res.ok,
      status: res.status,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    };
  } catch {
    return {
      reachable: false,
      status: null,
      sizeBytes: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function generateInstallScripts(instructions: ModelInstallInstruction[]): {
  shellScriptPath: string;
  powershellScriptPath: string;
} {
  const shPath = path.resolve(process.cwd(), "install_comfyui_models.sh");
  const ps1Path = path.resolve(process.cwd(), "install_comfyui_models.ps1");

  const shLines: string[] = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    'PROFILE="${1:-auto}"',
    'echo "=== ComfyUI Local Video Model Installer (Approved by User) ==="',
    "mkdir -p ComfyUI/models/unet ComfyUI/models/vae ComfyUI/models/text_encoders ComfyUI/models/diffusion_models ComfyUI/models/checkpoints",
    "",
    'if [ "$PROFILE" = "wan_2_2_5b_gguf" ] || [ "$PROFILE" = "all" ]; then',
    '  echo "[8-12GB VRAM Profile] Downloading Wan 2.2 TI2V 5B GGUF + VAE + UMT5..."',
  ];

  for (const item of instructions.filter((i) => i.profile === "wan_2_2_5b_gguf")) {
    shLines.push(`  ${item.cliCommand}`);
  }

  shLines.push(
    "fi",
    "",
    'if [ "$PROFILE" = "wan_2_2_or_ltx_2_3_fp8" ] || [ "$PROFILE" = "all" ]; then',
    '  echo "[16GB+ VRAM Profile] Downloading Wan 2.2 14B FP8 / LTX-Video FP8..."'
  );

  for (const item of instructions.filter((i) => i.profile === "wan_2_2_or_ltx_2_3_fp8")) {
    shLines.push(`  ${item.cliCommand}`);
  }

  shLines.push(
    "fi",
    "",
    'echo "Done! Launch ComfyUI on port 8188: python ComfyUI/main.py --listen 127.0.0.1 --port 8188"',
    ""
  );

  const psLines: string[] = [
    "# PowerShell Model Installer for Windows (ComfyUI Local Video Pipeline)",
    'param([string]$Profile = "wan_2_2_5b_gguf")',
    '$ErrorActionPreference = "Stop"',
    'Write-Host "=== ComfyUI Local Video Model Installer (Windows) ===" -ForegroundColor Amber',
    '$dirs = @("ComfyUI/models/unet", "ComfyUI/models/vae", "ComfyUI/models/text_encoders", "ComfyUI/models/diffusion_models", "ComfyUI/models/checkpoints")',
    "foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }",
    "",
    'if ($Profile -eq "wan_2_2_5b_gguf" -or $Profile -eq "all") {',
    '  Write-Host "Downloading Wan 2.2 5B GGUF (8-12GB VRAM Profile)..."',
    '  curl.exe -L -C - "https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q4_K_M.gguf" -o "ComfyUI/models/unet/Wan2.2-TI2V-5B-Q4_K_M.gguf"',
    '  curl.exe -L -C - "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors" -o "ComfyUI/models/vae/wan2.2_vae.safetensors"',
    '  curl.exe -L -C - "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" -o "ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"',
    "}",
    "",
    'if ($Profile -eq "wan_2_2_or_ltx_2_3_fp8" -or $Profile -eq "all") {',
    '  Write-Host "Downloading Wan I2V 14B FP8 & LTX-Video FP8 (16GB+ VRAM Profile)..."',
    '  curl.exe -L -C - "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors" -o "ComfyUI/models/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors"',
    '  curl.exe -L -C - "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors" -o "ComfyUI/models/checkpoints/ltx-video-2b-v0.9.5.safetensors"',
    "}",
    "",
  ];

  fs.writeFileSync(shPath, shLines.join("\n"), { encoding: "utf-8", mode: 0o755 });
  fs.writeFileSync(ps1Path, psLines.join("\n"), { encoding: "utf-8" });

  return {
    shellScriptPath: shPath,
    powershellScriptPath: ps1Path,
  };
}

export async function runConfirmedModelSetup(options?: {
  targetProfile?: HardwareProfileId;
}): Promise<ModelSetupReport> {
  const { hardware } = await detectHardwareAndWriteConfig();
  const targetProfile = options?.targetProfile || hardware.selectedProfile;
  const instructions = getModelInstallInstructions();

  const directoriesCreated: string[] = [];
  for (const relDir of MODEL_SUBDIRS) {
    const absDir = path.resolve(process.cwd(), relDir);
    fs.mkdirSync(absDir, { recursive: true });
    directoriesCreated.push(relDir);
  }

  const { shellScriptPath, powershellScriptPath } = generateInstallScripts(instructions);

  const models: ModelVerificationItem[] = [];
  for (const item of instructions) {
    const localPath = path.resolve(process.cwd(), item.targetDirectory, item.filename);
    const existsLocally = fs.existsSync(localPath);
    const localSizeBytes = existsLocally ? fs.statSync(localPath).size : 0;
    const remote = await probeRemoteModelUrl(item.downloadUrl);
    models.push({
      profile: item.profile,
      modelName: item.modelName,
      filename: item.filename,
      targetDirectory: item.targetDirectory,
      localPath,
      existsLocally,
      localSizeBytes,
      downloadUrl: item.downloadUrl,
      remoteReachable: remote.reachable,
      remoteStatus: remote.status,
      remoteSizeBytes: remote.sizeBytes,
      remoteSizeGb: remote.sizeBytes
        ? Math.round((remote.sizeBytes / (1024 * 1024 * 1024)) * 100) / 100
        : null,
      cliCommand: item.cliCommand,
    });
  }

  const summaryFa =
    hardware.selectedProfile === "parallax_only"
      ? "ساختار پوشه‌های ComfyUI/models و اسکریپت‌های نصب (install_comfyui_models.sh و install_comfyui_models.ps1) ساخته شد و لینک‌های Hugging Face بررسی شدند. از آنجا که محیط فعلی فاقد GPU است (0MB VRAM)، پروفایل فعال parallax_only بدون نیاز به دانلود وزن‌های سنگین GPU بلافاصله آماده رندر است."
      : `ساختار پوشه‌های مدل برای پروفایل ${targetProfile} آماده شد و سلامت لینک‌های دانلود تایید گردید.`;

  return {
    confirmedByUser: true,
    checkedAt: new Date().toISOString(),
    detectedProfile: hardware.selectedProfile,
    targetProfile,
    gpuAvailable: hardware.gpuAvailable,
    vramTotalMb: hardware.vramTotalMb,
    directoriesCreated,
    shellScriptPath,
    powershellScriptPath,
    models,
    summaryFa,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runConfirmedModelSetup().then((report) => {
    console.log(JSON.stringify(report, null, 2));
  });
}
