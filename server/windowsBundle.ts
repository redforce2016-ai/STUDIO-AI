import JSZip from "jszip";
import type { WindowsBundleFilePreview } from "../src/types/studio.js";

const REQUIREMENTS_TXT = `fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.9.0
langgraph>=0.2.50
langgraph-checkpoint-sqlite>=2.0.0
langchain-core>=0.3.15
langchain-google-genai>=2.0.5
google-genai>=1.0.0
python-dotenv>=1.0.1
`;

const GRAPH_STATE_PY = `from typing import TypedDict, Optional, List, Literal
from pydantic import BaseModel, Field


class GroundedSource(BaseModel):
    title: str
    uri: str


class ResearchAndScriptOutput(BaseModel):
    video_title: str = Field(..., description="عنوان نهایی ویدیو به فارسی")
    target_audience_note: str
    research_summary: str
    key_insights: List[str]
    trending_angles: List[str]
    sources: List[GroundedSource] = []
    hook: str = Field(..., description="قلاب ۳ ثانیه اول")
    body: str = Field(..., description="بدنه اصلی سناریو")
    cta: str = Field(..., description="کال تو اکشن پایانی")
    keywords: List[str] = []


class VoiceoverOutput(BaseModel):
    narration_text: str
    voice_name: str = "Kore"
    voice_style: str = "گوینده حرفه‌ای فارسی"
    estimated_seconds: int = 45
    pacing_notes: str = ""
    audio_path: Optional[str] = None


class DirectorShot(BaseModel):
    shot_number: int
    timecode: str
    duration_seconds: int
    camera_angle: str
    camera_movement: str
    scene_description_fa: str
    spoken_segment: str
    on_screen_text: str
    lighting_and_mood: str
    visual_prompt_fa: str


class DirectorOutput(BaseModel):
    visual_direction_summary: str
    total_estimated_seconds: int
    shots: List[DirectorShot]


class VisualAssetShot(BaseModel):
    shot_number: int
    image_path: Optional[str] = None
    motion_cue: str
    color_palette_note: str
    status: Literal["pending", "ready", "error"] = "ready"


class ContentStudioState(TypedDict):
    project_id: str
    title: str
    idea: str
    platform: str
    tone: str
    target_duration_seconds: int
    current_stage: str
    next_action: Literal["approve", "regenerate"]
    feedback: Optional[str]
    research_script: Optional[dict]
    voiceover: Optional[dict]
    director: Optional[dict]
    visuals: Optional[list]
`;

const AGENTS_GRAPH_PY = `import os
import json
import sqlite3
from pathlib import Path
from google import genai
from google.genai import types
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import interrupt

from graph_state import (
    ContentStudioState,
    ResearchAndScriptOutput,
    DirectorOutput,
)

DB_PATH = Path(__file__).parent / "studio_checkpoints.db"
MEDIA_DIR = Path(__file__).parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)


def get_gemini_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is required.")
    return genai.Client(api_key=api_key)


# ---------------------------------------------------------------------------
# Node 1: Merged Researcher + Scriptwriter Agent
# ---------------------------------------------------------------------------
def research_and_script_node(state: ContentStudioState) -> dict:
    client = get_gemini_client()
    feedback = state.get("feedback") or ""

    # Step 1: Grounded Web Search via Gemini Google Search tool
    search_prompt = (
        f"درباره ایده زیر پژوهش جامع انجام بده و آمار و زاویه‌های ترند را به فارسی استخراج کن:\\n"
        f"عنوان: {state['title']}\\nایده: {state['idea']}\\n"
        f"پلتفرم: {state['platform']}\\n"
        f"{f'بازخورد اصلاحی: {feedback}' if feedback else ''}"
    )
    search_res = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=search_prompt,
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())]
        ),
    )
    grounded_notes = search_res.text or ""

    # Step 2: Unified Scriptwriter synthesis with Pydantic structured output
    script_prompt = (
        f"به عنوان ایجنت ادغام‌شده پژوهشگر و سناریونویس، بر اساس یافته‌های زیر سناریوی کامل فارسی بنویس:\\n"
        f"یافته‌های پژوهش:\\n{grounded_notes}\\n\\n"
        f"لحن: {state['tone']} | مدت‌زمان: {state['target_duration_seconds']} ثانیه"
    )
    script_res = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=script_prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ResearchAndScriptOutput,
        ),
    )
    return {
        "current_stage": "research_script",
        "research_script": json.loads(script_res.text),
        "feedback": None,
    }


def checkpoint_1_script_gate(state: ContentStudioState) -> dict:
    decision = interrupt({
        "checkpoint": "checkpoint_1_script",
        "stage": "research_script",
        "data": state["research_script"],
    })
    if decision.get("action") == "regenerate":
        return {"next_action": "regenerate", "feedback": decision.get("feedback")}
    return {
        "next_action": "approve",
        "research_script": decision.get("research_script", state["research_script"]),
    }


# ---------------------------------------------------------------------------
# Node 2: Storyboard (Director Decoupage + Keyframe Generation)
# ---------------------------------------------------------------------------
def storyboard_node(state: ContentStudioState) -> dict:
    client = get_gemini_client()
    script = state["research_script"]
    prompt = (
        f"سناریوی زیر را به شات‌های دقیق دکوپاژ و استوری‌بورد عمودی ۹:۱۶ به فارسی تبدیل کن:\\n"
        f"قلاب: {script['hook']}\\nبدنه: {script['body']}\\nپایان: {script['cta']}"
    )
    res = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=DirectorOutput,
        ),
    )
    director_data = json.loads(res.text)
    assets = []
    for shot in director_data["shots"]:
        img_path = MEDIA_DIR / f"{state['project_id']}_shot_{shot['shot_number']}.png"
        img_res = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=f"Vertical 9:16 cinematic storyboard frame: {shot['visual_prompt_fa']}",
        )
        for part in img_res.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                img_path.write_bytes(part.inline_data.data)
                break
        assets.append({
            "shot_number": shot["shot_number"],
            "image_path": str(img_path),
            "motion_cue": shot["camera_movement"],
            "status": "ready",
        })
    return {
        "current_stage": "storyboard",
        "director": director_data,
        "visuals": assets,
        "feedback": None,
    }


def checkpoint_2_storyboard_gate(state: ContentStudioState) -> dict:
    decision = interrupt({
        "checkpoint": "checkpoint_2_storyboard",
        "stage": "storyboard",
        "data": {"director": state["director"], "visuals": state["visuals"]},
    })
    if decision.get("action") == "regenerate":
        return {"next_action": "regenerate", "feedback": decision.get("feedback")}
    return {
        "next_action": "approve",
        "director": decision.get("director", state["director"]),
    }


# ---------------------------------------------------------------------------
# Node 3: Video Shots Production (Per-Shot Video & 3D Scene Stage)
# ---------------------------------------------------------------------------
def video_shots_node(state: ContentStudioState) -> dict:
    return {
        "current_stage": "video_shots",
        "feedback": None,
    }


def checkpoint_3_video_shots_gate(state: ContentStudioState) -> dict:
    decision = interrupt({
        "checkpoint": "checkpoint_3_video_shots",
        "stage": "video_shots",
        "data": state["visuals"],
    })
    if decision.get("action") == "regenerate":
        return {"next_action": "regenerate", "feedback": decision.get("feedback")}
    return {"next_action": "approve"}


# ---------------------------------------------------------------------------
# Node 4: Voiceover Agent + Gemini TTS WAV Output
# ---------------------------------------------------------------------------
def voiceover_node(state: ContentStudioState) -> dict:
    client = get_gemini_client()
    script = state["research_script"]
    adapt_prompt = (
        f"متن سناریوی زیر را هماهنگ با شات‌های ویدیو برای خوانش نریشن فارسی با نشانگر مکث بازنویسی کن:\\n"
        f"قلاب: {script['hook']}\\nبدنه: {script['body']}\\nپایان: {script['cta']}"
    )
    adapt_res = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=adapt_prompt,
    )
    narration_text = (adapt_res.text or "").strip()

    audio_path = MEDIA_DIR / f"{state['project_id']}_narration.wav"
    tts_res = client.models.generate_content(
        model="gemini-2.5-flash-preview-tts",
        contents=narration_text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
                )
            ),
        ),
    )
    for part in tts_res.candidates[0].content.parts:
        if part.inline_data and part.inline_data.data:
            audio_path.write_bytes(part.inline_data.data)
            break

    return {
        "current_stage": "voiceover",
        "voiceover": {
            "narration_text": narration_text,
            "voice_name": "Kore",
            "estimated_seconds": state["target_duration_seconds"],
            "audio_path": str(audio_path),
        },
        "feedback": None,
    }


def checkpoint_4_voiceover_gate(state: ContentStudioState) -> dict:
    decision = interrupt({
        "checkpoint": "checkpoint_4_voiceover",
        "stage": "voiceover",
        "data": state["voiceover"],
    })
    if decision.get("action") == "regenerate":
        return {"next_action": "regenerate", "feedback": decision.get("feedback")}
    return {
        "next_action": "approve",
        "voiceover": decision.get("voiceover", state["voiceover"]),
    }


# ---------------------------------------------------------------------------
# Node 5: Final Editing, Mixing & Assembly
# ---------------------------------------------------------------------------
def assembly_node(state: ContentStudioState) -> dict:
    return {
        "current_stage": "assembly",
        "feedback": None,
    }


def checkpoint_5_assembly_gate(state: ContentStudioState) -> dict:
    decision = interrupt({
        "checkpoint": "checkpoint_5_assembly",
        "stage": "assembly",
        "data": state["visuals"],
    })
    if decision.get("action") == "regenerate":
        return {"next_action": "regenerate", "feedback": decision.get("feedback")}
    return {"next_action": "approve", "current_stage": "completed"}


def build_studio_graph():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    checkpointer = SqliteSaver(conn)

    builder = StateGraph(ContentStudioState)
    builder.add_node("research_and_script", research_and_script_node)
    builder.add_node("checkpoint_1_script_gate", checkpoint_1_script_gate)
    builder.add_node("storyboard", storyboard_node)
    builder.add_node("checkpoint_2_storyboard_gate", checkpoint_2_storyboard_gate)
    builder.add_node("video_shots", video_shots_node)
    builder.add_node("checkpoint_3_video_shots_gate", checkpoint_3_video_shots_gate)
    builder.add_node("voiceover", voiceover_node)
    builder.add_node("checkpoint_4_voiceover_gate", checkpoint_4_voiceover_gate)
    builder.add_node("assembly", assembly_node)
    builder.add_node("checkpoint_5_assembly_gate", checkpoint_5_assembly_gate)

    builder.add_edge(START, "research_and_script")
    builder.add_edge("research_and_script", "checkpoint_1_script_gate")
    builder.add_conditional_edges(
        "checkpoint_1_script_gate",
        lambda s: "research_and_script" if s.get("next_action") == "regenerate" else "storyboard",
    )
    builder.add_edge("storyboard", "checkpoint_2_storyboard_gate")
    builder.add_conditional_edges(
        "checkpoint_2_storyboard_gate",
        lambda s: "storyboard" if s.get("next_action") == "regenerate" else "video_shots",
    )
    builder.add_edge("video_shots", "checkpoint_3_video_shots_gate")
    builder.add_conditional_edges(
        "checkpoint_3_video_shots_gate",
        lambda s: "video_shots" if s.get("next_action") == "regenerate" else "voiceover",
    )
    builder.add_edge("voiceover", "checkpoint_4_voiceover_gate")
    builder.add_conditional_edges(
        "checkpoint_4_voiceover_gate",
        lambda s: "voiceover" if s.get("next_action") == "regenerate" else "assembly",
    )
    builder.add_edge("assembly", "checkpoint_5_assembly_gate")
    builder.add_conditional_edges(
        "checkpoint_5_assembly_gate",
        lambda s: "assembly" if s.get("next_action") == "regenerate" else END,
    )
    return builder.compile(checkpointer=checkpointer)
`;

const MAIN_PY = `import os
import uuid
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from langgraph.types import Command
from agents_graph import build_studio_graph

load_dotenv()

app = FastAPI(title="Content Studio Desktop — Python LangGraph Engine")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

studio_graph = build_studio_graph()


class StartRequest(BaseModel):
    title: str
    idea: str
    platform: str = "reels"
    tone: str = "educational"
    target_duration_seconds: int = 45


class ResumeRequest(BaseModel):
    thread_id: str
    action: str = "approve"
    feedback: str | None = None
    research_script: dict | None = None
    voiceover: dict | None = None
    director: dict | None = None


@app.post("/api/pipeline/start")
def start_pipeline(req: StartRequest):
    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    thread_id = f"thread_{project_id}"
    config = {"configurable": {"thread_id": thread_id}}
    result = studio_graph.invoke(
        {
            "project_id": project_id,
            "title": req.title,
            "idea": req.idea,
            "platform": req.platform,
            "tone": req.tone,
            "target_duration_seconds": req.target_duration_seconds,
            "current_stage": "research_script",
        },
        config=config,
    )
    return {"project_id": project_id, "thread_id": thread_id, "state": result}


@app.post("/api/pipeline/resume")
def resume_pipeline(req: ResumeRequest):
    config = {"configurable": {"thread_id": req.thread_id}}
    result = studio_graph.invoke(
        Command(
            resume={
                "action": req.action,
                "feedback": req.feedback,
                "research_script": req.research_script,
                "voiceover": req.voiceover,
                "director": req.director,
            }
        ),
        config=config,
    )
    return {"thread_id": req.thread_id, "state": result}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
`;

const TAURI_CONF_JSON = `{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Content Studio Desktop",
  "version": "1.0.0",
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
        "title": "Content Studio Desktop — استودیو هوشمند تولید محتوا",
        "width": 1440,
        "height": 900,
        "minWidth": 1100,
        "minHeight": 720,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"],
    "windows": {
      "webviewInstallMode": {
        "type": "downloadBootstrapper"
      }
    }
  }
}
`;

const CARGO_TOML = `[package]
name = "content-studio-desktop"
version = "1.0.0"
description = "Content Studio Desktop Windows App with Python LangGraph Engine"
authors = ["Content Studio"]
edition = "2021"

[build-dependencies]
tauri-build = { version = "2.0", features = [] }

[dependencies]
tauri = { version = "2.0", features = [] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
`;

const MAIN_RS = `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;

fn main() {
    // Spawn local Python FastAPI + LangGraph engine on Windows startup
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("python")
            .args(["backend/main.py"])
            .spawn();
    }

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Content Studio Desktop");
}
`;

const SETUP_BAT = `@echo off
chcp 65001 > nul
echo ===================================================
echo   Content Studio Desktop - Windows Setup & Launch
echo ===================================================
echo.
if not exist "backend\\.venv" (
    echo [1/3] Creating Python virtual environment...
    python -m venv backend\\.venv
)
echo [2/3] Installing Python LangGraph dependencies...
call backend\\.venv\\Scripts\\activate.bat
pip install -r backend\\requirements.txt
echo [3/3] Starting Python FastAPI + LangGraph Engine on port 8765...
start "LangGraph Backend" cmd /k "cd backend && .venv\\Scripts\\python.exe main.py"
echo.
echo Backend running! Now launch Tauri dev or built EXE.
pause
`;

const BUILD_EXE_BAT = `@echo off
chcp 65001 > nul
echo ===================================================
echo   Building Native Windows Installer (.exe / .msi)
echo ===================================================
call npm install
call npx tauri build --target x86_64-pc-windows-msvc
echo.
echo Build complete! Output files located in:
echo   src-tauri\\target\\release\\bundle\\nsis\\Content Studio Desktop_1.0.0_x64-setup.exe
echo   src-tauri\\target\\release\\bundle\\msi\\Content Studio Desktop_1.0.0_x64_en-US.msi
pause
`;

const README_WINDOWS_MD = `# راهنمای نصب و ساخت نسخه بومی ویندوز (Content Studio Desktop)

این بسته شامل معماری کامل دسکتاپ ویندوزی **Tauri v2 + Python LangGraph + SQLite Checkpointer** مطابق سند مشخصات محصول است.

## پیش‌نیازهای سیستم ویندوز
1. **Python 3.11+** (با تیک Add to PATH)
2. **Node.js 20+**
3. **Rust & Cargo** (برای کامپایل Tauri از rustup.rs)
4. فایل \`.env\` در پوشه \`backend/\` حاوی کلید \`GEMINI_API_KEY=YOUR_KEY\`

## اجرای سریع در حالت توسعه روی ویندوز
1. فایل \`setup_and_run.bat\` را اجرا کنید تا محیط مجازی پایتون ساخته شده و هسته **FastAPI + LangGraph + SqliteSaver** روی پورت \`8765\` فعال شود.
2. دستور \`npx tauri dev\` را اجرا کنید تا پنجره دسکتاپ ویندوز باز شود.

## ساخت فایل نصاب ویندوز (.EXE و .MSI)
فایل \`build_windows_exe.bat\` را اجرا کنید تا خروجی نهایی نصاب ویندوز در مسیر زیر ساخته شود:
- \`src-tauri/target/release/bundle/nsis/Content Studio Desktop_1.0.0_x64-setup.exe\`
- \`src-tauri/target/release/bundle/msi/Content Studio Desktop_1.0.0_x64_en-US.msi\`
`;

export function getWindowsBundlePreviews(): WindowsBundleFilePreview[] {
  return [
    {
      path: "backend/agents_graph.py",
      language: "python",
      description: "گراف اصلی LangGraph به زبان Python با گره ادغام‌شده پژوهشگر+سناریونویس، SqliteSaver و ۴ ایستگاه interrupt",
      content: AGENTS_GRAPH_PY,
    },
    {
      path: "backend/graph_state.py",
      language: "python",
      description: "مدل‌های Pydantic v2 و ساختار State اشتراکی بین ایجنت‌ها",
      content: GRAPH_STATE_PY,
    },
    {
      path: "backend/main.py",
      language: "python",
      description: "سرور محلی FastAPI برای ارتباط رابط کاربری Tauri با پایپ‌لاین LangGraph",
      content: MAIN_PY,
    },
    {
      path: "src-tauri/src/main.rs",
      language: "rust",
      description: "نقطه ورود پوسته دسکتاپ Tauri v2 و راه‌انداز خودکار موتور پایتون در ویندوز",
      content: MAIN_RS,
    },
    {
      path: "src-tauri/tauri.conf.json",
      language: "json",
      description: "پیکربندی پنجره دسکتاپ و خروجی نصاب .exe / .msi ویندوز",
      content: TAURI_CONF_JSON,
    },
    {
      path: "build_windows_exe.bat",
      language: "batch",
      description: "اسکریپت یک‌کلیک ساخت فایل نصاب ویندوز در سیستم محلی",
      content: BUILD_EXE_BAT,
    },
  ];
}

export async function generateWindowsBundleZip(): Promise<Buffer> {
  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  const zip = new JSZip();
  zip.file("README_WINDOWS.md", README_WINDOWS_MD);
  zip.file("setup_and_run.bat", SETUP_BAT);
  zip.file("build_windows_exe.bat", BUILD_EXE_BAT);
  zip.file("backend/.env.example", "GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE\n");
  zip.file("backend/requirements.txt", REQUIREMENTS_TXT);
  zip.file("backend/graph_state.py", GRAPH_STATE_PY);
  zip.file("backend/agents_graph.py", AGENTS_GRAPH_PY);
  zip.file("backend/main.py", MAIN_PY);
  zip.file("src-tauri/Cargo.toml", CARGO_TOML);
  zip.file("src-tauri/tauri.conf.json", TAURI_CONF_JSON);
  zip.file("src-tauri/build.rs", "fn main() {\n    tauri_build::build()\n}\n");
  zip.file("src-tauri/src/main.rs", MAIN_RS);

  const extraFiles = [
    "config.yaml",
    "install_comfyui_models.ps1",
    "install_comfyui_models.sh",
    "server/video/workflows/wan22_5b_gguf_i2v_api.json",
    "server/video/workflows/ltx23_fp8_i2v_api.json",
  ];
  for (const rel of extraFiles) {
    const abs = pathMod.resolve(process.cwd(), rel);
    if (fsMod.existsSync(abs)) {
      zip.file(rel, fsMod.readFileSync(abs, "utf-8"));
    }
  }

  const arrayBuffer = await zip.generateAsync({ type: "nodebuffer" });
  return Buffer.from(arrayBuffer);
}
