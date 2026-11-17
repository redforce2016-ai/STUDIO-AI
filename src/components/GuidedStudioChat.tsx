import { useEffect, useRef, useState } from "react";
import {
  Check,
  Mic,
  Send,
  Sparkles,
  Square,
  UserCheck,
  Wand2,
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

export interface ChatTimelineMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  metaLabel?: string;
  analysis?: TopicAnalysisResponse;
}

interface GuidedStudioChatProps {
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
  onChangePlatform: (p: PlatformOption) => void;
  onChangeFormat: (f: ContentFormatOption) => void;
  onChangePageMaturity: (m: PageMaturityOption) => void;
  onAnalyzeIdea: (ideaText: string) => Promise<void>;
  onSelectProposalAndStart: (proposal: ViralTopicProposal | null) => Promise<void>;
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
  input: "ایده یا موضوع خود را بنویسید...",
  research_script: "تغییری در سناریو می‌خواهید؟ بنویسید (مثلاً: قلاب را جذاب‌تر کن)...",
  storyboard: "تغییری در استوری‌بورد، دکوپاژ یا قاب شات‌ها می‌خواهید؟ بنویسید...",
  video_shots: "تغییری در شات‌های ویدیویی یا کارگردانی بصری می‌خواهید؟ بنویسید...",
  voiceover: "تغییری در لحن یا متن گوینده می‌خواهید؟ بنویسید...",
  assembly: "نکته‌ای درباره تدوین، زیرنویس یا مونتاژ نهایی دارید؟ بنویسید...",
  completed: "پروژه آماده است؛ هر تغییری بخواهید می‌توانید اینجا بنویسید یا ایده جدید شروع کنید.",
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

export function GuidedStudioChat({
  activeStage,
  hasActiveProject,
  isAnalyzing,
  isRunningPipeline,
  initialDraftIdea,
  platform,
  contentFormat,
  pageMaturity,
  messages,
  pendingBrief,
  pendingAnalysis,
  onChangePlatform,
  onChangeFormat,
  onChangePageMaturity,
  onAnalyzeIdea,
  onSelectProposalAndStart,
  onSendStageFeedback,
}: GuidedStudioChatProps) {
  const [inputText, setInputText] = useState(initialDraftIdea || "");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialDraftIdea) setInputText(initialDraftIdea);
  }, [initialDraftIdea]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isAnalyzing, isRunningPipeline]);

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
            setInputText((prev) => (prev.trim() ? `${prev.trim()}\n${data.transcript}` : data.transcript));
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
    <section className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#262B38] bg-[#14171F]">
      {/* Calm Header */}
      <div className="flex items-center justify-between border-b border-[#262B38] px-5 py-4">
        <div>
          <h2 className="text-sm font-bold text-slate-100">دستیار هوشمند ایده و سناریو</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {hasActiveProject
              ? "برای اصلاح مرحله فعلی، نظر خود را همین‌جا بنویسید"
              : "پلتفرم و فرمت را انتخاب کنید و ایده‌تان را بنویسید"}
          </p>
        </div>
        <Sparkles className="h-4 w-4 text-amber-400" />
      </div>

      {/* Chat Messages Area */}
      <div className="flex-1 space-y-4 overflow-y-auto p-5" style={{ minHeight: "340px", maxHeight: "540px" }}>
        {messages.length === 0 ? (
          <div className="space-y-4 rounded-xl border border-[#262B38] bg-[#0B0D11]/70 p-4 text-xs leading-7 text-slate-300">
            <p className="font-semibold text-amber-400">سلام! آماده‌ام کنارتان محتوا بسازم.</p>
            <p>
              کافی است از پایین انتخاب کنید محتوا برای کجاست و ایده‌تان را با زبان ساده بنویسید (یا با
              میکروفون بگویید). من ایده‌تان را هم‌زمان از نگاه{" "}
              <span className="font-semibold text-slate-100">استراتژیست محتوا</span>،{" "}
              <span className="font-semibold text-slate-100">روانشناسی مخاطب</span> و{" "}
              <span className="font-semibold text-slate-100">تولیدکننده حرفه‌ای</span> بررسی می‌کنم و
              ۳ موضوع پربازدید پیشنهاد می‌دهم.
            </p>
            <div className="space-y-1.5 border-t border-[#262B38] pt-3">
              <div className="text-[11px] text-slate-400">نمونه‌های آماده برای شروع سریع:</div>
              <button
                type="button"
                onClick={() =>
                  setInputText(
                    "می‌خواهم درباره اشتباهات رایج در خرید قهوه خانگی و راز طعم کافه‌ای ویدیو بسازم."
                  )
                }
                className="block w-full rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-right text-xs text-slate-200 transition-colors hover:border-amber-500/50"
              >
                «اشتباهات رایج دم‌آوری قهوه در خانه و راز طعم کافه‌ای»
              </button>
              <button
                type="button"
                onClick={() =>
                  setInputText(
                    "چطور با گوشی و بدون دوربین گران‌قیمت، نورپردازی و فیلم‌برداری حرفه‌ای انجام دهیم؟"
                  )
                }
                className="block w-full rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-right text-xs text-slate-200 transition-colors hover:border-amber-500/50"
              >
                «فیلم‌برداری و نورپردازی حرفه‌ای فقط با گوشی موبایل»
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-start" : "items-end"}`}
            >
              <div
                className={`max-w-[94%] rounded-2xl px-4 py-3 text-xs leading-7 ${
                  msg.role === "user"
                    ? "bg-[#1B1F2A] text-slate-100"
                    : "border border-[#262B38] bg-[#0B0D11] text-slate-200"
                }`}
              >
                {msg.metaLabel && (
                  <div className="mb-1 text-[11px] font-medium text-amber-400">{msg.metaLabel}</div>
                )}
                <p className="whitespace-pre-wrap">{msg.text}</p>

                {/* Deep Domain, Audience & 3 Viral Topic Proposals inside Assistant Message */}
                {msg.analysis && msg.analysis.proposals.length > 0 && (
                  <div className="mt-4 space-y-3 border-t border-[#262B38] pt-3">
                    {(msg.analysis.exactTargetAudience || msg.analysis.pageStrategyRecommendation) && (
                      <div className="space-y-1 border-b border-[#262B38] pb-2.5 text-[11px] leading-6">
                        {msg.analysis.keywordDomainAnalysis && (
                          <div>
                            <span className="font-semibold text-amber-300">حوزه واقعی: </span>
                            <span className="text-slate-300">{msg.analysis.keywordDomainAnalysis}</span>
                          </div>
                        )}
                        {msg.analysis.exactTargetAudience && (
                          <div>
                            <span className="font-semibold text-emerald-300">مخاطب هدف دقیق: </span>
                            <span className="text-slate-200">{msg.analysis.exactTargetAudience}</span>
                          </div>
                        )}
                        {msg.analysis.pageStrategyRecommendation && (
                          <div>
                            <span className="font-semibold text-sky-300">استراتژی مرحله پیج: </span>
                            <span className="text-slate-300">{msg.analysis.pageStrategyRecommendation}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="text-[11px] font-semibold text-amber-400">
                      {msg.analysis.hasDetailedScriptInstructions
                        ? "توضیحات سناریوی شما کامل بود؛ در کنار متن خودتان این ۳ زاویه تخصصی هم پیشنهاد می‌شود:"
                        : "۳ زاویه تخصصی و وایرال متناسب با این مخاطب — یکی را انتخاب کنید:"}
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

                        {prop.targetAudienceSegment && (
                          <div className="text-[11px] text-emerald-300">
                            مخاطب این موضوع: {prop.targetAudienceSegment}
                          </div>
                        )}

                        <div className="text-[11px] text-amber-300">
                          قلاب ۳ ثانیه اول: «{prop.sampleHook}»
                        </div>

                        {prop.keyFactsAndDataPoints && prop.keyFactsAndDataPoints.length > 0 && (
                          <div className="text-[11px] leading-5 text-slate-300">
                            <span className="font-semibold text-slate-200">نکات کلیدی فنی: </span>
                            {prop.keyFactsAndDataPoints.slice(0, 2).join(" · ")}
                          </div>
                        )}

                        {!hasActiveProject && pendingBrief && pendingAnalysis && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onSelectProposalAndStart(prop)}
                            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>انتخاب این موضوع و نوشتن سناریو</span>
                          </button>
                        )}
                      </div>
                    ))}

                    {!hasActiveProject && pendingBrief && pendingAnalysis && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onSelectProposalAndStart(null)}
                        className="flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-[#262B38] bg-[#14171F] px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-amber-500/50 hover:text-slate-100 disabled:opacity-50"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <UserCheck className="h-3.5 w-3.5 text-amber-400" />
                          <span>نوشتن سناریو دقیقاً طبق متن خودم (بدون تغییر موضوع)</span>
                        </span>
                        <span className="text-[11px] text-slate-400">
                          با لحن {pendingAnalysis.defaultRecommendedToneLabelFa} · {pendingAnalysis.defaultRecommendedDurationLabelFa}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {(isAnalyzing || isRunningPipeline) && (
          <div className="flex items-center gap-2.5 rounded-xl border border-[#262B38] bg-[#0B0D11] px-4 py-3 text-xs text-amber-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            <span>
              {isAnalyzing
                ? "در حال بررسی ایده از نگاه استراتژیست، روانشناسی و تولیدکننده حرفه‌ای..."
                : "در حال آماده‌سازی خروجی و تنظیم جزئیات..."}
            </span>
          </div>
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Bottom Guided Controls & Input Box */}
      <form onSubmit={handleSubmit} className="space-y-3 border-t border-[#262B38] bg-[#0B0D11]/55 p-4">
        {!hasActiveProject && (
          <div className="space-y-2.5">
            {/* Step 1: Platform */}
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
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? "border-amber-500 bg-amber-500 text-slate-950"
                        : "border-[#262B38] bg-[#14171F] text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Step 2: Dynamic Format based on Platform */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ml-1 text-[11px] font-medium text-slate-400">نوع محتوا:</span>
              {availableFormats.map((fmt) => {
                const selected = contentFormat === fmt.id;
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onChangeFormat(fmt.id)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
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

            {/* Step 3: Page Maturity / Growth Stage */}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="ml-1 text-[11px] font-medium text-slate-400">وضعیت پیج:</span>
                {PAGE_MATURITY_OPTIONS.map((opt) => {
                  const selected = pageMaturity === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={busy}
                      onClick={() => onChangePageMaturity(opt.id)}
                      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
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
              <div className="text-[11px] text-slate-400">
                {PAGE_MATURITY_OPTIONS.find((o) => o.id === pageMaturity)?.hint}
              </div>
            </div>

            <div className="text-[11px] text-slate-500">
              بهترین لحن و زمان مناسب محتوا توسط هوش مصنوعی پیشنهاد می‌شود.
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
                : STAGE_CHAT_HINT[activeStage || "input"]
            }
            className="flex-1 resize-none rounded-xl border border-[#262B38] bg-[#14171F] px-3.5 py-2.5 text-xs leading-6 text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />

          <div className="flex flex-col gap-1.5">
            {!isRecording ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleStartMic}
                title="گفتن ایده با صدا"
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
              title={hasActiveProject ? "ارسال درخواست تغییر" : "بررسی ایده و پیشنهاد ۳ موضوع"}
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
