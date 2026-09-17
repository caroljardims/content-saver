import type { Capture } from '../core/model';
import type { SyncReport, SyncStatus } from '../core/engine';
import type { AdapterId } from '../adapters/types';
import { browser } from 'wxt/browser';

/** What the content script sends back from a page. */
export interface Extraction {
  url: string;
  title: string;
  siteName: string;
  excerpt: string;
  content: string;
  selection: string;
}

export type Message =
  | { type: 'capture:page' }
  | { type: 'capture:selection'; text?: string }
  | { type: 'capture:link'; url: string; title?: string }
  | { type: 'capture:delete'; id: string }
  | { type: 'capture:update'; id: string; patch: Partial<Capture> }
  | { type: 'list' }
  | { type: 'sync'; interactive?: boolean }
  | { type: 'status' }
  | { type: 'adapter:set'; id: AdapterId }
  | { type: 'adapter:connect' }
  | { type: 'adapter:disconnect' };

export type Response =
  | { ok: true; capture: Capture }
  | { ok: true; captures: Capture[] }
  | { ok: true; status: SyncStatus }
  | { ok: true; report: SyncReport }
  | { ok: true }
  | { ok: false; error: string };

export function send<T extends Response = Response>(message: Message): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}
