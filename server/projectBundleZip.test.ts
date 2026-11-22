import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import type { ProjectRecord } from "../src/types/studio.js";
import { buildCompleteProjectOutputsZip } from "./projectBundleZip.js";

test("buildCompleteProjectOutputsZip bundles storyboard, shot videos, voiceover, master MP4, DaVinci files, and GPU notebooks", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-zip-test-"));
  const imagesDir = path.join(tmpDir, "images");
  const videosDir = path.join(tmpDir, "videos");
  const audioDir = path.join(tmpDir, "audio");
  const visualsDir = path.join(tmpDir, "visuals");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(videosDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(visualsDir, { recursive: true });

  fs.writeFileSync(path.join(imagesDir, "s1.jpg"), Buffer.from("fake-jpg"));
  fs.writeFileSync(path.join(videosDir, "v1.mp4"), Buffer.from("fake-shot-mp4"));
  fs.writeFileSync(path.join(audioDir, "vo.wav"), Buffer.from("fake-wav"));
  const masterPath = path.join(tmpDir, "final.mp4");
  const srtPath = path.join(tmpDir, "subtitles.srt");
  fs.writeFileSync(masterPath, Buffer.from("fake-master-mp4"));
  fs.writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:03,000\nتست\n");

  const project: ProjectRecord = {
    id: "proj_zip_test",
    threadId: "t1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brief: {
      title: "تست لوله مانیسمان",
      idea: "لوله بدون درز مانیسمان",
      platform: "instagram",
      tone: "educational",
      targetDurationSeconds: 10,
    },
    currentStage: "assembly",
    checkpointStatus: "waiting_approval",
    waitingNode: null,
    errorMessage: null,
    researchScript: {
      videoTitle: "راز لوله مانیسمان",
      targetAudienceNote: "",
      researchSummary: "خلاصه پژوهش",
      keyInsights: [],
      trendingAngles: [],
      sources: [],
      hook: "قلاب اول",
      body: "بدنه",
      cta: "ذخیره کن",
      keywords: [],
    },
    voiceover: {
      narrationText: "متن نریشن تست",
      voiceName: "Kore",
      voiceStyle: "جدی",
      estimatedSeconds: 10,
      wordCount: 3,
      pacingNotes: "",
      audioUrl: "/api/media/audio/vo.wav",
      audioFilename: "vo.wav",
    },
    director: {
      visualDirectionSummary: "صنعتی",
      totalEstimatedSeconds: 3,
      shots: [
        {
          shotNumber: 1,
          timecode: "00:00-00:03",
          durationSeconds: 3,
          cameraAngle: "Close-up",
          cameraMovement: "push-in",
          sceneDescriptionFa: "فشارسنج",
          spokenSegment: "فشار بالا",
          onScreenText: "فشار بالا",
          lightingAndMood: "تیره",
          visualPromptFa: "لوله",
        },
      ],
    },
    visuals: {
      styleGuideSummary: "صنعتی",
      shots: [
        {
          shotNumber: 1,
          imageUrl: "/api/media/images/s1.jpg",
          videoUrl: "/api/media/videos/v1.mp4",
          motionCue: "push-in",
          colorPaletteNote: "تیره",
          status: "ready",
        },
      ],
    },
    videoProduction: {
      runId: "run_test",
      projectId: "proj_zip_test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      aspectRatio: "9:16",
      qualityMode: "preview_480p",
      status: "completed",
      currentNode: "final_qa",
      shots: [],
      logs: [],
      finalVideoPath: masterPath,
      finalVideoUrl: "/api/media/video-runs/run_test/final.mp4",
      srtPath,
      srtUrl: "/api/video/runs/run_test/srt",
    },
    logs: [],
  };

  try {
    const { buffer, manifest } = await buildCompleteProjectOutputsZip(project, {
      imagesDir,
      videosDir,
      audioDir,
      visualsDir,
    });
    assert.ok(buffer.length > 500);
    assert.equal(manifest.storyboardCount, 1);
    assert.equal(manifest.shotVideosCount, 1);
    assert.equal(manifest.hasVoiceoverWav, true);
    assert.equal(manifest.hasFinalMasterMp4, true);
    assert.equal(manifest.hasSrtSubtitles, true);

    const parsedZip = await JSZip.loadAsync(buffer);
    assert.ok(parsedZip.file("01_Storyboard/shot_01.jpg"));
    assert.ok(parsedZip.file("02_Shot_Videos/shot_01.mp4"));
    assert.ok(parsedZip.file("03_Voiceover/voiceover_master.wav"));
    assert.ok(parsedZip.file("04_Final_Master/master_final.mp4"));
    assert.ok(parsedZip.file("05_DaVinci_Resolve/davinci_timeline.fcpxml"));
    assert.ok(parsedZip.file("05_DaVinci_Resolve/timeline.otio"));
    assert.ok(parsedZip.file("05_DaVinci_Resolve/cinema_grade.cube"));
    assert.ok(parsedZip.file("05_DaVinci_Resolve/davinci_edit_grade.py"));
    assert.ok(parsedZip.file("06_Cloud_GPU_Notebooks/molab_gpu_studio.py"));
    assert.ok(parsedZip.file("06_Cloud_GPU_Notebooks/colab_gpu_studio.ipynb"));
    assert.ok(parsedZip.file("README_PROJECT_SCRIPT.md"));
    assert.ok(parsedZip.file("manifest.json"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
