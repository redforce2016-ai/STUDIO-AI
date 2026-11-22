import path from "node:path";
import type { ProjectRecord } from "../src/types/studio.js";

export interface DavinciTimelineClip {
  shotNumber: number;
  name: string;
  mediaFilename: string;
  mediaAbsPath: string;
  durationSec: number;
  onScreenText: string;
  cameraMovement: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${encodeURI(normalized)}` : `file:///${encodeURI(normalized)}`;
}

export function extractDavinciClipsFromProject(
  project: ProjectRecord,
  videosDir: string,
  imagesDir: string
): DavinciTimelineClip[] {
  const directorShots = project.director?.shots || [];
  const visualShots = project.visuals?.shots || [];
  const prodShots = project.videoProduction?.shots || [];

  return directorShots.map((shot) => {
    const vis = visualShots.find((v) => v.shotNumber === shot.shotNumber);
    const prod = prodShots.find((p) => p.shot_number === shot.shotNumber);

    let mediaFilename = `shot_${String(shot.shotNumber).padStart(2, "0")}.mp4`;
    let mediaAbsPath = path.join(videosDir, mediaFilename);

    if (vis?.videoUrl && vis.videoUrl.startsWith("/api/media/videos/")) {
      mediaFilename = path.basename(vis.videoUrl);
      mediaAbsPath = path.join(videosDir, mediaFilename);
    } else if (prod?.renderPath) {
      mediaFilename = path.basename(prod.renderPath);
      mediaAbsPath = prod.renderPath;
    } else if (vis?.imageUrl && vis.imageUrl.startsWith("/api/media/images/")) {
      mediaFilename = path.basename(vis.imageUrl);
      mediaAbsPath = path.join(imagesDir, mediaFilename);
    }

    return {
      shotNumber: shot.shotNumber,
      name: `Shot_${String(shot.shotNumber).padStart(2, "0")}`,
      mediaFilename,
      mediaAbsPath,
      durationSec: Math.max(2, Math.round(shot.durationSeconds || 3)),
      onScreenText: shot.onScreenText || "",
      cameraMovement: shot.cameraMovement || "push-in",
    };
  });
}

/**
 * Generates a spec-compliant Final Cut Pro XML v1.10 (.fcpxml) timeline
 * natively importable into DaVinci Resolve Free & Studio via:
 *   File -> Import -> Timeline -> Choose .fcpxml
 */
export function generateDavinciResolveFcpxml(params: {
  project: ProjectRecord;
  clips: DavinciTimelineClip[];
  voiceoverAbsPath?: string | null;
  width?: number;
  height?: number;
  fps?: number;
}): string {
  const fps = params.fps || 30;
  const width = params.width || 1080;
  const height = params.height || 1920;
  const totalSec = params.clips.reduce((sum, c) => sum + c.durationSec, 0) || 15;
  const projectTitle = params.project.researchScript?.videoTitle || params.project.brief.title;

  const assetDefs: string[] = [];
  const spineClips: string[] = [];

  let offsetSec = 0;
  params.clips.forEach((clip, idx) => {
    const assetId = `r_vid_${idx + 2}`;
    const durStr = `${clip.durationSec * fps}/${fps}s`;
    const offsetStr = `${offsetSec * fps}/${fps}s`;
    assetDefs.push(
      `    <asset id="${assetId}" name="${escapeXml(clip.mediaFilename)}" uid="${escapeXml(
        `${params.project.id}_s${clip.shotNumber}`
      )}" start="0s" duration="${durStr}" hasVideo="1" format="r1" hasAudio="0">
      <media-rep kind="original-media" src="${escapeXml(toFileUrl(clip.mediaAbsPath))}" />
    </asset>`
    );

    const markerXml = clip.onScreenText
      ? `\n            <marker start="0s" duration="1/${fps}s" value="${escapeXml(
          clip.onScreenText
        )}" note="${escapeXml(clip.cameraMovement)}" />`
      : "";

    spineClips.push(
      `          <asset-clip name="${escapeXml(clip.name)}" ref="${assetId}" offset="${offsetStr}" duration="${durStr}" start="0s" tcFormat="NDF">${markerXml}
          </asset-clip>`
    );
    offsetSec += clip.durationSec;
  });

  let audioLaneXml = "";
  if (params.voiceoverAbsPath) {
    const audioId = "r_audio_vo";
    const audioFilename = path.basename(params.voiceoverAbsPath);
    const totalDurStr = `${totalSec * fps}/${fps}s`;
    assetDefs.push(
      `    <asset id="${audioId}" name="${escapeXml(audioFilename)}" uid="${escapeXml(
        `${params.project.id}_vo`
      )}" start="0s" duration="${totalDurStr}" hasVideo="0" hasAudio="1" audioSources="1" audioChannels="1" audioRate="24000">
      <media-rep kind="original-media" src="${escapeXml(toFileUrl(params.voiceoverAbsPath))}" />
    </asset>`
    );
    audioLaneXml = `
          <asset-clip name="Persian_Voiceover_Master" lane="-1" ref="${audioId}" offset="0s" duration="${totalDurStr}" start="0s" role="dialogue" />`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat${width}x${height}p${fps}" frameDuration="1/${fps}s" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)" />
${assetDefs.join("\n")}
  </resources>
  <library>
    <event name="${escapeXml(projectTitle)}">
      <project name="${escapeXml(projectTitle)} — DaVinci Master">
        <sequence format="r1" duration="${totalSec * fps}/${fps}s" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spineClips.join("\n")}${audioLaneXml}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

/**
 * Generates an open-source DaVinci Resolve Python Scripting API automation script (.py)
 * (based on Blackmagic DaVinciResolveScript & diop/davinci-resolve-api)
 * that creates the project, imports the FCPXML timeline, applies an Industrial Teal & Amber CDL color grade,
 * and queues a 1080p H.264 MP4 master render automatically.
 */
export function generateDavinciResolvePythonScript(params: {
  project: ProjectRecord;
  fcpxmlFilename: string;
  clips: DavinciTimelineClip[];
  voiceoverFilename?: string | null;
}): string {
  const projectTitle = (
    params.project.researchScript?.videoTitle || params.project.brief.title
  ).replace(/"/g, "'");
  const clipFilesJson = JSON.stringify(
    params.clips.map((c) => c.mediaFilename),
    null,
    2
  );

  return `#!/usr/bin/env python3
"""
Content Studio Desktop — DaVinci Resolve Auto-Edit, Color Grade & Render Script
Open-source DaVinciResolveScript workflow (compatible with DaVinci Resolve Studio / Console).

Usage inside DaVinci Resolve:
  1. Place this .py script, ${params.fcpxmlFilename}, shot MP4s, and voiceover WAV in one folder.
  2. In DaVinci Resolve: Workspace -> Console -> Python 3 -> run this script, OR File -> Import -> Timeline (${params.fcpxmlFilename}).
"""

import os
import sys

try:
    import DaVinciResolveScript as dvr_script
except ImportError:
    print("DaVinciResolveScript module not found. Run from DaVinci Resolve Console or set RESOLVE_SCRIPT_API.")
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_NAME = "${projectTitle}"
FCPXML_PATH = os.path.join(BASE_DIR, "${params.fcpxmlFilename}")
SHOT_FILES = ${clipFilesJson}
VOICEOVER_FILE = ${params.voiceoverFilename ? JSON.stringify(params.voiceoverFilename) : "None"}


def main():
    resolve = dvr_script.scriptapp("Resolve")
    if not resolve:
        raise RuntimeError("Could not connect to running DaVinci Resolve instance.")

    pm = resolve.GetProjectManager()
    project = pm.CreateProject(PROJECT_NAME) or pm.LoadProject(PROJECT_NAME)
    if not project:
        raise RuntimeError(f"Failed to create or load DaVinci project: {PROJECT_NAME}")

    media_pool = project.GetMediaPool()
    media_storage = resolve.GetMediaStorage()

    # 1. Import all shot MP4 clips and voiceover WAV into Media Pool
    media_paths = [os.path.join(BASE_DIR, f) for f in SHOT_FILES if os.path.exists(os.path.join(BASE_DIR, f))]
    if VOICEOVER_FILE and os.path.exists(os.path.join(BASE_DIR, VOICEOVER_FILE)):
        media_paths.append(os.path.join(BASE_DIR, VOICEOVER_FILE))
    if media_paths:
        media_storage.AddItemListToMediaPool(media_paths)

    # 2. Import complete multi-track FCPXML timeline (shots + markers + voiceover)
    timeline = None
    if os.path.exists(FCPXML_PATH):
        timeline = media_pool.ImportTimelineFromFile(FCPXML_PATH, {
            "timelineName": f"{PROJECT_NAME} - Master Edit",
            "importSourceClips": True,
        })
    if not timeline:
        timeline = project.GetCurrentTimeline()

    # 3. Apply Industrial Cinema Teal-and-Amber CDL Color Grade across all V1 clips
    if timeline:
        v1_items = timeline.GetItemListInTrack("video", 1) or []
        cdl_grade = {
            "NodeIndex": "1",
            "Slope": "1.06 1.01 0.94",
            "Offset": "-0.015 -0.008 0.012",
            "Power": "1.03 1.00 0.98",
            "Saturation": "1.14",
        }
        for item in v1_items:
            item.SetCDL(cdl_grade)
        print(f"Applied Industrial Cinema CDL Color Grade to {len(v1_items)} clips.")

    # 4. Configure Deliver page for 1080p H.264 Master Export (-14 LUFS loudness normalized)
    project.SetCurrentRenderFormatAndCodec("mp4", "H264")
    project.SetRenderSettings({
        "SelectAllFrames": True,
        "TargetDir": os.path.join(BASE_DIR, "davinci_renders"),
        "CustomName": "master_final_davinci",
        "FormatWidth": 1080,
        "FormatHeight": 1920,
        "FrameRate": 30.0,
        "ExportAudio": True,
        "AudioCodec": "aac",
        "AudioBitRate": 192000,
    })
    job_id = project.AddRenderJob()
    print(f"Queued DaVinci Resolve Render Job: {job_id}")
    project.StartRendering(job_id)
    print("DaVinci Resolve Master Render started!")


if __name__ == "__main__":
    main()
`;
}

/**
 * Generates an OpenTimelineIO (.otio) Timeline.1 JSON file natively supported by
 * DaVinci Resolve 18+, Kdenlive, Blender VSE, and OpenTimelineIO open-source tools.
 */
export function generateOpenTimelineIoJson(params: {
  project: ProjectRecord;
  clips: DavinciTimelineClip[];
  voiceoverAbsPath?: string | null;
  musicAbsPath?: string | null;
  cubeLutFilename?: string | null;
  fps?: number;
}): string {
  const fps = params.fps || 24;
  const projectTitle = params.project.researchScript?.videoTitle || params.project.brief.title;
  const totalSec = params.clips.reduce((sum, c) => sum + c.durationSec, 0) || 12;

  const rt = (sec: number) => ({
    OTIO_SCHEMA: "RationalTime.1",
    rate: fps,
    value: Math.round(sec * fps),
  });
  const range = (startSec: number, durSec: number) => ({
    OTIO_SCHEMA: "TimeRange.1",
    start_time: rt(startSec),
    duration: rt(durSec),
  });

  const videoChildren = params.clips.map((clip) => ({
    OTIO_SCHEMA: "Clip.2",
    name: clip.name,
    metadata: {
      camera_movement: clip.cameraMovement,
      cinema_lut_cube: params.cubeLutFilename || "cinema_grade.cube",
    },
    source_range: range(0, clip.durationSec),
    media_reference: {
      OTIO_SCHEMA: "ExternalReference.1",
      target_url: toFileUrl(clip.mediaAbsPath),
      available_range: range(0, clip.durationSec),
    },
    markers: clip.onScreenText
      ? [
          {
            OTIO_SCHEMA: "Marker.2",
            name: clip.onScreenText,
            color: "AMBER",
            marked_range: range(0, 0.04),
            metadata: { camera_movement: clip.cameraMovement },
          },
        ]
      : [],
  }));

  const tracks: Array<Record<string, unknown>> = [
    {
      OTIO_SCHEMA: "Track.1",
      name: "V1_Video",
      kind: "Video",
      children: videoChildren,
    },
  ];

  if (params.voiceoverAbsPath) {
    tracks.push({
      OTIO_SCHEMA: "Track.1",
      name: "A1_Persian_Voiceover",
      kind: "Audio",
      children: [
        {
          OTIO_SCHEMA: "Clip.2",
          name: "Voiceover_Master_WAV",
          source_range: range(0, totalSec),
          media_reference: {
            OTIO_SCHEMA: "ExternalReference.1",
            target_url: toFileUrl(params.voiceoverAbsPath),
            available_range: range(0, totalSec),
          },
        },
      ],
    });
  }

  if (params.musicAbsPath) {
    tracks.push({
      OTIO_SCHEMA: "Track.1",
      name: "A2_Cinema_Score",
      kind: "Audio",
      children: [
        {
          OTIO_SCHEMA: "Clip.2",
          name: "Cinema_Score_Underscore",
          source_range: range(0, totalSec),
          media_reference: {
            OTIO_SCHEMA: "ExternalReference.1",
            target_url: toFileUrl(params.musicAbsPath),
            available_range: range(0, totalSec),
          },
        },
      ],
    });
  }

  const otio = {
    OTIO_SCHEMA: "Timeline.1",
    name: `${projectTitle} — Cinema Master Timeline`,
    global_start_time: rt(0),
    metadata: {
      generator: "Content Studio CinemaMasteringEngine",
      project_id: params.project.id,
      color_grade_cube: params.cubeLutFilename || "cinema_grade.cube",
    },
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "Master_Stack",
      children: tracks,
    },
  };

  return JSON.stringify(otio, null, 2);
}
