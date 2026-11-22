import { useEffect, useRef, useState } from "react";
import {
  Check,
  FolderKanban,
  Mic,
  Send,
  Sparkles,
  Square,
  UserCheck,
  Wand2,
  Zap,
} from "lucide-react";
import type {
  ContentFormatOption,
  PageMaturityOption,
  PipelineStage,
  PlatformOption,
  ProjectBrief,
  TopicAnalysisResponse,
  ViralTopicProposal,
} from "../types/studio";

export interface StudioPageProfileOption {
  id: string;
  name: string;
  handle: string;
  platform: PlatformOption;
  niche: string;
  voiceProfile?: {
    speakerName: string;
    voicePersona: string;
  };
}

export interface ChatTimelineMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  metaLabel?: string;
  analysis?: TopicAnalysisResponse;
}

interface GuidedStudioChatProps {
  pages?: StudioPageProfileOption[];
  selectedPageId?: string | null;
  activeStage: PipelineStage | null;
  hasActiveProject: boolean;
  isAnalyzing: boolean;
  isRunningPipeline: boolean;
  initialDraftIdea?: string;
  platform: PlatformOption;
  contentFormat: ContentFormatOption;
  pageMaturity: PageMaturityOption;
  messages: ChatTimelineMessage[];
  pendingBrief: ProjectBrief | null;
  pendingAnalysis: TopicAnalysisResponse | null;
  onSelectPageProfile?: (page: StudioPageProfileOption | null) => void;
  onManagePages?: () => void;
  onChangePlatform: (p: PlatformOption) => void;
  onChangeFormat: (f: ContentFormatOption) => void;
  onChangePageMaturity: (m: PageMaturityOption) => void;
  onAnalyzeIdea: (ideaText: string) => Promise<void>;
  onSelectProposalAndStart: (proposal: ViralTopicProposal | null) => Promise<void>;
  onStartAutopilotFromProposal?: (proposal: ViralTopicProposal | null) => Promise<void>;
  onSendStageFeedback: (feedbackText: string) => Promise<void>;
}

const PLATFORM_OPTIONS: Array<{ id: PlatformOption; label: string }> = [
  { id: "instagram", label: "اینستاگرام" },
  { id: "youtube", label: "یوتیوب" },
  { id: "tiktok", label: "تیک‌تاک" },
];

export const FORMATS_BY_PLATFORM: Record<
  string,
  Array<{ id: ContentFormatOption; label: string }>
> = {
  instagram: [
    { id: "reels", label: "ریلز (ویدیو کوتاه)" },
    { id: "post", label: "پست / اسلاید" },
    { id: "story", label: "استوری" },
  ],
  youtube: [
    { id: "shorts", label: "شورتس (کوتاه)" },
    { id: "long_video", label: "ویدیوی کامل" },
  ],
  tiktok: [
    { id: "tiktok_video", label: "ویدیوی کوتاه" },
    { id: "carousel", label: "اسلاید عکس" },
  ],
};

export const PAGE_MATURITY_OPTIONS: Array<{
  id: PageMaturityOption;
  label: string;
  hint: string;
}> = [
  {
    id: "new_page",
    label: "شروع پیج (پست‌های ۱ تا ۵)",
    hint: "موضوعات پایه‌ای، مستند و هویت‌ساز برای جذب فالوور اولیه و ساخت اعتبار پیج",
  },
  {
    id: "growing_page",
    label: "پیج فعال (۱۰ تا ۲۰+ پست)",
    hint: "موضوعات چالشی، افشاگری تخصصی، مقایسه فنی و هم‌راستا با پست‌های قبلی",
  },
];

const STAGE_CHAT_HINT: Record<PipelineStage, string> = {
  input: "موضوع خام خود را بنویسید تا ایجنت سناریونویس ۳ زاویه بی‌نظیر پیشنهاد دهد...",
  research_script: "اصلاحی روی سناریو می‌خواهید؟ بنویسید (ایراد یادگرفته‌شده در حافظه ایجنت هم ثبت می‌شود)...",
  storyboard: "تغییری در دکوپاژ شات‌ها، زاویه دوربین یا تصاویر استوری‌بورد می‌خواهید؟ بنویسید...",
  video_shots: "اگر نکته‌ای برای اصلاح ویدیوی شات‌ها یا صحنه سه‌بعدی دارید اینجا یا روی همان شات بنویسید...",
  voiceover: "تغییری در اعراب‌گذاری، حس بیان، ریتم یا صدای گوینده می‌خواهید؟ بنویسید...",
  assembly: "تغییری در تدوین، زیرنویس یا رندر نهایی می‌خواهید؟ بنویسید...",
  completed: "پست شما نهایی شد! برای شروع پست بعدی روی «شروع ایده جدید» در بالا کلیک کنید.",
};

function readBlobAsBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || "");
      const idx = res.indexOf(",");
      if (idx < 0) return reject(new Error("خطا در خواندن صدا"));
      resolve({ base64: res.slice(idx + 1), mimeType: blob.type || "audio/webm" });
    };
    reader.onerror = () => reject(new Error("خطا در خواندن فایل صوتی"));
    reader.readAsDataURL(blob);
  });
}

function getStarterPromptsForPage(page: StudioPageProfileOption | null): string[] {
  if (!page) {
    return [
      "تفاوت لوله مانیسمان رده ۴۰ و رده ۸۰ و نحوه تشخیص بار اصلی از درزدار در پروژه‌های صنعتی",
      "۳ ابزار ۱۰۰٪ رایگان هوش مصنوعی که جایگزین اشتراک‌های ۲۰ دلاری ماهانه می‌شوند",
    ];
  }
  if (page.id.includes("steel") || page.niche.includes("آهن") || page.niche.includes("لوله")) {
    return [
      "تفاوت لوله مانیسمان رده ۴۰ و رده ۸۰ اهواز و چین و ترفند تشخیص لوله درزمخفی سر پروژه",
      "۳ اشتباه مرگبار خریداران تیرآهن IPE که باعث ضرر صد میلیونی در باسکول می‌شود",
    ];
  }
  if (page.id.includes("ai") || page.niche.includes("هوش مصنوعی")) {
    return [
      "۳ ابزار ۱۰۰٪ رایگان هوش مصنوعی که کار یک تیم تولید محتوا را در ۱۰ دقیقه انجام می‌دهند",
      "چطور بدون پرداخت یک دلار، مدل‌های کدنویسی و ویدیوساز رایگان را به هم وصل کنیم؟",
    ];
  }
  if (page.id.includes("mobile") || page.niche.includes("موبایل")) {
    return [
      "علت خالی شدن ناگهانی باتری آیفون و تست جریانکشی آی‌سی شارژ روی منبع تغذیه",
      "آیا تعویض گلس فنی نمایشگر OLED ارزش دارد یا کل تاچ‌ال‌سی‌دی باید عوض شود؟",
    ];
  }
  return [
    "داستان انیمیشنی ۳۰ ثانیه‌ای درباره راز علمی عمیق‌ترین نقطه اقیانوس که کسی ندید",
    "اگر جاذبه زمین فقط ۵ ثانیه قطع شود دقیقاً چه اتفاقی برای بدن انسان می‌افتد؟",
  ];
}

export function GuidedStudioChat({
  pages = [],
  selectedPageId = null,
  activeStage,
  hasActiveProject,
  isAnalyzing,
  isRunningPipeline,
  initialDraftIdea,
  platform,
  contentFormat,
  pageMaturity,
  messages = [],
  pendingBrief,
  pendingAnalysis,
  onSelectPageProfile,
  onManagePages,
  onChangePlatform,
  onChangeFormat,
  onChangePageMaturity,
  onAnalyzeIdea,
  onSelectProposalAndStart,
  onStartAutopilotFromProposal,
  onSendStageFeedback,
}: GuidedStudioChatProps) {
  const [inputText, setInputText] = useState(initialDraftIdea || "");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  const safePages = Array.isArray(pages) ? pages : [];
  const safeMessages = Array.isArray(messages) ? messages : [];
  const selectedPage = safePages.find((p) => p.id === selectedPageId) ?? null;
  const starterPrompts = getStarterPromptsForPage(selectedPage);

  useEffect(() => {
    if (initialDraftIdea !== undefined && initialDraftIdea !== "") {
      setInputText(initialDraftIdea);
    }
  }, [initialDraftIdea]);

  useEffect(() => {
    if (safeMessages.length > 1 && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [safeMessages.length, isAnalyzing, isRunningPipeline]);

  const platformKey =
    platform === "reels"
      ? "instagram"
      : platform === "shorts"
        ? "youtube"
        : platform;
  const availableFormats = FORMATS_BY_PLATFORM[platformKey] || FORMATS_BY_PLATFORM.instagram;

  const busy = isAnalyzing || isRunningPipeline || isTranscribing;

  const handleStartMic = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setIsTranscribing(true);
        try {
          const parsed = await readBlobAsBase64(blob);
          const res = await fetch("/api/studio/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: parsed.base64, mimeType: parsed.mimeType }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "تبدیل صدا به متن ناموفق بود.");
          if (data.transcript) {
            setInputText((prev) =>
              prev.trim() ? `${prev.trim()}\n${data.transcript}` : data.transcript
            );
          }
        } catch (err) {
          setMicError(err instanceof Error ? err.message : "خطا در تبدیل صدا به متن");
        } finally {
          setIsTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setMicError("لطفاً دسترسی میکروفون را در مرورگر مجاز کنید.");
    }
  };

  const handleStopMic = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputText.trim();
    if (!clean || busy) return;
    setInputText("");
    if (hasActiveProject && activeStage && activeStage !== "input") {
      await onSendStageFeedback(clean);
    } else {
      await onAnalyzeIdea(clean);
    }
  };

  return (
    <section className="flex h-[560px] flex-col overflow-hidden rounded-2xl border border-[#262B38] bg-[#14171F] lg:h-[calc(100vh-7.25rem)]">
      {/* Calm Header with Active Super-Agent Indicator */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#262B38] px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
            <span>۲ ابر-ایجنت خودتکامل‌یابنده</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="truncate text-slate-300">
              {selectedPage ? selectedPage.name : "بدون پروفایل ثابت"}
            </span>
          </div>
          <h2 className="mt-0.5 text-sm font-bold text-slate-100">
            {hasActiveProject
              ? "اصلاح تعاملی مرحله فعلی و آموزش به حافظه ایجنت"
              : "انتخاب پیج و دریافت ۳ سناریوی پیشنهادی وایرال"}
          </h2>
        </div>
        <Sparkles className="h-4 w-4 shrink-0 text-amber-400" />
      </div>

      {/* Active Page Profile Selector Bar (shown only when page profiles are configured) */}
      {(safePages.length > 0 || Boolean(onManagePages)) && (
        <div className="shrink-0 border-b border-[#262B38] bg-[#0B0D11]/60 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="studio-page-select"
              className="text-[11px] font-semibold text-slate-300 whitespace-nowrap"
            >
              پروفایل پیج فعال:
            </label>
            {onManagePages && (
              <button
                type="button"
                onClick={onManagePages}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap shrink-0"
              >
                <FolderKanban className="h-3.5 w-3.5" />
                <span>مدیریت پروفایل‌ها و کلون صدا</span>
              </button>
            )}
          </div>

          <select
            id="studio-page-select"
            disabled={busy || hasActiveProject}
            value={selectedPageId || ""}
            onChange={(e) => {
              const val = e.target.value;
              const found = safePages.find((p) => p.id === val) ?? null;
              onSelectPageProfile?.(found);
            }}
            className="mt-1.5 w-full rounded-xl border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500 disabled:opacity-60"
          >
            <option value="">بدون پروفایل پیج (ورود دستی تنظیمات)</option>
            {safePages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.handle}) — {p.platform === "youtube" ? "یوتیوب" : p.platform === "tiktok" ? "تیک‌تاک" : "اینستاگرام"}
              </option>
            ))}
          </select>

          {selectedPage && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
              <span className="text-slate-200">{selectedPage.niche}</span>
              {selectedPage.voiceProfile && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400">
                    صدا: {selectedPage.voiceProfile.speakerName} ({selectedPage.voiceProfile.voicePersona})
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat Messages Area (Fixed-height internal scroll) */}
      <div
        ref={chatContainerRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5"
      >
        {safeMessages.length === 0 ? (
          <div className="space-y-4 rounded-xl border border-[#262B38] bg-[#0B0D11]/70 p-4 text-xs leading-7 text-slate-300">
            <p className="font-semibold text-amber-400">
              استودیوی تولید ویدیو آماده است؛ موضوع خام امروز را بنویسید.
            </p>
            <p>
              <span className="font-semibold text-slate-100">ایجنت سناریونویس</span> پس از تحلیل موضوع
              و پژوهش وب، ۳ زاویه وایرال پیشنهادی می‌سازد و پس از انتخاب شما، سناریوی کامل، استوری‌بورد،
              ویدیوی تک‌تک شات‌ها، صدای گوینده و تدوین نهایی MP4 را مرحله‌به‌مرحله تحویل می‌دهد.
            </p>
            <div className="space-y-1.5 border-t border-[#262B38] pt-3">
              <div className="text-[11px] text-slate-400">
                موضوعات پیشنهادی آماده برای «{selectedPage ? selectedPage.name : "شروع سریع"}»:
              </div>
              {starterPrompts.map((sample, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setInputText(sample)}
                  className="block w-full rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-right text-xs leading-6 text-slate-200 transition-colors hover:border-amber-500/50"
                >
                  «{sample}»
                </button>
              ))}
            </div>
          </div>
        ) : (
          safeMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-start" : "items-end"}`}
            >
              <div
                className={`max-w-[95%] rounded-2xl px-4 py-3 text-xs leading-7 ${
                  msg.role === "user"
                    ? "bg-[#1B1F2A] text-slate-100"
                    : "border border-[#262B38] bg-[#0B0D11] text-slate-200"
                }`}
              >
                {msg.metaLabel && (
                  <div className="mb-1 text-[11px] font-medium text-amber-400">{msg.metaLabel}</div>
                )}
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {/* 3 Viral Topic Proposals inside Assistant Message */}
                {msg.analysis && Array.isArray(msg.analysis.proposals) && msg.analysis.proposals.length > 0 && (
                  <div className="mt-4 space-y-3 border-t border-[#262B38] pt-3">
                    <div className="text-[11px] font-semibold text-amber-400">
                      ۳ گزینه برتر پیشنهادی (بررسی کامل جزئیات در بوم سمت چپ):
                    </div>

                    {msg.analysis.proposals.map((prop, idx) => (
                      <div
                        key={prop.id}
                        className="space-y-2 border-b border-[#262B38] pb-3 last:border-b-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                          <span className="font-medium text-amber-300">
                            {prop.angleArchetype || `زاویه ${idx + 1}`}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{prop.recommendedToneLabelFa}</span>
                          <span aria-hidden="true">·</span>
                          <span>{prop.recommendedDurationLabelFa}</span>
                        </div>

                        <div className="font-bold text-slate-100">
                          {idx + 1}. {prop.title}
                        </div>

                        {prop.viralPotentialNote && (
                          <div className="text-[11px] text-emerald-300">
                            پتانسیل وایرال: {prop.viralPotentialNote}
                          </div>
                        )}

                        <div className="text-[11px] text-amber-300">
                          قلاب ۳ ثانیه اول: «{prop.sampleHook}»
                        </div>

                        {!hasActiveProject && pendingBrief && pendingAnalysis && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onSelectProposalAndStart(prop)}
                            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap"
                          >
                            <Check className="h-3.5 w-3.5 shrink-0" />
                            <span>انتخاب گزینه {idx + 1} و نگارش سناریوی کامل</span>
                          </button>
                        )}
                      </div>
                    ))}

                    {!hasActiveProject && pendingBrief && pendingAnalysis && (
                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onSelectProposalAndStart(null)}
                          className="flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-amber-500/50 hover:text-slate-100 disabled:opacity-50"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <UserCheck className="h-3.5 w-3.5 text-amber-400" />
                            <span>نگارش سناریو دقیقاً طبق متن خام خودم</span>
                          </span>
                        </button>

                        {onStartAutopilotFromProposal && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              onStartAutopilotFromProposal(msg.analysis?.proposals[0] ?? null)
                            }
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            <Zap className="h-3.5 w-3.5 shrink-0" />
                            <span>اجرای خودکار کامل تا ریلز نهایی (Autopilot + بازبینی بینایی)</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {(isAnalyzing || isRunningPipeline) && (
          <div className="flex items-center gap-2.5 rounded-xl border border-[#262B38] bg-[#0B0D11] px-4 py-3 text-xs text-amber-400">
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            <span>
              {isAnalyzing
                ? "ایجنت سناریونویس در حال پژوهش وب، تحلیل روانشناسی مخاطب و طراحی ۳ گزینه برتر..."
                : "در حال اجرای مرحله فعلی و بروزرسانی حافظه استودیو..."}
            </span>
          </div>
        )}
      </div>

      {/* Bottom Guided Controls & Input Box */}
      <form onSubmit={handleSubmit} className="shrink-0 space-y-3 border-t border-[#262B38] bg-[#0B0D11]/55 p-4">
        {!hasActiveProject && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ml-1 text-[11px] font-medium text-slate-400">پلتفرم:</span>
              {PLATFORM_OPTIONS.map((opt) => {
                const selected = platformKey === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onChangePlatform(opt.id);
                      const firstFmt = FORMATS_BY_PLATFORM[opt.id]?.[0]?.id;
                      if (firstFmt) onChangeFormat(firstFmt);
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      selected
                        ? "border-amber-500 bg-amber-500 text-slate-950"
                        : "border-[#262B38] bg-[#14171F] text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}

              <span className="mr-2 ml-1 text-[11px] font-medium text-slate-400">فرمت:</span>
              {availableFormats.map((fmt) => {
                const selected = contentFormat === fmt.id;
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onChangeFormat(fmt.id)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors whitespace-nowrap shrink-0 ${
                      selected
                        ? "border-amber-500/70 bg-amber-500/15 font-semibold text-amber-300"
                        : "border-[#262B38] bg-[#14171F] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {fmt.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ml-1 text-[11px] font-medium text-slate-400">مرحله رشد پیج:</span>
              {PAGE_MATURITY_OPTIONS.map((opt) => {
                const selected = pageMaturity === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onChangePageMaturity(opt.id)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors whitespace-nowrap shrink-0 ${
                      selected
                        ? "border-amber-500/70 bg-amber-500/15 font-semibold text-amber-300"
                        : "border-[#262B38] bg-[#14171F] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {micError && <div className="text-[11px] text-red-300">{micError}</div>}

        <div className="flex items-end gap-2">
          <textarea
            rows={hasActiveProject ? 2 : 3}
            value={inputText}
            disabled={busy}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              isTranscribing
                ? "در حال تبدیل صدای شما به متن..."
                : STAGE_CHAT_HINT[activeStage || "input"] || STAGE_CHAT_HINT.input
            }
            className="flex-1 resize-none rounded-xl border border-[#262B38] bg-[#14171F] px-3.5 py-2.5 text-xs leading-6 text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />

          <div className="flex flex-col gap-1.5 shrink-0">
            {!isRecording ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleStartMic}
                title="گفتن موضوع با میکروفون"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#262B38] bg-[#14171F] text-slate-300 transition-colors hover:border-amber-500/50 hover:text-amber-400 disabled:opacity-50"
              >
                <Mic className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopMic}
                title="توقف ضبط"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-red-500 text-white hover:bg-red-400"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="submit"
              disabled={busy || !inputText.trim()}
              title={hasActiveProject ? "ارسال بازخورد اصلاحی" : "پیشنهاد ۳ زاویه وایرال"}
              className="inline-flex h-10 w-9 items-center justify-center rounded-xl bg-amber-500 text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {hasActiveProject ? <Send className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
