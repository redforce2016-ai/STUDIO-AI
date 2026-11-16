import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class BlenderUnavailableError extends Error {
  constructor(message = "باینری Blender روی این سرور نصب نیست؛ فال‌بک خودکار به Remotion فعال می‌شود.") {
    super(message);
    this.name = "BlenderUnavailableError";
  }
}

export function isBlenderInstalled(): boolean {
  try {
    const out = execSync("which blender", { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }).trim();
    return Boolean(out);
  } catch {
    return false;
  }
}

export async function renderBlenderShot(params: {
  shotId: string;
  blenderPrompt: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  timeoutMs?: number;
}): Promise<{ outputPath: string }> {
  if (!isBlenderInstalled()) {
    throw new BlenderUnavailableError();
  }

  const workDir = path.dirname(params.outputPath);
  fs.mkdirSync(workDir, { recursive: true });
  const scriptPath = path.join(workDir, `${params.shotId}_scene.py`);
  const frameCount = Math.max(15, Math.round(params.durationSec * params.fps));

  // Sandboxed Blender Python script (no arbitrary network/shell calls)
  const pyScript = `
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x = ${params.width}
scene.render.resolution_y = ${params.height}
scene.render.fps = ${params.fps}
scene.frame_start = 1
scene.frame_end = ${frameCount}
scene.render.image_settings.file_format = 'FFMPEG'
scene.render.ffmpeg.format = 'MPEG4'
scene.render.ffmpeg.codec = 'H264'
scene.render.filepath = ${JSON.stringify(params.outputPath)}

bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
obj = bpy.context.active_object
obj.rotation_euler = (0, 0, 0)
obj.keyframe_insert(data_path="rotation_euler", frame=1)
obj.rotation_euler = (0.6, 0.8, 3.14)
obj.keyframe_insert(data_path="rotation_euler", frame=${frameCount})

bpy.ops.object.light_add(type='AREA', location=(4, -4, 5))
bpy.ops.object.camera_add(location=(0, -6, 2), rotation=(1.25, 0, 0))
scene.camera = bpy.context.active_object
bpy.ops.render.render(animation=True)
`;
  fs.writeFileSync(scriptPath, pyScript, "utf-8");

  await execFileAsync(
    "blender",
    ["--background", "--factory-startup", "--python", scriptPath],
    { timeout: params.timeoutMs ?? 120_000 }
  );

  if (!fs.existsSync(params.outputPath)) {
    throw new Error("خروجی MP4 از Blender تولید نشد.");
  }

  return { outputPath: params.outputPath };
}
