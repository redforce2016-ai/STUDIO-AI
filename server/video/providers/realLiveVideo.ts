import { GoogleGenAI, Type } from "@google/genai";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getGoogleApiKeyFromRouter } from "../../router.js";
import { getVideosDir } from "../../store.js";
import {
  buildPhotorealisticFoleyAudioFilter,
  type PhotorealisticFxProfile,
} from "./photorealisticMotion.js";
import { classifyDocumentaryMood, type DocumentaryColorMood } from "./realMediaCurator.js";

const execFileAsync = promisify(execFile);

const USER_AGENT =
  "CinemaStudioLiveVideoEngine/3.0 (https://github.com/cinema-studio-ai; live-footage@localhost)";

export interface LiveVideoCandidate {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  pageUrl: string;
  mimeType: string;
  width: number;
  height: number;
  durationSec: number;
  sizeBytes?: number;
  license: string;
  author: string;
}

export interface RealLiveVideoResult {
  outputPath: string;
  sourceTitle: string;
  sourceUrl: string;
  pageUrl: string;
  sourceStartSec: number;
  durationSec: number;
  visionMatchScore: number | null;
  visionMatchReason: string | null;
  mood: DocumentaryColorMood;
  fxProfile: PhotorealisticFxProfile;
  width: number;
  height: number;
  fps: number;
  hasRealMotion: boolean;
}

const BANNED_VIDEO_TITLE_REGEX =
  /\b(speaking|remarks|interview|press[\s_-]+conference|protest|speech|podcast|lecture|debate|animation|cartoon|diagram|graph|chart|computational|animal|mice|mouse|pulmonary|death[\s_-]+mills|holocaust|nazi|train|railroad|metro-north|station|bridge|kcic|whoosh|märklin|marklin|traction[\s_-]+engine|anthem|teaser|tyre[\s_-]+fix|piston[\s_-]+repair|pvc|plastic|milk|hoover|windmill|model|disaster|fire[\s_-]+at|refinery[\s_-]+fire|fires|satellite|viirs|cira|demolition|birthday[\s_-]+cake|pepper|wikipedia|videowiki|newsreel|fear[\s_-]+factory|sport|sauna|cancer|water[\s_-]+supply|sidewalk|burrell|gof\s+a\s+gweithiwr|nexus[\s_-]+forge)\b|विकिपीडिया|ଭିଡିଓ/i;

/**
 * Pure helper: ranks real Wikimedia Commons HD live-action video candidates for documentary usability,
 * rejecting talking heads, trains, protests, diagrams, model toys, and low-res clips.
 */
export function scoreLiveVideoCandidate(params: {
  candidate: LiveVideoCandidate;
  queryTerms: string[];
  usedSegments?: ReadonlySet<string>;
  preferPortrait?: boolean;
}): number {
  const { candidate, queryTerms } = params;
  if (!candidate.videoUrl) return -1;
  if (candidate.width < 600 || candidate.height < 360) return -1;
  if (candidate.durationSec < 5) return -1;
  // Skip gigantic > 140MB files so downloading + caching stays fast and reliable
  if (candidate.sizeBytes && candidate.sizeBytes > 140 * 1024 * 1024) return -1;

  const haystack = `${candidate.title} ${candidate.description}`.toLowerCase();
  if (BANNED_VIDEO_TITLE_REGEX.test(haystack)) {
    return -1;
  }

  let score = 40;
  // Resolution preference (720p / 1080p / 4K real camera footage)
  if (candidate.width >= 1900 || candidate.height >= 1900) score += 26;
  else if (candidate.width >= 1200 || candidate.height >= 1200) score += 22;
  else if (candidate.width >= 800) score += 14;

  // Prefer modern compact WebM/MP4 that downloads fast (1MB - 40MB sweet spot)
  if (/webm|mp4/i.test(candidate.mimeType)) score += 12;
  if (candidate.sizeBytes) {
    const mb = candidate.sizeBytes / (1024 * 1024);
    if (mb <= 25) score += 14;
    else if (mb <= 65) score += 8;
  }

  // Sweet spot duration
  if (candidate.durationSec >= 12 && candidate.durationSec <= 600) score += 14;
  else if (candidate.durationSec > 600) score += 6;

  // Keyword relevance
  for (const term of queryTerms) {
    const t = term.toLowerCase().trim();
    if (t.length >= 3 && haystack.includes(t)) {
      score += 18;
    }
  }

  // Native portrait 9:16 bonus when rendering vertical Reels
  if (params.preferPortrait && candidate.height > candidate.width) {
    score += 18;
  }

  // Bonus for verified continuous industrial/steel/welding/forge/steam/lathe/refinery live-action documentaries
  if (
    /acroni|valjan|butt-welding|torch\s*cutting|smithy|steel\s*forging|steam\s*engine\s*1903|доменн|blast\s*furnace|abfackelung|lathe\s+in\s+finland|cnc\s+lathe|steel\s*mills|nexus\s*forge|finkl/i.test(
      haystack
    )
  ) {
    score += 30;
  } else if (/steel|forge|welding|steam|furnace|refinery|foundry|grinding/i.test(haystack)) {
    score += 18;
  }

  return score;
}

/**
 * Queries Wikimedia Commons for genuine open-licensed HD/4K live-action documentary videos (`filetype:video`).
 */
export async function searchWikimediaLiveVideos(
  query: string,
  limit = 8
): Promise<LiveVideoCandidate[]> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(`filetype:video ${query}`)}` +
    `&gsrnamespace=6&gsrlimit=${limit}` +
    `&prop=imageinfo&iiprop=url|size|mime|duration|extmetadata&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
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
              descriptionurl?: string;
              width?: number;
              height?: number;
              size?: number;
              duration?: number;
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

    const out: LiveVideoCandidate[] = [];
    for (const page of Object.values(data.query?.pages || {})) {
      const ii = page.imageinfo?.[0];
      if (!ii?.url) continue;
      // Strip tracking query strings so cache keys and HTTP requests stay clean
      const cleanUrl = ii.url.split("?")[0];
      const rawDesc = ii.extmetadata?.ImageDescription?.value || "";
      const cleanDesc = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
      const rawArtist = ii.extmetadata?.Artist?.value || "Wikimedia Commons";
      const cleanArtist = rawArtist.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

      out.push({
        id: `wmv_${page.pageid || Math.random().toString(36).slice(2, 8)}`,
        title: (page.title || "").replace(/^File:/i, ""),
        description: cleanDesc,
        videoUrl: cleanUrl,
        pageUrl: ii.descriptionurl || cleanUrl,
        mimeType: ii.mime || "video/webm",
        width: Number(ii.width) || 0,
        height: Number(ii.height) || 0,
        sizeBytes: Number(ii.size) || 0,
        durationSec: Number(ii.duration) || 0,
        license: ii.extmetadata?.LicenseShortName?.value || "CC / Public Domain",
        author: cleanArtist,
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
 * Computes diverse non-overlapping candidate seek timestamps across a live video
 * so multiple shots drawing from a long documentary film never repeat the same scene.
 */
export function pickCandidateSeekTimestamps(
  durationSec: number,
  clipDurationSec: number,
  shotNumber: number,
  usedSegmentKeys?: ReadonlySet<string>,
  videoId?: string
): number[] {
  const usable = Math.max(2, durationSec - clipDurationSec - 1);
  if (usable <= 3) return [0];

  const fractions =
    durationSec >= 120
      ? [0.12, 0.24, 0.36, 0.48, 0.60, 0.72, 0.84]
      : durationSec >= 24
        ? [0.10, 0.32, 0.54, 0.76]
        : [0.08, 0.38, 0.62];

  const shift = Math.max(0, shotNumber - 1) % fractions.length;
  const rotated = [...fractions.slice(shift), ...fractions.slice(0, shift)];

  const timestamps: number[] = [];
  for (const f of rotated) {
    const sec = Math.max(0.5, Math.min(usable, Math.round(durationSec * f * 10) / 10));
    const bucketKey = videoId ? `${videoId}@${Math.floor(sec / 10)}` : `${Math.floor(sec)}`;
    if (usedSegmentKeys && usedSegmentKeys.has(bucketKey)) continue;
    timestamps.push(sec);
    if (timestamps.length >= 4) break;
  }

  if (timestamps.length === 0) {
    timestamps.push(Math.max(0.5, Math.round(usable * 0.25)));
  }
  return timestamps;
}

/**
 * Downloads a Wikimedia Commons video ONCE with a single polite HTTP request into `/data/videos/.live_cache/`
 * so all FFmpeg frame probing and clip trimming runs at local SSD speed with ZERO HTTP 429 rate limits!
 */
async function ensureCachedLocalVideo(candidate: LiveVideoCandidate): Promise<string | null> {
  const cacheDir = path.join(getVideosDir(), ".live_cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const extMatch = candidate.videoUrl.match(/\.(webm|mp4|ogv|ogg|mov)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : "webm";
  const safeId = candidate.id.replace(/[^a-z0-9_-]/gi, "_");
  const localPath = path.join(cacheDir, `${safeId}.${ext}`);

  if (fs.existsSync(localPath) && fs.statSync(localPath).size > 40_000) {
    return localPath;
  }

  const tmpPath = `${localPath}.part_${Date.now()}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(candidate.videoUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "video/*,application/ogg,*/*;q=0.8",
        },
        signal: controller.signal,
      });
      if (res.status === 429) {
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 40_000) return null;
      fs.writeFileSync(tmpPath, buf);
      fs.renameSync(tmpPath, localPath);
      return localPath;
    } catch {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Extracts a single lightweight JPEG probe frame from a locally cached video file (instant SSD speed).
 */
async function probeLocalVideoFrame(
  localVideoPath: string,
  seekSec: number,
  outJpgPath: string
): Promise<boolean> {
  try {
    // Probe at seekSec + 1.5s (the heart of the 5s cut) so dark fade-ins or scene transitions are rejected!
    const midSeek = seekSec + 1.5;
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        midSeek.toFixed(1),
        "-i",
        localVideoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2",
        "-q:v",
        "6",
        outJpgPath,
      ],
      { timeout: 12_000 }
    );
    // Reject near-black / solid / empty transition frames (< 9KB JPEG at 480px width)
    return fs.existsSync(outJpgPath) && fs.statSync(outJpgPath).size > 9_000;
  } catch {
    return false;
  }
}

/**
 * Uses Gemini Multimodal Vision Critic to literally SEE candidate frames from real live-action HD videos
 * and pick the single best real-world live action moment matching the shot's scenario!
 */
async function selectBestLiveSegmentWithVisionCritic(params: {
  probes: Array<{
    candidate: LiveVideoCandidate;
    localVideoPath: string;
    seekSec: number;
    framePath: string;
  }>;
  shotPrompt: string;
}): Promise<{ bestIdx: number; score: number | null; reason: string | null }> {
  if (params.probes.length <= 1) {
    return { bestIdx: 0, score: null, reason: null };
  }

  let apiKey = "";
  try {
    apiKey = getGoogleApiKeyFromRouter();
  } catch {
    apiKey = "";
  }
  if (!apiKey) {
    return { bestIdx: 0, score: null, reason: null };
  }

  const ai = new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: { apiVersion: "v1beta", headers: { "User-Agent": "aistudio-build" } },
  });

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: `You are a Documentary Film Editor choosing the SINGLE BEST real live-action video segment for this shot:
"${params.shotPrompt.slice(0, 420)}"

I am showing you ${params.probes.length} real video frames captured from live HD documentary videos (indexed 0..${params.probes.length - 1}).
Score each frame from 0 to 10 on:
1. Exact visual match to the industrial/documentary scenario (clear recognizable machinery, pipes, molten steel, welding sparks, steam, factory or refinery — NOT title cards, NOT credits, NOT black screens, NOT talking-head interviews, NOT trains!).
2. Clear readable medium/wide documentary camera distance and vivid real-life film look.
3. Zero printed titles, credits, watermarks, or black borders.

Return strict JSON: { "bestIndex": integer, "score": number, "reason": string }.`,
    },
  ];

  for (let i = 0; i < params.probes.length; i++) {
    const p = params.probes[i];
    const b64 = fs.readFileSync(p.framePath).toString("base64");
    parts.push({ text: `--- Segment ${i} (${p.candidate.title} @ ${p.seekSec}s) ---` });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
  }

  for (const model of ["gemini-3.1-flash-lite", "gemini-4-hydrogen"]) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bestIndex: { type: Type.INTEGER },
              score: { type: Type.NUMBER },
              reason: { type: Type.STRING },
            },
            required: ["bestIndex", "score", "reason"],
          },
        } as never,
      });

      const parsed = JSON.parse((response.text || "").trim()) as {
        bestIndex?: number;
        score?: number;
        reason?: string;
      };
      if (
        Number.isInteger(parsed.bestIndex) &&
        (parsed.bestIndex as number) >= 0 &&
        (parsed.bestIndex as number) < params.probes.length
      ) {
        return {
          bestIdx: parsed.bestIndex as number,
          score: Math.round(Number(parsed.score ?? 7.5) * 10) / 10,
          reason: parsed.reason || null,
        };
      }
    } catch {
      // Try next vision model
    }
  }

  return { bestIdx: 0, score: null, reason: null };
}

function classifyLiveFxProfile(prompt: string, mood: DocumentaryColorMood): PhotorealisticFxProfile {
  const p = prompt.toLowerCase();
  if (
    mood === "teal_amber_foundry" ||
    /molten|furnace|weld|spark|billet|rolling|کوره|گداخته|جوش|جرقه|نورد/i.test(p)
  ) {
    return "molten_fire";
  }
  if (mood === "moody_steam_boiler" || /boiler|steam|بخار|بویلر/i.test(p)) {
    return "pressurized_steam";
  }
  if (mood === "refinery_twilight" || /refinery|پالایشگاه|پتروشیمی/i.test(p)) {
    return "refinery_night";
  }
  return "industrial_clean";
}

function buildCinemaGradeFilterForLiveVideo(mood: DocumentaryColorMood): string {
  // Full-bleed edge-to-edge ARRI Teal-and-Amber documentary grade (NO FFmpeg vignette, which clips 9:16 portrait corners to black ovals!)
  switch (mood) {
    case "teal_amber_foundry":
      return [
        "eq=contrast=1.10:brightness=-0.01:saturation=1.18:gamma=0.97",
        "colorbalance=rs=-0.05:gs=-0.01:bs=0.06:rm=0.04:gm=0.01:bm=-0.04:rh=0.09:gh=0.03:bh=-0.07",
      ].join(",");
    case "refinery_twilight":
      return [
        "eq=contrast=1.12:brightness=-0.02:saturation=1.15:gamma=0.96",
        "colorbalance=rs=-0.06:gs=0.00:bs=0.08:rh=0.08:gh=0.04:bh=-0.05",
      ].join(",");
    case "moody_steam_boiler":
      return [
        "eq=contrast=1.10:brightness=-0.01:saturation=1.10:gamma=0.97",
        "colorbalance=rs=-0.04:gs=0.01:bs=0.05:rh=0.06:gh=0.02:bh=-0.03",
      ].join(",");
    default:
      return [
        "eq=contrast=1.08:saturation=1.08",
        "colorbalance=rs=-0.03:gs=0.00:bs=0.04:rh=0.05:gh=0.02:bh=-0.02",
      ].join(",");
  }
}

/**
 * Curates, caches once locally (zero HTTP 429!), visually verifies via Gemini Vision Critic,
 * trims the best live-action beat, and cinema-grades a 100% REAL LIVE-ACTION HD DOCUMENTARY VIDEO CLIP!
 */
export async function renderRealLiveActionDocumentaryClip(params: {
  prompt: string;
  searchQueries: string[];
  shotNumber: number;
  durationSec: number;
  width: number;
  height: number;
  fps?: number;
  outputPath: string;
  usedSegmentKeys?: Set<string>;
}): Promise<RealLiveVideoResult> {
  const fps = params.fps || 24;
  const durSec = Math.max(3, Math.min(12, Number(params.durationSec) || 5));
  const mood = classifyDocumentaryMood(params.prompt);
  const fxProfile = classifyLiveFxProfile(params.prompt, mood);
  const usedSegmentKeys = params.usedSegmentKeys || new Set<string>();

  const queries =
    params.searchQueries.length > 0
      ? params.searchQueries.slice(0, 3)
      : ["rolling mill", "welding", "metal forge"];

  const preferPortrait = params.height > params.width;
  // 1. Search Wikimedia Commons real HD live-action videos sequentially (polite to Wikimedia API)
  const pool = new Map<string, { candidate: LiveVideoCandidate; score: number }>();
  for (const q of queries) {
    const terms = q.split(/\s+/).filter(Boolean);
    const hits = await searchWikimediaLiveVideos(q, 8);
    for (const c of hits) {
      const score = scoreLiveVideoCandidate({
        candidate: c,
        queryTerms: terms,
        usedSegments: usedSegmentKeys,
        preferPortrait,
      });
      if (score > 0) {
        const prev = pool.get(c.videoUrl);
        if (!prev || score > prev.score) {
          pool.set(c.videoUrl, { candidate: c, score });
        }
      }
    }
    if (pool.size >= 6) break;
  }

  // Broad industrial safety net if niche query returned zero videos
  if (pool.size === 0) {
    for (const q of ["welding", "metal forge", "rolling mill", "steam engine"]) {
      const hits = await searchWikimediaLiveVideos(q, 6);
      for (const c of hits) {
        const score = scoreLiveVideoCandidate({
          candidate: c,
          queryTerms: q.split(/\s+/),
          usedSegments: usedSegmentKeys,
        });
        if (score > 0 && !pool.has(c.videoUrl)) {
          pool.set(c.videoUrl, { candidate: c, score });
        }
      }
      if (pool.size >= 2) break;
    }
  }

  const rankedCandidates = Array.from(pool.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.candidate);

  if (rankedCandidates.length === 0) {
    throw new Error(`هیچ ویدیوی مستند زنده HD برای عبارت‌های [${queries.join(", ")}] یافت نشد.`);
  }

  // 2. Download up to 2 best candidates sequentially into local cache (zero parallel 429s!)
  const cachedReady: Array<{ candidate: LiveVideoCandidate; localVideoPath: string }> = [];
  for (const cand of rankedCandidates) {
    const localPath = await ensureCachedLocalVideo(cand);
    if (localPath) {
      cachedReady.push({ candidate: cand, localVideoPath: localPath });
      if (cachedReady.length >= 2) break;
    }
  }

  if (cachedReady.length === 0) {
    throw new Error("دانلود ویدیوهای مستند زنده برای کش محلی ناموفق بود.");
  }

  const tmpDir = path.join(os.tmpdir(), `live_vid_${params.shotNumber}_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 3. Extract 4-6 probe frames from local SSD cache (fast, zero network!)
    const validProbes: Array<{
      candidate: LiveVideoCandidate;
      localVideoPath: string;
      seekSec: number;
      framePath: string;
    }> = [];

    for (const item of cachedReady) {
      const seeks = pickCandidateSeekTimestamps(
        item.candidate.durationSec,
        durSec,
        params.shotNumber,
        usedSegmentKeys,
        item.candidate.id
      );
      const maxPerVid = cachedReady.length === 1 ? 4 : 3;
      for (const s of seeks.slice(0, maxPerVid)) {
        const framePath = path.join(tmpDir, `probe_${validProbes.length}_${item.candidate.id}_${Math.round(s)}.jpg`);
        const ok = await probeLocalVideoFrame(item.localVideoPath, s, framePath);
        if (ok) {
          validProbes.push({
            candidate: item.candidate,
            localVideoPath: item.localVideoPath,
            seekSec: s,
            framePath,
          });
        }
      }
    }

    if (validProbes.length === 0) {
      throw new Error("استخراج فریم نمونه از ویدیوهای کش‌شده ناموفق بود.");
    }

    // 4. Gemini Multimodal Vision Critic visually inspects all live frames & picks the best live-action moment!
    let picked = await selectBestLiveSegmentWithVisionCritic({
      probes: validProbes,
      shotPrompt: params.prompt,
    });

    // Quality Gate: if Vision Critic scores the first batch < 8.5, automatically cache & probe remaining candidates!
    if (picked.score !== null && picked.score < 8.5 && rankedCandidates.length > cachedReady.length) {
      const alreadyIds = new Set(cachedReady.map((x) => x.candidate.id));
      const extraProbes: typeof validProbes = [];
      for (const cand of rankedCandidates) {
        if (alreadyIds.has(cand.id)) continue;
        const localPath = await ensureCachedLocalVideo(cand);
        if (!localPath) continue;
        const seeks = pickCandidateSeekTimestamps(
          cand.durationSec,
          durSec,
          params.shotNumber + 2,
          usedSegmentKeys,
          cand.id
        );
        for (const s of seeks.slice(0, 3)) {
          const framePath = path.join(
            tmpDir,
            `probe_extra_${extraProbes.length}_${cand.id}_${Math.round(s)}.jpg`
          );
          const ok = await probeLocalVideoFrame(localPath, s, framePath);
          if (ok) {
            extraProbes.push({
              candidate: cand,
              localVideoPath: localPath,
              seekSec: s,
              framePath,
            });
          }
        }
        if (extraProbes.length >= 4) break;
      }
      if (extraProbes.length > 0) {
        const bestInitial = validProbes[picked.bestIdx] || validProbes[0];
        const combined = [bestInitial, ...extraProbes];
        const picked2 = await selectBestLiveSegmentWithVisionCritic({
          probes: combined,
          shotPrompt: params.prompt,
        });
        if (picked2.score === null || picked2.score >= picked.score) {
          validProbes.length = 0;
          validProbes.push(...combined);
          picked = picked2;
        }
      }
    }

    const winner = validProbes[picked.bestIdx] || validProbes[0];

    usedSegmentKeys.add(`${winner.candidate.id}@${Math.floor(winner.seekSec / 10)}`);

    // 5. Cut exact 100% REAL LIVE-ACTION HD segment locally off SSD + apply ARRI Teal-and-Amber grade + 48kHz stereo foley!
    fs.mkdirSync(path.dirname(params.outputPath), { recursive: true });
    const gradeChain = buildCinemaGradeFilterForLiveVideo(mood);
    const overscanW = Math.round(params.width * 1.12);
    const overscanH = Math.round(params.height * 1.12);
    const vf = [
      "yadif=mode=0:parity=-1:deint=1",
      `scale=${overscanW}:${overscanH}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${params.width}:${params.height}:(iw-${params.width})/2:(ih-${params.height})/2`,
      `fps=${fps}`,
      "unsharp=3:3:0.35:3:3:0.0",
      gradeChain,
      "noise=alls=4:allf=t+u",
      "format=yuv420p",
      "setsar=1",
    ].join(",");

    const foleyAudioFilter = buildPhotorealisticFoleyAudioFilter(fxProfile, durSec);

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        winner.seekSec.toFixed(2),
        "-t",
        (durSec + 0.35).toFixed(2),
        "-i",
        winner.localVideoPath,
        "-filter_complex",
        `[0:v]${vf}[vout];${foleyAudioFilter}`,
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "17",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-t",
        durSec.toFixed(2),
        "-movflags",
        "+faststart",
        params.outputPath,
      ],
      { timeout: 45_000 }
    );

    if (!fs.existsSync(params.outputPath) || fs.statSync(params.outputPath).size < 20_000) {
      throw new Error("خروجی ویدیوی مستند زنده خالی یا ناقص بود.");
    }

    return {
      outputPath: params.outputPath,
      sourceTitle: winner.candidate.title,
      sourceUrl: winner.candidate.videoUrl,
      pageUrl: winner.candidate.pageUrl,
      sourceStartSec: winner.seekSec,
      durationSec: durSec,
      visionMatchScore: picked.score,
      visionMatchReason: picked.reason,
      mood,
      fxProfile,
      width: params.width,
      height: params.height,
      fps,
      hasRealMotion: true,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
