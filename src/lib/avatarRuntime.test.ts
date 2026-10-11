import { describe, expect, it, vi } from "vitest";
import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { disposeAvatarObject, normalizeAvatarObject, selectIdleClip } from "./avatarRuntime";
import { animateAvatarLight, avatarBackgroundLightness, measureAvatarLuminance, nextAvatarExposure } from "./avatarLighting";
import { classifyAvatarMorph } from "./avatarMorphs";

describe("avatarRuntime", () => {
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
});

describe("avatarLighting", () => {
const pixels = (levels: number[], alpha = 255) => new Uint8ClampedArray(levels.flatMap((v) => [v, v, v, alpha]));
const stats = (level: number) => measureAvatarLuminance(pixels(Array(100).fill(level)))!;

describe('automatic lighting from rendered pixels', () => {
  it('ignores transparent background and antialiased edges', () => {
    expect(measureAvatarLuminance(pixels(Array(100).fill(255), 0))).toBeNull();
    expect(measureAvatarLuminance(pixels(Array(100).fill(255), 128))).toBeNull();
    const mixed = new Uint8ClampedArray([...pixels(Array(100).fill(128)), ...pixels(Array(900).fill(255), 0)]);
    expect(measureAvatarLuminance(mixed)?.upper).toBeCloseTo(128 / 255);
  });
  it('raises dark exposure and lowers bright exposure including clipped highlights', () => {
    expect(nextAvatarExposure(0.8, stats(50))).toBeGreaterThan(0.8);
    expect(nextAvatarExposure(0.8, stats(255))).toBeLessThan(0.8);
    expect(nextAvatarExposure(1, { median: 0.4, upper: 0.68, highlight: 1, clipped: 0.2 })).toBeLessThan(1);
  });
  it('stays steady inside the dead band and bounds extreme correction', () => {
    expect(nextAvatarExposure(1, stats(189))).toBe(1);
    expect(nextAvatarExposure(3.5, stats(0))).toBe(3.5);
    expect(nextAvatarExposure(0.12, stats(255))).toBe(0.12);
  });
  it('adjusts the backdrop for model brightness and theme with bounded values', () => {
    expect(avatarBackgroundLightness(stats(210), false)).toBeLessThan(avatarBackgroundLightness(stats(70), false));
    expect(avatarBackgroundLightness(stats(210), true)).toBeLessThan(avatarBackgroundLightness(stats(70), true));
    expect(avatarBackgroundLightness(stats(255), false)).toBeLessThanOrEqual(0.40);
    expect(avatarBackgroundLightness(stats(0), true)).toBeGreaterThanOrEqual(0.08);
    expect(stats(189).upper - avatarBackgroundLightness(stats(189), false)).toBeGreaterThan(0.35);
  });
  it('animates exposure without jumps in either direction even after a delayed frame', () => {
    for (const [current, target] of [[0.2, 3], [3, 0.2]]) {
      const next = animateAvatarLight(current, target, 1, true);
      expect(Math.abs(Math.log(next / current))).toBeLessThanOrEqual(0.020001);
      expect(next).toBeGreaterThan(Math.min(current, target));
      expect(next).toBeLessThan(Math.max(current, target));
    }
    expect(animateAvatarLight(1, 1, 0.016, true)).toBe(1);
  });
  it('moves the background continuously and gives the same speed across frame rates', () => {
    expect(Math.abs(animateAvatarLight(0.4, 0.1, 1) - 0.4)).toBeLessThanOrEqual(0.004001);
    const advance = (fps: number) => {
      let value = 0.4;
      for (let i = 0; i < fps; i++) value = animateAvatarLight(value, 0.1, 1 / fps);
      return value;
    };
    expect(advance(30)).toBeCloseTo(advance(120), 5);
  });
});
});

describe("avatarMorphs", () => {
it.each([
  ['Face_Blendshape.Fcl_MTH_A', 'aa'], ['vrc.v_ih', 'ih'], ['viseme_ou', 'ou'], ['Fcl_MTH_E', 'ee'], ['mouth_open', 'aa'], ['jawOpen', 'aa'], ['vrc.v_oh', 'oh'],
])('supports mouth convention %s', (name, vowel) => expect(classifyAvatarMorph(name).vowel).toBe(vowel));
it.each(['eyeBlinkLeft', 'eyeBlinkRight', 'Face_Blendshape.Fcl_EYE_Close', 'blink'])('supports blink convention %s', (name) => expect(classifyAvatarMorph(name).blink).toBe(true));
it('keeps unrelated facial morphs neutral and identifies RobotExpressive emotions', () => {
  expect(classifyAvatarMorph('extra')).toEqual({ vowel: null, emotion: null, blink: false });
  expect(classifyAvatarMorph('Surprised').emotion).toBe('surprised');
  expect(classifyAvatarMorph('Sad').emotion).toBe('sad');
});
});
