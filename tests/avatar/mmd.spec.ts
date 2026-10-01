import { expect, test } from '@playwright/test';
import fs from 'node:fs';

test.describe('real MMD sample: Japanese bones, twist bones, fingers, IK and 30 morphs', () => {
  test.skip(!fs.existsSync('tests/avatar/local-models/miku_v2.pmd'), 'Run node tests/avatar/fetch-mmd-sample.mjs to download the local-only sample.');
  test.beforeEach(async ({ page }) => {
    await page.goto('tests/avatar/index.html'); await page.waitForFunction(() => !!(window as any).avatarHarness);
    await page.evaluate(() => (window as any).avatarHarness.setSource({ kind: 'url', url: './local-models/miku_v2.pmd', name: 'miku_v2.pmd' }));
    await page.waitForFunction(() => (window as any).avatarStatus?.state === 'ready'); await page.waitForTimeout(400);
  });
  test('idle, wave, cheer, bow and nod: wrist position, fingers, transitions, return and repeated playback', async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const pose = () => page.evaluate(() => {
      let mesh: any; (window as any).avatarScene.scene.traverse((o: any) => { if (o.isSkinnedMesh) mesh = o; });
      const bones = mesh.skeleton.bones;
      const result: Record<string, { y: number; q: number[] }> = {};
      for (const bone of bones) { bone.updateWorldMatrix(true, false); result[bone.name] = { y: bone.matrixWorld.elements[13], q: bone.quaternion.toArray() }; }
      return result;
    });
    const rest = await pose();
    expect((await page.evaluate(() => (window as any).avatarStatus.info.gestures)).sort()).toEqual(['bow', 'cheer', 'nod', 'wave']);
    for (const prefix of ['左', '右']) { expect(rest[prefix + '手首'].y).toBeLessThan(rest[prefix + 'ひじ'].y); expect(rest[prefix + 'ひじ'].y).toBeLessThan(rest[prefix + '腕'].y); }
    await page.screenshot({ path: testInfo.outputPath('mmd-idle.png') });
    for (const name of ['wave', 'cheer', 'bow', 'nod', 'wave', 'wave']) {
      const movement = await page.evaluate(async name => {
        const b = (window as any).avatarHarness.bus; b.gesture = { name, id: ++b.gestureSeq };
        const nodes: any[] = []; (window as any).avatarScene.scene.traverse((o: any) => { if (o.isBone && /腕$|ひじ$|手首$|指[１２３]$/.test(o.name)) nodes.push(o); });
        let previous = nodes.map(o => o.quaternion.clone()), maxStep = 0, invalid = 0;
        for (let i = 0; i < 55; i++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          nodes.forEach((o, j) => { maxStep = Math.max(maxStep, o.quaternion.angleTo(previous[j])); previous[j].copy(o.quaternion); if (!o.quaternion.toArray().every(Number.isFinite)) invalid++; });
        }
        return { maxStep, invalid };
      }, name);
      expect(movement.invalid).toBe(0); expect(movement.maxStep, name).toBeLessThan(0.4);
      const active = await pose();
      if (name === 'wave') {
        expect(active['右ひじ'].y).toBeGreaterThan(active['右腕'].y);
        expect(active['右手首'].y).toBeGreaterThan(active['右ひじ'].y);
        expect(active['左手首'].y).toBeLessThan(active['左腕'].y);
        const curl = (q: number[]) => 2 * Math.acos(Math.min(1, Math.abs(q[3])));
        expect(curl(active['右人指２'].q)).toBeLessThan(curl(rest['右人指２'].q) * 0.4);
        const palmFacing = await page.evaluate(() => {
          const positions: Record<string, number[]> = {};
          (window as any).avatarScene.scene.traverse((o: any) => {
            if (['右手首', '右中指１', '右人指１', '右小指１'].includes(o.name)) { o.updateWorldMatrix(true, false); positions[o.name] = o.matrixWorld.elements.slice(12, 15); }
          });
          const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
          const direction = sub(positions['右中指１'], positions['右手首']), across = sub(positions['右人指１'], positions['右小指１']);
          const normal = [direction[1] * across[2] - direction[2] * across[1], direction[2] * across[0] - direction[0] * across[2], direction[0] * across[1] - direction[1] * across[0]];
          return Math.abs(normal[2]) / Math.hypot(...normal);
        });
        expect(palmFacing).toBeGreaterThan(0.85);
      }
      if (name === 'cheer') for (const prefix of ['左', '右']) expect(active[prefix + '手首'].y).toBeGreaterThan(active[prefix + '腕'].y);
      await page.screenshot({ path: testInfo.outputPath(`mmd-${name}.png`) });
      await page.waitForTimeout(name === 'nod' ? 650 : name === 'bow' ? 1700 : 2500);
      const recovered = await pose();
      for (const key of ['左腕', '右腕', '左ひじ', '右ひじ', '左手首', '右手首', '右人指２']) {
        const dot = Math.abs(recovered[key].q.reduce((sum, value, i) => sum + value * rest[key].q[i], 0));
        expect(2 * Math.acos(Math.min(1, dot)), `${name} ${key}`).toBeLessThan(0.04);
      }
    }
    expect(errors).toEqual([]);
  });
  test('all emotions with real phonemes/blinking: no wink stacking, bounded face weights, mouth closes', async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => (window as any).avatarHarness.setCamera('face')); await page.waitForTimeout(750);
    const morphs = () => page.evaluate(() => {
      let mesh: any; (window as any).avatarScene.scene.traverse((o: any) => { if (o.isSkinnedMesh) mesh = o; });
      return Object.fromEntries(Object.entries(mesh.morphTargetDictionary).map(([name, index]) => [name, mesh.morphTargetInfluences[index as number]])) as Record<string, number>;
    });
    for (const emotion of ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral']) {
      await page.evaluate(emotion => { const b = (window as any).avatarHarness.bus; b.emotion = emotion; }, emotion);
      await page.waitForTimeout(650);
      const weights = await morphs();
      const brow = ({ happy: 'にこり', sad: '困る', angry: '怒り', surprised: '上', relaxed: 'にこり' } as Record<string, string>)[emotion];
      if (brow) expect(weights[brow], emotion).toBeGreaterThan(0.25);
      await page.screenshot({ path: testInfo.outputPath(`mmd-face-${emotion}.png`) });
      await page.evaluate(() => { const b = (window as any).avatarHarness.bus; b.speaking = true; b.lip.begin('あいうえおあいうえおあいうえおあいうえお', 0.8); });
      const stats = await page.evaluate(async () => {
        let mesh: any; (window as any).avatarScene.scene.traverse((o: any) => { if (o.isSkinnedMesh) mesh = o; });
        let maxMouth = 0, maxWink = 0, invalid = 0, overBudget = 0;
        for (let i = 0; i < 50; i++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          const weights: Record<string, number> = Object.fromEntries(Object.entries(mesh.morphTargetDictionary).map(([name, index]) => [name, mesh.morphTargetInfluences[index as number]]));
          maxMouth = Math.max(maxMouth, ['あ', 'い', 'う', 'お'].reduce((sum, name) => sum + weights[name], 0));
          maxWink = Math.max(maxWink, ...Object.entries(weights).filter(([n]) => /ウィンク|ｳｨﾝｸ/.test(n)).map(([, v]) => v));
          if (Object.values(weights).some(v => !Number.isFinite(v) || v < 0 || v > 1)) invalid++;
          if (weights['まばたき'] + weights['笑い'] + weights['なごみ'] + weights['びっくり'] > 1.001) overBudget++;
        }
        return { maxMouth, maxWink, invalid, overBudget };
      });
      expect(stats.maxMouth).toBeGreaterThan(0.1); expect(stats.maxMouth).toBeLessThanOrEqual(1.001); expect(stats.maxWink).toBe(0); expect(stats.invalid).toBe(0); expect(stats.overBudget).toBe(0);
      await page.evaluate(() => { const b = (window as any).avatarHarness.bus; b.speaking = false; b.lip.end(); }); await page.waitForTimeout(500);
      const closed = await morphs(); for (const name of ['あ', 'い', 'う', 'お']) expect(closed[name]).toBeLessThan(0.005);
    }
    await page.evaluate(() => (window as any).avatarHarness.bus.emotion = 'neutral'); await page.waitForTimeout(1000);
    const final = await morphs(); for (const name of ['にこり', '困る', '怒り', '上', '笑い', 'なごみ', 'びっくり', 'にやり']) expect(final[name]).toBeLessThan(0.02);
    expect(errors).toEqual([]);
  });
});
