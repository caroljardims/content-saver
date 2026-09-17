import { getMeta, setMeta } from '../core/db';
import { driveAdapter } from './gdrive';
import { noneAdapter } from './none';
import type { AdapterId, SyncAdapter } from './types';

/**
 * Every backend the extension knows about. Adding OneDrive or Dropbox means
 * writing one file against SyncAdapter and adding it here - the engine, the
 * store and the UI need no changes.
 */
export const adapters: Record<AdapterId, SyncAdapter | null> = {
  none: noneAdapter,
  gdrive: driveAdapter,
  onedrive: null,
  dropbox: null,
  github: null,
  webdav: null,
};

export function available(): SyncAdapter[] {
  return Object.values(adapters).filter((a): a is SyncAdapter => a !== null);
}

export async function activeAdapter(): Promise<SyncAdapter> {
  const id = (await getMeta<AdapterId>('adapterId')) ?? 'none';
  return adapters[id] ?? noneAdapter;
}

/**
 * Switching backends resets the cursor but not the captures: the new backend
 * has never seen them, so they all go back in the outbox and upload.
 */
export async function setActiveAdapter(id: AdapterId): Promise<SyncAdapter> {
  const adapter = adapters[id];
  if (!adapter) throw new Error(`Adapter "${id}" is not implemented yet`);
  await setMeta('adapterId', id);
  await setMeta('cursor', undefined);
  return adapter;
}
