import {useEffect, useRef, useState} from 'react';
import type {VRM} from '@pixiv/three-vrm';
import type * as THREE from 'three';
import {LipSync, type Vowel, type Emotion} from '@/lib/avatarLipSync';
import {classifyAvatarMorph} from '@/lib/avatarMorphs';
import {measureAvatarLuminance, nextAvatarExposure, avatarBackgroundLightness, animateAvatarLight} from '@/lib/avatarLighting';
import {MODEL_FORMAT_LABEL,inferModelFormat, unzipModelArchive, pickArchiveModel, createArchiveResolver, zipMime, type ModelSource, type ZipEntry} from '@/lib/avatarModels';
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
  pmx?: import("@/lib/mmdAvatar").MmdRuntime["pmx"];
  ikSolver?: import("@/lib/mmdAvatar").MmdRuntime["ikSolver"];
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
  runtime: typeof import("@/lib/avatarRuntime");
  mmdAvatar: typeof import("@/lib/mmdAvatar");
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
    renderer.setAnimationLoop(() => {
      if (document.hidden) return;
      const ts = performance.now();
      if (companion && ts - lastTs < 1000 / 30) return;
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;
      update(dt);
      animateLighting(dt);
      renderer.render(scene, cam);
      meterLighting(ts);
    });

    return () => {
      disposed = true;
      loadToken++;
      activeLoad?.abort();
      draco.dispose();
      renderer.setAnimationLoop(null);
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
      import("@/lib/avatarRuntime"),
      import("@/lib/mmdAvatar"),
    ])
      .then(([THREE, vrm, gltf, mmd, fbx, obj, mtl, draco, meshopt, runtime, mmdAvatar]) => {
        if (cancelled) return;
        setLibs({
          THREE, runtime, mmdAvatar,
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

