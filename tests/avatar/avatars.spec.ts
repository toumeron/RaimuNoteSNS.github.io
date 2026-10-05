import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const base = '/RaimuNoteSNS.github.io/';
const fixtures = path.resolve('tests/avatar/fixtures');
async function open(page: Page) {
  await page.goto('tests/avatar/index.html');
  await page.waitForFunction(() => !!(window as any).avatarHarness);
}
async function source(page: Page, file: string, builtin = false) {
  await page.evaluate(async ({ file, builtin, base }) => {
    (window as any).avatarStatus = null;
    const h = (window as any).avatarHarness;
    if (builtin) h.setSource({ kind: 'url', url: `${base}models/${file}`, name: file });
    else {
      const blob = await fetch(`./fixtures/${file}`).then((r) => r.blob());
      h.setSource({ kind: 'blob', blob, name: file });
    }
  }, { file, builtin, base });
  await page.waitForFunction(() => ['ready', 'error'].includes((window as any).avatarStatus?.state));
  return page.evaluate(() => (window as any).avatarStatus);
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const { scene, camera, renderer } = (window as any).avatarScene;
    let meshes = 0, invalid = 0;
    const morphs: number[] = [];
    const mouthMorphs: number[] = [];
    const bones: Record<string, number[]> = {};
    scene.traverse((o: any) => {
      if (o.isMesh) meshes++;
      if (o.isBone) bones[o.name] = o.quaternion.toArray();
      if (o.morphTargetInfluences) {
        morphs.push(...o.morphTargetInfluences);
        for (const [name, index] of Object.entries(o.morphTargetDictionary || {})) {
          if (/Fcl_MTH_[AIUEO]$/i.test(name)) mouthMorphs.push(o.morphTargetInfluences[index as number]);
        }
      }
      if (![...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()].every(Number.isFinite)) invalid++;
    });
    return { meshes, invalid, morphs, mouthMorphs, bones, camera: camera.position.toArray(), memory: { ...renderer.info.memory } };
  });
}
async function healthy(page: Page) {
  const s = await snapshot(page);
  expect(s.meshes).toBeGreaterThan(0);
  expect(s.invalid).toBe(0);
  expect(s.camera.every(Number.isFinite)).toBe(true);
  expect(s.morphs.every((n) => Number.isFinite(n) && n >= -0.0001 && n <= 1.0001)).toBe(true);
  return s;
}

test('production voice settings: all built-ins, supported gestures, save and reopen', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-version','VRM 1.0');
  await page.getByRole('button', { name: /リナ（/ }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-version','VRM 0.x');
  await page.getByRole('button', { name: /ロボット（/ }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-format','glb');
  await expect(page.getByRole('button', { name: 'お辞儀', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '手を振る', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '手を振る', exact: true }).click();
  await page.waitForTimeout(3200);
  await healthy(page);
  await page.reload();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-format','glb');
  expect(errors).toEqual([]);
});

for (const [file, version] of [['vrm1-sample.vrm', 'VRM 1.0'], ['vrm0-girl.vrm', 'VRM 0.x'], ['robot-expressive.glb', 'glb']]) {
  test(`${file}: expressions, mouth, gestures, cameras, drag and dark lighting`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    const status = await source(page, file, true);
    expect(status.state, status.message).toBe('ready');
    expect(status.info.vrmVersion || status.info.kind).toBe(version);
    await page.waitForTimeout(500);
    const rest = await healthy(page);
    await page.screenshot({ path: testInfo.outputPath('idle.png') });
    for (const emotion of ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral']) {
      await page.evaluate((emotion) => {
        const b = (window as any).avatarHarness.bus;
        b.emotion = emotion; b.speaking = true; b.lip.begin('あいうえおあいうえお', 1);
      }, emotion);
      await page.waitForTimeout(200);
      await healthy(page);
    }
    await page.evaluate(() => {
      const b = (window as any).avatarHarness.bus; b.speaking = false; b.emotion = 'neutral'; b.lip.end();
    });
    for (const gesture of status.info.gestures) {
      await page.evaluate((name) => {
        const b = (window as any).avatarHarness.bus; b.gesture = { name, id: ++b.gestureSeq };
      }, gesture);
      await page.waitForTimeout(800);
      await healthy(page);
      const bounds = await page.evaluate(() => (window as any).avatarHarness.projectedBounds());
      expect(bounds.minY, `${gesture} feet`).toBeGreaterThan(-1);
      expect(bounds.maxY, `${gesture} hands`).toBeLessThan(1);
      expect(bounds.minX, `${gesture} left`).toBeGreaterThan(-1);
      expect(bounds.maxX, `${gesture} right`).toBeLessThan(1);
      await page.screenshot({ path: testInfo.outputPath(`${gesture}.png`) });
      await page.waitForTimeout(2800);
    }
    await page.waitForTimeout(1000);
    const after = await healthy(page);
    // VRM limbs settle back after gestures instead of retaining raised hands.
    if (version.startsWith('VRM')) {
      for (const [name, q] of Object.entries(rest.bones).filter(([name]) => /UpperArm|LowerArm/.test(name))) {
        const now = after.bones[name];
        expect(now, name).toBeDefined();
        const dot = Math.abs(q.reduce((sum, v, i) => sum + v * now[i], 0));
        expect(dot, name).toBeGreaterThan(.98);
      }
      expect(after.morphs.filter((n) => n > .01).length).toBeLessThan(10);
    }
    for (const camera of ['face', 'bust', 'full']) {
      await page.evaluate((camera) => (window as any).avatarHarness.setCamera(camera), camera);
      await page.waitForTimeout(900); await healthy(page);
      const bounds = await page.evaluate(() => (window as any).avatarHarness.projectedBounds());
      expect(bounds.maxY, `${camera} head`).toBeLessThan(1);
      await page.screenshot({ path: testInfo.outputPath(`${camera}.png`) });
    }
    await page.evaluate(() => (window as any).avatarHarness.setNight(true));
    await page.waitForTimeout(300); await healthy(page);
    await page.screenshot({ path: testInfo.outputPath('dark.png') });
    await page.mouse.move(600, 350); await page.mouse.down(); await page.mouse.move(820, 420, { steps: 8 }); await page.mouse.up();
    await page.mouse.wheel(0, 300); await page.waitForTimeout(300); await healthy(page);
    expect(errors).toEqual([]);
  });
}

for (const [file, format] of [
  ['embedded.gltf', 'gltf'], ['gltf-package.zip', 'gltf'], ['triangle.fbx', 'fbx'], ['triangle.obj', 'obj'],
  ['obj-package.zip', 'obj'], ['avatar.pmx', 'mmd'], ['avatar.pmd', 'mmd'], ['mmd-package.zip', 'mmd'],
]) {
  test(`loader: ${file}`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    const status = await source(page, file);
    expect(status.state, status.message).toBe('ready');
    expect(status.info.kind).toBe(format);
    await page.waitForTimeout(400); await healthy(page);
    await page.screenshot({ path: testInfo.outputPath('loaded.png') });
    if (format === 'mmd') {
      await page.evaluate(() => {
        const b = (window as any).avatarHarness.bus; b.gesture = { name: 'nod', id: ++b.gestureSeq };
        b.speaking = true; b.lip.begin('あいうえお', 1); b.emotion = 'happy';
      });
      await page.waitForTimeout(600); await healthy(page);
      await page.evaluate(() => { const b = (window as any).avatarHarness.bus; b.speaking = false; b.lip.end(); });
      await page.waitForTimeout(1800); await healthy(page);
    }
    expect(errors).toEqual([]);
  });
}

for (const file of ['broken.glb', 'broken.zip', 'no-model.zip', 'missing.gltf']) {
  test(`failure recovery: ${file}`, async ({ page }) => {
    await open(page);
    const status = await source(page, file);
    expect(status.state).toBe('error');
    expect(status.message.length).toBeGreaterThan(0);
    expect((await source(page, 'robot-expressive.glb', true)).state).toBe('ready');
    await healthy(page);
  });
}

test('rapid switching: latest model wins and repeated switches do not accumulate GPU resources', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  expect((await source(page, 'robot-expressive.glb', true)).state).toBe('ready');
  await page.waitForTimeout(300); const initial = await healthy(page);
  for (let i = 0; i < 3; i++) {
    expect((await source(page, 'vrm0-girl.vrm', true)).state).toBe('ready');
    expect((await source(page, 'vrm1-sample.vrm', true)).state).toBe('ready');
    expect((await source(page, 'robot-expressive.glb', true)).state).toBe('ready');
  }
  await page.waitForTimeout(300);
  const final = await healthy(page);
  expect(final.memory.geometries).toBe(initial.memory.geometries);
  expect(final.memory.textures).toBe(initial.memory.textures);
  await page.route('**/models/vrm1-sample.vrm', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
  await page.evaluate((base) => {
    const h = (window as any).avatarHarness;
    h.setSource({ kind: 'url', url: `${base}models/vrm1-sample.vrm`, name: 'slow.vrm' });
  }, base);
  await page.waitForTimeout(100);
  expect((await source(page, 'robot-expressive.glb', true)).state).toBe('ready');
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => (window as any).avatarStatus.info.name)).toBe('robot-expressive.glb');
  expect(errors).toEqual([]);
});

test('mobile settings, custom upload, persisted restore, delete and close/reopen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(path.join(fixtures, 'gltf-package.zip'));
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-format','gltf');
  await page.reload();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-format','gltf');
  await page.screenshot({ path: 'test-results/mobile-settings.png' });
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-version','VRM 1.0');
  await page.getByRole('button', { name: '閉じる', exact: true }).last().click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'ボイスを再開' }).click();
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('full AI chat route opens the production voice overlay (isolated auth/API fixtures)', async ({ page }) => {
  // Supabase is isolated so this test cannot write to an actual account.
  const fakeUser = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'avatar-test@example.invalid', user_metadata: { username: 'avatar-test' }, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  await page.route('**/*.supabase.co/**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/auth/v1/user') ? fakeUser : []),
  }));
  await page.routeWebSocket(/supabase/, (socket) => socket.close());
  await open(page);
  await page.evaluate(async (user) => {
    const { supabase } = await import('/RaimuNoteSNS.github.io/src/lib/supabase.ts');
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const token = `${btoa('{"alg":"HS256","typ":"JWT"}')}.${btoa(JSON.stringify({ sub: user.id, exp: expires, role: 'authenticated' }))}.fixture`;
    localStorage.setItem((supabase.auth as any).storageKey, JSON.stringify({ access_token: token, refresh_token: 'fixture', token_type: 'bearer', expires_at: expires, expires_in: 3600, user }));
  }, fakeUser);
  await page.goto('chat');
  await page.getByRole('button', { name: 'ボイスモード', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'ボイスモード' })).toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-version','VRM 1.0');
  await page.screenshot({ path: 'test-results/full-chat-voice.png' });
  await page.getByRole('button', { name: /リナ（/ }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-version','VRM 0.x');
  await page.screenshot({ path: 'test-results/full-chat-lina.png' });
  await page.getByRole('button', { name: /ロボット（/ }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-format','glb');
  await page.screenshot({ path: 'test-results/full-chat-robot.png' });
});


test('Fish AI audio starts lip sync, closes the mouth, and reports missing configuration', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  // Raw 24 kHz PCM exercises the production streaming playback path.
  const pcm = Buffer.alloc(24000 * 3 * 2);
  let requests = 0;
  await page.route('**/functions/v1/synthesize-speech', async route => {
    requests++;
    expect(route.request().headers().authorization).toContain('Bearer ');
    expect(route.request().postDataJSON().text).toContain('こんにちは');
    expect(route.request().postDataJSON().referenceId).toBe('0089dce5fefb4c6ba9b9f2f0debe1ddc');
    expect(route.request().postDataJSON().format).toBe('pcm');
    if (requests === 1) await route.fulfill({ contentType: 'audio/pcm', body: pcm });
    else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'AI音声の設定が未完了です。' }) });
  });
  await open(page);
  await page.evaluate(async () => {
    const { supabase } = await import('/RaimuNoteSNS.github.io/src/lib/supabase.ts');
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated' };
    const token = `${btoa('{"alg":"HS256","typ":"JWT"}')}.${btoa(JSON.stringify({ sub: user.id, exp: expires, role: 'authenticated' }))}.fixture`;
    localStorage.setItem((supabase.auth as any).storageKey, JSON.stringify({ access_token: token, refresh_token: 'fixture', token_type: 'bearer', expires_at: expires, expires_in: 3600, user }));
  });
  await page.reload();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('[data-lime-avatar-stage]')).toHaveAttribute('data-lime-avatar-version','VRM 1.0');
  await expect(page.getByText('Fish Audio S2.1 Pro Free', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    speechSynthesis.speak = () => { throw new Error('Browser TTS must not be used'); };
  });
  await page.getByRole('button', { name: 'テスト再生', exact: true }).click();
  await expect.poll(async () => Math.max(...(await snapshot(page)).mouthMorphs)).toBeGreaterThan(.03);
  await expect.poll(async () => Math.max(...(await snapshot(page)).mouthMorphs)).toBeLessThan(.02);
  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: 'テスト再生', exact: true }).click();
  await expect(page.getByText('AI音声の設定が未完了です。', { exact: true })).toBeVisible();
  expect(requests).toBe(2);
  expect(errors).toEqual([]);
  await healthy(page);
});
