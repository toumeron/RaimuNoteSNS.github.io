// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { inferModelFormat, isSupportedModelFile, unzipModelArchive, pickArchiveModel, createArchiveResolver, zipPath } from './avatarModels';

const fixture = (name: string) => new Blob([readFileSync(new URL(`../../tests/avatar/fixtures/${name}`, import.meta.url))]);
describe('avatar model formats and archives', () => {
  it.each([
    ['Avatar.VRM', 'vrm'], ['avatar.GLB', 'glb'], ['avatar.gltf', 'gltf'], ['avatar.fbx', 'fbx'],
    ['avatar.obj', 'obj'], ['avatar.pmx', 'mmd'], ['avatar.pmd', 'mmd'], ['avatar.zip', 'archive'],
  ])('accepts %s and routes to %s', (name, format) => {
    expect(isSupportedModelFile(name)).toBe(true);
    expect(inferModelFormat(name)).toBe(format);
  });
  it.each(['avatar.exe', 'avatar.glb.html', 'avatar', 'avatar.png'])('rejects %s', (name) => {
    expect(isSupportedModelFile(name)).toBe(false);
  });
  it('extracts deflated glTF and relative bin resources', async () => {
    const entries = await unzipModelArchive(fixture('gltf-package.zip'));
    expect(entries.map((e) => e.name)).toEqual(['avatar/model.gltf', 'buffers/body.bin']);
    expect(pickArchiveModel(entries)?.name).toBe('avatar/model.gltf');
    expect(entries[1].data.byteLength).toBe(36);
  });
  it('retains Japanese filenames in compressed MMD packages', async () => {
    const entries = await unzipModelArchive(fixture('mmd-package.zip'));
    expect(pickArchiveModel(entries)?.name).toBe('日本語/avatar.pmx');
  });
  it('does not mistake a ZIP directory for a file', async () => {
    expect(await unzipModelArchive(fixture('no-model.zip'))).toHaveLength(1);
    expect(pickArchiveModel(await unzipModelArchive(fixture('no-model.zip')))).toBeUndefined();
  });
  it('reports malformed archives', async () => {
    await expect(unzipModelArchive(fixture('broken.zip'))).rejects.toThrow('ZIPの終端');
  });
  it('resolves subdirectories, unicode and backslashes without mixing identical basenames', () => {
    const entries = ['人物/model.gltf', '人物/textures/skin.png', 'other/skin.png'].map((name) => ({ name, data: new Uint8Array(), compression: 0 }));
    const urls = new Map(entries.map((e, i) => [e.name.toLowerCase(), `blob:fixture${i}`]));
    const resolve = createArchiveResolver(entries, urls, '人物/model.gltf');
    expect(resolve('textures\\skin.png')).toBe('blob:fixture1');
    expect(resolve('https://limeai.local/package/%E4%BA%BA%E7%89%A9/textures/skin.png')).toBe('blob:fixture1');
    expect(resolve('data:image/png;base64,test')).toBe('data:image/png;base64,test');
    expect(() => resolve('missing/skin.png')).toThrow('曖昧');
  });
  it('normalizes legacy archive paths', () => {
    expect(zipPath('モデル\\textures\\..\\face.png')).toBe('モデル/face.png');
  });
});
