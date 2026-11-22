import { GoogleGenAI, Type } from "@google/genai";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getGoogleApiKeyFromRouter } from "../../router.js";

const execFileAsync = promisify(execFile);

const USER_AGENT =
  "CinemaStudioDocumentaryEngine/2.1 (https://github.com/cinema-studio-ai; media-curator@localhost)";

export type DocumentaryColorMood =
  | "teal_amber_foundry"
  | "moody_steam_boiler"
  | "refinery_twilight"
  | "clean_industrial"
  | "natural_cinema";

export interface RealMediaCandidate {
  id: string;
  title: string;
  description: string;
  pageUrl: string;
  downloadUrl: string;
  previewUrl?: string;
  mimeType: string;
  width: number;
  height: number;
  provider: "flickr_public" | "wikimedia_commons" | "openverse";
  license: string;
  author: string;
}

export interface CuratedKeyframeResult {
  outputPngPath: string;
  sourceUrl: string;
  pageUrl: string;
  sourceTitle: string;
  sourceProvider: "flickr_public" | "wikimedia_commons" | "openverse";
  license: string;
  author: string;
  mood: DocumentaryColorMood;
  queriesTried: string[];
  visionCriticScore: number | null;
  visionCriticReason: string | null;
  colorSaturationAvg: number;
  lumaAvg: number;
  width: number;
  height: number;
}

const BANNED_TITLE_OR_DESC_REGEX =
  /\b(diagram|blueprint|schematic|chart|graph|logo|icon|flag|coat[\s_-]+of[\s_-]+arms|map|stamp|seal|patent|drawing|illustration|sketch|engraving|painting|watercolor|lithograph|woodcut|etching|book|page|cover|document|letter|newspaper|magazine|artizan|inside[\s_-]+history|selfie|signature|poster|banner|screenshot|wikisource|djvu|vector|cartoon|comic|plaque|memorial|grave|cemetery|formula|table|badge|emblem|crest|monogram|clipart|caricature|silhouette|signpost|billboard|stereograph|stereoscopic|stereo[\s_-]*card|underwood|keystone[\s_-]+view|railway[\s_-]+crossing|locomotive|train[\s_-]+station|brunswick|convic|tramway|railroad|roadworks|construction[\s_-]+barrier|temple|statue|monument|cathedral|church|mosque|palace|rocket|nasa|spacecraft|apollo|shuttle|sls|artemis|launch[\s_-]*pad|vab)\b/i;

const MONOCHROME_OR_ANTIQUE_HINT_REGEX =
  /\b(18[0-9]{2}|19[0-4][0-9]|black[\s_-]+and[\s_-]+white|monochrome|sepia|haer|habs|loc\.gov|glass[\s_-]+negative|lantern[\s_-]+slide|archive|archival|postcard|daguerreotype|bw)\b/i;

const PERSIAN_TO_ENGLISH_VISUAL_MAP: Array<[RegExp, string]> = [
  [/کوره\s*ذوب|کوره|ذوب\s*آهن|گداخته|شمش\s*فولاد|ریخته‌گری/i, "molten steel furnace"],
  [/بویلر|دیگ\s*بخار|لوله\s*بخار|شکافته|ترک‌خورده|درز\s*جوش|انفجار\s*فشار/i, "industrial steam pipes"],
  [/غلتک|نورد\s*سوراخ|مانیسمان|قالب\s*مخروطی|نورد\s*گرم/i, "steel rolling mill"],
  [/لوله\s*بدون\s*درز|خط\s*تولید\s*لوله|لوله\s*فولادی|خروج\s*لوله/i, "steel pipe factory"],
  [/پالایشگاه|پتروشیمی|برج\s*تقطیر|مشعل\s*پالایشگاه/i, "oil refinery night"],
  [/منیفولد|شیر\s*فلکی|فلنج|اتصالات\s*فلنجی|خط\s*لوله\s*نفت|خط\s*انتقال/i, "industrial pipeline valve"],
  [/مقطع\s*لوله|دیواره\s*ضخیم|لبه\s*لوله|ساختار\s*فولاد|برش\s*لوله/i, "steel pipes stack"],
  [/نفت|گاز|سکوی\s*نفتی/i, "oil gas refinery"],
  [/کارخانه|سوله\s*صنعتی|صنعت/i, "steel factory industrial"],
  [/آتش|شعله|جرقه/i, "welding sparks steel"],
  [/آشپزی|غذا|رستوران|آشپزخانه/i, "chef cooking kitchen"],
  [/قهوه|کافه|اسپرسو/i, "espresso coffee brewing"],
  [/پزشکی|بیمارستان|آزمایشگاه|جراحی/i, "medical laboratory microscope"],
  [/فضا|ستاره|سیاره|کهکشان|موشک/i, "space rocket launch"],
  [/معماری|ساختمان|آسمان‌خراش|شهر/i, "modern city architecture night"],
  [/خودرو|موتور|ماشین|مسابقه/i, "sports car engine"],
  [/هوش\s*مصنوعی|سرور|دیتاسنتر|کامپیوتر/i, "data center server room"],
  [/طلا|سکه|بورس|اقتصاد/i, "gold bars vault"],
  [/طبیعت|کوه|جنگل|دریا|اقیانوس/i, "dramatic mountain landscape"],
];

/**
 * Classifies the visual color grading mood for cohesive cinematography across shots.
 */
export function classifyDocumentaryMood(promptText: string): DocumentaryColorMood {
  const p = (promptText || "").toLowerCase();
  if (
    /furnace|molten|billet|foundry|rolling\s*mill|piercing|forge|spark|ember|extrud|welding|کوره|گداخته|شمش|ذوب|غلتک|نورد|ریخته‌گری|جرقه/i.test(
      p
    )
  ) {
    return "teal_amber_foundry";
  }
  if (
    /refinery|petrochemical|flare|distillation|night|twilight|پالایشگاه|پتروشیمی|تقطیر|مشعل|شب/i.test(
      p
    )
  ) {
    return "refinery_twilight";
  }
  if (/boiler|steam|rupture|crack|burst|pressure|بویلر|بخار|ترک|شکاف|پارگی|انفجار/i.test(p)) {
    return "moody_steam_boiler";
  }
  if (
    /pipe|steel|flange|manifold|valve|factory|metal|astm|api|engineer|worker|لوله|فولاد|فلنج|منیفولد|شیر|صنعت|کارخانه/i.test(
      p
    )
  ) {
    return "clean_industrial";
  }
  return "natural_cinema";
}

/**
 * Extracts crisp 2-3 word English documentary search queries from Persian/English shot prompts.
 * Optimized for BOTH Flickr tag feeds (comma-joined tags) and Wikimedia Commons bitmap search.
 */
export function buildDocumentaryMediaQueries(promptText: string, shotNumber = 1): string[] {
  const p = (promptText || "").toLowerCase();
  const queries: string[] = [];

  const pushUnique = (q: string) => {
    const clean = q.trim().replace(/\s+/g, " ");
    if (clean.length >= 4 && !queries.includes(clean)) {
      queries.push(clean);
    }
  };

  // High-precision scene intent matching (covers Director English & Persian prompts accurately)
  if (
    /male\s+host|presenter|talking\s+to\s+camera|studio\s+lighting.*industrial|گوینده|مجری|ارائه‌دهنده/i.test(
      p
    )
  ) {
    pushUnique("engineer industrial factory");
    pushUnique("steel worker helmet");
    pushUnique("industrial factory interior");
    pushUnique("steel pipes industrial");
  } else if (
    /brothers|industrialist|blacksmith|steelworker|soot\s+on\s+faces|مخترع|برادران\s*مانیسمان|کارگر\s*فولاد/i.test(
      p
    )
  ) {
    pushUnique("blacksmith forge sparks");
    pushUnique("foundry worker molten");
    pushUnique("steelworker factory furnace");
    pushUnique("iron foundry metal");
  } else if (
    /hollow\s+(?:glowing\s+)?center|inside\s+(?:a\s+|the\s+)?(?:hollow|glowing|molten)\s+pipe|molten\s+tunnel|piercing\s+mandrel|حفره\s*مرکزی|سمبه\s*سوراخ|درون\s*تونل/i.test(
      p
    )
  ) {
    pushUnique("molten steel furnace");
    pushUnique("hot steel mill");
    pushUnique("foundry sparks metal");
    pushUnique("glowing steel pipe");
  } else if (
    /caliper|vernier|micrometer|schedule\s*(?:20|40|80|160)|wall\s*thickness|کولیس|میکرومتر|ضخامت\s*دیواره|رده\s*(?:۱۰|۲۰|۴۰|۸۰|۱۶۰)|اندازه‌گیری\s*ضخامت/i.test(
      p
    )
  ) {
    pushUnique("vernier caliper metal");
    pushUnique("steel pipe thickness");
    pushUnique("steel pipes stack");
    pushUnique("metal machining measurement");
  } else if (
    /cross-section|beveled\s+cross|solid\s+wall\s+cross|مقطع\s*برش|مقاطع\s*برش|مقطع\s*لوله|مقاطع\s*لوله|لبه\s*لوله|دیواره\s*ضخیم|پخ‌خورده|دسته‌ای\s*از\s*لوله/i.test(
      p
    )
  ) {
    pushUnique("steel pipes");
    pushUnique("steel tubes");
    pushUnique("seamless steel pipes");
    pushUnique("heavy steel pipes");
  } else if (
    /newly\s+formed\s+seamless|freshly\s+pierced|cooling\s+roller|zero\s+weld\s+seam|خروج\s*لوله|لوله\s*بدون\s*درز|ریل‌های\s*خنک/i.test(
      p
    )
  ) {
    pushUnique("steel pipe mill");
    pushUnique("glowing steel factory");
    pushUnique("industrial steel tubes");
    pushUnique("hot steel rolling");
  } else if (
    /extrud|rotary\s+piercing|angled\s+conical|conical\s+steel\s+roller|غلتک|قالب\s*مخروطی|نورد\s*سوراخ|نورد\s*تاریخی|فرم‌دهی\s*لوله/i.test(
      p
    )
  ) {
    pushUnique("molten steel mill");
    pushUnique("hot steel rolling");
    pushUnique("foundry sparks steel");
    pushUnique("steel rolling mill");
  } else if (
    /seam\s+weld|weld.*tear|hairline\s+crack|rusted\s+metal|درز\s*جوش|خط\s*جوش|ترک\s*داغ|پارگی|زنگ‌زده/i.test(
      p
    )
  ) {
    pushUnique("arc welding sparks");
    pushUnique("metal sparks closeup");
    pushUnique("rusted steel pipe");
    pushUnique("iron pipe industrial");
  } else if (
    /bursting|leaking\s+steam|riveted\s+iron\s+pipe|boiler\s+room|steam\s+pipe|بویلر|دیگ\s*بخار|لوله\s*بخار|انفجار\s*فشار|درز\s*آن\s*شکافته/i.test(
      p
    )
  ) {
    pushUnique("industrial boiler room");
    pushUnique("steam pipes factory");
    pushUnique("power plant pipes");
    pushUnique("high pressure steam pipes");
  } else if (
    /refinery|petrochemical|flare\s+stack|distillation|پالایشگاه|برج(?:‌های)?\s*تقطیر|مشعل\s*بلند|جنگل\s*برج/i.test(
      p
    )
  ) {
    pushUnique("oil refinery pipes");
    pushUnique("oil refinery night");
    pushUnique("petrochemical refinery");
    pushUnique("refinery towers industrial");
  } else if (
    /manifold|flanged\s+valve|astm|api\s*5l|زانویی|منیفولد|شیرهای\s*فلکی|اتصالات\s*فلنجی|شیر\s*صنعتی/i.test(
      p
    )
  ) {
    pushUnique("pipeline valve industrial");
    pushUnique("industrial pipe flange");
    pushUnique("refinery pipes valves");
    pushUnique("oil pipeline manifold");
  } else if (/furnace|ironworks|foundry|tongs|billet|کوره|شمش|گداخته|انبر|ذوب/i.test(p)) {
    pushUnique("molten steel");
    pushUnique("foundry sparks metal");
    pushUnique("steel furnace glowing");
    pushUnique("blast furnace steel");
  }

  // Persian-to-English general domain matcher
  for (const [rx, eng] of PERSIAN_TO_ENGLISH_VISUAL_MAP) {
    if (rx.test(promptText)) {
      pushUnique(eng);
    }
  }

  // Extract strong English nouns from prompt if present (excluding photography meta-words)
  const stopWords = new Set([
    "photorealistic",
    "cinematic",
    "film",
    "still",
    "frame",
    "vertical",
    "horizontal",
    "reel",
    "shot",
    "camera",
    "lens",
    "anamorphic",
    "lighting",
    "dramatic",
    "dark",
    "shadows",
    "highlights",
    "depth",
    "field",
    "motion",
    "slow",
    "push",
    "pan",
    "orbit",
    "with",
    "from",
    "into",
    "over",
    "under",
    "through",
    "near",
    "very",
    "high",
    "ultra",
    "realistic",
    "detailed",
    "scene",
    "view",
    "close",
    "wide",
    "angle",
    "medium",
    "macro",
    "extreme",
    "no",
    "text",
    "watermarks",
    "teal",
    "amber",
    "smoke",
    "volumetric",
    "color",
    "grade",
    "resolution",
    "24fps",
    "35mm",
    "85mm",
    "50mm",
    "the",
    "and",
    "for",
    "that",
    "this",
    "are",
    "was",
    "were",
    "its",
    "their",
    "showing",
    "inside",
    "outside",
    "around",
    "between",
    "against",
    "across",
    "surface",
    "glowing",
    "bright",
    "heavy",
    "massive",
    "ancient",
    "modern",
    "blurred",
    "background",
    "warm",
    "welcoming",
    "tone",
    "intense",
    "expressions",
    "moody",
    "drone",
    "like",
    "complex",
    "intricate",
  ]);
  const englishTokens = (promptText.match(/[a-zA-Z]{3,}/g) || [])
    .map((t) => t.toLowerCase())
    .filter((t) => !stopWords.has(t));
  const uniqueTokens = Array.from(new Set(englishTokens));
  if (uniqueTokens.length >= 2) {
    pushUnique(uniqueTokens.slice(0, 3).join(" "));
  }

  if (queries.length === 0) {
    const industrialFallbacks = [
      "steel factory interior",
      "industrial pipes metal",
      "molten steel sparks",
      "oil refinery pipes",
    ];
    pushUnique(industrialFallbacks[(Math.max(1, shotNumber) - 1) % industrialFallbacks.length]);
  }

  return queries.slice(0, 4);
}

/**
 * Converts a concise English query into comma-separated Flickr tags (max 3 tags so tagmode=all returns rich hits).
 */
export function buildFlickrTagsFromQuery(query: string): string {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 3);
  return words.join(",");
}

/**
 * Scores a candidate for photographic quality, aspect compatibility, topic relevance,
 * and zero diagrams/stereoscopes/watermarks/duplicates. Returns -1 for hard-rejected candidates.
 */
export function scoreRealMediaCandidate(params: {
  candidate: RealMediaCandidate;
  queryTerms: string[];
  aspectRatio: "9:16" | "16:9";
  usedUrls: ReadonlySet<string>;
  allowVintageMonochrome?: boolean;
}): number {
  const { candidate, queryTerms, aspectRatio, usedUrls, allowVintageMonochrome = false } = params;

  if (!candidate.downloadUrl || usedUrls.has(candidate.downloadUrl) || usedUrls.has(candidate.pageUrl)) {
    return -1;
  }

  const mime = (candidate.mimeType || "").toLowerCase();
  if (
    mime.includes("svg") ||
    mime.includes("pdf") ||
    mime.includes("gif") ||
    mime.includes("xcf") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/")
  ) {
    return -1;
  }

  const w = Number(candidate.width) || 0;
  const h = Number(candidate.height) || 0;
  if (w > 0 && h > 0) {
    if (w < 600 || h < 450 || Math.max(w, h) < 720) {
      return -1;
    }
    const ratio = w / h;
    if (ratio > 2.75 || ratio < 0.36) {
      return -1;
    }
  }

  const haystack = `${candidate.title} ${candidate.description}`.toLowerCase();
  if (BANNED_TITLE_OR_DESC_REGEX.test(haystack)) {
    return -1;
  }

  let score = candidate.provider === "flickr_public" ? 58 : 40;

  // Prefer native photographic JPEG
  if (mime === "image/jpeg" || /\.jpe?g$/i.test(candidate.title) || /\.jpe?g$/i.test(candidate.downloadUrl)) {
    score += 24;
  } else if (mime === "image/png" || mime === "image/webp") {
    score += 12;
  } else if (mime === "image/tiff") {
    score += 4;
  }

  // Resolution bonus (Flickr _b.jpg defaults to ~1024px)
  const maxDim = Math.max(w, h);
  if (maxDim >= 1800) score += 22;
  else if (maxDim >= 1000) score += 16;
  else if (maxDim === 0 && candidate.provider === "flickr_public") score += 14;
  else score += 6;

  // Aspect ratio alignment
  if (w > 0 && h > 0) {
    const ratio = w / h;
    if (aspectRatio === "9:16") {
      if (h >= w) score += 20;
      else if (ratio <= 1.38) score += 12;
      else if (ratio <= 1.65) score += 5;
      else score -= 8;
    } else {
      if (w >= h * 1.25) score += 20;
      else if (w >= h) score += 12;
      else score -= 10;
    }
  }

  // Relevance matching against query terms
  let matchedTerms = 0;
  for (const term of queryTerms) {
    const t = term.toLowerCase().trim();
    if (t.length >= 3 && haystack.includes(t)) {
      matchedTerms++;
    }
  }
  score += matchedTerms * 14;

  if (!allowVintageMonochrome && MONOCHROME_OR_ANTIQUE_HINT_REGEX.test(haystack)) {
    score -= 36;
  }

  if (/\(\d{4}\)\s*\(\d{8,}\)/.test(candidate.title)) {
    score -= 42;
  }

  return score;
}

/**
 * Searches Flickr Public Photography Feed (zero API key, zero watermarks, modern full-color photography!).
 * Uses `_m.jpg` (240px) for instant Vision Critic preview and `_b.jpg` (1024px) for high-res grading.
 */
async function searchFlickrPublicPhotos(
  query: string,
  limit = 10,
  tagmode: "all" | "any" = "all"
): Promise<RealMediaCandidate[]> {
  const tags = buildFlickrTagsFromQuery(query);
  if (!tags) return [];

  const url = `https://www.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tagmode=${tagmode}&tags=${encodeURIComponent(tags)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_000);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{
        title?: string;
        link?: string;
        media?: { m?: string };
        author?: string;
        tags?: string;
      }>;
    };

    const out: RealMediaCandidate[] = [];
    for (const item of (data.items || []).slice(0, limit)) {
      const mUrl = item.media?.m;
      if (!mUrl || !mUrl.includes("staticflickr.com")) continue;
      const bUrl = mUrl.replace(/_m\.jpg$/i, "_b.jpg");
      const rawAuthor = item.author || "Flickr Photographer";
      const authorClean = rawAuthor.replace(/^nobody@flickr\.com\s*\("?|"?\)$/g, "").trim() || "Flickr Photographer";

      out.push({
        id: `fl_${Math.random().toString(36).slice(2, 9)}`,
        title: item.title || query,
        description: item.tags || query,
        pageUrl: item.link || bUrl,
        downloadUrl: bUrl,
        previewUrl: mUrl,
        mimeType: "image/jpeg",
        width: 1024,
        height: 768,
        provider: "flickr_public",
        license: "Flickr Public Feed",
        author: authorClean,
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchWikimediaCommonsPhotos(query: string, limit = 10): Promise<RealMediaCandidate[]> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(`filetype:bitmap ${query}`)}` +
    `&gsrnamespace=6&gsrlimit=${limit}` +
    `&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1280&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_000);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            pageid?: number;
            title?: string;
            imageinfo?: Array<{
              url?: string;
              thumburl?: string;
              descriptionurl?: string;
              width?: number;
              height?: number;
              mime?: string;
              extmetadata?: {
                ImageDescription?: { value?: string };
                Artist?: { value?: string };
                LicenseShortName?: { value?: string };
              };
            }>;
          }
        >;
      };
    };

    const pages = Object.values(data.query?.pages || {});
    const out: RealMediaCandidate[] = [];

    for (const page of pages) {
      const ii = page.imageinfo?.[0];
      if (!ii) continue;
      const downloadUrl = ii.thumburl || ii.url;
      if (!downloadUrl) continue;
      // Fast small preview thumbnail for Vision Critic (320px width)
      const previewUrl = ii.thumburl ? ii.thumburl.replace(/\/\d+px-/, "/320px-") : downloadUrl;

      const rawDesc = ii.extmetadata?.ImageDescription?.value || "";
      const cleanDesc = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 260);
      const rawArtist = ii.extmetadata?.Artist?.value || "Wikimedia Commons Contributor";
      const cleanArtist = rawArtist.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

      out.push({
        id: `wm_${page.pageid || Math.random().toString(36).slice(2, 8)}`,
        title: (page.title || "").replace(/^File:/i, ""),
        description: cleanDesc,
        pageUrl: ii.descriptionurl || downloadUrl,
        downloadUrl,
        previewUrl,
        mimeType: ii.mime || "image/jpeg",
        width: ii.width || 0,
        height: ii.height || 0,
        provider: "wikimedia_commons",
        license: ii.extmetadata?.LicenseShortName?.value || "CC / Public Domain",
        author: cleanArtist || "Wikimedia Commons",
      });
    }

    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Multimodal AI Visual Curator Critic:
 * Downloads tiny preview thumbnails (~12KB each) of top candidates and sends them in a SINGLE
 * fast Gemini Vision call (`gemini-3.1-flash-lite` -> `gemini-4-hydrogen`) to literally SEE
 * every candidate and rank which real photograph matches the exact documentary shot best,
 * rejecting split-frames, borders, watermarks, tourists, trains, and off-topic buildings!
 */
async function selectBestCandidateWithVisionCritic(params: {
  candidates: RealMediaCandidate[];
  shotPrompt: string;
}): Promise<{ orderedIndices: number[]; topScore: number | null; reason: string | null }> {
  let apiKey = "";
  try {
    apiKey = getGoogleApiKeyFromRouter();
  } catch {
    apiKey = "";
  }
  if (!apiKey || params.candidates.length <= 1) {
    return {
      orderedIndices: params.candidates.map((_, i) => i),
      topScore: null,
      reason: null,
    };
  }

  const subset = params.candidates.slice(0, 6);

  // Download small preview thumbnails in parallel (max 4s timeout)
  const previews = await Promise.all(
    subset.map(async (c, idx) => {
      const targetUrl = c.previewUrl || c.downloadUrl;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4_500);
      try {
        const r = await fetch(targetUrl, {
          headers: { "User-Agent": USER_AGENT },
          signal: controller.signal,
        });
        if (!r.ok) return null;
        const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
        if (!ct.startsWith("image/") || ct.includes("svg")) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.byteLength < 2_500 || buf.byteLength > 2_000_000) return null;
        return { idx, mimeType: ct, base64: buf.toString("base64") };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })
  );

  const validPreviews = previews.filter((p): p is NonNullable<typeof p> => p !== null);
  if (validPreviews.length < 2) {
    return {
      orderedIndices: params.candidates.map((_, i) => i),
      topScore: null,
      reason: null,
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: { apiVersion: "v1beta", headers: { "User-Agent": "aistudio-build" } },
  });

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: `You are a Hollywood Documentary Cinematographer selecting the BEST real photograph for a documentary shot.
Target shot description:
"${params.shotPrompt.slice(0, 420)}"

I am showing you ${validPreviews.length} candidate photographs labeled by their index number.
Score EACH photograph from 0 to 10 on:
1. Exact subject accuracy & IMMEDIATE VISUAL READABILITY (highest weight!): A normal viewer must recognize the complete object, machine, or industrial room within 0.5 seconds! PENALIZE heavily (score <= 3) extreme tight macro close-ups of an unrecognizable rusted bolt, abstract metal surface, or cryptic zoomed-in object with no environmental context — prefer clear MEDIUM or WIDE-MEDIUM documentary camera distance!
2. Rich, vivid, modern, cinematic full-color photography (penalize dull B&W unless clearly powerful)
3. Clean single full-frame composition (SCORE 0 IMMEDIATELY if it has: split-frames/stereoscopes, black borders/frames, printed text/captions/watermarks, diagrams/drawings, random tourists with laptops, street traffic/trains/crossings, outdoor road or railway construction workers wearing hi-vis yellow/orange safety vests near plastic barriers or cardboard boxes, or unrelated buildings!).

Return strict JSON with "rankings": an array sorted from BEST to WORST containing { "index": number, "score": number, "reason": string }.`,
    },
  ];

  for (const vp of validPreviews) {
    parts.push({ text: `--- Candidate index ${vp.idx} ---` });
    parts.push({ inlineData: { mimeType: vp.mimeType, data: vp.base64 } });
  }

  const modelsToTry = ["gemini-3.1-flash-lite", "gemini-4-hydrogen"];
  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rankings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    index: { type: Type.INTEGER },
                    score: { type: Type.NUMBER },
                    reason: { type: Type.STRING },
                  },
                  required: ["index", "score", "reason"],
                },
              },
            },
            required: ["rankings"],
          },
        } as never,
      });

      const raw = (response.text || "").trim();
      const parsed = JSON.parse(raw) as {
        rankings?: Array<{ index: number; score: number; reason: string }>;
      };
      if (Array.isArray(parsed.rankings) && parsed.rankings.length > 0) {
        const sorted = [...parsed.rankings]
          .filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < params.candidates.length)
          .sort((a, b) => b.score - a.score);

        if (sorted.length > 0) {
          // Keep candidates with score >= 3 ahead of remaining uninspected candidates
          const chosen = sorted.filter((r) => r.score >= 3).map((r) => r.index);
          const remaining = params.candidates
            .map((_, i) => i)
            .filter((i) => !chosen.includes(i));
          return {
            orderedIndices: [...chosen, ...remaining],
            topScore: Math.round(sorted[0].score * 10) / 10,
            reason: sorted[0].reason || null,
          };
        }
      }
    } catch {
      // Try next vision model
    }
  }

  return {
    orderedIndices: params.candidates.map((_, i) => i),
    topScore: null,
    reason: null,
  };
}

/**
 * Inspects a downloaded photo with FFmpeg signalstats to verify it is a valid, non-blank,
 * color-rich photograph.
 */
export async function inspectDownloadedPhotoStats(imagePath: string): Promise<{
  valid: boolean;
  lumaAvg: number;
  satAvg: number;
}> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        imagePath,
        "-vf",
        "scale=240:-2,signalstats,metadata=print:file=-",
        "-f",
        "null",
        "-",
      ],
      { timeout: 10_000 }
    );
    const combined = `${stdout}\n${stderr}`;
    const yMatch = combined.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
    const sMatch = combined.match(/lavfi\.signalstats\.SATAVG=([0-9.]+)/);
    const lumaAvg = yMatch ? parseFloat(yMatch[1]) : 90;
    const satAvg = sMatch ? parseFloat(sMatch[1]) : 28;
    return { valid: lumaAvg > 12 && lumaAvg < 245, lumaAvg, satAvg };
  } catch {
    return { valid: false, lumaAvg: 0, satAvg: 0 };
  }
}

/**
 * Scales, smart-crops edge-to-edge, and applies unified reference Cinema Color Science
 * (ARRI Teal-and-Amber / Moody Documentary film grade) so every real photograph shares
 * a cohesive Hollywood documentary visual identity.
 */
export async function gradeRealPhotoToCinemaKeyframe(params: {
  inputPath: string;
  outputPngPath: string;
  width: number;
  height: number;
  mood: DocumentaryColorMood;
}): Promise<void> {
  const { inputPath, outputPngPath, width, height, mood } = params;
  fs.mkdirSync(path.dirname(outputPngPath), { recursive: true });

  let colorGradeChain: string;
  switch (mood) {
    case "teal_amber_foundry":
      colorGradeChain = [
        "eq=contrast=1.12:brightness=-0.02:saturation=1.22:gamma=0.96",
        "colorbalance=rs=-0.06:gs=-0.01:bs=0.07:rm=0.05:gm=0.01:bm=-0.05:rh=0.11:gh=0.04:bh=-0.09",
        "curves=m='0/0.02 0.25/0.21 0.55/0.56 0.85/0.89 1/1'",
        "vignette=angle=PI/6.2",
      ].join(",");
      break;
    case "refinery_twilight":
      colorGradeChain = [
        "eq=contrast=1.14:brightness=-0.02:saturation=1.18:gamma=0.96",
        "colorbalance=rs=-0.07:gs=0.00:bs=0.09:rm=0.02:gm=0.00:bm=0.02:rh=0.10:gh=0.05:bh=-0.06",
        "curves=m='0/0.02 0.28/0.23 0.6/0.62 1/1'",
        "vignette=angle=PI/6.0",
      ].join(",");
      break;
    case "moody_steam_boiler":
      colorGradeChain = [
        "eq=contrast=1.12:brightness=-0.02:saturation=1.14:gamma=0.96",
        "colorbalance=rs=-0.05:gs=0.01:bs=0.06:rm=0.03:gm=0.01:bm=-0.02:rh=0.08:gh=0.03:bh=-0.04",
        "curves=m='0/0.02 0.25/0.21 0.65/0.68 1/1'",
        "vignette=angle=PI/6.4",
      ].join(",");
      break;
    case "clean_industrial":
      colorGradeChain = [
        "eq=contrast=1.10:brightness=-0.01:saturation=1.12:gamma=0.98",
        "colorbalance=rs=-0.04:gs=0.00:bs=0.05:rh=0.06:gh=0.03:bh=-0.03",
        "vignette=angle=PI/7.0",
      ].join(",");
      break;
    default:
      colorGradeChain = [
        "eq=contrast=1.08:saturation=1.10",
        "colorbalance=rs=-0.02:gs=0.00:bs=0.03:rh=0.04:gh=0.02:bh=-0.02",
        "vignette=angle=PI/7.2",
      ].join(",");
      break;
  }

  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2`,
    "unsharp=3:3:0.35:3:3:0.0",
    colorGradeChain,
    "format=rgb24",
  ].join(",");

  await execFileAsync(
    "ffmpeg",
    ["-y", "-i", inputPath, "-vf", vf, "-frames:v", "1", outputPngPath],
    { timeout: 25_000 }
  );
}

/**
 * Curates, visually inspects via Gemini Multimodal Vision Critic, downloads, quality-checks,
 * and color-grades a genuine high-resolution real-world documentary photograph matched to the shot.
 */
export async function curatePhotorealisticShotKeyframe(params: {
  prompt: string;
  shotNumber: number;
  width: number;
  height: number;
  outputPngPath: string;
  usedUrls?: Set<string>;
}): Promise<CuratedKeyframeResult> {
  const aspectRatio: "9:16" | "16:9" = params.width > params.height ? "16:9" : "9:16";
  const usedUrls = params.usedUrls || new Set<string>();
  const mood = classifyDocumentaryMood(params.prompt);
  const queries = buildDocumentaryMediaQueries(params.prompt, params.shotNumber);

  const allowVintageMonochrome = /black\s*and\s*white|monochrome|سیاه\s*و\s*سفید/i.test(params.prompt);
  const allCandidates = new Map<string, { candidate: RealMediaCandidate; score: number }>();

  // Query BOTH Flickr Public Photography Feed (modern full-color photography!) AND Wikimedia Commons in parallel
  const primaryQueries = queries.slice(0, 2);
  await Promise.all(
    primaryQueries.map(async (q) => {
      const queryTerms = q.split(/\s+/).filter(Boolean);
      const [flickrHits, wikiHits] = await Promise.all([
        searchFlickrPublicPhotos(q, 10),
        searchWikimediaCommonsPhotos(q, 8),
      ]);
      for (const c of [...flickrHits, ...wikiHits]) {
        const score = scoreRealMediaCandidate({
          candidate: c,
          queryTerms,
          aspectRatio,
          usedUrls,
          allowVintageMonochrome,
        });
        if (score > 0) {
          const prev = allCandidates.get(c.downloadUrl);
          if (!prev || score > prev.score) {
            allCandidates.set(c.downloadUrl, { candidate: c, score });
          }
        }
      }
    })
  );

  // Try secondary queries if pool is small
  if (allCandidates.size < 4) {
    for (const q of queries.slice(2)) {
      const queryTerms = q.split(/\s+/).filter(Boolean);
      const [flickrHits, wikiHits] = await Promise.all([
        searchFlickrPublicPhotos(q, 8),
        searchWikimediaCommonsPhotos(q, 8),
      ]);
      for (const c of [...flickrHits, ...wikiHits]) {
        const score = scoreRealMediaCandidate({
          candidate: c,
          queryTerms,
          aspectRatio,
          usedUrls,
          allowVintageMonochrome,
        });
        if (score > 0 && !allCandidates.has(c.downloadUrl)) {
          allCandidates.set(c.downloadUrl, { candidate: c, score });
        }
      }
      if (allCandidates.size >= 6) break;
    }
  }

  const preRanked = Array.from(allCandidates.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((x) => x.candidate);

  if (preRanked.length === 0) {
    throw new Error(`No suitable real-world documentary photographs found for queries: ${queries.join(", ")}`);
  }

  // Mix balanced top Flickr + top Wikimedia candidates (3 + 3) with per-author dedup so spam reposters
  // cannot fill multiple Vision Critic slots with identical photos!
  const buildBalancedShortlist = (ranked: RealMediaCandidate[]): RealMediaCandidate[] => {
    const dedupByAuthor = (items: RealMediaCandidate[], maxCount: number): RealMediaCandidate[] => {
      const picked: RealMediaCandidate[] = [];
      const seenAuthors = new Set<string>();
      for (const item of items) {
        const authorKey = `${item.provider}:${(item.author || "").toLowerCase().trim()}`;
        if (item.provider === "flickr_public" && authorKey.length > 15 && seenAuthors.has(authorKey)) {
          continue;
        }
        seenAuthors.add(authorKey);
        picked.push(item);
        if (picked.length >= maxCount) break;
      }
      return picked;
    };
    const topFlickr = dedupByAuthor(ranked.filter((c) => c.provider === "flickr_public"), 3);
    const topWiki = dedupByAuthor(ranked.filter((c) => c.provider === "wikimedia_commons"), 3);
    // Interleave Flickr & Wikimedia so Vision Critic inspects diverse real photos from both sources
    const interleaved: RealMediaCandidate[] = [];
    for (let i = 0; i < 3; i++) {
      if (topWiki[i]) interleaved.push(topWiki[i]);
      if (topFlickr[i]) interleaved.push(topFlickr[i]);
    }
    return [
      ...interleaved,
      ...ranked.filter((c) => !interleaved.includes(c)),
    ].slice(0, 10);
  };

  let shortlist = buildBalancedShortlist(preRanked);

  // Round 1: Let Gemini Multimodal Vision Critic visually inspect the top 6 candidates!
  let visionResult = await selectBestCandidateWithVisionCritic({
    candidates: shortlist,
    shotPrompt: params.prompt,
  });

  // Round 2 Auto-Retry: If Round 1 Vision Critic found no strong match (score < 6.0),
  // expand to secondary/tertiary queries using strict 2-word Flickr tags (no noisy tagmode=any!)
  // plus deeper Wikimedia Commons industrial photography search!
  if (visionResult.topScore !== null && visionResult.topScore < 6.0) {
    const seenInRound1 = new Set<string>(shortlist.map((c) => c.downloadUrl));
    const round2Pool = new Map<string, { candidate: RealMediaCandidate; score: number }>();
    const retryQueries = Array.from(new Set([...queries.slice(2), ...queries.slice(0, 2)]));

    await Promise.all(
      retryQueries.slice(0, 3).map(async (q) => {
        const queryTerms = q.split(/\s+/).filter(Boolean);
        const strictTwoWord = queryTerms.slice(0, 2).join(" ");
        const [flickrHits, wikiHits] = await Promise.all([
          searchFlickrPublicPhotos(strictTwoWord, 10, "all"),
          searchWikimediaCommonsPhotos(q, 16),
        ]);
        for (const c of [...flickrHits, ...wikiHits]) {
          if (seenInRound1.has(c.downloadUrl)) continue;
          const score = scoreRealMediaCandidate({
            candidate: c,
            queryTerms,
            aspectRatio,
            usedUrls,
            allowVintageMonochrome,
          });
          if (score > 0) {
            const prev = round2Pool.get(c.downloadUrl);
            if (!prev || score > prev.score) {
              round2Pool.set(c.downloadUrl, { candidate: c, score });
            }
          }
        }
      })
    );

    const round2Ranked = Array.from(round2Pool.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.candidate);

    if (round2Ranked.length >= 2) {
      const round2Shortlist = buildBalancedShortlist(round2Ranked);
      const round2Vision = await selectBestCandidateWithVisionCritic({
        candidates: round2Shortlist,
        shotPrompt: params.prompt,
      });
      if (
        round2Vision.topScore !== null &&
        round2Vision.topScore > (visionResult.topScore ?? -1)
      ) {
        shortlist = round2Shortlist;
        visionResult = round2Vision;
      }
    }
  }

  const finalOrder = visionResult.orderedIndices.map((idx) => shortlist[idx]).filter(Boolean);

  const tmpDir = path.join(path.dirname(params.outputPngPath), ".curator_tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  let fallbackGrayscaleCandidate: {
    candidate: RealMediaCandidate;
    rawPath: string;
    stats: { lumaAvg: number; satAvg: number };
  } | null = null;

  try {
    for (let i = 0; i < finalOrder.length; i++) {
      const candidate = finalOrder[i];
      const rawPath = path.join(tmpDir, `cand_${params.shotNumber}_${Date.now()}_${i}.img`);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12_000);
        const res = await fetch(candidate.downloadUrl, {
          headers: { "User-Agent": USER_AGENT },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) continue;

        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (!ct.startsWith("image/") || ct.includes("svg")) continue;

        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength < 14_000) continue;

        fs.writeFileSync(rawPath, buf);
        const stats = await inspectDownloadedPhotoStats(rawPath);
        if (!stats.valid) {
          fs.unlinkSync(rawPath);
          continue;
        }

        if (stats.satAvg >= 10 || allowVintageMonochrome || (i === 0 && (visionResult.topScore ?? 0) >= 8)) {
          await gradeRealPhotoToCinemaKeyframe({
            inputPath: rawPath,
            outputPngPath: params.outputPngPath,
            width: params.width,
            height: params.height,
            mood,
          });
          usedUrls.add(candidate.downloadUrl);
          usedUrls.add(candidate.pageUrl);
          return {
            outputPngPath: params.outputPngPath,
            sourceUrl: candidate.downloadUrl,
            pageUrl: candidate.pageUrl,
            sourceTitle: candidate.title,
            sourceProvider: candidate.provider,
            license: candidate.license,
            author: candidate.author,
            mood,
            queriesTried: queries,
            visionCriticScore: i === 0 ? visionResult.topScore : null,
            visionCriticReason: i === 0 ? visionResult.reason : null,
            colorSaturationAvg: Math.round(stats.satAvg * 10) / 10,
            lumaAvg: Math.round(stats.lumaAvg * 10) / 10,
            width: params.width,
            height: params.height,
          };
        }

        if (!fallbackGrayscaleCandidate) {
          fallbackGrayscaleCandidate = { candidate, rawPath, stats };
        } else {
          fs.unlinkSync(rawPath);
        }
      } catch {
        try {
          if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
        } catch {
          // ignore
        }
      }
    }

    if (fallbackGrayscaleCandidate) {
      const { candidate, rawPath, stats } = fallbackGrayscaleCandidate;
      await gradeRealPhotoToCinemaKeyframe({
        inputPath: rawPath,
        outputPngPath: params.outputPngPath,
        width: params.width,
        height: params.height,
        mood,
      });
      usedUrls.add(candidate.downloadUrl);
      usedUrls.add(candidate.pageUrl);
      return {
        outputPngPath: params.outputPngPath,
        sourceUrl: candidate.downloadUrl,
        pageUrl: candidate.pageUrl,
        sourceTitle: candidate.title,
        sourceProvider: candidate.provider,
        license: candidate.license,
        author: candidate.author,
        mood,
        queriesTried: queries,
        visionCriticScore: visionResult.topScore,
        visionCriticReason: visionResult.reason,
        colorSaturationAvg: Math.round(stats.satAvg * 10) / 10,
        lumaAvg: Math.round(stats.lumaAvg * 10) / 10,
        width: params.width,
        height: params.height,
      };
    }

    throw new Error("All candidate documentary photographs failed download or quality validation.");
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
