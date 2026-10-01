import { expect, test, type Page } from '@playwright/test';

async function reading(page: Page) {
  return page.evaluate(() => {
    const { scene, camera, renderer } = (window as any).avatarScene;
    renderer.render(scene, camera);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(renderer.domElement, 0, 0, 80, 80);
    const pixels = ctx.getImageData(0, 0, 80, 80).data;
    const values: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] >= 230) values.push((0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255);
    }
    values.sort((a, b) => a - b);
    return {
      exposure: renderer.toneMappingExposure,
      upper: values[Math.floor((values.length - 1) * 0.7)],
      clipped: values.filter((v) => v > 0.96).length / values.length,
      backdrop: parseFloat(document.querySelector('.voice-bg')?.getAttribute('style')?.match(/([\d.]+)%/)?.[1] ?? '0'),
    };
  });
}

for (const [file, builtin] of [['vrm1-sample.vrm', true], ['vrm0-girl.vrm', true], ['robot-expressive.glb', true], ['avatar.pmx', false]] as const) {
  test(`${file}: automatic lighting recovers dark and bright rendering without user controls`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('tests/avatar/index.html');
    if (file !== 'vrm1-sample.vrm') {
      await page.waitForFunction(() => !!(window as any).avatarHarness);
      await page.evaluate(async ({ file, builtin }) => {
        const h = (window as any).avatarHarness;
        const url = `/RaimuNoteSNS.github.io/${builtin ? 'models/' : 'tests/avatar/fixtures/'}${file}`;
        if (builtin) h.setSource({ kind: 'url', url, name: file });
        else h.setSource({ kind: 'blob', blob: await fetch(url).then((r) => r.blob()), name: file });
      }, { file, builtin });
      await page.waitForFunction(() => (window as any).avatarStatus?.state === 'ready');
    }
    await page.waitForFunction(() => {
      let mesh = false;
      (window as any).avatarScene?.scene.traverse((o: any) => { if (o.isMesh) mesh = true; });
      return mesh;
    });
    await expect.poll(async () => (await reading(page)).upper).toBeGreaterThan(0.1);
    await page.evaluate(() => { (window as any).avatarScene.renderer.toneMappingExposure = 0.12; });
    const dim = await reading(page);
    await expect.poll(async () => (await reading(page)).exposure, { timeout: 15000 }).toBeGreaterThan(dim.exposure * 1.25);
    await expect.poll(async () => (await reading(page)).upper, { timeout: 15000 }).toBeGreaterThan(dim.upper + 0.05);
    await page.evaluate(() => { (window as any).avatarScene.renderer.toneMappingExposure = 3.5; });
    const bright = await reading(page);
    await expect.poll(async () => (await reading(page)).exposure, { timeout: 15000 }).toBeLessThan(2.5);
    await expect.poll(async () => (await reading(page)).upper, { timeout: 15000 }).toBeLessThan(bright.upper - 0.04);
    await page.waitForTimeout(9000);
    const settled = await reading(page);
    expect(settled.clipped).toBeLessThan(0.05);
    await page.screenshot({ path: testInfo.outputPath('automatic-lighting.png') });
    expect(errors).toEqual([]);
  });
}

test('background adapts to model and theme; legacy manual preferences are ignored', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('limeai-voice', JSON.stringify({ lightingByModel: { default: { exposure: 3, key: 0, fill: 0, rim: 0 } } }));
  });
  await page.goto('tests/avatar/index.html');
  await page.waitForFunction(() => !!(window as any).avatarScene);
  await expect.poll(async () => (await reading(page)).backdrop).toBeGreaterThan(25);
  expect((await reading(page)).backdrop).toBeLessThanOrEqual(40);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('slider', { name: '明るさ', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.waitForTimeout(7000);
  const light = await reading(page);
  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
  });
  await expect(page.getByRole('dialog', { name: 'ボイスモード' })).toHaveClass(/night/);
  await expect.poll(async () => (await reading(page)).backdrop, { timeout: 15000 }).toBeLessThan(15);
  const dark = await reading(page);
  expect(dark.backdrop).toBeLessThan(light.backdrop);
  expect(dark.upper).toBeGreaterThan(0.45);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('automatic-background-mobile.png') });
  await page.evaluate(() => {
    (window as any).avatarScene.scene.traverse((o: any) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.color) m.color.multiplyScalar(0.01);
      }
    });
  });
  await expect.poll(async () => (await reading(page)).backdrop, { timeout: 15000 }).toBeGreaterThan(dark.backdrop + 1);
});

test('exposure and backdrop animate every frame with no abrupt brightness steps', async ({ page }, testInfo) => {
  await page.goto('tests/avatar/index.html');
  await page.waitForFunction(() => {
    let mesh = false;
    (window as any).avatarScene?.scene.traverse((o: any) => { if (o.isMesh) mesh = true; });
    return mesh;
  });
  await page.waitForTimeout(9000);
  const before = await reading(page);
  expect(before.upper - before.backdrop / 100).toBeGreaterThan(0.30);
  const frames = await page.evaluate(async () => {
    const { scene, renderer } = (window as any).avatarScene;
    const values: { exposure: number; background: number }[] = [];
    const record = () => ({
      exposure: renderer.toneMappingExposure,
      background: parseFloat((document.querySelector('.voice-bg') as HTMLElement).style.getPropertyValue('--voice-backdrop-lightness')),
    });
    values.push(record());
    localStorage.setItem('theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
    scene.traverse((o: any) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.color) m.color.multiplyScalar(0.4);
    });
    await new Promise<void>((resolve) => {
      const tick = () => {
        values.push(record());
        if (values.length >= 160) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return values;
  });
  const changes = frames.slice(1).map((frame, i) => ({
    exposure: Math.abs(Math.log(frame.exposure / frames[i].exposure)),
    background: Math.abs(frame.background - frames[i].background),
  }));
  expect(Math.max(...changes.map((v) => v.exposure))).toBeLessThanOrEqual(0.021);
  expect(Math.max(...changes.map((v) => v.background))).toBeLessThanOrEqual(0.405);
  expect(changes.filter((v) => v.background > 0.001).length).toBeGreaterThan(60);
  expect(changes.filter((v) => v.exposure > 0.00001).length).toBeGreaterThan(30);
  expect(frames.at(-1)!.background).toBeLessThan(frames[0].background - 5);
  await page.screenshot({ path: testInfo.outputPath('contrast-and-smooth-lighting.png') });
});
