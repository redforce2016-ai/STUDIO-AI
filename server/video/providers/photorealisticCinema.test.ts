import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import {
  buildDocumentaryMediaQueries,
  buildFlickrTagsFromQuery,
  classifyDocumentaryMood,
  scoreRealMediaCandidate,
  type RealMediaCandidate,
} from "./realMediaCurator.js";
import {
  buildPhotorealisticFoleyAudioFilter,
  classifyPhotorealisticFxProfile,
  closePhotorealisticMotionBrowser,
  detectHotspotsFromRgbBuffer,
  renderPhotorealisticCinemaVideoMp4,
} from "./photorealisticMotion.js";

after(async () => {
  await closePhotorealisticMotionBrowser();
});

const execFileAsync = promisify(execFile);

test("buildDocumentaryMediaQueries maps all 7 Mannesmann shots to distinct focused English queries", () => {
  const prompts = [
    "کوره ذوب فولاد ۱۸۸۵ و شمش گداخته با انبر صنعتی",
    "لوله پرچ‌کاری شده دیگ بخار که خط جوش و درز آن شکافته است",
    "غلتک‌های مخروطی نورد سوراخ‌کاری مانیسمان روی شمش سرخ",
    "خروج لوله بدون درز فولادی روی ریل‌های خنک‌کننده کارخانه",
    "جنگل برج‌های تقطیر پالایشگاه نفت و پتروشیمی در شب با مشعل بلند",
    "منیفولد و شیرهای فلکی صنعتی با اتصالات فلنجی استاندارد ASTM",
    "مقطع برش خورده لوله فولادی با دیواره ضخیم بدون خط جوش",
  ];

  const primaryQueries = prompts.map((p, idx) => buildDocumentaryMediaQueries(p, idx + 1)[0]);
  const uniquePrimary = new Set(primaryQueries);
  assert.equal(uniquePrimary.size, 7, `Expected 7 unique primary queries, got: ${primaryQueries.join(", ")}`);
  for (const q of primaryQueries) {
    assert.ok(q.split(/\s+/).length <= 4, `Wikimedia query should stay concise (<=4 words): ${q}`);
  }
});

test("buildDocumentaryMediaQueries supports general non-industrial Persian topics", () => {
  const coffee = buildDocumentaryMediaQueries("دم‌آوری اسپرسو در کافه با بخار داغ", 1);
  assert.ok(coffee.some((q) => /espresso|coffee/i.test(q)));

  const space = buildDocumentaryMediaQueries("پرتاب موشک به فضا در شب", 2);
  assert.ok(space.some((q) => /space|rocket/i.test(q)));
});

test("scoreRealMediaCandidate rejects SVG, blueprints, diagrams, low-res, and duplicate URLs", () => {
  const base: RealMediaCandidate = {
    id: "wm_1",
    title: "Molten steel pouring in foundry.jpg",
    description: "Hot molten steel flowing from furnace ladle",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Molten_steel.jpg",
    downloadUrl: "https://upload.wikimedia.org/molten_steel.jpg",
    mimeType: "image/jpeg",
    width: 1600,
    height: 2200,
    provider: "wikimedia_commons",
    license: "CC BY-SA 4.0",
    author: "Photographer",
  };

  const goodScore = scoreRealMediaCandidate({
    candidate: base,
    queryTerms: ["molten", "steel", "foundry"],
    aspectRatio: "9:16",
    usedUrls: new Set(),
  });
  assert.ok(goodScore > 90, `Expected high score for portrait high-res JPEG, got ${goodScore}`);

  // Reject already-used URL
  const dupScore = scoreRealMediaCandidate({
    candidate: base,
    queryTerms: ["molten", "steel"],
    aspectRatio: "9:16",
    usedUrls: new Set([base.downloadUrl]),
  });
  assert.equal(dupScore, -1);

  // Reject diagram/blueprint
  const diagramScore = scoreRealMediaCandidate({
    candidate: { ...base, title: "Steel furnace blueprint diagram.jpg" },
    queryTerms: ["molten", "steel"],
    aspectRatio: "9:16",
    usedUrls: new Set(),
  });
  assert.equal(diagramScore, -1);

  // Reject SVG
  const svgScore = scoreRealMediaCandidate({
    candidate: { ...base, mimeType: "image/svg+xml" },
    queryTerms: ["molten", "steel"],
    aspectRatio: "9:16",
    usedUrls: new Set(),
  });
  assert.equal(svgScore, -1);

  // Reject tiny image
  const tinyScore = scoreRealMediaCandidate({
    candidate: { ...base, width: 320, height: 240 },
    queryTerms: ["molten", "steel"],
    aspectRatio: "9:16",
    usedUrls: new Set(),
  });
  assert.equal(tinyScore, -1);

  // Reject stereoscopic split-cards & unrelated locomotives/trains
  const stereoScore = scoreRealMediaCandidate({
    candidate: { ...base, title: "Steel Works stereograph card Underwood.jpg" },
    queryTerms: ["steel", "works"],
    aspectRatio: "9:16",
    usedUrls: new Set(),
  });
  assert.equal(stereoScore, -1);

  const trainScore = scoreRealMediaCandidate({
    candidate: { ...base, title: "Yellow locomotive at steel railway crossing.jpg" },
    queryTerms: ["steel", "factory"],
    aspectRatio: "9:16",
    usedUrls: new Set(),
  });
  assert.equal(trainScore, -1);

  assert.equal(buildFlickrTagsFromQuery("molten steel furnace"), "molten,steel,furnace");

  // Penalize antique B&W scan relative to modern color photo
  const antiqueScore = scoreRealMediaCandidate({
    candidate: { ...base, title: "Blast furnace 1898 archival black and white.jpg" },
    queryTerms: ["blast", "furnace"],
    aspectRatio: "9:16",
    usedUrls: new Set(),
  });
  assert.ok(antiqueScore < goodScore - 20);
});

test("detectHotspotsFromRgbBuffer locates glowing molten pixels and classifies FX profiles", () => {
  const W = 16;
  const H = 16;
  const rgb = new Uint8Array(W * H * 3);
  // Fill dark industrial charcoal
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3 + 0] = 20;
    rgb[i * 3 + 1] = 28;
    rgb[i * 3 + 2] = 36;
  }
  // Paint bright molten orange-white cluster around center-bottom (x=7..9, y=10..12)
  for (let y = 10; y <= 12; y++) {
    for (let x = 7; x <= 9; x++) {
      const idx = (y * W + x) * 3;
      rgb[idx + 0] = 255;
      rgb[idx + 1] = 175;
      rgb[idx + 2] = 40;
    }
  }

  const analysis = detectHotspotsFromRgbBuffer(rgb, W, H, "شمش فولاد گداخته در کوره ذوب");
  assert.equal(analysis.fxProfile, "molten_fire");
  assert.ok(analysis.moltenPixelRatio > 0.02);
  assert.ok(analysis.hotspots.length >= 1);
  assert.ok(analysis.hotspots[0].u > 0.35 && analysis.hotspots[0].u < 0.70);

  assert.equal(classifyPhotorealisticFxProfile("دیگ بخار و لوله شکافته با بخار پرفشار", 0), "pressurized_steam");
  assert.equal(classifyPhotorealisticFxProfile("پالایشگاه نفت در شب", 0), "refinery_night");
  assert.equal(classifyPhotorealisticFxProfile("منیفولد و شیرهای فلنجی ASTM", 0), "industrial_clean");
  assert.equal(classifyDocumentaryMood("پالایشگاه نفت و برج تقطیر"), "refinery_twilight");
});

test("buildPhotorealisticFoleyAudioFilter builds valid 48kHz stereo filtergraphs for every FX profile", () => {
  const profiles = [
    "molten_fire",
    "pressurized_steam",
    "refinery_night",
    "industrial_clean",
    "ambient_cinema",
  ] as const;

  for (const profile of profiles) {
    const f = buildPhotorealisticFoleyAudioFilter(profile, 4.5);
    assert.ok(f.includes("sample_rates=48000"), `${profile} must output 48kHz`);
    assert.ok(f.includes("channel_layouts=stereo"), `${profile} must output stereo`);
    assert.ok(f.includes("[aout]"), `${profile} must terminate at [aout]`);
  }
});

test("renderPhotorealisticCinemaVideoMp4 renders a 24fps WebGL2 3D depth-displaced MP4 with 48kHz stereo audio", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoreal_motion_test_"));
  const testPng = path.join(tmpDir, "molten_input.png");
  const outMp4 = path.join(tmpDir, "out_cinema.mp4");
  const depthPng = path.join(tmpDir, "depth.png");

  try {
    // Generate a rich test photo frame (dark teal foundry gradient + bright molten orange billet bar)
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=#12202c:s=360x640:d=1",
      "-vf",
      "drawbox=x=60:y=260:w=240:h=130:color=#ff8818@1:t=fill,drawbox=x=90:y=295:w=180:h=60:color=#fff0a0@1:t=fill,gblur=sigma=4",
      "-frames:v",
      "1",
      testPng,
    ]);

    const res = await renderPhotorealisticCinemaVideoMp4({
      keyframePath: testPng,
      prompt: "molten steel billet emerging from industrial blast furnace with glowing sparks",
      shotNumber: 2,
      cameraMotion: "push-in",
      durationSec: 3,
      width: 360,
      height: 640,
      fps: 24,
      outputPath: outMp4,
      depthMapOutPath: depthPng,
    });

    assert.equal(res.fxProfile, "molten_fire");
    assert.ok(res.framesRendered >= 72);
    assert.ok(fs.existsSync(outMp4));
    assert.ok(fs.existsSync(depthPng));

    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,sample_rate,channels",
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
        sample_rate?: string;
        channels?: number;
      }>;
    };
    const v = parsed.streams.find((s) => s.codec_type === "video");
    const a = parsed.streams.find((s) => s.codec_type === "audio");
    assert.ok(v, "Expected video stream");
    assert.equal(v.width, 360);
    assert.equal(v.height, 640);
    assert.ok(a, "Expected 48kHz stereo audio stream");
    assert.equal(a.sample_rate, "48000");
    assert.equal(a.channels, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
