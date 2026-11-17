#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-auto}"
echo "=== ComfyUI Local Video Model Installer (Approved by User) ==="
mkdir -p ComfyUI/models/unet ComfyUI/models/vae ComfyUI/models/text_encoders ComfyUI/models/diffusion_models ComfyUI/models/checkpoints

if [ "$PROFILE" = "wan_2_2_5b_gguf" ] || [ "$PROFILE" = "all" ]; then
  echo "[8-12GB VRAM Profile] Downloading Wan 2.2 TI2V 5B GGUF + VAE + UMT5..."
  wget -c https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q4_K_M.gguf -P ComfyUI/models/unet/
  wget -c https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors -P ComfyUI/models/vae/ && wget -c https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors -P ComfyUI/models/text_encoders/
fi

if [ "$PROFILE" = "wan_2_2_or_ltx_2_3_fp8" ] || [ "$PROFILE" = "all" ]; then
  echo "[16GB+ VRAM Profile] Downloading Wan 2.2 14B FP8 / LTX-Video FP8..."
  wget -c https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors -P ComfyUI/models/diffusion_models/
  wget -c https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors -P ComfyUI/models/checkpoints/
fi

echo "Done! Launch ComfyUI on port 8188: python ComfyUI/main.py --listen 127.0.0.1 --port 8188"
