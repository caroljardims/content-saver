import { browser } from 'wxt/browser';
import { activeAdapter } from '../adapters/registry';
import type { SyncAdapter } from '../adapters/types';
import * as db from './db';
import { changedFrom, merge } from './merge';
import { normalizeCapture, toCapture, type Capture } from './model';

export interface SyncReport {
  pulled: number;
  merged: number;
  pushed: number;
  failed: number;
  purged: number;
  error?: string;
}

export interface SyncStatus {
  adapterId: string;
  adapterName: string;
  connected: boolean;
  lastSyncAt?: string;
  lastError?: string;
  pending: number;
  needsAttention: number;
  /** Pending items that have already failed at least once. */
  failing: number;
}

/** Guards against overlapping runs when an alarm fires mid-sync. */
let running: Promise<SyncReport> | null = null;

/** A sync was requested while one was already in flight. */
let rerunRequested = false;

const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

/**
 * Coalescing alone was not enough. push() works from a snapshot of the outbox
 * taken when the run starts, so anything saved mid-run was not in that
 * snapshot - and its own sync() call just joined the run already in progress
 * instead of scheduling another. Saving two pages quickly left the second one
 * pending until the next alarm, five minutes later, while the status line
 * cheerfully said "synced just now".
 */
export function sync(opts: { interactive?: boolean } = {}): Promise<SyncReport> {
  if (running) {
    rerunRequested = true;
    return running;
  }

  running = (async () => {
    let report = await runSync(opts);
    while (rerunRequested) {
      rerunRequested = false;
      report = await runSync(opts);
    }
    return report;
  })().finally(() => {
    running = null;
    rerunRequested = false;
  });

  return running;
}

async function runSync({ interactive = false }): Promise<SyncReport> {
  const report: SyncReport = { pulled: 0, merged: 0, pushed: 0, failed: 0, purged: 0 };
  const adapter = await activeAdapter();

  try {
    if (!(await adapter.isConnected())) {
      if (!interactive) throw new Error('Not connected');
      await adapter.connect({ interactive: true });
    }

    // Push even when the pull fails. These are independent directions, and
    // gating uploads on a working download meant one bad pull kept every
    // local capture stranded in the outbox indefinitely.
    let pullError: unknown;
    try {
      await pull(adapter, report);
    } catch (error) {
      pullError = error;
      console.warn('[content-saver] pull failed, still pushing:', error);
    }

    await push(adapter, report);
    if (pullError) throw pullError;

    report.purged = await db.purgeTombstones();
    await maybeCompact(adapter);

    await db.setMeta('lastSyncAt', new Date().toISOString());
    await db.setMeta('lastError', undefined);
    await db.setMeta('backoffIndex', 0);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    console.error('[content-saver] sync failed:', error);
    await db.setMeta('lastError', report.error);
    await scheduleBackoff();
  }

  return report;
}

/**
 * Pull remote changes and fold them into the local store.
 *
 * The local record is always the base: remote data can only ever merge into
 * it, never replace it wholesale.
 */
async function pull(adapter: SyncAdapter, report: SyncReport): Promise<void> {
  let cursor = await db.getMeta<string>('cursor');
  let hasMore = true;
  let pages = 0;

  while (hasMore && pages < 20) {
    const result = await adapter.pull(cursor);
    pages += 1;

    for (const { capture, remoteId, etag } of result.records) {
      report.pulled += 1;
      const remote = normalizeCapture(capture);
      const existing = await db.get(remote.id);

      if (!existing) {
        await db.put(remote, 0);
        await db.markSynced(remote.id, { remoteId, etag });
        continue;
      }

      const local = toCapture(existing);
      const merged = merge(local, remote);

      // Dirty only when the merge produced something the remote does not
      // have yet. Otherwise the two devices push at each other forever.
      const needsPush = changedFrom(merged, remote);
      if (changedFrom(merged, local) || needsPush) {
        report.merged += 1;
        await db.put(merged, needsPush ? 1 : 0);
        if (!needsPush) await db.markSynced(merged.id, { remoteId, etag });
      }
    }

    cursor = result.cursor;
    hasMore = result.hasMore;
    await db.setMeta('cursor', cursor);
  }
}

async function push(adapter: SyncAdapter, report: SyncReport): Promise<void> {
  const queue = await db.pending();
  if (queue.length === 0) return;

  const outcomes = await adapter.push(queue.map(toCapture));

  for (const outcome of outcomes) {
    switch (outcome.status) {
      case 'ok':
        report.pushed += 1;
        await db.markSynced(outcome.id, { remoteId: outcome.remoteId, etag: outcome.etag });
        break;

      case 'conflict': {
        // The adapter detected a concurrent write. Merge and leave it dirty
        // so the next run pushes the reconciled version.
        const existing = await db.get(outcome.id);
        if (existing) {
          await db.put(merge(toCapture(existing), normalizeCapture(outcome.remote.capture)), 1);
        }
        report.merged += 1;
        break;
      }

      case 'retry':
        await db.markFailed(outcome.id);
        break;

      case 'failed':
        report.failed += 1;
        await db.markFailed(outcome.id);
        break;
    }
  }
}

/** Rewrite the remote index at most once an hour - it is only a cache. */
async function maybeCompact(adapter: SyncAdapter): Promise<void> {
  if (!adapter.compact) return;
  const last = await db.getMeta<number>('lastCompactAt');
  if (last && Date.now() - last < 3_600_000) return;

  try {
    await adapter.compact((await db.all()).map(toCapture));
    await db.setMeta('lastCompactAt', Date.now());
  } catch {
    // The index is rebuildable from the item files. Not worth surfacing.
  }
}

async function scheduleBackoff(): Promise<void> {
  const index = (await db.getMeta<number>('backoffIndex')) ?? 0;
  const delay = BACKOFF_MS[Math.min(index, BACKOFF_MS.length - 1)]!;
  await db.setMeta('backoffIndex', index + 1);
  await browser.alarms.create('sync-retry', { when: Date.now() + delay });
}

export async function status(): Promise<SyncStatus> {
  const adapter = await activeAdapter();
  const all = await db.all();
  return {
    adapterId: adapter.id,
    adapterName: adapter.displayName,
    connected: await adapter.isConnected(),
    lastSyncAt: await db.getMeta<string>('lastSyncAt'),
    lastError: await db.getMeta<string>('lastError'),
    pending: all.filter((r) => r.dirty === 1 && !r.needsAttention).length,
    needsAttention: all.filter((r) => r.needsAttention).length,
    failing: all.filter((r) => r.dirty === 1 && r.attempts > 0 && !r.needsAttention).length,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/**
 * Save a capture, then upload it.
 *
 * The upload is awaited rather than fired and forgotten. A floating promise
 * does not keep an MV3 service worker alive: the worker can be torn down the
 * moment the event handler returns, killing the upload halfway. Awaiting
 * inside the handler is what keeps the worker running until it finishes.
 *
 * The local write has already happened by this point, so a slow or failing
 * network delays the confirmation but can never lose the capture.
 */
export async function save(capture: Capture): Promise<Capture> {
  await db.put(capture, 1);
  await withTimeout(
    sync().catch(() => undefined),
    15_000,
  );
  return capture;
}
