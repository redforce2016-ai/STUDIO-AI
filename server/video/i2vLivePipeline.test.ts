import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { DirectorShot } from "../../src/types/studio.js";
import {
  I2V_TOOL_ADAPTER_SPECS,
  buildDeterministicI2VPlan,
  buildDeterministicLiveVideoQueries,
} from "./i2vPromptDirector.js";
import {
  pickCandidateSeekTimestamps,
  renderRealLiveActionDocumentaryClip,
  scoreLiveVideoCandidate,
} from "./providers/realLiveVideo.js";

const execFileAsync = promisify(execFile);

const SAMPLE_MANNESMANN_SHOTS: DirectorShot[] = [
  {
    shotNumber: 1,
    timecode: "00:00 - 00:05",
    durationSeconds: 5,
    cameraAngle: "نمای متوسط باز",
    cameraMovement: "دالی رو به جلو",
    sceneDescriptionFa: "اتاق بویلر قرن نوزدهم و لوله‌های بخار پرفشار در کارخانه صنعتی",
    visualPromptFa: "Industrial boiler room with high pressure steam pipes venting white steam",
    narrationSegmentFa: "در قرن نوزدهم، لوله‌های بخار درزدار زیر فشار بالا منفجر می‌شدند.",
    lightingAndMood: "نورپردازی صنعتی مه‌آلود",
    transitionToNext: "کات سریع",
  },
  {
    shotNumber: 2,
    timecode: "00:05 - 00:10",
    durationSeconds: 5,
    cameraAngle: "نمای نزدیک",
    cameraMovement: "حرکت دستی مستند",
    sceneDescriptionFa: "درز جوش لوله فولادی با جرقه‌های شدید جوشکاری",
    visualPromptFa: "Arc welding steel pipe seam with bright live flying sparks",
    narrationSegmentFa: "خط جوش همیشه ضعیف‌ترین نقطه هر لوله بود.",
    lightingAndMood: "کنتراست تاریک و کهربایی",
    transitionToNext: "کات",
  },
  {
    shotNumber: 3,
    timecode: "00:10 - 00:15",
    durationSeconds: 5,
    cameraAngle: "نمای متوسط",
    cameraMovement: "پن آرام",
    sceneDescriptionFa: "کوره ذوب فولاد و شمش فولادی گداخته نارنجی در کارگاه ریخته‌گری",
    visualPromptFa: "Molten steel billet glowing orange inside dark blast furnace foundry",
    narrationSegmentFa: "برادران مانیسمان شمش فولاد گداخته را از کوره بیرون کشیدند.",
    lightingAndMood: "تابش آتشین",
    transitionToNext: "دیزالو",
  },
  {
    shotNumber: 4,
    timecode: "00:15 - 00:20",
    durationSeconds: 5,
    cameraAngle: "نمای متوسط",
    cameraMovement: "دالی ردیاب",
    sceneDescriptionFa: "غلتک‌های نورد گرم در حال چرخاندن و شکل‌دهی شمش فولادی روی ریل",
    visualPromptFa: "Hot steel rolling mill with glowing metal moving on spinning rollers",
    narrationSegmentFa: "غلتک‌های مخروطی مانیسمان هسته شمش را بدون درز سوراخ می‌کردند.",
    lightingAndMood: "سینمایی سبزآبی-کهربایی",
    transitionToNext: "کات",
  },
];

test("buildDeterministicLiveVideoQueries produces distinct domain-accurate live-action video queries", () => {
  const q1 = buildDeterministicLiveVideoQueries(SAMPLE_MANNESMANN_SHOTS[0]);
  const q2 = buildDeterministicLiveVideoQueries(SAMPLE_MANNESMANN_SHOTS[1]);
  const q3 = buildDeterministicLiveVideoQueries(SAMPLE_MANNESMANN_SHOTS[2]);
  const q4 = buildDeterministicLiveVideoQueries(SAMPLE_MANNESMANN_SHOTS[3]);

  assert.equal(q1[0], "steam engine");
  assert.equal(q2[0], "welding");
  assert.equal(q3[0], "metal forge");
  assert.equal(q4[0], "rolling mill");
});

test("buildDeterministicI2VPlan enforces anti-static-photo negative prompt, psychology, set design, and tool adaptation", () => {
  for (const tool of Object.keys(I2V_TOOL_ADAPTER_SPECS) as Array<keyof typeof I2V_TOOL_ADAPTER_SPECS>) {
    const plan = buildDeterministicI2VPlan({
      shot: SAMPLE_MANNESMANN_SHOTS[0],
      targetTool: tool,
    });
    assert.ok(plan.revisedPromptEn.includes("Live-action documentary footage"));
    assert.ok(/static photo|frozen still frame/i.test(plan.negativePrompt));
    assert.ok(plan.psychologyNoteFa.length > 20);
    assert.ok(plan.setDesignNoteFa.length > 20);
    assert.ok(plan.qaScore >= 8.0);
    assert.ok(plan.liveVideoSearchQueries.length >= 2);
  }
});

test("scoreLiveVideoCandidate rejects talking heads/protests/diagrams and boosts real HD steel/welding footage", () => {
  const rejectedSpeech = scoreLiveVideoCandidate({
    candidate: {
      id: "1",
      title: "Politician speaking remarks at steel plant.webm",
      description: "Press conference remarks",
      videoUrl: "https://example.org/speech.webm",
      pageUrl: "https://example.org/speech",
      mimeType: "video/webm",
      width: 1920,
      height: 1080,
      durationSec: 200,
      license: "CC-BY",
      author: "News",
    },
    queryTerms: ["steel", "factory"],
  });
  assert.equal(rejectedSpeech, -1);

  const acceptedRollingMill = scoreLiveVideoCandidate({
    candidate: {
      id: "2",
      title: "Proizvodnja vroče valjane debele pločevine v Acroni SIJ Jesenice.ogv",
      description: "Hot rolling steel mill real footage",
      videoUrl: "https://example.org/acroni.ogv",
      pageUrl: "https://example.org/acroni",
      mimeType: "application/ogg",
      width: 1280,
      height: 720,
      durationSec: 477,
      license: "CC-BY-SA",
      author: "SIJ",
    },
    queryTerms: ["rolling", "mill"],
  });
  assert.ok(acceptedRollingMill > 80);
});

test("pickCandidateSeekTimestamps rotates and avoids already-used timestamp buckets across shots", () => {
  const used = new Set<string>();
  const s1 = pickCandidateSeekTimestamps(477, 5, 1, used, "vidA");
  assert.ok(s1.length >= 3);
  used.add(`vidA@${Math.floor(s1[0] / 12)}`);
  const s2 = pickCandidateSeekTimestamps(477, 5, 2, used, "vidA");
  assert.notEqual(Math.floor(s2[0] / 12), Math.floor(s1[0] / 12));
});

test("renderRealLiveActionDocumentaryClip produces a real live-action 24fps MP4 with genuine inter-frame motion and 48kHz stereo audio", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "live_doc_test_"));
  const outMp4 = path.join(tmpDir, "live_rolling_mill.mp4");
  try {
    const res = await renderRealLiveActionDocumentaryClip({
      prompt: "Hot glowing steel billet rolling along industrial rolling mill rollers with live steam and sparks",
      searchQueries: ["rolling mill"],
      shotNumber: 4,
      durationSec: 3,
      width: 720,
      height: 1280,
      fps: 24,
      outputPath: outMp4,
    });

    assert.ok(fs.existsSync(outMp4));
    assert.ok(fs.statSync(outMp4).size > 50_000);
    assert.equal(res.hasRealMotion, true);

    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
      "-of",
      "json",
      outMp4,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams: Array<{
        codec_type: string;
        codec_name: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        sample_rate?: string;
        channels?: number;
      }>;
    };
    const v = parsed.streams.find((s) => s.codec_type === "video");
    const a = parsed.streams.find((s) => s.codec_type === "audio");
    assert.equal(v?.codec_name, "h264");
    assert.equal(v?.width, 720);
    assert.equal(v?.height, 1280);
    assert.equal(v?.r_frame_rate, "24/1");
    assert.equal(a?.codec_name, "aac");
    assert.equal(a?.sample_rate, "48000");
    assert.equal(a?.channels, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
