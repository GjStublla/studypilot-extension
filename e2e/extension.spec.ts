import type { Page } from '@playwright/test';
import {
  expect,
  openFixturePage,
  seedFixtureSession,
  test,
  togglePanelFromExtension,
} from './fixtures';
import {
  clickShadow,
  fillShadow,
  focusShadow,
  shadowChecked,
  shadowBoundingBox,
  shadowExists,
  shadowInteractiveAudit,
  shadowLayoutMetrics,
  shadowText,
  waitForShadow,
} from './shadow';

const LAUNCHER = 'button[aria-label="Open Study Pilot"]';
const DIALOG = '[role="dialog"][aria-label="Study Pilot"]';
const SETTINGS = 'button[aria-label="Session settings"]';
const MIC = 'button[aria-label="Unmute microphone"]';
const PAGE_URL = 'input[name="pageUrl"]';
const SCREENSHOT = 'input[name="screenshot"]';
const SAVE = 'input[name="saveToDashboard"]';
const CONNECT = 'button.sp-login-btn';
const DASHBOARD = 'button.sp-dashboard-link';
const STATUS = '.sp-status';
const PAGE_URL_TOGGLE = 'label.sp-toggle:has(input[name="pageUrl"])';
const CHAT_ID = '11111111-1111-4111-8111-111111111111';

async function denyMicrophone(page: Page) {
  const origin = new URL(page.url()).origin;
  await page.context().clearPermissions();
  const session = await page.context().newCDPSession(page);
  await session.send('Browser.setPermission', {
    origin,
    permission: { name: 'microphone' },
    setting: 'denied',
  });
}

test.describe('unpacked StudyPilot MV3 extension', () => {
  test('loads a service worker and assigns an extension id', async ({
    context,
    extensionId,
  }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const worker = context.serviceWorkers()[0];
    expect(worker).toBeTruthy();
    expect(worker!.url()).toContain(`chrome-extension://${extensionId}/`);
  });

  test('injects the panel host once on an https-equivalent study page', async ({
    context,
  }) => {
    const page = await openFixturePage(context);
    await expect(page.locator('#studypilot-extension-root')).toHaveCount(1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#studypilot-extension-root')).toHaveCount(1);
    await waitForShadow(page, LAUNCHER);
  });

  test('toolbar-equivalent toggle opens and closes the panel', async ({
    context,
    extensionId,
  }) => {
    const page = await openFixturePage(context);
    await expect.poll(() => shadowExists(page, LAUNCHER)).toBe(true);

    await togglePanelFromExtension(context, extensionId);
    await expect.poll(() => shadowExists(page, DIALOG)).toBe(true);

    await togglePanelFromExtension(context, extensionId);
    await expect.poll(() => shadowExists(page, DIALOG)).toBe(false);
    await expect.poll(() => shadowExists(page, LAUNCHER)).toBe(true);
  });

  test('launcher toggle also opens the on-page panel', async ({ context }) => {
    const page = await openFixturePage(context);
    await clickShadow(page, LAUNCHER);
    await expect.poll(() => shadowExists(page, DIALOG)).toBe(true);
  });

  test('launcher and primary panel controls respond to keyboard activation', async ({
    context,
    extensionId,
  }) => {
    await seedFixtureSession(context, extensionId);
    const page = await openFixturePage(context);

    await focusShadow(page, LAUNCHER);
    await page.keyboard.press('Enter');
    await expect.poll(() => shadowExists(page, DIALOG)).toBe(true);

    await focusShadow(page, SETTINGS);
    await page.keyboard.press('Enter');
    await waitForShadow(page, PAGE_URL);

    await focusShadow(page, 'button[aria-label="Minimize"]');
    await page.keyboard.press('Enter');
    await expect.poll(() => shadowExists(page, DIALOG)).toBe(false);
  });

  test('secondary menu actions respond to keyboard activation', async ({
    context,
    extensionId,
  }) => {
    await seedFixtureSession(context, extensionId);
    const page = await openFixturePage(context);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await clickShadow(page, LAUNCHER);
    await waitForShadow(page, DIALOG);
    await focusShadow(page, 'button[aria-label="More options"]');
    await page.keyboard.press('Enter');
    await waitForShadow(page, '[role="menu"]');

    await focusShadow(page, 'button[role="menuitem"]');
    await page.keyboard.press('Enter');
    await expect.poll(() => shadowExists(page, '[role="menu"]')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('visible panel controls are named, focusable, and not clipped', async ({
    context,
    extensionId,
  }) => {
    await seedFixtureSession(context, extensionId);
    const page = await openFixturePage(context);
    for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 700 }]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForShadow(page, LAUNCHER);
      await clickShadow(page, LAUNCHER);
      await waitForShadow(page, DIALOG);

      const controls = (await shadowInteractiveAudit(page)).filter(control => control.visible);
      expect(controls.length).toBeGreaterThan(0);
      expect(controls.every(control => control.label.length > 0)).toBe(true);
      expect(controls.filter(control => !control.disabled).every(control => control.tabIndex >= 0)).toBe(true);
      expect(controls.every(control => !control.clipped)).toBe(true);
    }
  });

  test('rapid open and close keeps one panel host', async ({ context, extensionId }) => {
    const page = await openFixturePage(context);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    for (let index = 0; index < 4; index += 1) {
      await togglePanelFromExtension(context, extensionId);
      await expect.poll(() => shadowExists(page, DIALOG)).toBe(true);
      await togglePanelFromExtension(context, extensionId);
      await expect.poll(() => shadowExists(page, DIALOG)).toBe(false);
    }
    await expect(page.locator('#studypilot-extension-root')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('privacy defaults keep screenshot and dashboard save off', async ({
    context,
    extensionId,
  }) => {
    await seedFixtureSession(context, extensionId);
    const page = await openFixturePage(context);
    await clickShadow(page, LAUNCHER);
    await clickShadow(page, SETTINGS);
    await waitForShadow(page, PAGE_URL);

    expect(await shadowChecked(page, PAGE_URL)).toBe(true);
    expect(await shadowChecked(page, SCREENSHOT)).toBe(false);
    expect(await shadowChecked(page, SAVE)).toBe(false);
  });

  test('page URL context can be toggled independently of capture defaults', async ({
    context,
    extensionId,
  }) => {
    await seedFixtureSession(context, extensionId);
    const page = await openFixturePage(context);
    await clickShadow(page, LAUNCHER);
    await clickShadow(page, SETTINGS);
    await waitForShadow(page, PAGE_URL);

    expect(await shadowChecked(page, PAGE_URL)).toBe(true);
    await clickShadow(page, PAGE_URL_TOGGLE);
    expect(await shadowChecked(page, PAGE_URL)).toBe(false);
    expect(await shadowChecked(page, SCREENSHOT)).toBe(false);
    expect(await shadowChecked(page, SAVE)).toBe(false);
  });

  test('panel stays within 360px and 390px viewports', async ({ context, extensionId }, testInfo) => {
    await seedFixtureSession(context, extensionId);
    const page = await openFixturePage(context);
    for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 700 }]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForShadow(page, LAUNCHER);
      await clickShadow(page, LAUNCHER);
      await expect
        .poll(async () => {
          const box = await shadowBoundingBox(page, DIALOG);
          return box.y >= 0 && box.y + box.height <= viewport.height;
        }, { timeout: 3_000 })
        .toBe(true);
      // The panel body uses a staggered reveal. Capture after it settles so
      // visual evidence reflects the usable state rather than mid-animation.
      await page.waitForTimeout(800);

      const panel = await shadowBoundingBox(page, DIALOG);
      const metrics = await shadowLayoutMetrics(page, DIALOG);
      const quickActions = await shadowText(page, '.sp-chips');
      expect(panel.width).toBeLessThanOrEqual(viewport.width - 24);
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width);
      expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(quickActions).toEqual(expect.stringContaining('Summarize'));
      expect(quickActions).toEqual(expect.stringContaining('Explain'));
      expect(quickActions).toEqual(expect.stringContaining('Quiz Me'));
      expect(quickActions).toEqual(expect.stringContaining('Flashcards'));

      await page.screenshot({
        path: testInfo.outputPath(`panel-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      });
    }
  });

  test('microphone denial shows a recoverable message', async ({
    context,
    extensionId,
  }) => {
    await seedFixtureSession(context, extensionId);
    const page = await openFixturePage(context);
    await denyMicrophone(page);
    await clickShadow(page, LAUNCHER);
    await clickShadow(page, MIC);

    await expect
      .poll(async () => shadowText(page, STATUS), { timeout: 10_000 })
      .toMatch(
        /Microphone access denied|Voice input is not supported|Voice input failed|Connect dashboard first|use text coaching/i,
      );
  });

  test('dashboard handoff opens a tab without production secrets', async ({
    context,
  }) => {
    const page = await openFixturePage(context);
    await clickShadow(page, LAUNCHER);

    const newPagePromise = context.waitForEvent('page');
    if (await shadowExists(page, CONNECT)) {
      await clickShadow(page, CONNECT);
    } else {
      await clickShadow(page, SETTINGS);
      await clickShadow(page, DASHBOARD);
    }

    const opened = await newPagePromise;
    await expect.poll(() => opened.url(), { timeout: 5_000 }).toMatch(/^https?:\/\//);
    expect(opened.url()).not.toMatch(/^chrome-extension:/);
    await opened.close();
  });

  test('connected shared chat commits coaching and survives panel reload', async ({
    context,
    extensionId,
  }) => {
    await seedFixtureSession(context, extensionId, CHAT_ID);
    const page = await openFixturePage(context);
    await clickShadow(page, LAUNCHER);
    await waitForShadow(page, 'input[aria-label="Ask a question"]');
    await waitForShadow(page, `select[aria-label="Shared StudyPilot chat"] option[value="${CHAT_ID}"]`);
    await clickShadow(page, 'select[aria-label="Shared StudyPilot chat"]');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => shadowText(page, 'select[aria-label="Shared StudyPilot chat"]'), { timeout: 10_000 })
      .toContain('Biology rubric chat');

    await fillShadow(page, 'input[aria-label="Ask a question"]', 'How should I use the rubric evidence?');
    await clickShadow(page, 'button[aria-label="Send question"]');
    await expect
      .poll(() => shadowText(page, '.sp-card-body'), { timeout: 10_000 })
      .toContain('Grounded response: compare the claim with the rubric evidence before revising.');
    await clickShadow(page, 'button[aria-label="Refresh shared chats"]');

    await expect
      .poll(() => shadowText(page, '.sp-chat-history'), { timeout: 10_000 })
      .toContain('Grounded response: compare the claim with the rubric evidence before revising.');

    await clickShadow(page, 'button[aria-label="Minimize"]');
    await expect.poll(() => shadowExists(page, DIALOG)).toBe(false);
    await clickShadow(page, LAUNCHER);
    await expect
      .poll(() => shadowText(page, '.sp-chat-history'), { timeout: 10_000 })
      .toContain('Grounded response: compare the claim with the rubric evidence before revising.');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForShadow(page, LAUNCHER);
    await clickShadow(page, LAUNCHER);
    await expect
      .poll(() => shadowText(page, '.sp-chat-history'), { timeout: 10_000 })
      .toContain('Grounded response: compare the claim with the rubric evidence before revising.');
  });

  test('live start/stop survives panel unmount without stale errors', async ({
    context,
    extensionId,
  }) => {
    await seedFixtureSession(context, extensionId, CHAT_ID);
    const page = await openFixturePage(context);
    const errors: string[] = [];
    const recordErrors = (target: Page) => {
      target.on('pageerror', error => errors.push(error.message));
      target.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
    };
    recordErrors(page);
    context.on('page', recordErrors);

    await page.evaluate(() => fetch('/e2e/reset-live-token', { method: 'POST' }));
    await clickShadow(page, LAUNCHER);
    await clickShadow(page, 'button[aria-label="Unmute microphone"]');
    await expect
      .poll(() => shadowText(page, STATUS), { timeout: 10_000 })
      .toMatch(/Starting Live/i);
    await expect
      .poll(
        () => page.evaluate(async () => (await (await fetch('/e2e/live-token-status')).json()).pending),
        { timeout: 10_000 },
      )
      .toBe(1);

    // Unmount and remount the panel while the service worker still owns the
    // delayed start. The remounted panel must hydrate the in-flight state.
    await clickShadow(page, 'button[aria-label="Minimize"]');
    await expect.poll(() => shadowExists(page, DIALOG)).toBe(false);
    await clickShadow(page, LAUNCHER);
    await expect
      .poll(() => shadowText(page, STATUS), { timeout: 10_000 })
      .toMatch(/Starting Live/i);

    // Stop the newer, visible operation before releasing the delayed token.
    await clickShadow(page, 'button[aria-label="Mute microphone"]');
    await expect
      .poll(() => shadowText(page, STATUS), { timeout: 10_000 })
      .toMatch(/Mic muted|Connect dashboard/i);

    await page.evaluate(() => fetch('/e2e/release-live-token', { method: 'POST' }));
    await expect
      .poll(
        () => page.evaluate(async () => (await (await fetch('/e2e/live-token-status')).json()).pending),
        { timeout: 10_000 },
      )
      .toBe(0);
    await page.waitForTimeout(400);
    expect(errors).toEqual([]);
  });
});
