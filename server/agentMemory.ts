import type {
  AgentMemoryEntry,
  AgentSuperRole,
  DirectorShot,
  MemoryCategory,
  MemoryScope,
  ShotVideoClipRecord,
} from "../src/types/studio.js";

/**
 * Clamps every shot strictly between 3 and 8 seconds (per studio decoupage rule)
 * and recalculates contiguous MM:SS - MM:SS timecodes.
 */
export function normalizeDirectorShots3To8s(shots: DirectorShot[]): {
  shots: DirectorShot[];
  totalEstimatedSeconds: number;
} {
  let cursor = 0;
  const normalized = shots.map((shot, idx) => {
    const rawDur = Number(shot.durationSeconds);
    const durationSeconds = Number.isFinite(rawDur)
      ? Math.min(8, Math.max(3, Math.round(rawDur)))
      : 5;
    const startSec = cursor;
    const endSec = cursor + durationSeconds;
    cursor = endSec;

    return {
      ...shot,
      shotNumber: idx + 1,
      durationSeconds,
      timecode: `${formatMmSs(startSec)} - ${formatMmSs(endSec)}`,
      transitionToNext: shot.transitionToNext || (idx === 0 ? "whip_pan" : "cut"),
      sfxCueFa:
        shot.sfxCueFa ||
        (idx === 0
          ? "افکت ضربه شروع (Whoosh + Sub Drop)"
          : "افکت انتقال نرم و تاکید متنی (Soft Pop)"),
    };
  });

  return {
    shots: normalized,
    totalEstimatedSeconds: cursor,
  };
}

export function formatMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Computes sequential shot-by-shot approval progress:
 * Returns which shot is currently unlocked for rendering/approval, and whether all shots are approved.
 */
export function evaluateShotApprovalProgress(
  totalShots: number,
  clips: ShotVideoClipRecord[]
): {
  approvedCount: number;
  totalShots: number;
  allApproved: boolean;
  activeUnlockShotNumber: number;
} {
  if (totalShots <= 0) {
    return {
      approvedCount: 0,
      totalShots: 0,
      allApproved: false,
      activeUnlockShotNumber: 1,
    };
  }

  let approvedCount = 0;
  let firstUnapproved: number | null = null;

  for (let i = 1; i <= totalShots; i++) {
    const rec = clips.find((c) => c.shotNumber === i);
    if (rec?.approvalStatus === "approved" && rec.videoUrl) {
      approvedCount += 1;
    } else if (firstUnapproved === null) {
      firstUnapproved = i;
    }
  }

  return {
    approvedCount,
    totalShots,
    allApproved: approvedCount === totalShots,
    activeUnlockShotNumber: firstUnapproved ?? totalShots,
  };
}

/**
 * Self-learning / Repair extractor:
 * Converts human feedback, regeneration instructions, or approved viral insights into a persistent,
 * deduplicated constitutional memory rule for Agent 1 or Agent 2.
 */
export function upsertLearnedMemory(
  existing: AgentMemoryEntry[],
  input: {
    agentId: AgentSuperRole;
    scope: MemoryScope;
    category: MemoryCategory;
    ruleText: string;
    sourceEvent: string;
    pageProfileId?: string | null;
    projectId?: string | null;
    initialStrength?: number;
  }
): AgentMemoryEntry[] {
  const cleanRule = input.ruleText.trim().replace(/\s+/g, " ");
  if (cleanRule.length < 6) return existing;

  const now = new Date().toISOString();
  const normalizedTarget = cleanRule.toLowerCase();

  const matchIdx = existing.findIndex(
    (m) =>
      m.agentId === input.agentId &&
      m.scope === input.scope &&
      (m.pageProfileId || null) === (input.pageProfileId || null) &&
      m.ruleText.trim().toLowerCase() === normalizedTarget
  );

  if (matchIdx >= 0) {
    const current = existing[matchIdx];
    const reinforced: AgentMemoryEntry = {
      ...current,
      strength: Math.min(10, current.strength + 1),
      appliedCount: current.appliedCount + 1,
      sourceEvent: input.sourceEvent || current.sourceEvent,
      updatedAt: now,
    };
    return existing.map((item, idx) => (idx === matchIdx ? reinforced : item));
  }

  const created: AgentMemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    agentId: input.agentId,
    scope: input.scope,
    pageProfileId: input.pageProfileId ?? null,
    projectId: input.projectId ?? null,
    category: input.category,
    ruleText: cleanRule,
    sourceEvent: input.sourceEvent,
    strength: Math.min(10, Math.max(1, input.initialStrength ?? 6)),
    appliedCount: 1,
    createdAt: now,
    updatedAt: now,
  };

  return [created, ...existing];
}

/**
 * Compiles all active Global + Page-Specific + Project-Specific learned memories
 * into an authoritative prompt block injected into Agent 1 or Agent 2.
 */
export function compileAgentMemoryPromptBlock(params: {
  memories: AgentMemoryEntry[];
  agentId: AgentSuperRole;
  pageProfileId?: string | null;
  projectId?: string | null;
  maxRules?: number;
}): string {
  const limit = params.maxRules ?? 8;
  const relevant = params.memories
    .filter((m) => {
      if (m.agentId !== params.agentId) return false;
      if (m.scope === "global") return true;
      if (m.scope === "page" && params.pageProfileId && m.pageProfileId === params.pageProfileId) {
        return true;
      }
      if (m.scope === "project" && params.projectId && m.projectId === params.projectId) {
        return true;
      }
      return false;
    })
    .sort((a, b) => b.strength - a.strength || b.appliedCount - a.appliedCount)
    .slice(0, limit);

  if (relevant.length === 0) return "";

  const categoryLabels: Record<MemoryCategory, string> = {
    learned_rule: "قانون آموخته‌شده",
    mistake_repaired: "خطای اصلاح‌شده (تکرار ممنوع)",
    viral_pattern: "الگوی وایرال اثبات‌شده",
    voice_and_edit_rule: "استاندارد لحن و تدوین",
  };

  const lines = relevant.map(
    (m, i) =>
      `${i + 1}. [${categoryLabels[m.category]} · ضریب اهمیت ${m.strength}/10]: ${m.ruleText}`
  );

  return `\nحافظه تکاملی و قوانین تجربه‌شده این ایجنت (رعایت اجباری — حاصل یادگیری از بازخوردهای قبلی و تحلیل رقبا):\n${lines.join("\n")}\n`;
}
