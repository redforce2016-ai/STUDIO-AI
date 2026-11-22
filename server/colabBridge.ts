import fs from "node:fs";
import path from "node:path";

export interface ColabRuntimeHealth {
  reachable: boolean;
  checkedAt: string;
  bridgeUrl: string;
  gpuModel: string | null;
  vramTotalGb: number;
  ramTotalGb: number;
  engines: {
    comfyui: boolean;
    blender: boolean;
    blenderVersion: string | null;
    ffmpeg: boolean;
    persianFonts: boolean;
  };
  errorFa: string | null;
}

export interface ColabConnectionConfig {
  bridgeUrl: string | null;
  authToken: string | null;
  colabAccountEmail: string | null;
  connected: boolean;
  lastHealth: ColabRuntimeHealth | null;
  updatedAt: string;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const COLAB_CONFIG_PATH = path.join(DATA_DIR, "colab_bridge_state.json");

let cachedConfig: ColabConnectionConfig | null = null;

export function getColabBridgeConfig(): ColabConnectionConfig {
  if (!cachedConfig) {
    try {
      if (fs.existsSync(COLAB_CONFIG_PATH)) {
        cachedConfig = JSON.parse(fs.readFileSync(COLAB_CONFIG_PATH, "utf-8")) as ColabConnectionConfig;
      }
    } catch {
      cachedConfig = null;
    }
  }
  if (!cachedConfig) {
    cachedConfig = {
      bridgeUrl: process.env.COLAB_GPU_BRIDGE_URL?.trim() || null,
      authToken: process.env.COLAB_GPU_AUTH_TOKEN?.trim() || null,
      colabAccountEmail: null,
      connected: false,
      lastHealth: null,
      updatedAt: new Date().toISOString(),
    };
  }
  return cachedConfig;
}

function saveColabBridgeConfig(next: ColabConnectionConfig): ColabConnectionConfig {
  cachedConfig = { ...next, updatedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(COLAB_CONFIG_PATH, JSON.stringify(cachedConfig, null, 2), "utf-8");
  } catch {
    // non-fatal
  }
  return cachedConfig;
}

export function normalizeBridgeUrl(rawUrl: string): string {
  const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("آدرس تونل Google Colab (مثلاً https://xxxx.trycloudflare.com) الزامی است.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("فرمت آدرس تونل نامعتبر است.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("آدرس تونل باید با https:// یا http:// شروع شود.");
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
}

/**
 * Performs a REAL live HTTP health probe against the user's Google Colab GPU FastAPI Bridge (`/health`)
 * or falls back to checking raw ComfyUI `/system_stats`. NEVER returns a fake/mocked connected status!
 */
export async function probeColabGpuBridge(
  rawUrl: string,
  authToken?: string | null
): Promise<ColabRuntimeHealth> {
  const cleanUrl = normalizeBridgeUrl(rawUrl);
  const now = new Date().toISOString();
  const headers: Record<string, string> = {};
  if (authToken?.trim()) {
    headers["Authorization"] = `Bearer ${authToken.trim()}`;
  }

  // 1. Try Unified All-in-One Colab FastAPI Bridge `/health`
  try {
    const res = await fetch(`${cleanUrl}/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        status?: string;
        gpu_model?: string;
        vram_total_gb?: number;
        ram_total_gb?: number;
        engines?: {
          comfyui?: boolean;
          blender?: boolean;
          blender_version?: string | null;
          ffmpeg?: boolean;
          persian_fonts?: boolean;
        };
      };
      return {
        reachable: true,
        checkedAt: now,
        bridgeUrl: cleanUrl,
        gpuModel: data.gpu_model || "NVIDIA Colab GPU",
        vramTotalGb: Number(data.vram_total_gb || 0),
        ramTotalGb: Number(data.ram_total_gb || 0),
        engines: {
          comfyui: Boolean(data.engines?.comfyui),
          blender: Boolean(data.engines?.blender),
          blenderVersion: data.engines?.blender_version || null,
          ffmpeg: Boolean(data.engines?.ffmpeg ?? true),
          persianFonts: Boolean(data.engines?.persian_fonts),
        },
        errorFa: null,
      };
    }
  } catch {
    // Fallback to raw ComfyUI `/system_stats` if user launched ComfyUI directly
  }

  // 2. Fallback: raw ComfyUI `/system_stats`
  try {
    const res = await fetch(`${cleanUrl}/system_stats`, {
      method: "GET",
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) {
      const stats = (await res.json()) as {
        system?: { ram_total?: number; comfyui_version?: string };
        devices?: Array<{ name?: string; vram_total?: number }>;
      };
      const dev = stats.devices?.[0];
      return {
        reachable: true,
        checkedAt: now,
        bridgeUrl: cleanUrl,
        gpuModel: dev?.name || "ComfyUI Remote GPU",
        vramTotalGb: dev?.vram_total ? Math.round((dev.vram_total / 1024 ** 3) * 10) / 10 : 0,
        ramTotalGb: stats.system?.ram_total
          ? Math.round((stats.system.ram_total / 1024 ** 3) * 10) / 10
          : 0,
        engines: {
          comfyui: true,
          blender: false,
          blenderVersion: null,
          ffmpeg: true,
          persianFonts: false,
        },
        errorFa: null,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      reachable: false,
      checkedAt: now,
      bridgeUrl: cleanUrl,
      gpuModel: null,
      vramTotalGb: 0,
      ramTotalGb: 0,
      engines: {
        comfyui: false,
        blender: false,
        blenderVersion: null,
        ffmpeg: false,
        persianFonts: false,
      },
      errorFa: `اتصال واقعی به سرور Colab برقرار نشد (${msg}). ابتدا نوتبوک All-in-One GPU را در Google Colab اجرا کنید و لینک trycloudflare.com را وارد نمایید.`,
    };
  }

  return {
    reachable: false,
    checkedAt: now,
    bridgeUrl: cleanUrl,
    gpuModel: null,
    vramTotalGb: 0,
    ramTotalGb: 0,
    engines: {
      comfyui: false,
      blender: false,
      blenderVersion: null,
      ffmpeg: false,
      persianFonts: false,
    },
    errorFa: "پاسخ معتبری از پل اتصال Google Colab دریافت نشد. مطمئن شوید سلول FastAPI Bridge + cloudflared در Colab در حال اجرا است.",
  };
}

export async function connectColabGpuBridge(params: {
  bridgeUrl: string;
  authToken?: string | null;
  colabAccountEmail?: string | null;
}): Promise<{ config: ColabConnectionConfig; health: ColabRuntimeHealth }> {
  const health = await probeColabGpuBridge(params.bridgeUrl, params.authToken);
  const current = getColabBridgeConfig();
  const next = saveColabBridgeConfig({
    ...current,
    bridgeUrl: health.bridgeUrl,
    authToken: params.authToken?.trim() || current.authToken || null,
    colabAccountEmail: params.colabAccountEmail?.trim() || current.colabAccountEmail || null,
    connected: health.reachable,
    lastHealth: health,
    updatedAt: new Date().toISOString(),
  });
  return { config: next, health };
}

export function disconnectColabGpuBridge(): ColabConnectionConfig {
  const current = getColabBridgeConfig();
  return saveColabBridgeConfig({
    ...current,
    connected: false,
    lastHealth: current.lastHealth ? { ...current.lastHealth, reachable: false } : null,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Dispatches a REAL Blender 4.2 Python (.py) 3D render job to the connected Google Colab GPU Bridge
 * (`/blender/render`) and writes the returned MP4 binary to `outputPath`.
 */
export async function executeRemoteColabBlenderRender(params: {
  shotId: string;
  pythonScript: string;
  outputPath: string;
  timeoutMs?: number;
}): Promise<{ outputPath: string; gpuUsed: string }> {
  const cfg = getColabBridgeConfig();
  if (!cfg.connected || !cfg.bridgeUrl || !cfg.lastHealth?.engines?.blender) {
    throw new Error("Blender روی سرور Google Colab متصل یا فعال نیست.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.authToken) {
    headers["Authorization"] = `Bearer ${cfg.authToken}`;
  }

  const res = await fetch(`${cfg.bridgeUrl}/blender/render`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      shot_id: params.shotId,
      python_script: params.pythonScript,
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 240_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`خطا در رندر Blender روی Google Colab GPU: ${errText.slice(0, 260)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4096) {
    throw new Error("خروجی MP4 بازگشتی از Blender Colab خالی یا معیوب است.");
  }

  fs.mkdirSync(path.dirname(params.outputPath), { recursive: true });
  fs.writeFileSync(params.outputPath, buf);

  return {
    outputPath: params.outputPath,
    gpuUsed: cfg.lastHealth.gpuModel || "Google Colab GPU",
  };
}
