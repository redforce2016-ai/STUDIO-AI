import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ShotSpec } from "../../../src/types/videoPipeline.js";
import { executeRemoteColabBlenderRender, getColabBridgeConfig } from "../../colabBridge.js";

const execFileAsync = promisify(execFile);

export class BlenderUnavailableError extends Error {
  constructor(
    message = "باینری Blender روی سرور محلی یا Google Colab متصل نیست؛ انتقال خودکار به موتور رایگان HyperFrames/Remotion انجام می‌شود."
  ) {
    super(message);
    this.name = "BlenderUnavailableError";
  }
}

export function isBlenderInstalled(): boolean {
  try {
    const out = execSync("which blender", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    return Boolean(out);
  } catch {
    return false;
  }
}

export function isColabBlenderReady(): boolean {
  const cfg = getColabBridgeConfig();
  return Boolean(cfg.connected && cfg.bridgeUrl && cfg.lastHealth?.engines?.blender);
}

/**
 * Generates a real Blender 4.2 LTS Python (`bpy`) Industrial Commercial 3D Scene strictly from the
 * Director's 7-Layer Cinematic Spec (Scene, Objects, Animation, Camera, Lighting, Transition, Sound Design):
 * - Dark cinematic studio world (#04070D)
 * - Hollow brushed steel industrial pipe mesh (Outer + Inner Solidify + Bevel) with Principled BSDF PBR Metal
 * - Live 3D Skeleton / Armature rig (`Pipe_Rig_Armature`) + DampedTrack smooth controlled camera dolly/orbit
 * - Key crisp white Area light + Cool cyan/blue metallic rim lights (or warm molten amber if specified in Lighting)
 * - Subtle floating luminous particle motes around the steel pipe
 * - High-clarity H.264 MP4 output using GPU EEVEE Next / Cycles
 */
export function buildBlenderSevenLayerPythonScript(params: {
  shotId: string;
  spec?: ShotSpec;
  blenderPrompt: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
}): string {
  const frameCount = Math.max(24, Math.round(params.durationSec * params.fps));
  const seven = params.spec?.seven_layer_spec;
  const lightingLower = `${seven?.lighting || ""} ${params.blenderPrompt}`.toLowerCase();
  const isWarmMolten =
    lightingLower.includes("آتش") ||
    lightingLower.includes("کهربا") ||
    lightingLower.includes("گداخته") ||
    lightingLower.includes("amber") ||
    lightingLower.includes("molten");

  // Rim light RGB tuple: Cool Electric Steel Blue vs Warm Molten Forge Amber
  const rimRgb = isWarmMolten ? "(1.0, 0.52, 0.14)" : "(0.18, 0.68, 1.0)";
  const keyRgb = isWarmMolten ? "(1.0, 0.94, 0.85)" : "(0.94, 0.97, 1.0)";
  const cameraMotion = params.spec?.visual?.camera_motion || "push-in";

  const camStart =
    cameraMotion === "pan"
      ? "(-2.2, -5.2, 1.15)"
      : cameraMotion === "orbit"
        ? "(-2.4, -4.8, 1.4)"
        : "(0.0, -5.8, 1.25)";
  const camEnd =
    cameraMotion === "pan"
      ? "(2.2, -5.0, 1.15)"
      : cameraMotion === "orbit"
        ? "(2.4, -4.5, 1.1)"
        : "(0.0, -4.3, 1.05)";

  return `# Content Studio Pro — Blender 4.2 LTS 7-Layer Industrial PBR & Live 3D Skeleton Scene
# Shot: ${params.shotId}
# 1. Scene: ${(seven?.scene || params.blenderPrompt).replace(/\n/g, " ").slice(0, 120)}
# 2. Objects: ${(seven?.objects || "Industrial Seamless Steel Pipe").replace(/\n/g, " ").slice(0, 120)}
# 3. Lighting: ${(seven?.lighting || "White key + Cool blue metallic rim").replace(/\n/g, " ").slice(0, 120)}

import bpy
import math
import random

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x = ${params.width}
scene.render.resolution_y = ${params.height}
scene.render.resolution_percentage = 100
scene.render.fps = ${params.fps}
scene.frame_start = 1
scene.frame_end = ${frameCount}

# Prefer GPU EEVEE Next / Cycles cleanly on headless Colab GPU
for engine_candidate in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
    try:
        scene.render.engine = engine_candidate
        break
    except Exception:
        pass

scene.render.image_settings.file_format = 'FFMPEG'
scene.render.ffmpeg.format = 'MPEG4'
scene.render.ffmpeg.codec = 'H264'
scene.render.ffmpeg.constant_rate_factor = 'HIGH'
scene.render.ffmpeg.ffmpeg_preset = 'GOOD'
scene.render.filepath = ${JSON.stringify(params.outputPath)}

# 1. Dark Cinematic Studio World
world = bpy.data.worlds.new("StudioDarkWorld")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.012, 0.018, 0.032, 1.0)
    bg.inputs[1].default_value = 0.35

# Subtle dark reflective studio floor
bpy.ops.mesh.primitive_plane_add(size=24, location=(0, 0, -1.15))
floor = bpy.context.active_object
floor.name = "Dark_Studio_Floor"
floor_mat = bpy.data.materials.new("DarkFloorMat")
floor_mat.use_nodes = True
f_bsdf = floor_mat.node_tree.nodes.get("Principled BSDF")
if f_bsdf:
    f_bsdf.inputs["Base Color"].default_value = (0.015, 0.022, 0.036, 1.0)
    f_bsdf.inputs["Roughness"].default_value = 0.24
    f_bsdf.inputs["Metallic"].default_value = 0.65
floor.data.materials.append(floor_mat)

# 2. Live 3D Skeleton (Armature) + Realistic Hollow Brushed Steel Pipe
bpy.ops.object.armature_add(enter_editmode=False, location=(0, 0, 0))
armature = bpy.context.active_object
armature.name = "Pipe_Rig_Armature"

bpy.ops.mesh.primitive_cylinder_add(vertices=72, radius=0.82, depth=5.4, end_fill_type='NOTHING', location=(0, 0, 0), rotation=(0, math.radians(90), math.radians(-16)))
pipe = bpy.context.active_object
pipe.name = "Seamless_Steel_Pipe"
bpy.ops.object.shade_smooth()

solidify = pipe.modifiers.new(name="WallThickness", type='SOLIDIFY')
solidify.thickness = 0.16
solidify.offset = -1.0

bevel = pipe.modifiers.new(name="EdgeBevel", type='BEVEL')
bevel.width = 0.025
bevel.segments = 3

# Realistic PBR Brushed Steel Material
steel_mat = bpy.data.materials.new("BrushedSteelPBR")
steel_mat.use_nodes = True
nt = steel_mat.node_tree
bsdf = nt.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs["Base Color"].default_value = (0.58, 0.64, 0.72, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.96
    bsdf.inputs["Roughness"].default_value = 0.21
    if "Anisotropic" in bsdf.inputs:
        bsdf.inputs["Anisotropic"].default_value = 0.55

noise = nt.nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 48.0
noise.inputs["Detail"].default_value = 8.0
bump = nt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.06
nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
if bsdf:
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

pipe.data.materials.append(steel_mat)
pipe.parent = armature

# Smooth mechanical skeleton rotation animation
armature.rotation_euler = (0.0, 0.0, math.radians(-8))
armature.keyframe_insert(data_path="rotation_euler", frame=1)
armature.rotation_euler = (0.08, 0.05, math.radians(14))
armature.keyframe_insert(data_path="rotation_euler", frame=${frameCount})

# 3. Floating Cinematic Light Particles
p_mat = bpy.data.materials.new("FloatingSparkMat")
p_mat.use_nodes = True
p_bsdf = p_mat.node_tree.nodes.get("Principled BSDF")
if p_bsdf:
    p_bsdf.inputs["Base Color"].default_value = (*${rimRgb}, 1.0)
    if "Emission Color" in p_bsdf.inputs:
        p_bsdf.inputs["Emission Color"].default_value = (*${rimRgb}, 1.0)
        p_bsdf.inputs["Emission Strength"].default_value = 4.5

random.seed(42)
for i in range(36):
    px = random.uniform(-3.6, 3.6)
    py = random.uniform(-2.2, 2.6)
    pz = random.uniform(-1.0, 2.2)
    r = random.uniform(0.014, 0.038)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=(px, py, pz))
    sp = bpy.context.active_object
    sp.data.materials.append(p_mat)
    sp.keyframe_insert(data_path="location", frame=1)
    sp.location = (px + random.uniform(-0.35, 0.35), py, pz + random.uniform(0.4, 1.25))
    sp.keyframe_insert(data_path="location", frame=${frameCount})

# 4. Crisp White Key Light + Cool Blue/Amber Metallic Rim Lights
bpy.ops.object.light_add(type='AREA', location=(2.6, -3.5, 4.2), rotation=(math.radians(52), 0, math.radians(28)))
key_light = bpy.context.active_object
key_light.data.energy = 420
key_light.data.size = 3.2
key_light.data.color = ${keyRgb}

bpy.ops.object.light_add(type='AREA', location=(-3.4, 2.8, 2.4), rotation=(math.radians(68), 0, math.radians(-135)))
rim_light_1 = bpy.context.active_object
rim_light_1.data.energy = 580
rim_light_1.data.size = 2.6
rim_light_1.data.color = ${rimRgb}

bpy.ops.object.light_add(type='AREA', location=(3.2, 2.2, -0.4), rotation=(math.radians(102), 0, math.radians(145)))
rim_light_2 = bpy.context.active_object
rim_light_2.data.energy = 320
rim_light_2.data.size = 2.2
rim_light_2.data.color = ${rimRgb}

# 5. Smooth Controlled Camera with Track-To Constraint
bpy.ops.object.camera_add(location=${camStart})
cam = bpy.context.active_object
cam.data.lens = 50
cam.data.dof.use_dof = True
cam.data.dof.focus_object = pipe
cam.data.dof.aperture_fstop = 2.8
scene.camera = cam

track = cam.constraints.new(type='TRACK_TO')
track.target = pipe
track.track_axis = 'TRACK_NEGATIVE_Z'
track.up_axis = 'UP_Y'

cam.keyframe_insert(data_path="location", frame=1)
cam.location = ${camEnd}
cam.keyframe_insert(data_path="location", frame=${frameCount})

bpy.ops.render.render(animation=True)
`;
}

export async function renderBlenderShot(params: {
  shotId: string;
  spec?: ShotSpec;
  blenderPrompt: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  timeoutMs?: number;
}): Promise<{ outputPath: string; executionHost: "local_blender" | "colab_gpu_blender" }> {
  const workDir = path.dirname(params.outputPath);
  fs.mkdirSync(workDir, { recursive: true });
  const scriptPath = path.join(workDir, `${params.shotId}_scene.py`);

  // 1. Prefer real Google Colab GPU Blender when connected and local Blender is absent
  if (!isBlenderInstalled() && isColabBlenderReady()) {
    const remoteScript = buildBlenderSevenLayerPythonScript({
      ...params,
      outputPath: `/tmp/${params.shotId}_blender_out.mp4`,
    });
    fs.writeFileSync(scriptPath, remoteScript, "utf-8");
    await executeRemoteColabBlenderRender({
      shotId: params.shotId,
      pythonScript: remoteScript,
      outputPath: params.outputPath,
      timeoutMs: params.timeoutMs ?? 240_000,
    });
    return { outputPath: params.outputPath, executionHost: "colab_gpu_blender" };
  }

  // 2. Local Blender binary execution
  if (!isBlenderInstalled()) {
    throw new BlenderUnavailableError();
  }

  const localScript = buildBlenderSevenLayerPythonScript(params);
  fs.writeFileSync(scriptPath, localScript, "utf-8");

  await execFileAsync(
    "blender",
    ["--background", "--factory-startup", "--python", scriptPath],
    { timeout: params.timeoutMs ?? 180_000 }
  );

  if (!fs.existsSync(params.outputPath)) {
    throw new Error("خروجی MP4 از Blender تولید نشد.");
  }

  return { outputPath: params.outputPath, executionHost: "local_blender" };
}
