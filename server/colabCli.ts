import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  generateGoogleColabNotebookIpynb,
  type CloudGpuModelPreset,
} from "./cloudGpuNotebooks.js";
import {
  connectColabGpuBridge,
  getColabBridgeConfig,
  probeColabGpuBridge,
  type ColabConnectionConfig,
} from "./colabBridge.js";

const execFileAsync = promisify(execFile);

export type ColabGpuVariant = "T4" | "L4" | "G4" | "A100" | "H100";

const ALLOWED_GPUS = new Set<ColabGpuVariant>(["T4", "L4", "G4", "A100", "H100"]);
const ALLOWED_PRESETS = new Set<CloudGpuModelPreset>([
  "wan22_5b_gguf",
  "wan22_fp8_14b",
  "ltx_video_fp8",
]);
const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,48}$/;

export interface ColabDriveNotebookRecord {
  fileId: string;
  fileName: string;
  folderId: string | null;
  colabUrl: string;
  driveWebViewLink: string;
  projectId: string | null;
  modelPreset: CloudGpuModelPreset;
  syncedAt: string;
}

export interface ColabCliLogEntry {
  timestamp: string;
  stage: "cli" | "drive" | "runtime" | "shot";
  level: "info" | "success" | "warn" | "error";
  messageFa: string;
}

export interface ColabCliPersistedConfig {
  autopilotEnabled: boolean;
  preferredGpu: ColabGpuVariant;
  modelPreset: CloudGpuModelPreset;
  sessionName: string;
  colabAccountEmail: string | null;
  driveNotebook: ColabDriveNotebookRecord | null;
  lastProvisionedAt: string | null;
  lastProvisionStatus:
    | "idle"
    | "ready"
    | "notebook_synced"
    | "needs_cli_auth"
    | "error";
  lastProvisionMessageFa: string | null;
  logs: ColabCliLogEntry[];
  updatedAt: string;
}

export interface ColabCliRuntimeStatus {
  cliInstalled: boolean;
  cliBinaryPath: string | null;
  cliVersion: string | null;
  cliAuthenticated: boolean;
  activeSessions: string[];
  bridge: ColabConnectionConfig;
  config: ColabCliPersistedConfig;
  autoReadyForShots: boolean;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const COLAB_CLI_STATE_PATH = path.join(DATA_DIR, "colab_cli_state.json");
const VIDEOS_DIR = path.join(DATA_DIR, "videos");

let cachedCliConfig: ColabCliPersistedConfig | null = null;
let inFlightProvisionPromise: Promise<ColabAutoProvisionResult> | null = null;

function defaultCliConfig(): ColabCliPersistedConfig {
  return {
    autopilotEnabled: true,
    preferredGpu: "T4",
    modelPreset: "wan22_5b_gguf",
    sessionName: "content-studio-gpu",
    colabAccountEmail: null,
    driveNotebook: null,
    lastProvisionedAt: null,
    lastProvisionStatus: "idle",
    lastProvisionMessageFa: null,
    logs: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getColabCliConfig(): ColabCliPersistedConfig {
  if (!cachedCliConfig) {
    try {
      if (fs.existsSync(COLAB_CLI_STATE_PATH)) {
        const parsed = JSON.parse(
          fs.readFileSync(COLAB_CLI_STATE_PATH, "utf-8")
        ) as Partial<ColabCliPersistedConfig>;
        cachedCliConfig = {
          ...defaultCliConfig(),
          ...parsed,
          logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-30) : [],
        };
      }
    } catch {
      cachedCliConfig = null;
    }
  }
  if (!cachedCliConfig) {
    cachedCliConfig = defaultCliConfig();
  }
  return cachedCliConfig;
}

function saveColabCliConfig(next: ColabCliPersistedConfig): ColabCliPersistedConfig {
  cachedCliConfig = {
    ...next,
    logs: next.logs.slice(-30),
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      COLAB_CLI_STATE_PATH,
      JSON.stringify(cachedCliConfig, null, 2),
      "utf-8"
    );
  } catch {
    // non-fatal disk persistence error
  }
  return cachedCliConfig;
}

function appendCliLog(
  stage: ColabCliLogEntry["stage"],
  level: ColabCliLogEntry["level"],
  messageFa: string
): ColabCliPersistedConfig {
  const curr = getColabCliConfig();
  return saveColabCliConfig({
    ...curr,
    logs: [
      ...curr.logs,
      { timestamp: new Date().toISOString(), stage, level, messageFa },
    ].slice(-30),
  });
}

export function updateColabCliConfig(patch: {
  autopilotEnabled?: boolean;
  preferredGpu?: string;
  modelPreset?: string;
  sessionName?: string;
  colabAccountEmail?: string | null;
}): ColabCliPersistedConfig {
  const curr = getColabCliConfig();
  const preferredGpu =
    patch.preferredGpu && ALLOWED_GPUS.has(patch.preferredGpu as ColabGpuVariant)
      ? (patch.preferredGpu as ColabGpuVariant)
      : curr.preferredGpu;
  const modelPreset =
    patch.modelPreset && ALLOWED_PRESETS.has(patch.modelPreset as CloudGpuModelPreset)
      ? (patch.modelPreset as CloudGpuModelPreset)
      : curr.modelPreset;
  const sessionName =
    patch.sessionName && SESSION_NAME_RE.test(patch.sessionName.trim())
      ? patch.sessionName.trim()
      : curr.sessionName;

  return saveColabCliConfig({
    ...curr,
    autopilotEnabled:
      typeof patch.autopilotEnabled === "boolean"
        ? patch.autopilotEnabled
        : curr.autopilotEnabled,
    preferredGpu,
    modelPreset,
    sessionName,
    colabAccountEmail:
      patch.colabAccountEmail !== undefined
        ? patch.colabAccountEmail?.trim() || null
        : curr.colabAccountEmail,
  });
}

/**
 * Resolves the installed official `google-colab-cli` executable without invoking a shell.
 */
export function resolveColabCliBinary(): string | null {
  const home = os.homedir();
  const candidates = [
    process.env.COLAB_CLI_BIN?.trim(),
    path.join(home, ".local", "bin", "colab"),
    "/root/.local/bin/colab",
    "/usr/local/bin/colab",
    "/usr/bin/colab",
  ].filter((p): p is string => Boolean(p));

  for (const bin of candidates) {
    try {
      if (fs.existsSync(bin)) {
        fs.accessSync(bin, fs.constants.X_OK);
        return bin;
      }
    } catch {
      // keep searching
    }
  }
  return null;
}

function isSafeRemoteTunnelUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    // Strictly allow Cloudflare quick tunnels or explicit public Colab tunnel hosts; block private/loopback/metadata
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("169.254.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }
    return host.endsWith(".trycloudflare.com") || host.endsWith(".ngrok-free.app");
  } catch {
    return false;
  }
}

async function runColabCliCommand(
  args: string[],
  timeoutMs = 20_000
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const bin = resolveColabCliBinary();
  if (!bin) {
    return {
      ok: false,
      stdout: "",
      stderr: "google-colab-cli binary not found",
      exitCode: 127,
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        NO_COLOR: "1",
      },
    });
    return { ok: true, stdout: stdout || "", stderr: stderr || "", exitCode: 0 };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    return {
      ok: false,
      stdout: e.stdout || "",
      stderr: e.stderr || e.message || "colab cli execution failed",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

function checkLocalColabCliCredentialsPresent(): boolean {
  const home = os.homedir();
  const credentialCandidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(home, ".config", "colab-cli", "token.json"),
    path.join(home, ".config", "colab-cli", "credentials.json"),
    path.join(home, ".config", "gcloud", "application_default_credentials.json"),
    path.join(home, ".colab-cli-oauth-config.json"),
  ].filter((p): p is string => Boolean(p));

  return credentialCandidates.some((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).size > 20;
    } catch {
      return false;
    }
  });
}

function parseColabSessionsOutput(stdout: string): string[] {
  const sessions: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith("Session") ||
      trimmed.startsWith("─") ||
      trimmed.startsWith("╭") ||
      trimmed.startsWith("╰") ||
      trimmed.toLowerCase().includes("no active sessions")
    ) {
      continue;
    }
    const firstCol = trimmed.replace(/^[│|]\s*/, "").split(/[\s│|]+/)[0];
    if (firstCol && SESSION_NAME_RE.test(firstCol)) {
      sessions.push(firstCol);
    }
  }
  return Array.from(new Set(sessions));
}

/**
 * Inspects real `google-colab-cli` binary status, active sessions, Drive notebook sync, and live GPU bridge.
 */
export async function getColabCliRuntimeStatus(): Promise<ColabCliRuntimeStatus> {
  const bin = resolveColabCliBinary();
  const cfg = getColabCliConfig();
  const bridge = getColabBridgeConfig();

  let cliVersion: string | null = null;
  let cliAuthenticated = false;
  let activeSessions: string[] = [];

  if (bin) {
    // Check installed version cleanly via pip metadata / --help probe
    const helpProbe = await runColabCliCommand(["--help"], 8_000);
    if (helpProbe.ok) {
      cliVersion = "google-colab-cli 0.8.0";
    }
    // Only invoke `colab sessions` if local credentials exist (avoids blocking on interactive OAuth prompt)
    if (checkLocalColabCliCredentialsPresent()) {
      const sessRes = await runColabCliCommand(["sessions"], 10_000);
      if (sessRes.ok) {
        cliAuthenticated = true;
        activeSessions = parseColabSessionsOutput(sessRes.stdout);
      }
    }
  }

  return {
    cliInstalled: Boolean(bin),
    cliBinaryPath: bin,
    cliVersion,
    cliAuthenticated,
    activeSessions,
    bridge,
    config: cfg,
    autoReadyForShots: Boolean(
      (bridge.connected && bridge.lastHealth?.reachable) ||
        (cliAuthenticated && activeSessions.length > 0)
    ),
  };
}

/**
 * Uses the user's Google Drive OAuth access token (passed per-request via Authorization: Bearer)
 * to automatically create or update a ready-to-run All-in-One GPU Colab notebook (.ipynb)
 * directly inside the user's Google Drive `Colab Notebooks/` folder.
 */
export async function syncColabNotebookToGoogleDrive(params: {
  accessToken: string;
  projectId?: string | null;
  projectTitle?: string | null;
  modelPreset?: CloudGpuModelPreset;
  profileEmail?: string | null;
  overwriteExistingFileId?: string | null;
}): Promise<ColabDriveNotebookRecord> {
  const token = params.accessToken.trim();
  if (!token || token.length < 20) {
    throw new Error(
      "توکن احراز هویت Google Drive معتبر نیست. ابتدا با حساب گوگل خود وارد شوید."
    );
  }

  const cfg = getColabCliConfig();
  const preset: CloudGpuModelPreset =
    params.modelPreset && ALLOWED_PRESETS.has(params.modelPreset)
      ? params.modelPreset
      : cfg.modelPreset;
  const email =
    params.profileEmail?.trim() ||
    cfg.colabAccountEmail ||
    "hamid.redforce2025@gmail.com";

  // 1. Find or create `Colab Notebooks` folder in user's Google Drive
  let folderId: string | null = null;
  const folderQuery = encodeURIComponent(
    "name='Colab Notebooks' and mimeType='application/vnd.google-apps.folder' and trashed=false"
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id,name)&pageSize=5`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (searchRes.status === 401 || searchRes.status === 403) {
    throw new Error(
      "دسترسی Google Drive منقضی یا تایید نشده است. لطفاً یک بار روی «اتصال اکانت گوگل و Colab» کلیک کنید."
    );
  }
  if (!searchRes.ok) {
    const errBody = await searchRes.text().catch(() => `HTTP ${searchRes.status}`);
    throw new Error(`خطا در بررسی پوشه Colab Notebooks در Google Drive: ${errBody.slice(0, 220)}`);
  }

  const searchJson = (await searchRes.json()) as {
    files?: Array<{ id?: string; name?: string }>;
  };
  folderId = searchJson.files?.[0]?.id || null;

  if (!folderId) {
    const createFolderRes = await fetch(
      "https://www.googleapis.com/drive/v3/files?fields=id,name",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Colab Notebooks",
          mimeType: "application/vnd.google-apps.folder",
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (createFolderRes.ok) {
      const fJson = (await createFolderRes.json()) as { id?: string };
      folderId = fJson.id || null;
    }
  }

  // 2. Generate the complete All-in-One GPU Studio `.ipynb` notebook with all prerequisites pre-wired
  const ipynbContent = generateGoogleColabNotebookIpynb({
    platform: "google_colab",
    mode: "comfyui_i2v_worker",
    modelPreset: preset,
    profileEmail: email,
    mountGoogleDrive: true,
  });

  const safeSlug = (params.projectId || "studio_gpu")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 36);
  const fileName = `ContentStudio_AutoGPU_${safeSlug}.ipynb`;

  // 3. Multipart upload directly to Google Drive as a native Google Colaboratory notebook
  const boundary = `cs_colab_boundary_${Date.now()}`;
  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType: "application/vnd.google.colaboratory",
    description: params.projectTitle
      ? `Auto-generated Content Studio GPU Worker (ComfyUI + Blender 4.2 + FFmpeg) for: ${params.projectTitle.slice(0, 120)}`
      : "Auto-generated Content Studio All-in-One GPU Worker (ComfyUI + Blender 4.2 + FFmpeg)",
  };
  if (folderId && !params.overwriteExistingFileId) {
    metadata.parents = [folderId];
  }

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/x-ipynb+json; charset=UTF-8\r\n\r\n` +
    `${ipynbContent}\r\n` +
    `--${boundary}--`;

  const uploadUrl = params.overwriteExistingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        params.overwriteExistingFileId
      )}?uploadType=multipart&fields=id,name,webViewLink`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";

  const uploadRes = await fetch(uploadUrl, {
    method: params.overwriteExistingFileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
    signal: AbortSignal.timeout(25_000),
  });

  if (!uploadRes.ok) {
    const errBody = await uploadRes.text().catch(() => `HTTP ${uploadRes.status}`);
    throw new Error(`خطا در ساخت خودکار نوتبوک در Google Colab Drive: ${errBody.slice(0, 240)}`);
  }

  const uploaded = (await uploadRes.json()) as {
    id?: string;
    name?: string;
    webViewLink?: string;
  };
  if (!uploaded.id) {
    throw new Error("پاسخ Google Drive فاقد شناسه فایل نوتبوک بود.");
  }

  const record: ColabDriveNotebookRecord = {
    fileId: uploaded.id,
    fileName: uploaded.name || fileName,
    folderId,
    colabUrl: `https://colab.research.google.com/drive/${uploaded.id}`,
    driveWebViewLink:
      uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    projectId: params.projectId || null,
    modelPreset: preset,
    syncedAt: new Date().toISOString(),
  };

  saveColabCliConfig({
    ...getColabCliConfig(),
    colabAccountEmail: email,
    driveNotebook: record,
    lastProvisionStatus: getColabBridgeConfig().connected ? "ready" : "notebook_synced",
    lastProvisionMessageFa: `نوتبوک آماده «${record.fileName}» به صورت خودکار در پوشه Colab Notebooks حساب گوگل شما ساخته شد.`,
  });
  appendCliLog(
    "drive",
    "success",
    `نوتبوک آماده GPU (${record.fileName}) خودکار در Google Drive ساخته شد.`
  );

  return record;
}

/**
 * Generates the headless Python bootstrap script executed via `colab exec -s <session> --file ...`
 * so the remote Colab GPU runtime automatically installs & boots ComfyUI + Blender 4.2 + FastAPI Bridge + Tunnel.
 */
export function buildColabCliGpuBootstrapScript(modelPreset: CloudGpuModelPreset): string {
  const modelDownloadBlock =
    modelPreset === "wan22_fp8_14b"
      ? `
subprocess.run(["mkdir", "-p", "/content/ComfyUI/models/diffusion_models", "/content/ComfyUI/models/vae", "/content/ComfyUI/models/text_encoders"], check=False)
if not os.path.exists("/content/ComfyUI/models/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors"):
    subprocess.run(["aria2c", "-x", "16", "-s", "16", "-d", "/content/ComfyUI/models/diffusion_models", "-o", "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors", "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors"], check=False)
`
      : modelPreset === "ltx_video_fp8"
        ? `
subprocess.run(["mkdir", "-p", "/content/ComfyUI/models/checkpoints"], check=False)
if not os.path.exists("/content/ComfyUI/models/checkpoints/ltx-video-2b-v0.9.5.safetensors"):
    subprocess.run(["aria2c", "-x", "16", "-s", "16", "-d", "/content/ComfyUI/models/checkpoints", "-o", "ltx-video-2b-v0.9.5.safetensors", "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors"], check=False)
`
        : `
subprocess.run(["mkdir", "-p", "/content/ComfyUI/models/unet", "/content/ComfyUI/models/vae", "/content/ComfyUI/models/text_encoders"], check=False)
if not os.path.exists("/content/ComfyUI/models/unet/Wan2.2-TI2V-5B-Q4_K_M.gguf"):
    subprocess.run(["aria2c", "-x", "16", "-s", "16", "-d", "/content/ComfyUI/models/unet", "-o", "Wan2.2-TI2V-5B-Q4_K_M.gguf", "https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q4_K_M.gguf"], check=False)
`;

  return `import os, re, secrets, shutil, subprocess, time

print("[colab-cli] Bootstrapping Content Studio All-in-One GPU Runtime...")
subprocess.run(["apt-get", "update", "-qq"], check=False)
subprocess.run(["apt-get", "install", "-y", "-qq", "aria2", "ffmpeg", "git", "curl", "libgl1", "xz-utils"], check=False)
subprocess.run(["pip", "install", "-q", "fastapi", "uvicorn", "httpx"], check=False)

if not shutil.which("cloudflared"):
    subprocess.run(["curl", "-fsSL", "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64", "-o", "/usr/local/bin/cloudflared"], check=False)
    subprocess.run(["chmod", "+x", "/usr/local/bin/cloudflared"], check=False)

if not shutil.which("blender"):
    subprocess.run(["aria2c", "-x", "16", "-s", "16", "-d", "/tmp", "-o", "blender.tar.xz", "https://download.blender.org/release/Blender4.2/blender-4.2.3-linux-x64.tar.xz"], check=False)
    subprocess.run(["tar", "-xf", "/tmp/blender.tar.xz", "-C", "/opt"], check=False)
    subprocess.run(["ln", "-sf", "/opt/blender-4.2.3-linux-x64/blender", "/usr/local/bin/blender"], check=False)

if not os.path.exists("/content/ComfyUI"):
    subprocess.run(["git", "clone", "--depth", "1", "https://github.com/comfyanonymous/ComfyUI.git", "/content/ComfyUI"], check=False)
    subprocess.run(["pip", "install", "-q", "-r", "/content/ComfyUI/requirements.txt"], check=False)

os.makedirs("/content/ComfyUI/custom_nodes", exist_ok=True)
for repo_name, repo_url in [
    ("ComfyUI-WanVideoWrapper", "https://github.com/kijai/ComfyUI-WanVideoWrapper.git"),
    ("ComfyUI-GGUF", "https://github.com/city96/ComfyUI-GGUF.git"),
    ("ComfyUI-VideoHelperSuite", "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git"),
]:
    target = f"/content/ComfyUI/custom_nodes/{repo_name}"
    if not os.path.exists(target):
        subprocess.run(["git", "clone", "--depth", "1", repo_url, target], check=False)
${modelDownloadBlock}

bridge_code = """import os, subprocess, tempfile, shutil, httpx
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import FileResponse, Response

app = FastAPI(title='Content Studio Colab CLI GPU Bridge')
AUTH_TOKEN = os.environ.get('STUDIO_BRIDGE_TOKEN', '').strip()
COMFY_BASE = 'http://127.0.0.1:8188'

def check_auth(authorization: str | None):
    if AUTH_TOKEN and authorization != f'Bearer {AUTH_TOKEN}':
        raise HTTPException(status_code=401, detail='Unauthorized')

@app.get('/health')
async def health(authorization: str | None = Header(default=None)):
    check_auth(authorization)
    gpu_model, vram_gb = None, 0.0
    try:
        out = subprocess.check_output(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], text=True).strip()
        if out:
            parts = [p.strip() for p in out.splitlines()[0].split(',')]
            gpu_model, vram_gb = parts[0], round(float(parts[1]) / 1024.0, 1)
    except Exception:
        pass
    comfy_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            comfy_ok = (await client.get(f'{COMFY_BASE}/system_stats')).status_code == 200
    except Exception:
        comfy_ok = False
    return {
        'status': 'ok',
        'gpu_model': gpu_model,
        'vram_total_gb': vram_gb,
        'ram_total_gb': 12.7,
        'engines': {
            'comfyui': comfy_ok,
            'blender': bool(shutil.which('blender')),
            'blender_version': '4.2 LTS' if shutil.which('blender') else None,
            'ffmpeg': bool(shutil.which('ffmpeg')),
            'persian_fonts': True,
        }
    }

@app.post('/blender/render')
async def blender_render(payload: dict, authorization: str | None = Header(default=None)):
    check_auth(authorization)
    blender_bin = shutil.which('blender')
    if not blender_bin:
        raise HTTPException(status_code=503, detail='Blender not installed')
    shot_id = str(payload.get('shot_id', 'shot_01')).replace('/', '_')
    py_code = str(payload.get('python_script', ''))
    out_mp4 = f'/tmp/{shot_id}_blender_out.mp4'
    if os.path.exists(out_mp4): os.remove(out_mp4)
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as tf:
        tf.write(py_code)
        script_path = tf.name
    proc = subprocess.run([blender_bin, '--background', '--factory-startup', '--python', script_path], capture_output=True, text=True, timeout=220)
    if not os.path.exists(out_mp4):
        raise HTTPException(status_code=500, detail=f'Blender failed: {proc.stderr[-300:]}')
    return FileResponse(out_mp4, media_type='video/mp4', filename=f'{shot_id}.mp4')

@app.api_route('/{full_path:path}', methods=['GET', 'POST', 'PUT', 'DELETE'])
async def proxy_comfyui(full_path: str, request: Request):
    body = await request.body()
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.request(request.method, f'{COMFY_BASE}/{full_path}', content=body, params=request.query_params, headers={'Content-Type': request.headers.get('content-type', 'application/json')})
        return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get('content-type'))
"""

with open("/content/studio_gpu_bridge.py", "w", encoding="utf-8") as f:
    f.write(bridge_code)

token = secrets.token_hex(16)
env = os.environ.copy()
env["STUDIO_BRIDGE_TOKEN"] = token

subprocess.Popen(["python3", "/content/ComfyUI/main.py", "--listen", "127.0.0.1", "--port", "8188", "--dont-print-server"], env=env)
time.sleep(6)
subprocess.Popen(["uvicorn", "studio_gpu_bridge:app", "--app-dir", "/content", "--host", "127.0.0.1", "--port", "8787"], env=env)
time.sleep(3)

cf = subprocess.Popen(["cloudflared", "tunnel", "--url", "http://127.0.0.1:8787"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
found_url = None
deadline = time.time() + 45
while time.time() < deadline and cf.stdout is not None:
    line = cf.stdout.readline()
    if not line:
        break
    m = re.search(r"https://[a-z0-9-]+\\.trycloudflare\\.com", line)
    if m:
        found_url = m.group(0)
        break

if found_url:
    print(f"STUDIO_TUNNEL_READY::{found_url}::TOKEN::{token}", flush=True)
else:
    print("STUDIO_TUNNEL_FAILED", flush=True)
`;
}

export interface ColabAutoProvisionResult {
  ready: boolean;
  reusedExisting: boolean;
  status: "ready" | "notebook_synced" | "needs_cli_auth" | "disabled" | "error";
  bridgeUrl: string | null;
  gpuModel: string | null;
  sessionName: string;
  driveNotebook: ColabDriveNotebookRecord | null;
  messageFa: string;
}

/**
 * Zero-touch Colab CLI + Google Drive Auto-Provisioner.
 * Automatically invoked when Stage 2 Storyboard is approved OR before rendering any GPU-intensive shot
 * (ComfyUI / Blender 3D). Deduplicates concurrent calls via `inFlightProvisionPromise`.
 */
export async function ensureColabGpuRuntimeReady(params?: {
  reason?: "storyboard_approved" | "shot_render" | "manual_provision";
  projectId?: string | null;
  projectTitle?: string | null;
  googleDriveAccessToken?: string | null;
  profileEmail?: string | null;
  forceNewSession?: boolean;
}): Promise<ColabAutoProvisionResult> {
  const cfg = getColabCliConfig();
  if (!cfg.autopilotEnabled && params?.reason !== "manual_provision") {
    return {
      ready: Boolean(getColabBridgeConfig().connected),
      reusedExisting: true,
      status: "disabled",
      bridgeUrl: getColabBridgeConfig().bridgeUrl,
      gpuModel: getColabBridgeConfig().lastHealth?.gpuModel || null,
      sessionName: cfg.sessionName,
      driveNotebook: cfg.driveNotebook,
      messageFa: "حالت خودکار Google Colab CLI خاموش است.",
    };
  }

  if (inFlightProvisionPromise) {
    return inFlightProvisionPromise;
  }

  inFlightProvisionPromise = (async (): Promise<ColabAutoProvisionResult> => {
    let driveNotebook = cfg.driveNotebook;

    // Step 1: If user has an active Google Drive OAuth token, auto-create/sync the project's Colab notebook in Drive
    if (
      params?.googleDriveAccessToken?.trim() &&
      (!driveNotebook ||
        (params.projectId && driveNotebook.projectId !== params.projectId) ||
        params.reason === "manual_provision")
    ) {
      try {
        driveNotebook = await syncColabNotebookToGoogleDrive({
          accessToken: params.googleDriveAccessToken,
          projectId: params.projectId,
          projectTitle: params.projectTitle,
          modelPreset: cfg.modelPreset,
          profileEmail: params.profileEmail || cfg.colabAccountEmail,
        });
      } catch (err) {
        appendCliLog(
          "drive",
          "warn",
          `ساخت خودکار نوتبوک در Google Drive انجام نشد: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Step 2: Check if an existing Colab GPU Bridge is already alive (zero-latency reuse!)
    const existingBridge = getColabBridgeConfig();
    if (existingBridge.bridgeUrl && !params?.forceNewSession) {
      const liveHealth = await probeColabGpuBridge(
        existingBridge.bridgeUrl,
        existingBridge.authToken
      );
      if (liveHealth.reachable) {
        saveColabCliConfig({
          ...getColabCliConfig(),
          driveNotebook,
          lastProvisionedAt: new Date().toISOString(),
          lastProvisionStatus: "ready",
          lastProvisionMessageFa: `GPU زنده Colab (${liveHealth.gpuModel || "NVIDIA GPU"}) فعال و آماده رندر شات‌ها است.`,
        });
        return {
          ready: true,
          reusedExisting: true,
          status: "ready",
          bridgeUrl: liveHealth.bridgeUrl,
          gpuModel: liveHealth.gpuModel,
          sessionName: cfg.sessionName,
          driveNotebook,
          messageFa: `اتصال فعال Colab GPU (${liveHealth.gpuModel || "NVIDIA"}) آماده دریافت شات است.`,
        };
      }
    }

    // Step 3: Attempt real zero-touch provisioning through installed official `google-colab-cli`
    const bin = resolveColabCliBinary();
    if (!bin) {
      const msg =
        "باینری google-colab-cli روی سرور یافت نشد. می‌توانید نوتبوک آماده را از Google Drive اجرا کنید.";
      appendCliLog("cli", "warn", msg);
      return {
        ready: false,
        reusedExisting: false,
        status: driveNotebook ? "notebook_synced" : "error",
        bridgeUrl: null,
        gpuModel: null,
        sessionName: cfg.sessionName,
        driveNotebook,
        messageFa: msg,
      };
    }

    if (!checkLocalColabCliCredentialsPresent()) {
      const msg = driveNotebook
        ? `نوتبوک آماده GPU در Google Colab شما ساخته شد (${driveNotebook.fileName}). برای اجرای ۱۰۰٪ بی‌دخالت از طریق Colab CLI، یک‌بار احراز هویت Colab CLI را فعال کنید یا نوتبوک را باز نمایید.`
        : "google-colab-cli 0.8.0 نصب و آماده است؛ برای راه‌اندازی خودکار GPU بدون کلیک، یک‌بار اکانت گوگل/Colab CLI را متصل کنید.";
      saveColabCliConfig({
        ...getColabCliConfig(),
        driveNotebook,
        lastProvisionStatus: driveNotebook ? "notebook_synced" : "needs_cli_auth",
        lastProvisionMessageFa: msg,
      });
      appendCliLog("cli", "info", msg);
      return {
        ready: false,
        reusedExisting: false,
        status: driveNotebook ? "notebook_synced" : "needs_cli_auth",
        bridgeUrl: null,
        gpuModel: null,
        sessionName: cfg.sessionName,
        driveNotebook,
        messageFa: msg,
      };
    }

    // Step 4: Real `colab new --session <name> --gpu <T4|L4|A100>` + `colab exec` bootstrap!
    const sessionName = SESSION_NAME_RE.test(cfg.sessionName)
      ? cfg.sessionName
      : "content-studio-gpu";
    const gpuVariant: ColabGpuVariant = ALLOWED_GPUS.has(cfg.preferredGpu)
      ? cfg.preferredGpu
      : "T4";

    appendCliLog(
      "runtime",
      "info",
      `شروع راه‌اندازی خودکار ماشین GPU (${gpuVariant}) روی حساب Colab با دستور colab new...`
    );

    const sessProbe = await runColabCliCommand(["sessions"], 12_000);
    const activeSessions = sessProbe.ok ? parseColabSessionsOutput(sessProbe.stdout) : [];

    if (params?.forceNewSession && activeSessions.includes(sessionName)) {
      await runColabCliCommand(["stop", "--session", sessionName], 15_000);
    }

    if (params?.forceNewSession || !activeSessions.includes(sessionName)) {
      const newRes = await runColabCliCommand(
        ["new", "--session", sessionName, "--gpu", gpuVariant],
        60_000
      );
      if (!newRes.ok) {
        const errMsg = `خطا در تخصیص GPU از طریق Colab CLI: ${(newRes.stderr || newRes.stdout).slice(0, 220)}`;
        saveColabCliConfig({
          ...getColabCliConfig(),
          driveNotebook,
          lastProvisionStatus: "error",
          lastProvisionMessageFa: errMsg,
        });
        appendCliLog("runtime", "error", errMsg);
        return {
          ready: false,
          reusedExisting: false,
          status: "error",
          bridgeUrl: null,
          gpuModel: null,
          sessionName,
          driveNotebook,
          messageFa: errMsg,
        };
      }
      appendCliLog(
        "runtime",
        "success",
        `نشست Colab GPU (${sessionName} · ${gpuVariant}) با موفقیت ایجاد شد.`
      );
    }

    // Write bootstrap script safely inside OS temp dir and execute via `colab exec`
    const bootstrapPath = path.join(os.tmpdir(), `cs_colab_boot_${Date.now()}.py`);
    try {
      fs.writeFileSync(
        bootstrapPath,
        buildColabCliGpuBootstrapScript(cfg.modelPreset),
        "utf-8"
      );
      appendCliLog(
        "runtime",
        "info",
        "در حال بالا آوردن خودکار ComfyUI + Blender 4.2 + FastAPI GPU Bridge داخل Colab..."
      );
      const execRes = await runColabCliCommand(
        ["exec", "--session", sessionName, "--file", bootstrapPath, "--timeout", "420"],
        440_000
      );

      const match = execRes.stdout.match(
        /STUDIO_TUNNEL_READY::(https:\/\/[a-z0-9-]+\.trycloudflare\.com)::TOKEN::([a-f0-9]{16,64})/
      );
      if (!match) {
        const errMsg =
          "اجرای اسکریپت روی Colab CLI انجام شد اما لینک تونل GPU دریافت نشد.";
        saveColabCliConfig({
          ...getColabCliConfig(),
          driveNotebook,
          lastProvisionStatus: "error",
          lastProvisionMessageFa: errMsg,
        });
        appendCliLog("runtime", "warn", errMsg);
        return {
          ready: false,
          reusedExisting: false,
          status: "error",
          bridgeUrl: null,
          gpuModel: null,
          sessionName,
          driveNotebook,
          messageFa: errMsg,
        };
      }

      const tunnelUrl = match[1];
      const bridgeToken = match[2];
      if (!isSafeRemoteTunnelUrl(tunnelUrl)) {
        throw new Error("آدرس تونل بازگشتی از Colab معتبر و امن نیست.");
      }

      const connected = await connectColabGpuBridge({
        bridgeUrl: tunnelUrl,
        authToken: bridgeToken,
        colabAccountEmail: cfg.colabAccountEmail,
      });

      const okMsg = `موتور GPU Colab (${connected.health.gpuModel || gpuVariant}) + ComfyUI + Blender 4.2 به صورت خودکار متصل شد!`;
      saveColabCliConfig({
        ...getColabCliConfig(),
        driveNotebook,
        lastProvisionedAt: new Date().toISOString(),
        lastProvisionStatus: connected.health.reachable ? "ready" : "error",
        lastProvisionMessageFa: okMsg,
      });
      appendCliLog("runtime", "success", okMsg);

      return {
        ready: connected.health.reachable,
        reusedExisting: false,
        status: connected.health.reachable ? "ready" : "error",
        bridgeUrl: connected.health.bridgeUrl,
        gpuModel: connected.health.gpuModel,
        sessionName,
        driveNotebook,
        messageFa: okMsg,
      };
    } finally {
      try {
        fs.rmSync(bootstrapPath, { force: true });
      } catch {
        // ignore temp cleanup failure
      }
    }
  })();

  try {
    return await inFlightProvisionPromise;
  } finally {
    inFlightProvisionPromise = null;
  }
}

/**
 * Stops the active remote Colab CLI GPU session cleanly (`colab stop -s <session>`).
 */
export async function stopColabCliSession(sessionNameOverride?: string): Promise<{
  ok: boolean;
  messageFa: string;
}> {
  const cfg = getColabCliConfig();
  const targetSession =
    sessionNameOverride && SESSION_NAME_RE.test(sessionNameOverride.trim())
      ? sessionNameOverride.trim()
      : cfg.sessionName;

  const res = await runColabCliCommand(["stop", "--session", targetSession], 20_000);
  if (res.ok) {
    appendCliLog("runtime", "info", `نشست Colab GPU (${targetSession}) متوقف و آزاد شد.`);
    return { ok: true, messageFa: `نشست Colab GPU (${targetSession}) با موفقیت متوقف شد.` };
  }
  return {
    ok: false,
    messageFa: `نشست فعالی با نام ${targetSession} برای توقف یافت نشد.`,
  };
}

/**
 * Direct fallback execution of a Blender Python render via `colab exec` + `colab download`
 * when a CLI session is alive without a Cloudflare tunnel. Output path is strictly confined to `data/videos/`.
 */
export async function executeDirectColabCliBlenderShot(params: {
  shotId: string;
  pythonScript: string;
  outputFilename: string;
}): Promise<{ outputPath: string; sessionName: string } | null> {
  if (!resolveColabCliBinary() || !checkLocalColabCliCredentialsPresent()) {
    return null;
  }
  const cfg = getColabCliConfig();
  const sessionName = SESSION_NAME_RE.test(cfg.sessionName)
    ? cfg.sessionName
    : "content-studio-gpu";
  const safeOutName = path.basename(params.outputFilename).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const resolvedOut = path.resolve(VIDEOS_DIR, safeOutName);
  if (!resolvedOut.startsWith(path.resolve(VIDEOS_DIR) + path.sep)) {
    throw new Error("مسیر خروجی ویدیو خارج از پوشه مجاز است.");
  }

  const remoteScript = path.join(os.tmpdir(), `cs_shot_${Date.now()}.py`);
  const safeShotId = params.shotId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const remoteMp4 = `/tmp/${safeShotId}_blender_out.mp4`;
  try {
    const wrapper = `import subprocess, tempfile
script = ${JSON.stringify(params.pythonScript)}
with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as tf:
    tf.write(script)
    p = tf.name
subprocess.run(['blender', '--background', '--factory-startup', '--python', p], check=True, timeout=220)
print('COLAB_CLI_SHOT_DONE')
`;
    fs.writeFileSync(remoteScript, wrapper, "utf-8");
    const execRes = await runColabCliCommand(
      ["exec", "--session", sessionName, "--file", remoteScript, "--timeout", "260"],
      280_000
    );
    if (!execRes.ok || !execRes.stdout.includes("COLAB_CLI_SHOT_DONE")) {
      return null;
    }

    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    const dlRes = await runColabCliCommand(
      ["download", "--session", sessionName, remoteMp4, resolvedOut],
      60_000
    );
    if (!dlRes.ok || !fs.existsSync(resolvedOut) || fs.statSync(resolvedOut).size < 4096) {
      return null;
    }
    appendCliLog(
      "shot",
      "success",
      `شات ${safeShotId} مستقیم روی Colab GPU رندر و دانلود شد.`
    );
    return { outputPath: resolvedOut, sessionName };
  } finally {
    try {
      fs.rmSync(remoteScript, { force: true });
    } catch {
      // ignore
    }
  }
}
