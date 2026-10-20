// avatarModels
type ModelFormat = "vrm" | "glb" | "gltf" | "fbx" | "obj" | "mmd" | "archive";
type ModelSource =
  | { kind: "url"; url: string; name: string; format?: ModelFormat }
  | { kind: "blob"; blob: Blob; name: string; format?: ModelFormat };

const MODEL_ACCEPT = ".vrm,.glb,.gltf,.fbx,.obj,.pmx,.pmd,.zip";
const MODEL_FORMAT_LABEL = "VRM / GLB / glTF / FBX / OBJ / PMX / PMD / ZIP";
function isSupportedModelFile(name: string) {
  return /\.(vrm|glb|gltf|fbx|obj|pmx|pmd|zip)$/i.test(name);
}
function inferModelFormat(name: string): ModelFormat {
  const ext = name.split(/[?#]/)[0].toLowerCase().split(".").pop();
  if (ext === "zip") return "archive";
  if (ext === "pmx" || ext === "pmd") return "mmd";
  if (ext === "vrm" || ext === "gltf" || ext === "fbx" || ext === "obj") return ext;
  return "glb";
}

const BUILTIN_MODELS = [
  { id: "default", name: "アリア（VRM 1.0 サンプル）", file: "vrm1-sample.vrm", format: "vrm" },
  { id: "vrm0-girl", name: "リナ（VRM 0.x サンプル）", file: "vrm0-girl.vrm", format: "vrm" },
  { id: "robot-expressive", name: "ロボット（RobotExpressive / CC0）", file: "robot-expressive.glb", format: "glb" },
] as const;

type ZipEntry = { name: string; data: Uint8Array; compression: number };

function decodeZipName(bytes: Uint8Array, utf8Flag: boolean) {
  if (utf8Flag) return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) return utf8;
  try { return new TextDecoder("shift_jis").decode(bytes); } catch { return utf8; }
}

function zipPath(name: string) {
  const out: string[] = [];
  for (const part of name.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function zipMime(name: string) {
  const ext = name.toLowerCase().split(".").pop() || "";
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    bin: "application/octet-stream", gltf: "model/gltf+json", glb: "model/gltf-binary", vrm: "model/gltf-binary",
    bmp: "image/bmp", tga: "image/x-targa", vpd: "text/plain",
  } as Record<string, string>)[ext] || "application/octet-stream";
}

async function unzipModelArchive(file: Blob): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = 22;
  const start = Math.max(0, bytes.length - minEocd - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - minEocd; i >= start; i--) {
    if (i >= 0 && dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIPの終端情報を読み取れませんでした");

  const count = dv.getUint16(eocd + 10, true);
  const centralSize = dv.getUint32(eocd + 12, true);
  const centralOffset = dv.getUint32(eocd + 16, true);
  if (centralOffset + centralSize > bytes.length) throw new Error("ZIPの中央ディレクトリが壊れています");
  if (count > 800) throw new Error("ZIP内のファイル数が多すぎます (800ファイルまで)");

  const entries: ZipEntry[] = [];
  let pos = centralOffset;
  let totalUncompressed = 0;
  const MAX_EXTRACTED = 450 * 1024 * 1024;

  for (let i = 0; i < count; i++) {
    if (pos + 46 > centralOffset + centralSize) throw new Error("ZIPのエントリが壊れています");
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error("ZIPのエントリを読み取れませんでした");
    const flags = dv.getUint16(pos + 8, true);
    const compression = dv.getUint16(pos + 10, true);
    const compressedSize = dv.getUint32(pos + 20, true);
    const uncompressedSize = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localOffset = dv.getUint32(pos + 42, true);
    if (flags & 1) throw new Error("暗号化ZIPには対応していません");
    if (pos + 46 + nameLen + extraLen + commentLen > centralOffset + centralSize) throw new Error("ZIPのファイル名が壊れています");
    const nameBytes = bytes.slice(pos + 46, pos + 46 + nameLen);
    const name = zipPath(decodeZipName(nameBytes, (flags & 0x800) !== 0));
    pos += 46 + nameLen + extraLen + commentLen;
    if (!name || /[\\/]$/.test(decodeZipName(nameBytes, (flags & 0x800) !== 0))) continue;

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_EXTRACTED) throw new Error("ZIP展開後のサイズが大きすぎます (450MBまで)");
    if (localOffset + 30 > bytes.length || dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ZIPのローカルヘッダーが壊れています");
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error(`ZIP内のファイルが壊れています: ${name}`);
    const compressed = bytes.slice(dataStart, dataEnd);

    let data: Uint8Array;
    if (compression === 0) {
      data = compressed;
    } else if (compression === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("このブラウザはZIP展開に対応していません。Chrome / Edge / Safariの最新版をお使いください");
      const compressedBuffer = new Uint8Array(compressed.byteLength);
      compressedBuffer.set(compressed);
      const stream = new Blob([compressedBuffer.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error(`未対応のZIP圧縮方式です (${compression}: ${name})`);
    }
    if (data.length !== uncompressedSize) throw new Error(`ZIP展開サイズが一致しません: ${name}`);
    if (entries.some((e) => e.name.toLowerCase() === name.toLowerCase())) throw new Error(`ZIP内に同名のファイルがあります: ${name}`);
    entries.push({ name, data, compression });
  }

  return entries;
}

/** Prefer a self-contained avatar; use a stable path order if a package contains variants. */
function pickArchiveModel(entries: ZipEntry[]) {
  const rank: Record<string, number> = { vrm: 0, glb: 1, gltf: 2, fbx: 3, obj: 4, pmx: 5, pmd: 6 };
  return entries.filter((e) => /\.(vrm|glb|gltf|fbx|obj|pmx|pmd)$/i.test(e.name)).sort((a, b) => {
    const score = (e: ZipEntry) => rank[e.name.toLowerCase().split(".").pop()!] * 1000 + e.name.split("/").length;
    return score(a) - score(b) || a.name.localeCompare(b.name);
  })[0];
}

/** Resolve package resources relative to the actual model, without confusing identical basenames. */
function createArchiveResolver(entries: ZipEntry[], urls: Map<string, string>, modelName: string) {
  const base = new URL(modelName, "https://limeai.local/package/").href;
  return (requested: string) => {
    if (/^(blob:|data:)/i.test(requested)) return requested;
    let decoded = requested;
    try { decoded = decodeURIComponent(requested); } catch { /* retain filename */ }
    decoded = decoded.replace(/\\/g, "/");
    const url = new URL(decoded, base);
    const prefix = "/package/";
    let path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : decoded;
    try { path = decodeURIComponent(path); } catch { /* retain filename */ }
    path = zipPath(path).toLowerCase();
    const exact = urls.get(path);
    if (exact) return exact;
    // FBX files can contain an absolute authoring-machine path.
    const basename = path.split("/").pop();
    const candidates = entries.filter((e) => e.name.toLowerCase().split("/").pop() === basename);
    if (candidates.length === 1) return urls.get(candidates[0].name.toLowerCase())!;
    throw new Error(`ZIP内の参照ファイルが見つからないか曖昧です: ${path}。テクスチャとbin/mtlを同じZIPに含めてください`);
  };
}

// avatarModelStore
const DB_NAME = "limeai-avatar";
const STORE = "models";

type StoredModel = { id: string; name: string; blob: Blob; createdAt: number; format?: ModelFormat };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        let result: T;
        r.onsuccess = () => { result = r.result; };
        t.oncomplete = () => { db.close(); resolve(result); };
        t.onabort = () => { db.close(); reject(t.error || r.error || new Error("モデル保存を完了できませんでした")); };
        t.onerror = () => { db.close(); reject(t.error || r.error); };
      }),
  );
}

const listModels = () => tx<StoredModel[]>("readonly", (s) => s.getAll());
const putModel = (m: StoredModel) => tx("readwrite", (s) => s.put(m));
const deleteModel = (id: string) => tx("readwrite", (s) => s.delete(id));
const getModel = (id: string) => tx<StoredModel | undefined>("readonly", (s) => s.get(id));

// avatarLighting
type AvatarLuminance = {
  median: number;
  upper: number;
  highlight: number;
  clipped: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Measure rendered sRGB pixels, excluding transparent background and antialiased edges. */
function measureAvatarLuminance(pixels: Uint8ClampedArray): AvatarLuminance | null {
  const values: number[] = [];
  let clipped = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 230) continue;
    const value = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    values.push(value);
    if (value > 0.96) clipped++;
  }
  if (values.length < 24) return null;
  values.sort((a, b) => a - b);
  const percentile = (p: number) => values[Math.floor((values.length - 1) * p)];
  return { median: percentile(0.5), upper: percentile(0.7), highlight: percentile(0.95), clipped: clipped / values.length };
}

/** Bounded feedback with a dead band avoids flicker from blinking and small movements. */
function nextAvatarExposure(current: number, stats: AvatarLuminance): number {
  let ratio = 0.74 / Math.max(0.035, stats.upper);
  if (stats.highlight > 0.94) ratio = Math.min(ratio, 0.94 / stats.highlight);
  if (stats.clipped > 0.05) ratio = Math.min(ratio, 0.88);
  if (Math.abs(ratio - 1) < 0.055) return current;
  return clamp(current * Math.pow(clamp(ratio, 0.65, 1.5), 0.55), 0.12, 3.5);
}

/** Keep the background quieter than the model, while preserving the selected theme. */
function avatarBackgroundLightness(stats: AvatarLuminance | null, night: boolean): number {
  const model = stats?.median ?? 0.5;
  return night ? clamp(0.25 - model * 0.28, 0.08, 0.20) : clamp(0.66 - model * 0.65, 0.25, 0.40);
}

/** Time-based interpolation with a speed limit; exposure is interpolated in stops. */
function animateAvatarLight(current: number, target: number, dt: number, logarithmic = false): number {
  const time = clamp(dt, 0, 0.05);
  const a = logarithmic ? Math.log(Math.max(0.001, current)) : current;
  const b = logarithmic ? Math.log(Math.max(0.001, target)) : target;
  const change = (b - a) * (1 - Math.exp(-1.6 * time));
  const limit = (logarithmic ? 0.4 : 0.08) * time;
  const next = a + clamp(change, -limit, limit);
  return logarithmic ? Math.exp(next) : next;
}

// avatarMorphs
type AvatarVowel = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';
type AvatarEmotion = 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed';

/** Common glTF/FBX morph conventions: VRoid, Ready Player Me, VRChat and ARKit. */
function classifyAvatarMorph(name: string) {
  const n = name.toLowerCase().replace(/[\s_.:-]/g, '');
  const vowelPatterns: [AvatarVowel, RegExp][] = [
    ['aa', /^(aa|a|あ|mouthopen|jawopen|visemeaa|mtha|fclmtha|vrcvaa)$|fclmtha$/],
    ['ih', /^(ih|i|い|visemeih|mthi|fclmthi|vrcvih)$|fclmthi$/],
    ['ou', /^(ou|u|う|visemeou|mthu|fclmthu|vrcvou)$|fclmthu$/],
    ['ee', /^(ee|e|え|visemeee|mthe|fclmthe|vrcvee)$|fclmthe$/],
    ['oh', /^(oh|o|お|visemeoh|mtho|fclmtho|vrcvoh)$|fclmtho$/],
  ];
  const emotionPatterns: [AvatarEmotion, RegExp][] = [
    ['happy', /^(happy|joy|smile|mouthsmile(left|right)?)$|fclalljoy$/],
    ['sad', /^(sad|sorrow)$|fclallsorrow$/],
    ['angry', /^(angry|anger)$|fclallangry$/],
    ['surprised', /^(surprised|surprise|shock)$|fclallsurprised$/],
    ['relaxed', /^(relaxed|relax|calm)$|fclallfun$/],
  ];
  return {
    vowel: vowelPatterns.find(([, pattern]) => pattern.test(n))?.[0] ?? null,
    emotion: emotionPatterns.find(([, pattern]) => pattern.test(n))?.[0] ?? null,
    blink: /^(blink|eyeblink(left|right)?|eyeclose(left|right)?|eyesclosed)$|fcleyeclose(left|right|l|r)?$/.test(n),
  };
}

export { isSupportedModelFile };
export { inferModelFormat };
export { zipPath };
export { zipMime };
export { unzipModelArchive };
export { pickArchiveModel };
export { createArchiveResolver };
export type { ModelFormat };
export type { ModelSource };
export { MODEL_ACCEPT };
export { MODEL_FORMAT_LABEL };
export { BUILTIN_MODELS };
export type { ZipEntry };
export type { StoredModel };
export { listModels };
export { putModel };
export { deleteModel };
export { getModel };
export { measureAvatarLuminance };
export { nextAvatarExposure };
export { avatarBackgroundLightness };
export { animateAvatarLight };
export type { AvatarLuminance };
export { classifyAvatarMorph };
export type { AvatarVowel };
export type { AvatarEmotion };
