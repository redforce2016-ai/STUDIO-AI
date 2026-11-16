import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ShotCompositionPlan } from "../../../src/types/videoPipeline.js";
import { findRemotionBrowserExecutable, getRenderCacheDir } from "../config.js";

let cachedServeUrl: string | null = null;
let bundlePromise: Promise<string> | null = null;
let cachedBrowserExecutable: string | null = null;
let browserPromise: Promise<string | null> | null = null;

// Bound simultaneous headless Chromium renders so parallel LangGraph shot workers
// never exhaust container memory or contend on Chromium downloads.
const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;
const renderWaitQueue: Array<() => void> = [];

async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => {
      renderWaitQueue.push(resolve);
    });
  }
  activeRenders++;
  try {
    return await fn();
  } finally {
    activeRenders--;
    const next = renderWaitQueue.shift();
    if (next) next();
  }
}

function cleanupStaleRemotionLocks(): void {
  const browserDir = path.resolve(process.cwd(), "node_modules/.remotion/chrome-headless-shell");
  const lockFile = path.join(browserDir, "download.lock");
  try {
    if (fs.existsSync(lockFile)) {
      fs.rmSync(lockFile, { force: true });
    }
  } catch {
    // ignore lock cleanup failures
  }
}

export async function ensureRemotionBrowser(): Promise<string | null> {
  if (cachedBrowserExecutable && fs.existsSync(cachedBrowserExecutable)) {
    return cachedBrowserExecutable;
  }

  const localExe = findRemotionBrowserExecutable();
  if (localExe && fs.existsSync(localExe)) {
    cachedBrowserExecutable = localExe;
    return localExe;
  }

  if (!browserPromise) {
    browserPromise = (async () => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) {
            cleanupStaleRemotionLocks();
            await new Promise((r) => setTimeout(r, attempt * 1000));
          }
          const status = await ensureBrowser();
          if (
            (status.type === "local-puppeteer-browser" || status.type === "user-defined-path") &&
            status.path &&
            fs.existsSync(status.path)
          ) {
            cachedBrowserExecutable = status.path;
            return status.path;
          }
          const resolved = findRemotionBrowserExecutable();
          if (resolved) {
            cachedBrowserExecutable = resolved;
            return resolved;
          }
          return null;
        } catch (err) {
          lastErr = err;
          cleanupStaleRemotionLocks();
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    })().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }

  return browserPromise;
}

async function getRemotionServeUrl(): Promise<string> {
  if (cachedServeUrl && fs.existsSync(cachedServeUrl)) {
    return cachedServeUrl;
  }
  if (!bundlePromise) {
    const entryPoint = path.resolve(process.cwd(), "server/video/remotion/entry.ts");
    bundlePromise = bundle({
      entryPoint,
      webpackOverride: (config) => {
        // Allow TypeScript .js relative imports in ESM TS codebase to resolve cleanly
        config.resolve = config.resolve || {};
        config.resolve.extensionAlias = {
          ...(config.resolve.extensionAlias || {}),
          ".js": [".ts", ".tsx", ".js", ".jsx"],
          ".mjs": [".mts", ".mjs"],
        };
        return config;
      },
    })
      .then((serveUrl) => {
        cachedServeUrl = serveUrl;
        return serveUrl;
      })
      .catch((err) => {
        bundlePromise = null;
        throw err;
      });
  }
  return bundlePromise;
}

export function computePlanHash(plan: ShotCompositionPlan): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex")
    .slice(0, 16);
}

export async function renderRemotionShot(params: {
  plan: ShotCompositionPlan;
  outputPath: string;
  timeoutMs?: number;
  bypassCache?: boolean;
}): Promise<{ outputPath: string; cacheHit: boolean; planHash: string }> {
  const planHash = computePlanHash(params.plan);
  const cacheDir = getRenderCacheDir();
  const cachedFile = path.join(cacheDir, `${planHash}.mp4`);

  fs.mkdirSync(path.dirname(params.outputPath), { recursive: true });

  if (!params.bypassCache && fs.existsSync(cachedFile)) {
    fs.copyFileSync(cachedFile, params.outputPath);
    return { outputPath: params.outputPath, cacheHit: true, planHash };
  }

  return withRenderSlot(async () => {
    const browserExecutable = await ensureRemotionBrowser();
    const serveUrl = await getRemotionServeUrl();
    const inputProps = { plan: params.plan };

    const composition = await selectComposition({
      serveUrl,
      id: "UniversalShot",
      inputProps,
      ...(browserExecutable ? { browserExecutable } : {}),
      chromiumOptions: {
        enableMultiProcessOnLinux: true,
      },
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      pixelFormat: "yuv420p",
      outputLocation: params.outputPath,
      inputProps,
      concurrency: 2,
      timeoutInMilliseconds: params.timeoutMs ?? 120_000,
      ...(browserExecutable ? { browserExecutable } : {}),
      chromiumOptions: {
        enableMultiProcessOnLinux: true,
      },
    });

    if (fs.existsSync(params.outputPath)) {
      fs.copyFileSync(params.outputPath, cachedFile);
    }

    return { outputPath: params.outputPath, cacheHit: false, planHash };
  });
}
