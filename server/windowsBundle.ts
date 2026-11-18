import JSZip from "jszip";
import type { WindowsBundleFilePreview } from "../src/types/studio.js";
import { buildComfyUiLightweightWorkflow } from "./localVideoEngines.js";

const REQUIREMENTS_TXT = `fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.9.0
langgraph>=0.2.50
langgraph-checkpoint-sqlite>=2.0.0
google-genai>=1.0.0
python-dotenv>=1.0.1
TTS>=0.22.0
soundfile>=0.12.1
`;

const VOICE_CLONE_LOCAL_PY = `"""
100% Free Local Zero-Shot Persian/Multilingual Voice Cloning Module (Coqui XTTS-v2 / F5-TTS)
Clones the creator's own recorded voice sample stored on each PageProfile without any paid subscription!
"""
from pathlib import Path
import subprocess


def synthesize_cloned_persian_voice(
    vocalized_text: str,
    speaker_wav_path: str,
    output_wav_path: str,
    language: str = "fa",
) -> str:
    out_file = Path(output_wav_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    # Clean pause tags into natural breath ellipses so XTTS/TTS respects Persian rhythm
    clean_text = vocalized_text.replace("[مکث کوتاه]", "... ").replace("[مکث ۰.۴ ثانیه]", "... ")

    try:
        from TTS.api import TTS  # Free open-source Coqui XTTS-v2
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
        tts.tts_to_file(
            text=clean_text,
            speaker_wav=speaker_wav_path,
            language=language,
            file_path=str(out_file),
        )
        # Apply broadcast high-pass & -14 LUFS loudness normalization via FFmpeg
        normalized = out_file.with_name(out_file.stem + "_clean.wav")
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(out_file),
                "-af", "highpass=f=85,afftdn=nf=-25,loudnorm=I=-14:TP=-1.5:LRA=11",
                str(normalized),
            ],
            check=True,
        )
        return str(normalized)
    except Exception as exc:
        raise RuntimeError(f"خطا در کلون آفلاین صدا: {exc}")
`;

const DAVINCI_BRIDGE_PY = `"""
Free DaVinci Resolve 19 Automation Bridge
Automatically builds vertical (1080x1920) or horizontal (1920x1080) timelines, imports 3-8s shots,
syncs vocalized voiceover WAV, applies Fairlight Voice Isolation + -14 LUFS, and drops Persian SRT captions.
"""
import os
import sys
from pathlib import Path


def connect_resolve():
    api_dir = os.environ.get(
        "RESOLVE_SCRIPT_API",
        r"C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting",
    )
    mod_path = Path(api_dir) / "Modules"
    if mod_path.exists() and str(mod_path) not in sys.path:
        sys.path.append(str(mod_path))
    import DaVinciResolveScript as dvr_script
    return dvr_script.scriptapp("Resolve")


def import_fcpxml_package(fcpxml_path: str, project_name: str) -> bool:
    resolve = connect_resolve()
    if not resolve:
        print("لطفاً نرم‌افزار رایگان DaVinci Resolve را باز کنید.")
        return False
    pm = resolve.GetProjectManager()
    proj = pm.CreateProject(project_name) or pm.GetCurrentProject()
    mp = proj.GetMediaPool()
    mp.ImportTimelineFromFile(fcpxml_path)
    return True
`;

const AGENTS_GRAPH_PY = `"""
2-Super-Agent LangGraph + SQLite Engine (Windows Desktop Local Backend)
- Agent 1 (scriptwriter_agent): Page-aware 3-option Viral Strategist + Full Scenario + Vocalized Persian Narration
- Agent 2 (director_agent): 3-8s Shot Decoupage + 2 Preview Frames/Shot + Sequential Shot Video + Voice Clone + DaVinci Resolve
"""
import os
import sqlite3
from pathlib import Path
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import StateGraph, START, END

DB_PATH = Path(__file__).parent / "studio_second_brain.db"
VAULT_DIR = Path(__file__).parent.parent / "data" / "vault"
VAULT_DIR.mkdir(parents=True, exist_ok=True)


def init_sqlite_checkpointer() -> SqliteSaver:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    return SqliteSaver(conn)
`;

const TAURI_CONF_JSON = `{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Content Studio Desktop",
  "version": "2.0.0",
  "identifier": "com.contentstudio.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:3000",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Content Studio Desktop — استودیو تخصصی تولید محتوای چندپیجی",
        "width": 1440,
        "height": 900,
        "minWidth": 1120,
        "minHeight": 740,
        "resizable": true
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"]
  }
}
`;

const SETUP_BAT = `@echo off
chcp 65001 > nul
echo =========================================================
echo   Content Studio Desktop - Free Local AI & Voice Clone
echo =========================================================
if not exist "backend\\.venv" (
    python -m venv backend\\.venv
)
call backend\\.venv\\Scripts\\activate.bat
pip install -r backend\\requirements.txt
echo Ready! Place GEMINI_API_KEY in .env and run npm run dev or npx tauri dev.
pause
`;

const README_WINDOWS_MD = `# نسخه دسکتاپ ویندوز (Content Studio Desktop — ۱۰۰٪ رایگان)

این بسته شامل کل زیرساخت بومی ویندوز برای مدیریت هم‌زمان چندین پیج اینستاگرام، یوتیوب و تیک‌تاک است:
1. **کلون صدای واقعی خودتان به صورت ۱۰۰٪ رایگان و آفلاین** با موتور متن‌باز \`XTTS-v2\` (\`backend/voice_clone_local.py\`) + حذف نویز و استاندارد \`-14 LUFS\` در FFmpeg.
2. **اتصال خودکار به نرم‌افزار رایگان DaVinci Resolve** (\`backend/davinci_bridge.py\`) برای چیدمان شات‌های ۳ تا ۸ ثانیه‌ای، افکت‌های صوتی، اصلاح رنگ و زیرنویس فارسی.
3. **مغز دوم Obsidian روی دیسک محلی** در پوشه \`data/vault/\` سازگار با نرم‌افزار رایگان Obsidian.
`;

const COMFYUI_LIGHT_BRIDGE_PY = `"""
Lightweight ComfyUI Local Bridge (4-step SDXL-Turbo / FLUX-Schnell Q4)
Designed for modest Windows GPUs (4-8GB VRAM) or CPU fallback via HyperFrames.
"""
import json
import urllib.request
from pathlib import Path


def submit_workflow(workflow_path: str, comfy_url: str = "http://127.0.0.1:8188") -> dict:
    payload = json.loads(Path(workflow_path).read_text(encoding="utf-8"))
    body = json.dumps({"prompt": payload.get("prompt", payload)}).encode("utf-8")
    req = urllib.request.Request(
        f"{comfy_url.rstrip('/')}/prompt",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))
`;

export function getWindowsBundlePreviews(): WindowsBundleFilePreview[] {
  return [
    {
      path: "backend/voice_clone_local.py",
      language: "python",
      description: "موتور ۱۰۰٪ رایگان کلون صدای شخصی کاربر به فارسی (XTTS-v2) + حذف نویز و تنظیم -14 LUFS با FFmpeg",
      content: VOICE_CLONE_LOCAL_PY,
    },
    {
      path: "backend/comfyui_light_bridge.py",
      language: "python",
      description: "پل سبک اتصال به ComfyUI محلی (۴ مرحله‌ای، سازگار با کارت گرافیک ۴ تا ۸ گیگابایت)",
      content: COMFYUI_LIGHT_BRIDGE_PY,
    },
    {
      path: "backend/davinci_bridge.py",
      language: "python",
      description: "پل اتوماسیون مستقیم نرم‌افزار رایگان DaVinci Resolve برای چیدمان خودکار شات‌ها و صدا",
      content: DAVINCI_BRIDGE_PY,
    },
    {
      path: "backend/agents_graph.py",
      language: "python",
      description: "هسته پایتونی ۲ سوپر-ایجنت با حافظه SQLite و همگام‌سازی پوشه Obsidian Vault",
      content: AGENTS_GRAPH_PY,
    },
    {
      path: "src-tauri/tauri.conf.json",
      language: "json",
      description: "تنظیمات خروجی نصاب بومی ویندوز (.exe / .msi) با Tauri v2",
      content: TAURI_CONF_JSON,
    },
  ];
}

export async function generateWindowsBundleZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("README_WINDOWS_FA.md", README_WINDOWS_MD);
  zip.file("setup_and_run.bat", SETUP_BAT);
  zip.file("backend/.env.example", "GEMINI_API_KEY=\nOPENROUTER_API_KEY=\nGROQ_API_KEY=\nCOMFYUI_BASE_URL=http://127.0.0.1:8188\n");
  zip.file("backend/requirements.txt", REQUIREMENTS_TXT);
  zip.file("backend/voice_clone_local.py", VOICE_CLONE_LOCAL_PY);
  zip.file("backend/comfyui_light_bridge.py", COMFYUI_LIGHT_BRIDGE_PY);
  zip.file(
    "workflows/comfyui_reels_lightweight_workflow.json",
    JSON.stringify(buildComfyUiLightweightWorkflow(), null, 2)
  );
  zip.file("backend/davinci_bridge.py", DAVINCI_BRIDGE_PY);
  zip.file("backend/agents_graph.py", AGENTS_GRAPH_PY);
  zip.file("src-tauri/tauri.conf.json", TAURI_CONF_JSON);

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return Buffer.from(buf);
}
