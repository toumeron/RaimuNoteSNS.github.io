// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { disposeAvatarObject, normalizeAvatarObject, selectIdleClip } from './avatarRuntime';

describe('avatar runtime', () => {
  it('centers and grounds models without overwriting their authored rotation or scale', () => {
    const object = new Mesh(new BoxGeometry(1, 3, 1), new MeshStandardMaterial());
    object.position.set(12, -7, 4); object.rotation.set(0, .7, .1); object.scale.set(2, 1, 2);
    const position = object.position.clone(), rotation = object.quaternion.clone(), scale = object.scale.clone();
    const { box, size } = normalizeAvatarObject(object);
    expect(size.y).toBeCloseTo(1.55);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.getCenter(object.position.clone()).x).toBeCloseTo(0);
    expect(object.position.equals(position)).toBe(true);
    expect(object.quaternion.equals(rotation)).toBe(true);
    expect(object.scale.equals(scale)).toBe(true);
  });
  it('rejects empty geometry instead of producing an invisible or invalid camera', () => {
    expect(() => normalizeAvatarObject(new Group())).toThrow('立体');
  });
  it('chooses idle rather than the first death, walk or attack clip', () => {
    const clips = ['Death', 'Walking', 'Armature|Idle', 'Wave'].map((name) => new AnimationClip(name, 1, []));
    expect(selectIdleClip(clips)?.name).toBe('Armature|Idle');
    expect(selectIdleClip(clips.slice(0, 2))).toBeUndefined();
  });
  it('disposes shared textures, geometry and materials exactly once', () => {
    const texture = new Texture(), geometry = new BoxGeometry(), material = new MeshStandardMaterial({ map: texture });
    const root = new Group(); root.add(new Mesh(geometry, material), new Mesh(geometry, material));
    const textureDispose = vi.spyOn(texture, 'dispose'), geometryDispose = vi.spyOn(geometry, 'dispose'), materialDispose = vi.spyOn(material, 'dispose');
    disposeAvatarObject(root);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});
