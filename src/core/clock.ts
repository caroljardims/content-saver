import type { Capture } from './model';

/**
 * Lamport counter, not wall-clock time.
 *
 * Browser clocks drift, and users change them. A timestamp-based
 * last-write-wins silently discards the newer edit whenever two devices
 * disagree by more than the sync interval, and it does so invisibly. A
 * counter only ever moves forward and needs no agreement between devices.
 */
export function nextRev(local: number, remote = 0): number {
  return Math.max(local, remote) + 1;
}

/**
 * Total order over two versions of the same capture.
 * Higher rev wins; deviceId breaks ties so every device picks the same winner.
 */
export function dominates(a: Capture, b: Capture): boolean {
  if (a.rev !== b.rev) return a.rev > b.rev;
  return a.deviceId > b.deviceId;
}
