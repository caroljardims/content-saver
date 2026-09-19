import { describe, expect, it } from 'vitest';
import {
  hasResidue,
  isValidCapture,
  normalizeCapture,
  newCapture,
  toCapture,
  tombstone,
} from '../src/core/model';
import type { CaptureRecord } from '../src/core/model';

describe('isValidCapture', () => {
  it('rejects the shapes a corrupt or hand-edited remote file can take', () => {
    expect(isValidCapture(null)).toBe(false);
    expect(isValidCapture('{}')).toBe(false);
    expect(isValidCapture({})).toBe(false);
    expect(isValidCapture({ id: 'a', url: 'u', createdAt: 'x', rev: 'one', deviceId: 'd' })).toBe(
      false,
    );
    expect(isValidCapture({ id: 'a', url: 'u', createdAt: 'x', rev: 1, deviceId: 'd' })).toBe(true);
  });
});

describe('normalizeCapture', () => {
  it('fills in fields that older versions did not write', () => {
    const old = { id: 'a', url: 'u', createdAt: 'x', rev: 1, deviceId: 'd' } as never;
    const normalized = normalizeCapture(old);

    expect(normalized.tags).toEqual([]);
    expect(normalized.archived).toBe(false);
    expect(normalized.deletedAt).toBeNull();
    expect(normalized.updatedAt).toBe('x');
  });
});

describe('toCapture', () => {
  it('strips local bookkeeping so it never reaches a backend', () => {
    const record: CaptureRecord = {
      ...newCapture({ url: 'https://example.com', deviceId: 'd' }),
      dirty: 1,
      remoteId: 'drive-file-id',
      etag: 'W/"1"',
      attempts: 3,
      needsAttention: true,
    };

    const capture = toCapture(record) as unknown as Record<string, unknown>;
    expect(capture.dirty).toBeUndefined();
    expect(capture.remoteId).toBeUndefined();
    expect(capture.attempts).toBeUndefined();
    expect(capture.needsAttention).toBeUndefined();
    expect(capture.url).toBe('https://example.com');
  });
});

describe('tombstone', () => {
  const full = {
    ...newCapture({ url: 'https://example.com/secret', deviceId: 'd' }),
    kind: 'article' as const,
    title: 'Something private',
    content: 'The whole article body.',
    excerpt: 'The whole...',
    siteName: 'example.com',
    notes: 'A note I would rather not keep.',
    tags: ['x', 'y'],
  };

  it('keeps nothing the user typed or visited', () => {
    const dead = tombstone(full, { deletedAt: '2026-01-01T00:00:00.000Z', deviceId: 'd2' });

    expect(dead.content).toBe('');
    expect(dead.notes).toBe('');
    expect(dead.excerpt).toBe('');
    expect(dead.siteName).toBe('');
    expect(dead.title).toBe('');
    expect(dead.url).toBe('');
    expect(dead.tags).toEqual([]);
  });

  it('keeps the identity and clock the sync needs', () => {
    const dead = tombstone(full, { deletedAt: '2026-01-01T00:00:00.000Z', deviceId: 'd2' });

    expect(dead.id).toBe(full.id);
    expect(dead.createdAt).toBe(full.createdAt);
    expect(dead.rev).toBe(full.rev + 1);
    expect(dead.deviceId).toBe('d2');
    expect(dead.deletedAt).toBe('2026-01-01T00:00:00.000Z');
    // Still a valid capture, or a pulling device would discard it and never
    // learn about the delete.
    expect(isValidCapture(dead)).toBe(true);
  });

  it('does not move the deletion time of an already-dead capture', () => {
    const dead = tombstone(full, { deletedAt: '2026-01-01T00:00:00.000Z', deviceId: 'd' });
    const again = tombstone(dead, { deletedAt: '2026-06-01T00:00:00.000Z', deviceId: 'd' });

    expect(again.deletedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('hasResidue', () => {
  const live = { ...newCapture({ url: 'https://example.com', deviceId: 'd' }), content: 'body' };

  it('spots a tombstone written before deletes were emptied', () => {
    const legacy = { ...live, deletedAt: '2026-01-01T00:00:00.000Z' };

    expect(hasResidue(legacy)).toBe(true);
    expect(hasResidue(tombstone(legacy, { deletedAt: 'x', deviceId: 'd' }))).toBe(false);
  });

  it('ignores live captures', () => {
    expect(hasResidue(live)).toBe(false);
  });
});
