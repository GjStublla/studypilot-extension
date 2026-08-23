import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForShadow } from './shadow';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, 'dist');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  context: async ({}, use) => {
    if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
      throw new Error(
        'dist/manifest.json is missing. Run npm run build before npm run test:e2e.',
      );
    }

    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: process.env.PW_HEADED === '1' ? false : true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    }
    const extensionId = new URL(worker.url()).host;
    if (!extensionId) {
      throw new Error('Could not read the unpacked MV3 extension id from the service worker URL.');
    }
    await use(extensionId);
  },
});

export const expect = test.expect;

export const FIXTURE_ORIGIN = 'http://127.0.0.1:4177';

export async function openFixturePage(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${FIXTURE_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await expect(page.locator('#studypilot-extension-root')).toHaveCount(1);
  await waitForShadow(page, 'button[aria-label="Open Study Pilot"]');
  return page;
}

async function withExtensionPage<T>(
  context: BrowserContext,
  extensionId: string,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const extPage = await context.newPage();
  try {
    await extPage.goto(`chrome-extension://${extensionId}/src/offscreen.html`);
    return await run(extPage);
  } finally {
    await extPage.close();
  }
}

export async function togglePanelFromExtension(
  context: BrowserContext,
  extensionId: string,
): Promise<void> {
  await withExtensionPage(context, extensionId, (extPage) =>
    extPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:4177/*' });
      const tabId = tabs[0]?.id;
      if (tabId === undefined) {
        throw new Error('No fixture tab for STUDYPILOT_TOGGLE_MODAL');
      }
      await chrome.tabs.sendMessage(tabId, { type: 'STUDYPILOT_TOGGLE_MODAL' });
    }),
  );
}

/**
 * Unsigned fixture session so the coaching UI (settings, mic) stays visible.
 * Not a production credential: production getAuthStatus only checks token shape.
 */
export async function seedFixtureSession(
  context: BrowserContext,
  extensionId: string,
): Promise<void> {
  await withExtensionPage(context, extensionId, (extPage) =>
    extPage.evaluate(async () => {
      await chrome.storage.local.set({
        studypilot_supabase_access_session: {
          access_token: 'e2e.e2e.e2e',
          user_id: 'e2e-user',
          email: 'e2e@studypilot.test',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      });
    }),
  );
}
