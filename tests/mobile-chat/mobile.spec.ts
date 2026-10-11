import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }, testInfo) => {
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
  if (!testInfo.title.startsWith('incoming banner') && !testInfo.title.startsWith('friend profile')) await page.goto('tests/mobile-chat/index.html');
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

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`incoming banner fits and accepts calls at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('tests/mobile-chat/index.html?incoming-preview');
    const banner = page.getByRole('alertdialog', { name: 'なかから着信' });
    await expect(banner).toBeVisible();
    const bounds = await banner.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(12);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 12);
    await expect(banner.getByRole('button', { name: '着信を拒否' })).toBeVisible();
    await page.screenshot({ path: `/private/tmp/lime-incoming-${viewport.width}.png` });
    await banner.getByRole('button', { name: '着信に応答' }).click();
    await expect(banner).toHaveCount(0);
  });
  test(`simple call controls fit and remain functional at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    if (viewport.width < 701) await page.getByRole('button', { name: 'チャットメニューを開く' }).click();
    await page.getByRole('button', { name: 'フレンド', exact: true }).click();
    await page.getByRole('button', { name: /と通話$/ }).first().click();
    const call = page.getByRole('dialog', { name: /との通話$/ });
    await expect(call).toBeVisible();
    await expect(call.locator('.lime-call-avatar img')).toBeVisible();
    const speaker = call.getByRole('button', { name: 'スピーカー', exact: true });
    const initialSpeaker = await speaker.getAttribute('aria-pressed');
    await speaker.click();
    await expect(speaker).toHaveAttribute('aria-pressed', initialSpeaker === 'true' ? 'false' : 'true');
    await call.getByRole('button', { name: 'ミュート', exact: true }).click();
    await expect(call.getByRole('button', { name: 'マイクをオン' })).toHaveAttribute('aria-pressed', 'true');
    const end = await call.getByRole('button', { name: '終了', exact: true }).boundingBox();
    const audio = await speaker.boundingBox();
    expect(end!.x).toBeGreaterThanOrEqual(0);
    expect(end!.y + end!.height).toBeLessThanOrEqual(viewport.height);
    if (viewport.width < 701) expect(Math.abs(end!.y - audio!.y)).toBeLessThan(2);
    else expect(end!.y).toBeGreaterThan(audio!.y + audio!.height);
    await page.screenshot({ path: `/private/tmp/lime-call-${viewport.width}.png` });
    await call.getByRole('button', { name: '終了', exact: true }).click();
    await expect(call).toHaveCount(0);
  });
}
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

test('mobile sidebar closes by sliding at a constant width with a synchronized backdrop fade', async ({ page }) => {
  const panel = page.locator('#chat-sidebar');
  await page.getByRole('button', { name: 'チャットメニューを開く' }).click();
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect.poll(async () => (await panel.boundingBox())!.x).toBe(0);
  const frames = await page.evaluate(async () => {
    const sidebar = document.getElementById('chat-sidebar')!;
    const backdrop = document.querySelector('.chat-sidebar-backdrop')!;
    const content = sidebar.firstElementChild!;
    const main = sidebar.parentElement!.querySelector('textarea')!;
    const result: { x: number; width: number; content: number; visibility: string; opacity: number; composer: number }[] = [];
    const capture = () => {
      const box = sidebar.getBoundingClientRect();
      result.push({ x: box.x, width: box.width, content: content.getBoundingClientRect().width,
        visibility: getComputedStyle(sidebar).visibility, opacity: Number(getComputedStyle(backdrop).opacity),
        composer: main.getBoundingClientRect().x });
    };
    capture();
    const close = [...sidebar.querySelectorAll<HTMLButtonElement>('button[aria-label="サイドバーを閉じる"]')]
      .find((button) => getComputedStyle(button).display !== 'none')!;
    close.focus();
    close.click();
    await new Promise<void>((resolve) => {
      const tick = () => {
        capture();
        if (result.length >= 30) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return result;
  });
  expect(frames.some((frame) => frame.x < -1 && frame.x > -389 && frame.visibility === 'visible')).toBe(true);
  expect(frames.some((frame) => frame.opacity > 0.01 && frame.opacity < 0.99)).toBe(true);
  for (const frame of frames) {
    expect(frame.width).toBeCloseTo(390, 0);
    expect(frame.content).toBeCloseTo(frames[0].content, 1);
    expect(frame.composer).toBeCloseTo(frames[0].composer, 1);
  }
  expect(frames.at(-1)!.x).toBeCloseTo(-390, 0);
  expect(frames.at(-1)!.visibility).toBe('hidden');
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  expect(await panel.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  await expect(page.getByRole('button', { name: 'チャットメニューを開く' })).toBeFocused();
  await page.locator('textarea').last().fill('閉じた後の入力');
  await expect(page.locator('textarea').last()).toHaveValue('閉じた後の入力');
});

test('closing can reverse into reopening and breakpoint changes preserve desktop layout', async ({ page }) => {
  const panel = page.locator('#chat-sidebar');
  await page.getByRole('button', { name: 'チャットメニューを開く' }).click();
  await expect.poll(async () => (await panel.boundingBox())!.x).toBe(0);
  await page.getByRole('button', { name: 'サイドバーを閉じる' }).click();
  await page.getByRole('button', { name: 'チャットメニューを開く' }).click();
  await expect.poll(async () => (await panel.boundingBox())!.x).toBe(0);
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(256);
  await page.getByRole('button', { name: 'サイドバーを閉じる' }).click();
  await expect(panel).toBeHidden();
  expect(await panel.evaluate((element) => element.getBoundingClientRect().width)).toBe(0);
  await page.getByRole('button', { name: 'チャットメニューを開く' }).click();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(256);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toHaveAttribute('data-open', 'false');
  await expect(panel).toBeHidden();
});

test('reduced motion closes the sidebar immediately without leaving an invisible overlay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'チャットメニューを開く' }).click();
  await page.getByRole('button', { name: 'サイドバーを閉じる' }).click();
  await expect(page.locator('#chat-sidebar')).toBeHidden();
  expect(await page.locator('.chat-sidebar-backdrop').evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
  await page.locator('textarea').last().fill('入力可能');
});

test('installed iOS call selects recording even when SpeechRecognition is exposed and stops recording on hangup', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const state = { recognitionStarts: 0, recordedStarts: 0, streams: [] as MediaStream[], recorders: [] as MediaRecorder[] };
    Object.assign(window, { iosCallTest: state });
    class Recognition {
      start() { state.recognitionStarts++; }
      abort() {}
      stop() {}
    }
    Object.assign(window, { SpeechRecognition: Recognition });
    const NativeRecorder = MediaRecorder;
    class Recording extends NativeRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        state.recorders.push(this);
      }
      start(timeslice?: number) { state.recordedStarts++; super.start(timeslice); }
    }
    Object.assign(window, { MediaRecorder: Recording });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        const context = new AudioContext();
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const source = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0; // Silent synthetic input: no transcription is sent.
        source.connect(gain).connect(destination);
        source.start();
        const stream = destination.stream;
        state.streams.push(stream);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); source.stop(); void context.close(); };
        }
        return stream;
      },
    } });
  });
  await page.reload();
  await page.getByRole('button', { name: 'チャットメニューを開く' }).click();
  await page.getByRole('button', { name: 'フレンド', exact: true }).click();
  await page.getByRole('button', { name: /と通話$/ }).first().click();
  await expect.poll(() => page.evaluate(() => (window as any).iosCallTest.recordedStarts), { timeout: 15000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).iosCallTest.recognitionStarts)).toBe(0);
  await page.getByRole('button', { name: '終了', exact: true }).click();
  expect(await page.evaluate(() => (window as any).iosCallTest.recorders.every((recorder: MediaRecorder) => recorder.state === 'inactive'))).toBe(true);
  expect(await page.evaluate(() => (window as any).iosCallTest.streams.every((stream: MediaStream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true);
});

for (const width of [390,1280]) test(`friend profile fits viewport and edits birthday at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.goto('tests/mobile-chat/index.html?friend-profile-preview');
 const dialog=page.getByRole('dialog',{name:'担々麺のプロフィール'});await expect(dialog).toBeVisible();
 const bounds=(await dialog.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);expect(bounds.height).toBeLessThanOrEqual(844);
 await expect(dialog.getByRole('button',{name:'トーク'})).toBeInViewport();await expect(dialog.getByRole('button',{name:'音声通話'})).toBeInViewport();
 await dialog.getByRole('button',{name:'プロフィールを編集'}).click();await dialog.getByLabel('誕生日').fill('2000-03-15');await expect(dialog.getByText('3/15',{exact:true})).toBeVisible();
 await dialog.locator('input[type=file]').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP437AAiBggFAA87gh98hP41AAAAABJRU5ErkJggg==','base64')});
 await expect(dialog.locator('.friend-profile-cover')).toHaveAttribute('src',/^data:image\/jpeg/);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('limeai:guest:assistants')??'[]')[0]?.coverUrl?.startsWith('data:image/jpeg'))).toBe(true);
 await dialog.getByRole('button',{name:'背景画像を解除'}).click();await expect(dialog.locator('.friend-profile-cover')).toHaveCount(0);
 await page.screenshot({path:`/private/tmp/lime-friend-profile-${width}.png`});
});

for (const width of [390,1280]) test(`group call invites friends without interrupting and fits at ${width}px`, async ({page}) => {
 await page.setViewportSize({width,height:844});
 if(width<701) await page.getByRole('button',{name:'チャットメニューを開く'}).click();
 await page.getByRole('button',{name:'フレンド',exact:true}).click();
 await page.getByRole('button',{name:/と通話$/}).first().click();
 const call=page.locator('.lime-call'); await expect(call).toBeVisible();
 const invite=call.getByRole('button',{name:'フレンドを通話に招待'});
 await expect(invite).toBeDisabled();
 await expect(invite).toBeEnabled({timeout:15000}); await invite.click();
 const panel=call.getByRole('region',{name:'フレンドを招待'});
 const box=(await panel.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 await panel.getByRole('button',{name:'担々麺を招待'}).click();
 await expect(call.locator('.lime-call-members > div')).toHaveCount(2);
 await expect(call.locator('.lime-call-name')).toHaveText('グループ通話 · 3人');
 await expect(panel).toHaveCount(0); await expect(call.getByRole('button',{name:'終了',exact:true})).toBeInViewport();
 await invite.click();await expect(panel.getByText('招待できるフレンドは全員参加しています。')).toBeVisible();
 await panel.getByRole('button',{name:'招待を閉じる'}).click();
 await page.screenshot({path:`/private/tmp/lime-group-call-${width}.png`});
 await call.getByRole('button',{name:'終了',exact:true}).click();await expect(call).toHaveCount(0);
});
