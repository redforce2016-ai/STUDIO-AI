import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  Check,
  FileText,
  FolderTree,
  Network,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type {
  AgentMemoryEntry,
  AgentSuperRole,
  PageProfile,
  VaultFolderId,
  VaultNote,
  VaultSnapshot,
} from "../types/studio";

interface VaultSecondBrainViewProps {
  pages: PageProfile[];
}

const FOLDER_META: Record<VaultFolderId, { label: string; color: string }> = {
  "01_Pages": { label: "۰۱ · پروفایل پیج‌ها", color: "#F59E0B" },
  "02_Viral_Lab": { label: "۰۲ · آزمایشگاه وایرال و رقبا", color: "#38BDF8" },
  "03_Agent_Memory": { label: "۰۳ · قوانین و حافظه ایجنت‌ها", color: "#10B981" },
  "04_Projects": { label: "۰۴ · آرشیو پست‌ها و سناریوها", color: "#A78BFA" },
};

export function VaultSecondBrainView({ pages }: VaultSecondBrainViewProps) {
  const [vault, setVault] = useState<VaultSnapshot | null>(null);
  const [memories, setMemories] = useState<AgentMemoryEntry[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [activeFolderFilter, setActiveFolderFilter] = useState<VaultFolderId | "all">("all");
  const [subMode, setSubMode] = useState<"obsidian" | "memory">("obsidian");

  // Custom Note Creator / Editor
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteFolder, setNoteFolder] = useState<VaultFolderId>("02_Viral_Lab");
  const [noteMd, setNoteMd] = useState("");

  // New Memory Rule form
  const [newRuleAgent, setNewRuleAgent] = useState<AgentSuperRole>("scriptwriter_agent");
  const [newRulePageId, setNewRulePageId] = useState<string>("");
  const [newRuleText, setNewRuleText] = useState("");
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  const loadVaultAndMemories = useCallback(async () => {
    try {
      const [vRes, mRes] = await Promise.all([fetch("/api/vault"), fetch("/api/memories")]);
      const vData = await vRes.json();
      const mData = await mRes.json();
      if (vRes.ok && vData.vault) {
        setVault(vData.vault);
        setSelectedNoteId((prev) => prev || vData.vault.notes[0]?.id || null);
      }
      if (mRes.ok && Array.isArray(mData.memories)) {
        setMemories(mData.memories);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadVaultAndMemories();
  }, [loadVaultAndMemories]);

  const selectedNote: VaultNote | null = useMemo(() => {
    if (!vault) return null;
    return vault.notes.find((n) => n.id === selectedNoteId) || vault.notes[0] || null;
  }, [vault, selectedNoteId]);

  const visibleNotes = useMemo(() => {
    if (!vault) return [];
    if (activeFolderFilter === "all") return vault.notes;
    return vault.notes.filter((n) => n.folder === activeFolderFilter);
  }, [vault, activeFolderFilter]);

  // Deterministic radial-clustered 2D layout for the Obsidian Knowledge Graph
  const graphLayout = useMemo(() => {
    if (!vault) return { positionedNodes: [], edges: [] };
    const width = 760;
    const height = 340;
    const cx = width / 2;
    const cy = height / 2;

    const folderAngles: Record<VaultFolderId, number> = {
      "01_Pages": -Math.PI * 0.75,
      "02_Viral_Lab": -Math.PI * 0.25,
      "03_Agent_Memory": Math.PI * 0.25,
      "04_Projects": Math.PI * 0.75,
    };

    const grouped: Record<VaultFolderId, typeof vault.nodes> = {
      "01_Pages": [],
      "02_Viral_Lab": [],
      "03_Agent_Memory": [],
      "04_Projects": [],
    };
    for (const n of vault.nodes) {
      grouped[n.folder].push(n);
    }

    const posMap = new Map<string, { x: number; y: number }>();
    const positionedNodes = vault.nodes.map((node) => {
      const siblings = grouped[node.folder];
      const idx = siblings.findIndex((s) => s.id === node.id);
      const baseAngle = folderAngles[node.folder];
      const spread = siblings.length > 1 ? ((idx / (siblings.length - 1)) - 0.5) * 1.32 : 0;
      const radius = 104 + (idx % 3) * 32;
      const x = Math.round(cx + Math.cos(baseAngle + spread) * radius * 1.52);
      const y = Math.round(cy + Math.sin(baseAngle + spread) * radius * 0.9);
      posMap.set(node.id, { x, y });
      return { ...node, x, y, color: FOLDER_META[node.folder].color };
    });

    const edges = vault.edges
      .map((e) => {
        const s = posMap.get(e.source);
        const t = posMap.get(e.target);
        if (!s || !t) return null;
        return { ...e, x1: s.x, y1: s.y, x2: t.x, y2: t.y };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    return { positionedNodes, edges };
  }, [vault]);

  const handleSaveCustomNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteMd.trim()) return;
    const res = await fetch("/api/vault/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: noteTitle.trim(),
        folder: noteFolder,
        contentMd: noteMd,
      }),
    });
    const data = await res.json();
    if (res.ok && data.vault) {
      setVault(data.vault);
      setSelectedNoteId(data.note.id);
      setShowNoteEditor(false);
      setNoteTitle("");
      setNoteMd("");
      setSavedBanner("یادداشت Markdown جدید در پوشه data/vault ذخیره و به گراف متصل شد.");
    }
  };

  const handleAddMemoryRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleText.trim()) return;
    const res = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: newRuleAgent,
        scope: newRulePageId ? "page" : "global",
        pageProfileId: newRulePageId || null,
        category: "learned_rule",
        ruleText: newRuleText.trim(),
        sourceEvent: "ثبت قانون دائمی در مغز دوم",
        initialStrength: 9,
      }),
    });
    const data = await res.json();
    if (res.ok && data.memories) {
      setMemories(data.memories);
      setNewRuleText("");
      await loadVaultAndMemories();
      setSavedBanner("قانون جدید به حافظه تکاملی ایجنت اضافه شد.");
    }
  };

  const handleDeleteMemory = async (id: string) => {
    const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok && data.memories) {
      setMemories(data.memories);
      await loadVaultAndMemories();
    }
  };

  const handleOpenWikilink = (targetTitle: string) => {
    if (!vault) return;
    const clean = targetTitle.trim().toLowerCase();
    const match = vault.notes.find(
      (n) => n.title.trim().toLowerCase() === clean || n.slug.toLowerCase() === clean
    );
    if (match) setSelectedNoteId(match.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-100">
            مغز دوم Obsidian و حافظه خودتکاملی ایجنت‌ها
          </h1>
          <p className="mt-1 text-xs leading-6 text-slate-400">
            تمام پیج‌ها، تحلیل‌های وایرال، سناریوها و اشتباهات اصلاح‌شده به‌صورت فایل‌های واقعی{" "}
            <span className="font-mono-tabular text-slate-200">.md</span> با لینک‌های دوطرفه{" "}
            <span className="font-mono-tabular text-amber-300">[[Wikilink]]</span> در پوشه{" "}
            <span className="font-mono-tabular text-slate-200">data/vault/</span> ذخیره می‌شوند تا ایجنت‌ها هر روز هوشمندتر شوند.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-[#262B38] bg-[#14171F] p-1">
          <button
            type="button"
            onClick={() => setSubMode("obsidian")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              subMode === "obsidian"
                ? "bg-amber-500 text-slate-950"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            <span>گراف دانش و یادداشت‌های Obsidian</span>
          </button>
          <button
            type="button"
            onClick={() => setSubMode("memory")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              subMode === "memory"
                ? "bg-amber-500 text-slate-950"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <Brain className="h-3.5 w-3.5" />
            <span>حافظه تکاملی ۲ ایجنت ({memories.length})</span>
          </button>
        </div>
      </div>

      {savedBanner && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
          <span>{savedBanner}</span>
          <button
            type="button"
            onClick={() => setSavedBanner(null)}
            className="text-slate-300 hover:text-white"
          >
            بستن
          </button>
        </div>
      )}

      {subMode === "obsidian" ? (
        <div className="space-y-6">
          {/* Interactive 2D Obsidian Knowledge Graph */}
          <section className="rounded-2xl border border-[#262B38] bg-[#14171F] p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="font-bold text-slate-100">گراف ارتباطی دانش استودیو</span>
                {(Object.keys(FOLDER_META) as VaultFolderId[]).map((fid) => (
                  <span key={fid} className="inline-flex items-center gap-1.5 text-slate-400">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: FOLDER_META[fid].color }}
                    />
                    <span>{FOLDER_META[fid].label}</span>
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNoteEditor((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>یادداشت Markdown جدید</span>
                </button>
                <button
                  type="button"
                  onClick={() => void loadVaultAndMemories()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs text-slate-300 hover:text-white whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>همگام‌سازی دیسک</span>
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#262B38] bg-[#0B0D11]">
              <svg
                data-testid="vault-graph-canvas"
                viewBox="0 0 760 340"
                className="h-[320px] w-full select-none"
              >
                <g stroke="#334155" strokeOpacity="0.55" strokeWidth="1.4">
                  {graphLayout.edges.map((e, idx) => (
                    <line key={idx} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
                  ))}
                </g>

                {graphLayout.positionedNodes.map((node) => {
                  const isSelected = selectedNote?.id === node.id;
                  const r = Math.min(13, 6 + node.degree * 1.4);
                  return (
                    <g
                      key={node.id}
                      onClick={() => setSelectedNoteId(node.id)}
                      className="cursor-pointer"
                    >
                      {isSelected && (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={r + 6}
                          fill={node.color}
                          fillOpacity="0.22"
                        />
                      )}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={r}
                        fill={node.color}
                        stroke={isSelected ? "#FFFFFF" : "#0B0D11"}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                      />
                      <text
                        x={node.x}
                        y={node.y + r + 14}
                        textAnchor="middle"
                        fill={isSelected ? "#F8FAFC" : "#94A3B8"}
                        fontSize="10"
                      >
                        {node.label.slice(0, 26)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </section>

          {showNoteEditor && (
            <form
              onSubmit={handleSaveCustomNote}
              className="space-y-4 rounded-2xl border border-amber-500/40 bg-[#14171F] p-5"
            >
              <div className="text-sm font-bold text-slate-100">
                ایجاد یادداشت جدید در Vault (پشتیبانی از لینک‌های [[نام پیج یا یادداشت]])
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <input
                  type="text"
                  required
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="عنوان یادداشت"
                  className="rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                />
                <select
                  value={noteFolder}
                  onChange={(e) => setNoteFolder(e.target.value as VaultFolderId)}
                  className="rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  {(Object.keys(FOLDER_META) as VaultFolderId[]).map((fid) => (
                    <option key={fid} value={fid}>
                      {FOLDER_META[fid].label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={4}
                required
                value={noteMd}
                onChange={(e) => setNoteMd(e.target.value)}
                placeholder="متن Markdown خود را بنویسید... مثلاً: این فرمول برای [[پیج فروش آهن‌آلات و مقاطع فولادی]] فوق‌العاده عمل می‌کند."
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] p-3.5 text-xs leading-6 text-slate-100 focus:border-amber-500 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>ذخیره در فایل‌های Obsidian</span>
                </button>
              </div>
            </form>
          )}

          {/* Explorer + Note Markdown Reader */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <aside className="space-y-3 rounded-2xl border border-[#262B38] bg-[#14171F] p-4 lg:col-span-4">
              <div className="flex items-center gap-2 border-b border-[#262B38] pb-3 text-xs font-bold text-slate-200">
                <FolderTree className="h-4 w-4 text-amber-400" />
                <span>پوشه‌های Vault ({visibleNotes.length} فایل .md)</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveFolderFilter("all")}
                  className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                    activeFolderFilter === "all"
                      ? "bg-amber-500 text-slate-950 font-semibold"
                      : "bg-[#0B0D11] text-slate-400 hover:text-white"
                  }`}
                >
                  همه
                </button>
                {(Object.keys(FOLDER_META) as VaultFolderId[]).map((fid) => (
                  <button
                    key={fid}
                    type="button"
                    onClick={() => setActiveFolderFilter(fid)}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                      activeFolderFilter === fid
                        ? "bg-amber-500 text-slate-950 font-semibold"
                        : "bg-[#0B0D11] text-slate-400 hover:text-white"
                    }`}
                  >
                    {FOLDER_META[fid].label.split("·")[1]?.trim()}
                  </button>
                ))}
              </div>

              <div className="max-h-[420px] space-y-1.5 overflow-y-auto pt-1">
                {visibleNotes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => setSelectedNoteId(note.id)}
                    className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-right text-xs transition-colors ${
                      selectedNote?.id === note.id
                        ? "border-amber-500/60 bg-[#1B1F2A] text-slate-100"
                        : "border-transparent bg-[#0B0D11]/60 text-slate-300 hover:border-[#262B38]"
                    }`}
                  >
                    <FileText
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      style={{ color: FOLDER_META[note.folder].color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{note.title}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500 font-mono-tabular" dir="ltr">
                        data/vault/{note.folder}/{note.slug}.md
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            {selectedNote && (
              <section className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-6 lg:col-span-8">
                <div className="border-b border-[#262B38] pb-4">
                  <div className="text-xs text-amber-400">
                    {FOLDER_META[selectedNote.folder].label} ·{" "}
                    <span dir="ltr" className="font-mono-tabular text-slate-400">
                      {selectedNote.slug}.md
                    </span>
                  </div>
                  <h2 className="mt-1 text-lg font-bold text-slate-100">{selectedNote.title}</h2>
                </div>

                <pre className="max-h-[380px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#262B38] bg-[#0B0D11] p-4 font-sans text-xs leading-7 text-slate-200">
                  {selectedNote.contentMd}
                </pre>

                <div className="grid grid-cols-1 gap-4 border-t border-[#262B38] pt-4 text-xs md:grid-cols-2">
                  <div>
                    <div className="mb-1.5 font-semibold text-amber-300">
                      لینک‌های خروجی (Wikilinks)
                    </div>
                    {selectedNote.wikilinks.length === 0 ? (
                      <span className="text-slate-500">بدون لینک خروجی</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedNote.wikilinks.map((wl, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => handleOpenWikilink(wl)}
                            className="rounded-md border border-[#262B38] bg-[#0B0D11] px-2.5 py-1 text-[11px] text-amber-300 hover:border-amber-500/50"
                          >
                            [[{wl}]]
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-1.5 font-semibold text-sky-300">
                      بک‌لینک‌ها (یادداشت‌های متصل به این صفحه)
                    </div>
                    {selectedNote.backlinks.length === 0 ? (
                      <span className="text-slate-500">بدون بک‌لینک</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedNote.backlinks.map((bl, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => handleOpenWikilink(bl)}
                            className="rounded-md border border-[#262B38] bg-[#0B0D11] px-2.5 py-1 text-[11px] text-sky-300 hover:border-sky-500/50"
                          >
                            ← {bl}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      ) : (
        /* Self-Evolving Memory Rules Manager */
        <div className="space-y-6">
          <form
            onSubmit={handleAddMemoryRule}
            className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5"
          >
            <div className="text-sm font-bold text-slate-100">
              آموزش مستقیم قانون یا خط قرمز جدید به حافظه دائمی ایجنت‌ها
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
              <div className="md:col-span-3">
                <select
                  value={newRuleAgent}
                  onChange={(e) => setNewRuleAgent(e.target.value as AgentSuperRole)}
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="scriptwriter_agent">ایجنت ۱: سناریونویس و گویندگی</option>
                  <option value="director_agent">ایجنت ۲: کارگردان، صدا و تدوین</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <select
                  value={newRulePageId}
                  onChange={(e) => setNewRulePageId(e.target.value)}
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="">قانون سراسری (همه پیج‌ها)</option>
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      مخصوص {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-4">
                <input
                  type="text"
                  value={newRuleText}
                  onChange={(e) => setNewRuleText(e.target.value)}
                  placeholder="مثلاً: در قلاب اول هرگز با سلام و احوال‌پرسی شروع نکن..."
                  className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3.5 py-2.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>ثبت در حافظه</span>
                </button>
              </div>
            </div>
          </form>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {(["scriptwriter_agent", "director_agent"] as AgentSuperRole[]).map((role) => {
              const roleItems = memories.filter((m) => m.agentId === role);
              return (
                <section
                  key={role}
                  className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-5"
                >
                  <div className="border-b border-[#262B38] pb-3">
                    <h2 className="text-sm font-bold text-slate-100">
                      {role === "scriptwriter_agent"
                        ? "قوانین آموخته‌شده ایجنت ۱ (سناریونویس، روانشناس و آوانگار فارسی)"
                        : "قوانین آموخته‌شده ایجنت ۲ (کارگردان شات ۳-۸ ثانیه، کلون صدا و DaVinci)"}
                    </h2>
                  </div>

                  <div className="divide-y divide-[#262B38]">
                    {roleItems.map((m) => (
                      <div key={m.id} className="space-y-1.5 py-3.5 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-xs leading-6 text-slate-100">{m.ruleText}</p>
                          <button
                            type="button"
                            onClick={() => void handleDeleteMemory(m.id)}
                            aria-label="حذف قانون"
                            className="rounded p-1 text-slate-500 hover:text-red-400 shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span className="font-mono-tabular text-amber-400">
                            ضریب استحکام: {m.strength}/10
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{m.scope === "global" ? "سراسری" : "اختصاصی پیج"}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{m.sourceEvent}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
