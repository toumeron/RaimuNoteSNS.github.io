import { Bone, Quaternion, SkinnedMesh, Vector3, MathUtils } from 'three';

type Vowel = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';
type Emotion = 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed';
type Gesture = 'wave' | 'nod' | 'bow' | 'cheer';
type Morph = { name: string; category?: number; type?: number; indices?: ArrayLike<number> };
export type MmdRuntime = {
  mesh: SkinnedMesh;
  pmx?: { bones: { name: string; ik?: { target: number; links: { target: number }[] } }[]; morphs: Morph[] };
  ikSolver?: { setEnabled(index: number, enabled: boolean): void };
};
export type MmdFrame = {
  time: number; dt: number; speaking: number; listening: number; lookX: number; lookY: number;
  gesture: Gesture | null; progress: number; envelope: number; gestureTime: number;
  mouth: Record<Vowel, number>; emotions: Record<Emotion, number>; blink: number;
};
const normalize = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[\s_\-・･:：.。!！]/g, '');
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const Z = new Vector3(0, 0, 1), X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0);
type Joint = { node: Bone; rotation: Quaternion; position: Vector3 };
type Arm = { side: number; upper: Joint | null; elbow: Joint | null; wrist: Joint | null; restAngle: number; handDirection: Vector3; palmNormal: Vector3; fingers: { joint: Joint; axis: Vector3; curl: number; thumb: boolean }[] };
type Binding = { index: number; base: number; channel: 'blink' | 'brow' | 'eye' | 'lip' | 'face' | Vowel; emotions?: Emotion[]; dependencies: Set<number> };

/** Procedural conversation pose in the model coordinate system, independent of bone local axes. */
export class MmdAvatarController {
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
    const add = (entry: typeof entries[number] | undefined, channel: Binding['channel'], emotion?: Emotion) => {
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
    for (const [vowel, names] of Object.entries({ aa: ['あ', 'a', 'aa', 'ah', '口あ', 'mouthopen', 'openmouth'], ih: ['い', 'i', 'ih', '口い'], ou: ['う', 'u', 'ou', '口う'], ee: ['え', 'e', 'ee', '口え', 'えー'], oh: ['お', 'o', 'oh', '口お'] })) add(pick(names), vowel as Vowel);
    const blink = pick(['まばたき', '瞬き', 'blink', 'eyeclose', 'closeeye']);
    if (blink) add(blink, 'blink');
    else {
      // Pair a single left/right closure, avoiding wink variants that close the same eye twice.
      const left = pick(['ウィンク', 'winkleft', 'blinkleft', '左まばたき', '左目閉じ']);
      const right = pick(['ウィンク右', 'winkright', 'blinkright', '右まばたき', '右目閉じ']);
      if (left && right) { add(left, 'blink'); add(right, 'blink'); }
    }
    const presets: Record<Emotion, { brow: string[]; eye: string[]; lip: string[]; face: string[] }> = {
      happy: { brow: ['にこり', 'にっこり'], eye: ['笑い', '笑顔'], lip: ['にやり', '口角上げ'], face: ['happy', 'joy', 'smile', '笑顔'] },
      sad: { brow: ['困る', '悲しい', '悲しみ'], eye: ['悲しい', '悲しみ'], lip: ['口角下げ', 'への字'], face: ['sad', 'sorrow', '悲しい'] },
      angry: { brow: ['怒り', '怒る', '真面目'], eye: ['怒り', 'じと目'], lip: ['への字'], face: ['angry', 'anger', '怒り'] },
      surprised: { brow: ['上', '眉上', '驚き'], eye: ['びっくり', '驚き', '見開き'], lip: [], face: ['surprised', 'surprise', 'shock', '驚き'] },
      relaxed: { brow: ['にこり'], eye: ['なごみ', 'ほっ'], lip: ['にやり'], face: ['relaxed', 'relax', 'calm', '安心'] },
    };
    for (const [emotion, preset] of Object.entries(presets) as [Emotion, typeof presets[Emotion]][]) {
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
    this.gazeX = damp(this.gazeX, MathUtils.clamp(f.lookX, -0.18, 0.18), 7, f.dt);
    this.gazeY = damp(this.gazeY, MathUtils.clamp(f.lookY, -0.32, 0.32), 7, f.dt);
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
        value = f.mouth[b.channel as Vowel];
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
    for (const b of this.bindings) influences[b.index] = suppressed.has(b.index) ? 0 : damp(influences[b.index] ?? b.base, weights.get(b.index) ?? 0, b.channel === 'blink' ? 45 : 22, f.dt);
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
