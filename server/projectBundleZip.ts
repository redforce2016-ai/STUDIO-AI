import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { ProjectRecord } from "../src/types/studio.js";
import {
  generateGoogleColabNotebookIpynb,
  generateMolabMarimoNotebookPy,
} from "./cloudGpuNotebooks.js";
import {
  extractDavinciClipsFromProject,
  generateDavinciResolveFcpxml,
  generateDavinciResolvePythonScript,
  generateOpenTimelineIoJson,
} from "./davinciResolveExport.js";
import { generateCube3dLutText } from "./video/cinemaMastering.js";

export interface ProjectBundleZipPaths {
  imagesDir: string;
  videosDir: string;
  audioDir: string;
  visualsDir: string;
}

export interface ProjectBundleManifest {
  projectId: string;
  title: string;
  generatedAt: string;
  includedFiles: string[];
  storyboardCount: number;
  shotVideosCount: number;
  hasVoiceoverWav: boolean;
  hasFinalMasterMp4: boolean;
  hasSrtSubtitles: boolean;
  hasDavinciExports: boolean;
  hasCloudGpuNotebooks: boolean;
}

function buildProjectScriptMarkdown(project: ProjectRecord): string {
  const lines: string[] = [
    `# ${project.researchScript?.videoTitle || project.brief.title}`,
    "",
    `- **شناسه پروژه:** ${project.id}`,
    `- **پلتفرم:** ${project.brief.platform}`,
    `- **مدت هدف:** ${project.brief.targetDurationSeconds} ثانیه`,
    "",
  ];
  if (project.researchScript) {
    lines.push(
      "## ۱. پژوهش و سناریو",
      "",
      "### خلاصه پژوهش",
      project.researchScript.researchSummary || "",
      "",
      "### قلاب (Hook)",
      project.researchScript.hook || "",
      "",
      "### بدنه سناریو",
      project.researchScript.body || "",
      "",
      "### فراخوان اقدام (CTA)",
      project.researchScript.cta || "",
      ""
    );
  }
  if (project.voiceover) {
    lines.push(
      `## ۲. متن نریشن فارسی (گوینده: ${project.voiceover.voiceName})`,
      "",
      project.voiceover.narrationText,
      ""
    );
  }
  if (project.director?.shots?.length) {
    lines.push("## ۳. دکوپاژ و استوری‌بورد شات‌ها", "");
    for (const s of project.director.shots) {
      lines.push(
        `### شات ${s.shotNumber} (${s.timecode} · ${s.durationSeconds} ثانیه)`,
        `- **زاویه و حرکت دوربین:** ${s.cameraAngle} | ${s.cameraMovement}`,
        `- **متن روی کادر:** ${s.onScreenText}`,
        `- **گفتار:** ${s.spokenSegment}`,
        `- **شرح بصری:** ${s.sceneDescriptionFa}`,
        ""
      );
    }
  }
  return lines.join("\n");
}

function resolveMediaFile(
  url: string | null | undefined,
  dirs: ProjectBundleZipPaths
): string | null {
  if (!url) return null;
  if (url.startsWith("/api/media/images/")) {
    const p = path.join(dirs.imagesDir, path.basename(url));
    return fs.existsSync(p) ? p : null;
  }
  if (url.startsWith("/api/media/videos/")) {
    const p = path.join(dirs.videosDir, path.basename(url));
    return fs.existsSync(p) ? p : null;
  }
  if (url.startsWith("/api/media/visuals/")) {
    const p = path.join(dirs.visualsDir, path.basename(url));
    return fs.existsSync(p) ? p : null;
  }
  if (url.startsWith("/api/media/audio/")) {
    const p = path.join(dirs.audioDir, path.basename(url));
    return fs.existsSync(p) ? p : null;
  }
  return null;
}

/**
 * Builds a complete, self-contained ZIP archive containing ALL deliverables of a project:
 *  - 01_Storyboard/            (Photorealistic keyframe images for every shot)
 *  - 02_Shot_Videos/           (Individual animated MP4 clips for every shot)
 *  - 03_Voiceover/             (Master Persian narration WAV + script text)
 *  - 04_Final_Master/          (Final assembled MP4 + SRT subtitles + QA report JSON)
 *  - 05_DaVinci_Resolve/       (FCPXML v1.10 + OpenTimelineIO .otio + 33^3 .cube 3D LUT + Python API script + Guide)
 *  - 06_Cloud_GPU_Notebooks/   (Marimo Molab .py + Google Colab .ipynb ready-to-run GPU notebooks)
 *  - README_PROJECT_SCRIPT.md  (Complete Persian scenario & storyboard documentation)
 *  - manifest.json             (Structured archive inventory)
 */
export async function buildCompleteProjectOutputsZip(
  project: ProjectRecord,
  dirs: ProjectBundleZipPaths
): Promise<{ buffer: Buffer; manifest: ProjectBundleManifest }> {
  const zip = new JSZip();
  const includedFiles: string[] = [];

  const addFile = (zipPath: string, data: string | Buffer) => {
    zip.file(zipPath, data);
    includedFiles.push(zipPath);
  };

  let storyboardCount = 0;
  let shotVideosCount = 0;
  let hasVoiceoverWav = false;
  let hasFinalMasterMp4 = false;
  let hasSrtSubtitles = false;

  const directorShots = project.director?.shots || [];
  const visualShots = project.visuals?.shots || [];
  const prodShots = project.videoProduction?.shots || [];

  // 1. Storyboard Keyframes + 2. Per-Shot Videos
  for (const shot of directorShots) {
    const num = String(shot.shotNumber).padStart(2, "0");
    const vis = visualShots.find((v) => v.shotNumber === shot.shotNumber);
    const prod = prodShots.find((p) => p.shot_number === shot.shotNumber);

    const imgPath = resolveMediaFile(vis?.imageUrl, dirs);
    if (imgPath) {
      const ext = path.extname(imgPath) || ".jpg";
      addFile(`01_Storyboard/shot_${num}${ext}`, fs.readFileSync(imgPath));
      storyboardCount++;
    }

    let vidPath = resolveMediaFile(vis?.videoUrl, dirs);
    if (!vidPath && prod?.renderPath && fs.existsSync(prod.renderPath)) {
      vidPath = prod.renderPath;
    }
    if (vidPath) {
      addFile(`02_Shot_Videos/shot_${num}.mp4`, fs.readFileSync(vidPath));
      shotVideosCount++;
    }
  }

  // 3. Voiceover WAV + Narration Script
  const voPath = project.voiceover?.audioFilename
    ? path.join(dirs.audioDir, path.basename(project.voiceover.audioFilename))
    : resolveMediaFile(project.voiceover?.audioUrl, dirs);
  if (voPath && fs.existsSync(voPath)) {
    addFile("03_Voiceover/voiceover_master.wav", fs.readFileSync(voPath));
    hasVoiceoverWav = true;
  }
  if (project.voiceover?.narrationText) {
    addFile("03_Voiceover/narration_script.txt", project.voiceover.narrationText);
  }

  // 4. Final Assembled Master MP4 + Subtitles + QA Report
  const finalMp4Path = project.videoProduction?.finalVideoPath;
  if (finalMp4Path && fs.existsSync(finalMp4Path)) {
    addFile("04_Final_Master/master_final.mp4", fs.readFileSync(finalMp4Path));
    hasFinalMasterMp4 = true;
  }
  const srtPath = project.videoProduction?.srtPath;
  if (srtPath && fs.existsSync(srtPath)) {
    addFile("04_Final_Master/subtitles.srt", fs.readFileSync(srtPath));
    hasSrtSubtitles = true;
  }
  if (project.videoProduction) {
    addFile(
      "04_Final_Master/qa_report.json",
      JSON.stringify(
        {
          runId: project.videoProduction.runId,
          status: project.videoProduction.status,
          aspectRatio: project.videoProduction.aspectRatio,
          qualityMode: project.videoProduction.qualityMode,
          colorGradePreset: project.videoProduction.colorGradePreset || "industrial_teal_amber",
          musicSource: project.videoProduction.musicSource || "ambient_cinema",
          finalQa: project.videoProduction.finalQa || null,
        },
        null,
        2
      )
    );
  }

  // 5. DaVinci Resolve / OpenTimelineIO / 3D LUT Export
  const rawClips = extractDavinciClipsFromProject(project, dirs.videosDir, dirs.imagesDir);
  const bundleClips = rawClips.map((c) => {
    const num = String(c.shotNumber).padStart(2, "0");
    return {
      ...c,
      mediaFilename: `shot_${num}.mp4`,
      mediaAbsPath: `../02_Shot_Videos/shot_${num}.mp4`,
    };
  });
  const isLandscape =
    project.videoProduction?.aspectRatio === "16:9" ||
    project.brief.contentFormat === "long_video" ||
    project.brief.platform === "youtube";
  const fcpxml = generateDavinciResolveFcpxml({
    project,
    clips: bundleClips,
    voiceoverAbsPath: hasVoiceoverWav ? "../03_Voiceover/voiceover_master.wav" : null,
    width: isLandscape ? 1920 : 1080,
    height: isLandscape ? 1080 : 1920,
    fps: 24,
  });
  const davinciPy = generateDavinciResolvePythonScript({
    project,
    fcpxmlFilename: "davinci_timeline.fcpxml",
    clips: bundleClips,
    voiceoverFilename: hasVoiceoverWav ? "../03_Voiceover/voiceover_master.wav" : null,
  });
  const otioJson = generateOpenTimelineIoJson({
    project,
    clips: bundleClips,
    voiceoverAbsPath: hasVoiceoverWav ? "../03_Voiceover/voiceover_master.wav" : null,
    cubeLutFilename: "cinema_grade.cube",
    fps: 24,
  });
  const lutPreset = project.videoProduction?.colorGradePreset || "industrial_teal_amber";
  const cubeLut = generateCube3dLutText(lutPreset === "none" ? "industrial_teal_amber" : lutPreset);

  addFile("05_DaVinci_Resolve/davinci_timeline.fcpxml", fcpxml);
  addFile("05_DaVinci_Resolve/timeline.otio", otioJson);
  addFile("05_DaVinci_Resolve/cinema_grade.cube", cubeLut);
  addFile("05_DaVinci_Resolve/davinci_edit_grade.py", davinciPy);
  addFile(
    "05_DaVinci_Resolve/README_DAVINCI_FA.txt",
    [
      "راهنمای باز کردن پروژه در DaVinci Resolve و ابزارهای تدوین استاندارد (OTIO + .cube LUT):",
      "1. تمام پوشه‌های این فایل ZIP را در یک پوشه روی سیستم خود Extract کنید.",
      "2. نرم‌افزار DaVinci Resolve (یا Kdenlive / Blender VSE) را باز کنید.",
      "3. از منوی بالا مسیر File -> Import -> Timeline... فایل davinci_timeline.fcpxml یا timeline.otio را باز کنید.",
      "4. فایل cinema_grade.cube یک LUT سه‌بعدی واقعی ۳۳×۳۳×۳۳ است که روی مستر نیز اعمال شده و داخل Resolve در بخش LUT قابل انتخاب است.",
      "5. برای اتوماسیون کامل روی دسکتاپ، از منوی Workspace -> Console -> Python 3 اسکریپت davinci_edit_grade.py را اجرا کنید.",
      "",
      "نکته: فایل 04_Final_Master/master_final.mp4 همین حالا با موتور CinemaMasteringEngine (معادل بی‌نیاز از GUI داوینچی روی لینوکس) همراه با .cube 3D LUT، هاله نور، گرین ۳۵م‌م، صدای محیط شات‌ها، موزیک پس‌زمینه و تراز -14 LUFS رندر شده است.",
    ].join("\n")
  );

  // 6. Ready-to-run Cloud GPU Notebooks (Marimo Molab & Google Colab)
  const molabPy = generateMolabMarimoNotebookPy({
    platform: "molab",
    mode: "comfyui_i2v_worker",
    modelPreset: "wan22_fp8_14b",
  });
  const colabIpynb = generateGoogleColabNotebookIpynb({
    platform: "google_colab",
    mode: "comfyui_i2v_worker",
    modelPreset: "wan22_5b_gguf",
    mountGoogleDrive: true,
  });
  addFile("06_Cloud_GPU_Notebooks/molab_gpu_studio.py", molabPy);
  addFile("06_Cloud_GPU_Notebooks/colab_gpu_studio.ipynb", colabIpynb);

  // 7. Complete Project Script & Manifest
  addFile("README_PROJECT_SCRIPT.md", buildProjectScriptMarkdown(project));

  const manifest: ProjectBundleManifest = {
    projectId: project.id,
    title: project.researchScript?.videoTitle || project.brief.title,
    generatedAt: new Date().toISOString(),
    includedFiles: [...includedFiles, "manifest.json"],
    storyboardCount,
    shotVideosCount,
    hasVoiceoverWav,
    hasFinalMasterMp4,
    hasSrtSubtitles,
    hasDavinciExports: true,
    hasCloudGpuNotebooks: true,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return { buffer, manifest };
}
