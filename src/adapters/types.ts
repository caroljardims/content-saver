import type { Capture } from '../core/model';

export type AdapterId = 'none' | 'gdrive' | 'onedrive' | 'dropbox' | 'github' | 'webdav';

export interface AdapterCapabilities {
  /** Has a native delta feed. If false, the engine does a filtered full list. */
  delta: boolean;
  /**
   * Supports If-Match style optimistic concurrency.
   * Note: Google Drive v3 does NOT - it dropped the ETags that v2 had. The
   * field-aware merge in core/merge.ts is what covers that gap.
   */
  conditionalWrite: boolean;
  /** Per-item ceiling in bytes. The engine truncates content above this. */
  maxItemBytes: number;
  /** Data is hidden from the user (app-data folder) rather than browsable. */
  hidden: boolean;
}

export interface RemoteRecord {
  capture: Capture;
  /** Backend's identifier: Drive file id, Dropbox path, gist filename... */
  remoteId: string;
  etag?: string;
}

export interface PullResult {
  records: RemoteRecord[];
  /** Opaque; handed back verbatim on the next pull. */
  cursor: string;
  hasMore: boolean;
}

export type PushOutcome =
  | { status: 'ok'; id: string; remoteId: string; etag?: string }
  | { status: 'conflict'; id: string; remote: RemoteRecord }
  | { status: 'retry'; id: string; afterMs: number }
  | { status: 'failed'; id: string; reason: string };

export interface AccountInfo {
  accountLabel: string;
}

/**
 * One backend. Everything the sync engine knows about remote storage is
 * behind this interface, so adding OneDrive or Dropbox is a new file here and
 * nothing else.
 */
export interface SyncAdapter {
  readonly id: AdapterId;
  readonly displayName: string;
  readonly capabilities: AdapterCapabilities;

  connect(opts: { interactive: boolean }): Promise<AccountInfo>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;

  pull(cursor?: string): Promise<PullResult>;

  /** Batch upsert. Tombstones go through here too, as records with deletedAt. */
  push(records: Capture[]): Promise<PushOutcome[]>;

  /** Optional summary index for fast first paint on a new device. */
  compact?(captures: Capture[]): Promise<void>;
}
