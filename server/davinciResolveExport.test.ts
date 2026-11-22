import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectRecord } from "../src/types/studio.js";
import {
  extractDavinciClipsFromProject,
  generateDavinciResolveFcpxml,
  generateDavinciResolvePythonScript,
  generateOpenTimelineIoJson,
} from "./davinciResolveExport.js";

const mockProject: ProjectRecord = {
  id: "proj_mannesmann_test",
  threadId: "t1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  brief: {
    title: "لوله مانیسمان",
    idea: "تولید لوله بدون درز مانیسمان",
    platform: "instagram",
    tone: "educational",
    targetDurationSeconds: 10,
  },
  currentStage: "assembly",
  checkpointStatus: "waiting_approval",
  waitingNode: null,
  errorMessage: null,
  researchScript: {
    videoTitle: "راز لوله بدون درز مانیسمان",
    targetAudienceNote: "",
    researchSummary: "",
    keyInsights: [],
    trendingAngles: [],
    sources: [],
    hook: "",
    body: "",
    cta: "",
    keywords: [],
  },
  voiceover: null,
  director: {
    visualDirectionSummary: "صنعتی سینمایی",
    totalEstimatedSeconds: 7,
    shots: [
      {
        shotNumber: 1,
        timecode: "00:00-00:03",
        durationSeconds: 3,
        cameraAngle: "Close-up",
        cameraMovement: "push-in",
        sceneDescriptionFa: "فشارسنج پالایشگاه",
        spokenSegment: "فشار بالا",
        onScreenText: "خط جوش مساوی ریسک",
        lightingAndMood: "تیره",
        visualPromptFa: "لوله فولادی",
      },
      {
        shotNumber: 2,
        timecode: "00:03-00:07",
        durationSeconds: 4,
        cameraAngle: "Medium",
        cameraMovement: "pan",
        sceneDescriptionFa: "شمش گداخته",
        spokenSegment: "شمش ۱۲۵۰ درجه",
        onScreenText: "شمش ۱۲۵۰ درجه",
        lightingAndMood: "نارنجی",
        visualPromptFa: "شمش گداخته",
      },
    ],
  },
  visuals: {
    styleGuideSummary: "صنعتی",
    shots: [
      {
        shotNumber: 1,
        imageUrl: "/api/media/images/shot1.png",
        videoUrl: "/api/media/videos/shot1.mp4",
        motionCue: "push-in",
        colorPaletteNote: "تیره",
        status: "ready",
      },
      {
        shotNumber: 2,
        imageUrl: "/api/media/images/shot2.png",
        videoUrl: "/api/media/videos/shot2.mp4",
        motionCue: "pan",
        colorPaletteNote: "گرم",
        status: "ready",
      },
    ],
  },
  logs: [],
};

test("extractDavinciClipsFromProject maps shot videos and durations accurately", () => {
  const clips = extractDavinciClipsFromProject(mockProject, "/data/videos", "/data/images");
  assert.equal(clips.length, 2);
  assert.equal(clips[0].mediaFilename, "shot1.mp4");
  assert.equal(clips[0].durationSec, 3);
  assert.equal(clips[1].mediaFilename, "shot2.mp4");
  assert.equal(clips[1].durationSec, 4);
});

test("generateDavinciResolveFcpxml outputs valid FCPXML 1.10 with video clips and voiceover lane", () => {
  const clips = extractDavinciClipsFromProject(mockProject, "/data/videos", "/data/images");
  const xml = generateDavinciResolveFcpxml({
    project: mockProject,
    clips,
    voiceoverAbsPath: "/data/audio/voiceover.wav",
    width: 1080,
    height: 1920,
    fps: 30,
  });
  assert.ok(xml.includes('<fcpxml version="1.10">'));
  assert.ok(xml.includes("shot1.mp4"));
  assert.ok(xml.includes("shot2.mp4"));
  assert.ok(xml.includes("voiceover.wav"));
  assert.ok(xml.includes('duration="210/30s"'));
  assert.ok(xml.includes("خط جوش مساوی ریسک"));
});

test("generateDavinciResolvePythonScript includes DaVinciResolveScript import, CDL color grade, and render job", () => {
  const clips = extractDavinciClipsFromProject(mockProject, "/data/videos", "/data/images");
  const py = generateDavinciResolvePythonScript({
    project: mockProject,
    fcpxmlFilename: "mannesmann_davinci.fcpxml",
    clips,
    voiceoverFilename: "voiceover.wav",
  });
  assert.ok(py.includes("import DaVinciResolveScript"));
  assert.ok(py.includes("ImportTimelineFromFile"));
  assert.ok(py.includes("SetCDL"));
  assert.ok(py.includes("StartRendering"));
});

test("generateOpenTimelineIoJson outputs valid OpenTimelineIO Timeline.1 schema with LUT metadata", () => {
  const clips = extractDavinciClipsFromProject(mockProject, "/data/videos", "/data/images");
  const jsonText = generateOpenTimelineIoJson({
    project: mockProject,
    clips,
    voiceoverAbsPath: "/data/audio/voiceover.wav",
    cubeLutFilename: "industrial.cube",
    fps: 24,
  });
  const parsed = JSON.parse(jsonText);
  assert.equal(parsed.OTIO_SCHEMA, "Timeline.1");
  assert.equal(parsed.metadata.color_grade_cube, "industrial.cube");
  assert.equal(parsed.tracks.children[0].name, "V1_Video");
  assert.equal(parsed.tracks.children[0].children.length, 2);
  assert.equal(parsed.tracks.children[1].name, "A1_Persian_Voiceover");
});
