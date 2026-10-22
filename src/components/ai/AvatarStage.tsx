import { useEffect, useRef, useState } from "react";
import { bindVisibleRenderLoop } from "@/lib/utils";
import { type VRM } from "@pixiv/three-vrm";
import type * as THREE from "three";
import { AnimationClip, Box3, Group, Mesh, Object3D, Texture, Vector3, Bone, Quaternion, SkinnedMesh, MathUtils } from "three";
import { classifyAvatarMorph, measureAvatarLuminance, nextAvatarExposure, avatarBackgroundLightness, animateAvatarLight, MODEL_FORMAT_LABEL, inferModelFormat, unzipModelArchive, pickArchiveModel, createArchiveResolver, zipMime, type ModelSource, type ZipEntry } from "@/lib/avatarModels";

// AvatarStage
export type GestureName = "wave" | "nod" | "bow" | "cheer";
export type CameraPreset = "bust" | "face" | "full";

/** Mutable state shared between the UI (React) and the render loop (three.js) – read every frame. */
export type AvatarBus = {
  lip: LipSync;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  micLevel: number;
  emotion: Emotion;
  gesture: { name: GestureName; id: number } | null;
  /** ジェスチャーIDの通し番号(UI側・3D側どちらから発火してもIDが衝突しないよう1か所で採番する) */
  gestureSeq: number;
};

export type ModelInfo = {
  kind: "vrm" | "glb" | "gltf" | "fbx" | "obj" | "mmd";
  name: string;
  vrmVersion?: string;
  expressions: string[];
  lipSync: boolean;
  title?: string;
  author?: string;
  format?: string;
  modelFile?: string;
  packageFiles?: number;
  animations?: string[];
  gestures?: GestureName[];
};

export type StageStatus =
  | { state: "loading"; progress: number }
  | { state: "ready"; info: ModelInfo }
  | { state: "error"; message: string };

export function createBus(lip: LipSync): AvatarBus {
  return { lip, speaking: false, listening: false, thinking: false, micLevel: 0, emotion: "neutral", gesture: null, gestureSeq: 0 };
}

/** ジェスチャーを発火する(IDは必ず単調増加) */
export function triggerGesture(bus: AvatarBus, name: GestureName) {
  bus.gesture = { name, id: ++bus.gestureSeq };
}

type MMDResultLike = {
  mesh: THREE.SkinnedMesh;
  pmx?: MmdRuntime["pmx"];
  ikSolver?: MmdRuntime["ikSolver"];
  /** @moeru/three-mmd の MMD ランタイム更新。IK / grants / optional physics を適用する。 */
  update?: (deltaTime: number) => void;
  beforeUpdate?: () => void;
  dispose?: () => void;
  setScalar?: (scale: number) => void;
};

type MMDLoaderLike = new (manager?: THREE.LoadingManager) => {
  manager: THREE.LoadingManager;
  loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<MMDResultLike>;
};

type StageLibs = {
  THREE: typeof import("three");
  runtime: { disposeAvatarObject: typeof disposeAvatarObject; normalizeAvatarObject: typeof normalizeAvatarObject; selectIdleClip: typeof selectIdleClip };
  mmdAvatar: { MmdAvatarController: typeof MmdAvatarController };
  VRMLoaderPlugin: typeof import("@pixiv/three-vrm").VRMLoaderPlugin;
  VRMUtils: typeof import("@pixiv/three-vrm").VRMUtils;
  GLTFLoader: typeof import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader;
  MMDLoader: MMDLoaderLike;
  FBXLoader: typeof import("three/examples/jsm/loaders/FBXLoader.js").FBXLoader;
  OBJLoader: typeof import("three/examples/jsm/loaders/OBJLoader.js").OBJLoader;
  MTLLoader: typeof import("three/examples/jsm/loaders/MTLLoader.js").MTLLoader;
  DRACOLoader: typeof import("three/examples/jsm/loaders/DRACOLoader.js").DRACOLoader;
  MeshoptDecoder: typeof import("three/examples/jsm/libs/meshopt_decoder.module.js").MeshoptDecoder;
};

type VrmStageProps = {
  source: ModelSource;
  companion?: boolean;
  bus: AvatarBus;
  camera: CameraPreset;
  night: boolean;
  onStatus: (s: StageStatus) => void;
};

type Pose = {
  headX: number; headY: number; headZ: number;
  neckX: number; spineX: number; spineZ: number; chestX: number;
  hipsY: number; hipsPosY: number;
  lUz: number; lUy: number; lLy: number; lLz: number;
  rUz: number; rUy: number; rLy: number; rLz: number;
  lShZ: number; rShZ: number;
};

type BoneName = Parameters<VRM["humanoid"]["getNormalizedBoneNode"]>[0];

const GENERIC_GESTURE_CLIPS: Record<GestureName, RegExp> = { wave: /(^|[|:_.\s-])wave$/i, nod: /(^|[|:_.\s-])(yes|nod)$/i, bow: /(^|[|:_.\s-])bow$/i, cheer: /(^|[|:_.\s-])(jump|cheer|thumbsup)$/i };

const GESTURE_DUR = { wave: 2.7, nod: 1.1, bow: 2.1, cheer: 2.5 } as const;

const EXPRESSIONS = ["happy", "sad", "angry", "surprised", "relaxed"] as const;
const STAGE_VOWELS = ["aa", "ih", "ou", "ee", "oh"] as const;

/**
 * 表情の強さ。
 * 以前は 0.55〜0.85 と強く、口パク(aa/ih…)と同時に効いて口や目が崩れていたため控えめにしている。
 */
const EMOTION_GAIN: Record<(typeof EXPRESSIONS)[number], number> = {
  happy: 0.42,
  sad: 0.5,
  angry: 0.35,
  surprised: 0.5,
  relaxed: 0.5,
};

/** 指の軽い曲げ(手がピンと伸びたままの不自然さを解消) */
const FINGER_NAMES = ["Index", "Middle", "Ring", "Little"] as const;
const FINGER_CURL: Record<string, number> = { Index: 0.16, Middle: 0.22, Ring: 0.28, Little: 0.34 };
const FINGER_JOINT_MUL = { Proximal: 1, Intermediate: 1.25, Distal: 0.8 } as const;

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

function VrmStageCore({ source, bus, camera, night, onStatus, libs, companion = false }: VrmStageProps & { libs: StageLibs }) {
  const { THREE, VRMLoaderPlugin, VRMUtils, GLTFLoader, MMDLoader, FBXLoader, OBJLoader, MTLLoader, DRACOLoader, MeshoptDecoder } = libs;
  const { disposeAvatarObject, normalizeAvatarObject, selectIdleClip } = libs.runtime;
  const mount = useRef<HTMLDivElement>(null);
  const api = useRef<{ load: (s: ModelSource) => void; setCamera: (c: CameraPreset) => void; setNight: (n: boolean) => void } | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    const el = mount.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: companion ? "low-power" : "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, companion ? 3 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:grab";

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
    cam.position.set(0, 1.25, 2.6);

    const keyLight = new THREE.DirectionalLight(0xffffff, Math.PI * 0.95);
    keyLight.position.set(0.7, 1.4, 1.6);
    scene.add(keyLight);
    const rim = new THREE.DirectionalLight(0xbcd4ff, Math.PI * 0.35);
    rim.position.set(-1.4, 1.2, -1.2);
    scene.add(rim);
    const amb = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(amb);

    // Sample the final rendered model, including its textures and toon/emissive shading.
    // Background and UI are deliberately excluded from metering.
    const meter = document.createElement("canvas");
    meter.width = meter.height = 80;
    const meterContext = meter.getContext("2d", { willReadFrequently: true });
    let nightRef = night;
    let lastMeterTime = 0;
    let backgroundLightness = avatarBackgroundLightness(null, night);
    let latestLuminance: ReturnType<typeof measureAvatarLuminance> = null;
    const backdrop = el.closest<HTMLElement>(".voice-bg");
    let exposureTarget = renderer.toneMappingExposure;
    let fillTarget = 0.7;
    let backgroundTarget = backgroundLightness;
    const applyBackground = () => {
      backdrop?.style.setProperty("--voice-backdrop-lightness", `${(backgroundLightness * 100).toFixed(3)}%`);
    };
    const animateLighting = (dt: number) => {
      // Metering only changes targets. Every visible change happens gradually per frame.
      renderer.toneMappingExposure = animateAvatarLight(renderer.toneMappingExposure, exposureTarget, dt, true);
      amb.intensity = damp(amb.intensity, fillTarget, 1.2, dt);
      backgroundLightness = animateAvatarLight(backgroundLightness, backgroundTarget, dt);
      applyBackground();
    };
    const meterLighting = (now: number) => {
      if (!meterContext || now - lastMeterTime < 400 || (!vrm && !root)) return;
      lastMeterTime = now;
      meterContext.clearRect(0, 0, 80, 80);
      meterContext.drawImage(renderer.domElement, 0, 0, 80, 80);
      const measured = measureAvatarLuminance(meterContext.getImageData(0, 0, 80, 80).data);
      if (!measured) return;
      // Filter blink/gesture/camera noise before it reaches the exposure controller.
      latestLuminance = latestLuminance ? {
        median: latestLuminance.median + (measured.median - latestLuminance.median) * 0.4,
        upper: latestLuminance.upper + (measured.upper - latestLuminance.upper) * 0.4,
        highlight: latestLuminance.highlight + (measured.highlight - latestLuminance.highlight) * 0.4,
        clipped: latestLuminance.clipped + (measured.clipped - latestLuminance.clipped) * 0.4,
      } : measured;
      exposureTarget = nextAvatarExposure(renderer.toneMappingExposure, latestLuminance);
      // Continuous fill avoids toggling between two light intensities near a threshold.
      fillTarget = 0.7 + THREE.MathUtils.clamp((0.32 - latestLuminance.median) / 0.32, 0, 1) * 0.4;
      backgroundTarget = avatarBackgroundLightness(latestLuminance, nightRef);
    };
    applyBackground();
    const lookTarget = new THREE.Object3D();
    scene.add(lookTarget);

    /* ---- state ---- */
    let vrm: VRM | null = null;
    let root: THREE.Object3D | null = null; // generic glb root
    let frame = { width: 1, depth: 0.3, headHeight: 0.3, faceWidth: 0.65, center: new THREE.Vector3(0, 0.9, 0), height: 1.55, headY: 1.35 };
    let preset: CameraPreset = "bust";
    const camGoal = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    const view = { yaw: 0, pitch: 0, zoom: 1 };
    const pointer = { x: 0, y: 0 };
    let glbMorph: { mesh: THREE.Mesh; idx: number; base: number; vowel: Vowel | null; emotion: Exclude<Emotion, "neutral"> | null; blink: boolean }[] = [];
    let mmdMesh: THREE.SkinnedMesh | null = null;
    let mmdRuntime: MMDResultLike | null = null;
    let mmdController: InstanceType<StageLibs["mmdAvatar"]["MmdAvatarController"]> | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let idleAction: THREE.AnimationAction | null = null;
    let clipAction: THREE.AnimationAction | null = null;
    let genericClips: THREE.AnimationClip[] = [];
    let lastClipGesture = 0;
    let activeLoad: AbortController | null = null;
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${import.meta.env.BASE_URL}decoders/draco/`);
    let loadToken = 0;
    let disposed = false;

    /**
     * 正規化ボーンの回転軸の向き。
     * VRM 0.x は「-Z向き」で作られており、three-vrm の正規化ボーンはその座標系のままなので、
     * VRM 1.0 基準で書いたポーズ(腕を下ろす・お辞儀・首かしげ等)は X軸・Z軸まわりの符号を反転させないと逆向きになる。
     * (これが「ずっと手を上げている」「動きがぎこちない」の主因)
     * VRM 1.0 なら 1、VRM 0.x なら -1。読み込み時に左腕の向きから自動判定する。
     */
    let flip = 1;

    const mouth = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    const emo = { happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0 };
    let blink = 0;
    let blinkAt = 2;
    let blinkPhase = -1;
    let gesture: { name: keyof typeof GESTURE_DUR; start: number } | null = null;
    let pendingGesture: keyof typeof GESTURE_DUR | null = null;
    let lastGestureId = 0;
    let t = 0;
    let listenNod = 0;
    // 状態の切り替わりでポーズが瞬間移動しないよう、なめらかに追従させる量
    let speakAmt = 0;
    let thinkAmt = 0;

    /* ---- camera ---- */
    const computeGoal = () => {
      const H = frame.height;
      const aspect = cam.aspect || 1;
      const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      let visible: number, cy: number, minWidth: number;
      if (preset === "face") {
        visible = Math.max(0.34 * H, frame.headHeight * 1.3);
        cy = frame.headY + 0.015;
        minWidth = frame.faceWidth;
      } else if (preset === "full") {
        // Keep raised hands and jump gestures inside the full-body frame.
        visible = 1.6 * H;
        cy = frame.center.y + 0.15 * H;
        minWidth = Math.max(0.95 * H, frame.width * 1.15);
      } else {
        visible = Math.max(0.68 * H, frame.headHeight + 0.45 * H);
        cy = frame.headY - 0.2 * H + 0.03;
        minWidth = 0.62 * H;
      }
      const distH = visible / 2 / tanH;
      const distW = minWidth / 2 / (tanH * aspect);
      const dist = (Math.max(distH, distW) + frame.depth / 2) * view.zoom;
      const cp = Math.cos(view.pitch);
      camGoal.target.set(frame.center.x, cy, frame.center.z);
      camGoal.pos.set(
        frame.center.x + Math.sin(view.yaw) * dist * cp,
        cy + Math.sin(view.pitch) * dist,
        frame.center.z + Math.cos(view.yaw) * dist * cp,
      );
    };

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      if (companion) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(2_000_000 / (w * h))));
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      computeGoal();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    cam.position.copy(camGoal.pos);
    const camLook = camGoal.target.clone();

    /* ---- model loading ---- */
    const disposeModel = () => {
      if (vrm) {
        scene.remove(vrm.scene);
        disposeAvatarObject(vrm.scene);
        vrm = null;
      }
      mmdRuntime?.dispose?.();
      if (mixer) {
        mixer.stopAllAction();
        if (root) mixer.uncacheRoot(mixer.getRoot());
        mixer = null;
      }
      idleAction = null;
      clipAction = null;
      genericClips = [];
      if (root) {
        scene.remove(root);
        disposeAvatarObject(root);
        root = null;
      }
      glbMorph = [];
      mmdMesh = null;
      mmdRuntime = null;
      mmdController = null;
      gesture = null;
      pendingGesture = null;
      lastGestureId = bus.gesture?.id ?? 0;
      lastClipGesture = lastGestureId;
      for (const v of STAGE_VOWELS) mouth[v] = 0;
      for (const e of EXPRESSIONS) emo[e] = 0;
      blink = 0;
      blinkPhase = -1;
      blinkAt = 2;
      flip = 1;
    };

    /** 左腕(上腕→肘)が正規化座標系の +X 側へ伸びていれば 1、-X 側なら -1 */
    const detectFlip = (loaded: VRM): number => {
      const h = loaded.humanoid;
      const upper = h.getNormalizedBoneNode("leftUpperArm");
      const lower = h.getNormalizedBoneNode("leftLowerArm");
      const rootNode = h.normalizedHumanBonesRoot;
      if (upper && lower && rootNode) {
        rootNode.updateWorldMatrix(true, true);
        const a = rootNode.worldToLocal(upper.getWorldPosition(new THREE.Vector3()));
        const b = rootNode.worldToLocal(lower.getWorldPosition(new THREE.Vector3()));
        const dx = b.x - a.x;
        if (Math.abs(dx) > 1e-4) return dx > 0 ? 1 : -1;
      }
      // 判定できなかった場合はメタ情報から推定
      return (loaded.meta as unknown as { metaVersion?: string }).metaVersion === "0" ? -1 : 1;
    };

    const load = async (src: ModelSource) => {
      const token = ++loadToken;
      activeLoad?.abort();
      const controller = new AbortController();
      activeLoad = controller;
      const current = () => token === loadToken && !disposed;
      const report = (s: StageStatus) => {
        if (!current()) return;
        el.dataset.limeAvatarState = s.state;
        el.dataset.limeAvatarFormat = s.state === "ready" ? s.info.kind : "";
        el.dataset.limeAvatarVersion = s.state === "ready" ? s.info.vrmVersion ?? "" : "";
        if (s.state === "ready") {
          exposureTarget = 0.85;
          fillTarget = 0.7;
          latestLuminance = null;
          lastMeterTime = 0;
          // Imported unlit materials must also participate in automatic exposure.
          (vrm?.scene ?? root)?.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              if (companion && material) {
                for (const value of Object.values(material)) {
                  if (value instanceof THREE.Texture) { value.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); value.needsUpdate = true; }
                }
              }
              if (material && !material.toneMapped) {
                material.toneMapped = true;
                material.needsUpdate = true;
              }
            }
          });
        }
        statusRef.current(s);
      };
      report({ state: "loading", progress: 0 });
      const ownedUrls: string[] = [];
      let pendingObject: THREE.Object3D | null = null;
      let pendingMmd: MMDResultLike | null = null;
      const objectUrl = (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        ownedUrls.push(url);
        return url;
      };
      try {
        let sourceFormat = src.format ?? inferModelFormat(src.name);
        let sourceName = src.name;
        let sourceUrl = src.kind === "url" ? src.url : objectUrl(src.blob);
        let resourcePath = src.kind === "url" ? new URL(".", new URL(src.url, window.location.href)).href : "";
        let entries: ZipEntry[] = [];
        const manager = new THREE.LoadingManager();
        let resourceError: string | null = null;
        manager.onError = (url) => { resourceError = `モデルの参照ファイルを読み込めませんでした: ${url}`; };
        const archive = /\.zip$/i.test(src.name) || sourceFormat === "archive";
        if (archive) {
          const blob = src.kind === "blob" ? src.blob : await fetch(src.url, { signal: controller.signal }).then((r) => {
            if (!r.ok) throw new Error(`ZIPの取得に失敗しました (${r.status})`);
            return r.blob();
          });
          entries = await unzipModelArchive(blob);
          if (!current()) return;
          const selected = pickArchiveModel(entries);
          if (!selected) throw new Error(`ZIP内に対応モデルが見つかりませんでした (${MODEL_FORMAT_LABEL})`);
          sourceName = selected.name;
          sourceFormat = inferModelFormat(sourceName);
          const urls = new Map(entries.map((entry) => [entry.name.toLowerCase(), objectUrl(new Blob([new Uint8Array(entry.data).buffer], { type: zipMime(entry.name) }))]));
          sourceUrl = new URL(sourceName, "https://limeai.local/package/").href;
          resourcePath = new URL(".", sourceUrl).href;
          manager.setURLModifier(createArchiveResolver(entries, urls, sourceName));
        } else if (src.kind === "blob") {
          // A standalone file must embed its resources. A ZIP supplies relative textures/buffers.
          manager.setURLModifier((url) => {
            if (/^(blob:|data:)/i.test(url)) return url;
            throw new Error("外部のテクスチャやbin/mtlを参照しています。モデルと参照ファイルをZIPにまとめて読み込んでください");
          });
        }
        const waitForResources = () => new Promise<void>((resolve) => {
          manager.onLoad = resolve;
          manager.itemStart("limeai-complete");
          manager.itemEnd("limeai-complete");
        });
        const progress = (e: ProgressEvent<EventTarget>) => {
          if (e.total) report({ state: "loading", progress: 0.15 + Math.min(0.8, e.loaded / e.total * 0.8) });
        };

        if (sourceFormat === "mmd") {
          // MMDLoader determines its parser from the extension, so preserve it in a virtual URL.
          if (!archive && src.kind === "blob") {
            const virtualUrl = `https://limeai.local/package/${encodeURIComponent(src.name)}`;
            const actualUrl = sourceUrl;
            manager.setURLModifier((url) => {
              if (url === virtualUrl || /^(blob:|data:)/i.test(url)) return url === virtualUrl ? actualUrl : url;
              throw new Error("PMX / PMDのテクスチャもZIPに含めて読み込んでください");
            });
            sourceUrl = virtualUrl;
          }
          const loadedMmd = await new MMDLoader(manager).loadAsync(sourceUrl, progress);
          pendingMmd = loadedMmd;
          const mesh = loadedMmd.mesh;
          pendingObject = mesh;
          await waitForResources();
          if (!current()) return;
          if (resourceError) throw new Error(resourceError);
          disposeModel();
          // MMDは「メッシュ全体の回転」で身振りを作るのではなく、
          // PMX/PMDのボーンを動かす必要がある。さらに @moeru/three-mmd は
          // update() 内で IK / grants / optional physics を処理するため、毎フレーム必ず通す。
          const box0 = new THREE.Box3().setFromObject(mesh);
          const size0 = box0.getSize(new THREE.Vector3());
          const scale = 1.55 / (size0.y || 1);
          if (loadedMmd.setScalar) loadedMmd.setScalar(scale);
          else mesh.scale.multiplyScalar(scale);
          mesh.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(mesh);
          const center = box.getCenter(new THREE.Vector3());
          mesh.position.x -= center.x;
          mesh.position.z -= center.z;
          mesh.position.y -= box.min.y;
          mesh.updateMatrixWorld(true);
          mesh.traverse((o) => (o.frustumCulled = false));
          scene.add(mesh);
          pendingObject = null;

          mmdMesh = mesh;
          mmdRuntime = loadedMmd;
          pendingMmd = null;
          root = mesh;
          mmdController = new libs.mmdAvatar.MmdAvatarController(loadedMmd);
          const names = Object.keys(mesh.morphTargetDictionary ?? {});

          // PMX/PMDモデルごとに骨名が違うので、見つかった骨だけ使う。
          // 初期姿勢を保存し、毎フレームそこから再構成することで、物理/IKとの累積ドリフトを防ぐ。
          frame = {
            width: size0.x * scale,
            depth: size0.z * scale,
            headHeight: 0.3,
            faceWidth: 0.65,
            center: new THREE.Vector3(0, 0.78, 0),
            height: 1.55,
            headY: 1.4,
          };

          const info: ModelInfo = {
            kind: "mmd",
            name: src.name,
            expressions: names.slice(0, 60),
            lipSync: mmdController.lipSync,
            format: sourceName.toLowerCase().endsWith(".pmx") ? "PMX" : "PMD",
            modelFile: sourceName,
            packageFiles: entries.length,
            gestures: mmdController.gestures,
          };
          computeGoal();
          camLook.copy(camGoal.target);
          cam.position.copy(camGoal.pos);
          report({ state: "ready", info });
          return;
        }

        let gltf: { scene: THREE.Object3D; userData: Record<string, unknown>; animations: THREE.AnimationClip[] };
        if (sourceFormat === "fbx") {
          const object = await new FBXLoader(manager).loadAsync(sourceUrl, progress);
          gltf = { scene: object, userData: {}, animations: object.animations };
        } else if (sourceFormat === "obj") {
          const loader = new OBJLoader(manager);
          if (archive) {
            const response = await fetch(manager.resolveURL(sourceUrl), { signal: controller.signal });
            const objText = await response.text();
            const mtls = [...objText.matchAll(/^mtllib\s+(.+)$/gm)].map((m) => m[1].trim());
            if (mtls.length > 1) throw new Error("OBJは1つのMTLファイルにまとめてください");
            if (mtls[0]) {
              const mtlUrl = new URL(mtls[0], resourcePath).href;
              const materials = await new MTLLoader(manager).setResourcePath(new URL(".", mtlUrl).href).loadAsync(mtlUrl);
              materials.preload();
              loader.setMaterials(materials);
            }
            gltf = { scene: loader.parse(objText), userData: {}, animations: [] };
          } else {
            const response = await fetch(sourceUrl, { signal: controller.signal });
            if (!response.ok) throw new Error(`OBJの取得に失敗しました (${response.status})`);
            const text = await response.text();
            if (src.kind === "blob" && /^mtllib\s+/m.test(text)) throw new Error("OBJとMTL・テクスチャをZIPにまとめて読み込んでください");
            gltf = { scene: loader.parse(text), userData: {}, animations: [] };
          }
        } else {
          const loader = new GLTFLoader(manager);
          loader.crossOrigin = "anonymous";
          loader.setDRACOLoader(draco);
          loader.setMeshoptDecoder(MeshoptDecoder);
          loader.register((p) => new VRMLoaderPlugin(p));
          const response = await fetch(archive ? manager.resolveURL(sourceUrl) : sourceUrl, { signal: controller.signal });
          if (!response.ok) throw new Error(`モデル取得に失敗しました (${response.status})`);
          const bytes = await response.arrayBuffer();
          const head = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 256)).trimStart().toLowerCase();
          if (response.headers.get("content-type")?.includes("text/html") || head.startsWith("<!doctype html") || head.startsWith("<html")) {
            throw new Error("モデルURLがHTMLを返しています。モデルファイルの配置を確認してください");
          }
          if (!current()) return;
          report({ state: "loading", progress: 0.15 });
          gltf = await loader.parseAsync(bytes, resourcePath);
        }
        pendingObject = gltf.scene;
        if (!current()) return;
        // Texture loads in OBJ/FBX may finish after the model itself.
        await waitForResources();
        if (!current()) return;
        if (resourceError) throw new Error(resourceError);
        disposeModel();

        const loaded = gltf.userData.vrm as VRM | undefined;
        if (sourceFormat === "vrm" && !loaded) throw new Error("VRMの人型情報がありません。有効なVRMファイルを選んでください");
        let info: ModelInfo;
        if (loaded) {
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);
          VRMUtils.rotateVRM0(loaded);
          loaded.scene.traverse((o) => (o.frustumCulled = false));
          scene.add(loaded.scene);
          vrm = loaded;
          pendingObject = null;
          loaded.lookAt && (loaded.lookAt.target = lookTarget);
          loaded.scene.updateMatrixWorld(true);
          flip = detectFlip(loaded);
          const box = new THREE.Box3().setFromObject(loaded.scene);
          const head = loaded.humanoid.getNormalizedBoneNode("head");
          const hp = new THREE.Vector3();
          (head || loaded.scene).getWorldPosition(hp);
          frame = {
            width: box.max.x - box.min.x,
            depth: box.max.z - box.min.z,
            headHeight: Math.max(box.max.y - hp.y, (box.max.y - box.min.y) * 0.2),
            faceWidth: (box.max.y - box.min.y) * 0.42,
            center: new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, 0),
            height: box.max.y - box.min.y,
            headY: head ? hp.y + 0.06 : box.max.y - 0.12,
          };
          const meta = loaded.meta as unknown as { name?: string; metaVersion?: string; authors?: string[]; author?: string; title?: string };
          const names: string[] = [];
          loaded.expressionManager?.expressions.forEach((e) => names.push(e.expressionName));
          info = {
            kind: "vrm",
            name: src.name,
            vrmVersion: meta.metaVersion === "1" ? "VRM 1.0" : "VRM 0.x",
            expressions: names,
            lipSync: STAGE_VOWELS.some((v) => names.includes(v)),
            title: meta.name || meta.title,
            author: meta.authors?.join(", ") || meta.author,
            gestures: ["wave", "nod", "bow", "cheer"],
          };
        } else {
          const obj = gltf.scene;
          const normalized = normalizeAvatarObject(obj);
          pendingObject = normalized.stage;
          obj.traverse((o) => (o.frustumCulled = false));
          root = normalized.stage;
          scene.add(root);
          pendingObject = null;
          genericClips = gltf.animations || [];
          if (genericClips.length) {
            mixer = new THREE.AnimationMixer(obj);
            const idle = selectIdleClip(genericClips);
            idleAction = idle ? mixer.clipAction(idle) : null;
            idleAction?.play();
          }
          let headY = 0;
          let found = false;
          obj.traverse((o) => {
            if (!found && /(^|[_:.\s-])(head|頭)$/i.test(o.name)) {
              const v = new THREE.Vector3();
              o.getWorldPosition(v);
              headY = v.y;
              found = true;
            }
          });
          // A head bone can be at the chin (not the center), especially on large robot heads.
          // Fit the head's vertical extent instead of assuming human proportions.
          const headHeight = THREE.MathUtils.clamp(normalized.box.max.y - (found ? headY : 1.2), 0.31, 1.0);
          frame = { width: normalized.size.x, depth: normalized.size.z, headHeight, faceWidth: normalized.size.x * 1.05, center: normalized.box.getCenter(new THREE.Vector3()), height: 1.55, headY: normalized.box.max.y - headHeight / 2 };
          const names: string[] = [];
          obj.traverse((o) => {
            const m = o as THREE.Mesh;
            const dict = m.morphTargetDictionary as Record<string, number> | undefined;
            if (!m.isMesh || !dict) return;
            for (const [k, idx] of Object.entries(dict)) {
              names.push(k);
              const classification = classifyAvatarMorph(k);
              if (classification.vowel || classification.emotion || classification.blink) {
                glbMorph.push({ mesh: m, idx, base: m.morphTargetInfluences?.[idx] || 0, ...classification });
              }
            }
          });
          info = { kind: sourceFormat as ModelInfo["kind"], format: sourceFormat.toUpperCase(), name: src.name, modelFile: archive ? sourceName : undefined, packageFiles: archive ? entries.length : undefined, expressions: names.slice(0, 40), lipSync: glbMorph.some((m) => m.vowel !== null), animations: genericClips.map((c) => c.name), gestures: (Object.keys(GENERIC_GESTURE_CLIPS) as GestureName[]).filter((g) => genericClips.some((c) => GENERIC_GESTURE_CLIPS[g].test(c.name))) };
        }
        computeGoal();
        camLook.copy(camGoal.target);
        cam.position.copy(camGoal.pos);
        report({ state: "ready", info });
      } catch (e) {
        if (token !== loadToken || disposed) return;
        report({ state: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        pendingMmd?.dispose?.();
        if (pendingObject) disposeAvatarObject(pendingObject);
        ownedUrls.forEach((url) => URL.revokeObjectURL(url));
      }
    };

    api.current = {
      load,
      setCamera: (c) => {
        preset = c;
        view.yaw = 0;
        view.pitch = 0;
        view.zoom = 1;
        computeGoal();
      },
      setNight: (value) => {
        nightRef = value;
        backgroundTarget = avatarBackgroundLightness(latestLuminance, nightRef);
      },
    };

    /* ---- interaction ---- */
    const cv = renderer.domElement;
    let dragging = false;
    let moved = 0;
    let lx = 0;
    let ly = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lx = e.clientX;
      ly = e.clientY;
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      view.yaw = THREE.MathUtils.clamp(view.yaw - dx * 0.006, -1.1, 1.1);
      view.pitch = THREE.MathUtils.clamp(view.pitch + dy * 0.004, -0.35, 0.55);
      computeGoal();
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      cv.style.cursor = "grab";
      try {
        cv.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (moved < 6) triggerGesture(bus, Math.random() < 0.5 ? "wave" : "nod");
    };
    const onCancel = () => { dragging = false; cv.style.cursor = "grab"; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.zoom = THREE.MathUtils.clamp(view.zoom * (1 + e.deltaY * 0.001), 0.45, 1.8);
      computeGoal();
    };
    if (!companion) {
      cv.addEventListener("pointerdown", onDown);
      cv.addEventListener("pointermove", onMove);
      cv.addEventListener("pointerup", onUp);
      cv.addEventListener("pointercancel", onCancel);
      cv.addEventListener("wheel", onWheel, { passive: false });
    }
    const onWinMove = (e: PointerEvent) => {
      if (dragging) return;
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onWinMove);

    /* ---- per-frame update ---- */
    const update = (dt: number) => {
      t += dt;
      const now = performance.now();
      const s = bus.lip.sample(now);
      const speaking = bus.speaking && bus.lip.active;
      const openTarget = speaking && !s.pause ? s.open : 0;

      // 状態量をなめらかに追従(話し始め・考え始めで腕や首が急にカクつかない)
      speakAmt = damp(speakAmt, speaking ? 1 : 0, 5, dt);
      thinkAmt = damp(thinkAmt, bus.thinking ? 1 : 0, 4, dt);

      // vowel weights
      for (const v of STAGE_VOWELS) {
        const target = speaking && s.vowel === v ? openTarget * 0.9 : 0;
        mouth[v] = damp(mouth[v], target, target > mouth[v] ? 34 : 22, dt);
      }
      const openness = mouth.aa + mouth.ih * 0.6 + mouth.ou * 0.6 + mouth.ee * 0.6 + mouth.oh * 0.8;

      // emotion(口を開けている間は表情を弱め、口パクと表情が重なって崩れるのを防ぐ)
      for (const e of EXPRESSIONS) {
        const goal = bus.emotion === e ? EMOTION_GAIN[e] : 0;
        emo[e] = damp(emo[e], goal, 5, dt);
      }
      const emoScale = 1 - Math.min(1, openness) * 0.6;

      // blink
      blinkAt -= dt;
      if (blinkAt <= 0 && blinkPhase < 0) {
        blinkPhase = 0;
        blinkAt = 2 + Math.random() * 3.5;
      }
      if (blinkPhase >= 0) {
        blinkPhase += dt / 0.16;
        blink = blinkPhase < 1 ? Math.sin(blinkPhase * Math.PI) : 0;
        if (blinkPhase >= 1) blinkPhase = -1;
      }

      // gesture request (再生中に新しい要求が来たら1件だけ待たせ、終わってから再生する)
      if (bus.gesture && bus.gesture.id !== lastGestureId) {
        lastGestureId = bus.gesture.id;
        if (!gesture) gesture = { name: bus.gesture.name, start: t };
        else pendingGesture = bus.gesture.name;
      }
      let gp = 0;
      let genv = 0;
      let gname: keyof typeof GESTURE_DUR | null = null;
      if (gesture) {
        const dur = GESTURE_DUR[gesture.name];
        gp = (t - gesture.start) / dur;
        if (gp >= 1) {
          gesture = pendingGesture ? { name: pendingGesture, start: t } : null;
          pendingGesture = null;
          gp = 0;
        } else {
          gname = gesture.name;
          genv = Math.min(1, gp * 5, (1 - gp) * 5);
          genv = genv * genv * (3 - 2 * genv);
        }
      }
      const gt = gesture ? t - gesture.start : 0;

      if (vrm) {
        const em = vrm.expressionManager;
        if (em) {
          for (const v of STAGE_VOWELS) em.setValue(v, Math.min(1, mouth[v]));
          for (const e of EXPRESSIONS) em.setValue(e, emo[e] * emoScale);
          em.setValue("blink", Math.max(0, blink * (1 - Math.min(1, emo.happy * 1.5))));
        }

        // pose(VRM 1.0 の座標系で記述。実際の適用時に flip で VRM 0.x へ変換する)
        const breath = Math.sin(t * 1.6);
        listenNod = damp(listenNod, bus.listening ? 1 : 0, 4, dt);
        const P: Pose = {
          headX: Math.sin(t * 0.8) * 0.015 - openness * 0.05 + speakAmt * Math.sin(t * 3.3) * 0.012 + Math.sin(t * 1.3) * 0.02 * listenNod,
          headY: Math.sin(t * 0.55) * 0.05 + pointer.x * 0.28,
          headZ: 0.07 * listenNod + (1 - listenNod) * Math.sin(t * 0.45) * 0.015,
          neckX: 0,
          spineX: 0.012 * breath + 0.02 * speakAmt,
          spineZ: Math.sin(t * 0.6) * 0.018,
          chestX: 0.014 * breath,
          hipsY: Math.sin(t * 0.4) * 0.035,
          hipsPosY: 0,
          lUz: -1.22 + 0.02 * breath,
          lUy: -0.1,
          lLy: -0.28,
          lLz: 0,
          rUz: 1.22 - 0.02 * breath,
          rUy: 0.1,
          rLy: 0.28,
          rLz: 0,
          lShZ: -0.02 * breath,
          rShZ: 0.02 * breath,
        };
        P.headX += -pointer.y * 0.12;
        P.neckX = P.headX * 0.4;
        // 考え中のしぐさ
        P.headZ += 0.09 * thinkAmt;
        P.headY += 0.16 * thinkAmt;
        P.headX += -0.05 * thinkAmt;
        // 話している間の控えめな手ぶり
        P.rUz -= speakAmt * (0.06 + 0.05 * Math.sin(t * 1.9));
        P.rLy += speakAmt * (0.12 + 0.1 * Math.sin(t * 2.3 + 1));
        P.lLy -= speakAmt * (0.06 + 0.05 * Math.sin(t * 2.1));

        const mix = <K extends keyof Pose>(k: K, v: number) => {
          P[k] = P[k] * (1 - genv) + v * genv;
        };
        if (gname === "wave") {
          mix("rUz", 0.3);
          mix("rUy", 0.6);
          mix("rLz", -1.3 + Math.sin(gt * 11) * 0.3);
          mix("rLy", 0.2);
          P.headZ += 0.07 * genv;
          P.headX += -0.03 * genv;
        } else if (gname === "nod") {
          P.headX += Math.sin(gp * Math.PI * 2) * 0.2 * genv;
        } else if (gname === "bow") {
          const bell = Math.pow(Math.sin(Math.PI * Math.min(1, gp)), 0.8);
          P.spineX += 0.42 * bell;
          P.chestX += 0.2 * bell;
          P.headX += 0.22 * bell;
          mix("lLy", -0.5);
          mix("rLy", 0.5);
        } else if (gname === "cheer") {
          mix("lUz", 1.35 + Math.sin(gt * 9) * 0.12);
          mix("rUz", -1.35 - Math.sin(gt * 9 + 1) * 0.12);
          mix("lLy", -0.1);
          mix("rLy", 0.1);
          P.hipsPosY += Math.abs(Math.sin(gt * 7)) * 0.035 * genv;
          P.headX += -0.1 * genv;
        }

        const h = vrm.humanoid;
        const F = flip;
        const set = (name: BoneName, x: number, y: number, z: number, order?: THREE.EulerOrder) => {
          const n = h.getNormalizedBoneNode(name);
          if (!n) return;
          if (order) n.rotation.order = order;
          // X/Z まわりの回転は VRM 0.x では符号を反転する(Y軸まわりは共通)
          n.rotation.set(x * F, y, z * F);
        };
        set("hips", 0, P.hipsY, 0);
        const hips = h.getNormalizedBoneNode("hips");
        if (hips) hips.position.y = (hips.userData.baseY ??= hips.position.y) + P.hipsPosY;
        set("spine", P.spineX, 0, P.spineZ);
        set("chest", P.chestX, 0, 0);
        set("neck", P.neckX, P.headY * 0.4, P.headZ * 0.4);
        set("head", P.headX - P.neckX, P.headY * 0.6, P.headZ * 0.6);
        set("leftShoulder", 0, 0, P.lShZ);
        set("rightShoulder", 0, 0, P.rShZ);
        set("leftUpperArm", 0, P.lUy, P.lUz, "ZYX");
        set("rightUpperArm", 0, P.rUy, P.rUz, "ZYX");
        set("leftLowerArm", 0, P.lLy, P.lLz, "ZYX");
        set("rightLowerArm", 0, P.rLy, P.rLz, "ZYX");
        set("leftHand", 0, 0, 0.08 * Math.sin(t * 1.1));
        set("rightHand", 0, 0, -0.08 * Math.sin(t * 1.1 + 1));

        // 指を軽く曲げて自然な手にする(万歳・手を振る間は少し開く)
        const open = gname === "cheer" || gname === "wave" ? genv * 0.6 : 0;
        for (const f of FINGER_NAMES) {
          const base = FINGER_CURL[f] * (1 - open);
          for (const joint of ["Proximal", "Intermediate", "Distal"] as const) {
            const c = base * FINGER_JOINT_MUL[joint];
            set(`left${f}${joint}` as BoneName, 0, 0, -c);
            set(`right${f}${joint}` as BoneName, 0, 0, c);
          }
        }

        // eye look target follows the pointer
        lookTarget.position.set(pointer.x * 0.8, frame.headY + pointer.y * 0.5, 2.0);
        vrm.update(dt);
      } else if (mmdMesh && mmdController) {
        listenNod = damp(listenNod, bus.listening ? 1 : 0, 5, dt);
        const mmdFrame = {
          time: t, dt, speaking: speakAmt, listening: listenNod,
          lookX: -pointer.y * 0.12, lookY: pointer.x * 0.24,
          gesture: gname, progress: gp, envelope: genv, gestureTime: gt,
          mouth, emotions: emo, blink,
        };
        mmdRuntime?.beforeUpdate?.();
        mmdController.pose(mmdFrame);
        mmdController.expressions(mmdFrame);
        mmdRuntime?.update?.(dt);
      } else if (root) {
        // Imported models keep their authored position/rotation. Play only recognized clips.
        if (mixer) {
          if (bus.gesture && bus.gesture.id !== lastClipGesture) {
            lastClipGesture = bus.gesture.id;
            const clip = genericClips.find((c) => GENERIC_GESTURE_CLIPS[bus.gesture!.name].test(c.name));
            if (clip) {
              clipAction?.stop();
              clipAction = mixer.clipAction(clip);
              clipAction.reset().setLoop(THREE.LoopOnce, 1);
              clipAction.clampWhenFinished = false;
              clipAction.play();
              idleAction?.stop();
            }
          }
          mixer.update(dt);
          if (clipAction && !clipAction.isRunning()) {
            clipAction = null;
            idleAction?.reset().play();
          }
        }
        for (const m of glbMorph) {
          if (!m.mesh.morphTargetInfluences) continue;
          m.mesh.morphTargetInfluences[m.idx] = THREE.MathUtils.clamp(Math.max(
            m.base,
            m.vowel ? mouth[m.vowel] : 0,
            m.emotion ? emo[m.emotion] * emoScale : 0,
            m.blink ? blink : 0,
          ), 0, 1);
        }
      }

      // camera easing
      cam.position.x = damp(cam.position.x, camGoal.pos.x, 5, dt);
      cam.position.y = damp(cam.position.y, camGoal.pos.y, 5, dt);
      cam.position.z = damp(cam.position.z, camGoal.pos.z, 5, dt);
      camLook.x = damp(camLook.x, camGoal.target.x, 5, dt);
      camLook.y = damp(camLook.y, camGoal.target.y, 5, dt);
      camLook.z = damp(camLook.z, camGoal.target.z, 5, dt);
      cam.lookAt(camLook);
    };

    let lastTs = performance.now();
    const stopRendering=bindVisibleRenderLoop(el,loop=>renderer.setAnimationLoop(loop),() => {
      const ts = performance.now();
      if (companion && ts - lastTs < 1000 / 30) return;
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;
      update(dt);
      animateLighting(dt);
      renderer.render(scene, cam);
      meterLighting(ts);
    },()=>{lastTs=performance.now();});

    return () => {
      disposed = true;
      loadToken++;
      activeLoad?.abort();
      draco.dispose();
      stopRendering();
      ro.disconnect();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onCancel);
      cv.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onWinMove);
      disposeModel();
      renderer.dispose();
      renderer.domElement.remove();
      backdrop?.style.removeProperty("--voice-backdrop-lightness");
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.load(source);
  }, [source]);
  useEffect(() => {
    api.current?.setCamera(camera);
  }, [camera]);
  useEffect(() => {
    api.current?.setNight(night);
  }, [night]);

  return <div ref={mount} data-lime-avatar-stage className="absolute inset-0" />;
}

export function VrmStage(props: VrmStageProps) {
  const [libs, setLibs] = useState<StageLibs | null>(null);
  const statusRef = useRef(props.onStatus);
  statusRef.current = props.onStatus;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("three"),
      import("@pixiv/three-vrm"),
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      // MMDLoader は three の一部バージョンで型宣言が提供されないため、
      // 実行時 import は維持しつつローカルの最小型で受ける。
      import("@moeru/three-mmd"),
      import("three/examples/jsm/loaders/FBXLoader.js"),
      import("three/examples/jsm/loaders/OBJLoader.js"),
      import("three/examples/jsm/loaders/MTLLoader.js"),
      import("three/examples/jsm/loaders/DRACOLoader.js"),
      import("three/examples/jsm/libs/meshopt_decoder.module.js"),
    ])
      .then(([THREE, vrm, gltf, mmd, fbx, obj, mtl, draco, meshopt]) => {
        if (cancelled) return;
        setLibs({
          THREE, runtime: { disposeAvatarObject, normalizeAvatarObject, selectIdleClip }, mmdAvatar: { MmdAvatarController },
          VRMLoaderPlugin: vrm.VRMLoaderPlugin,
          VRMUtils: vrm.VRMUtils,
          GLTFLoader: gltf.GLTFLoader,
          MMDLoader: mmd.MMDLoader as unknown as MMDLoaderLike,
          FBXLoader: fbx.FBXLoader, OBJLoader: obj.OBJLoader, MTLLoader: mtl.MTLLoader, DRACOLoader: draco.DRACOLoader, MeshoptDecoder: meshopt.MeshoptDecoder,
        });
      })
      .catch((e) => {
        if (!cancelled) statusRef.current({ state: "error", message: `3Dライブラリを読み込めませんでした: ${e instanceof Error ? e.message : String(e)}` });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!libs) return <div className="absolute inset-0" />;
  return <VrmStageCore {...props} libs={libs} />;
}


// CompanionStage
export default function CompanionStage({source,night,onStatus}:{source:ModelSource;night:boolean;onStatus:(status:StageStatus)=>void}){
 const bus=useRef(createBus(new LipSync()));
 return <VrmStage source={source} bus={bus.current} camera="full" night={night} onStatus={onStatus} companion/>;
}


// avatarRuntime
/** Release shared geometries/materials/textures once, including stale asynchronous loads. */
function disposeAvatarObject(object: Object3D) {
  const geometries = new Set<Mesh['geometry']>();
  const materials = new Set<import('three').Material>();
  const textures = new Set<Texture>();
  const skeletons = new Set<import('three').Skeleton>();
  object.traverse((node) => {
    const mesh = node as Mesh & { skeleton?: import('three').Skeleton };
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.skeleton) skeletons.add(mesh.skeleton);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      // ShaderMaterial uniforms (including MMD) may also own textures.
      for (const value of Object.values(material)) {
        if ((value as Texture)?.isTexture) textures.add(value as Texture);
      }
      const uniforms = (material as import('three').ShaderMaterial).uniforms;
      for (const uniform of Object.values(uniforms || {})) {
        if ((uniform.value as Texture)?.isTexture) textures.add(uniform.value as Texture);
      }
      materials.add(material);
    }
  });
  textures.forEach((texture) => texture.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material: import('three').Material) => material.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
}

/** A wrapper preserves authored transforms and provides a consistent floor and camera scale. */
function normalizeAvatarObject(object: Object3D) {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object, true);
  const size = box.getSize(new Vector3());
  if (box.isEmpty() || ![size.x, size.y, size.z].every(Number.isFinite) || size.y < 1e-6) {
    throw new Error('モデルに表示可能な立体がありません');
  }
  const stage = new Group();
  stage.add(object);
  stage.scale.setScalar(1.55 / size.y);
  stage.updateMatrixWorld(true);
  box.setFromObject(stage, true);
  const center = box.getCenter(new Vector3());
  stage.position.set(-center.x, -box.min.y, -center.z);
  stage.updateMatrixWorld(true);
  const normalized = new Box3().setFromObject(stage, true);
  return { stage, box: normalized, size: normalized.getSize(new Vector3()) };
}

/** Never start a walk, death, or attack animation simply because it is first in the file. */
function selectIdleClip(clips: AnimationClip[]) {
  return clips.find((clip) => /(^|[|:_.\s-])(idle|stand(?:ing)?|rest)([|:_.\s-]|$)/i.test(clip.name));
}

// avatarLipSync
type Vowel = "aa" | "ih" | "ou" | "ee" | "oh";
type Emotion = "neutral" | "happy" | "sad" | "angry" | "surprised" | "relaxed";

const ROWS: [Vowel, string][] = [
  ["aa", "あかさたなはまやらわがざだばぱぁゃゎ"],
  ["ih", "いきしちにひみりぎじぢびぴぃゐ"],
  ["ou", "うくすつぬふむゆるぐずづぶぷぅゅゔ"],
  ["ee", "えけせてねへめれげぜでべぺぇゑ"],
  ["oh", "おこそとのほもよろをごぞどぼぽぉょ"],
];
const MAP = new Map<string, Vowel>();
for (const [v, chars] of ROWS) for (const c of chars) MAP.set(c, v);
const LATIN: Record<string, Vowel> = { a: "aa", i: "ih", u: "ou", e: "ee", o: "oh" };
const VOWELS: Vowel[] = ["aa", "ih", "ou", "ee", "oh"];
const AMP: Record<Vowel, number> = { aa: 1, oh: 0.85, ee: 0.65, ih: 0.5, ou: 0.55 };

const PAUSE = /[、。，．,.!?！？\n\s…・「」『』()（）:：;；]/;

function toHiragana(ch: string) {
  const c = ch.charCodeAt(0);
  return c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : ch;
}

type Sample = { vowel: Vowel; open: number; pause: boolean };

class LipSync {
  private text = "";
  private baseIndex = 0;
  private baseTime = 0;
  private rate = 1;
  private lastVowel: Vowel = "aa";
  active = false;

  begin(text: string, rate: number) {
    this.text = text;
    this.rate = rate;
    this.baseIndex = 0;
    this.baseTime = performance.now();
    this.active = true;
  }

  /** Called when a new utterance chunk starts: text is the full text, offset is chunk offset. */
  chunk(offset: number) {
    this.baseIndex = offset;
    this.baseTime = performance.now();
  }

  boundary(charIndex: number) {
    this.baseIndex = charIndex;
    this.baseTime = performance.now();
  }

  end() {
    this.active = false;
  }

  /** Estimated index (float) of the character currently being pronounced. */
  position(now: number) {
    return this.active ? this.baseIndex + ((now - this.baseTime) / 1000) * 7.2 * this.rate : 0;
  }

  sample(now: number): Sample {
    if (!this.active || !this.text) return { vowel: "aa", open: 0, pause: true };
    const cps = 7.2 * this.rate;
    const pos = this.baseIndex + ((now - this.baseTime) / 1000) * cps;
    // 文字数を超えて推定位置が進んだ場合は口を閉じる(最後の文字で口が開きっぱなしになるのを防ぐ)
    if (pos >= this.text.length + 1) return { vowel: this.lastVowel, open: 0, pause: true };
    const i = Math.min(Math.floor(pos), this.text.length - 1);
    if (i < 0) return { vowel: this.lastVowel, open: 0, pause: true };
    let frac = pos - Math.floor(pos);
    const raw = this.text[i];
    const ch = toHiragana(raw).toLowerCase();
    if (PAUSE.test(ch)) return { vowel: this.lastVowel, open: 0, pause: true };
    let vowel: Vowel | undefined = MAP.get(ch);
    if (ch === "ー") vowel = this.lastVowel;
    else if (ch === "ん" || ch === "っ") return { vowel: this.lastVowel, open: 0.08, pause: false };
    else if (LATIN[ch]) vowel = LATIN[ch];
    else if (!vowel) {
      // 漢字などは2音節ぶんとして扱い、前半・後半で母音を変える(口の動きが自然になる)
      const half = frac < 0.5 ? 0 : 1;
      vowel = VOWELS[(raw.charCodeAt(0) * 7 + i + half * 3) % 5];
      frac = (frac * 2) % 1;
    }
    this.lastVowel = vowel;
    // syllable envelope: open quickly, close before the next character
    const env = Math.sin(Math.PI * Math.min(1, frac * 0.95 + 0.04));
    return { vowel, open: Math.max(0.12, env) * AMP[vowel], pause: false };
  }
}

// mmdAvatar
type MmdAvatarVowel = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';
type MmdAvatarEmotion = 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed';
type Gesture = 'wave' | 'nod' | 'bow' | 'cheer';
type Morph = { name: string; category?: number; type?: number; indices?: ArrayLike<number> };
type MmdRuntime = {
  mesh: SkinnedMesh;
  pmx?: { bones: { name: string; ik?: { target: number; links: { target: number }[] } }[]; morphs: Morph[] };
  ikSolver?: { setEnabled(index: number, enabled: boolean): void };
};
type MmdFrame = {
  time: number; dt: number; speaking: number; listening: number; lookX: number; lookY: number;
  gesture: Gesture | null; progress: number; envelope: number; gestureTime: number;
  mouth: Record<MmdAvatarVowel, number>; emotions: Record<MmdAvatarEmotion, number>; blink: number;
};
const normalize = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[\s_\-・･:：.。!！]/g, '');
const avatarRuntimeDamp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const Z = new Vector3(0, 0, 1), X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0);
type Joint = { node: Bone; rotation: Quaternion; position: Vector3 };
type Arm = { side: number; upper: Joint | null; elbow: Joint | null; wrist: Joint | null; restAngle: number; handDirection: Vector3; palmNormal: Vector3; fingers: { joint: Joint; axis: Vector3; curl: number; thumb: boolean }[] };
type Binding = { index: number; base: number; channel: 'blink' | 'brow' | 'eye' | 'lip' | 'face' | MmdAvatarVowel; emotions?: MmdAvatarEmotion[]; dependencies: Set<number> };

/** Procedural conversation pose in the model coordinate system, independent of bone local axes. */
class MmdAvatarController {
  readonly joints: Joint[] = [];
  readonly arms: Arm[] = [];
  readonly bindings: Binding[] = [];
  readonly gestures: Gesture[] = [];
  readonly lipSync: boolean;
  private body: Joint | null;
  private chest: Joint | null;
  private neck: Joint | null;
  private head: Joint | null;
  private eyes: Joint[];
  private meshRotation = new Quaternion();
  private parentRotation = new Quaternion();
  private axis = new Vector3();
  private delta = new Quaternion();
  private palm = new Vector3();
  private handDirection = new Vector3();
  private palmTarget = new Vector3();
  private cross = new Vector3();
  private wristRotation = new Quaternion();
  private gazeX = 0;
  private gazeY = 0;

  constructor(readonly runtime: MmdRuntime) {
    const mesh = runtime.mesh;
    mesh.updateMatrixWorld(true);
    const bones = mesh.skeleton.bones;
    const find = (...names: string[]) => bones.find(b => names.includes(normalize(b.name))) ?? null;
    const capture = (node: Bone | null): Joint | null => {
      if (!node) return null;
      const joint = { node, rotation: node.quaternion.clone(), position: node.position.clone() };
      this.joints.push(joint); return joint;
    };
    this.body = capture(find('上半身', 'upperbody', 'upperbody0'));
    this.chest = capture(find('上半身2', 'chest', 'upperbody2'));
    this.neck = capture(find('首', 'neck')); this.head = capture(find('頭', 'head'));
    // Prefer individual eyes; driving both the grant source 両目 and its children doubles rotation.
    this.eyes = [capture(find('左目', 'lefteye')), capture(find('右目', 'righteye'))].filter((j): j is Joint => !!j);
    if (!this.eyes.length) { const eye = capture(find('両目', 'eyes')); if (eye) this.eyes.push(eye); }
    for (const [prefix, english, short, side] of [['左', 'left', 'l', 1], ['右', 'right', 'r', -1]] as const) {
      const upper = capture(find(`${prefix}腕`, `${english}upperarm`, `${english}arm`, `${short}upperarm`));
      const elbow = capture(find(`${prefix}ひじ`, `${prefix}肘`, `${english}lowerarm`, `${english}elbow`, `${short}elbow`));
      const wrist = capture(find(`${prefix}手首`, `${english}hand`, `${english}wrist`, `${short}wrist`));
      let restAngle = 0;
      if (upper && elbow) {
        const direction = mesh.worldToLocal(elbow.node.getWorldPosition(new Vector3())).sub(mesh.worldToLocal(upper.node.getWorldPosition(new Vector3())));
        if (direction.lengthSq() > 1e-8) {
          const target = new Vector3(side * 0.28, -0.96, 0);
          restAngle = Math.atan2(direction.x * target.y - direction.y * target.x, direction.x * target.x + direction.y * target.y);
        }
      }
      const modelPosition = (node: Bone) => mesh.worldToLocal(node.getWorldPosition(new Vector3()));
      const middle = find(`${prefix}中指1`, `${english}middleproximal`, `${english}middle1`);
      const index = find(`${prefix}人指1`, `${prefix}人差指1`, `${prefix}人差し指1`, `${english}indexproximal`, `${english}index1`);
      const little = find(`${prefix}小指1`, `${english}littleproximal`, `${english}little1`);
      const handDirection = wrist && middle ? modelPosition(middle).sub(modelPosition(wrist.node)).normalize() : new Vector3(side, 0, 0);
      const palmNormal = index && little ? handDirection.clone().cross(modelPosition(index).sub(modelPosition(little))).normalize() : new Vector3(0, -1, 0);
      if (palmNormal.lengthSq() < 0.01) palmNormal.set(0, -1, 0);
      // Standard MMD T/A-pose palms face down. Cross products alone reverse on the other hand.
      if (palmNormal.y > 0) palmNormal.negate();
      const fingers: Arm['fingers'] = [];
      const names = [['親指', 'thumb'], ['人指', 'index'], ['中指', 'middle'], ['薬指', 'ring'], ['小指', 'little']] as const;
      for (const [finger, en] of names) for (let jointIndex = finger === '親指' ? 0 : 1; jointIndex <= 3; jointIndex++) {
        const aliases = [`${prefix}${finger}${jointIndex}`, `${english}${en}${jointIndex}`];
        if (finger === '人指') aliases.push(`${prefix}人差指${jointIndex}`, `${prefix}人差し指${jointIndex}`);
        const anatomical = ['metacarpal', 'proximal', 'intermediate', 'distal'][jointIndex];
        aliases.push(`${english}${en}${anatomical}`);
        const node = find(...aliases), joint = capture(node);
        if (!joint) continue;
        // Use the finger segment direction; PMX can author non-identity local rotations.
        const child = node!.children.find(c => c instanceof Bone);
        const direction = child ? child.getWorldPosition(new Vector3()).sub(node!.getWorldPosition(new Vector3())).transformDirection(mesh.matrixWorld.clone().invert()) : new Vector3(side, 0, 0);
        const axis = direction.clone().cross(palmNormal).normalize();
        if (axis.lengthSq() < 0.01) axis.set(0, 0, -side);
        axis.applyQuaternion(mesh.getWorldQuaternion(new Quaternion())).applyQuaternion(node!.getWorldQuaternion(new Quaternion()).invert()).normalize();
        fingers.push({ joint, axis, curl: (finger === '親指' ? 0.055 : 0.12 + names.findIndex(n => n[0] === finger) * 0.02) * [0.6, 1, 1.2, 0.8][jointIndex], thumb: finger === '親指' });
      }
      if (wrist) {
        const toWrist = mesh.getWorldQuaternion(new Quaternion()).premultiply(wrist.node.getWorldQuaternion(new Quaternion()).invert());
        handDirection.applyQuaternion(toWrist).normalize(); palmNormal.applyQuaternion(toWrist).normalize();
      }
      this.arms.push({ side, upper, elbow, wrist, restAngle, handDirection, palmNormal, fingers });
    }
    // Only arm IK chains conflict with these gestures. Preserve feet/hair/skirt IK.
    const armNodes = new Set(this.arms.flatMap(a => [a.upper?.node, a.elbow?.node, a.wrist?.node]).filter(Boolean));
    runtime.pmx?.bones.forEach((bone, index) => {
      if (bone.ik && [bone.ik.target, ...bone.ik.links.map(l => l.target)].some(i => armNodes.has(bones[i]))) runtime.ikSolver?.setEnabled(index, false);
    });
    if (this.arms[1].upper && this.arms[1].elbow && this.arms[1].wrist) this.gestures.push('wave');
    if (this.head) this.gestures.push('nod'); if (this.body) this.gestures.push('bow');
    if (this.arms.every(a => !!a.upper)) this.gestures.push('cheer');
    this.captureMorphs();
    this.lipSync = this.bindings.some(b => ['aa', 'ih', 'ou', 'ee', 'oh'].includes(b.channel));
  }

  private captureMorphs() {
    const dict = this.runtime.mesh.morphTargetDictionary ?? {}, metadata = this.runtime.pmx?.morphs;
    const entries = Object.entries(dict).map(([name, index]) => ({ name: normalize(name), index, meta: metadata?.[index] }));
    const dependencies = (index: number, seen = new Set<number>()): Set<number> => {
      if (seen.has(index)) return seen; seen.add(index);
      const morph = metadata?.[index];
      if (morph?.type === 0) Array.from(morph.indices ?? []).forEach(i => dependencies(i, seen));
      return seen;
    };
    const add = (entry: typeof entries[number] | undefined, channel: Binding['channel'], emotion?: MmdAvatarEmotion) => {
      if (!entry) return;
      const existing = this.bindings.find(b => b.index === entry.index);
      if (existing) {
        if (existing.channel === channel && emotion && !existing.emotions?.includes(emotion)) existing.emotions?.push(emotion);
        return;
      }
      this.bindings.push({ index: entry.index, base: this.runtime.mesh.morphTargetInfluences?.[entry.index] ?? 0, channel, emotions: emotion ? [emotion] : undefined, dependencies: dependencies(entry.index) });
    };
    const pick = (names: string[], category?: number) => {
      for (const name of names) {
        const entry = entries.find(e => e.name === name && (category === undefined || e.meta?.category === undefined || e.meta.category === category));
        if (entry) return entry;
      }
      return undefined;
    };
    // One morph per vowel. Never activate alternate あ2/あ小 aliases simultaneously.
    for (const [vowel, names] of Object.entries({ aa: ['あ', 'a', 'aa', 'ah', '口あ', 'mouthopen', 'openmouth'], ih: ['い', 'i', 'ih', '口い'], ou: ['う', 'u', 'ou', '口う'], ee: ['え', 'e', 'ee', '口え', 'えー'], oh: ['お', 'o', 'oh', '口お'] })) add(pick(names), vowel as MmdAvatarVowel);
    const blink = pick(['まばたき', '瞬き', 'blink', 'eyeclose', 'closeeye']);
    if (blink) add(blink, 'blink');
    else {
      // Pair a single left/right closure, avoiding wink variants that close the same eye twice.
      const left = pick(['ウィンク', 'winkleft', 'blinkleft', '左まばたき', '左目閉じ']);
      const right = pick(['ウィンク右', 'winkright', 'blinkright', '右まばたき', '右目閉じ']);
      if (left && right) { add(left, 'blink'); add(right, 'blink'); }
    }
    const presets: Record<MmdAvatarEmotion, { brow: string[]; eye: string[]; lip: string[]; face: string[] }> = {
      happy: { brow: ['にこり', 'にっこり'], eye: ['笑い', '笑顔'], lip: ['にやり', '口角上げ'], face: ['happy', 'joy', 'smile', '笑顔'] },
      sad: { brow: ['困る', '悲しい', '悲しみ'], eye: ['悲しい', '悲しみ'], lip: ['口角下げ', 'への字'], face: ['sad', 'sorrow', '悲しい'] },
      angry: { brow: ['怒り', '怒る', '真面目'], eye: ['怒り', 'じと目'], lip: ['への字'], face: ['angry', 'anger', '怒り'] },
      surprised: { brow: ['上', '眉上', '驚き'], eye: ['びっくり', '驚き', '見開き'], lip: [], face: ['surprised', 'surprise', 'shock', '驚き'] },
      relaxed: { brow: ['にこり'], eye: ['なごみ', 'ほっ'], lip: ['にやり'], face: ['relaxed', 'relax', 'calm', '安心'] },
    };
    for (const [emotion, preset] of Object.entries(presets) as [MmdAvatarEmotion, typeof presets[MmdAvatarEmotion]][]) {
      const before = this.bindings.length;
      add(pick(preset.brow, 1), 'brow', emotion); add(pick(preset.eye, 2), 'eye', emotion); add(pick(preset.lip, 3), 'lip', emotion);
      if (before === this.bindings.length) add(pick(preset.face), 'face', emotion);
    }
  }

  /** Premultiply a model-space rotation after transforming its axis into the current parent frame. */
  private rotate(joint: Joint | null, axis: Vector3, angle: number) {
    if (!joint || !angle) return;
    joint.node.parent?.updateWorldMatrix(true, false);
    joint.node.parent?.getWorldQuaternion(this.parentRotation);
    this.axis.copy(axis).applyQuaternion(this.meshRotation).applyQuaternion(this.parentRotation.invert()).normalize();
    this.delta.setFromAxisAngle(this.axis, angle); joint.node.quaternion.premultiply(this.delta);
  }

  pose(f: MmdFrame) {
    for (const j of this.joints) { j.node.quaternion.copy(j.rotation); j.node.position.copy(j.position); }
    this.runtime.mesh.getWorldQuaternion(this.meshRotation);
    const { time: t, envelope: env, gesture: g, gestureTime: gt, progress: gp } = f;
    this.gazeX = avatarRuntimeDamp(this.gazeX, MathUtils.clamp(f.lookX, -0.18, 0.18), 7, f.dt);
    this.gazeY = avatarRuntimeDamp(this.gazeY, MathUtils.clamp(f.lookY, -0.32, 0.32), 7, f.dt);
    const bow = g === 'bow' ? Math.pow(Math.max(0, Math.sin(Math.PI * gp)), 2) : 0;
    this.rotate(this.body, X, Math.sin(t * 1.6) * 0.008 + f.speaking * Math.sin(t * 2.2) * 0.014 + bow * 0.32);
    this.rotate(this.chest, X, bow * 0.16);
    const nod = g === 'nod' ? Math.sin(gp * Math.PI * 2) * env : 0;
    this.rotate(this.neck, X, this.gazeX * 0.3 + nod * 0.09 + bow * 0.07);
    this.rotate(this.head, X, this.gazeX * 0.45 + nod * 0.16 + bow * 0.08);
    this.rotate(this.neck, Y, this.gazeY * 0.35); this.rotate(this.head, Y, this.gazeY * 0.5);
    this.rotate(this.head, Z, f.listening * Math.sin(t * 0.7) * 0.018);
    for (const eye of this.eyes) { this.rotate(eye, Y, this.gazeY * 0.18); this.rotate(eye, X, this.gazeX * 0.18); }
    for (const arm of this.arms) {
      const side = arm.side, wave = g === 'wave' && side === -1 ? env : 0, cheer = g === 'cheer' ? env : 0;
      // The idle pose lowers authored T/A-pose arms. A raised hand has the opposite sign on each side.
      // Raise relative to the calibrated idle angle, not the author's T/A-pose.
      let upperAngle = arm.restAngle + side * (wave * 1.5 + cheer * 2.4);
      upperAngle += side * f.speaking * (0.025 + Math.sin(t * 1.9 + side) * 0.02) * (1 - wave - cheer);
      this.rotate(arm.upper, Z, upperAngle);
      this.rotate(arm.upper, Y, -side * 0.08 * f.speaking * (1 - wave - cheer));
      // All elbow and wrist offsets fade with the same gesture envelope, including the constant terms.
      this.rotate(arm.elbow, Z, side * (wave * 1.22 + cheer * 0.35));
      this.rotate(arm.elbow, Y, -side * (0.10 + f.speaking * 0.06) * (1 - wave - cheer));
      this.rotate(arm.wrist, Z, side * Math.sin(gt * 8) * 0.18 * wave);
      this.rotate(arm.wrist, Y, side * Math.sin(gt * 8) * 0.10 * wave);
      if (arm.wrist && wave > 0) {
        arm.wrist.node.getWorldQuaternion(this.wristRotation);
        this.wristRotation.premultiply(this.meshRotation.clone().invert());
        this.palm.copy(arm.palmNormal).applyQuaternion(this.wristRotation);
        this.handDirection.copy(arm.handDirection).applyQuaternion(this.wristRotation);
        this.palmTarget.copy(Z).addScaledVector(this.handDirection, -Z.dot(this.handDirection));
        if (this.palmTarget.lengthSq() > 0.01) {
          this.palmTarget.normalize();
          const roll = Math.atan2(this.cross.crossVectors(this.palm, this.palmTarget).dot(this.handDirection), this.palm.dot(this.palmTarget));
          this.delta.setFromAxisAngle(arm.handDirection, roll * wave);
          arm.wrist.node.quaternion.multiply(this.delta);
        }
      }
      for (const finger of arm.fingers) {
        const curl = finger.curl * (1 - wave * 0.85) + cheer * (finger.thumb ? 0.06 : 0.26);
        this.delta.setFromAxisAngle(finger.axis, curl);
        finger.joint.node.quaternion.multiply(this.delta);
      }
    }
    this.runtime.mesh.updateMatrixWorld(true);
  }

  expressions(f: MmdFrame) {
    const weights = new Map<number, number>();
    const open = MathUtils.clamp(Object.values(f.mouth).reduce((sum, value) => sum + value, 0), 0, 1);
    for (const b of this.bindings) {
      let value = 0;
      if (b.channel === 'blink') value = f.blink;
      else if (['aa', 'ih', 'ou', 'ee', 'oh'].includes(b.channel)) {
        value = f.mouth[b.channel as MmdAvatarVowel];
        // Missing え is common in PMD. Use a modest い shape rather than losing that syllable.
        if (b.channel === 'ih' && !this.bindings.some(m => m.channel === 'ee')) value += f.mouth.ee * 0.65;
      } else if (b.emotions) {
        value = Math.min(1, b.emotions.reduce((sum, emotion) => sum + f.emotions[emotion], 0));
        if (b.channel === 'eye') value *= (1 - f.blink) * 0.65;
        if (b.channel === 'lip' || b.channel === 'face') value *= 1 - open;
        if (b.channel === 'face') value *= 1 - f.blink;
      }
      weights.set(b.index, MathUtils.clamp(b.base + value, 0, 1));
    }
    // Speech and blink take priority over an overlapping full-face group. Select winners
    // before smoothing so two groups cannot accidentally suppress each other.
    const priority = (b: Binding) => b.channel === 'blink' ? 5 : ['aa', 'ih', 'ou', 'ee', 'oh'].includes(b.channel) ? 4 : b.channel === 'face' ? 1 : 2;
    const claimed = new Set<number>(), suppressed = new Set<number>();
    for (const b of [...this.bindings].sort((a, b) => priority(b) - priority(a))) {
      if ((weights.get(b.index) ?? 0) <= 0.001) continue;
      if ([...b.dependencies].some(i => claimed.has(i))) { weights.set(b.index, 0); suppressed.add(b.index); }
      else for (const i of b.dependencies) claimed.add(i);
    }
    const influences = this.runtime.mesh.morphTargetInfluences;
    if (!influences) return;
    for (const b of this.bindings) influences[b.index] = suppressed.has(b.index) ? 0 : avatarRuntimeDamp(influences[b.index] ?? b.base, weights.get(b.index) ?? 0, b.channel === 'blink' ? 45 : 22, f.dt);
    // Cross-fading vowels/emotions must never exceed the shape budget for a facial region.
    for (const channels of [['aa', 'ih', 'ou', 'ee', 'oh', 'lip', 'face'], ['eye', 'blink', 'face'], ['brow', 'face']]) {
      const region = this.bindings.filter(b => channels.includes(b.channel));
      // Left/right blink fallback deforms disjoint eyes; count it as one closure.
      const blinkPair = region.filter(b => b.channel === 'blink').length === 2;
      const total = region.reduce((sum, b) => sum + influences[b.index] * (blinkPair && b.channel === 'blink' ? 0.5 : 1), 0);
      if (total > 1) for (const b of region) influences[b.index] /= total;
    }
  }
}


export { disposeAvatarObject };
export { normalizeAvatarObject };
export { selectIdleClip };
export type { Vowel };
export type { Emotion };
export { LipSync };
export type { MmdRuntime };
export type { MmdFrame };
export { MmdAvatarController };
