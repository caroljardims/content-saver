import { describe, expect, it } from 'vitest';
import { isValidCapture, normalizeCapture, newCapture, toCapture } from '../src/core/model';
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
