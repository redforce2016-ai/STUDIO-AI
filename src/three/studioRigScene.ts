import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

export type CameraPresetId = "overview" | "pov916" | "dollyClose" | "topDown";
export type LightingMoodId = "amberCinema" | "daylightStudio" | "cyberNeon";

export interface StudioSceneSnapshot {
  shotLabel: string;
  cameraAngle: string;
  onScreenText: string;
}

export interface StudioRigController {
  setCameraPreset: (preset: CameraPresetId) => void;
  setLightingMood: (mood: LightingMoodId) => void;
  setDollyProgress: (t: number) => void;
  setAutoTurn: (enabled: boolean) => void;
  updateHudTexture: (info: StudioSceneSnapshot) => void;
  dispose: () => void;
}

// Pre-allocated scratch math vectors (zero GC allocations during animation)
const _camTargetPos = new THREE.Vector3(6.8, 3.8, 7.6);
const _camTargetLook = new THREE.Vector3(0, 1.45, 0);

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { pos: [number, number, number]; look: [number, number, number] }
> = {
  overview: { pos: [6.8, 3.8, 7.6], look: [0, 1.35, 0] },
  pov916: { pos: [0.05, 1.65, 3.85], look: [0, 1.65, -2.4] },
  dollyClose: { pos: [2.6, 1.85, 3.2], look: [0.1, 1.25, 1.9] },
  topDown: { pos: [0.2, 9.2, 2.2], look: [0, 0.5, 0] },
};

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement("canvas");
    const gl = probeCanvas.getContext("webgl2");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createFloorGridTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#11151d";
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle tile subdivisions
  ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 1024; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1024);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i);
    ctx.stroke();
  }

  // Primary amber stage grid lines
  ctx.strokeStyle = "rgba(245, 158, 11, 0.22)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 256) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1024);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i);
    ctx.stroke();
  }

  // Center stage measurement ring
  ctx.strokeStyle = "rgba(245, 158, 11, 0.36)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(512, 512, 180, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = maxAniso;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 126);
  grad.addColorStop(0, "rgba(0, 0, 0, 0.85)");
  grad.addColorStop(0.5, "rgba(0, 0, 0, 0.35)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawViewfinderCanvas(
  canvas: HTMLCanvasElement,
  info: StudioSceneSnapshot
): void {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#101622");
  grad.addColorStop(0.55, "#191e2b");
  grad.addColorStop(1, "#0b0d11");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Warm studio glow
  const radial = ctx.createRadialGradient(w * 0.5, h * 0.42, 10, w * 0.5, h * 0.42, w * 0.7);
  radial.addColorStop(0, "rgba(245, 158, 11, 0.28)");
  radial.addColorStop(1, "rgba(245, 158, 11, 0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, w, h);

  // Rule of thirds guides
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  for (const x of [w / 3, (2 * w) / 3]) {
    ctx.beginPath();
    ctx.moveTo(x, 24);
    ctx.lineTo(x, h - 24);
    ctx.stroke();
  }
  for (const y of [h / 3, (2 * h) / 3]) {
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(w - 20, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Amber frame corners
  ctx.strokeStyle = "#F59E0B";
  ctx.lineWidth = 3;
  const pad = 22;
  const corner = 24;
  ctx.beginPath();
  ctx.moveTo(pad, pad + corner);
  ctx.lineTo(pad, pad);
  ctx.lineTo(pad + corner, pad);
  ctx.moveTo(w - pad - corner, pad);
  ctx.lineTo(w - pad, pad);
  ctx.lineTo(w - pad, pad + corner);
  ctx.moveTo(pad, h - pad - corner);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(pad + corner, h - pad);
  ctx.moveTo(w - pad - corner, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.lineTo(w - pad, h - pad - corner);
  ctx.stroke();

  // Telemetry text
  ctx.fillStyle = "#F59E0B";
  ctx.font = "600 18px monospace";
  ctx.textAlign = "left";
  ctx.fillText("REC 9:16  |  4K 60FPS", 34, 52);

  ctx.fillStyle = "#E2E8F0";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(info.shotLabel || "SHOT 01 · STUDIO RIG", w / 2, h * 0.48);

  ctx.fillStyle = "#94A3B8";
  ctx.font = "16px sans-serif";
  ctx.fillText(info.cameraAngle || "MEDIUM HERO FRAMING", w / 2, h * 0.56);

  if (info.onScreenText) {
    ctx.fillStyle = "rgba(245, 158, 11, 0.9)";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(info.onScreenText.slice(0, 32), w / 2, h - 54);
  }
}

export function initStudioRigScene(
  container: HTMLElement,
  initialInfo: StudioSceneSnapshot,
  onContextLossChange?: (lost: boolean) => void
): StudioRigController {
  const isSoftwareGl = detectSoftwareWebGL();
  const width = container.clientWidth || 960;
  const height = container.clientHeight || 600;

  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d11);
  scene.fog = new THREE.FogExp2(0x0b0d11, 0.032);

  // Mandatory Studio Environment Reflection
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
  scene.environment = envTarget.texture;
  roomEnv.dispose();
  pmremGenerator.dispose();

  const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 80);
  camera.position.set(...CAMERA_PRESETS.overview.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...CAMERA_PRESETS.overview.look);
  controls.enableDamping = !isSoftwareGl;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.485;
  controls.minDistance = 2.0;
  controls.maxDistance = 18;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.65;

  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Disposable trackers
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  // Materials Library (varied roughness >= 0.25 & metalness between adjacent parts)
  const matteCarbonMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x161a22,
      roughness: 0.78,
      metalness: 0.15,
    })
  );
  const darkAnodizedMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x222834,
      roughness: 0.42,
      metalness: 0.85,
    })
  );
  const brushedSteelMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xb8c2d0,
      roughness: 0.18,
      metalness: 0.94,
      anisotropy: 0.8,
      anisotropyRotation: 0.4,
    })
  );
  const amberBrassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xf59e0b,
      roughness: 0.2,
      metalness: 0.92,
      clearcoat: 0.6,
    })
  );
  const rubberGripMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0e1015,
      roughness: 0.92,
      metalness: 0.04,
    })
  );
  const lensGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x93c5fd,
      metalness: 0.0,
      roughness: 0.06,
      transmission: isSoftwareGl ? 0 : 0.9,
      transparent: true,
      opacity: isSoftwareGl ? 0.38 : 1,
      ior: 1.55,
      thickness: 1.2,
      attenuationColor: new THREE.Color(0x3b82f6),
      clearcoat: 1.0,
    })
  );
  const softboxGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfff5e0,
      emissive: 0xffd28a,
      emissiveIntensity: 1.35,
      roughness: 0.85,
      metalness: 0.0,
    })
  );

  // Studio Floor + Contact Shadow Planes
  const floorTex = trackTex(createFloorGridTexture(maxAniso));
  const floorMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.72,
      metalness: 0.18,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
  );
  const floor = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(18, 64)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  const shadowTex = trackTex(createContactShadowTexture());
  const makeContactShadow = (radius: number, x: number, z: number) => {
    const plane = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(radius * 2, radius * 2)),
      trackMat(
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
        })
      )
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, 0.02, z);
    scene.add(plane);
    return plane;
  };

  // =========================================================
  // 1. COMPOSITE HERO MODEL A: Stage Set + 9:16 LED Backdrop + Turntable Totem (8 parts)
  // =========================================================
  const stageSetGroup = new THREE.Group();
  stageSetGroup.position.set(0, 0, -1.6);

  // Part 1: Lathe sculpted studio plinth
  const plinthPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(1.9, 0.0),
    new THREE.Vector2(1.82, 0.14),
    new THREE.Vector2(1.62, 0.22),
    new THREE.Vector2(1.58, 0.28),
    new THREE.Vector2(0.0, 0.28),
  ];
  const plinth = new THREE.Mesh(trackGeo(new THREE.LatheGeometry(plinthPoints, 48)), matteCarbonMat);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  stageSetGroup.add(plinth);

  // Part 2: Brushed amber trim ring around plinth
  const plinthRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(1.72, 0.032, 16, 64)),
    amberBrassMat
  );
  plinthRing.rotation.x = Math.PI / 2;
  plinthRing.position.y = 0.22;
  stageSetGroup.add(plinthRing);

  // Part 3 & 4: Vertical 9:16 LED framing wall + screen
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 512;
  screenCanvas.height = 910;
  drawViewfinderCanvas(screenCanvas, initialInfo);
  const screenTex = trackTex(new THREE.CanvasTexture(screenCanvas));
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = maxAniso;

  const ledFrameShape = new THREE.Shape();
  ledFrameShape.moveTo(-1.12, 0);
  ledFrameShape.lineTo(1.12, 0);
  ledFrameShape.lineTo(1.12, 3.65);
  ledFrameShape.lineTo(-1.12, 3.65);
  ledFrameShape.closePath();

  const ledFrameGeo = trackGeo(
    new THREE.ExtrudeGeometry(ledFrameShape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 2,
    })
  );
  ledFrameGeo.computeTangents();
  const ledFrame = new THREE.Mesh(ledFrameGeo, darkAnodizedMat);
  ledFrame.position.set(0, 0.28, -0.78);
  ledFrame.castShadow = true;
  stageSetGroup.add(ledFrame);

  const ledScreen = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(1.94, 3.42)),
    trackMat(
      new THREE.MeshStandardMaterial({
        map: screenTex,
        emissiveMap: screenTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.55,
        roughness: 0.22,
        metalness: 0.05,
      })
    )
  );
  ledScreen.position.set(0, 2.1, -0.62);
  stageSetGroup.add(ledScreen);

  // Part 5..8: Hero Centerpiece Rotating Reel & Clapper Sculpture on Plinth
  const heroTurnGroup = new THREE.Group();
  heroTurnGroup.position.set(0, 0.28, 0.2);

  const pedestalStem = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.18, 0.34, 0.72, 32)),
    brushedSteelMat
  );
  pedestalStem.position.y = 0.36;
  pedestalStem.castShadow = true;
  heroTurnGroup.add(pedestalStem);

  const clapperShape = new THREE.Shape();
  clapperShape.moveTo(-0.55, 0);
  clapperShape.lineTo(0.55, 0);
  clapperShape.lineTo(0.55, 0.76);
  clapperShape.lineTo(-0.55, 0.76);
  clapperShape.closePath();
  const clapperGeo = trackGeo(
    new THREE.ExtrudeGeometry(clapperShape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
    })
  );
  const clapperBody = new THREE.Mesh(clapperGeo, matteCarbonMat);
  clapperBody.position.set(0, 0.74, -0.04);
  clapperBody.castShadow = true;
  heroTurnGroup.add(clapperBody);

  const clapperArm = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.14, 0.11, 0.1)),
    amberBrassMat
  );
  clapperArm.position.set(0.05, 1.62, 0);
  clapperArm.rotation.z = 0.22;
  clapperArm.castShadow = true;
  heroTurnGroup.add(clapperArm);

  const glassPrism = new THREE.Mesh(
    trackGeo(new THREE.OctahedronGeometry(0.24, 0)),
    lensGlassMat
  );
  glassPrism.position.set(0, 1.15, 0.18);
  heroTurnGroup.add(glassPrism);

  stageSetGroup.add(heroTurnGroup);
  scene.add(stageSetGroup);
  makeContactShadow(2.2, 0, -1.6);

  // =========================================================
  // 2. COMPOSITE HERO MODEL B: Dolly Track & Motorized Cinema Camera Rig (10 parts)
  // =========================================================
  const trackGroup = new THREE.Group();
  trackGroup.position.set(0, 0, 2.2);

  // Part 1 & 2: Two brushed steel dolly rails
  for (const xOffset of [-0.62, 0.62]) {
    const railCurve = new THREE.LineCurve3(
      new THREE.Vector3(xOffset, 0.09, -1.1),
      new THREE.Vector3(xOffset, 0.09, 2.3)
    );
    const rail = new THREE.Mesh(
      trackGeo(new THREE.TubeGeometry(railCurve, 8, 0.042, 16, false)),
      brushedSteelMat
    );
    rail.castShadow = true;
    trackGroup.add(rail);
  }

  // Cross ties via InstancedMesh (clean repeated sleepers)
  const tieCount = 9;
  const tieMesh = new THREE.InstancedMesh(
    trackGeo(new THREE.BoxGeometry(1.48, 0.05, 0.12)),
    rubberGripMat,
    tieCount
  );
  const tieDummy = new THREE.Object3D();
  for (let i = 0; i < tieCount; i++) {
    tieDummy.position.set(0, 0.025, -0.95 + i * 0.39);
    tieDummy.updateMatrix();
    tieMesh.setMatrixAt(i, tieDummy.matrix);
  }
  tieMesh.computeBoundingSphere();
  tieMesh.receiveShadow = true;
  trackGroup.add(tieMesh);

  // Dolly Carriage + Cinema Camera Group (moves along Z rail)
  const cameraRigGroup = new THREE.Group();
  cameraRigGroup.position.set(0, 0.11, 0.45);

  // Part 3: Beveled dolly carriage deck
  const deckShape = new THREE.Shape();
  deckShape.moveTo(-0.72, -0.58);
  deckShape.lineTo(0.72, -0.58);
  deckShape.lineTo(0.72, 0.58);
  deckShape.lineTo(-0.72, 0.58);
  deckShape.closePath();
  const deck = new THREE.Mesh(
    trackGeo(
      new THREE.ExtrudeGeometry(deckShape, {
        depth: 0.08,
        bevelEnabled: true,
        bevelThickness: 0.018,
        bevelSize: 0.018,
        bevelSegments: 2,
      })
    ),
    darkAnodizedMat
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.04;
  deck.castShadow = true;
  cameraRigGroup.add(deck);

  // Part 4: Hydraulic riser column & fluid head
  const column = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.11, 0.15, 1.05, 24)),
    brushedSteelMat
  );
  column.position.y = 0.62;
  column.castShadow = true;
  cameraRigGroup.add(column);

  const headCollar = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.2, 0.16, 0.16, 24)),
    amberBrassMat
  );
  headCollar.position.y = 1.18;
  cameraRigGroup.add(headCollar);

  // Part 5: Cinema Camera Body (ExtrudeGeometry)
  const camBodyShape = new THREE.Shape();
  camBodyShape.moveTo(-0.22, -0.2);
  camBodyShape.lineTo(0.22, -0.2);
  camBodyShape.lineTo(0.22, 0.22);
  camBodyShape.lineTo(-0.22, 0.22);
  camBodyShape.closePath();
  const camBody = new THREE.Mesh(
    trackGeo(
      new THREE.ExtrudeGeometry(camBodyShape, {
        depth: 0.62,
        bevelEnabled: true,
        bevelThickness: 0.025,
        bevelSize: 0.025,
        bevelSegments: 2,
      })
    ),
    matteCarbonMat
  );
  camBody.position.set(0, 1.48, -0.28);
  camBody.castShadow = true;
  cameraRigGroup.add(camBody);

  // Part 6: Lathe Cinema Lens Barrel
  const lensPts = [
    new THREE.Vector2(0.14, 0),
    new THREE.Vector2(0.16, 0.14),
    new THREE.Vector2(0.16, 0.24),
    new THREE.Vector2(0.18, 0.28),
    new THREE.Vector2(0.18, 0.42),
    new THREE.Vector2(0.15, 0.44),
  ];
  const lensBarrel = new THREE.Mesh(
    trackGeo(new THREE.LatheGeometry(lensPts, 32)),
    darkAnodizedMat
  );
  lensBarrel.rotation.x = -Math.PI / 2;
  lensBarrel.position.set(0, 1.48, -0.3);
  lensBarrel.castShadow = true;
  cameraRigGroup.add(lensBarrel);

  // Part 7: Optical Glass Front Element
  const frontGlass = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.14, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.45)),
    lensGlassMat
  );
  frontGlass.rotation.x = -Math.PI / 2;
  frontGlass.position.set(0, 1.48, -0.71);
  cameraRigGroup.add(frontGlass);

  // Part 8: Matte Box Hood
  const matteBox = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.5, 0.36, 0.16)),
    rubberGripMat
  );
  matteBox.position.set(0, 1.48, -0.82);
  matteBox.castShadow = true;
  cameraRigGroup.add(matteBox);

  // Part 9: Top Handle
  const topHandle = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.08, 0.07, 0.46)),
    amberBrassMat
  );
  topHandle.position.set(0, 1.82, 0.02);
  cameraRigGroup.add(topHandle);

  // Part 10: Rear Monitor displaying same 9:16 screen texture
  const rearMonitor = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(0.32, 0.52)),
    trackMat(
      new THREE.MeshBasicMaterial({
        map: screenTex,
      })
    )
  );
  rearMonitor.position.set(0.32, 1.68, 0.14);
  rearMonitor.rotation.y = -0.35;
  cameraRigGroup.add(rearMonitor);

  trackGroup.add(cameraRigGroup);
  scene.add(trackGroup);
  makeContactShadow(1.3, 0, 2.6);

  // =========================================================
  // 3. COMPOSITE HERO MODEL C: Key Light Softbox Stand (5 parts)
  // =========================================================
  const softboxGroup = new THREE.Group();
  softboxGroup.position.set(-3.3, 0, 0.8);
  softboxGroup.rotation.y = 0.72;

  const standBase = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.08, 0.65, 0.32, 3)),
    rubberGripMat
  );
  standBase.position.y = 0.16;
  standBase.castShadow = true;
  softboxGroup.add(standBase);

  const standPole = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.045, 0.06, 2.85, 16)),
    brushedSteelMat
  );
  standPole.position.y = 1.58;
  standPole.castShadow = true;
  softboxGroup.add(standPole);

  const softboxShell = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(1.35, 0.95, 0.38)),
    matteCarbonMat
  );
  softboxShell.position.set(0, 3.05, 0.12);
  softboxShell.rotation.x = 0.34;
  softboxShell.castShadow = true;
  softboxGroup.add(softboxShell);

  const softboxDiffuser = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(1.22, 0.82)),
    softboxGlowMat
  );
  softboxDiffuser.position.set(0, 2.98, 0.31);
  softboxDiffuser.rotation.x = 0.34;
  softboxGroup.add(softboxDiffuser);

  scene.add(softboxGroup);
  makeContactShadow(0.95, -3.3, 0.8);

  // =========================================================
  // Studio 3-Point Lighting + Area Softboxes
  // =========================================================
  const hemiLight = new THREE.HemisphereLight(0x8bb6ea, 0x161922, 0.72);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xffe1b5, 2.25);
  keyLight.position.set(-4.5, 6.2, 4.2);
  keyLight.castShadow = !isSoftwareGl;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 22;
  keyLight.shadow.camera.left = -7;
  keyLight.shadow.camera.right = 7;
  keyLight.shadow.camera.top = 7;
  keyLight.shadow.camera.bottom = -7;
  keyLight.shadow.bias = -0.0005;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xf59e0b, 1.35);
  rimLight.position.set(4.5, 4.8, -5.2);
  scene.add(rimLight);

  let rectAreaLight: THREE.RectAreaLight | null = null;
  if (!isSoftwareGl) {
    RectAreaLightUniformsLib.init();
    rectAreaLight = new THREE.RectAreaLight(0xffe4be, 4.2, 1.4, 1.0);
    rectAreaLight.position.set(-3.1, 2.98, 1.0);
    rectAreaLight.lookAt(0, 1.35, -1.3);
    scene.add(rectAreaLight);
  }

  if (!isSoftwareGl) {
    renderer.compile(scene, camera);
  }

  // =========================================================
  // Smooth Camera Transitions, Render-on-Demand & Software WebGL Pacing
  // =========================================================
  let frameId = 0;
  let disposed = false;
  let renderBusy = false;
  let renderDirty = false;
  let transitionActive = false;
  let autoTurn = true;
  let dollyTargetZ = 0.45;
  let lastTime = performance.now();

  const onControlsStart = () => {
    transitionActive = false;
  };
  controls.addEventListener("start", onControlsStart);
  controls.addEventListener("change", () => requestRender());

  function afterDraw(cb: () => void) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    if (!sync) {
      frameId = window.setTimeout(cb, 80);
      return;
    }
    gl.flush();
    const poll = () => {
      if (disposed) return;
      const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        frameId = window.setTimeout(poll, 5);
      } else {
        gl.deleteSync(sync);
        frameId = window.setTimeout(cb, 80);
      }
    };
    frameId = window.setTimeout(poll, 5);
  }

  function stepScene(dt: number) {
    if (transitionActive) {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, 5.5, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, 5.5, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, 5.5, dt);
      controls.target.x = THREE.MathUtils.damp(controls.target.x, _camTargetLook.x, 5.5, dt);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, _camTargetLook.y, 5.5, dt);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, _camTargetLook.z, 5.5, dt);

      const dist =
        camera.position.distanceTo(_camTargetPos) + controls.target.distanceTo(_camTargetLook);
      if (dist < 0.02) {
        camera.position.copy(_camTargetPos);
        controls.target.copy(_camTargetLook);
        transitionActive = false;
      }
    }

    cameraRigGroup.position.z = THREE.MathUtils.damp(
      cameraRigGroup.position.z,
      dollyTargetZ,
      6.5,
      dt
    );

    if (autoTurn && !isSoftwareGl) {
      heroTurnGroup.rotation.y += dt * 0.42;
      glassPrism.rotation.y += dt * 0.85;
    }

    controls.update();
  }

  function requestRender() {
    if (disposed) return;
    if (renderBusy) {
      renderDirty = true;
      return;
    }
    renderBusy = true;
    frameId = requestAnimationFrame((now) => {
      if (disposed) return;
      renderDirty = false;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      stepScene(dt);
      renderer.render(scene, camera);

      const finish = () => {
        renderBusy = false;
        const needsMore =
          renderDirty ||
          transitionActive ||
          Math.abs(cameraRigGroup.position.z - dollyTargetZ) > 0.005 ||
          (autoTurn && !isSoftwareGl);
        if (needsMore && !disposed) {
          requestRender();
        }
      };

      if (isSoftwareGl) afterDraw(finish);
      else finish();
    });
  }

  const handleResize = () => {
    if (disposed) return;
    const w = container.clientWidth || 960;
    const h = container.clientHeight || 600;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    requestRender();
  };

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);

  const onContextLost = (e: Event) => {
    e.preventDefault();
    onContextLossChange?.(true);
  };
  const onContextRestored = () => {
    onContextLossChange?.(false);
    requestRender();
  };
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

  requestRender();

  return {
    setCameraPreset: (preset) => {
      const target = CAMERA_PRESETS[preset];
      _camTargetPos.set(...target.pos);
      _camTargetLook.set(...target.look);
      transitionActive = true;
      requestRender();
    },
    setLightingMood: (mood) => {
      if (mood === "amberCinema") {
        keyLight.color.setHex(0xffe1b5);
        keyLight.intensity = 2.25;
        hemiLight.color.setHex(0x8bb6ea);
        hemiLight.intensity = 0.72;
        rimLight.color.setHex(0xf59e0b);
        rimLight.intensity = 1.35;
        softboxGlowMat.emissive.setHex(0xffd28a);
        if (rectAreaLight) rectAreaLight.color.setHex(0xffe4be);
      } else if (mood === "daylightStudio") {
        keyLight.color.setHex(0xffffff);
        keyLight.intensity = 2.6;
        hemiLight.color.setHex(0xdbeafe);
        hemiLight.intensity = 1.05;
        rimLight.color.setHex(0x93c5fd);
        rimLight.intensity = 1.1;
        softboxGlowMat.emissive.setHex(0xf8fafc);
        if (rectAreaLight) rectAreaLight.color.setHex(0xffffff);
      } else {
        keyLight.color.setHex(0x67e8f9);
        keyLight.intensity = 2.1;
        hemiLight.color.setHex(0x312e81);
        hemiLight.intensity = 0.85;
        rimLight.color.setHex(0xf59e0b);
        rimLight.intensity = 1.9;
        softboxGlowMat.emissive.setHex(0x38bdf8);
        if (rectAreaLight) rectAreaLight.color.setHex(0x67e8f9);
      }
      requestRender();
    },
    setDollyProgress: (t) => {
      dollyTargetZ = THREE.MathUtils.lerp(-0.75, 1.85, THREE.MathUtils.clamp(t, 0, 1));
      requestRender();
    },
    setAutoTurn: (enabled) => {
      autoTurn = enabled;
      requestRender();
    },
    updateHudTexture: (info) => {
      drawViewfinderCanvas(screenCanvas, info);
      screenTex.needsUpdate = true;
      requestRender();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener("start", onControlsStart);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      controls.dispose();
      envTarget.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
