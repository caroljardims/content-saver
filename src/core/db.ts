import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { hasResidue, tombstone, type Capture, type CaptureRecord } from './model';

interface SaverDB extends DBSchema {
  captures: {
    key: string;
    value: CaptureRecord;
    indexes: {
      'by-dirty': number;
      'by-created': string;
      'by-deleted': string;
    };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

// Deliberately still 'content-saver' after the rename to Nécessaire: the name is
// the IndexedDB key, and changing it would orphan every capture already on
// disk. Renaming it is a migration, not a find-and-replace.
const DB_NAME = 'content-saver';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SaverDB>> | null = null;

function db(): Promise<IDBPDatabase<SaverDB>> {
  dbPromise ??= openDB<SaverDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const captures = database.createObjectStore('captures', { keyPath: 'id' });
      captures.createIndex('by-dirty', 'dirty');
      captures.createIndex('by-created', 'createdAt');
      captures.createIndex('by-deleted', 'deletedAt');
      database.createObjectStore('meta');
    },
  });
  return dbPromise;
}

// --- Meta -------------------------------------------------------------

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('meta', key) as Promise<T | undefined>;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}

/**
 * Identifies this browser profile. Used only to break rev ties, so it needs
 * to be stable and unique, not meaningful.
 */
export async function deviceId(): Promise<string> {
  let id = await getMeta<string>('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    await setMeta('deviceId', id);
  }
  return id;
}

// --- Captures ---------------------------------------------------------

export async function get(id: string): Promise<CaptureRecord | undefined> {
  return (await db()).get('captures', id);
}

/**
 * The only write path. Every local mutation goes through here so nothing can
 * change a capture without also marking it for push.
 */
export async function put(capture: Capture, dirty: 0 | 1 = 1): Promise<CaptureRecord> {
  const existing = await get(capture.id);
  const record: CaptureRecord = {
    ...capture,
    dirty,
    remoteId: existing?.remoteId,
    etag: existing?.etag,
    attempts: dirty === 1 ? (existing?.attempts ?? 0) : 0,
    needsAttention: dirty === 1 ? existing?.needsAttention : false,
  };
  await (await db()).put('captures', record);
  return record;
}

/** Record the outcome of a successful push without touching capture fields. */
export async function markSynced(
  id: string,
  remote: { remoteId?: string; etag?: string },
): Promise<void> {
  const existing = await get(id);
  if (!existing) return;
  await (await db()).put('captures', {
    ...existing,
    dirty: 0,
    attempts: 0,
    needsAttention: false,
    remoteId: remote.remoteId ?? existing.remoteId,
    etag: remote.etag ?? existing.etag,
  });
}

export async function markFailed(id: string, giveUpAfter = 5): Promise<void> {
  const existing = await get(id);
  if (!existing) return;
  const attempts = existing.attempts + 1;
  await (await db()).put('captures', {
    ...existing,
    attempts,
    needsAttention: attempts >= giveUpAfter,
  });
}

/** The outbox: everything with local changes that has not been pushed. */
export async function pending(): Promise<CaptureRecord[]> {
  const all = await (await db()).getAllFromIndex('captures', 'by-dirty', 1);
  return all.filter((r) => !r.needsAttention);
}

export async function list(
  opts: { includeDeleted?: boolean; includeArchived?: boolean; limit?: number } = {},
): Promise<CaptureRecord[]> {
  const all = await (await db()).getAllFromIndex('captures', 'by-created');
  const filtered = all
    .filter((r) => opts.includeDeleted || !r.deletedAt)
    .filter((r) => opts.includeArchived || !r.archived)
    .reverse();
  return opts.limit ? filtered.slice(0, opts.limit) : filtered;
}

export async function all(): Promise<CaptureRecord[]> {
  return (await db()).getAll('captures');
}

/**
 * Drop tombstones older than the cutoff. A device offline longer than this
 * resurrects those items on its next sync - the tradeoff for not keeping
 * every delete forever.
 */
export async function purgeTombstones(olderThanDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const database = await db();
  const tx = database.transaction('captures', 'readwrite');
  let purged = 0;
  for (const record of await tx.store.getAll()) {
    if (record.deletedAt && record.deletedAt < cutoff && record.dirty === 0) {
      await tx.store.delete(record.id);
      purged += 1;
    }
  }
  await tx.done;
  return purged;
}

/**
 * Empty any tombstone still carrying user content, and requeue it.
 *
 * Deletes used to keep every field and only set `deletedAt`, which left the
 * full text of a deleted capture sitting in the backend. Marking these dirty
 * makes the next push overwrite those remote files. Idempotent: once a
 * tombstone is empty it is never picked up again. Tombstones already purged
 * locally are out of reach - only clearing the app folder removes those.
 */
export async function scrubTombstones(): Promise<number> {
  const database = await db();
  const tx = database.transaction('captures', 'readwrite');
  let scrubbed = 0;

  for (const record of await tx.store.getAll()) {
    if (!hasResidue(record)) continue;
    // Keeps the existing rev and deviceId: this rewrites the same logical
    // version, so it must not look like a new edit to another device.
    const emptied = tombstone(record, {
      deletedAt: record.deletedAt as string,
      deviceId: record.deviceId,
    });
    await tx.store.put({
      ...record,
      ...emptied,
      rev: record.rev,
      updatedAt: record.updatedAt,
      dirty: 1,
      attempts: 0,
      needsAttention: false,
    });
    scrubbed += 1;
  }

  await tx.done;
  return scrubbed;
}

/**
 * Put everything back in the outbox.
 *
 * Called when the backend changes: the new one has never seen any of these,
 * including everything captured while local-only, which the null adapter has
 * already reported as "pushed". Without this, connecting an account backs up
 * nothing you saved before connecting it.
 */
export async function markAllDirty(): Promise<number> {
  const database = await db();
  const tx = database.transaction('captures', 'readwrite');
  let requeued = 0;

  for (const record of await tx.store.getAll()) {
    await tx.store.put({
      ...record,
      dirty: 1,
      attempts: 0,
      needsAttention: false,
      // The id belongs to the old backend; the new one will assign its own.
      remoteId: undefined,
      etag: undefined,
    });
    requeued += 1;
  }

  await tx.done;
  return requeued;
}

export async function clear(): Promise<void> {
  const database = await db();
  await database.clear('captures');
}
