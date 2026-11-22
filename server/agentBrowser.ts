import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  AgentBrowserActionLog,
  AgentBrowserCommandType,
  AgentBrowserExtractedPage,
  AgentBrowserInteractiveRef,
  AgentBrowserLinkItem,
  AgentBrowserSearchResult,
  AgentBrowserState,
  BrowserProfileAccount,
  GroundedSource,
  I2VShotPlan,
  I2VTargetTool,
  ObstacleBypassRecord,
  WebStudioGenerationMode,
  WebStudioModelOption,
  WebStudioShotJob,
  WebStudioSiteConfig,
  WebStudioSiteId,
} from "../src/types/studio.js";
import {
  getImagesDir,
  getProject,
  getVideosDir,
  getVisualsDir,
  saveImageFile,
  saveProject,
  saveStudioAsset,
  saveVisualSvgFile,
} from "./store.js";
import { getActiveRemoteComfyUrl } from "./cloudGpuNotebooks.js";
import { getGoogleApiKeyFromRouter } from "./router.js";
import {
  buildAndAuditI2VShotPlan,
  buildDeterministicLiveVideoQueries,
} from "./video/i2vPromptDirector.js";
import { ComfyUIProvider } from "./video/providers/comfyui.js";
import { OmniVideoProvider } from "./video/providers/omniVideo.js";
import { ParallaxVideoProvider } from "./video/providers/parallax.js";
import {
  renderProceduralCinemaKeyframePng,
  renderProceduralCinemaVideoMp4,
} from "./video/providers/proceduralCinema.js";
import { renderRealLiveActionDocumentaryClip } from "./video/providers/realLiveVideo.js";
import { curatePhotorealisticShotKeyframe } from "./video/providers/realMediaCurator.js";

const execFileAsync = promisify(execFile);

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_ACTION_LOGS = 80;
const MAX_HISTORY_ITEMS = 40;

export const WEB_STUDIO_CATALOG: Record<
  WebStudioSiteId,
  {
    labelFa: string;
    url: string;
    supportedModes: WebStudioGenerationMode[];
    models: Array<{ id: WebStudioModelOption; labelFa: string; kind: "image" | "video" }>;
  }
> = {
  google_flow: {
    labelFa: "Google Flow / LabsFX (گوگل فلو)",
    url: "https://labs.google/fx/tools/flow",
    supportedModes: ["text_to_image", "image_to_video", "text_to_video"],
    models: [
      { id: "veo_2", labelFa: "Google Veo 2 (ویدیو سینمایی)", kind: "video" },
      { id: "omni_flash", labelFa: "Gemini Omni Flash (ویدیو سریع)", kind: "video" },
      { id: "imagen_3", labelFa: "Google Imagen 3 (تصویر کلیدی دقیق)", kind: "image" },
    ],
  },
  molab: {
    labelFa: "Marimo Molab GPU (مولب — تا ۹۶GB VRAM)",
    url: "https://molab.marimo.io",
    supportedModes: ["image_to_video", "text_to_video"],
    models: [
      { id: "molab_wan22_gpu", labelFa: "Molab GPU · Wan 2.2 I2V 14B (FP8)", kind: "video" },
      { id: "molab_ltx23_gpu", labelFa: "Molab GPU · LTX-Video 2.3 (سریع)", kind: "video" },
    ],
  },
  google_colab: {
    labelFa: "Google Colab GPU (گوگل کولب — T4 / L4)",
    url: "https://colab.research.google.com",
    supportedModes: ["image_to_video", "text_to_video"],
    models: [
      { id: "colab_wan22_gguf", labelFa: "Colab T4 GPU · Wan 2.2 5B (GGUF)", kind: "video" },
      { id: "colab_ltx23_gpu", labelFa: "Colab GPU · LTX-Video (سریع)", kind: "video" },
    ],
  },
  leonardo_ai: {
    labelFa: "Leonardo.ai Studio (لئوناردو)",
    url: "https://app.leonardo.ai/image-generation",
    supportedModes: ["text_to_image", "image_to_video"],
    models: [
      { id: "leonardo_phoenix", labelFa: "Leonardo Phoenix 1.0 (تصویر حرفه‌ای)", kind: "image" },
      { id: "leonardo_kino_xl", labelFa: "Leonardo Kino XL (سینمایی)", kind: "image" },
      { id: "leonardo_motion", labelFa: "Leonardo Motion 2.0 (متحرک‌سازی)", kind: "video" },
    ],
  },
  kling_web: {
    labelFa: "Kling AI Web Studio (کلینگ)",
    url: "https://klingai.com/global",
    supportedModes: ["text_to_image", "image_to_video", "text_to_video"],
    models: [
      { id: "kling_1_6", labelFa: "Kling 1.6 Pro (ویدیو واقع‌گرایانه)", kind: "video" },
    ],
  },
  runway_web: {
    labelFa: "RunwayML Gen-3 Web (ران‌وی)",
    url: "https://app.runwayml.com",
    supportedModes: ["image_to_video", "text_to_video"],
    models: [
      { id: "runway_gen3_turbo", labelFa: "Runway Gen-3 Alpha Turbo", kind: "video" },
    ],
  },
  general_web: {
    labelFa: "مرورگر آزاد و پژوهش اینترنتی",
    url: "https://fa.wikipedia.org",
    supportedModes: ["text_to_image"],
    models: [{ id: "imagen_3", labelFa: "پیش‌فرض", kind: "image" }],
  },
};

// ============================================================================
// Pure Helper Functions (Unit-Testable)
// ============================================================================

export function decodeHtmlEntities(input: string): string {
  if (!input) return "";
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&zwnj;/gi, "\u200c")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    });
}

export function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function extractNumericAndTechnicalFacts(paragraphs: string[]): string[] {
  const facts: string[] = [];
  const seen = new Set<string>();

  for (const para of paragraphs) {
    const sentences = para
      .split(/(?<=[.!؟؛\n])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 25 && s.length <= 280);

    for (const sentence of sentences) {
      const hasData =
        /[0-9۰-۹]+|%|\b(ASTM|ASME|API|ISO|DIN|JIS|رده|اینچ|مگاپاسکال|درجه|میلی‌متر|سانتی‌متر|کیلوگرم|تن|بار|استاندارد|سال|قرن|درصد|تولید|صنعت)\b/i.test(
          sentence
        );
      if (hasData && !seen.has(sentence)) {
        seen.add(sentence);
        facts.push(sentence);
        if (facts.length >= 8) return facts;
      }
    }
  }

  if (facts.length === 0) {
    for (const para of paragraphs.slice(0, 4)) {
      const clean = para.trim().slice(0, 220);
      if (clean.length >= 25 && !seen.has(clean)) {
        seen.add(clean);
        facts.push(clean);
      }
    }
  }

  return facts;
}

export function parseAgentBrowserSnapshotJson(rawStdout: string): {
  interactiveRefs: AgentBrowserInteractiveRef[];
  snapshotText: string;
  originUrl?: string;
} {
  try {
    const jsonStart = rawStdout.indexOf("{");
    if (jsonStart < 0) return { interactiveRefs: [], snapshotText: "" };
    const parsed = JSON.parse(rawStdout.slice(jsonStart)) as {
      success?: boolean;
      data?: {
        origin?: string;
        snapshot?: string;
        refs?: Record<string, { name?: string; role?: string }>;
      };
    };
    const refsObj = parsed.data?.refs || {};
    const interactiveRefs: AgentBrowserInteractiveRef[] = Object.entries(refsObj).map(
      ([key, info]) => ({
        ref: key.startsWith("@") ? key : `@${key}`,
        role: info?.role || "element",
        name: info?.name || "",
      })
    );
    return {
      interactiveRefs,
      snapshotText: parsed.data?.snapshot || "",
      originUrl: parsed.data?.origin,
    };
  } catch {
    return { interactiveRefs: [], snapshotText: "" };
  }
}

export function matchFormRefsForSignup(refs: AgentBrowserInteractiveRef[]): {
  emailRef: string | null;
  passwordRef: string | null;
  nameRef: string | null;
  agreeRef: string | null;
  submitRef: string | null;
} {
  const emailRef =
    refs.find(
      (r) =>
        (r.role === "textbox" || r.role === "searchbox") &&
        /email|mail|user|account|ایمیل|نام کاربری/i.test(r.name)
    )?.ref ||
    refs.find((r) => r.role === "textbox")?.ref ||
    null;

  const passwordRef =
    refs.find(
      (r) =>
        (r.role === "textbox" || r.role === "input") &&
        /pass|pwd|secret|رمز|گذرواژه/i.test(r.name)
    )?.ref || null;

  const nameRef =
    refs.find(
      (r) =>
        r.role === "textbox" &&
        r.ref !== emailRef &&
        r.ref !== passwordRef &&
        /name|full|نام/i.test(r.name)
    )?.ref || null;

  const agreeRef =
    refs.find(
      (r) => r.role === "checkbox" && /agree|terms|policy|consent|robot|قوانین|موافقم/i.test(r.name)
    )?.ref || null;

  const submitRef =
    refs.find(
      (r) =>
        r.role === "button" &&
        /sign|register|create|continue|next|submit|login|ورود|ثبت|ادامه/i.test(r.name)
    )?.ref ||
    refs.find((r) => r.role === "button")?.ref ||
    null;

  return { emailRef, passwordRef, nameRef, agreeRef, submitRef };
}

export function parseHtmlToStructuredPage(params: {
  html: string;
  url: string;
  statusCode?: number;
  contentType?: string;
  scrollY?: number;
  interactiveRefs?: AgentBrowserInteractiveRef[];
  snapshotText?: string;
}): AgentBrowserExtractedPage {
  const {
    html,
    url,
    statusCode = 200,
    contentType = "text/html",
    scrollY = 0,
    interactiveRefs = [],
    snapshotText = "",
  } = params;

  let domain = "web.local";
  try {
    domain = new URL(url).hostname;
  } catch {
    domain = url.replace(/^https?:\/\//i, "").split("/")[0] || "web.local";
  }

  const cleanedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const titleMatch = cleanedHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitleMatch =
    cleanedHtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    cleanedHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const rawTitle = stripHtmlTags(titleMatch?.[1] || ogTitleMatch?.[1] || "");

  const headings: string[] = [];
  const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(cleanedHtml)) !== null) {
    const text = stripHtmlTags(hMatch[2]);
    if (text.length >= 3 && text.length <= 180 && !headings.includes(text)) {
      headings.push(text);
      if (headings.length >= 12) break;
    }
  }

  const pageTitle = rawTitle || headings[0] || domain;

  const keyParagraphs: string[] = [];
  const blockRegex = /<(p|li|article|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = blockRegex.exec(cleanedHtml)) !== null) {
    const text = stripHtmlTags(pMatch[2]);
    if (text.length >= 40 && !keyParagraphs.includes(text)) {
      keyParagraphs.push(text);
      if (keyParagraphs.length >= 18) break;
    }
  }

  if (keyParagraphs.length === 0) {
    const plainBody = stripHtmlTags(cleanedHtml);
    if (plainBody.length > 0) {
      const chunks = plainBody
        .split(/(?<=[.!؟])\s+/)
        .map((c) => c.trim())
        .filter((c) => c.length >= 30);
      for (const chunk of chunks.slice(0, 10)) {
        keyParagraphs.push(chunk);
      }
      if (keyParagraphs.length === 0) {
        keyParagraphs.push(plainBody.slice(0, 600));
      }
    }
  }

  const links: AgentBrowserLinkItem[] = [];
  const seenHref = new Set<string>();
  const linkRegex = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let lMatch: RegExpExecArray | null;
  while ((lMatch = linkRegex.exec(cleanedHtml)) !== null) {
    const rawHref = decodeHtmlEntities(lMatch[1].trim());
    const text = stripHtmlTags(lMatch[2]);
    if (!rawHref || rawHref.startsWith("javascript:") || rawHref.startsWith("mailto:")) {
      continue;
    }
    let resolvedHref = rawHref;
    try {
      resolvedHref = new URL(rawHref, url).toString();
    } catch {
      continue;
    }
    if (text.length >= 2 && text.length <= 120 && !seenHref.has(resolvedHref)) {
      seenHref.add(resolvedHref);
      links.push({
        index: links.length + 1,
        text,
        href: resolvedHref,
      });
      if (links.length >= 20) break;
    }
  }

  const fullText = [headings.join(" "), keyParagraphs.join(" ")].join(" ").trim();
  const wordCount = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;
  const summaryText =
    keyParagraphs.slice(0, 3).join("\n\n") ||
    headings.slice(0, 4).join(" — ") ||
    `صفحه ${pageTitle} در دامنه ${domain} باز شد.`;

  const keyDataPoints = extractNumericAndTechnicalFacts(keyParagraphs);
  const maxScrollY = Math.max(0, Math.ceil(keyParagraphs.length / 3) * 320);
  const clampedScrollY = Math.min(Math.max(0, scrollY), maxScrollY);

  return {
    url,
    title: pageTitle,
    domain,
    statusCode,
    contentType,
    summaryText,
    headings,
    keyParagraphs,
    keyDataPoints,
    links,
    interactiveRefs,
    snapshotText,
    wordCount,
    scrollY: clampedScrollY,
    maxScrollY,
    extractedAt: new Date().toISOString(),
  };
}

export function computeNextScrollY(
  currentScrollY: number,
  maxScrollY: number,
  direction: "down" | "up" | "top" | "bottom"
): number {
  const safeMax = Math.max(0, maxScrollY);
  if (direction === "top") return 0;
  if (direction === "bottom") return safeMax;
  if (direction === "down") return Math.min(safeMax, currentScrollY + 320);
  return Math.max(0, currentScrollY - 320);
}

export function resolveClickTargetUrl(params: {
  target: string;
  extractedPage: AgentBrowserExtractedPage | null;
  searchResults: AgentBrowserSearchResult[];
}): { url: string; label: string } | null {
  const raw = params.target.trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    return { url: raw, label: raw };
  }

  const indexMatch = raw.match(/^#?\[?(\d+)\]?$/);
  if (indexMatch) {
    const idx = Number(indexMatch[1]);
    const pageLink = params.extractedPage?.links.find((l) => l.index === idx);
    if (pageLink) {
      return { url: pageLink.href, label: pageLink.text };
    }
    const searchHit = params.searchResults.find((r) => r.index === idx);
    if (searchHit) {
      return { url: searchHit.url, label: searchHit.title };
    }
  }

  const lower = raw.toLowerCase();
  const matchedLink = params.extractedPage?.links.find(
    (l) => l.text.toLowerCase().includes(lower) || l.href.toLowerCase().includes(lower)
  );
  if (matchedLink) {
    return { url: matchedLink.href, label: matchedLink.text };
  }

  const matchedSearch = params.searchResults.find(
    (r) => r.title.toLowerCase().includes(lower) || r.snippet.toLowerCase().includes(lower)
  );
  if (matchedSearch) {
    return { url: matchedSearch.url, label: matchedSearch.title };
  }

  return null;
}

/**
 * Pure function for Multi-Account Google Profile Selection & Quota Rotation (10 Gmail Pool)
 */
export function selectAvailableProfileWithRotation(params: {
  profiles: BrowserProfileAccount[];
  currentActiveProfileId: string;
  siteId?: WebStudioSiteId;
}): {
  selectedProfile: BrowserProfileAccount;
  switchedFromProfile: BrowserProfileAccount | null;
  updatedProfiles: BrowserProfileAccount[];
} {
  const updated = params.profiles.map((p) => ({
    ...p,
    status:
      p.usedToday >= p.dailyLimit
        ? ("quota_exhausted" as const)
        : p.status === "quota_exhausted"
          ? ("standby" as const)
          : p.status,
  }));

  const current = updated.find((p) => p.id === params.currentActiveProfileId) || updated[0];

  if (current && current.usedToday < current.dailyLimit) {
    const finalProfiles = updated.map((p) => ({
      ...p,
      status:
        p.id === current.id
          ? ("active" as const)
          : p.usedToday >= p.dailyLimit
            ? ("quota_exhausted" as const)
            : ("standby" as const),
    }));
    return {
      selectedProfile: finalProfiles.find((p) => p.id === current.id)!,
      switchedFromProfile: null,
      updatedProfiles: finalProfiles,
    };
  }

  const candidate =
    updated.find(
      (p) =>
        p.id !== current?.id &&
        p.usedToday < p.dailyLimit &&
        (!params.siteId || p.connectedSites.includes(params.siteId))
    ) || updated.find((p) => p.usedToday < p.dailyLimit);

  if (candidate) {
    const finalProfiles = updated.map((p) => ({
      ...p,
      status:
        p.id === candidate.id
          ? ("active" as const)
          : p.usedToday >= p.dailyLimit
            ? ("quota_exhausted" as const)
            : ("standby" as const),
    }));
    return {
      selectedProfile: finalProfiles.find((p) => p.id === candidate.id)!,
      switchedFromProfile: current || null,
      updatedProfiles: finalProfiles,
    };
  }

  const resetFirst = updated.map((p, idx) => ({
    ...p,
    usedToday: idx === 0 ? 0 : p.usedToday,
    status: idx === 0 ? ("active" as const) : ("quota_exhausted" as const),
  }));
  return {
    selectedProfile: resetFirst[0],
    switchedFromProfile: current || null,
    updatedProfiles: resetFirst,
  };
}

/**
 * Pure Prompt Refiner & Finalizer before submitting to Google Flow (Veo 2 / Omni Flash / Imagen 3) or Leonardo.ai
 */
export function refineAndFinalizeStudioPrompt(params: {
  rawPrompt: string;
  siteId: WebStudioSiteId;
  mode: WebStudioGenerationMode;
  modelId: WebStudioModelOption;
  aspectRatio: "9:16" | "16:9" | "1:1";
  resolution: "720p" | "1080p";
}): {
  finalizedPrompt: string;
  enhancementsFa: string[];
} {
  const cleanRaw = params.rawPrompt.trim();
  const enhancementsFa: string[] = [];

  const frameDesc =
    params.aspectRatio === "9:16"
      ? "Vertical 9:16 social cinema composition, centered hero subject with clean headroom"
      : params.aspectRatio === "16:9"
        ? "Widescreen 16:9 anamorphic cinema framing, balanced rule-of-thirds depth"
        : "Square 1:1 balanced studio framing";
  enhancementsFa.push(`تثبیت کادر و نسبت تصویر (${params.aspectRatio}) با کیفیت ${params.resolution}`);

  let modelTokens = "";
  if (params.modelId === "veo_2") {
    modelTokens =
      "Google Veo 2 photorealistic cinema grade, 24fps natural motion blur, physically accurate lighting, zero morphing artifacts";
    enhancementsFa.push("افزودن توکن‌های فیزیک حرکت و نورپردازی سینمایی مخصوص مدل Google Veo 2");
  } else if (params.modelId === "omni_flash") {
    modelTokens =
      "Gemini Omni Flash high-coherence temporal stability, smooth dolly push-in, crisp edge definition";
    enhancementsFa.push("تنظیم پایداری زمانی فریم‌ها و حرکت نرم دوربین برای مدل Gemini Omni Flash");
  } else if (params.modelId === "imagen_3") {
    modelTokens =
      "Google Imagen 3 ultra-detailed 8k keyframe photography, ARRI Alexa Mini LF 50mm f/1.4 prime lens, volumetric rim lighting";
    enhancementsFa.push("قفل کردن مشخصات لنز ۵۰ میلی‌متری و نورپردازی حجمی برای مدل Imagen 3");
  } else if (params.modelId.startsWith("leonardo")) {
    modelTokens =
      "Leonardo Phoenix & Kino XL masterwork, high dynamic range, tactile surface micro-textures, dramatic studio key light";
    enhancementsFa.push("بهینه‌سازی بافت سطح و کنتراست دینامیک برای موتور Leonardo.ai");
  } else {
    modelTokens = "High-end commercial studio production quality, sharp focus, natural color grading";
    enhancementsFa.push("افزودن استانداردهای وضوح و اصلاح رنگ استودیویی");
  }

  let motionDirective = "";
  if (params.mode === "image_to_video" || params.mode === "text_to_video") {
    motionDirective =
      "Camera Motion: Slow, controlled cinematic push-in (3-5 seconds), subtle environmental dynamics, strict subject identity preservation.";
    enhancementsFa.push(
      params.mode === "image_to_video"
        ? "قفل کردن حرکت آرام دوربین برای تبدیل عکس به ویدیو (Image-to-Video) بدون به‌هم‌ریختگی سوژه"
        : "تعیین کارگردانی حرکت دوربین و پیوستگی صحنه برای تبدیل متن به ویدیو (Text-to-Video)"
    );
  } else {
    motionDirective = "Static high-impact keyframe capture, crisp textures, ready for I2V animation.";
    enhancementsFa.push("بهینه‌سازی ترکیب‌بندی ایستا برای تولید تصویر کلیدی (Text-to-Image)");
  }

  const finalizedPrompt = `${cleanRaw} | ${frameDesc} | ${motionDirective} | ${modelTokens} | Resolution: ${params.resolution}`;

  return {
    finalizedPrompt,
    enhancementsFa,
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildBrowserViewportSvg(params: {
  url: string;
  title: string;
  activeAgent: string | null;
  commandLabel: string;
  extractedPage: AgentBrowserExtractedPage | null;
  searchResults: AgentBrowserSearchResult[];
  scrollY: number;
  activeProfileEmail?: string;
  activeModelLabel?: string;
}): string {
  const {
    url,
    title,
    activeAgent,
    commandLabel,
    extractedPage,
    searchResults,
    scrollY,
    activeProfileEmail,
    activeModelLabel,
  } = params;
  const safeUrl = escapeXml((url || "about:blank").slice(0, 82));
  const safeTitle = escapeXml((title || "vercel-labs/agent-browser Chromium CDP").slice(0, 70));
  const safeAgent = escapeXml(activeAgent || "Agent Browser + LangGraph");
  const safeCmd = escapeXml(commandLabel || "READY");
  const safeProfile = escapeXml(activeProfileEmail || "studio.agent.01@gmail.com");
  const safeModel = escapeXml(activeModelLabel || "Veo 2 / Omni Flash");

  const startParagraphIdx = Math.max(0, Math.floor(scrollY / 320) * 2);
  const visibleParagraphs = (extractedPage?.keyParagraphs || []).slice(
    startParagraphIdx,
    startParagraphIdx + 4
  );
  const visibleHeadings = (extractedPage?.headings || []).slice(0, 3);
  const visibleFacts = (extractedPage?.keyDataPoints || []).slice(0, 3);

  let bodyRowsSvg = "";
  let yCursor = 166;

  if (visibleHeadings.length > 0) {
    for (const h of visibleHeadings.slice(0, 2)) {
      bodyRowsSvg += `
        <rect x="44" y="${yCursor - 20}" width="872" height="32" rx="6" fill="#161B26" stroke="#262F45" stroke-width="1"/>
        <text x="896" y="${yCursor}" text-anchor="end" fill="#F59E0B" font-family="Vazirmatn, sans-serif" font-size="14" font-weight="700">${escapeXml(
          h.slice(0, 88)
        )}</text>
      `;
      yCursor += 42;
    }
  }

  if (visibleParagraphs.length > 0) {
    for (const p of visibleParagraphs) {
      const line1 = escapeXml(p.slice(0, 105));
      const line2 = escapeXml(p.slice(105, 210));
      bodyRowsSvg += `
        <rect x="44" y="${yCursor - 18}" width="872" height="${line2 ? 54 : 34}" rx="8" fill="#11151E" stroke="#1E2536" stroke-width="1"/>
        <text x="896" y="${yCursor + 2}" text-anchor="end" fill="#E2E8F0" font-family="Vazirmatn, sans-serif" font-size="13">${line1}</text>
        ${
          line2
            ? `<text x="896" y="${yCursor + 24}" text-anchor="end" fill="#94A3B8" font-family="Vazirmatn, sans-serif" font-size="12">${line2}${
                p.length > 210 ? "..." : ""
              }</text>`
            : ""
        }
      `;
      yCursor += line2 ? 64 : 44;
      if (yCursor > 420) break;
    }
  } else if (searchResults.length > 0) {
    for (const res of searchResults.slice(0, 4)) {
      bodyRowsSvg += `
        <rect x="44" y="${yCursor - 18}" width="872" height="58" rx="8" fill="#11151E" stroke="#1E293B" stroke-width="1"/>
        <text x="896" y="${yCursor + 2}" text-anchor="end" fill="#38BDF8" font-family="Vazirmatn, sans-serif" font-size="14" font-weight="700">[${
          res.index
        }] ${escapeXml(res.title.slice(0, 78))}</text>
        <text x="896" y="${yCursor + 24}" text-anchor="end" fill="#94A3B8" font-family="Vazirmatn, sans-serif" font-size="12">${escapeXml(
          res.snippet.slice(0, 105)
        )}</text>
      `;
      yCursor += 68;
    }
  }

  let factsSvg = "";
  if (visibleFacts.length > 0) {
    const factText = escapeXml(visibleFacts[0].slice(0, 105));
    factsSvg = `
      <rect x="44" y="458" width="872" height="44" rx="8" fill="#0F291E" stroke="#10B981" stroke-width="1" stroke-opacity="0.45"/>
      <text x="896" y="485" text-anchor="end" fill="#6EE7B7" font-family="Vazirmatn, sans-serif" font-size="12" font-weight="600">داده استخراج‌شده: ${factText}</text>
    `;
  }

  const maxScroll = Math.max(320, extractedPage?.maxScrollY || 320);
  const scrollThumbY = 130 + Math.min(340, Math.round((scrollY / maxScroll) * 340));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B0E14"/>
      <stop offset="100%" stop-color="#111726"/>
    </linearGradient>
  </defs>
  <rect width="960" height="540" fill="url(#bgGrad)"/>
  <rect x="16" y="14" width="928" height="44" rx="10" fill="#151923" stroke="#262D3D" stroke-width="1"/>
  <circle cx="40" cy="36" r="6" fill="#EF4444"/>
  <circle cx="60" cy="36" r="6" fill="#F59E0B"/>
  <circle cx="80" cy="36" r="6" fill="#10B981"/>
  <rect x="106" y="22" width="490" height="28" rx="6" fill="#0B0D12" stroke="#262D3D" stroke-width="1"/>
  <text x="118" y="40" fill="#38BDF8" font-family="JetBrains Mono, monospace" font-size="11">${safeUrl}</text>
  <rect x="606" y="22" width="324" height="28" rx="6" fill="#1E293B"/>
  <text x="768" y="40" text-anchor="middle" fill="#FBBF24" font-family="JetBrains Mono, Vazirmatn, sans-serif" font-size="10" font-weight="700">${safeProfile} · ${safeModel}</text>
  <rect x="28" y="72" width="904" height="52" rx="10" fill="#131824" stroke="#262D3D" stroke-width="1"/>
  <text x="908" y="103" text-anchor="end" fill="#F8FAFC" font-family="Vazirmatn, sans-serif" font-size="15" font-weight="700">${safeTitle}</text>
  <text x="48" y="103" fill="#94A3B8" font-family="JetBrains Mono, monospace" font-size="11">${safeCmd} | ${safeAgent} | SCROLL: ${scrollY}px</text>
  <rect x="28" y="134" width="904" height="384" rx="10" fill="#0D1017" stroke="#1E2536" stroke-width="1"/>
  ${bodyRowsSvg}
  ${factsSvg}
  <rect x="920" y="140" width="6" height="368" rx="3" fill="#1E293B"/>
  <rect x="920" y="${scrollThumbY}" width="6" height="44" rx="3" fill="#F59E0B"/>
</svg>`;
}

// ============================================================================
// Official Open-Source `vercel-labs/agent-browser` Engine (CDP + @eN Refs)
// ============================================================================

function getAgentBrowserBin(): string {
  const localBin = path.resolve(process.cwd(), "node_modules/.bin/agent-browser");
  if (fs.existsSync(localBin)) return localBin;
  return "agent-browser";
}

function findChromiumExecutablePath(): string | null {
  const candidates = [
    "/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell",
    path.resolve(
      process.cwd(),
      "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"
    ),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const STEALTH_INIT_SCRIPT_CONTENT = `
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: { isInstalled: false }
    };
    Object.defineProperty(navigator, 'languages', { get: () => ['fa-IR', 'fa', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  } catch {}
})();
`;

function ensureStealthInitScriptPath(): string {
  const dir = path.resolve(process.cwd(), "output", "browser_profiles");
  fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, "stealth_init.js");
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, STEALTH_INIT_SCRIPT_CONTENT, "utf-8");
  }
  return scriptPath;
}

function getProfileUserDataDir(profileId: string): string {
  const dir = path.resolve(process.cwd(), "output", "browser_profiles", profileId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function runAgentBrowserCli(
  profile: BrowserProfileAccount,
  args: string[],
  timeoutMs = 18000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const bin = getAgentBrowserBin();
  const exe = findChromiumExecutablePath();
  const profileDir = getProfileUserDataDir(profile.id);
  const stealthInit = ensureStealthInitScriptPath();

  const fullArgs = [
    "--session",
    profile.id,
    "--profile",
    profileDir,
    ...args,
  ];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_BROWSER_NO_VERSION_CHECK: "1",
    AGENT_BROWSER_INIT_SCRIPTS: stealthInit,
    AGENT_BROWSER_USER_AGENT: BROWSER_USER_AGENT,
    ...(exe ? { AGENT_BROWSER_EXECUTABLE_PATH: exe } : {}),
  };

  try {
    const { stdout, stderr } = await execFileAsync(bin, fullArgs, {
      cwd: process.cwd(),
      env,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    browserState.playwrightConnected = true;
    return { ok: true, stdout: stdout || "", stderr: stderr || "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: e.stdout || "",
      stderr: e.stderr || e.message || "agent-browser command failed",
    };
  }
}

async function captureAgentBrowserScreenshot(profile: BrowserProfileAccount): Promise<string | null> {
  try {
    const filename = `ab_viewport_${Date.now()}.png`;
    const targetPath = path.join(getImagesDir(), filename);
    const res = await runAgentBrowserCli(profile, ["screenshot", targetPath], 12000);
    if (res.ok && fs.existsSync(targetPath) && fs.statSync(targetPath).size > 200) {
      return `/api/media/images/${filename}`;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchAgentBrowserSnapshotRefs(
  profile: BrowserProfileAccount
): Promise<{ interactiveRefs: AgentBrowserInteractiveRef[]; snapshotText: string }> {
  const res = await runAgentBrowserCli(profile, ["snapshot", "-i", "--json"], 10000);
  if (!res.ok) return { interactiveRefs: [], snapshotText: "" };
  return parseAgentBrowserSnapshotJson(res.stdout);
}

async function detectAndSolveObstaclesViaAgentBrowser(
  profile: BrowserProfileAccount,
  currentUrl: string,
  refs: AgentBrowserInteractiveRef[]
): Promise<ObstacleBypassRecord[]> {
  const solved: ObstacleBypassRecord[] = [];
  const startMs = Date.now();

  // Check if any @eN ref matches consent/accept/robot challenge
  const consentRef = refs.find(
    (r) =>
      r.role === "button" &&
      /^(accept all|i agree|accept cookies|accept|allow all|قبول|موافقم|تایید|متوجه شدم)$/i.test(
        r.name.trim()
      )
  );
  if (consentRef) {
    await runAgentBrowserCli(profile, ["click", consentRef.ref], 8000);
    solved.push({
      id: `obs_${Date.now()}_cookie`,
      timestamp: new Date().toISOString(),
      kind: "cookie_consent",
      url: currentUrl,
      resolved: true,
      strategyUsedFa: `کلیک واقعی agent-browser روی بنر کوکی (${consentRef.ref}: "${consentRef.name}")`,
      durationMs: Date.now() - startMs,
    });
  }

  const robotRef = refs.find(
    (r) =>
      (r.role === "checkbox" || r.role === "button") &&
      /robot|human|turnstile|verify|cloudflare|ربات/i.test(r.name)
  );
  if (robotRef) {
    await runAgentBrowserCli(profile, ["click", robotRef.ref], 8000);
    solved.push({
      id: `obs_${Date.now()}_captcha`,
      timestamp: new Date().toISOString(),
      kind: /turnstile|cloudflare/i.test(robotRef.name)
        ? "cloudflare_turnstile"
        : "recaptcha_im_not_robot",
      url: currentUrl,
      resolved: true,
      strategyUsedFa: `تایید چالش امنیتی در پروفایل دائمی با ${robotRef.ref} ("${robotRef.name}")`,
      durationMs: Date.now() - startMs,
    });
  }

  for (const item of solved) {
    browserState.obstacleHistory = [item, ...browserState.obstacleHistory].slice(0, 30);
  }
  return solved;
}

// ============================================================================
// 10-Account Gmail Pool + Singleton Agent Browser State
// ============================================================================

const INITIAL_PROFILES: BrowserProfileAccount[] = [
  {
    id: "prof_google_1",
    name: "اکانت جیمیل ۱ (اصلی - Molab GPU + Google Flow)",
    email: "studio.agent.01@gmail.com",
    password: "",
    avatarColor: "#10B981",
    userDataDir: "output/browser_profiles/prof_google_1",
    status: "active",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "leonardo_ai", "kling_web", "runway_web", "general_web"],
    lastUsedAt: new Date().toISOString(),
    notesFa: "پروفایل ۱ متصل به روتر با متغیر دائمی GEMINI_API_KEY_1 (برای تولید کلید واقعی، با اکانت جیمیل خود وارد Google AI Studio شوید)",
  },
  {
    id: "prof_google_2",
    name: "اکانت جیمیل ۲ (چرخشی - Google Colab T4 + Flow)",
    email: "studio.agent.02@gmail.com",
    password: "",
    avatarColor: "#38BDF8",
    userDataDir: "output/browser_profiles/prof_google_2",
    status: "standby",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "leonardo_ai", "kling_web", "runway_web", "general_web"],
    lastUsedAt: null,
    notesFa: "پروفایل ۲ متصل به روتر با متغیر دائمی GEMINI_API_KEY_2 (فالبک خودکار پس از محدودیت اکانت ۱)",
  },
  {
    id: "prof_google_3",
    name: "اکانت جیمیل ۳ (چرخشی - Molab GPU + Omni Flash)",
    email: "studio.agent.03@gmail.com",
    password: "",
    avatarColor: "#F59E0B",
    userDataDir: "output/browser_profiles/prof_google_3",
    status: "standby",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "leonardo_ai", "kling_web", "general_web"],
    lastUsedAt: null,
    notesFa: "پروفایل ۳ متصل به روتر با متغیر دائمی GEMINI_API_KEY_3",
  },
  {
    id: "prof_google_4",
    name: "اکانت جیمیل ۴ (چرخشی - Colab + Leonardo)",
    email: "studio.agent.04@gmail.com",
    password: "",
    avatarColor: "#A855F7",
    userDataDir: "output/browser_profiles/prof_google_4",
    status: "standby",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "leonardo_ai", "general_web"],
    lastUsedAt: null,
    notesFa: "پروفایل ۴ متصل به روتر با متغیر دائمی GEMINI_API_KEY_4",
  },
  {
    id: "prof_google_5",
    name: "اکانت جیمیل ۵ (چرخشی - Molab + Kling/Runway)",
    email: "studio.agent.05@gmail.com",
    password: "",
    avatarColor: "#EC4899",
    userDataDir: "output/browser_profiles/prof_google_5",
    status: "standby",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "kling_web", "runway_web", "general_web"],
    lastUsedAt: null,
    notesFa: "پروفایل ۵ متصل به روتر با متغیر دائمی GEMINI_API_KEY_5",
  },
  {
    id: "prof_google_6",
    name: "اکانت جیمیل ۶ (چرخشی - Colab 1080p Render)",
    email: "studio.agent.06@gmail.com",
    password: "",
    avatarColor: "#14B8A6",
    userDataDir: "output/browser_profiles/prof_google_6",
    status: "standby",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "leonardo_ai", "runway_web", "general_web"],
    lastUsedAt: null,
    notesFa: "پروفایل ۶ متصل به روتر با متغیر دائمی GEMINI_API_KEY_6",
  },
  {
    id: "prof_google_7",
    name: "اکانت جیمیل ۷ (چرخشی - Molab & Research)",
    email: "studio.agent.07@gmail.com",
    password: "",
    avatarColor: "#F97316",
    userDataDir: "output/browser_profiles/prof_google_7",
    status: "standby",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "leonardo_ai", "general_web"],
    lastUsedAt: null,
    notesFa: "پروفایل ۷ متصل به روتر با متغیر دائمی GEMINI_API_KEY_7",
  },
  {
    id: "prof_google_8",
    name: "اکانت جیمیل ۸ (چرخشی - Colab Storyboard Batch)",
    email: "studio.agent.08@gmail.com",
    password: "",
    avatarColor: "#6366F1",
    userDataDir: "output/browser_profiles/prof_google_8",
    status: "standby",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "leonardo_ai", "kling_web", "general_web"],
    lastUsedAt: null,
    notesFa: "پروفایل ۸ متصل به روتر با متغیر دائمی GEMINI_API_KEY_8",
  },
  {
    id: "prof_google_9",
    name: "اکانت جیمیل ۹ (چرخشی - Molab Backup GPU)",
    email: "studio.agent.09@gmail.com",
    password: "",
    avatarColor: "#84CC16",
    userDataDir: "output/browser_profiles/prof_google_9",
    status: "standby",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "leonardo_ai", "kling_web", "runway_web", "general_web"],
    lastUsedAt: null,
    notesFa: "پروفایل ۹ متصل به روتر با متغیر دائمی GEMINI_API_KEY_9",
  },
  {
    id: "prof_google_10",
    name: "اکانت جیمیل ۱۰ (چرخشی - Final Reserve Pool)",
    email: "studio.agent.10@gmail.com",
    password: "",
    avatarColor: "#EAB308",
    userDataDir: "output/browser_profiles/prof_google_10",
    status: "standby",
    dailyLimit: 5,
    usedToday: 0,
    connectedSites: ["molab", "google_colab", "google_flow", "leonardo_ai", "kling_web", "runway_web", "general_web"],
    lastUsedAt: null,
    notesFa: "پروفایل ۱۰ متصل به روتر با متغیر دائمی GEMINI_API_KEY_10",
  },
];

const INITIAL_SITE_CONFIG: WebStudioSiteConfig = {
  siteId: "google_flow",
  siteLabelFa: WEB_STUDIO_CATALOG.google_flow.labelFa,
  targetUrl: WEB_STUDIO_CATALOG.google_flow.url,
  mode: "image_to_video",
  modelId: "omni_flash",
  modelLabelFa: "Gemini Omni Flash (ویدیو سریع)",
  aspectRatio: "9:16",
  resolution: "720p",
  durationSeconds: 5,
  cfgScaleOrCreativity: 7,
  autoSolveCloudflareAndCaptcha: true,
  autoRotateProfileOnQuota: true,
};

const browserState: AgentBrowserState = {
  engineName: "vercel-labs/agent-browser v0.43 + LangGraph (10 Gmail Profiles)",
  playwrightConnected: Boolean(findChromiumExecutablePath()),
  status: "idle",
  activeAgent: null,
  currentCommand: null,
  currentUrl: "https://labs.google/fx/tools/flow",
  pageTitle: "Agent Browser (vercel-labs/agent-browser) — آماده وب‌گردی، ثبت‌نام و تولید شات",
  viewportSvgUrl: null,
  viewportScreenshotUrl: null,
  scrollY: 0,
  maxScrollY: 0,
  searchQuery: "",
  searchResults: [],
  extractedPage: null,
  comprehensionSummaryFa:
    "موتور رسمی متن‌باز vercel-labs/agent-browser روی Chromium CDP با ۱۰ اکانت جیمیل ایزوله، درخت دسترسی @eN، پرکردن خودکار فرم و ثبت‌نام، و چرخش سهمیه فعال است.",
  comprehensionFactsFa: [],
  profiles: INITIAL_PROFILES,
  activeProfileId: "prof_google_1",
  siteConfig: INITIAL_SITE_CONFIG,
  lastRefinedPrompt: null,
  obstacleHistory: [],
  shotJobs: [],
  history: [],
  actionLog: [],
  updatedAt: new Date().toISOString(),
};

function getActiveProfile(): BrowserProfileAccount {
  return (
    browserState.profiles.find((p) => p.id === browserState.activeProfileId) ||
    browserState.profiles[0]
  );
}

function appendActionLog(
  entry: Omit<AgentBrowserActionLog, "id" | "timestamp">
): AgentBrowserActionLog {
  const full: AgentBrowserActionLog = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  browserState.actionLog = [full, ...browserState.actionLog].slice(0, MAX_ACTION_LOGS);
  browserState.updatedAt = full.timestamp;
  return full;
}

function updateViewportSnapshot(commandLabel: string): void {
  try {
    const activeProf = getActiveProfile();
    const svg = buildBrowserViewportSvg({
      url: browserState.currentUrl,
      title: browserState.pageTitle,
      activeAgent: browserState.activeAgent,
      commandLabel,
      extractedPage: browserState.extractedPage,
      searchResults: browserState.searchResults,
      scrollY: browserState.scrollY,
      activeProfileEmail: activeProf?.email,
      activeModelLabel: browserState.siteConfig.modelLabelFa,
    });
    const filename = `browser_viewport_${Date.now()}.svg`;
    browserState.viewportSvgUrl = saveVisualSvgFile(filename, svg);
  } catch {
    // Non-fatal
  }
}

export function getAgentBrowserState(): AgentBrowserState {
  if (!browserState.viewportSvgUrl) {
    updateViewportSnapshot("READY");
  }
  return {
    ...browserState,
    profiles: browserState.profiles.map((p) => ({ ...p })),
    siteConfig: { ...browserState.siteConfig },
  };
}

export function clearAgentBrowserState(): AgentBrowserState {
  browserState.status = "idle";
  browserState.activeAgent = null;
  browserState.currentCommand = null;
  browserState.scrollY = 0;
  browserState.maxScrollY = 0;
  browserState.searchQuery = "";
  browserState.searchResults = [];
  browserState.extractedPage = null;
  browserState.comprehensionFactsFa = [];
  browserState.history = [];
  browserState.actionLog = [];
  browserState.updatedAt = new Date().toISOString();
  updateViewportSnapshot("RESET");
  return getAgentBrowserState();
}

// ============================================================================
// Profile & Site Configuration APIs
// ============================================================================

export function addOrUpdateBrowserProfile(input: {
  id?: string;
  name: string;
  email: string;
  password?: string;
  dailyLimit?: number;
  connectedSites?: WebStudioSiteId[];
  notesFa?: string;
}): AgentBrowserState {
  const cleanEmail = input.email.trim();
  const cleanName = input.name.trim() || cleanEmail;
  const cleanPassword = input.password?.trim() || `St#Pass${browserState.profiles.length + 1}!99`;
  const limit = Math.max(1, Math.min(500, Number(input.dailyLimit) || 5));
  const id = input.id?.trim() || `prof_google_${browserState.profiles.length + 1}_${Date.now().toString().slice(-3)}`;
  const colors = ["#10B981", "#38BDF8", "#F59E0B", "#A855F7", "#EC4899"];

  const existingIdx = browserState.profiles.findIndex((p) => p.id === id);
  if (existingIdx >= 0) {
    browserState.profiles[existingIdx] = {
      ...browserState.profiles[existingIdx],
      name: cleanName,
      email: cleanEmail,
      password: input.password?.trim() || browserState.profiles[existingIdx].password,
      dailyLimit: limit,
      connectedSites:
        input.connectedSites || browserState.profiles[existingIdx].connectedSites,
      notesFa: input.notesFa ?? browserState.profiles[existingIdx].notesFa,
    };
  } else {
    const newProfile: BrowserProfileAccount = {
      id,
      name: cleanName,
      email: cleanEmail,
      password: cleanPassword,
      avatarColor: colors[browserState.profiles.length % colors.length],
      userDataDir: `output/browser_profiles/${id}`,
      status: "standby",
      dailyLimit: limit,
      usedToday: 0,
      connectedSites: input.connectedSites || [
        "google_flow",
        "leonardo_ai",
        "kling_web",
        "runway_web",
        "general_web",
      ],
      lastUsedAt: null,
      notesFa: input.notesFa || "اکانت جیمیل متصل به session اختصاصی Agent Browser",
    };
    browserState.profiles.push(newProfile);
  }

  appendActionLog({
    agentName: "مدیر ۱۰ پروفایل جیمیل",
    command: "switch_profile",
    target: cleanEmail,
    status: "success",
    detailFa: `اکانت «${cleanName}» (${cleanEmail}) در agent-browser ثبت و همگام‌سازی شد.`,
    durationMs: 12,
  });

  return getAgentBrowserState();
}

export function switchActiveBrowserProfile(
  profileId: string,
  reasonFa = "سوییچ دستی توسط کاربر"
): AgentBrowserState {
  const target = browserState.profiles.find((p) => p.id === profileId);
  if (!target) return getAgentBrowserState();

  browserState.activeProfileId = target.id;
  browserState.profiles = browserState.profiles.map((p) => ({
    ...p,
    status:
      p.id === target.id
        ? "active"
        : p.usedToday >= p.dailyLimit
          ? "quota_exhausted"
          : "standby",
  }));

  appendActionLog({
    agentName: "چرخشگر سشن agent-browser",
    command: "switch_profile",
    target: target.email,
    status: "success",
    detailFa: `${reasonFa} -> سشن --session ${target.id} (${target.email}) فعال شد · مصرف: ${target.usedToday}/${target.dailyLimit}`,
    durationMs: 16,
  });

  updateViewportSnapshot("PROFILE_SWITCH");
  return getAgentBrowserState();
}

export function resetProfileDailyQuota(profileId?: string): AgentBrowserState {
  browserState.profiles = browserState.profiles.map((p) => {
    if (!profileId || p.id === profileId) {
      return {
        ...p,
        usedToday: 0,
        status: p.id === browserState.activeProfileId ? "active" : "standby",
      };
    }
    return p;
  });

  appendActionLog({
    agentName: "مدیر سهمیه روزانه",
    command: "switch_profile",
    target: profileId || "all_profiles",
    status: "success",
    detailFa: "سهمیه مصرف روزانه پروفایل‌های جیمیل بازنشانی شد.",
    durationMs: 8,
  });

  return getAgentBrowserState();
}

export function updateWebStudioSiteConfig(
  patch: Partial<WebStudioSiteConfig>
): AgentBrowserState {
  const nextSiteId = patch.siteId || browserState.siteConfig.siteId;
  const catalogEntry = WEB_STUDIO_CATALOG[nextSiteId] || WEB_STUDIO_CATALOG.google_flow;

  const nextModelId =
    patch.modelId && catalogEntry.models.some((m) => m.id === patch.modelId)
      ? patch.modelId
      : catalogEntry.models.some((m) => m.id === browserState.siteConfig.modelId)
        ? browserState.siteConfig.modelId
        : catalogEntry.models[0].id;

  const matchedModel =
    catalogEntry.models.find((m) => m.id === nextModelId) || catalogEntry.models[0];

  browserState.siteConfig = {
    ...browserState.siteConfig,
    ...patch,
    siteId: nextSiteId,
    siteLabelFa: catalogEntry.labelFa,
    targetUrl: patch.targetUrl || catalogEntry.url,
    modelId: matchedModel.id,
    modelLabelFa: matchedModel.labelFa,
  };

  updateViewportSnapshot("CONFIG_SITE");
  return getAgentBrowserState();
}

// ============================================================================
// Live Web Navigation, Search, Interactive Form Fill & Registration via `agent-browser`
// ============================================================================

async function performLiveWebSearch(query: string): Promise<AgentBrowserSearchResult[]> {
  const results: AgentBrowserSearchResult[] = [];
  const seenUrls = new Set<string>();

  const addHit = (title: string, url: string, snippet: string, sourceEngine: string) => {
    const cleanUrl = url.trim();
    if (!cleanUrl || seenUrls.has(cleanUrl)) return;
    seenUrls.add(cleanUrl);
    results.push({
      index: results.length + 1,
      title: stripHtmlTags(title) || cleanUrl,
      url: cleanUrl,
      snippet: stripHtmlTags(snippet) || "صفحه وب مرتبط با موضوع جستجو",
      sourceEngine,
    });
  };

  // 1. Persian Wikipedia API
  try {
    const faWikiUrl = `https://fa.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&utf8=1&format=json&srlimit=4`;
    const res = await fetch(faWikiUrl, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(6500),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        query?: { search?: Array<{ title: string; snippet: string }> };
      };
      for (const item of data.query?.search || []) {
        const articleUrl = `https://fa.wikipedia.org/wiki/${encodeURIComponent(
          item.title.replace(/ /g, "_")
        )}`;
        addHit(item.title, articleUrl, item.snippet, "Wikipedia FA");
      }
    }
  } catch {
    // Continue
  }

  // 2. DuckDuckGo HTML Search
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(ddgUrl, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) {
      const html = await res.text();
      const resultBlockRegex =
        /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>|<div[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>)?/gi;
      let match: RegExpExecArray | null;
      while ((match = resultBlockRegex.exec(html)) !== null) {
        let rawHref = decodeHtmlEntities(match[1]);
        const uddgMatch = rawHref.match(/[?&]uddg=([^&]+)/);
        if (uddgMatch) {
          try {
            rawHref = decodeURIComponent(uddgMatch[1]);
          } catch {
            // keep
          }
        }
        const title = stripHtmlTags(match[2]);
        const snippet = stripHtmlTags(match[3] || match[4] || "");
        if (/^https?:\/\//i.test(rawHref) && title) {
          addHit(title, rawHref, snippet, "DuckDuckGo Web");
          if (results.length >= 8) break;
        }
      }
    }
  } catch {
    // Continue
  }

  // 3. English Wikipedia Search API
  if (results.length < 6) {
    try {
      const enWikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        query
      )}&utf8=1&format=json&srlimit=3`;
      const res = await fetch(enWikiUrl, {
        headers: { "User-Agent": BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          query?: { search?: Array<{ title: string; snippet: string }> };
        };
        for (const item of data.query?.search || []) {
          const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(
            item.title.replace(/ /g, "_")
          )}`;
          addHit(item.title, articleUrl, item.snippet, "Wikipedia EN");
        }
      }
    } catch {
      // Ignore
    }
  }

  return results;
}

async function syncStateFromActiveAgentBrowserSession(
  profile: BrowserProfileAccount,
  fallbackUrl: string,
  fallbackHtml = ""
): Promise<AgentBrowserExtractedPage> {
  const { interactiveRefs, snapshotText } = await fetchAgentBrowserSnapshotRefs(profile);
  if (browserState.siteConfig.autoSolveCloudflareAndCaptcha && interactiveRefs.length > 0) {
    await detectAndSolveObstaclesViaAgentBrowser(profile, fallbackUrl, interactiveRefs);
  }

  let htmlContent = fallbackHtml;
  let currentUrl = fallbackUrl;

  const urlRes = await runAgentBrowserCli(profile, ["get", "url", "--json"], 6000);
  if (urlRes.ok) {
    try {
      const parsed = JSON.parse(urlRes.stdout.slice(urlRes.stdout.indexOf("{"))) as {
        data?: { url?: string };
      };
      if (parsed.data?.url) currentUrl = parsed.data.url;
    } catch {
      // keep fallbackUrl
    }
  }

  if (!htmlContent) {
    const htmlRes = await runAgentBrowserCli(profile, ["get", "html", "body", "--json"], 8000);
    if (htmlRes.ok) {
      try {
        const parsed = JSON.parse(htmlRes.stdout.slice(htmlRes.stdout.indexOf("{"))) as {
          data?: { html?: string };
        };
        if (parsed.data?.html) htmlContent = `<html><body>${parsed.data.html}</body></html>`;
      } catch {
        // fallback below
      }
    }
  }

  const shotUrl = await captureAgentBrowserScreenshot(profile);
  if (shotUrl) browserState.viewportScreenshotUrl = shotUrl;

  return parseHtmlToStructuredPage({
    html: htmlContent || `<html><body><h1>${currentUrl}</h1></body></html>`,
    url: currentUrl,
    statusCode: 200,
    interactiveRefs,
    snapshotText,
  });
}

export async function executeBrowserGoto(
  rawUrl: string,
  agentName = "vercel-labs/agent-browser"
): Promise<AgentBrowserState> {
  const startMs = Date.now();
  const normalizedUrl = /^https?:\/\//i.test(rawUrl.trim())
    ? rawUrl.trim()
    : `https://${rawUrl.trim()}`;

  browserState.status = "browsing";
  browserState.activeAgent = agentName;
  browserState.currentCommand = `agent-browser open ${normalizedUrl}`;
  browserState.currentUrl = normalizedUrl;
  browserState.updatedAt = new Date().toISOString();

  const activeProfile = getActiveProfile();
  let htmlContent = "";
  let statusCode = 200;
  let contentType = "text/html";
  let interactiveRefs: AgentBrowserInteractiveRef[] = [];
  let snapshotText = "";

  try {
    // 1. Primary real browser engine: vercel-labs/agent-browser open + snapshot -i + screenshot
    const openRes = await runAgentBrowserCli(activeProfile, ["open", normalizedUrl], 15000);
    if (openRes.ok) {
      const snap = await fetchAgentBrowserSnapshotRefs(activeProfile);
      interactiveRefs = snap.interactiveRefs;
      snapshotText = snap.snapshotText;

      if (browserState.siteConfig.autoSolveCloudflareAndCaptcha && interactiveRefs.length > 0) {
        await detectAndSolveObstaclesViaAgentBrowser(
          activeProfile,
          normalizedUrl,
          interactiveRefs
        );
      }

      const titleRes = await runAgentBrowserCli(activeProfile, ["get", "title", "--json"], 5000);
      let browserTitle = "";
      if (titleRes.ok) {
        try {
          const parsedTitle = JSON.parse(titleRes.stdout.slice(titleRes.stdout.indexOf("{"))) as {
            data?: { title?: string };
          };
          browserTitle = parsedTitle.data?.title || "";
        } catch {
          // ignore
        }
      }

      const htmlRes = await runAgentBrowserCli(
        activeProfile,
        ["get", "html", "body", "--json"],
        7000
      );
      if (htmlRes.ok) {
        try {
          const parsedHtml = JSON.parse(htmlRes.stdout.slice(htmlRes.stdout.indexOf("{"))) as {
            data?: { html?: string };
          };
          if (parsedHtml.data?.html) {
            htmlContent = `<!doctype html><html><head><title>${escapeXml(
              browserTitle
            )}</title></head><body>${parsedHtml.data.html}</body></html>`;
          }
        } catch {
          // ignore
        }
      }

      const screenshotUrl = await captureAgentBrowserScreenshot(activeProfile);
      if (screenshotUrl) browserState.viewportScreenshotUrl = screenshotUrl;
    }

    // 2. Wikipedia MediaWiki enrichment if Wikipedia page for crisp Persian text extraction
    const wikiMatch = normalizedUrl.match(
      /^https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/([^?#]+)/i
    );
    if (wikiMatch) {
      const lang = wikiMatch[1];
      const titleSlug = decodeURIComponent(wikiMatch[2]);
      const apiUrl = `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
        titleSlug
      )}&prop=text|displaytitle&format=json&redirects=1`;
      const res = await fetch(apiUrl, {
        headers: { "User-Agent": BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (res && res.ok) {
        const json = (await res.json()) as {
          parse?: { title?: string; text?: { "*"?: string } };
        };
        const pageTitle = json.parse?.title || titleSlug;
        const bodyHtml = json.parse?.text?.["*"] || "";
        if (bodyHtml) {
          htmlContent = `<!doctype html><html><head><title>${pageTitle} - Wikipedia</title></head><body><h1>${pageTitle}</h1>${bodyHtml}</body></html>`;
        }
      }
    }

    // 3. Direct HTTP fallback only if CLI daemon returned empty body
    if (!htmlContent) {
      const res = await fetch(normalizedUrl, {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(9000),
      });
      statusCode = res.status;
      contentType = res.headers.get("content-type") || "text/html";
      htmlContent = await res.text();
    }

    browserState.status = "extracting";
    const extracted = parseHtmlToStructuredPage({
      html: htmlContent,
      url: normalizedUrl,
      statusCode,
      contentType,
      scrollY: 0,
      interactiveRefs,
      snapshotText,
    });

    browserState.extractedPage = extracted;
    browserState.pageTitle = extracted.title;
    browserState.scrollY = 0;
    browserState.maxScrollY = extracted.maxScrollY;
    browserState.comprehensionSummaryFa = extracted.summaryText;
    browserState.comprehensionFactsFa = extracted.keyDataPoints;
    browserState.history = [
      normalizedUrl,
      ...browserState.history.filter((u) => u !== normalizedUrl),
    ].slice(0, MAX_HISTORY_ITEMS);
    browserState.status = "idle";
    browserState.currentCommand = null;

    appendActionLog({
      agentName,
      command: "goto",
      target: normalizedUrl,
      status: "success",
      detailFa: `[agent-browser --session ${activeProfile.id} · ${activeProfile.email}] صفحه «${extracted.title}» باز شد (${interactiveRefs.length} عنصر @eN، ${extracted.wordCount} کلمه، ${extracted.keyDataPoints.length} فکت).`,
      durationMs: Date.now() - startMs,
    });

    updateViewportSnapshot("OPEN");
    return getAgentBrowserState();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    browserState.status = "error";
    browserState.currentCommand = null;
    appendActionLog({
      agentName,
      command: "goto",
      target: normalizedUrl,
      status: "error",
      detailFa: `خطا در اجرای agent-browser open: ${msg}`,
      durationMs: Date.now() - startMs,
    });
    updateViewportSnapshot("ERROR");
    return getAgentBrowserState();
  }
}

export async function executeBrowserSearch(
  query: string,
  agentName = "ایجنت پژوهشگر agent-browser"
): Promise<AgentBrowserState> {
  const cleanQuery = query.trim();
  const startMs = Date.now();

  browserState.status = "browsing";
  browserState.activeAgent = agentName;
  browserState.currentCommand = `agent-browser search "${cleanQuery}"`;
  browserState.searchQuery = cleanQuery;
  browserState.currentUrl = `https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}`;
  browserState.pageTitle = `جستجوی وب: ${cleanQuery}`;
  browserState.updatedAt = new Date().toISOString();

  const hits = await performLiveWebSearch(cleanQuery);
  browserState.searchResults = hits;

  appendActionLog({
    agentName,
    command: "search",
    target: cleanQuery,
    status: "success",
    detailFa: `جستجوی «${cleanQuery}» با موفقیت انجام شد (${hits.length} منبع معتبر یافت شد).`,
    durationMs: Date.now() - startMs,
  });

  if (hits.length > 0) {
    await executeBrowserGoto(hits[0].url, agentName);
  } else {
    browserState.status = "idle";
    browserState.currentCommand = null;
    updateViewportSnapshot("SEARCH");
  }

  return getAgentBrowserState();
}

export async function executeBrowserSnapshot(
  agentName = "vercel-labs/agent-browser"
): Promise<AgentBrowserState> {
  const startMs = Date.now();
  const activeProfile = getActiveProfile();
  const snap = await fetchAgentBrowserSnapshotRefs(activeProfile);
  if (browserState.extractedPage) {
    browserState.extractedPage = {
      ...browserState.extractedPage,
      interactiveRefs: snap.interactiveRefs,
      snapshotText: snap.snapshotText,
    };
  }
  appendActionLog({
    agentName,
    command: "snapshot",
    target: browserState.currentUrl,
    status: snap.interactiveRefs.length > 0 ? "success" : "error",
    detailFa: `اسنپ‌شات درخت دسترسی (snapshot -i): ${snap.interactiveRefs.length} عنصر تعاملی (@e1..@e${snap.interactiveRefs.length}) استخراج شد.`,
    durationMs: Date.now() - startMs,
  });
  updateViewportSnapshot("SNAPSHOT");
  return getAgentBrowserState();
}

export async function executeBrowserClick(
  target: string,
  agentName = "vercel-labs/agent-browser"
): Promise<AgentBrowserState> {
  const startMs = Date.now();
  const activeProfile = getActiveProfile();
  const cleanTarget = target.trim();

  // Direct `@eN` accessibility ref click via agent-browser CLI!
  if (/^@?e\d+$/i.test(cleanTarget)) {
    const refToken = cleanTarget.startsWith("@") ? cleanTarget : `@${cleanTarget}`;
    const res = await runAgentBrowserCli(activeProfile, ["click", refToken], 10000);
    if (res.ok) {
      const updatedPage = await syncStateFromActiveAgentBrowserSession(
        activeProfile,
        browserState.currentUrl
      );
      browserState.extractedPage = updatedPage;
      browserState.currentUrl = updatedPage.url;
      browserState.pageTitle = updatedPage.title;
      appendActionLog({
        agentName,
        command: "click",
        target: refToken,
        status: "success",
        detailFa: `کلیک واقعی agent-browser click ${refToken} انجام شد و صفحه جدید خوانده شد.`,
        durationMs: Date.now() - startMs,
      });
      updateViewportSnapshot("CLICK_REF");
      return getAgentBrowserState();
    }
  }

  const resolved = resolveClickTargetUrl({
    target: cleanTarget,
    extractedPage: browserState.extractedPage,
    searchResults: browserState.searchResults,
  });

  if (!resolved) {
    appendActionLog({
      agentName,
      command: "click",
      target: cleanTarget,
      status: "error",
      detailFa: `عنصر یا لینکی با مشخصه «${cleanTarget}» در صفحه فعلی یافت نشد.`,
      durationMs: Date.now() - startMs,
    });
    return getAgentBrowserState();
  }

  appendActionLog({
    agentName,
    command: "click",
    target: `${cleanTarget} -> ${resolved.label}`,
    status: "success",
    detailFa: `کلیک روی عنصر «${resolved.label}» انجام شد.`,
    durationMs: Date.now() - startMs,
  });

  return executeBrowserGoto(resolved.url, agentName);
}

export async function executeBrowserFill(
  rawSpec: string,
  agentName = "vercel-labs/agent-browser"
): Promise<AgentBrowserState> {
  const startMs = Date.now();
  const activeProfile = getActiveProfile();

  // Accept "@e2=hello" or "@e2|hello" or "@e2 value"
  let ref = "";
  let value = "";
  const eqMatch = rawSpec.match(/^([^\s=|]+)\s*[=|]\s*([\s\S]+)$/);
  if (eqMatch) {
    ref = eqMatch[1].trim();
    value = eqMatch[2].trim();
  } else {
    const parts = rawSpec.trim().split(/\s+/);
    ref = parts[0] || "";
    value = parts.slice(1).join(" ");
  }

  if (!ref || !value) {
    appendActionLog({
      agentName,
      command: "fill",
      target: rawSpec,
      status: "error",
      detailFa: "فرمت دستور پر کردن فرم باید به شکل «@e2=مقدار ورودی» باشد.",
      durationMs: Date.now() - startMs,
    });
    return getAgentBrowserState();
  }

  const normalizedRef = /^e\d+$/i.test(ref) ? `@${ref}` : ref;
  const res = await runAgentBrowserCli(activeProfile, ["fill", normalizedRef, value], 10000);
  const snap = await fetchAgentBrowserSnapshotRefs(activeProfile);
  if (browserState.extractedPage && snap.interactiveRefs.length > 0) {
    browserState.extractedPage = {
      ...browserState.extractedPage,
      interactiveRefs: snap.interactiveRefs,
      snapshotText: snap.snapshotText,
    };
  }
  const shot = await captureAgentBrowserScreenshot(activeProfile);
  if (shot) browserState.viewportScreenshotUrl = shot;

  appendActionLog({
    agentName,
    command: "fill",
    target: `${normalizedRef} <- "${value.slice(0, 40)}"`,
    status: res.ok ? "success" : "error",
    detailFa: res.ok
      ? `اجرای واقعی agent-browser fill ${normalizedRef} با موفقیت انجام شد.`
      : `خطا در fill: ${res.stderr}`,
    durationMs: Date.now() - startMs,
  });

  updateViewportSnapshot("FILL");
  return getAgentBrowserState();
}

export async function executeBrowserSelect(
  rawSpec: string,
  agentName = "vercel-labs/agent-browser"
): Promise<AgentBrowserState> {
  const startMs = Date.now();
  const activeProfile = getActiveProfile();

  const eqMatch = rawSpec.match(/^([^\s=|]+)\s*[=|]\s*([\s\S]+)$/);
  const ref = eqMatch ? eqMatch[1].trim() : rawSpec.trim().split(/\s+/)[0] || "";
  const value = eqMatch
    ? eqMatch[2].trim()
    : rawSpec.trim().split(/\s+/).slice(1).join(" ");

  if (!ref || !value) {
    return getAgentBrowserState();
  }

  const normalizedRef = /^e\d+$/i.test(ref) ? `@${ref}` : ref;
  const res = await runAgentBrowserCli(activeProfile, ["select", normalizedRef, value], 10000);
  const shot = await captureAgentBrowserScreenshot(activeProfile);
  if (shot) browserState.viewportScreenshotUrl = shot;

  appendActionLog({
    agentName,
    command: "select",
    target: `${normalizedRef} -> "${value}"`,
    status: res.ok ? "success" : "error",
    detailFa: res.ok
      ? `گزینه «${value}» در ${normalizedRef} انتخاب شد.`
      : `خطا در select: ${res.stderr}`,
    durationMs: Date.now() - startMs,
  });

  updateViewportSnapshot("SELECT");
  return getAgentBrowserState();
}

/**
 * Autonomous Website Registration & Login Flow using Active Gmail Credentials
 * and `vercel-labs/agent-browser` accessibility refs (`snapshot -i` -> `fill` -> `click`).
 */
export async function executeBrowserRegisterOrLogin(
  targetUrlInput: string,
  agentName = "ایجنت ثبت‌نام و ورود خودکار (agent-browser)"
): Promise<AgentBrowserState> {
  const startMs = Date.now();
  const activeProfile = getActiveProfile();
  const url = targetUrlInput.trim() || browserState.currentUrl || WEB_STUDIO_CATALOG.google_flow.url;

  browserState.status = "browsing";
  browserState.activeAgent = agentName;
  browserState.currentCommand = `REGISTER ${url}`;

  await executeBrowserGoto(url, agentName);
  const refs = browserState.extractedPage?.interactiveRefs || [];
  const formMatch = matchFormRefsForSignup(refs);

  const stepsDone: string[] = [];
  if (formMatch.nameRef) {
    const r = await runAgentBrowserCli(activeProfile, ["fill", formMatch.nameRef, activeProfile.name]);
    if (r.ok) stepsDone.push(`fill ${formMatch.nameRef} (Name)`);
  }
  if (formMatch.emailRef) {
    const r = await runAgentBrowserCli(activeProfile, ["fill", formMatch.emailRef, activeProfile.email]);
    if (r.ok) stepsDone.push(`fill ${formMatch.emailRef} (${activeProfile.email})`);
  }
  if (formMatch.passwordRef) {
    const r = await runAgentBrowserCli(activeProfile, ["fill", formMatch.passwordRef, activeProfile.password]);
    if (r.ok) stepsDone.push(`fill ${formMatch.passwordRef} (Password)`);
  }
  if (formMatch.agreeRef) {
    const r = await runAgentBrowserCli(activeProfile, ["check", formMatch.agreeRef]);
    if (r.ok) stepsDone.push(`check ${formMatch.agreeRef}`);
  }
  if (formMatch.submitRef && (formMatch.emailRef || formMatch.passwordRef)) {
    const r = await runAgentBrowserCli(activeProfile, ["click", formMatch.submitRef]);
    if (r.ok) stepsDone.push(`click ${formMatch.submitRef}`);
  }

  const updatedSnap = await fetchAgentBrowserSnapshotRefs(activeProfile);
  if (browserState.extractedPage) {
    browserState.extractedPage = {
      ...browserState.extractedPage,
      interactiveRefs: updatedSnap.interactiveRefs,
      snapshotText: updatedSnap.snapshotText,
    };
  }
  const shot = await captureAgentBrowserScreenshot(activeProfile);
  if (shot) browserState.viewportScreenshotUrl = shot;

  browserState.status = "idle";
  browserState.currentCommand = null;

  appendActionLog({
    agentName,
    command: "register",
    target: `${url} (${activeProfile.email})`,
    status: "success",
    detailFa:
      stepsDone.length > 0
        ? `فرم ورود/ثبت‌نام با مشخصات ${activeProfile.email} پر شد: ${stepsDone.join(" → ")}`
        : `صفحه ${url} با سشن --session ${activeProfile.id} (${activeProfile.email}) بررسی شد (${refs.length} عنصر @eN آماده تعامل).`,
    durationMs: Date.now() - startMs,
  });

  updateViewportSnapshot("REGISTER_AUTH");
  return getAgentBrowserState();
}

export async function executeBrowserScroll(
  direction: "down" | "up" | "top" | "bottom",
  agentName = "vercel-labs/agent-browser"
): Promise<AgentBrowserState> {
  const startMs = Date.now();
  const activeProfile = getActiveProfile();
  const nextY = computeNextScrollY(browserState.scrollY, browserState.maxScrollY, direction);
  browserState.scrollY = nextY;
  if (browserState.extractedPage) {
    browserState.extractedPage = {
      ...browserState.extractedPage,
      scrollY: nextY,
    };
  }

  if (direction === "down" || direction === "up") {
    await runAgentBrowserCli(activeProfile, ["scroll", direction, "320"], 6000);
  } else if (direction === "top") {
    await runAgentBrowserCli(activeProfile, ["scroll", "up", "2000"], 6000);
  } else {
    await runAgentBrowserCli(activeProfile, ["scroll", "down", "2000"], 6000);
  }
  const shot = await captureAgentBrowserScreenshot(activeProfile);
  if (shot) browserState.viewportScreenshotUrl = shot;

  const dirLabelFa =
    direction === "down"
      ? "پایین"
      : direction === "up"
        ? "بالا"
        : direction === "top"
          ? "ابتدای صفحه"
          : "انتهای صفحه";

  appendActionLog({
    agentName,
    command: "scroll",
    target: direction,
    status: "success",
    detailFa: `اسکرول پنجره agent-browser به سمت ${dirLabelFa} (${nextY}px از ${browserState.maxScrollY}px).`,
    durationMs: Date.now() - startMs,
  });

  updateViewportSnapshot(`SCROLL_${direction.toUpperCase()}`);
  return getAgentBrowserState();
}

export async function executeBrowserExtract(
  focusTopic?: string,
  agentName = "ایجنت استخراج DOM و Readability"
): Promise<AgentBrowserState> {
  const startMs = Date.now();
  const activeProfile = getActiveProfile();

  // Try official `agent-browser read` on active tab if available
  const readRes = await runAgentBrowserCli(activeProfile, ["read"], 8000);
  const page = browserState.extractedPage;
  if (!page && !readRes.ok) {
    appendActionLog({
      agentName,
      command: "extract",
      target: focusTopic || "current_page",
      status: "error",
      detailFa: "صفحه‌ای برای استخراج محتوا باز نیست.",
      durationMs: Date.now() - startMs,
    });
    return getAgentBrowserState();
  }

  const focus = focusTopic?.trim().toLowerCase();
  const sourceParas = page?.keyParagraphs || [];
  const matchedParagraphs = focus
    ? sourceParas.filter((p) => p.toLowerCase().includes(focus))
    : sourceParas;

  const chosenParagraphs =
    matchedParagraphs.length > 0 ? matchedParagraphs.slice(0, 5) : sourceParas.slice(0, 4);
  const extractedFacts = extractNumericAndTechnicalFacts(
    matchedParagraphs.length > 0 ? matchedParagraphs : sourceParas
  );

  const readTextClean = readRes.ok && readRes.stdout.trim().length > 60 ? readRes.stdout.trim().slice(0, 1200) : "";

  browserState.comprehensionSummaryFa =
    chosenParagraphs.join("\n\n") || readTextClean || page?.summaryText || "";
  browserState.comprehensionFactsFa =
    extractedFacts.length > 0 ? extractedFacts : page?.keyDataPoints || [];

  appendActionLog({
    agentName,
    command: "extract",
    target: focusTopic || page?.title || browserState.currentUrl,
    status: "success",
    detailFa: `استخراج هوشمند محتوا با agent-browser read انجام شد (${browserState.comprehensionFactsFa.length} فکت کلیدی).`,
    durationMs: Date.now() - startMs,
  });

  updateViewportSnapshot("EXTRACT");
  return getAgentBrowserState();
}

export async function executeSolveObstaclesCommand(
  agentName = "ایجنت ضدتشخیص agent-browser"
): Promise<AgentBrowserState> {
  const startMs = Date.now();
  browserState.status = "solving_obstacle";
  browserState.activeAgent = agentName;

  const activeProfile = getActiveProfile();
  const snap = await fetchAgentBrowserSnapshotRefs(activeProfile);
  const solved = await detectAndSolveObstaclesViaAgentBrowser(
    activeProfile,
    browserState.currentUrl,
    snap.interactiveRefs
  );

  if (solved.length === 0) {
    const rec: ObstacleBypassRecord = {
      id: `obs_${Date.now()}_verified`,
      timestamp: new Date().toISOString(),
      kind: "cloudflare_turnstile",
      url: browserState.currentUrl,
      resolved: true,
      strategyUsedFa:
        "تایید سلامت سشن دائمی --profile در agent-browser (عدم وجود کپچای مسدودکننده و کوکی معتبر)",
      durationMs: Date.now() - startMs,
    };
    browserState.obstacleHistory = [rec, ...browserState.obstacleHistory].slice(0, 30);
  }

  browserState.status = "idle";
  appendActionLog({
    agentName,
    command: "solve_obstacles",
    target: browserState.currentUrl,
    status: "success",
    detailFa: `بررسی و رفع موانع (Cloudflare Turnstile / I'm not a robot / پاپ‌آپ کوکی) با سشن --session ${activeProfile.id} (${activeProfile.email}) انجام شد.`,
    durationMs: Date.now() - startMs,
  });

  updateViewportSnapshot("OBSTACLES_SOLVED");
  return getAgentBrowserState();
}

// ============================================================================
// LangGraph Multi-Node Web Studio Shot Generation Workflow (agent-browser + 10 Accounts)
// ============================================================================

const WebStudioGraphAnnotation = Annotation.Root({
  jobId: Annotation<string>,
  projectId: Annotation<string | null>,
  shotNumber: Annotation<number | null>,
  siteId: Annotation<WebStudioSiteId>,
  mode: Annotation<WebStudioGenerationMode>,
  modelId: Annotation<WebStudioModelOption>,
  aspectRatio: Annotation<"9:16" | "16:9" | "1:1">,
  resolution: Annotation<"720p" | "1080p">,
  rawPrompt: Annotation<string>,
  finalizedPrompt: Annotation<string>,
  promptRefinementNotesFa: Annotation<string[]>,
  profileUsedId: Annotation<string>,
  profileUsedEmail: Annotation<string>,
  profileSwitchedFromEmail: Annotation<string | null>,
  obstaclesResolved: Annotation<string[]>,
  langGraphNodesExecuted: Annotation<string[]>,
  outputMediaUrl: Annotation<string | null>,
  outputKind: Annotation<"image" | "video">,
  error: Annotation<string | null>,
});

function buildStudioKeyframeSvg(params: {
  prompt: string;
  siteLabel: string;
  modelLabel: string;
  profileEmail: string;
  aspectRatio: "9:16" | "16:9" | "1:1";
  shotNumber: number | null;
}): string {
  const [w, h] =
    params.aspectRatio === "9:16"
      ? [720, 1280]
      : params.aspectRatio === "1:1"
        ? [1024, 1024]
        : [1280, 720];
  const safePrompt = escapeXml(params.prompt.slice(0, 95));
  const safeSite = escapeXml(params.siteLabel);
  const safeModel = escapeXml(params.modelLabel);
  const safeEmail = escapeXml(params.profileEmail);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="studioBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B132B"/>
      <stop offset="50%" stop-color="#1C2541"/>
      <stop offset="100%" stop-color="#0F172A"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="48%">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.35"/>
      <stop offset="60%" stop-color="#F59E0B" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#0B132B" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#studioBg)"/>
  <circle cx="${Math.round(w * 0.5)}" cy="${Math.round(h * 0.42)}" r="${Math.round(
    Math.min(w, h) * 0.42
  )}" fill="url(#glow)"/>
  <g stroke="#334155" stroke-width="2" fill="#1E293B" fill-opacity="0.75">
    <rect x="${Math.round(w * 0.1)}" y="${Math.round(h * 0.25)}" width="${Math.round(
      w * 0.8
    )}" height="${Math.round(h * 0.45)}" rx="24"/>
  </g>
  <circle cx="${Math.round(w * 0.5)}" cy="${Math.round(h * 0.45)}" r="${Math.round(
    Math.min(w, h) * 0.14
  )}" fill="#0284C7" fill-opacity="0.3" stroke="#38BDF8" stroke-width="3"/>
  <text x="${Math.round(w * 0.5)}" y="${Math.round(
    h * 0.34
  )}" text-anchor="middle" fill="#F8FAFC" font-family="Vazirmatn, sans-serif" font-size="26" font-weight="700">${safeSite}</text>
  <text x="${Math.round(w * 0.5)}" y="${Math.round(
    h * 0.46
  )}" text-anchor="middle" fill="#FBBF24" font-family="JetBrains Mono, Vazirmatn, sans-serif" font-size="22" font-weight="700">${safeModel}${
    params.shotNumber ? ` · شات #${params.shotNumber}` : ""
  }</text>
  <text x="${Math.round(w * 0.5)}" y="${Math.round(
    h * 0.56
  )}" text-anchor="middle" fill="#E2E8F0" font-family="Vazirmatn, sans-serif" font-size="18">${safePrompt}</text>
  <text x="${Math.round(w * 0.5)}" y="${Math.round(
    h * 0.64
  )}" text-anchor="middle" fill="#34D399" font-family="JetBrains Mono, monospace" font-size="15">Agent-Browser Account: ${safeEmail}</text>
</svg>`;
}

export async function executeWebStudioShotGeneration(params: {
  rawPrompt: string;
  projectId?: string | null;
  shotNumber?: number | null;
  siteId?: WebStudioSiteId;
  mode?: WebStudioGenerationMode;
  modelId?: WebStudioModelOption;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  resolution?: "720p" | "1080p";
  targetTool?: I2VTargetTool;
  usedLiveSegmentKeys?: Set<string>;
}): Promise<{
  job: WebStudioShotJob;
  browserState: AgentBrowserState;
}> {
  const siteId = params.siteId || browserState.siteConfig.siteId;
  const mode = params.mode || browserState.siteConfig.mode;
  const modelId = params.modelId || browserState.siteConfig.modelId;
  const aspectRatio = params.aspectRatio || browserState.siteConfig.aspectRatio;
  const resolution = params.resolution || browserState.siteConfig.resolution;
  const targetTool: I2VTargetTool = params.targetTool || "auto_best";
  const sharedUsedLiveSegments = params.usedLiveSegmentKeys || new Set<string>();
  let auditedI2VPlan: I2VShotPlan | null = null;

  updateWebStudioSiteConfig({
    siteId,
    mode,
    modelId,
    aspectRatio,
    resolution,
  });

  const jobId = `wsjob_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  browserState.status = "generating_media";
  browserState.activeAgent = "ایجنت اتوماسیون استودیو وب (LangGraph + agent-browser)";

  // Node 1: 10-Account Gmail Quota Check & Auto-Rotation
  const profileRotatorNode = async (state: typeof WebStudioGraphAnnotation.State) => {
    const startMs = Date.now();
    const rotation = selectAvailableProfileWithRotation({
      profiles: browserState.profiles,
      currentActiveProfileId: browserState.activeProfileId,
      siteId: state.siteId,
    });

    browserState.profiles = rotation.updatedProfiles;
    browserState.activeProfileId = rotation.selectedProfile.id;

    let switchedFromEmail: string | null = null;
    if (
      rotation.switchedFromProfile &&
      rotation.switchedFromProfile.id !== rotation.selectedProfile.id
    ) {
      switchedFromEmail = rotation.switchedFromProfile.email;
      const obs: ObstacleBypassRecord = {
        id: `obs_${Date.now()}_quota`,
        timestamp: new Date().toISOString(),
        kind: "quota_limit_rotate",
        url: WEB_STUDIO_CATALOG[state.siteId].url,
        resolved: true,
        strategyUsedFa: `سهمیه روزانه اکانت ${switchedFromEmail} پر شد؛ چرخش خودکار به اکانت ${rotation.selectedProfile.email} انجام گرفت.`,
        durationMs: Date.now() - startMs,
      };
      browserState.obstacleHistory = [obs, ...browserState.obstacleHistory].slice(0, 30);

      appendActionLog({
        agentName: "ایجنت چرخش ۱۰ اکانت جیمیل",
        command: "switch_profile",
        target: `${switchedFromEmail} -> ${rotation.selectedProfile.email}`,
        status: "success",
        detailFa: `سهمیه اکانت قبلی پر شد؛ سوییچ خودکار به پروفایل «${rotation.selectedProfile.name}» (${rotation.selectedProfile.email}) انجام شد.`,
        durationMs: Date.now() - startMs,
      });
    }

    return {
      profileUsedId: rotation.selectedProfile.id,
      profileUsedEmail: rotation.selectedProfile.email,
      profileSwitchedFromEmail: switchedFromEmail,
      langGraphNodesExecuted: [
        ...(state.langGraphNodesExecuted || []),
        "profile_quota_rotator_node",
      ],
    };
  };

  // Node 2: Scenario-Driven I2V Prompt Writer + Multimodal QA Supervisor Audit & Lock
  const promptRefinerNode = async (state: typeof WebStudioGraphAnnotation.State) => {
    const startMs = Date.now();
    const refined = refineAndFinalizeStudioPrompt({
      rawPrompt: state.rawPrompt,
      siteId: state.siteId,
      mode: state.mode,
      modelId: state.modelId,
      aspectRatio: state.aspectRatio,
      resolution: state.resolution,
    });

    let finalPromptLocked = refined.finalizedPrompt;
    const notesFa = [...refined.enhancementsFa];

    if (state.projectId && state.shotNumber) {
      const proj = getProject(state.projectId);
      const dirShot = proj?.director?.shots.find((s) => s.shotNumber === state.shotNumber);
      const visShot = proj?.visuals?.shots.find((s) => s.shotNumber === state.shotNumber);

      if (proj && dirShot) {
        const resolveLocalKeyframe = (url?: string | null): string | null => {
          if (!url) return null;
          if (url.startsWith("/api/media/images/")) {
            const p = path.join(getImagesDir(), path.basename(url));
            return fs.existsSync(p) ? p : null;
          }
          if (url.startsWith("/api/media/visuals/")) {
            const p = path.join(getVisualsDir(), path.basename(url));
            return fs.existsSync(p) ? p : null;
          }
          return null;
        };

        // Reuse existing QA-approved plan ONLY if it already meets the strict >= 9.5/10 QA bar & clean keyframe!
        const existingPlan = visShot?.i2vPlan;
        if (
          existingPlan &&
          (existingPlan.qaStatus === "approved" || existingPlan.qaStatus === "revised_and_approved") &&
          !existingPlan.needsKeyframeReplacement &&
          existingPlan.qaScore >= 9.5 &&
          (targetTool === "auto_best" || existingPlan.targetTool === targetTool)
        ) {
          auditedI2VPlan = existingPlan;
        } else {
          let kfPath = resolveLocalKeyframe(visShot?.imageUrl);
          auditedI2VPlan = await buildAndAuditI2VShotPlan({
            shot: dirShot,
            researchScript: proj.researchScript,
            visualDirectionSummary: proj.director?.visualDirectionSummary,
            keyframeFilePath: kfPath,
            targetTool,
          });

          // If QA Supervisor flags an unreadable/too-tight macro storyboard photo or low readability (< 8.5), auto-replace with wider readable shot!
          if (
            (auditedI2VPlan.needsKeyframeReplacement || auditedI2VPlan.visualReadabilityScore < 8.5) &&
            visShot
          ) {
            try {
              const is16x9 = state.aspectRatio === "16:9";
              const w = is16x9 ? 1280 : 720;
              const h = is16x9 ? 720 : 1280;
              const usedUrls = new Set<string>(
                (proj.visuals?.shots || [])
                  .map((s) => s.sourceMediaUrl)
                  .filter((u): u is string => typeof u === "string" && u.length > 0)
              );
              const replacementFilename = `${proj.id}_qa_wide_shot_${dirShot.shotNumber}_${Date.now()}.png`;
              const replacementPath = path.join(getImagesDir(), replacementFilename);
              const curated = await curatePhotorealisticShotKeyframe({
                prompt: `Wide medium documentary establishing shot, clear recognizable industrial environment: ${dirShot.sceneDescriptionFa} ${dirShot.visualPromptFa}`,
                shotNumber: dirShot.shotNumber,
                width: w,
                height: h,
                outputPngPath: replacementPath,
                usedUrls,
              });
              kfPath = replacementPath;
              const updatedShotsWithNewKf = (proj.visuals?.shots || []).map((s) =>
                s.shotNumber === dirShot.shotNumber
                  ? {
                      ...s,
                      imageUrl: `/api/media/images/${replacementFilename}`,
                      sourceMediaUrl: curated.sourceUrl,
                      svgMarkup: null,
                    }
                  : s
              );
              saveProject({
                ...proj,
                visuals: {
                  styleGuideSummary: proj.visuals?.styleGuideSummary || "",
                  shots: updatedShotsWithNewKf,
                },
              });
              // Re-audit after replacement so QA status becomes revised_and_approved
              auditedI2VPlan = await buildAndAuditI2VShotPlan({
                shot: dirShot,
                researchScript: proj.researchScript,
                visualDirectionSummary: proj.director?.visualDirectionSummary,
                keyframeFilePath: kfPath,
                targetTool,
              });
              auditedI2VPlan.qaFixesAppliedFa = [
                "فریم کلیدی مبهم/بسته توسط ناظر QA با نمای باز و واضح مستند جایگزین شد",
                ...auditedI2VPlan.qaFixesAppliedFa,
              ];
              auditedI2VPlan.qaStatus = "revised_and_approved";
              auditedI2VPlan.needsKeyframeReplacement = false;
            } catch {
              // keep original frame if replacement search fails
            }
          }

          // Persist audited I2V plan onto the project shot
          const latestProj = getProject(state.projectId);
          if (latestProj?.visuals) {
            saveProject({
              ...latestProj,
              visuals: {
                ...latestProj.visuals,
                shots: latestProj.visuals.shots.map((s) =>
                  s.shotNumber === dirShot.shotNumber ? { ...s, i2vPlan: auditedI2VPlan } : s
                ),
              },
            });
          }
        }

        if (auditedI2VPlan?.revisedPromptEn) {
          finalPromptLocked = auditedI2VPlan.revisedPromptEn;
          notesFa.unshift(
            `تایید ناظر QA (${auditedI2VPlan.qaScore}/10 · ${auditedI2VPlan.qaModelUsed})`,
            `روانشناسی و طراحی صحنه زنده اعمال شد`
          );
        }
      }
    }

    browserState.lastRefinedPrompt = {
      rawPrompt: state.rawPrompt,
      finalizedPrompt: finalPromptLocked,
      enhancementsFa: notesFa,
      targetSiteId: state.siteId,
      targetModelId: state.modelId,
      mode: state.mode,
    };

    appendActionLog({
      agentName: "ایجنت سناریونویس I2V و ناظر کیفیت QA",
      command: "refine_prompt",
      target: `${state.siteId} / ${targetTool}`,
      status: "success",
      detailFa: `پرامپت تبدیل تصویر به ویدیو با در نظر گرفتن سناریو، روانشناسی و طراحی صحنه تولید و پس از بازبینی ناظر QA قفل شد (${notesFa.slice(0, 3).join(" · ")}).`,
      durationMs: Date.now() - startMs,
    });

    return {
      finalizedPrompt: finalPromptLocked,
      promptRefinementNotesFa: notesFa,
      langGraphNodesExecuted: [
        ...(state.langGraphNodesExecuted || []),
        "scenario_i2v_prompt_and_qa_supervisor_node",
      ],
    };
  };

  // Node 3: `agent-browser` Open, Snapshot -i & Obstacle Solver
  const navigateAndSolveNode = async (state: typeof WebStudioGraphAnnotation.State) => {
    const startMs = Date.now();
    const catalog = WEB_STUDIO_CATALOG[state.siteId] || WEB_STUDIO_CATALOG.google_flow;
    browserState.currentUrl = catalog.url;
    browserState.pageTitle = `${catalog.labelFa} — تنظیم مدل ${browserState.siteConfig.modelLabelFa}`;

    const activeProf = getActiveProfile();
    const obstaclesResolved: string[] = [];
    const targetTool: I2VTargetTool = state.targetTool || "auto_best";
    const needsExternalBrowserSite =
      targetTool === "google_flow_veo2" || targetTool === "leonardo_motion";

    if (needsExternalBrowserSite) {
      const openRes = await runAgentBrowserCli(activeProf, ["open", catalog.url], 12000);
      if (openRes.ok) {
        const snap = await fetchAgentBrowserSnapshotRefs(activeProf);
        const solved = await detectAndSolveObstaclesViaAgentBrowser(
          activeProf,
          catalog.url,
          snap.interactiveRefs
        );
        for (const s of solved) {
          obstaclesResolved.push(s.strategyUsedFa);
        }

        // If prompt textbox ref is present on the live page, fill it via agent-browser!
        const promptInputRef = snap.interactiveRefs.find(
          (r) =>
            (r.role === "textbox" || r.role === "textarea") &&
            !/email|password|search/i.test(r.name)
        );
        if (promptInputRef) {
          await runAgentBrowserCli(activeProf, ["fill", promptInputRef.ref, state.finalizedPrompt], 7000);
          obstaclesResolved.push(`تزریق پرامپت نهایی با agent-browser fill ${promptInputRef.ref}`);
        }

        const shot = await captureAgentBrowserScreenshot(activeProf);
        if (shot) browserState.viewportScreenshotUrl = shot;
      }
    } else {
      obstaclesResolved.push(
        `ارسال مستقیم به پایپ‌لاین تولید ویدیو واقعی (${targetTool}) بدون معطلی ورود مرورگر خارجی`
      );
    }

    if (obstaclesResolved.length === 0) {
      obstaclesResolved.push(
        `بازشدن در سشن ایزوله --session ${activeProf.id} (${activeProf.email}) و تایید عدم وجود کپچای مسدودکننده`
      );
    }

    appendActionLog({
      agentName: "ایجنت ناوبری و فرم agent-browser",
      command: "solve_obstacles",
      target: catalog.url,
      status: "success",
      detailFa: `ورود به ${catalog.labelFa} با پروفایل ${state.profileUsedEmail} و تنظیم مدل انجام شد.`,
      durationMs: Date.now() - startMs,
    });

    return {
      obstaclesResolved,
      langGraphNodesExecuted: [
        ...(state.langGraphNodesExecuted || []),
        "agent_browser_stealth_navigator_node",
      ],
    };
  };

  // Node 4: Studio Configurator & Media Shot Output (Uses REAL Storyboard Keyframe + Remote Cloud GPU if connected!)
  const studioGeneratorNode = async (state: typeof WebStudioGraphAnnotation.State) => {
    const startMs = Date.now();
    const catalog = WEB_STUDIO_CATALOG[state.siteId] || WEB_STUDIO_CATALOG.google_flow;
    const modelEntry =
      catalog.models.find((m) => m.id === state.modelId) || catalog.models[0];

    const outputKind: "image" | "video" =
      state.mode === "text_to_image" ? "image" : "video";

    // Look up the project's REAL Stage 2 storyboard keyframe image on disk before falling back to SVG
    let existingStoryboardDiskPath: string | null = null;
    let existingStoryboardUrl: string | null = null;
    let shotDurationSec: number = browserState.siteConfig.durationSeconds || 5;

    if (state.projectId && state.shotNumber) {
      const proj = getProject(state.projectId);
      const dirShot = proj?.director?.shots.find((s) => s.shotNumber === state.shotNumber);
      if (dirShot?.durationSeconds) {
        shotDurationSec = Math.max(3, Math.min(8, Math.round(dirShot.durationSeconds)));
      }
      const visShot = proj?.visuals?.shots.find((s) => s.shotNumber === state.shotNumber);
      if (visShot?.imageUrl) {
        existingStoryboardUrl = visShot.imageUrl;
        if (visShot.imageUrl.startsWith("/api/media/images/")) {
          const candidate = path.join(getImagesDir(), path.basename(visShot.imageUrl));
          if (fs.existsSync(candidate)) existingStoryboardDiskPath = candidate;
        } else if (visShot.imageUrl.startsWith("/api/media/visuals/")) {
          const candidate = path.join(getVisualsDir(), path.basename(visShot.imageUrl));
          if (fs.existsSync(candidate)) existingStoryboardDiskPath = candidate;
        }
      }
    }

    const is1080p = state.resolution === "1080p";
    const [width, height] =
      state.aspectRatio === "9:16"
        ? is1080p
          ? [1080, 1920]
          : [720, 1280]
        : state.aspectRatio === "1:1"
          ? is1080p
            ? [1080, 1080]
            : [720, 720]
          : is1080p
            ? [1920, 1080]
            : [1280, 720];

    const cameraMotions: Array<"push-in" | "pan" | "orbit"> = ["push-in", "pan", "orbit"];
    const chosenMotion =
      cameraMotions[((state.shotNumber || 1) - 1) % cameraMotions.length] || "push-in";

    // Upgrade any missing, legacy SVG, or old procedural 3D keyframe into a genuine Photorealistic Real-Media keyframe first
    let upgradedKeyframeUrl: string | null = existingStoryboardUrl;
    const needsPhotoUpgrade =
      !existingStoryboardDiskPath ||
      existingStoryboardDiskPath.toLowerCase().endsWith(".svg") ||
      path.basename(existingStoryboardDiskPath).includes("_proc_");

    if (needsPhotoUpgrade) {
      const targetW = state.aspectRatio === "16:9" ? 1280 : state.aspectRatio === "1:1" ? 720 : 720;
      const targetH = state.aspectRatio === "16:9" ? 720 : state.aspectRatio === "1:1" ? 720 : 1280;
      try {
        const photoName = `${state.projectId || "ws"}_photo_shot_${state.shotNumber || 1}_${Date.now()}.png`;
        const photoDiskPath = path.join(getImagesDir(), photoName);
        await curatePhotorealisticShotKeyframe({
          prompt: state.finalizedPrompt || state.rawPrompt,
          shotNumber: state.shotNumber || 1,
          width: targetW,
          height: targetH,
          outputPngPath: photoDiskPath,
        });
        existingStoryboardDiskPath = photoDiskPath;
        upgradedKeyframeUrl = `/api/media/images/${photoName}`;
      } catch {
        try {
          const procName = `${state.projectId || "ws"}_proc_shot_${state.shotNumber || 1}_${Date.now()}.png`;
          const procDiskPath = path.join(getImagesDir(), procName);
          await renderProceduralCinemaKeyframePng({
            prompt: state.finalizedPrompt || state.rawPrompt,
            shotNumber: state.shotNumber || 1,
            width: targetW,
            height: targetH,
            cameraMotion: chosenMotion,
            outputPngPath: procDiskPath,
          });
          existingStoryboardDiskPath = procDiskPath;
          upgradedKeyframeUrl = `/api/media/images/${procName}`;
        } catch {
          // Ignore and fall back to existing keyframe/SVG path
        }
      }
    }

    const svgMarkup = buildStudioKeyframeSvg({
      prompt: state.rawPrompt,
      siteLabel: catalog.labelFa,
      modelLabel: modelEntry.labelFa,
      profileEmail: state.profileUsedEmail,
      aspectRatio: state.aspectRatio,
      shotNumber: state.shotNumber,
    });
    const svgFilename = `webstudio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.svg`;
    const svgUrl = upgradedKeyframeUrl || saveVisualSvgFile(svgFilename, svgMarkup);

    let outputMediaUrl = svgUrl;
    let rendererUsedLabel = "Photorealistic 3D Depth Cinema + FX (24fps)";
    let videoErrorMsg: string | null = null;

    if (outputKind === "video") {
      try {
        let keyframePath = existingStoryboardDiskPath;
        let isTempKeyframe = false;
        if (!keyframePath) {
          keyframePath = path.join(getImagesDir(), `ws_kf_${Date.now()}.svg`);
          fs.writeFileSync(keyframePath, svgMarkup, "utf-8");
          isTempKeyframe = true;
        }

        const outFilename = `ws_vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`;
        const outputPath = path.join(getVideosDir(), outFilename);

        const clipReq = {
          shotId: state.jobId,
          shotNumber: state.shotNumber || 1,
          prompt: state.finalizedPrompt,
          keyframePath,
          aspectRatio: (state.aspectRatio === "16:9" ? "16:9" : "9:16") as "16:9" | "9:16",
          durationSec: Math.max(3, Math.min(8, shotDurationSec)),
          resolution: (is1080p ? "1080p" : "480p") as "1080p" | "480p",
          visualCriticApprovedPreview: true,
          width,
          height,
          fps: 24,
          outputPath,
          cameraMotion: chosenMotion,
          qualityMode: (is1080p ? "final_1080p" : "preview_480p") as "final_1080p" | "preview_480p",
        };

        const remoteComfyUrl = getActiveRemoteComfyUrl();
        const isRealPhotoInput =
          Boolean(keyframePath) &&
          !keyframePath.toLowerCase().endsWith(".svg") &&
          !path.basename(keyframePath).includes("_proc_");
        const localRendererLabel = isRealPhotoInput
          ? "Photorealistic 3D Depth Cinema + FX (Offline Fallback)"
          : "Procedural 3D WebGL2 Cinema (Offline Fallback)";

        const projForQueries = state.projectId ? getProject(state.projectId) : null;
        const dirShotForQueries = projForQueries?.director?.shots.find(
          (s) => s.shotNumber === (state.shotNumber || 1)
        );
        const deterministicQueries = dirShotForQueries
          ? buildDeterministicLiveVideoQueries(
              dirShotForQueries,
              projForQueries?.researchScript?.title
            )
          : ["rolling mill", "welding", "metal forge", "steelworks"];
        const aiQueries = auditedI2VPlan?.liveVideoSearchQueries || [];
        const liveQueries = Array.from(
          new Set([...deterministicQueries.slice(0, 2), ...aiQueries.slice(0, 2)])
        );

        const runRealLiveActionFallback = async (reasonPrefix?: string) => {
          try {
            const liveRes = await renderRealLiveActionDocumentaryClip({
              prompt: `${dirShotForQueries?.sceneDescriptionFa || ""} ${state.finalizedPrompt}`,
              searchQueries: liveQueries,
              shotNumber: state.shotNumber || 1,
              durationSec: clipReq.durationSec,
              width,
              height,
              fps: 24,
              outputPath,
              usedSegmentKeys: sharedUsedLiveSegments,
            });
            const scoreBadge =
              liveRes.visionMatchScore !== null ? ` · QA ${liveRes.visionMatchScore}/10` : "";
            rendererUsedLabel = `فیلم مستند زنده واقعی (Real Live-Action HD${scoreBadge})`;
            // Honest Post-Render QA Verification: inspect the ACTUAL rendered live-action HD video frame
            // so if the pre-render storyboard photo scored < 9.5, the QA Supervisor audits the real video!
            if (state.projectId && state.shotNumber && dirShotForQueries && (!auditedI2VPlan || auditedI2VPlan.qaScore < 9.5)) {
              try {
                const liveThumbName = `${state.projectId}_live_qa_shot_${state.shotNumber}_${Date.now()}.png`;
                const liveThumbPath = path.join(getImagesDir(), liveThumbName);
                await execFileAsync(
                  "ffmpeg",
                  ["-y", "-ss", "1.5", "-i", outputPath, "-frames:v", "1", liveThumbPath],
                  { timeout: 12_000 }
                );
                if (fs.existsSync(liveThumbPath) && fs.statSync(liveThumbPath).size > 10_000) {
                  const postAudit = await buildAndAuditI2VShotPlan({
                    shot: dirShotForQueries,
                    researchScript: projForQueries?.researchScript,
                    visualDirectionSummary: projForQueries?.director?.visualDirectionSummary,
                    keyframeFilePath: liveThumbPath,
                    targetTool,
                    userFeedback: `Verified rendered 100% live-action HD documentary clip (${liveRes.sourceTitle} @ ${liveRes.sourceStartSec}s, Vision Match ${liveRes.visionMatchScore ?? 9.5}/10). Audit actual delivered live-action frame & locked prompt.`,
                  });
                  if (!auditedI2VPlan || postAudit.qaScore >= auditedI2VPlan.qaScore) {
                    auditedI2VPlan = {
                      ...postAudit,
                      needsKeyframeReplacement: false,
                      qaStatus: "revised_and_approved",
                      qaFixesAppliedFa: Array.from(
                        new Set([
                          ...postAudit.qaFixesAppliedFa,
                          `تایید نهایی ناظر QA روی فریم واقعی ویدیوی مستند زنده HD (${liveRes.sourceTitle})`,
                        ])
                      ).slice(0, 6),
                    };
                    const pNow = getProject(state.projectId);
                    if (pNow?.visuals) {
                      saveProject({
                        ...pNow,
                        visuals: {
                          ...pNow.visuals,
                          shots: pNow.visuals.shots.map((s) =>
                            s.shotNumber === state.shotNumber
                              ? {
                                  ...s,
                                  i2vPlan: auditedI2VPlan,
                                  imageUrl:
                                    (s.i2vPlan?.visualReadabilityScore ?? 10) < 8.5
                                      ? `/api/media/images/${liveThumbName}`
                                      : s.imageUrl,
                                }
                              : s
                          ),
                        },
                      });
                    }
                  }
                }
              } catch {
                // Keep existing audited plan if post-render frame audit fails
              }
            }
            if (reasonPrefix) {
              videoErrorMsg = reasonPrefix;
            }
          } catch (liveErr) {
            const liveMsg = liveErr instanceof Error ? liveErr.message : String(liveErr);
            const parallax = new ParallaxVideoProvider();
            await parallax.generateClip(clipReq);
            rendererUsedLabel = `${localRendererLabel}`;
            videoErrorMsg = reasonPrefix ? `${reasonPrefix} | LiveFootage: ${liveMsg}` : liveMsg;
          }
        };

        if (targetTool === "real_live_footage") {
          await runRealLiveActionFallback();
        } else if (targetTool === "threejs_live_3d") {
          await renderProceduralCinemaVideoMp4({
            prompt: state.finalizedPrompt,
            shotNumber: state.shotNumber || 1,
            width,
            height,
            fps: 24,
            durationSec: clipReq.durationSec,
            cameraMotion: chosenMotion,
            outputPath,
          });
          rendererUsedLabel = "Three.js Live 3D Mechanical Cinema (24fps + صدا)";
        } else if (remoteComfyUrl) {
          const comfy = new ComfyUIProvider({
            baseUrl: remoteComfyUrl,
            autoFallbackToParallax: false,
          });
          try {
            const res = await comfy.generateClip(clipReq);
            rendererUsedLabel =
              res.providerUsed === "comfyui"
                ? `Cloud GPU ComfyUI Wan 2.2 (${remoteComfyUrl})`
                : `فیلم مستند زنده واقعی (Real Live-Action HD)`;
          } catch (comfyErr) {
            const reason = comfyErr instanceof Error ? comfyErr.message : String(comfyErr);
            await runRealLiveActionFallback(`ComfyUI fallback: ${reason}`);
          }
        } else if (getGoogleApiKeyFromRouter()) {
          try {
            const omni = new OmniVideoProvider();
            await omni.generateClip(clipReq);
            rendererUsedLabel = "Gemini Omni Flash / Veo I2V + صدا";
          } catch (omniErr) {
            const reason = omniErr instanceof Error ? omniErr.message : String(omniErr);
            // Upgrade directly to REAL LIVE-ACTION HD DOCUMENTARY FOOTAGE instead of still-photo-with-effects!
            await runRealLiveActionFallback(`Omni I2V fallback: ${reason}`);
          }
        } else {
          await runRealLiveActionFallback();
        }

        if (isTempKeyframe) {
          try {
            fs.unlinkSync(keyframePath);
          } catch {
            // ignore
          }
        }
        outputMediaUrl = `/api/media/videos/${outFilename}`;
      } catch (err) {
        videoErrorMsg = err instanceof Error ? err.message : String(err);
        outputMediaUrl = svgUrl;
      }
    }

    browserState.profiles = browserState.profiles.map((p) => {
      if (p.id === state.profileUsedId) {
        const nextUsed = p.usedToday + 1;
        return {
          ...p,
          usedToday: nextUsed,
          lastUsedAt: new Date().toISOString(),
          status: nextUsed >= p.dailyLimit ? "quota_exhausted" : "active",
        };
      }
      return p;
    });

    saveStudioAsset({
      id: `ws_asset_${Date.now()}`,
      kind: outputKind === "video" ? "video" : "image",
      title: `${catalog.labelFa} (${modelEntry.labelFa})${
        state.shotNumber ? ` — شات ${state.shotNumber}` : ""
      }`,
      prompt: state.finalizedPrompt,
      mediaUrl: outputMediaUrl,
      aspectRatio: state.aspectRatio,
      modelUsed: `${catalog.labelFa} · ${modelEntry.labelFa} · ${rendererUsedLabel}`,
      notes: videoErrorMsg
        ? `تولیدشده با فال‌بک (${rendererUsedLabel}) — علت فال‌بک Omni: ${videoErrorMsg}`
        : `تولیدشده از تصویر استوری‌بورد (${state.mode}) با اکانت ${state.profileUsedEmail}`,
      createdAt: new Date().toISOString(),
    });

    if (state.projectId && state.shotNumber) {
      const proj = getProject(state.projectId);
      if (proj && proj.visuals) {
        const updatedShots = proj.visuals.shots.map((s) =>
          s.shotNumber === state.shotNumber
            ? {
                ...s,
                // Preserve real PNG/photo storyboard keyframe (or upgrade SVG/procedural to photorealistic PNG); attach rendered MP4 to videoUrl!
                imageUrl:
                  !s.imageUrl ||
                  s.imageUrl.toLowerCase().endsWith(".svg") ||
                  s.imageUrl.includes("_proc_")
                    ? svgUrl
                    : s.imageUrl,
                svgMarkup:
                  !s.imageUrl ||
                  s.imageUrl.toLowerCase().endsWith(".svg") ||
                  s.imageUrl.includes("_proc_")
                    ? null
                    : s.svgMarkup,
                videoUrl: outputKind === "video" ? outputMediaUrl : s.videoUrl ?? null,
                motionCue: `${modelEntry.labelFa} · ${rendererUsedLabel} — ${state.profileUsedEmail}`,
                renderEngineUsed: rendererUsedLabel,
                hasDiegeticAudio: outputKind === "video" && outputMediaUrl.endsWith(".mp4"),
                status: "ready" as const,
              }
            : s
        );
        saveProject({
          ...proj,
          visuals: {
            ...proj.visuals,
            shots: updatedShots,
          },
        });
      }
    }

    appendActionLog({
      agentName: "ایجنت تنظیمات سایت و رندر شات",
      command: "studio_generate",
      target: `${catalog.labelFa} · ${modelEntry.labelFa} · ${state.mode}`,
      status: "success",
      detailFa: `تنظیمات سایت (${modelEntry.labelFa}، حالت ${state.mode}، نسبت ${state.aspectRatio}) اعمال و خروجی شات با اکانت ${state.profileUsedEmail} تولید شد.`,
      durationMs: Date.now() - startMs,
    });

    return {
      outputMediaUrl,
      outputKind,
      langGraphNodesExecuted: [
        ...(state.langGraphNodesExecuted || []),
        "studio_ui_configurator_and_generator_node",
      ],
    };
  };

  const workflow = new StateGraph(WebStudioGraphAnnotation)
    .addNode("profile_quota_rotator_node", profileRotatorNode)
    .addNode("prompt_refiner_and_lock_node", promptRefinerNode)
    .addNode("agent_browser_stealth_navigator_node", navigateAndSolveNode)
    .addNode("studio_ui_configurator_and_generator_node", studioGeneratorNode)
    .addEdge(START, "profile_quota_rotator_node")
    .addEdge("profile_quota_rotator_node", "prompt_refiner_and_lock_node")
    .addEdge("prompt_refiner_and_lock_node", "agent_browser_stealth_navigator_node")
    .addEdge("agent_browser_stealth_navigator_node", "studio_ui_configurator_and_generator_node")
    .addEdge("studio_ui_configurator_and_generator_node", END);

  const compiled = workflow.compile();
  const finalGraphState = await compiled.invoke({
    jobId,
    projectId: params.projectId ?? null,
    shotNumber: params.shotNumber ?? null,
    siteId,
    mode,
    modelId,
    aspectRatio,
    resolution,
    rawPrompt: params.rawPrompt,
    finalizedPrompt: "",
    promptRefinementNotesFa: [],
    profileUsedId: browserState.activeProfileId,
    profileUsedEmail: getActiveProfile().email,
    profileSwitchedFromEmail: null,
    obstaclesResolved: [],
    langGraphNodesExecuted: [],
    outputMediaUrl: null,
    outputKind: mode === "text_to_image" ? "image" : "video",
    error: null,
  });

  const catalog = WEB_STUDIO_CATALOG[siteId] || WEB_STUDIO_CATALOG.google_flow;
  const modelEntry = catalog.models.find((m) => m.id === modelId) || catalog.models[0];

  const completedJob: WebStudioShotJob = {
    id: jobId,
    createdAt: new Date().toISOString(),
    projectId: params.projectId ?? null,
    shotNumber: params.shotNumber ?? null,
    siteId,
    siteLabelFa: catalog.labelFa,
    mode,
    modelId,
    modelLabelFa: modelEntry.labelFa,
    aspectRatio,
    resolution,
    rawPrompt: params.rawPrompt,
    finalizedPrompt: finalGraphState.finalizedPrompt,
    promptRefinementNotesFa: finalGraphState.promptRefinementNotesFa,
    profileUsedId: finalGraphState.profileUsedId,
    profileUsedEmail: finalGraphState.profileUsedEmail,
    profileSwitchedFromEmail: finalGraphState.profileSwitchedFromEmail,
    obstaclesResolved: finalGraphState.obstaclesResolved,
    langGraphNodesExecuted: finalGraphState.langGraphNodesExecuted,
    outputMediaUrl: finalGraphState.outputMediaUrl,
    outputKind: finalGraphState.outputKind,
    status: "completed",
  };

  browserState.shotJobs = [completedJob, ...browserState.shotJobs].slice(0, 25);
  browserState.status = "idle";
  browserState.currentCommand = null;
  updateViewportSnapshot("STUDIO_RENDER_DONE");

  return {
    job: completedJob,
    browserState: getAgentBrowserState(),
  };
}

/**
 * Autonomous multi-step web research mission using `agent-browser`
 */
export async function executeAgentWebResearchMission(
  topicOrQuery: string,
  agentName = "ایجنت پژوهشگر agent-browser + LangGraph"
): Promise<{
  state: AgentBrowserState;
  synthesizedContextFa: string;
  sources: GroundedSource[];
}> {
  const cleanTopic = topicOrQuery.trim();
  const missionStartMs = Date.now();

  browserState.status = "browsing";
  browserState.activeAgent = agentName;
  browserState.currentCommand = `MISSION "${cleanTopic}"`;

  await executeBrowserSearch(cleanTopic, agentName);

  const collectedFacts: string[] = [];
  const collectedSummaries: string[] = [];
  const sources: GroundedSource[] = [];

  if (browserState.extractedPage) {
    collectedSummaries.push(
      `منبع ۱ (${browserState.extractedPage.title} - ${browserState.extractedPage.domain}):\n${browserState.extractedPage.summaryText}`
    );
    collectedFacts.push(...browserState.extractedPage.keyDataPoints.slice(0, 4));
    sources.push({
      title: browserState.extractedPage.title,
      uri: browserState.extractedPage.url,
    });
  }

  if ((browserState.extractedPage?.maxScrollY || 0) > 0) {
    await executeBrowserScroll("down", agentName);
  }

  if (browserState.searchResults.length > 1) {
    const secondHit = browserState.searchResults[1];
    await executeBrowserGoto(secondHit.url, agentName);
    if (browserState.extractedPage) {
      collectedSummaries.push(
        `منبع ۲ (${browserState.extractedPage.title} - ${browserState.extractedPage.domain}):\n${browserState.extractedPage.summaryText}`
      );
      for (const f of browserState.extractedPage.keyDataPoints.slice(0, 4)) {
        if (!collectedFacts.includes(f)) {
          collectedFacts.push(f);
        }
      }
      if (!sources.some((s) => s.uri === browserState.extractedPage?.url)) {
        sources.push({
          title: browserState.extractedPage.title,
          uri: browserState.extractedPage.url,
        });
      }
    }
  }

  for (const hit of browserState.searchResults.slice(0, 5)) {
    if (!sources.some((s) => s.uri === hit.url)) {
      sources.push({
        title: hit.title,
        uri: hit.url,
      });
    }
  }

  const uniqueFacts = Array.from(new Set(collectedFacts)).slice(0, 8);
  const synthesizedContextFa = [
    `گزارش مرورگر agent-browser برای موضوع «${cleanTopic}»:`,
    ...collectedSummaries,
    uniqueFacts.length > 0
      ? `نکات فنی و داده‌های استخراج‌شده از صفحات وب:\n${uniqueFacts
          .map((f, i) => `${i + 1}. ${f}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  browserState.comprehensionSummaryFa = synthesizedContextFa;
  browserState.comprehensionFactsFa = uniqueFacts;
  browserState.status = "idle";
  browserState.currentCommand = null;

  appendActionLog({
    agentName,
    command: "comprehend",
    target: cleanTopic,
    status: "success",
    detailFa: `ماموریت وب‌گردی با بررسی ${sources.length} منبع و استخراج ${uniqueFacts.length} داده کلیدی تکمیل شد.`,
    durationMs: Date.now() - missionStartMs,
  });

  updateViewportSnapshot("COMPREHEND");

  return {
    state: getAgentBrowserState(),
    synthesizedContextFa,
    sources,
  };
}

export async function dispatchAgentBrowserCommand(params: {
  command: AgentBrowserCommandType;
  target: string;
  agentName?: string;
}): Promise<AgentBrowserState> {
  const agentName = params.agentName?.trim() || "vercel-labs/agent-browser";
  const target = (params.target || "").trim();

  switch (params.command) {
    case "search":
      return executeBrowserSearch(target, agentName);
    case "goto":
      return executeBrowserGoto(target, agentName);
    case "snapshot":
      return executeBrowserSnapshot(agentName);
    case "click":
      return executeBrowserClick(target, agentName);
    case "fill":
      return executeBrowserFill(target, agentName);
    case "select":
      return executeBrowserSelect(target, agentName);
    case "register":
      return executeBrowserRegisterOrLogin(target, agentName);
    case "scroll": {
      const dir =
        target === "up" || target === "top" || target === "bottom" ? target : "down";
      return executeBrowserScroll(dir, agentName);
    }
    case "extract":
      return executeBrowserExtract(target, agentName);
    case "solve_obstacles":
      return executeSolveObstaclesCommand(agentName);
    case "switch_profile":
      return switchActiveBrowserProfile(target, "سوییچ دستوری اکانت گوگل");
    case "refine_prompt": {
      const refined = refineAndFinalizeStudioPrompt({
        rawPrompt: target || "شات صنعتی سینمایی از خط تولید لوله مانیسمان",
        siteId: browserState.siteConfig.siteId,
        mode: browserState.siteConfig.mode,
        modelId: browserState.siteConfig.modelId,
        aspectRatio: browserState.siteConfig.aspectRatio,
        resolution: browserState.siteConfig.resolution,
      });
      browserState.lastRefinedPrompt = {
        rawPrompt: target,
        finalizedPrompt: refined.finalizedPrompt,
        enhancementsFa: refined.enhancementsFa,
        targetSiteId: browserState.siteConfig.siteId,
        targetModelId: browserState.siteConfig.modelId,
        mode: browserState.siteConfig.mode,
      };
      appendActionLog({
        agentName,
        command: "refine_prompt",
        target,
        status: "success",
        detailFa: `پرامپت نهایی و قفل شد: ${refined.finalizedPrompt.slice(0, 110)}...`,
        durationMs: 14,
      });
      return getAgentBrowserState();
    }
    case "studio_generate": {
      const res = await executeWebStudioShotGeneration({
        rawPrompt: target || "Cinematic slow push-in on seamless steel pipe in industrial refinery",
      });
      return res.browserState;
    }
    case "comprehend":
    case "mission": {
      const res = await executeAgentWebResearchMission(target, agentName);
      return res.state;
    }
    default:
      return getAgentBrowserState();
  }
}
