import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCinemaAudioFilterGraph,
  buildCinemaVideoFilterGraph,
  generateCube3dLutFile,
  generateCube3dLutText,
} from "./cinemaMastering.js";

test("generateCube3dLutText produces valid Adobe 33^3 .cube with 35937 entries", () => {
  const cube = generateCube3dLutText("industrial_teal_amber");
  const lines = cube.trim().split("\n");
  assert.ok(lines.some((l) => l === "LUT_3D_SIZE 33"));
  const dataLines = lines.filter((l) => /^[0-9.]+ [0-9.]+ [0-9.]+$/.test(l));
  assert.equal(dataLines.length, 33 * 33 * 33);
  for (const row of [dataLines[0], dataLines[Math.floor(dataLines.length / 2)], dataLines[dataLines.length - 1]]) {
    const nums = row.split(" ").map(Number);
    assert.equal(nums.length, 3);
    for (const v of nums) {
      assert.ok(v >= 0 && v <= 1, `Out-of-range LUT entry ${v}`);
    }
  }
});

test("buildCinemaVideoFilterGraph wires lut3d, halation gblur/blend, grain, unsharp, and subtitles", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lut_test_"));
  try {
    const lutPath = generateCube3dLutFile("industrial_teal_amber", path.join(tmpDir, "grade.cube"));
    const graph = buildCinemaVideoFilterGraph({
      preset: "industrial_teal_amber",
      cubeLutPath: lutPath,
      srtPath: "/tmp/subtitles.srt",
      burnSubtitles: true,
    });
    assert.ok(graph.includes("lut3d=file='"));
    assert.ok(graph.includes("blend=all_mode=screen"));
    assert.ok(graph.includes("noise=alls=2.8"));
    assert.ok(graph.includes("unsharp="));
    assert.ok(graph.includes("subtitles="));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("buildCinemaAudioFilterGraph preserves diegetic audio and applies sidechaincompress ducking + -14 LUFS", () => {
  const res = buildCinemaAudioFilterGraph({
    totalDurationSec: 18.5,
    hasNarration: true,
    hasMusic: true,
    hasDiegeticAudio: true,
    targetLufs: -14,
  });
  assert.ok(res.filterGraph.includes("[0:a]"));
  assert.ok(res.filterGraph.includes("sidechaincompress"));
  assert.ok(res.filterGraph.includes("loudnorm=I=-14"));
  assert.equal(res.mapLabel, "[a_norm]");
});
