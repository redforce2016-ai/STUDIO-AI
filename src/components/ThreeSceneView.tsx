import { useEffect, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronUp, RotateCw, Sun } from "lucide-react";
import {
  initStudioRigScene,
  type CameraPresetId,
  type LightingMoodId,
  type StudioRigController,
} from "../three/studioRigScene";
import type { ProjectRecord } from "../types/studio";

interface ThreeSceneViewProps {
  project: ProjectRecord | null;
}

export function ThreeSceneView({ project }: ThreeSceneViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<StudioRigController | null>(null);

  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>("overview");
  const [lightingMood, setLightingMood] = useState<LightingMoodId>("amberCinema");
  const [dollyValue, setDollyValue] = useState(0.5);
  const [autoTurn, setAutoTurn] = useState(true);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [selectedShotIdx, setSelectedShotIdx] = useState(0);
  const [contextLost, setContextLost] = useState(false);

  const shots = project?.director?.shots ?? [];
  const activeShot = shots[selectedShotIdx] ?? null;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const controller = initStudioRigScene(
      container,
      {
        shotLabel: activeShot
          ? `SHOT 0${activeShot.shotNumber} · ${activeShot.timecode}`
          : "STUDIO STAGE · 9:16",
        cameraAngle: activeShot?.cameraAngle || "MEDIUM HERO FRAMING",
        onScreenText: activeShot?.onScreenText || project?.brief.title || "استودیو محتوا",
      },
      setContextLost
    );
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // Initialize WebGL scene once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.updateHudTexture({
      shotLabel: activeShot
        ? `SHOT 0${activeShot.shotNumber} · ${activeShot.timecode}`
        : "STUDIO STAGE · 9:16",
      cameraAngle: activeShot?.cameraAngle || "MEDIUM HERO FRAMING",
      onScreenText: activeShot?.onScreenText || project?.brief.title || "استودیو محتوا",
    });
  }, [activeShot, project?.brief.title]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "h") {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handlePreset = (preset: CameraPresetId) => {
    setCameraPreset(preset);
    controllerRef.current?.setCameraPreset(preset);
  };

  const handleMood = (mood: LightingMoodId) => {
    setLightingMood(mood);
    controllerRef.current?.setLightingMood(mood);
  };

  const handleDolly = (val: number) => {
    setDollyValue(val);
    controllerRef.current?.setDollyProgress(val);
  };

  const handleToggleTurn = () => {
    const next = !autoTurn;
    setAutoTurn(next);
    controllerRef.current?.setAutoTurn(next);
  };

  return (
    <div className="relative h-[calc(100vh-118px)] min-h-[560px] w-full overflow-hidden rounded-xl border border-[#262B38] bg-[#0B0D11]">
      {/* Isolated Empty WebGL Canvas Container */}
      <div ref={mountRef} className="h-full w-full" />

      {/* Minimal Top-Right Spec Overlay (No backdrop-filter over WebGL) */}
      <div className="pointer-events-none absolute top-4 right-4 z-10 rounded-lg border border-[#262B38] bg-[#14171F]/90 px-4 py-2.5">
        <div className="text-xs font-semibold text-amber-400">
          پیش‌نمایش سه‌بعدی دکوپاژ و ریگ دوربین (Three.js PBR)
        </div>
        <div className="mt-0.5 text-[11px] text-slate-300">
          {project
            ? `${project.brief.title}${activeShot ? ` · شات ${activeShot.shotNumber}` : ""}`
            : "درگ برای چرخش دوربین · اسکرول برای بزرگنمایی"}
        </div>
      </div>

      {contextLost && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0B0D11]/95 p-6 text-center">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-amber-400">ارتباط گرافیکی WebGL موقتاً قطع شد</div>
            <p className="text-xs text-slate-400">لطفاً تب را بازسازی یا صفحه را تازه‌سازی کنید.</p>
          </div>
        </div>
      )}

      {/* Collapsible Unified Bottom Control Dock */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 z-10 w-[min(900px,94%)] -translate-x-1/2">
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setDockCollapsed((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 border-[#262B38] bg-[#14171F]/95 px-3 py-1 text-[11px] font-medium text-slate-300 hover:text-amber-400"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span>نمایش کنترل‌های صحنه (H)</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>مخفی کردن کنترل‌ها (H)</span>
              </>
            )}
          </button>
        </div>

        {!dockCollapsed && (
          <div className="rounded-xl border border-[#262B38] bg-[#14171F]/95 p-3.5 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Camera Angles */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
                  <Camera className="h-3.5 w-3.5 text-amber-400" />
                  <span>زاویه:</span>
                </span>
                {[
                  { id: "overview", label: "نمای کل" },
                  { id: "pov916", label: "لنز ۹:۱۶" },
                  { id: "dollyClose", label: "ریل دوربین" },
                  { id: "topDown", label: "بالا" },
                ].map((cam) => (
                  <button
                    key={cam.id}
                    type="button"
                    onClick={() => handlePreset(cam.id as CameraPresetId)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      cameraPreset === cam.id
                        ? "bg-amber-500 text-slate-950"
                        : "border border-[#262B38] bg-[#0B0D11] text-slate-300 hover:text-white"
                    }`}
                  >
                    {cam.label}
                  </button>
                ))}
              </div>

              {/* Lighting Moods */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                  <span>نور:</span>
                </span>
                {[
                  { id: "amberCinema", label: "سینمایی" },
                  { id: "daylightStudio", label: "نور روز" },
                  { id: "cyberNeon", label: "نئون" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleMood(m.id as LightingMoodId)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      lightingMood === m.id
                        ? "border border-amber-500/70 bg-[#1B1F2A] text-amber-400"
                        : "border border-[#262B38] bg-[#0B0D11] text-slate-300 hover:text-white"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Dolly Rail Slider + Turntable Toggle */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[11px] text-slate-300">
                  <span>حرکت ریل</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={dollyValue}
                    onChange={(e) => handleDolly(Number(e.target.value))}
                    className="h-1.5 w-24 accent-amber-500"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleToggleTurn}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    autoTurn
                      ? "border border-amber-500/60 bg-amber-500/15 text-amber-300"
                      : "border border-[#262B38] bg-[#0B0D11] text-slate-400"
                  }`}
                >
                  <RotateCw className="h-3 w-3" />
                  <span>چرخش سوژه</span>
                </button>
              </div>
            </div>

            {shots.length > 0 && (
              <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto border-t border-[#262B38] pt-2">
                <span className="shrink-0 text-[11px] text-slate-400">نمایش شات روی مانیتور صحنه:</span>
                {shots.map((shot, idx) => (
                  <button
                    key={shot.shotNumber}
                    type="button"
                    onClick={() => setSelectedShotIdx(idx)}
                    className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-mono-tabular transition-colors ${
                      selectedShotIdx === idx
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/50"
                        : "bg-[#0B0D11] text-slate-400 border border-[#262B38] hover:text-slate-200"
                    }`}
                  >
                    شات {shot.shotNumber}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
