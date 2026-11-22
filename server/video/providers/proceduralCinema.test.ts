import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyCinemaSceneArchetype,
  closeSharedCinemaBrowser,
  renderProceduralCinemaKeyframePng,
} from "./proceduralCinema.js";

test.after(async () => {
  await closeSharedCinemaBrowser();
});

test("classifyCinemaSceneArchetype maps Mannesmann & industrial prompts accurately", () => {
  assert.equal(
    classifyCinemaSceneArchetype("glowing steel billet pulled from an 1885 German steel foundry furnace", 1),
    "furnace_billet_extraction"
  );
  assert.equal(
    classifyCinemaSceneArchetype("vintage welded iron pipe seam under extreme pressure, violent jet of steam", 2),
    "welded_seam_rupture"
  );
  assert.equal(
    classifyCinemaSceneArchetype("Mannesmann rotary piercing mill two angled steel rollers", 3),
    "rotary_piercing_mill"
  );
  assert.equal(
    classifyCinemaSceneArchetype("modern petrochemical refinery at dusk with flare stack flame", 5),
    "modern_refinery_pipelines"
  );
  assert.equal(
    classifyCinemaSceneArchetype("high-speed POV into hollow glowing steel pipe center and piercing mandrel", 8),
    "hollow_billet_tunnel_pov"
  );
});

test("renderProceduralCinemaKeyframePng generates a non-empty real PNG file", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proc-cinema-test-"));
  const outPng = path.join(tmpDir, "kf_test.png");
  try {
    await renderProceduralCinemaKeyframePng({
      prompt: "glowing hot steel billet pulled from blazing furnace on steel rollers",
      shotNumber: 1,
      width: 360,
      height: 640,
      outputPngPath: outPng,
    });
    assert.ok(fs.existsSync(outPng));
    const stat = fs.statSync(outPng);
    assert.ok(stat.size > 15_000, `Expected rich PNG >15KB, got ${stat.size}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
