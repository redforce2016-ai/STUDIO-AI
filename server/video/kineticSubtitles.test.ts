import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAudioSyncedCaptionTimeline,
  computeAudioSyncPlan,
  formatAssTime,
  generateKineticAssSubtitles,
  splitKineticPersianChunks,
  verifyBundledPersianFonts,
} from "./kineticSubtitles.js";

test("verifyBundledPersianFonts confirms real Vazirmatn & Lalezar TTF files exist", () => {
  const result = verifyBundledPersianFonts();
  assert.equal(result.available, true, `Fonts missing in ${result.fontsDir}`);
  assert.ok(result.files.length >= 4);
});

test("computeAudioSyncPlan aligns 65s narration into 42s video gently without clipping", () => {
  const plan = computeAudioSyncPlan({
    narrationDurationSec: 65,
    videoDurationSec: 42,
    speechSegments: [
      { startSec: 0.2, endSec: 22.0 },
      { startSec: 23.0, endSec: 64.5 },
    ],
  });
  assert.ok(plan.recommendedAtempo > 1.0 && plan.recommendedAtempo <= 1.24);
  assert.ok(plan.effectiveCaptionSpanSec <= 42);
  assert.ok(plan.speechSegments.length >= 1);
  assert.ok(plan.speechSegments[plan.speechSegments.length - 1].endSec <= plan.effectiveCaptionSpanSec);
});

test("computeAudioSyncPlan keeps atempo at 1.0 when narration already fits inside video", () => {
  const plan = computeAudioSyncPlan({
    narrationDurationSec: 36,
    videoDurationSec: 42,
  });
  assert.equal(plan.recommendedAtempo, 1.0);
  assert.equal(plan.effectiveCaptionSpanSec, 36);
});

test("splitKineticPersianChunks breaks long Persian narration into crisp readable chunks", () => {
  const text =
    "داستان از آلمان سال ۱۸۸۵ شروع می‌شود؛ جایی که برادران مانیسمان شمش فولاد توپر را به لوله بدون درز تبدیل کردند.";
  const chunks = splitKineticPersianChunks(text, 4);
  assert.ok(chunks.length >= 4);
  for (const chunk of chunks) {
    const words = chunk.split(/\s+/).filter(Boolean);
    assert.ok(words.length <= 5, `Chunk too long: ${chunk}`);
  }
});

test("generateKineticAssSubtitles produces ASS with Vazirmatn/Lalezar, spring pop-in, and \\kf karaoke tags", () => {
  const syncPlan = computeAudioSyncPlan({
    narrationDurationSec: 12,
    videoDurationSec: 12,
  });
  const { assContent, cueCount } = generateKineticAssSubtitles({
    shots: [
      {
        shotNumber: 1,
        durationSec: 6,
        narrationText: "چطور یک تکه فولاد توپر تبدیل به لوله توخالی بدون درز شد؟",
        onScreenText: "لوله بدون درز مانیسمان",
      },
      {
        shotNumber: 2,
        durationSec: 6,
        narrationText: "نور آبی و سفید روی سطح فولاد برس‌خورده در پس‌زمینه تاریک سینمایی.",
        onScreenText: "استاندارد صنعتی رده ۴۰",
      },
    ],
    syncPlan,
    width: 1080,
    height: 1920,
    stylePreset: "industrial_steel_blue",
    includeShotTitles: true,
  });

  assert.ok(cueCount >= 2);
  assert.match(assContent, /\[Script Info\]/);
  assert.match(assContent, /Vazirmatn/);
  assert.match(assContent, /Lalezar/);
  assert.match(assContent, /\\kf\d+/);
  assert.match(assContent, /\\fscx86\\fscy86/);
  assert.equal(formatAssTime(65.43), "0:01:05.43");

  const timeline = buildAudioSyncedCaptionTimeline({
    shots: [
      { shotNumber: 1, durationSec: 6, narrationText: "سلام دنیا برای تست همگام‌سازی" },
    ],
    syncPlan,
  });
  assert.ok(timeline.length >= 1);
  assert.ok(timeline[0].endSec > timeline[0].startSec);
});
