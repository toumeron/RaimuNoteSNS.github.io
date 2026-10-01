import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  await page.route('https://**/rest/v1/**', route => route.fulfill({ json: [] }));
  await page.route('https://**/auth/v1/**', route => route.fulfill({ json: { user: null } }));
  await page.addInitScript(() => {
    let permissionRequests = 0;
    Object.defineProperty(navigator, 'mediaDevices', { value: {
      getUserMedia: async () => {
        permissionRequests++;
        Object.assign(window, { permissionRequests });
        return { getTracks: () => [{ stop() {} }] };
      },
    } });
    class Recognition {
      start() {}
      abort() {}
      stop() {}
    }
    Object.assign(window, { SpeechRecognition: Recognition });
  });
  await page.goto('tests/mobile-chat/index.html');
});
test('composer stays above a PWA nav, including after its measured height changes', async ({ page }) => {
  const root = page.locator('.vpop-root').first();
  await expect(root).toBeVisible();
  expect((await root.boundingBox())!.y + (await root.boundingBox())!.height).toBeLessThanOrEqual(746);
  const composer = page.locator('textarea').last();
  await expect(composer).toBeVisible();
  const nav = await page.getByTestId('nav').boundingBox();
  const input = await composer.boundingBox();
  expect(input!.y + input!.height).toBeLessThan(nav!.y);
  await page.evaluate(() => document.documentElement.style.setProperty('--lime-bottom-nav-height', '120px'));
  await expect.poll(async () => { const box = await root.boundingBox(); return box!.y + box!.height; }).toBe(724);
});
test('permission request and minimized call persist when ChatPage unmounts and returns', async ({ page }) => {
  await page.getByRole('button', { name: 'チャットメニューを開く' }).click();
  await page.getByRole('button', { name: 'フレンド', exact: true }).click();
  await page.getByRole('button', { name: /と通話$/ }).first().click();
  await expect(page.locator('.lime-call')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { permissionRequests: number }).permissionRequests)).toBe(1);
  await page.getByRole('button', { name: '通話画面を縮小して上部バーにする' }).click();
  await page.locator('.lime-call').evaluate(element => { Object.assign(window, { originalCall: element }); });
  await page.getByRole('link', { name: 'ホームへ' }).click();
  await expect(page.getByText('別のページ')).toBeVisible();
  await expect(page.locator('.lime-call.compact')).toBeVisible();
  expect(await page.locator('.lime-call').evaluate(element => element === (window as unknown as { originalCall: Element }).originalCall)).toBe(true);
  await page.getByRole('link', { name: 'チャットへ' }).click();
  await expect(page.locator('.vpop-root').first()).toBeVisible();
  await expect(page.locator('.lime-call.compact')).toBeVisible();
  await page.getByRole('button', { name: /との通話を展開$/ }).click();
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await expect(page.locator('.lime-call')).toHaveCount(0);
});
test('composer fits above the software keyboard and restores the nav inset on dismissal', async ({ page }) => {
  const root = page.locator('.vpop-root').first();
  await expect(root).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 450 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => (await root.boundingBox())!.height).toBe(450);
  const composer = await page.locator('textarea').last().boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(450);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 844 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => (await root.boundingBox())!.height).toBe(746);
});
