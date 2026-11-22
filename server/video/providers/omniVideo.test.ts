import assert from "node:assert/strict";
import test from "node:test";
import { buildCinemaPhysicsMotionPrompt, normalizeOmniDurationSec } from "./omniVideo.js";

test("normalizeOmniDurationSec clamps within 3s..15s integer bounds", () => {
  assert.equal(normalizeOmniDurationSec(1), 3);
  assert.equal(normalizeOmniDurationSec(4.2), 4);
  assert.equal(normalizeOmniDurationSec(22), 15);
});

test("buildCinemaPhysicsMotionPrompt injects molten sparks, heat shimmer, camera motion, and diegetic SFX cues", () => {
  const prompt = buildCinemaPhysicsMotionPrompt({
    rawPrompt: "خروج شمش فولادی گداخته از کوره صنعتی روی غلتک‌های نورد با جرقه و دود",
    cameraMotion: "push-in",
    durationSec: 4,
  });
  assert.ok(prompt.includes("sparks"));
  assert.ok(prompt.includes("Diegetic audio:"));
  assert.ok(prompt.includes("Duration: 4 seconds"));
  assert.ok(prompt.includes("push-in"));
});
