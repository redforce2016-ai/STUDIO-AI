# PowerShell Model Installer for Windows (ComfyUI Local Video Pipeline)
param([string]$Profile = "wan_2_2_5b_gguf")
$ErrorActionPreference = "Stop"
Write-Host "=== ComfyUI Local Video Model Installer (Windows) ===" -ForegroundColor Amber
$dirs = @("ComfyUI/models/unet", "ComfyUI/models/vae", "ComfyUI/models/text_encoders", "ComfyUI/models/diffusion_models", "ComfyUI/models/checkpoints")
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

if ($Profile -eq "wan_2_2_5b_gguf" -or $Profile -eq "all") {
  Write-Host "Downloading Wan 2.2 5B GGUF (8-12GB VRAM Profile)..."
  curl.exe -L -C - "https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q4_K_M.gguf" -o "ComfyUI/models/unet/Wan2.2-TI2V-5B-Q4_K_M.gguf"
  curl.exe -L -C - "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors" -o "ComfyUI/models/vae/wan2.2_vae.safetensors"
  curl.exe -L -C - "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" -o "ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
}

if ($Profile -eq "wan_2_2_or_ltx_2_3_fp8" -or $Profile -eq "all") {
  Write-Host "Downloading Wan I2V 14B FP8 & LTX-Video FP8 (16GB+ VRAM Profile)..."
  curl.exe -L -C - "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors" -o "ComfyUI/models/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors"
  curl.exe -L -C - "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors" -o "ComfyUI/models/checkpoints/ltx-video-2b-v0.9.5.safetensors"
}
