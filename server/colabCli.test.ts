import assert from "node:assert/strict";
import test from "node:test";
import {
  buildColabCliGpuBootstrapScript,
  getColabCliConfig,
  getColabCliRuntimeStatus,
  resolveColabCliBinary,
  updateColabCliConfig,
} from "./colabCli.js";

test("official google-colab-cli binary is detected and runtime status reports version cleanly", async () => {
  const bin = resolveColabCliBinary();
  assert.ok(bin, "Expected google-colab-cli binary to be installed");
  const status = await getColabCliRuntimeStatus();
  assert.equal(status.cliInstalled, true);
  assert.ok(status.cliVersion?.includes("google-colab-cli"));
});

test("updateColabCliConfig validates GPU allowlist and rejects unsafe session names", () => {
  const prev = getColabCliConfig();
  const updated = updateColabCliConfig({
    autopilotEnabled: true,
    preferredGpu: "L4",
    sessionName: "bad; rm -rf /",
  });
  assert.equal(updated.preferredGpu, "L4");
  assert.notEqual(updated.sessionName, "bad; rm -rf /");
  // Restore defaults
  updateColabCliConfig({
    autopilotEnabled: prev.autopilotEnabled,
    preferredGpu: prev.preferredGpu,
    sessionName: prev.sessionName,
  });
});

test("buildColabCliGpuBootstrapScript provisions ComfyUI, Blender 4.2, FastAPI bridge, and tunnel", () => {
  const script = buildColabCliGpuBootstrapScript("wan22_5b_gguf");
  assert.ok(script.includes("comfyanonymous/ComfyUI"));
  assert.ok(script.includes("blender-4.2.3-linux-x64"));
  assert.ok(script.includes("STUDIO_TUNNEL_READY::"));
  assert.ok(script.includes("Wan2.2-TI2V-5B-Q4_K_M.gguf"));
});
