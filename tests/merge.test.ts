import { describe, expect, it } from 'vitest';
import { merge, changedFrom } from '../src/core/merge';
import { dominates, nextRev } from '../src/core/clock';
import type { Capture } from '../src/core/model';

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: 'abc',
    kind: 'article',
    url: 'https://example.com/post',
    createdAt: '2026-01-01T00:00:00.000Z',
    content: 'body',
    excerpt: 'excerpt',
    siteName: 'example.com',
    title: 'Post',
    tags: [],
    notes: '',
    archived: false,
    rev: 1,
    deviceId: 'device-a',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('clock', () => {
  it('always moves forward past both sides', () => {
    expect(nextRev(3, 7)).toBe(8);
    expect(nextRev(7, 3)).toBe(8);
  });

  it('breaks rev ties the same way on every device', () => {
    const a = capture({ rev: 4, deviceId: 'device-a' });
    const b = capture({ rev: 4, deviceId: 'device-b' });
    expect(dominates(b, a)).toBe(true);
    expect(dominates(a, b)).toBe(false);
  });
});

describe('merge', () => {
  it('unions tags instead of letting the later write drop one', () => {
    const local = capture({ rev: 2, tags: ['rust'], deviceId: 'device-a' });
    const remote = capture({ rev: 3, tags: ['reading'], deviceId: 'device-b' });

    expect(merge(local, remote).tags).toEqual(['reading', 'rust']);
  });

  it('is commutative, so both devices converge on the same record', () => {
    const a = capture({ rev: 2, tags: ['x'], title: 'A', deviceId: 'device-a' });
    const b = capture({ rev: 3, tags: ['y'], title: 'B', deviceId: 'device-b' });

    const left = merge(a, b);
    const right = merge(b, a);

    expect(left.title).toBe(right.title);
    expect(left.tags).toEqual(right.tags);
    expect(left.rev).toBe(right.rev);
  });

  it('lets a delete win over a concurrent edit regardless of rev', () => {
    const deleted = capture({ rev: 2, deletedAt: '2026-02-01T00:00:00.000Z' });
    const edited = capture({ rev: 9, tags: ['later'], deviceId: 'device-b' });

    expect(merge(edited, deleted).deletedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(merge(deleted, edited).deletedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('keeps both sides of a notes conflict rather than dropping prose', () => {
    const local = capture({ rev: 2, notes: 'mine', deviceId: 'device-a' });
    const remote = capture({ rev: 3, notes: 'theirs', deviceId: 'device-b' });

    const merged = merge(local, remote);
    expect(merged.notes).toContain('mine');
    expect(merged.notes).toContain('theirs');
  });

  it('does not bump rev when the winner already contains the loser', () => {
    // Without this, two devices dirty each other on every sync and push forever.
    const local = capture({ rev: 2, tags: ['a'], deviceId: 'device-a' });
    const remote = capture({ rev: 5, tags: ['a'], title: 'Newer', deviceId: 'device-b' });

    const merged = merge(local, remote);
    expect(merged.rev).toBe(5);
    expect(merged.title).toBe('Newer');
    expect(changedFrom(merged, remote)).toBe(false);
  });

  it('treats an identical write from the same device as a no-op', () => {
    const c = capture({ rev: 4, deviceId: 'device-a' });
    expect(merge(c, { ...c })).toEqual(c);
  });

  it('converges when the same merge is applied repeatedly', () => {
    const local = capture({ rev: 2, tags: ['x'], notes: 'mine', deviceId: 'device-a' });
    const remote = capture({ rev: 3, tags: ['y'], notes: 'theirs', deviceId: 'device-b' });

    const once = merge(local, remote);
    const twice = merge(once, once);

    expect(twice.tags).toEqual(once.tags);
    expect(twice.notes).toBe(once.notes);
    expect(twice.rev).toBe(once.rev);
  });
});
