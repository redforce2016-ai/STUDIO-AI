import { useEffect, useRef, useState } from "react";
import {
  Box,
  Download,
  Film,
  Globe,
  Image as ImageIcon,
  Mic,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import type {
  GroundedSource,
  ImageAspectRatio,
  ImageResolution,
  ProjectRecord,
  StudioMediaAsset,
  VideoAspectRatio,
  VideoDurationOption,
  VideoResolutionOption,
} from "../types/studio";
import { ThreeSceneView } from "./ThreeSceneView";

interface MediaStudioViewProps {
  userUid: string | null;
  activeProject: ProjectRecord | null;
  onSyncAssetToCloud: (asset: StudioMediaAsset) => Promise<void>;
  onDeleteCloudAsset: (assetId: string) => Promise<void>;
  onUseTextAsIdea: (text: string) => void;
}

type StudioSubTab = "image" | "video" | "audio_search" | "scene3d";

function readFileAsBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      if (idx < 0) return reject(new Error("خطا در خواندن فایل"));
      const header = result.slice(0, idx);
      const mimeMatch = header.match(/data:([^;]+);/);
      resolve({
        base64: result.slice(idx + 1),
        mimeType: file.type || mimeMatch?.[1] || "application/octet-stream",
      });
    };
    reader.onerror = () => reject(new Error("خواندن فایل ناموفق بود"));
    reader.readAsDataURL(file);
  });
}

async function fetchMediaUrlAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  const blob = await res.blob();
  const file = new File([blob], "ref.png", { type: blob.type || "image/png" });
  return readFileAsBase64(file);
}

export function MediaStudioView({
  userUid,
  activeProject,
  onSyncAssetToCloud,
  onDeleteCloudAsset,
  onUseTextAsIdea,
}: MediaStudioViewProps) {
  const [subTab, setSubTab] = useState<StudioSubTab>("image");
  const [assets, setAssets] = useState<StudioMediaAsset[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Image Studio (Nano Banana 2.1)
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgAspect, setImgAspect] = useState<ImageAspectRatio>("9:16");
  const [imgSize, setImgSize] = useState<ImageResolution>("1K");
  const [imgSearchGround, setImgSearchGround] = useState(false);
  const [imgRef, setImgRef] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const [isGenImage, setIsGenImage] = useState(false);

  // Video Studio (Omni 1.2 Flash)
  const [vidPrompt, setVidPrompt] = useState("");
  const [vidAspect, setVidAspect] = useState<VideoAspectRatio>("9:16");
  const [vidDuration, setVidDuration] = useState<VideoDurationOption>("8s");
  const [vidRes, setVidRes] = useState<VideoResolutionOption>("720p");
  const [vidRefImg, setVidRefImg] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const [isGenVideo, setIsGenVideo] = useState(false);

  // Audio Transcribe (Gemini 3.5 Transcribe) + Search Grounding
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptText, setTranscriptText] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchSummary, setSearchSummary] = useState("");
  const [searchSources, setSearchSources] = useState<GroundedSource[]>([]);

  useEffect(() => {
    fetch("/api/studio/assets")
      .then((r) => r.json())
      .then((d) => setAssets(d.assets ?? []))
      .catch(() => {});
  }, []);

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await readFileAsBase64(file);
      setImgRef({ ...parsed, preview: `data:${parsed.mimeType};base64,${parsed.base64}` });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "خطا در بارگذاری تصویر");
    }
  };

  const handleVideoRefFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await readFileAsBase64(file);
      setVidRefImg({ ...parsed, preview: `data:${parsed.mimeType};base64,${parsed.base64}` });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "خطا در بارگذاری فریم مرجع");
    }
  };

  const handleGenerateImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imgPrompt.trim()) {
      setErrorMsg("لطفاً توضیح یا دستور ویرایش تصویر را بنویسید.");
      return;
    }
    setIsGenImage(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/studio/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: imgPrompt.trim(),
          aspectRatio: imgAspect,
          imageSize: imgSize,
          imageBase64: imgRef?.base64,
          mimeType: imgRef?.mimeType,
          useSearchGrounding: imgSearchGround,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "تولید تصویر ناموفق بود.");
      const created = data.asset as StudioMediaAsset;
      setAssets((prev) => [created, ...prev]);
      if (userUid) await onSyncAssetToCloud(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "خطا در تولید تصویر");
    } finally {
      setIsGenImage(false);
    }
  };

  const handleGenerateVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vidPrompt.trim()) {
      setErrorMsg("لطفاً توضیح صحنه یا حرکت ویدیو را وارد کنید.");
      return;
    }
    setIsGenVideo(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/studio/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: vidPrompt.trim(),
          aspectRatio: vidAspect,
          duration: vidDuration,
          resolution: vidRes,
          imageBase64: vidRefImg?.base64,
          mimeType: vidRefImg?.mimeType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ساخت ویدیو ناموفق بود.");
      const created = data.asset as StudioMediaAsset;
      setAssets((prev) => [created, ...prev]);
      if (userUid) await onSyncAssetToCloud(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "خطا در تولید ویدیو");
    } finally {
      setIsGenVideo(false);
    }
  };

  const handleAnimateExistingImage = async (asset: StudioMediaAsset) => {
    if (!asset.mediaUrl) return;
    try {
      const data = await fetchMediaUrlAsBase64(asset.mediaUrl);
      setVidRefImg({ ...data, preview: asset.mediaUrl });
      setVidPrompt((prev) => prev || `متحرک‌سازی سینمایی صحنه: ${asset.title}`);
      setSubTab("video");
    } catch {
      setErrorMsg("امکان بارگذاری تصویر برای متحرک‌سازی وجود نداشت.");
    }
  };

  const handleStartRecording = async () => {
    setErrorMsg(null);
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
        const file = new File([blob], "recording.webm", { type: mimeType });
        await submitAudioFile(file);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setErrorMsg("دسترسی به میکروفون در مرورگر تایید نشد یا در دسترس نیست.");
    }
  };

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const submitAudioFile = async (file: File) => {
    setIsTranscribing(true);
    setErrorMsg(null);
    try {
      const parsed = await readFileAsBase64(file);
      const res = await fetch("/api/studio/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: parsed.base64,
          mimeType: parsed.mimeType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "پیاده‌سازی صوت ناموفق بود.");
      setTranscriptText(data.transcript || "");
      if (data.asset) {
        const created = data.asset as StudioMediaAsset;
        setAssets((prev) => [created, ...prev]);
        if (userUid) await onSyncAssetToCloud(created);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "خطا در رونویسی صوت");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await submitAudioFile(file);
  };

  const handleGroundedSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/studio/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "جستجوی وب ناموفق بود.");
      setSearchSummary(data.summary || "");
      setSearchSources(data.sources || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "خطا در جستجوی وب");
    } finally {
      setIsSearching(false);
    }
  };

  const handleDeleteAsset = async (id: string) => {
    await fetch(`/api/studio/assets/${id}`, { method: "DELETE" });
    setAssets((prev) => prev.filter((a) => a.id !== id));
    if (userUid) {
      await onDeleteCloudAsset(id).catch(() => {});
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262B38] pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-100">ساخت تصویر، ویدیو و پیش‌نمایش سه‌بعدی</h1>
          <p className="mt-1 text-xs text-slate-400">
            ساخت یا ویرایش عکس، تبدیل متن و عکس به ویدیو، تبدیل ویس به متن و چیدمان نور و دوربین سه‌بعدی
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#14171F] p-1">
          {[
            { id: "image", label: "تصویر و ویرایش", icon: ImageIcon },
            { id: "video", label: "ساخت ویدیو", icon: Film },
            { id: "audio_search", label: "صدا و جستجو", icon: Mic },
            { id: "scene3d", label: "صحنه سه‌بعدی", icon: Box },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id as StudioSubTab)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  subTab === tab.id
                    ? "bg-amber-500 text-slate-950"
                    : "text-slate-300 hover:bg-[#1B1F2A]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          {errorMsg}
        </div>
      )}

      {subTab === "scene3d" && <ThreeSceneView project={activeProject} />}

      {subTab === "image" && (
        <form onSubmit={handleGenerateImage} className="space-y-5 rounded-xl border border-[#262B38] bg-[#14171F] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-amber-400">ساخت و ویرایش تصویر هوشمند</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                بدون عکس مرجع: ساخت تصویر جدید از متن · با عکس مرجع: تغییر و ویرایش عکس خودتان
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-300 hover:border-amber-500/50">
              <Upload className="h-3.5 w-3.5 text-amber-400" />
              <span>{imgRef ? "تغییر تصویر برای ویرایش" : "بارگذاری تصویر جهت ویرایش"}</span>
              <input type="file" accept="image/*" onChange={handleImageFileChange} className="hidden" />
            </label>
          </div>

          {imgRef && (
            <div className="flex items-center gap-4 rounded-lg border border-amber-500/30 bg-[#0B0D11] p-3">
              <img src={imgRef.preview} alt="تصویر مرجع" className="h-16 w-16 rounded object-cover" />
              <div className="flex-1 text-xs text-slate-300">حالت ویرایش تصویر فعال است — تغییرات مدنظر را در دستور زیر بنویسید.</div>
              <button
                type="button"
                onClick={() => setImgRef(null)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                حذف تصویر مرجع
              </button>
            </div>
          )}

          <textarea
            rows={3}
            value={imgPrompt}
            onChange={(e) => setImgPrompt(e.target.value)}
            placeholder="مثلاً: یک استودیوی تولید محتوای مدرن با نورپردازی گرم کهربایی، لنز سینمایی و عمق میدان کم..."
            className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs text-slate-400">نسبت تصویر</label>
              <select
                value={imgAspect}
                onChange={(e) => setImgAspect(e.target.value as ImageAspectRatio)}
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100"
              >
                <option value="9:16">عمودی ریلز/شورتس (9:16)</option>
                <option value="16:9">افقی سینمایی (16:9)</option>
                <option value="1:1">مربعی (1:1)</option>
                <option value="3:4">پرتره (3:4)</option>
                <option value="4:3">کلاسیک (4:3)</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-slate-400">کیفیت خروجی</label>
              <select
                value={imgSize}
                onChange={(e) => setImgSize(e.target.value as ImageResolution)}
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100"
              >
                <option value="1K">1K استاندارد</option>
                <option value="2K">2K باکیفیت</option>
                <option value="4K">4K فوق‌العاده</option>
              </select>
            </div>
            <label className="flex items-center gap-2 self-end rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={imgSearchGround}
                disabled={Boolean(imgRef)}
                onChange={(e) => setImgSearchGround(e.target.checked)}
                className="accent-amber-500"
              />
              <span>اتصال به جستجوی وب و تصویر گوگل</span>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isGenImage}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
            >
              <Wand2 className="h-4 w-4" />
              <span>{isGenImage ? "در حال رندر تصویر..." : imgRef ? "اجرای ویرایش تصویر" : "تولید تصویر"}</span>
            </button>
          </div>
        </form>
      )}

      {subTab === "video" && (
        <form onSubmit={handleGenerateVideo} className="space-y-5 rounded-xl border border-[#262B38] bg-[#14171F] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-amber-400">ساخت ویدیو و متحرک‌سازی تصویر</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                با متن بنویسید تا ویدیو بسازیم، یا یک عکس بدهید تا آن را به حرکت دربیاوریم
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-300 hover:border-amber-500/50">
              <Upload className="h-3.5 w-3.5 text-amber-400" />
              <span>{vidRefImg ? "تغییر فریم آغازین" : "بارگذاری تصویر برای متحرک‌سازی"}</span>
              <input type="file" accept="image/*" onChange={handleVideoRefFileChange} className="hidden" />
            </label>
          </div>

          {vidRefImg && (
            <div className="flex items-center gap-4 rounded-lg border border-amber-500/30 bg-[#0B0D11] p-3">
              <img src={vidRefImg.preview} alt="فریم مرجع ویدیو" className="h-16 w-16 rounded object-cover" />
              <div className="flex-1 text-xs text-slate-300">حالت متحرک‌سازی عکس فعال است — حرکت مورد نظرتان را بنویسید.</div>
              <button
                type="button"
                onClick={() => setVidRefImg(null)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                حذف فریم
              </button>
            </div>
          )}

          <textarea
            rows={3}
            value={vidPrompt}
            onChange={(e) => setVidPrompt(e.target.value)}
            placeholder="مثلاً: حرکت نرم دوربین روی ریل رو به جلو به سمت سوژه در استودیوی کم‌نور با تابش نور طلایی گرم..."
            className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs text-slate-400">نسبت تصویر ویدیو</label>
              <select
                value={vidAspect}
                onChange={(e) => setVidAspect(e.target.value as VideoAspectRatio)}
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100"
              >
                <option value="9:16">عمودی (9:16)</option>
                <option value="16:9">افقی (16:9)</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-slate-400">مدت زمان</label>
              <select
                value={vidDuration}
                onChange={(e) => setVidDuration(e.target.value as VideoDurationOption)}
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100"
              >
                <option value="5s">۵ ثانیه</option>
                <option value="8s">۸ ثانیه</option>
                <option value="10s">۱۰ ثانیه</option>
                <option value="15s">۱۵ ثانیه</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-slate-400">وضوح</label>
              <select
                value={vidRes}
                onChange={(e) => setVidRes(e.target.value as VideoResolutionOption)}
                className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2 text-xs text-slate-100"
              >
                <option value="720p">720p HD</option>
                <option value="1080p">1080p Full HD</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-[11px] text-slate-400">تولید ویدیو ممکن است ۱ تا ۳ دقیقه زمان ببرد.</span>
            <button
              type="submit"
              disabled={isGenVideo}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              <span>{isGenVideo ? "در حال پردازش ویدیو..." : vidRefImg ? "متحرک‌سازی تصویر" : "ساخت ویدیو"}</span>
            </button>
          </div>
        </form>
      )}

      {subTab === "audio_search" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Audio Transcription Panel */}
          <div className="space-y-4 rounded-xl border border-[#262B38] bg-[#14171F] p-6">
            <h2 className="text-sm font-semibold text-amber-400">تبدیل صدا و ویس به متن</h2>
            <p className="text-xs text-slate-400">
              ایده یا ویس خود را مستقیماً ضبط کنید یا فایل صوتی بارگذاری نمایید تا به متن دقیق تبدیل شود.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              {!isRecording ? (
                <button
                  type="button"
                  disabled={isTranscribing}
                  onClick={handleStartRecording}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
                >
                  <Mic className="h-4 w-4" />
                  <span>شروع ضبط صدا</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStopRecording}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-400"
                >
                  <Square className="h-3.5 w-3.5" />
                  <span>توقف ضبط و رونویسی</span>
                </button>
              )}

              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#262B38] bg-[#0B0D11] px-4 py-2 text-xs text-slate-300 hover:border-amber-500/50">
                <Upload className="h-3.5 w-3.5 text-amber-400" />
                <span>بارگذاری فایل صوتی</span>
                <input type="file" accept="audio/*" onChange={handleAudioUpload} className="hidden" />
              </label>
            </div>

            {isTranscribing && (
              <div className="text-xs text-amber-400">در حال تبدیل صدای شما به متن...</div>
            )}

            <textarea
              rows={6}
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              placeholder="متن پیاده‌سازی‌شده اینجا نمایش داده می‌شود..."
              className="w-full rounded-lg border border-[#262B38] bg-[#0B0D11] px-4 py-3 text-sm leading-7 text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />

            {transcriptText.trim() && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onUseTextAsIdea(transcriptText.trim())}
                  className="rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
                >
                  استفاده به عنوان ایده پروژه جدید
                </button>
              </div>
            )}
          </div>

          {/* Grounded Google Search Panel */}
          <form onSubmit={handleGroundedSearch} className="space-y-4 rounded-xl border border-[#262B38] bg-[#14171F] p-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-400">
              <Globe className="h-4 w-4" />
              <span>پژوهش زنده وب متصل به جستجوی گوگل</span>
            </h2>
            <p className="text-xs text-slate-400">
              قبل یا حین تولید محتوا، آمار روز، منابع معتبر و ترندهای وب را با استناد به لینک‌های واقعی استخراج کنید.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="موضوع پژوهش خود را بنویسید..."
                className="flex-1 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
              >
                {isSearching ? "در حال جستجو..." : "جستجو"}
              </button>
            </div>

            {searchSummary && (
              <div className="space-y-3 rounded-lg border border-[#262B38] bg-[#0B0D11] p-4">
                <p className="whitespace-pre-wrap text-xs leading-7 text-slate-200">{searchSummary}</p>
                {searchSources.length > 0 && (
                  <div className="space-y-1 border-t border-[#262B38] pt-3">
                    <div className="text-[11px] font-semibold text-amber-400">منابع وب استخراج‌شده:</div>
                    {searchSources.map((src) => (
                      <a
                        key={src.uri}
                        href={src.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-[11px] text-sky-400 hover:underline"
                      >
                        {src.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
      )}

      {/* Assets Gallery */}
      <div className="space-y-3 border-t border-[#262B38] pt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">گالری خروجی‌های استودیو</h3>
          <span className="font-mono-tabular text-xs text-slate-400">{assets.length} آیتم</span>
        </div>

        {assets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#262B38] p-8 text-center text-xs text-slate-500">
            هنوز تصویر، ویدیو یا رونویسی صوتی در آزمایشگاه ساخته نشده است.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => (
              <div key={asset.id} className="flex flex-col justify-between rounded-xl border border-[#262B38] bg-[#14171F] p-4">
                <div className="space-y-3">
                  {asset.kind === "image" && asset.mediaUrl && (
                    <img
                      src={asset.mediaUrl}
                      alt={asset.title}
                      className="h-52 w-full rounded-lg border border-[#262B38] bg-[#0B0D11] object-cover"
                    />
                  )}
                  {asset.kind === "video" && asset.mediaUrl && (
                    <video
                      src={asset.mediaUrl}
                      controls
                      className="h-52 w-full rounded-lg border border-[#262B38] bg-black object-contain"
                    />
                  )}
                  {asset.kind === "transcript" && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-[#262B38] bg-[#0B0D11] p-3 text-xs leading-6 text-slate-200">
                      {asset.transcriptText}
                    </div>
                  )}

                  <div>
                    <div className="truncate text-xs font-semibold text-slate-100">{asset.title}</div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {asset.kind === "image"
                        ? "تصویر ساخته‌شده"
                        : asset.kind === "video"
                          ? "ویدیو ساخته‌شده"
                          : "متن تبدیل‌شده از صدا"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-[#262B38] pt-3">
                  <div className="flex items-center gap-2">
                    {asset.mediaUrl && (
                      <a
                        href={asset.mediaUrl}
                        download
                        className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>دانلود</span>
                      </a>
                    )}
                    {asset.kind === "image" && asset.mediaUrl && (
                      <button
                        type="button"
                        onClick={() => handleAnimateExistingImage(asset)}
                        className="text-[11px] text-sky-400 hover:text-sky-300"
                      >
                        متحرک‌سازی
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteAsset(asset.id)}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>حذف</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
