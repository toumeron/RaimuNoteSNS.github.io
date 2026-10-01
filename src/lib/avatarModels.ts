export type ModelFormat = "vrm" | "glb" | "gltf" | "fbx" | "obj" | "mmd" | "archive";
export type ModelSource =
  | { kind: "url"; url: string; name: string; format?: ModelFormat }
  | { kind: "blob"; blob: Blob; name: string; format?: ModelFormat };

export const MODEL_ACCEPT = ".vrm,.glb,.gltf,.fbx,.obj,.pmx,.pmd,.zip";
export const MODEL_FORMAT_LABEL = "VRM / GLB / glTF / FBX / OBJ / PMX / PMD / ZIP";
export function isSupportedModelFile(name: string) {
  return /\.(vrm|glb|gltf|fbx|obj|pmx|pmd|zip)$/i.test(name);
}
export function inferModelFormat(name: string): ModelFormat {
  const ext = name.split(/[?#]/)[0].toLowerCase().split(".").pop();
  if (ext === "zip") return "archive";
  if (ext === "pmx" || ext === "pmd") return "mmd";
  if (ext === "vrm" || ext === "gltf" || ext === "fbx" || ext === "obj") return ext;
  return "glb";
}

export const BUILTIN_MODELS = [
  { id: "default", name: "アリア（VRM 1.0 サンプル）", file: "vrm1-sample.vrm", format: "vrm" },
  { id: "vrm0-girl", name: "リナ（VRM 0.x サンプル）", file: "vrm0-girl.vrm", format: "vrm" },
  { id: "robot-expressive", name: "ロボット（RobotExpressive / CC0）", file: "robot-expressive.glb", format: "glb" },
] as const;

export type ZipEntry = { name: string; data: Uint8Array; compression: number };

function decodeZipName(bytes: Uint8Array, utf8Flag: boolean) {
  if (utf8Flag) return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) return utf8;
  try { return new TextDecoder("shift_jis").decode(bytes); } catch { return utf8; }
}

export function zipPath(name: string) {
  const out: string[] = [];
  for (const part of name.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export function zipMime(name: string) {
  const ext = name.toLowerCase().split(".").pop() || "";
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    bin: "application/octet-stream", gltf: "model/gltf+json", glb: "model/gltf-binary", vrm: "model/gltf-binary",
    bmp: "image/bmp", tga: "image/x-targa", vpd: "text/plain",
  } as Record<string, string>)[ext] || "application/octet-stream";
}

export async function unzipModelArchive(file: Blob): Promise<ZipEntry[]> {
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
export function pickArchiveModel(entries: ZipEntry[]) {
  const rank: Record<string, number> = { vrm: 0, glb: 1, gltf: 2, fbx: 3, obj: 4, pmx: 5, pmd: 6 };
  return entries.filter((e) => /\.(vrm|glb|gltf|fbx|obj|pmx|pmd)$/i.test(e.name)).sort((a, b) => {
    const score = (e: ZipEntry) => rank[e.name.toLowerCase().split(".").pop()!] * 1000 + e.name.split("/").length;
    return score(a) - score(b) || a.name.localeCompare(b.name);
  })[0];
}

/** Resolve package resources relative to the actual model, without confusing identical basenames. */
export function createArchiveResolver(entries: ZipEntry[], urls: Map<string, string>, modelName: string) {
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
