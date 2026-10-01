// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Bone, BufferGeometry, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { MmdAvatarController, type MmdFrame, type MmdRuntime } from './mmdAvatar';
const frame = (overrides: Partial<MmdFrame> = {}): MmdFrame => ({ time: 0, dt: 1 / 60, speaking: 0, listening: 0, lookX: 0, lookY: 0, gesture: null, progress: 0, envelope: 0, gestureTime: 0, mouth: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }, emotions: { happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0 }, blink: 0, ...overrides });
function rig(rotatedAxes = false, authoredArmAngle = 0) {
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
  const bones: Bone[] = [];
  const add = (name: string, parent: Bone | SkinnedMesh, pos: number[]) => { const b = new Bone(); b.name = name; b.position.fromArray(pos); parent.add(b); bones.push(b); return b; };
  const center = add('センター', mesh, [0, 0, 0]);
  const body = add('上半身', center, [0, 1, 0]); const head = add('頭', body, [0, 1, 0]);
  add('左目', head, [0.08, 0.1, 0.08]); add('右目', head, [-0.08, 0.1, 0.08]);
  for (const [prefix, side] of [['左', 1], ['右', -1]] as const) {
    const shoulder = add(prefix + '肩', body, [side * 0.15, 0.8, 0]);
    shoulder.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), side * authoredArmAngle);
    const upper = add(prefix + '腕', shoulder, [side * 0.12, 0, 0]);
    if (rotatedAxes) upper.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    const twist = add(prefix + '腕捩', upper, [side * 0.12, 0, 0]);
    const elbow = add(prefix + 'ひじ', twist, [side * 0.22, 0, 0]);
    const wrist = add(prefix + '手首', elbow, [side * 0.30, 0, 0]);
    const finger = add(prefix + '人指１', wrist, [side * 0.05, 0, 0]);
    const f2 = add(prefix + '人指２', finger, [side * 0.05, 0, 0]); add(prefix + '人指３', f2, [side * 0.04, 0, 0]);
  }
  add('左足ＩＫ', mesh, [0.1, 0, 0]); add('右手ＩＫ', mesh, [-1, 2, 0]);
  mesh.bind(new Skeleton(bones)); mesh.updateMatrixWorld(true);
  return { mesh, bones, bone: (name: string) => bones.find(b => b.name === name)! };
}
const position = (b: Bone) => b.getWorldPosition(new Vector3());
const advance = (controller: MmdAvatarController, f: MmdFrame, count = 90) => { for (let i = 0; i < count; i++) controller.expressions(f); };
function facial(names: string[], categories?: number[]) {
  const r = rig(); r.mesh.morphTargetDictionary = Object.fromEntries(names.map((n, i) => [n, i])); r.mesh.morphTargetInfluences = names.map(() => 0);
  const runtime: MmdRuntime = { mesh: r.mesh, pmx: { bones: [], morphs: names.map((name, i) => ({ name, category: categories?.[i], type: 1 })) } };
  const controller = new MmdAvatarController(runtime);
  return { controller, runtime, value: (name: string) => r.mesh.morphTargetInfluences![names.indexOf(name)] };
}
describe('MMD hands and skeleton', () => {
  for (const rotatedAxes of [false, true]) it(`lowers both arms and raises the right hand with local axes rotated=${rotatedAxes}`, () => {
    const r = rig(rotatedAxes), c = new MmdAvatarController({ mesh: r.mesh });
    c.pose(frame());
    for (const side of ['左', '右']) { expect(position(r.bone(side + '手首')).y).toBeLessThan(position(r.bone(side + 'ひじ')).y); expect(position(r.bone(side + 'ひじ')).y).toBeLessThan(position(r.bone(side + '腕')).y); }
    c.pose(frame({ gesture: 'wave', envelope: 1, progress: 0.5, gestureTime: 1 }));
    expect(position(r.bone('右手首')).y).toBeGreaterThan(position(r.bone('右腕')).y);
    expect(position(r.bone('左手首')).y).toBeLessThan(position(r.bone('左腕')).y);
  });
  for (const authoredArmAngle of [-0.5, -1.1]) it(`calibrates raised hands from an A-pose at ${authoredArmAngle} radians`, () => {
    const r = rig(false, authoredArmAngle), c = new MmdAvatarController({ mesh: r.mesh });
    c.pose(frame({ gesture: 'wave', envelope: 1 }));
    expect(position(r.bone('右ひじ')).y).toBeGreaterThan(position(r.bone('右腕')).y);
    expect(position(r.bone('右手首')).y).toBeGreaterThan(position(r.bone('右ひじ')).y);
    c.pose(frame({ gesture: 'cheer', envelope: 1 }));
    for (const side of ['左', '右']) expect(position(r.bone(side + '手首')).y).toBeGreaterThan(position(r.bone(side + '腕')).y);
  });
  it('cheers with both wrists above shoulders', () => {
    const r = rig(), c = new MmdAvatarController({ mesh: r.mesh }); c.pose(frame({ gesture: 'cheer', envelope: 1 }));
    for (const side of ['左', '右']) expect(position(r.bone(side + '手首')).y).toBeGreaterThan(position(r.bone(side + '腕')).y);
  });
  for (const gesture of ['wave', 'cheer', 'bow', 'nod'] as const) it(`${gesture} returns exactly to idle at both envelope endpoints, without elbow snapping`, () => {
    const r = rig(), c = new MmdAvatarController({ mesh: r.mesh }); c.pose(frame()); const rest = r.bones.map(b => b.quaternion.clone());
    c.pose(frame({ gesture, envelope: 0, progress: 0, gestureTime: 0 })); r.bones.forEach((b, i) => expect(b.quaternion.angleTo(rest[i])).toBeLessThan(1e-7));
    c.pose(frame({ gesture, envelope: 1, progress: 0.5, gestureTime: 1 }));
    c.pose(frame({ gesture, envelope: 0, progress: 1, gestureTime: 3 })); r.bones.forEach((b, i) => expect(b.quaternion.angleTo(rest[i])).toBeLessThan(1e-7));
  });
  it('opens fingers when waving, curls fingers when cheering, and never accumulates rotations', () => {
    const r = rig(), c = new MmdAvatarController({ mesh: r.mesh }); const finger = r.bone('右人指２');
    c.pose(frame()); const curl = finger.quaternion.angleTo(new Quaternion());
    c.pose(frame({ gesture: 'wave', envelope: 1 })); expect(finger.quaternion.angleTo(new Quaternion())).toBeLessThan(curl * 0.2);
    c.pose(frame({ gesture: 'cheer', envelope: 1 })); expect(finger.quaternion.angleTo(new Quaternion())).toBeGreaterThan(curl);
    c.pose(frame()); const rest = r.bones.map(b => b.quaternion.clone());
    for (let i = 0; i < 1000; i++) c.pose(frame()); r.bones.forEach((b, i) => expect(b.quaternion.angleTo(rest[i])).toBeLessThan(1e-7));
  });
  it('turns the waving palm toward the camera and restores its original wrist orientation', () => {
    const r = rig(true, -0.5), c = new MmdAvatarController({ mesh: r.mesh });
    c.pose(frame()); const idle = r.bone('右手首').quaternion.clone();
    c.pose(frame({ gesture: 'wave', envelope: 1, gestureTime: 0.3 }));
    const arm = c.arms[1];
    const normal = arm.palmNormal.clone().applyQuaternion(r.bone('右手首').getWorldQuaternion(new Quaternion()));
    expect(normal.z).toBeGreaterThan(0.98);
    c.pose(frame()); expect(r.bone('右手首').quaternion.angleTo(idle)).toBeLessThan(1e-7);
  });
  it('disables interfering arm IK but keeps feet IK', () => {
    const r = rig(), changed: number[] = [];
    const meta = r.bones.map(b => ({ name: b.name, ik: undefined as { target: number; links: { target: number }[] } | undefined }));
    meta[r.bones.indexOf(r.bone('右手ＩＫ'))].ik = { target: r.bones.indexOf(r.bone('右手首')), links: [{ target: r.bones.indexOf(r.bone('右ひじ')) }] };
    meta[r.bones.indexOf(r.bone('左足ＩＫ'))].ik = { target: 0, links: [] };
    new MmdAvatarController({ mesh: r.mesh, pmx: { bones: meta, morphs: [] }, ikSolver: { setEnabled: i => changed.push(i) } });
    expect(changed).toEqual([r.bones.indexOf(r.bone('右手ＩＫ'))]);
  });
  it('does not advertise hand gestures for incomplete rigs', () => {
    const mesh = new SkinnedMesh(); const b = new Bone(); b.name = 'rightarm'; mesh.add(b); mesh.bind(new Skeleton([b]));
    expect(new MmdAvatarController({ mesh }).gestures).not.toContain('wave');
  });
});
describe('MMD facial expressions', () => {
  it('blinks with only the bilateral morph, leaving all wink variants untouched', () => {
    const f = facial(['まばたき', 'ウィンク', 'ウィンク２', 'ウィンク右', 'ｳｨﾝｸ２右']); advance(f.controller, frame({ blink: 1 }));
    expect(f.value('まばたき')).toBeGreaterThan(0.99); for (const name of ['ウィンク', 'ウィンク２', 'ウィンク右', 'ｳｨﾝｸ２右']) expect(f.value(name)).toBe(0);
  });
  it('pairs left and right wink only when a bilateral blink is absent', () => {
    const f = facial(['ウィンク', 'ウィンク２', 'ウィンク右']); advance(f.controller, frame({ blink: 1 }));
    expect(f.value('ウィンク')).toBeGreaterThan(0.99); expect(f.value('ウィンク右')).toBeGreaterThan(0.99); expect(f.value('ウィンク２')).toBe(0);
  });
  it('does not turn a one-sided wink into involuntary repeated blinking', () => {
    const f = facial(['ウィンク']); advance(f.controller, frame({ blink: 1 })); expect(f.value('ウィンク')).toBe(0);
  });
  it('controls eyebrow, eye and lip separately, and yields eyes/mouth to blinking/speech', () => {
    const f = facial(['にこり', '笑い', 'にやり', 'まばたき', 'あ', 'あ２'], [1, 2, 3, 2, 3, 3]);
    const emotions = { ...frame().emotions, happy: 0.8 };
    advance(f.controller, frame({ emotions })); expect(f.value('にこり')).toBeGreaterThan(0.75); expect(f.value('笑い')).toBeGreaterThan(0.45); expect(f.value('にやり')).toBeGreaterThan(0.75);
    advance(f.controller, frame({ emotions, blink: 1, mouth: { ...frame().mouth, aa: 1 } }));
    expect(f.value('笑い')).toBeLessThan(0.001); expect(f.value('まばたき')).toBeGreaterThan(0.99); expect(f.value('にやり')).toBeLessThan(0.001); expect(f.value('あ')).toBeGreaterThan(0.99); expect(f.value('あ２')).toBe(0);
  });
  it('uses standard PMD sad/angry/surprised/relaxed morphs without enabling tears', () => {
    const f = facial(['困る', '怒り', '上', 'びっくり', 'なごみ', '涙'], [1, 1, 1, 2, 2, 4]);
    for (const [emotion, name] of [['sad', '困る'], ['angry', '怒り'], ['surprised', '上'], ['relaxed', 'なごみ']] as const) {
      advance(f.controller, frame({ emotions: { ...frame().emotions, [emotion]: 0.5 } })); expect(f.value(name)).toBeGreaterThan(0.3); expect(f.value('涙')).toBe(0);
    }
  });
  it('limits total vowel weights and supplies a fallback for a missing え', () => {
    const f = facial(['あ', 'い', 'う', 'お']); advance(f.controller, frame({ mouth: { ...frame().mouth, ee: 0.8 } })); expect(f.value('い')).toBeGreaterThan(0.5);
    advance(f.controller, frame({ mouth: { aa: 1, ih: 1, ou: 1, ee: 1, oh: 1 } })); expect(['あ', 'い', 'う', 'お'].reduce((n, k) => n + f.value(k), 0)).toBeLessThanOrEqual(1.000001);
    advance(f.controller, frame()); for (const n of ['あ', 'い', 'う', 'お']) expect(f.value(n)).toBeLessThan(0.001);
  });
  it('avoids driving the same deformation through a group and its leaf morph', () => {
    const f = facial(['smile', 'あ']); f.runtime.pmx!.morphs[0] = { name: 'smile', type: 0, indices: [1] };
    const c = new MmdAvatarController(f.runtime); advance(c, frame({ emotions: { ...frame().emotions, happy: 0.5 }, mouth: { ...frame().mouth, aa: 0.4 } }));
    expect(f.value('smile')).toBe(0); expect(f.value('あ')).toBeGreaterThan(0.39);
  });
});
