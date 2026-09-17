import { accountLabel, getToken, invalidateToken, signOut } from '../auth/token';
import { isValidCapture, normalizeCapture, type Capture } from '../core/model';
import type { PullResult, PushOutcome, RemoteRecord, SyncAdapter } from './types';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const CHANGES = 'https://www.googleapis.com/drive/v3/changes';
const SPACE = 'appDataFolder';

/** Summary file for fast first paint. A cache - never the source of truth. */
const INDEX_FILE = 'index.json';

const fileNameFor = (id: string) => `c-${id}.json`;

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  trashed?: boolean;
}

/**
 * Drive hands back cached tokens that have already expired often enough that
 * every call needs this: on 401, drop the token and retry exactly once.
 */
async function driveFetch(url: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken({ interactive: false });
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && retry) {
    await invalidateToken(token);
    return driveFetch(url, options, false);
  }
  return res;
}

async function driveJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await driveFetch(url, options);
  if (!res.ok) throw new DriveError(res.status, await res.text());
  return res.json() as Promise<T>;
}

export class DriveError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Drive ${status}: ${detail.slice(0, 200)}`);
  }

  /** 429 and 5xx are transient; the engine should back off rather than fail. */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

async function findByName(name: string): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    spaces: SPACE,
    q: `name = '${name.replace(/'/g, "\\'")}' and trashed = false`,
    fields: 'files(id, name, modifiedTime)',
    pageSize: '1',
  });
  const { files } = await driveJson<{ files?: DriveFile[] }>(`${FILES}?${params}`);
  return files?.[0] ?? null;
}

async function createFile(name: string, data: unknown): Promise<DriveFile> {
  const boundary = `boundary-${crypto.randomUUID()}`;
  const metadata = { name, parents: [SPACE], mimeType: 'application/json' };

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify(data),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return driveJson<DriveFile>(`${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

async function updateFile(fileId: string, data: unknown): Promise<DriveFile> {
  return driveJson<DriveFile>(`${UPLOAD}/${fileId}?uploadType=media&fields=id,name,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

async function readFile(fileId: string): Promise<unknown> {
  const res = await driveFetch(`${FILES}/${fileId}?alt=media`);
  if (!res.ok) throw new DriveError(res.status, await res.text());
  return res.json();
}

/** Parse a downloaded file, discarding anything that is not a valid capture. */
async function toRemoteRecord(file: DriveFile): Promise<RemoteRecord | null> {
  if (file.name === INDEX_FILE) return null;
  try {
    const raw = await readFile(file.id);
    if (!isValidCapture(raw)) return null;
    return { capture: normalizeCapture(raw), remoteId: file.id };
  } catch {
    // A half-written or hand-edited file should not stall the whole sync.
    return null;
  }
}

export const driveAdapter: SyncAdapter = {
  id: 'gdrive',
  displayName: 'Google Drive',

  capabilities: {
    delta: true,
    // Drive v3 dropped the ETags that v2 had, so there is no If-Match to use.
    // core/merge.ts is what keeps concurrent edits from losing data instead.
    conditionalWrite: false,
    maxItemBytes: 10 * 1024 * 1024,
    hidden: true,
  },

  async connect({ interactive }) {
    await getToken({ interactive });
    return { accountLabel: await accountLabel() };
  },

  async disconnect() {
    await signOut();
  },

  async isConnected() {
    try {
      await getToken({ interactive: false });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * First run walks every file and returns a start token for later. After
   * that it reads the changes feed, which only reports what actually moved.
   */
  async pull(cursor?: string): Promise<PullResult> {
    if (!cursor) {
      const params = new URLSearchParams({
        spaces: SPACE,
        q: "mimeType = 'application/json' and trashed = false",
        fields: 'nextPageToken, files(id, name, modifiedTime)',
        pageSize: '200',
      });
      const page = await driveJson<{ files?: DriveFile[]; nextPageToken?: string }>(
        `${FILES}?${params}`,
      );

      const records = (
        await Promise.all((page.files ?? []).map(toRemoteRecord))
      ).filter((r): r is RemoteRecord => r !== null);

      const { startPageToken } = await driveJson<{ startPageToken: string }>(
        `${CHANGES}/startPageToken?spaces=${SPACE}`,
      );

      return { records, cursor: startPageToken, hasMore: Boolean(page.nextPageToken) };
    }

    const params = new URLSearchParams({
      spaces: SPACE,
      pageToken: cursor,
      fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, trashed))',
      pageSize: '200',
    });
    const page = await driveJson<{
      changes?: { fileId: string; removed?: boolean; file?: DriveFile }[];
      nextPageToken?: string;
      newStartPageToken?: string;
    }>(`${CHANGES}?${params}`);

    const live = (page.changes ?? [])
      .filter((c) => !c.removed && c.file && !c.file.trashed)
      .map((c) => c.file as DriveFile);

    const records = (await Promise.all(live.map(toRemoteRecord))).filter(
      (r): r is RemoteRecord => r !== null,
    );

    return {
      records,
      cursor: page.nextPageToken ?? page.newStartPageToken ?? cursor,
      hasMore: Boolean(page.nextPageToken),
    };
  },

  async push(captures: Capture[]): Promise<PushOutcome[]> {
    const outcomes: PushOutcome[] = [];

    // Sequential on purpose: Drive rate-limits per user, and a burst of
    // parallel writes is the fastest way to collect 429s.
    for (const capture of captures) {
      const name = fileNameFor(capture.id);
      try {
        const existing = await findByName(name);
        const file = existing
          ? await updateFile(existing.id, capture)
          : await createFile(name, capture);
        outcomes.push({ status: 'ok', id: capture.id, remoteId: file.id });
      } catch (error) {
        if (error instanceof DriveError && error.transient) {
          outcomes.push({ status: 'retry', id: capture.id, afterMs: 60_000 });
        } else {
          outcomes.push({
            status: 'failed',
            id: capture.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return outcomes;
  },

  /**
   * Rewrite the summary index. Rebuildable from the item files at any time,
   * so a failure here is not worth reporting.
   */
  async compact(captures: Capture[]): Promise<void> {
    const index = {
      version: 1,
      generatedAt: new Date().toISOString(),
      items: captures
        .filter((c) => !c.deletedAt)
        .map(({ id, title, url, tags, createdAt, rev, siteName }) => ({
          id,
          title,
          url,
          tags,
          createdAt,
          rev,
          siteName,
        })),
    };

    const existing = await findByName(INDEX_FILE);
    if (existing) await updateFile(existing.id, index);
    else await createFile(INDEX_FILE, index);
  },
};
