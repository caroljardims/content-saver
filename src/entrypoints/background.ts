import { browser } from 'wxt/browser';
import { activeAdapter, adapterById, setActiveAdapter } from '../adapters/registry';
import { listRemoteFiles } from '../adapters/gdrive';
import * as db from '../core/db';
import { save, status, sync } from '../core/engine';
import { newCapture, toCapture, type Capture, type CaptureRecord } from '../core/model';
import type { CaptureSummary, Extraction, Message, Response } from '../lib/messages';

const SYNC_ALARM = 'sync';
const SYNC_PERIOD_MINUTES = 1;
const CONTENT_SCRIPT = 'content-scripts/content.js';

export default defineBackground(() => {
  exposeDebugHandle();

  void ensureSyncAlarm();

  browser.runtime.onInstalled.addListener(async () => {
    browser.contextMenus.create({
      id: 'save-selection',
      title: 'Save selection to Nécessaire',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: 'save-link',
      title: 'Save link to Nécessaire',
      contexts: ['link'],
    });
    browser.contextMenus.create({
      id: 'save-page',
      title: 'Save this page to Nécessaire',
      contexts: ['page'],
    });

  });

  // Async listener: the returned promise keeps the worker alive for the
  // duration, which a floating `void sync()` would not.
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== SYNC_ALARM && alarm.name !== 'sync-retry') return;
    try {
      await sync();
    } catch (error) {
      console.warn('[necessaire] scheduled sync failed:', error);
    }
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    try {
      if (info.menuItemId === 'save-link' && info.linkUrl) {
        await captureLink(info.linkUrl, tab.title);
      } else if (info.menuItemId === 'save-selection') {
        await capturePage(tab.id, 'selection', info.selectionText);
      } else {
        await capturePage(tab.id, 'article');
      }
      await flash(tab.id, 'Saved');
    } catch (error) {
      await flash(tab.id, 'Failed');
      console.error('[necessaire]', error);
    }
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'save-page') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await capturePage(tab.id, 'article');
    await flash(tab.id, 'Saved');
  });

  // Returning a promise is the polyfill's idiom for an async reply, and it
  // works on both browsers. Chrome's "return true" trick does not.
  browser.runtime.onMessage.addListener((message: unknown): Promise<Response> => {
    return handle(message as Message).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
});

/**
 * Creating an alarm restarts its countdown. The worker wakes on every popup
 * open and every save, so unconditionally re-creating the alarm there kept
 * pushing the next fire a minute into the future - on an active browser it
 * could go a long time without ever firing. Only touch it when it is missing
 * or its period actually changed.
 */
async function ensureSyncAlarm(): Promise<void> {
  const existing = await browser.alarms.get(SYNC_ALARM);
  if (existing?.periodInMinutes === SYNC_PERIOD_MINUTES) return;
  await browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
}

/**
 * Debug handle, reachable from the service worker console as `cs`.
 * appDataFolder is invisible in the Drive UI, so without this there is no way
 * to tell "upload never happened" from "download is broken".
 */
function exposeDebugHandle(): void {
  if (!import.meta.env.DEV) return;

  Object.assign(globalThis, {
    cs: {
      /** What Drive actually holds right now. */
      remote: async () => console.table(await listRemoteFiles()),
      /** What this device holds, including sync flags. */
      local: async () => console.table(await db.all()),
      /** Items waiting to upload. */
      queue: async () => console.table(await db.pending()),
      status,
      sync: () => sync({ interactive: true }),
    },
  });
}

// --- Capture ----------------------------------------------------------

/**
 * Inject on demand rather than declaring a content script, so the install
 * prompt stays at "no special permissions". activeTab grants access only
 * after a user gesture, which is exactly when we get here.
 */
async function extractFrom(tabId: number): Promise<Extraction | null> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    return (await browser.tabs.sendMessage(tabId, { type: 'extract' })) as Extraction;
  } catch {
    // Restricted pages (chrome://, the Web Store, PDFs) reject injection.
    return null;
  }
}

async function capturePage(
  tabId: number,
  kind: 'article' | 'selection',
  fallbackSelection?: string,
): Promise<Capture> {
  const tab = await browser.tabs.get(tabId);
  const extraction = await extractFrom(tabId);
  const selection = extraction?.selection || fallbackSelection || '';
  const wantsSelection = kind === 'selection' && selection.length > 0;

  return save(
    newCapture({
      deviceId: await db.deviceId(),
      kind: wantsSelection ? 'selection' : 'article',
      url: extraction?.url ?? tab.url ?? '',
      title: extraction?.title ?? tab.title ?? '',
      siteName: extraction?.siteName ?? '',
      excerpt: extraction?.excerpt ?? '',
      content: wantsSelection ? selection : (extraction?.content ?? ''),
    }),
  );
}

async function captureLink(url: string, title?: string): Promise<Capture> {
  return save(
    newCapture({
      deviceId: await db.deviceId(),
      kind: 'link',
      url,
      title: title ?? url,
      siteName: new URL(url).hostname,
    }),
  );
}

/** Brief badge confirmation. Cheaper and less intrusive than a notification. */
async function flash(tabId: number, text: string): Promise<void> {
  await browser.action.setBadgeText({ tabId, text: text === 'Saved' ? '1' : '!' });
  await browser.action.setBadgeBackgroundColor({
    tabId,
    color: text === 'Saved' ? '#16a34a' : '#dc2626',
  });
  setTimeout(() => void browser.action.setBadgeText({ tabId, text: '' }), 1500);
}

// --- Message handling -------------------------------------------------

/** Drop the body text, keeping the length so the UI knows whether to offer it. */
function summarize(record: CaptureRecord): CaptureSummary {
  const { content, ...rest } = toCapture(record);
  return { ...rest, contentLength: content.length };
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function handle(message: Message): Promise<Response> {
  switch (message.type) {
    case 'capture:page': {
      const tabId = await activeTabId();
      if (!tabId) return { ok: false, error: 'No active tab' };
      return { ok: true, capture: await capturePage(tabId, 'article') };
    }

    case 'capture:selection': {
      const tabId = await activeTabId();
      if (!tabId) return { ok: false, error: 'No active tab' };
      return { ok: true, capture: await capturePage(tabId, 'selection', message.text) };
    }

    case 'capture:link':
      return { ok: true, capture: await captureLink(message.url, message.title) };

    case 'capture:update': {
      const existing = await db.get(message.id);
      if (!existing) return { ok: false, error: 'Not found' };
      const updated: Capture = {
        ...toCapture(existing),
        ...message.patch,
        id: existing.id,
        rev: existing.rev + 1,
        deviceId: await db.deviceId(),
        updatedAt: new Date().toISOString(),
      };
      await db.put(updated, 1);
      await sync().catch(() => undefined);
      return { ok: true, capture: updated };
    }

    case 'capture:delete': {
      const existing = await db.get(message.id);
      if (!existing) return { ok: false, error: 'Not found' };
      // Tombstone, not a row deletion - other devices need to learn about it.
      await db.put(
        {
          ...toCapture(existing),
          deletedAt: new Date().toISOString(),
          rev: existing.rev + 1,
          deviceId: await db.deviceId(),
        },
        1,
      );
      await sync().catch(() => undefined);
      return { ok: true };
    }

    case 'capture:get': {
      const existing = await db.get(message.id);
      if (!existing) return { ok: false, error: 'Not found' };
      return { ok: true, capture: toCapture(existing) };
    }

    case 'list':
      return { ok: true, captures: (await db.list({ limit: 100 })).map(summarize) };

    case 'sync':
      return { ok: true, report: await sync({ interactive: message.interactive }) };

    case 'status':
      return { ok: true, status: await status() };

    case 'adapter:set':
      await setActiveAdapter(message.id);
      return { ok: true, status: await status() };

    case 'adapter:connect': {
      // Connect FIRST, persist only on success. Switching the active adapter
      // up front left a failed connection stranded on a backend that cannot
      // authenticate, with no way back to local-only.
      const adapter = adapterById(message.id);
      await adapter.connect({ interactive: true });
      await setActiveAdapter(message.id);
      await sync({ interactive: true });
      return { ok: true, status: await status() };
    }

    case 'adapter:disconnect': {
      const adapter = await activeAdapter();
      await adapter.disconnect();
      await setActiveAdapter('none');
      return { ok: true, status: await status() };
    }
  }
}
