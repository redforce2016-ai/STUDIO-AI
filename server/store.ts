import fs from "node:fs";
import path from "node:path";
import type { ProjectBrief, ProjectRecord, StudioMediaAsset } from "../src/types/studio.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const VISUALS_DIR = path.join(DATA_DIR, "visuals");
const IMAGES_DIR = path.join(DATA_DIR, "images");
const VIDEOS_DIR = path.join(DATA_DIR, "videos");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const ASSETS_FILE = path.join(DATA_DIR, "studio_assets.json");

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
  if (!fs.existsSync(VISUALS_DIR)) fs.mkdirSync(VISUALS_DIR, { recursive: true });
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
  if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify([], null, 2), "utf-8");
  }
  if (!fs.existsSync(ASSETS_FILE)) {
    fs.writeFileSync(ASSETS_FILE, JSON.stringify([], null, 2), "utf-8");
  }
}

export function getAudioDir(): string {
  ensureDirs();
  return AUDIO_DIR;
}

export function getVisualsDir(): string {
  ensureDirs();
  return VISUALS_DIR;
}

export function getImagesDir(): string {
  ensureDirs();
  return IMAGES_DIR;
}

export function getVideosDir(): string {
  ensureDirs();
  return VIDEOS_DIR;
}

export function listProjects(): ProjectRecord[] {
  ensureDirs();
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as ProjectRecord[];
    return parsed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch {
    return [];
  }
}

export function getProject(id: string): ProjectRecord | null {
  const all = listProjects();
  return all.find((p) => p.id === id) ?? null;
}

export function saveProject(project: ProjectRecord): ProjectRecord {
  ensureDirs();
  const all = listProjects();
  const updated = { ...project, updatedAt: new Date().toISOString() };
  const idx = all.findIndex((p) => p.id === project.id);
  if (idx >= 0) {
    all[idx] = updated;
  } else {
    all.unshift(updated);
  }
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(all, null, 2), "utf-8");
  return updated;
}

export function createProject(brief: ProjectBrief): ProjectRecord {
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const project: ProjectRecord = {
    id,
    threadId: `thread_${id}`,
    createdAt: now,
    updatedAt: now,
    brief,
    currentStage: "input",
    checkpointStatus: "idle",
    waitingNode: null,
    errorMessage: null,
    researchScript: null,
    voiceover: null,
    director: null,
    visuals: null,
    logs: [],
  };
  return saveProject(project);
}

export function deleteProject(id: string): boolean {
  ensureDirs();
  const all = listProjects();
  const filtered = all.filter((p) => p.id !== id);
  if (filtered.length === all.length) return false;
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(filtered, null, 2), "utf-8");
  return true;
}

export function saveAudioFile(filename: string, buffer: Buffer): string {
  ensureDirs();
  const safeName = path.basename(filename);
  const fullPath = path.join(AUDIO_DIR, safeName);
  fs.writeFileSync(fullPath, buffer);
  return `/api/media/audio/${safeName}`;
}

export function saveVisualSvgFile(filename: string, svgContent: string): string {
  ensureDirs();
  const safeName = path.basename(filename);
  const fullPath = path.join(VISUALS_DIR, safeName);
  fs.writeFileSync(fullPath, svgContent, "utf-8");
  return `/api/media/visuals/${safeName}`;
}

export function saveImageFile(filename: string, buffer: Buffer): string {
  ensureDirs();
  const safeName = path.basename(filename);
  const fullPath = path.join(IMAGES_DIR, safeName);
  fs.writeFileSync(fullPath, buffer);
  return `/api/media/images/${safeName}`;
}

export function saveVideoFile(filename: string, buffer: Buffer): string {
  ensureDirs();
  const safeName = path.basename(filename);
  const fullPath = path.join(VIDEOS_DIR, safeName);
  fs.writeFileSync(fullPath, buffer);
  return `/api/media/videos/${safeName}`;
}

export function listStudioAssets(): StudioMediaAsset[] {
  ensureDirs();
  try {
    const raw = fs.readFileSync(ASSETS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as StudioMediaAsset[];
    return parsed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function saveStudioAsset(asset: StudioMediaAsset): StudioMediaAsset {
  ensureDirs();
  const all = listStudioAssets();
  const idx = all.findIndex((a) => a.id === asset.id);
  if (idx >= 0) {
    all[idx] = asset;
  } else {
    all.unshift(asset);
  }
  fs.writeFileSync(ASSETS_FILE, JSON.stringify(all, null, 2), "utf-8");
  return asset;
}

export function deleteStudioAsset(id: string): boolean {
  ensureDirs();
  const all = listStudioAssets();
  const filtered = all.filter((a) => a.id !== id);
  if (filtered.length === all.length) return false;
  fs.writeFileSync(ASSETS_FILE, JSON.stringify(filtered, null, 2), "utf-8");
  return true;
}
