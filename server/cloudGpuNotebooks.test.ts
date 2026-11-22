import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_GPU_PLATFORM_META,
  generateGoogleColabNotebookIpynb,
  generateMolabMarimoNotebookPy,
  normalizeCloudGpuTunnelUrl,
} from "./cloudGpuNotebooks.js";

test("generateMolabMarimoNotebookPy produces valid Marimo reactive notebook with ComfyUI + cloudflared", () => {
  const py = generateMolabMarimoNotebookPy({
    platform: "molab",
    mode: "comfyui_i2v_worker",
    modelPreset: "wan22_fp8_14b",
    profileEmail: "studio.agent.01@gmail.com",
  });
  assert.ok(py.includes("import marimo"));
  assert.ok(py.includes("@app.cell"));
  assert.ok(py.includes("ComfyUI-WanVideoWrapper"));
  assert.ok(py.includes("cloudflared"));
  assert.ok(py.includes("trycloudflare"));
  assert.ok(py.includes("studio.agent.01@gmail.com"));
});

test("generateMolabMarimoNotebookPy includes Full Studio Server cell when mode is full_studio_server", () => {
  const py = generateMolabMarimoNotebookPy({
    platform: "molab",
    mode: "full_studio_server",
    modelPreset: "ltx_video_fp8",
    repoUrl: "https://github.com/example/fixstudio.git",
  });
  assert.ok(py.includes("COMFYUI_URL"));
  assert.ok(py.includes("https://github.com/example/fixstudio.git"));
  assert.ok(py.includes("ltx-video-2b-v0.9.5.safetensors"));
});

test("generateGoogleColabNotebookIpynb produces valid Jupyter v4 JSON notebook for T4 GPU", () => {
  const ipynbRaw = generateGoogleColabNotebookIpynb({
    platform: "google_colab",
    mode: "comfyui_i2v_worker",
    modelPreset: "wan22_5b_gguf",
    profileEmail: "studio.agent.02@gmail.com",
    mountGoogleDrive: true,
  });
  const parsed = JSON.parse(ipynbRaw) as {
    nbformat: number;
    metadata: { accelerator: string };
    cells: Array<{ cell_type: string; source: string[] }>;
  };
  assert.equal(parsed.nbformat, 4);
  assert.equal(parsed.metadata.accelerator, "GPU");
  assert.ok(parsed.cells.length >= 5);
  const allSrc = parsed.cells.map((c) => c.source.join("")).join("\n");
  assert.ok(allSrc.includes("nvidia-smi"));
  assert.ok(allSrc.includes("drive.mount"));
  assert.ok(allSrc.includes("Wan2.2-TI2V-5B-Q4_K_M.gguf"));
  assert.ok(allSrc.includes("cloudflared"));
});

test("normalizeCloudGpuTunnelUrl validates and normalizes tunnel URLs safely", () => {
  assert.equal(
    normalizeCloudGpuTunnelUrl("  https://demo-gpu-123.trycloudflare.com///  "),
    "https://demo-gpu-123.trycloudflare.com"
  );
  assert.throws(() => normalizeCloudGpuTunnelUrl(""), /الزامی/);
  assert.throws(() => normalizeCloudGpuTunnelUrl("ftp://invalid.host"), /http/);
  assert.throws(() => normalizeCloudGpuTunnelUrl("not a url"), /نامعتبر/);
});

test("CLOUD_GPU_PLATFORM_META defines both molab and google_colab platforms", () => {
  assert.equal(CLOUD_GPU_PLATFORM_META.molab.fileExtension, ".py");
  assert.equal(CLOUD_GPU_PLATFORM_META.google_colab.fileExtension, ".ipynb");
  assert.ok(CLOUD_GPU_PLATFORM_META.molab.url.includes("molab.marimo.io"));
  assert.ok(CLOUD_GPU_PLATFORM_META.google_colab.url.includes("colab.research.google.com"));
});
