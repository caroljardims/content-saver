/** A single saved item. One capture == one remote file. */
export interface Capture {
  /** Stable across every device and every backend. Never reassigned. */
  id: string;
  kind: 'link' | 'selection' | 'article';

  // --- Immutable after capture. These can never conflict. ---
  url: string;
  createdAt: string;
  content: string;
  excerpt: string;
  siteName: string;

  // --- Mutable. The only fields merge() ever has to reconcile. ---
  title: string;
  tags: string[];
  notes: string;
  archived: boolean;

  // --- Sync metadata. ---
  /** Lamport counter. Deliberately NOT a timestamp - see core/clock.ts. */
  rev: number;
  /** Deterministic tiebreak when two devices land on the same rev. */
  deviceId: string;
  /** Human-facing only. Never used to decide a conflict. */
  updatedAt: string;
  /** Tombstone. Non-null means deleted; the row sticks around for GC. */
  deletedAt: string | null;
}

/** Capture plus local-only bookkeeping. Never leaves the device. */
export interface CaptureRecord extends Capture {
  /** 1 = has unpushed changes. Number, not boolean, so IndexedDB can index it. */
  dirty: 0 | 1;
  /** Backend's id for this file, cached to skip a lookup on every push. */
  remoteId?: string;
  etag?: string;
  /** Consecutive push failures; drives backoff and the needsAttention flip. */
  attempts: number;
  /** Push failed repeatedly. Surfaced in the UI instead of retried forever. */
  needsAttention?: boolean;
}

export function newCapture(
  init: Partial<Capture> & { url: string; deviceId: string },
): Capture {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: 'link',
    title: '',
    content: '',
    excerpt: '',
    siteName: '',
    tags: [],
    notes: '',
    archived: false,
    rev: 1,
    updatedAt: now,
    createdAt: now,
    deletedAt: null,
    ...init,
  };
}

/**
 * Turn a capture into an empty tombstone.
 *
 * A delete has to leave *something* behind — other devices learn about it by
 * seeing the tombstone, and dropping the row outright means the next device to
 * sync pushes the capture straight back. But the tombstone only needs its
 * identity and its clock: everything the user actually saved is cleared, so a
 * delete removes the content from the backend on the next push instead of
 * leaving a full copy sitting there flagged as deleted.
 *
 * `url` goes too. It is the most identifying field of the lot, and nothing
 * reads it once `deletedAt` is set — remote files are named by id.
 */
export function tombstone(capture: Capture, at: { deletedAt: string; deviceId: string }): Capture {
  return {
    id: capture.id,
    kind: capture.kind,
    url: '',
    createdAt: capture.createdAt,
    content: '',
    excerpt: '',
    siteName: '',
    title: '',
    tags: [],
    notes: '',
    archived: capture.archived,
    rev: capture.rev + 1,
    deviceId: at.deviceId,
    updatedAt: at.deletedAt,
    deletedAt: capture.deletedAt ?? at.deletedAt,
  };
}

/** True when a tombstone still carries user content that should be cleared. */
export function hasResidue(capture: Capture): boolean {
  return Boolean(
    capture.deletedAt &&
      (capture.url ||
        capture.content ||
        capture.excerpt ||
        capture.siteName ||
        capture.title ||
        capture.notes ||
        capture.tags.length),
  );
}

/** Strip local bookkeeping before handing a record to an adapter. */
export function toCapture(record: CaptureRecord): Capture {
  const { dirty, remoteId, etag, attempts, needsAttention, ...capture } = record;
  return capture;
}

const REQUIRED: (keyof Capture)[] = ['id', 'url', 'createdAt', 'rev', 'deviceId'];

/**
 * Remote data is untrusted: it may come from an older version of this
 * extension, a hand-edited file, or a half-written upload.
 */
export function isValidCapture(value: unknown): value is Capture {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (!REQUIRED.every((k) => c[k] !== undefined && c[k] !== null)) return false;
  if (typeof c.id !== 'string' || typeof c.url !== 'string') return false;
  if (typeof c.rev !== 'number' || !Number.isFinite(c.rev)) return false;
  if (typeof c.deviceId !== 'string') return false;
  return true;
}

/** Fill in fields added by later versions so old files keep working. */
export function normalizeCapture(raw: Capture): Capture {
  return {
    ...raw,
    kind: raw.kind ?? 'link',
    title: raw.title ?? '',
    content: raw.content ?? '',
    excerpt: raw.excerpt ?? '',
    siteName: raw.siteName ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    notes: raw.notes ?? '',
    archived: Boolean(raw.archived),
    deletedAt: raw.deletedAt ?? null,
    updatedAt: raw.updatedAt ?? raw.createdAt,
  };
}
