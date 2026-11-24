import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { KineticSubtitleStylePreset } from "../../src/types/videoPipeline.js";

const execFileAsync = promisify(execFile);

export interface CaptionShotInput {
  shotNumber: number;
  durationSec: number;
  narrationText: string;
  onScreenText?: string;
}

export interface TimedCaptionSegment {
  shotNumber: number;
  startSec: number;
  endSec: number;
  text: string;
  words: Array<{ word: string; durationCs: number }>;
  isCallout?: boolean;
}

export interface AudioSyncPlan {
  narrationDurationSec: number;
  videoDurationSec: number;
  recommendedAtempo: number;
  effectiveCaptionSpanSec: number;
  speechSegments: Array<{ startSec: number; endSec: number }>;
}

export function getBundledFontsDir(): string {
  return path.resolve(process.cwd(), "assets", "fonts");
}

export function verifyBundledPersianFonts(): {
  available: boolean;
  fontsDir: string;
  files: string[];
} {
  const fontsDir = getBundledFontsDir();
  const expected = [
    "Vazirmatn-Bold.ttf",
    "Vazirmatn-ExtraBold.ttf",
    "Vazirmatn-Black.ttf",
    "Lalezar-Regular.ttf",
  ];
  const files = expected.filter((f) => fs.existsSync(path.join(fontsDir, f)));
  return {
    available: files.length >= 2,
    fontsDir,
    files,
  };
}

/**
 * Formats seconds into ASS timestamp `H:MM:SS.cc` (centiseconds).
 */
export function formatAssTime(sec: number): string {
  const safe = Math.max(0, sec);
  const totalCs = Math.round(safe * 100);
  const hrs = Math.floor(totalCs / 360_000);
  const mins = Math.floor((totalCs % 360_000) / 6_000);
  const secs = Math.floor((totalCs % 6_000) / 100);
  const cs = totalCs % 100;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${hrs}:${p2(mins)}:${p2(secs)}.${p2(cs)}`;
}

/**
 * Splits Persian narration cleanly into short, punchy 3-5 word kinetic Reel caption phrases.
 */
export function splitKineticPersianChunks(
  text: string,
  maxWords = 4,
  maxChars = 28
): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const words = cleaned.split(" ").filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    const candidate = [...current, word].join(" ");
    const prevEndsSentence =
      current.length >= 2 && /[،,.؟!؛:]$/.test(current[current.length - 1]);
    if (
      current.length > 0 &&
      (current.length >= maxWords || candidate.length > maxChars || prevEndsSentence)
    ) {
      chunks.push(current.join(" "));
      current = [word];
    } else {
      current.push(word);
    }
  }

  if (current.length > 0) {
    if (
      current.length === 1 &&
      chunks.length > 0 &&
      chunks[chunks.length - 1].length + current[0].length <= maxChars + 6
    ) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${current[0]}`;
    } else {
      chunks.push(current.join(" "));
    }
  }
  return chunks;
}

/**
 * Computes how narration audio should align with total video length so speech is never abruptly truncated
 * and kinetic captions stay synchronized with spoken words.
 * Pure function — unit-tested directly.
 */
export function computeAudioSyncPlan(params: {
  narrationDurationSec: number;
  videoDurationSec: number;
  speechSegments?: Array<{ startSec: number; endSec: number }>;
}): AudioSyncPlan {
  const videoDur = Math.max(1, params.videoDurationSec);
  const narDur = Math.max(0, params.narrationDurationSec);

  if (narDur <= 0.1) {
    return {
      narrationDurationSec: 0,
      videoDurationSec: videoDur,
      recommendedAtempo: 1.0,
      effectiveCaptionSpanSec: videoDur,
      speechSegments: [],
    };
  }

  // If narration is longer than video, gently speed up narration up to 1.24x so it fits naturally inside the reel
  // (never clipping off the last 20 seconds of voiceover!).
  let atempo = 1.0;
  if (narDur > videoDur * 1.02) {
    atempo = Math.min(1.24, Math.max(1.0, narDur / (videoDur * 0.96)));
  }

  const adjustedNarDur = narDur / atempo;
  const effectiveCaptionSpanSec = Math.min(videoDur, Math.max(1.5, adjustedNarDur));

  const scaledSegments = (params.speechSegments || [])
    .map((seg) => ({
      startSec: Math.max(0, seg.startSec / atempo),
      endSec: Math.min(effectiveCaptionSpanSec, seg.endSec / atempo),
    }))
    .filter((s) => s.endSec - s.startSec >= 0.15);

  return {
    narrationDurationSec: narDur,
    videoDurationSec: videoDur,
    recommendedAtempo: Math.round(atempo * 1000) / 1000,
    effectiveCaptionSpanSec: Math.round(effectiveCaptionSpanSec * 100) / 100,
    speechSegments: scaledSegments,
  };
}

/**
 * Detects real non-silent speech intervals in a narration WAV using FFmpeg silencedetect.
 */
export async function analyzeNarrationAudioSync(
  narrationWavPath: string | null | undefined,
  videoDurationSec: number
): Promise<AudioSyncPlan> {
  if (!narrationWavPath || !fs.existsSync(narrationWavPath)) {
    return computeAudioSyncPlan({ narrationDurationSec: 0, videoDurationSec });
  }

  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      narrationWavPath,
    ]);
    const narDur = Number(stdout.trim()) || 0;

    let speechSegments: Array<{ startSec: number; endSec: number }> = [];
    try {
      const { stderr } = await execFileAsync("ffmpeg", [
        "-i",
        narrationWavPath,
        "-af",
        "silencedetect=noise=-34dB:d=0.22",
        "-f",
        "null",
        "-",
      ]);

      const silences: Array<{ start: number; end: number }> = [];
      let pendingStart: number | null = null;
      for (const line of stderr.split("\n")) {
        const sMatch = line.match(/silence_start:\s*([0-9.]+)/);
        if (sMatch) {
          pendingStart = Number(sMatch[1]);
        }
        const eMatch = line.match(/silence_end:\s*([0-9.]+)/);
        if (eMatch && pendingStart !== null) {
          silences.push({ start: pendingStart, end: Number(eMatch[1]) });
          pendingStart = null;
        }
      }

      // Invert silence intervals into active speech windows
      let cursor = 0;
      for (const sil of silences) {
        if (sil.start - cursor >= 0.18) {
          speechSegments.push({ startSec: cursor, endSec: sil.start });
        }
        cursor = Math.max(cursor, sil.end);
      }
      if (narDur - cursor >= 0.18) {
        speechSegments.push({ startSec: cursor, endSec: narDur });
      }
    } catch {
      speechSegments = [];
    }

    return computeAudioSyncPlan({
      narrationDurationSec: narDur,
      videoDurationSec,
      speechSegments,
    });
  } catch {
    return computeAudioSyncPlan({ narrationDurationSec: 0, videoDurationSec });
  }
}

/**
 * Aligns all caption phrases proportionally to the actual speech window (`effectiveCaptionSpanSec`)
 * so text timing tracks spoken narration instead of drifting on fixed shot durations.
 */
export function buildAudioSyncedCaptionTimeline(params: {
  shots: CaptionShotInput[];
  syncPlan: AudioSyncPlan;
}): TimedCaptionSegment[] {
  const allPhraseEntries: Array<{
    shotNumber: number;
    text: string;
    charWeight: number;
  }> = [];

  for (const shot of params.shots) {
    const chunks = splitKineticPersianChunks(shot.narrationText || "", 4, 28);
    for (const chunk of chunks) {
      allPhraseEntries.push({
        shotNumber: shot.shotNumber,
        text: chunk,
        charWeight: Math.max(5, chunk.replace(/\s+/g, "").length),
      });
    }
  }

  if (allPhraseEntries.length === 0) return [];

  const totalWeight = allPhraseEntries.reduce((sum, p) => sum + p.charWeight, 0) || 1;
  const startLead =
    params.syncPlan.speechSegments.length > 0
      ? Math.min(0.6, params.syncPlan.speechSegments[0].startSec)
      : 0.15;
  const endLimit = Math.max(startLead + 1, params.syncPlan.effectiveCaptionSpanSec - 0.15);
  const usableSpan = Math.max(1, endLimit - startLead);

  const segments: TimedCaptionSegment[] = [];
  let cursor = startLead;

  for (let i = 0; i < allPhraseEntries.length; i++) {
    const entry = allPhraseEntries[i];
    const segDur =
      i === allPhraseEntries.length - 1
        ? Math.max(0.45, endLimit - cursor)
        : Math.max(0.45, (usableSpan * entry.charWeight) / totalWeight);
    const startSec = cursor;
    const endSec = Math.min(endLimit, cursor + segDur);
    cursor = endSec;

    const rawWords = entry.text.split(/\s+/).filter(Boolean);
    const wordWeightSum = rawWords.reduce((s, w) => s + Math.max(2, w.length), 0) || 1;
    const segCs = Math.max(20, Math.round((endSec - startSec) * 100));
    const words = rawWords.map((w) => ({
      word: w,
      durationCs: Math.max(8, Math.round((segCs * Math.max(2, w.length)) / wordWeightSum)),
    }));

    segments.push({
      shotNumber: entry.shotNumber,
      startSec: Math.round(startSec * 100) / 100,
      endSec: Math.round(endSec * 100) / 100,
      text: entry.text,
      words,
    });
  }

  return segments;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, " ");
}

/**
 * Generates an Advanced SubStation Alpha (.ass) subtitle file featuring:
 * - Real bundled Persian Display Fonts (`Vazirmatn` ExtraBold / `Lalezar`)
 * - Smooth spring pop-in animation (`\fscx86\fscy86\t(0,115,\fscx103\fscy103)\t(115,190,\fscx100\fscy100)`)
 * - Active-word karaoke color highlight (`\kf`) synced to spoken audio timing
 * - Subtle top kinetic headline callouts from Director's `onScreenText`
 */
export function generateKineticAssSubtitles(params: {
  shots: CaptionShotInput[];
  syncPlan: AudioSyncPlan;
  width: number;
  height: number;
  stylePreset?: KineticSubtitleStylePreset;
  includeShotTitles?: boolean;
}): { assContent: string; cueCount: number } {
  const preset: KineticSubtitleStylePreset = params.stylePreset || "industrial_steel_blue";
  const segments = buildAudioSyncedCaptionTimeline({
    shots: params.shots,
    syncPlan: params.syncPlan,
  });

  // ASS colors are &HAABBGGRR (Alpha-Blue-Green-Red!)
  const paletteByPreset: Record<
    KineticSubtitleStylePreset,
    {
      fontName: string;
      titleFont: string;
      primaryColor: string;     // Active/highlighted karaoke text
      secondaryColor: string;   // Pre-highlight text
      outlineColor: string;
      backColor: string;
      accentTagHex: string;
      fontSize: number;
    }
  > = {
    cinema_gold: {
      fontName: "Vazirmatn",
      titleFont: "Lalezar",
      primaryColor: "&H0024BFFA",   // Warm Cinema Gold (#FABF24)
      secondaryColor: "&H00FFFFFF", // Crisp White
      outlineColor: "&H000D0B08",   // Deep Espresso Black outline
      backColor: "&H96000000",      // Rich drop shadow
      accentTagHex: "&H0024BFFA&",
      fontSize: Math.round(params.height * 0.041),
    },
    industrial_steel_blue: {
      fontName: "Vazirmatn",
      titleFont: "Lalezar",
      primaryColor: "&H00FFF066",   // Crisp Electric Ice Blue (#66F0FF)
      secondaryColor: "&H00FFFFFF", // Pure Metallic White
      outlineColor: "&H00120B06",   // Deep Navy Charcoal outline
      backColor: "&H96040810",      // Rich drop shadow
      accentTagHex: "&H00FFF066&",
      fontSize: Math.round(params.height * 0.041),
    },
    viral_karaoke: {
      fontName: "Lalezar",
      titleFont: "Lalezar",
      primaryColor: "&H0010D4FF",   // High-impact Amber-Gold
      secondaryColor: "&H00F8FAFC", // Bright White
      outlineColor: "&H0008080A",
      backColor: "&HAA000000",
      accentTagHex: "&H0010D4FF&",
      fontSize: Math.round(params.height * 0.045),
    },
  };

  const p = paletteByPreset[preset];
  const marginV = Math.round(params.height * 0.145);
  const titleMarginV = Math.round(params.height * 0.11);
  const marginLR = Math.round(params.width * 0.075);

  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${params.width}`,
    `PlayResY: ${params.height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: KineticCaption,${p.fontName},${p.fontSize},${p.primaryColor},${p.secondaryColor},${p.outlineColor},${p.backColor},-1,0,0,0,100,100,0,0,1,5.5,3.2,2,${marginLR},${marginLR},${marginV},178`,
    `Style: ShotHeadline,${p.titleFont},${Math.round(p.fontSize * 0.92)},&H00FFFFFF,${p.primaryColor},${p.outlineColor},&H70080C14,-1,0,0,0,100,100,0,0,1,4.0,2.5,8,${marginLR},${marginLR},${titleMarginV},178`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  // 1. Audio-synced Kinetic Karaoke Captions (Layer 2)
  // Uses discrete word-snap (\k) + Unicode RLE/PDF so Persian RTL words highlight cleanly right-to-left without backwards mid-word clipping
  for (const seg of segments) {
    const startStr = formatAssTime(seg.startSec);
    const endStr = formatAssTime(seg.endSec);
    // Smooth spring pop-in + crisp fade-out + word-snap highlight synced to voiceover timing
    const popAnim =
      "{\\an2\\fad(75,70)\\fscx86\\fscy86\\t(0,115,\\fscx104\\fscy104)\\t(115,195,\\fscx100\\fscy100)}";
    const karaokeBody =
      "\u202B" +
      seg.words
        .map((w) => `{\\k${w.durationCs}}${escapeAssText(w.word)}`)
        .join(" ") +
      "\u202C";
    lines.push(
      `Dialogue: 2,${startStr},${endStr},KineticCaption,,0,0,0,,${popAnim}${karaokeBody}`
    );
  }

  // 2. Optional Top Kinetic Typography Callout for Shot Titles (Layer 1)
  if (params.includeShotTitles !== false) {
    let shotCursor = 0;
    const totalShotDur = params.shots.reduce((s, sh) => s + Math.max(1, sh.durationSec), 0) || 1;
    const scaleRatio = params.syncPlan.videoDurationSec / totalShotDur;
    for (const sh of params.shots) {
      const dur = Math.max(1, sh.durationSec) * scaleRatio;
      const title = (sh.onScreenText || "").trim();
      if (title && title.length <= 42) {
        const showStart = shotCursor + 0.18;
        const showEnd = Math.min(shotCursor + Math.min(dur - 0.25, 2.8), params.syncPlan.videoDurationSec - 0.1);
        if (showEnd - showStart >= 0.6) {
          const anim =
            `{\\an8\\fad(160,220)\\fscx92\\fscy92\\t(0,180,\\fscx100\\fscy100)\\blur0.4}`;
          lines.push(
            `Dialogue: 1,${formatAssTime(showStart)},${formatAssTime(showEnd)},ShotHeadline,,0,0,0,,${anim}${escapeAssText(title)}`
          );
        }
      }
      shotCursor += dur;
    }
  }

  return {
    assContent: lines.join("\n") + "\n",
    cueCount: segments.length,
  };
}
