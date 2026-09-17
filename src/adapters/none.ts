import type { Capture } from '../core/model';
import type { PullResult, PushOutcome, SyncAdapter } from './types';

/**
 * The "not connected" backend.
 *
 * Local-only is not a special case in this codebase - it is this adapter.
 * That keeps every `if (isLoggedIn)` branch out of the sync engine, and means
 * captures made before connecting an account are already sitting in the
 * outbox, ready to upload the moment a real adapter is selected.
 */
export const noneAdapter: SyncAdapter = {
  id: 'none',
  displayName: 'This device only',
  capabilities: {
    delta: false,
    conditionalWrite: false,
    maxItemBytes: Number.MAX_SAFE_INTEGER,
    hidden: false,
  },

  async connect() {
    return { accountLabel: 'Local storage' };
  },

  async disconnect() {},

  async isConnected() {
    return true;
  },

  async pull(): Promise<PullResult> {
    return { records: [], cursor: '', hasMore: false };
  },

  /**
   * Reports success without doing anything, so records are not left dirty
   * forever. They are already durable in IndexedDB; there is simply nowhere
   * else for them to go yet.
   */
  async push(records: Capture[]): Promise<PushOutcome[]> {
    return records.map((c) => ({ status: 'ok' as const, id: c.id, remoteId: '' }));
  },
};
