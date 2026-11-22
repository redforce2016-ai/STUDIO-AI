import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Camera, RotateCcw, SunMedium } from "lucide-react";
import type { ProjectRecord } from "../types/studio";

interface ThreeSceneViewProps {
  project: ProjectRecord;
}

type CameraPreset = "wide_dolly" | "low_hero" | "macro_detail" | "top_tracking";
type LightingPreset = "industrial_amber" | "foundry_glow" | "studio_neutral";

const CAMERA_PRESETS: Record<
  CameraPreset,
  { labelFa: string; position: [number, number, number]; lookAt: [number, number, number] }
> = {
  wide_dolly: {
    labelFa: "دالی واید صنعتی",
    position: [4.2, 2.2, 5.4],
    lookAt: [0, 0.2, 0],
  },
  low_hero: {
    labelFa: "زاویه پایین قهرمانی",
    position: [2.6, -0.35, 3.8],
    lookAt: [0, 0.5, 0],
  },
  macro_detail: {
    labelFa: "ماکرو جزئیات سطح",
    position: [1.8, 0.7, 2.1],
    lookAt: [0, 0.1, 0],
  },
  top_tracking: {
    labelFa: "ترکینگ بالاسری",
    position: [0.4, 5.2, 3.0],
    lookAt: [0, 0, 0],
  },
};

export function ThreeSceneView({ project }: ThreeSceneViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const shots = project.director?.shots ?? [];
  const [selectedShotNum, setSelectedShotNum] = useState<number>(
    shots[0]?.shotNumber ?? 1
  );
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("wide_dolly");
  const [lightingPreset, setLightingPreset] =
    useState<LightingPreset>("industrial_amber");
  const [autoOrbit, setAutoOrbit] = useState(true);

  const selectedShot =
    shots.find((s) => s.shotNumber === selectedShotNum) ?? shots[0] ?? null;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 720;
    const height = 380;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(
      lightingPreset === "foundry_glow"
        ? 0x120b09
        : lightingPreset === "studio_neutral"
          ? 0x10141c
          : 0x0b0e14
    );
    scene.fog = new THREE.FogExp2(scene.background.getHex(), 0.08);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    const preset = CAMERA_PRESETS[cameraPreset];
    camera.position.set(...preset.position);
    camera.lookAt(...preset.lookAt);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Industrial floor grid
    const grid = new THREE.GridHelper(16, 24, 0x334155, 0x1e293b);
    grid.position.y = -1.1;
    scene.add(grid);

    // Hero industrial steel pipe / billet assembly
    const group = new THREE.Group();
    const pipeGeo = new THREE.CylinderGeometry(0.62, 0.62, 4.4, 48, 1, true);
    const steelMat = new THREE.MeshStandardMaterial({
      color: lightingPreset === "foundry_glow" ? 0xd97706 : 0x94a3b8,
      metalness: 0.86,
      roughness: 0.28,
      side: THREE.DoubleSide,
    });
    const pipeMesh = new THREE.Mesh(pipeGeo, steelMat);
    pipeMesh.rotation.z = Math.PI / 2;
    group.add(pipeMesh);

    // Inner glowing core representing hot seamless billet / mandrel
    const innerGeo = new THREE.CylinderGeometry(0.42, 0.42, 4.45, 36);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: lightingPreset === "studio_neutral" ? 0x38bdf8 : 0xea580c,
      emissiveIntensity: lightingPreset === "foundry_glow" ? 1.8 : 0.75,
      metalness: 0.35,
      roughness: 0.4,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.rotation.z = Math.PI / 2;
    group.add(innerMesh);

    // Dual conical industrial rollers
    const rollerGeo = new THREE.CylinderGeometry(0.32, 0.46, 1.35, 32);
    const rollerMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.9,
      roughness: 0.32,
    });
    const rollerTop = new THREE.Mesh(rollerGeo, rollerMat);
    rollerTop.position.set(0, 1.05, 0.35);
    rollerTop.rotation.x = Math.PI / 2.2;
    rollerTop.rotation.z = 0.22;
    group.add(rollerTop);

    const rollerBottom = new THREE.Mesh(rollerGeo, rollerMat);
    rollerBottom.position.set(0, -1.05, -0.35);
    rollerBottom.rotation.x = Math.PI / 2.2;
    rollerBottom.rotation.z = -0.22;
    group.add(rollerBottom);

    scene.add(group);

    // Three-point studio lighting
    const ambient = new THREE.AmbientLight(0x94a3b8, 0.55);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(
      lightingPreset === "foundry_glow"
        ? 0xff8c42
        : lightingPreset === "studio_neutral"
          ? 0xf8fafc
          : 0xfbbf24,
      2.4
    );
    keyLight.position.set(4, 5, 4);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(
      lightingPreset === "foundry_glow" ? 0xf97316 : 0x38bdf8,
      2.0,
      14
    );
    rimLight.position.set(-4, 2.5, -3);
    scene.add(rimLight);

    let rafId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      const t = clock.getElapsedTime();
      pipeMesh.rotation.x = t * 0.45;
      rollerTop.rotation.y = t * 1.4;
      rollerBottom.rotation.y = -t * 1.4;

      if (autoOrbit) {
        const radius = Math.hypot(preset.position[0], preset.position[2]);
        const baseAngle = Math.atan2(preset.position[2], preset.position[0]);
        const angle = baseAngle + Math.sin(t * 0.35) * 0.42;
        camera.position.x = Math.cos(angle) * radius;
        camera.position.z = Math.sin(angle) * radius;
        camera.position.y = preset.position[1] + Math.sin(t * 0.5) * 0.14;
        camera.lookAt(...preset.lookAt);
      }

      renderer.render(scene, camera);
      rafId = window.requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const nextW = container.clientWidth || 720;
      camera.aspect = nextW / height;
      camera.updateProjectionMatrix();
      renderer.setSize(nextW, height);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleResize);
      pipeGeo.dispose();
      steelMat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      rollerGeo.dispose();
      rollerMat.dispose();
      renderer.dispose();
    };
  }, [cameraPreset, lightingPreset, autoOrbit]);

  return (
    <div className="rounded-xl border border-[#262B38] bg-[#14171F] p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262B38] pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300">
            <Camera className="h-4 w-4" />
            <span>پیش‌نمایش دوربین و نورپردازی سه‌بعدی (Three.js)</span>
          </span>
          {shots.length > 0 && (
            <select
              value={selectedShotNum}
              onChange={(e) => setSelectedShotNum(Number(e.target.value))}
              className="rounded-lg border border-[#262B38] bg-[#0B0D11] px-2.5 py-1 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
            >
              {shots.map((s) => (
                <option key={s.shotNumber} value={s.shotNumber}>
                  شات {String(s.shotNumber).padStart(2, "0")} — {s.cameraAngle}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setCameraPreset(key)}
              className={`rounded-lg px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                cameraPreset === key
                  ? "bg-amber-500 text-slate-950 font-semibold"
                  : "border border-[#262B38] bg-[#0B0D11] text-slate-300 hover:text-white"
              }`}
            >
              {CAMERA_PRESETS[key].labelFa}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={mountRef}
        className="w-full overflow-hidden rounded-xl border border-[#262B38] bg-[#0B0D11]"
        style={{ height: 380 }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <SunMedium className="h-4 w-4 text-amber-400" />
          <span className="text-slate-400">نورپردازی صحنه:</span>
          {(
            [
              { id: "industrial_amber", label: "صنعتی تیل-کهربایی" },
              { id: "foundry_glow", label: "کوره مذاب گرم" },
              { id: "studio_neutral", label: "استودیویی خنثی" },
            ] as const
          ).map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLightingPreset(l.id)}
              className={`rounded-lg px-2.5 py-1 font-medium whitespace-nowrap shrink-0 ${
                lightingPreset === l.id
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "border border-[#262B38] bg-[#0B0D11] text-slate-400 hover:text-slate-200"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setAutoOrbit((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#262B38] bg-[#0B0D11] px-3 py-1.5 text-slate-300 hover:text-white whitespace-nowrap shrink-0"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>{autoOrbit ? "توقف حرکت دوربین" : "شروع حرکت دالی دوربین"}</span>
        </button>
      </div>

      {selectedShot && (
        <div className="rounded-lg border border-[#262B38] bg-[#0B0D11] p-3 text-xs text-slate-300 leading-6">
          <span className="font-semibold text-amber-300">
            دکوپاژ شات {String(selectedShot.shotNumber).padStart(2, "0")}:{" "}
          </span>
          {selectedShot.sceneDescriptionFa}
          <span className="text-slate-500"> · </span>
          <span className="text-sky-300">
            حرکت دوربین: {selectedShot.cameraMovement}
          </span>
        </div>
      )}
    </div>
  );
}
