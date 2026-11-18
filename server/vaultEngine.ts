import type {
  AgentMemoryEntry,
  CompetitorViralReport,
  PageProfile,
  ProjectRecord,
  VaultFolderId,
  VaultGraphEdge,
  VaultGraphNode,
  VaultNote,
  VaultSnapshot,
} from "../src/types/studio.js";

/**
 * Extracts Obsidian-style [[Target]] or [[Target|Alias]] wikilinks from Markdown content.
 */
export function parseWikilinks(markdown: string): string[] {
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const target = match[1]?.trim();
    if (target) found.add(target);
  }
  return Array.from(found);
}

export function slugifyVaultTitle(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|[\]]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 90);
}

export function buildPageVaultNote(page: PageProfile): VaultNote {
  const title = `پیج — ${page.name}`;
  const md = `---
type: page_profile
platform: ${page.platform}
handle: "${page.handle}"
maturity: ${page.pageMaturity}
updated: ${page.updatedAt}
---

# ${title}

- **شناسه پیج:** ${page.handle}
- **پلتفرم اصلی:** ${page.platform} (${page.defaultFormat})
- **حوزه تخصصی (Niche):** ${page.niche}
- **سبک محتوا:** ${page.contentStyle}
- **لحن برند:** ${page.brandToneNoteFa}

## پرسونای مخاطب هدف
${page.targetAudiencePersona}

### دغدغه‌ها و دردهای اصلی مخاطب
${page.audiencePainPoints.map((p) => `- ${p}`).join("\n")}

## خطوط قرمز و گاردریل الگوریتم
${page.tabooRedLines.map((r) => `- خط قرمز: ${r}`).join("\n")}
${page.algorithmGuardrails.map((g) => `- قانون الگوریتم: ${g}`).join("\n")}

## پروفایل کلون صدا و گویندگی
- **گوینده مرجع:** ${page.voiceProfile.speakerName} (${page.voiceProfile.voicePersona})
- **سبک بیان و حس:** ${page.voiceProfile.prosodyStyle}
- **موتور کلون صدا:** ${page.voiceProfile.cloneEnginePreference}

## پیوندهای مغز دوم
- [[حافظه ایجنت سناریونویس]]
- [[حافظه ایجنت کارگردان]]
`;

  return {
    id: `page_${page.id}`,
    slug: slugifyVaultTitle(title),
    folder: "01_Pages",
    title,
    tags: [page.platform, "پروفایل_پیج", page.pageMaturity === "new_page" ? "پیج_جدید" : "پیج_فعال"],
    wikilinks: parseWikilinks(md),
    backlinks: [],
    contentMd: md,
    updatedAt: page.updatedAt,
  };
}

export function buildViralReportVaultNote(
  report: CompetitorViralReport,
  linkedPage?: PageProfile | null
): VaultNote {
  const title = `رادار وایرال — ${report.nicheQuery}`;
  const pageLink = linkedPage ? `- **پیج مرتبط:** [[پیج — ${linkedPage.name}]]\n` : "";

  const md = `---
type: competitor_viral_report
platform: ${report.platform}
analyzedAt: ${report.analyzedAt}
---

# ${title}

${pageLink}- **روش تحقیق امن (ضد بن):** ${report.safeResearchMethodNote}

## خلاصه اجرایی استراتژی و الگوریتم
${report.executiveSummary}

## الگوهای برتر وایرال هفته (بررسی مستند)
${report.weeklyTopViralPatterns
  .map(
    (p) => `### ${p.rank}. ${p.patternTitle}
- **ساختار قلاب ۳ ثانیه اول:** ${p.hookStructureFa}
- **مکانیزم نگهداشت مخاطب (Retention):** ${p.retentionMechanismFa}
- **ریتم بصری و تدوین:** ${p.visualRhythmNote}
- **دلیل وایرال شدن:** ${p.whyItWentViral}`
  )
  .join("\n\n")}

## کالبدشکافی رقبا و شکاف بازار
${report.competitors
  .map(
    (c) => `- **${c.nameOrHandle}** (${c.platform}): نقطه قوت: ${c.coreStrength} | فرمول قلاب: ${c.winningHookFormula} | فرصت تمایز ما: ${c.weaknessOrGapForUs}`
  )
  .join("\n")}

## قوانین الگوریتم و پرهیز از شدوبن
${report.algorithmRulesAndRedLines.map((r) => `- ${r}`).join("\n")}

## پیوند به حافظه ایجنت‌ها
- [[حافظه ایجنت سناریونویس]]
- [[حافظه ایجنت کارگردان]]
`;

  return {
    id: `viral_${report.id}`,
    slug: slugifyVaultTitle(title),
    folder: "02_Viral_Lab",
    title,
    tags: ["رادار_رقبا", "الگوی_وایرال", report.platform],
    wikilinks: parseWikilinks(md),
    backlinks: [],
    contentMd: md,
    updatedAt: report.analyzedAt,
  };
}

export function buildAgentMemoryVaultNotes(
  memories: AgentMemoryEntry[],
  pages: PageProfile[]
): VaultNote[] {
  const pageMap = new Map(pages.map((p) => [p.id, p.name]));

  const buildForRole = (
    role: "scriptwriter_agent" | "director_agent",
    title: string,
    roleDesc: string
  ): VaultNote => {
    const list = memories
      .filter((m) => m.agentId === role)
      .sort((a, b) => b.strength - a.strength);

    const md = `---
type: agent_constitutional_memory
agent: ${role}
rules_count: ${list.length}
---

# ${title}

> ${roleDesc}

## قوانین خودآموخته، اصلاح خطاها و الگوهای تثبیت‌شده
${
  list.length === 0
    ? "- هنوز قانونی ثبت نشده است."
    : list
        .map((m, i) => {
          const pageTitle = m.pageProfileId ? pageMap.get(m.pageProfileId) : null;
          const pageRef = pageTitle ? ` — پیوند: [[پیج — ${pageTitle}]]` : " — دامنه: سراسری";
          return `${i + 1}. **ضریب ${m.strength}/10** (${m.category}): ${m.ruleText}${pageRef}\n   - منشأ یادگیری: ${m.sourceEvent}`;
        })
        .join("\n")
}
`;

    const latest = list[0]?.updatedAt || new Date().toISOString();
    return {
      id: `mem_doc_${role}`,
      slug: slugifyVaultTitle(title),
      folder: "03_Agent_Memory",
      title,
      tags: ["حافظه_تکاملی", role === "scriptwriter_agent" ? "سناریونویس" : "کارگردان"],
      wikilinks: parseWikilinks(md),
      backlinks: [],
      contentMd: md,
      updatedAt: latest,
    };
  };

  return [
    buildForRole(
      "scriptwriter_agent",
      "حافظه ایجنت سناریونویس",
      "مغز تکاملی ایجنت ۱ (پژوهشگر، تحلیلگر رقبا، استراتژیست، روانشناس مخاطب و نویسنده متن گویندگی اعراب‌گذاری‌شده)."
    ),
    buildForRole(
      "director_agent",
      "حافظه ایجنت کارگردان",
      "مغز تکاملی ایجنت ۲ (دکوپاژ ۳ تا ۸ ثانیه، استوری‌بورد ۲ فریمی، کلون صدا و اتوماسیون DaVinci Resolve)."
    ),
  ];
}

export function buildProjectVaultNote(
  project: ProjectRecord,
  linkedPage?: PageProfile | null
): VaultNote {
  const title = `پروژه — ${project.brief.title}`;
  const pageLink = linkedPage ? `- **پیج هدف:** [[پیج — ${linkedPage.name}]]\n` : "";
  const narrationBlock = project.narration
    ? `## ۲. متن گویندگی اعراب‌گذاری‌شده\n${project.narration.vocalizedNarrationText}\n\n- **راهنمای ریتم و حس:** ${project.narration.rhythmAndPauseNotes}`
    : project.voiceover
      ? `## ۲. متن گویندگی\n${project.voiceover.vocalizedText || project.voiceover.narrationText}`
      : "";

  const shotsBlock = project.director?.shots?.length
    ? `## ۳. شات‌بندی ۳ تا ۸ ثانیه‌ای و تایید ویدیوها (${project.director.shots.length} شات)\n` +
      project.director.shots
        .map((s) => {
          const clip = project.shotClips?.find((c) => c.shotNumber === s.shotNumber);
          const statusFa =
            clip?.approvalStatus === "approved" ? "تاییدشده ✓" : "در انتظار ساخت/تایید";
          return `- **شات ${s.shotNumber} (${s.timecode} · ${s.durationSeconds}s · ${statusFa}):** ${s.cameraAngle} | گفتار: «${s.spokenSegment}» | افکت صوتی: ${s.sfxCueFa || "-"}`;
        })
        .join("\n")
    : "";

  const md = `---
type: content_project
stage: ${project.currentStage}
platform: ${project.brief.platform}
updated: ${project.updatedAt}
---

# ${title}

${pageLink}- **ایده اولیه:** ${project.brief.idea}
- **مرحله فعلی پایپ‌لاین:** ${project.currentStage}
- **ایجنت‌های درگیر:** [[حافظه ایجنت سناریونویس]] · [[حافظه ایجنت کارگردان]]

${
  project.researchScript
    ? `## ۱. سناریوی کامل تاییدشده (${project.researchScript.videoTitle})
### قلاب ۳ ثانیه اول
${project.researchScript.hook}

### بدنه اصلی سناریو
${project.researchScript.body}

### دعوت به اقدام (CTA)
${project.researchScript.cta}`
    : "_در انتظار نگارش سناریو_"
}

${narrationBlock}

${shotsBlock}
`;

  return {
    id: `proj_${project.id}`,
    slug: slugifyVaultTitle(title),
    folder: "04_Projects",
    title,
    tags: ["پروژه_تولید", project.brief.platform, project.currentStage],
    wikilinks: parseWikilinks(md),
    backlinks: [],
    contentMd: md,
    updatedAt: project.updatedAt,
  };
}

/**
 * Builds the complete Obsidian Second Brain snapshot including bidirectional backlinks,
 * graph nodes, and edges from all Markdown notes.
 */
export function buildVaultSnapshot(params: {
  pages: PageProfile[];
  viralReports: CompetitorViralReport[];
  memories: AgentMemoryEntry[];
  projects: ProjectRecord[];
  customNotes?: VaultNote[];
}): VaultSnapshot {
  const pageById = new Map(params.pages.map((p) => [p.id, p]));

  const rawNotes: VaultNote[] = [
    ...params.pages.map((p) => buildPageVaultNote(p)),
    ...params.viralReports.map((r) =>
      buildViralReportVaultNote(r, r.pageProfileId ? pageById.get(r.pageProfileId) : null)
    ),
    ...buildAgentMemoryVaultNotes(params.memories, params.pages),
    ...params.projects.map((proj) =>
      buildProjectVaultNote(
        proj,
        proj.brief.pageProfileId ? pageById.get(proj.brief.pageProfileId) : null
      )
    ),
    ...(params.customNotes ?? []),
  ];

  const titleToId = new Map<string, string>();
  for (const note of rawNotes) {
    titleToId.set(note.title.trim(), note.id);
    titleToId.set(note.slug.trim(), note.id);
  }

  const edgeSet = new Set<string>();
  const edges: VaultGraphEdge[] = [];
  const backlinksMap = new Map<string, Set<string>>();
  const degreeMap = new Map<string, number>();

  for (const note of rawNotes) {
    degreeMap.set(note.id, 0);
    backlinksMap.set(note.id, new Set<string>());
  }

  for (const note of rawNotes) {
    for (const targetTitle of note.wikilinks) {
      const targetId = titleToId.get(targetTitle.trim());
      if (!targetId || targetId === note.id) continue;
      const key =
        note.id < targetId ? `${note.id}::${targetId}` : `${targetId}::${note.id}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: note.id, target: targetId });
        degreeMap.set(note.id, (degreeMap.get(note.id) ?? 0) + 1);
        degreeMap.set(targetId, (degreeMap.get(targetId) ?? 0) + 1);
      }
      backlinksMap.get(targetId)?.add(note.title);
    }
  }

  const notesWithBacklinks: VaultNote[] = rawNotes.map((n) => ({
    ...n,
    backlinks: Array.from(backlinksMap.get(n.id) ?? []),
  }));

  const nodes: VaultGraphNode[] = notesWithBacklinks.map((n) => ({
    id: n.id,
    label: n.title,
    folder: n.folder as VaultFolderId,
    degree: degreeMap.get(n.id) ?? 0,
  }));

  return {
    notes: notesWithBacklinks,
    nodes,
    edges,
    lastSyncedAt: new Date().toISOString(),
  };
}
