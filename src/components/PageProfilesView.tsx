import { useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Mic,
  Plus,
  Square,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import type {
  ContentFormatOption,
  PageMaturityOption,
  PageProfile,
  ToneOption,
  VoicePersona,
} from "../types/studio";

interface PageProfilesViewProps {
  pages: PageProfile[];
  activePageId: string | null;
  onSelectPageForProduction: (page: PageProfile) => void;
  onRefreshPages: (updatedPages: PageProfile[]) => void;
}

const PLATFORM_LABELS: Record<PageProfile["platform"], string> = {
  instagram: "اینستاگرام",
  youtube: "یوتیوب",
  tiktok: "تیک‌تاک",
};

const FORMAT_OPTIONS: Array<{ id: ContentFormatOption; label: string }> = [
  { id: "reels", label: "ریلز (عمودی کوتاه)" },
  { id: "shorts", label: "یوتیوب شورتس" },
  { id: "long_video", label: "ویدیوی افقی کامل" },
  { id: "tiktok_video", label: "ویدیوی تیک‌تاک" },
  { id: "carousel", label: "پست اسلایدی" },
];

const VOICE_PERSONAS: Array<{ id: VoicePersona; label: string }> = [
  { id: "Charon", label: "Charon — صدای عمیق، صنعتی و مقتدر" },
  { id: "Kore", label: "Kore — صدای مستند، شفاف و آموزشی" },
  { id: "Puck", label: "Puck — صدای پرانرژی، سریع و تکنولوژی" },
  { id: "Fenrir", label: "Fenrir — صدای تحلیلی و خبری" },
  { id: "Zephyr", label: "Zephyr — صدای گرم، صمیمی و داستانی" },
];

function readBlobAsBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = String(reader.result || "");
      const comma = str.indexOf(",");
      if (comma < 0) return reject(new Error("خطا در خواندن فایل صوتی"));
      resolve({ base64: str.slice(comma + 1), mimeType: blob.type || "audio/webm" });
    };
    reader.onerror = () => reject(new Error("خطا در بارگذاری نمونه صدا"));
    reader.readAsDataURL(blob);
  });
}

export function PageProfilesView({
  pages,
  activePageId,
  onSelectPageForProduction,
  onRefreshPages,
}: PageProfilesViewProps) {
  const [selectedId, setSelectedId] = useState<string>(
    activePageId || pages[0]?.id || ""
  );
  const [showNewForm, setShowNewForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // New page creation form state
  const [newName, setNewName] = useState("");
  const [newHandle, setNewHandle] = useState("@");
  const [newPlatform, setNewPlatform] = useState<PageProfile["platform"]>("instagram");
  const [newFormat, setNewFormat] = useState<ContentFormatOption>("reels");
  const [newMaturity, setNewMaturity] = useState<PageMaturityOption>("new_page");
  const [newNiche, setNewNiche] = useState("");
  const [newStyle, setNewStyle] = useState("");
  const [newPersona, setNewPersona] = useState("");
  const [newPainPoints, setNewPainPoints] = useState("");
  const [newTone, setNewTone] = useState<ToneOption>("educational");
  const [newRedLines, setNewRedLines] = useState("");
  const [newCompetitors, setNewCompetitors] = useState("");

  // Voice recording state for the selected page
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const selectedPage = pages.find((p) => p.id === selectedId) || pages[0] || null;

  const handleCreatePage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newNiche.trim()) return;
    setIsSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          handle: newHandle.trim() || "@new.page",
          platform: newPlatform,
          defaultFormat: newFormat,
          pageMaturity: newMaturity,
          niche: newNiche.trim(),
          contentStyle: newStyle.trim() || "محتوای تخصصی، ریتم تند و بدون حاشیه",
          targetAudiencePersona: newPersona.trim() || "مخاطبان هدف این حوزه تخصصی",
          audiencePainPoints: newPainPoints
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          brandTone: newTone,
          brandToneNoteFa: "لحن تخصصی و معتبر متناسب با هویت پیج",
          visualAestheticFa: "نورپردازی کنتراست بالا با زیرنویس فارسی خوانا",
          tabooRedLines: newRedLines
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          algorithmGuardrails: [
            "قلاب بصری و کلامی در ۱.۵ ثانیه اول",
            "میانگین طول شات‌ها بین ۳ تا ۶ ثانیه",
          ],
          competitorHandles: newCompetitors
            .split(/[,\n،]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ثبت پروفایل انجام نشد.");
      onRefreshPages(data.pages);
      setSelectedId(data.page.id);
      setShowNewForm(false);
      setNewName("");
      setNewHandle("@");
      setNewNiche("");
      setNewStyle("");
      setNewPersona("");
      setNewPainPoints("");
      setNewRedLines("");
      setNewCompetitors("");
      setStatusMsg("پروفایل اختصاصی پیج جدید ذخیره شد.");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "خطا در ثبت پروفایل");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateSelectedPageField = async (patch: Partial<PageProfile>) => {
    if (!selectedPage) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/pages/${selectedPage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok && data.pages) {
        onRefreshPages(data.pages);
        setStatusMsg("تنظیمات پروفایل پیج به‌روزرسانی شد.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePage = async (id: string) => {
    try {
      const res = await fetch(`/api/pages/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.pages) {
        onRefreshPages(data.pages);
        setConfirmDeleteId(null);
        if (selectedId === id && data.pages[0]) {
          setSelectedId(data.pages[0].id);
        }
      }
    } catch {
      setStatusMsg("حذف پیج با خطا مواجه شد.");
    }
  };

  const uploadVoiceBlob = async (blob: Blob) => {
    if (!selectedPage) return;
    setIsUploadingVoice(true);
    setStatusMsg(null);
    try {
      const parsed = await readBlobAsBase64(blob);
      const res = await fetch(`/api/pages/${selectedPage.id}/voice-sample`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: parsed.base64,
          mimeType: parsed.mimeType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ذخیره نمونه صدا انجام نشد.");
      onRefreshPages(data.pages);
      setStatusMsg("نمونه صدای واقعی شما به پروفایل این پیج متصل شد.");
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "خطا در ذخیره نمونه صدا");
    } finally {
      setIsUploadingVoice(false);
    }
  };

  const handleStartVoiceRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        await uploadVoiceBlob(blob);
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setIsRecordingVoice(true);
    } catch {
      setStatusMsg("دسترسی میکروفون در مرورگر فعال نیست؛ می‌توانید فایل صوتی صدای خودتان را بارگذاری کنید.");
    }
  };

  const handleStopVoiceRecord = () => {
    mediaRecorderRef.current?.stop();
    setIsRecordingVoice(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-100">
            پروفایل پیج‌ها و کانال‌های تخصصی
          </h1>
          <p className="mt-1 text-xs leading-6 text-slate-400">
            برای هر پیج (آهن‌آلات، هوش مصنوعی، تعمیرات موبایل، انیمیشن یوتیوب و...) یک بار هویت، پرسونای مخاطب، خطوط قرمز و نمونه صدای خودتان را ثبت کنید تا ایجنت‌ها همیشه طبق آن بسازند.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowNewForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>{showNewForm ? "بستن فرم ساخت پیج" : "تعریف پروفایل پیج جدید"}</span>
        </button>
      </div>

      {statusMsg && (
        <div className="flex items-center justify-between rounded-xl border border-[#262B38] bg-[#14171F] px-4 py-3 text-xs text-amber-300">
          <span>{statusMsg}</span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-slate-400 hover:text-white whitespace-nowrap shrink-0"
          >
            بستن
          </button>
        </div>
      )}

      {/* Create New Page Drawer */}
      {showNewForm && (
        <form
          onSubmit={handleCreatePage}
          className="space-y-4 rounded-2xl border border-amber-500/40 bg-[#14171F] p-6"
        >
          <h2 className="text-sm font-bold text-slate-100">ساخت پروفایل دائمی برای پیج جدید</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-300">نام پیج / کانال</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="مثلاً: پیج تعمیرات تخصصی آیفون"
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">آیدی پیج (Handle)</label>
              <input
                type="text"
                dir="ltr"
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                placeholder="@mobile.master.ir"
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">پلتفرم اصلی</label>
              <select
                value={newPlatform}
                onChange={(e) => setNewPlatform(e.target.value as PageProfile["platform"])}
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="instagram">اینستاگرام (Instagram)</option>
                <option value="youtube">یوتیوب (YouTube — درآمد دلاری)</option>
                <option value="tiktok">تیک‌تاک (TikTok)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-300">فرمت پیش‌فرض</label>
              <select
                value={newFormat}
                onChange={(e) => setNewFormat(e.target.value as ContentFormatOption)}
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">وضعیت فعلی پیج</label>
              <select
                value={newMaturity}
                onChange={(e) => setNewMaturity(e.target.value as PageMaturityOption)}
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="new_page">تازه‌تأسیس (پست‌های ۱ تا ۵ — جذب اولیه)</option>
                <option value="growing_page">در حال رشد (۱۰ تا ۲۰+ پست — مرجعیت)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">لحن پایه برند</label>
              <select
                value={newTone}
                onChange={(e) => setNewTone(e.target.value as ToneOption)}
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="educational">آموزشی و کاربردی</option>
                <option value="news_analysis">تحلیلی، مهندسی و مستند</option>
                <option value="cinematic_story">داستانی و سینمایی</option>
                <option value="fast_motivational">پرانرژی و ریتم تند</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-300">موضوع و حوزه تخصصی دقیق پیج</label>
              <input
                type="text"
                required
                value={newNiche}
                onChange={(e) => setNewNiche(e.target.value)}
                placeholder="مثلاً: فروش عمده آهن‌آلات ساختمانی و صنعتی"
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">سبک بصری و اجرا</label>
              <input
                type="text"
                value={newStyle}
                onChange={(e) => setNewStyle(e.target.value)}
                placeholder="مثلاً: تست واقعی با ابزار دقیق در کارگاه + زیرنویس درشت"
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-300">پرسونای مخاطب هدف</label>
              <textarea
                rows={3}
                value={newPersona}
                onChange={(e) => setNewPersona(e.target.value)}
                placeholder="چه کسانی باید فالو و خرید کنند؟"
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">دغدغه‌های مخاطب (هر خط یک مورد)</label>
              <textarea
                rows={3}
                value={newPainPoints}
                onChange={(e) => setNewPainPoints(e.target.value)}
                placeholder="ترس از جنس تقلبی&#10;ضرر مالی در خرید"
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">خطوط قرمز و پیج‌های رقیب</label>
              <textarea
                rows={2}
                value={newRedLines}
                onChange={(e) => setNewRedLines(e.target.value)}
                placeholder="خطوط قرمز محتوا (هر خط یک مورد)"
                className="mb-2 w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
              <input
                type="text"
                dir="ltr"
                value={newCompetitors}
                onChange={(e) => setNewCompetitors(e.target.value)}
                placeholder="@competitor1, @competitor2"
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Check className="h-4 w-4" />
              <span>ذخیره پروفایل پیج</span>
            </button>
          </div>
        </form>
      )}

      {/* Main Split: Page Cards List (Right) + Selected Page Detail & Personal Voice Studio (Left) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-5">
          {pages.map((page) => {
            const isSelected = selectedPage?.id === page.id;
            const isActiveProd = activePageId === page.id;
            return (
              <div
                key={page.id}
                onClick={() => setSelectedId(page.id)}
                className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                  isSelected
                    ? "border-amber-500 bg-[#1B1F2A]"
                    : "border-[#262B38] bg-[#14171F] hover:border-slate-600"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="text-amber-400 font-medium">
                        {PLATFORM_LABELS[page.platform]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span dir="ltr" className="font-mono-tabular">
                        {page.handle}
                      </span>
                      {isActiveProd && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-400 font-medium">پیج فعال میز کار</span>
                        </>
                      )}
                    </div>
                    <h3 className="mt-1 text-sm font-bold text-slate-100">{page.name}</h3>
                  </div>

                  {pages.length > 1 &&
                    (confirmDeleteId === page.id ? (
                      <div
                        className="flex items-center gap-1.5 text-[11px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => handleDeletePage(page.id)}
                          className="font-semibold text-red-400 hover:text-red-300 whitespace-nowrap"
                        >
                          حذف
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-slate-400 whitespace-nowrap"
                        >
                          لغو
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(page.id);
                        }}
                        aria-label={`حذف ${page.name}`}
                        className="rounded p-1 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ))}
                </div>

                <p className="mt-2 line-clamp-2 text-xs leading-6 text-slate-300">{page.niche}</p>

                <div className="mt-3 flex items-center justify-between border-t border-[#262B38] pt-3">
                  <span className="text-[11px] text-slate-400">
                    صدای مرجع: {page.voiceProfile.sampleAudioUrl ? "ثبت‌شده" : page.voiceProfile.voicePersona}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPageForProduction(page);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
                  >
                    <span>تولید پست برای این پیج</span>
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Page Inspector + Personal Voice Clone Studio */}
        {selectedPage && (
          <div className="space-y-5 lg:col-span-7">
            <section className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262B38] pb-4">
                <div>
                  <div className="text-xs text-amber-400">
                    {PLATFORM_LABELS[selectedPage.platform]} ·{" "}
                    <span dir="ltr" className="font-mono-tabular">
                      {selectedPage.handle}
                    </span>
                  </div>
                  <h2 className="mt-1 text-lg font-bold text-slate-100">{selectedPage.name}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectPageForProduction(selectedPage)}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
                >
                  <span>انتخاب و رفتن به میز کار تولید</span>
                  <ArrowLeft className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 text-xs leading-6 md:grid-cols-2">
                <div>
                  <div className="font-semibold text-slate-200">حوزه تخصصی پیج</div>
                  <p className="mt-1 text-slate-300">{selectedPage.niche}</p>
                </div>
                <div>
                  <div className="font-semibold text-slate-200">سبک اجرا و تصویر</div>
                  <p className="mt-1 text-slate-300">{selectedPage.contentStyle}</p>
                </div>
                <div className="md:col-span-2">
                  <div className="font-semibold text-emerald-300">پرسونای دقیق مخاطبان این پیج</div>
                  <p className="mt-1 text-slate-300">{selectedPage.targetAudiencePersona}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-[#262B38] pt-4 text-xs leading-6 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 font-semibold text-amber-300">دغدغه‌ها و دردهای مخاطب</div>
                  <ul className="space-y-1 text-slate-300">
                    {selectedPage.audiencePainPoints.map((p, i) => (
                      <li key={i}>• {p}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-1.5 font-semibold text-rose-300">خطوط قرمز و ممنوعیت‌های الگوریتمی پیج</div>
                  <ul className="space-y-1 text-slate-300">
                    {selectedPage.tabooRedLines.map((r, i) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {selectedPage.competitorHandles.length > 0 && (
                <div className="border-t border-[#262B38] pt-3 text-xs text-slate-400">
                  رقبای ثبت‌شده برای تحلیل:{" "}
                  <span dir="ltr" className="font-mono-tabular text-slate-200">
                    {selectedPage.competitorHandles.join(" · ")}
                  </span>
                </div>
              )}
            </section>

            {/* Personal Voice Clone Reference Studio */}
            <section className="space-y-4 rounded-2xl border border-[#262B38] bg-[#14171F] p-6">
              <div className="flex items-center gap-2 border-b border-[#262B38] pb-3 text-sm font-bold text-slate-100">
                <Volume2 className="h-4 w-4 text-amber-400" />
                <span>استودیو کلون صدای شخصی و لحن گویندگی این پیج (۱۰۰٪ رایگان)</span>
              </div>

              <p className="text-xs leading-6 text-slate-400">
                ۱۰ تا ۲۰ ثانیه از صدای واقعی خودتان را ضبط یا آپلود کنید تا به عنوان صدای مرجع این پیج ذخیره شود. در محیط وب پرسونای هم‌طیف گوگل با اعراب‌گذاری کامل فارسی اجرا می‌شود و در پکیج ویندوز موتور آفلاین <span className="font-mono-tabular text-slate-200">XTTS-v2</span> دقیقاً رنگ صدای خودتان را شبیه‌سازی می‌کند.
              </p>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-300">پرسونای صوتی پایه (رایگان ابری)</label>
                  <select
                    value={selectedPage.voiceProfile.voicePersona}
                    onChange={(e) =>
                      handleUpdateSelectedPageField({
                        voiceProfile: {
                          ...selectedPage.voiceProfile,
                          voicePersona: e.target.value as VoicePersona,
                        },
                      })
                    }
                    className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  >
                    {VOICE_PERSONAS.map((vp) => (
                      <option key={vp.id} value={vp.id}>
                        {vp.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-300">دستور لحن، حس و سرعت خوانش</label>
                  <input
                    type="text"
                    value={selectedPage.voiceProfile.prosodyStyle}
                    onChange={(e) =>
                      handleUpdateSelectedPageField({
                        voiceProfile: {
                          ...selectedPage.voiceProfile,
                          prosodyStyle: e.target.value,
                        },
                      })
                    }
                    className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {!isRecordingVoice ? (
                  <button
                    type="button"
                    disabled={isUploadingVoice}
                    onClick={handleStartVoiceRecord}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Mic className="h-4 w-4" />
                    <span>ضبط نمونه صدای خودم با میکروفون</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStopVoiceRecord}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-400 whitespace-nowrap shrink-0"
                  >
                    <Square className="h-3.5 w-3.5" />
                    <span>توقف ضبط و ذخیره نمونه صدا</span>
                  </button>
                )}

                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#262B38] bg-[#0B0D11] px-4 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 whitespace-nowrap shrink-0">
                  <Upload className="h-3.5 w-3.5 text-amber-400" />
                  <span>{isUploadingVoice ? "در حال آپلود..." : "آپلود فایل صدای مرجع (WAV/MP3)"}</span>
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadVoiceBlob(file);
                    }}
                  />
                </label>
              </div>

              {selectedPage.voiceProfile.sampleAudioUrl && (
                <div className="space-y-2 rounded-xl border border-[#262B38] bg-[#0B0D11] p-4">
                  <div className="text-xs text-emerald-400">
                    نمونه صدای مرجع ثبت‌شده برای «{selectedPage.voiceProfile.speakerName}»:
                  </div>
                  <audio
                    controls
                    src={selectedPage.voiceProfile.sampleAudioUrl}
                    className="w-full accent-amber-500"
                  />
                  {selectedPage.voiceProfile.sampleTranscript && (
                    <p className="text-[11px] text-slate-400">
                      متن تشخیص‌داده‌شده از صدای شما: «{selectedPage.voiceProfile.sampleTranscript}»
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
