import type { Capture } from '../../core/model';
import type { SyncStatus } from '../../core/engine';
import { send } from '../../lib/messages';
import './style.css';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  savePage: $<HTMLButtonElement>('save-page'),
  saveSelection: $<HTMLButtonElement>('save-selection'),
  sync: $<HTMLButtonElement>('sync'),
  connect: $<HTMLButtonElement>('connect'),
  connectRow: $('connect-row'),
  status: $('status'),
  list: $<HTMLUListElement>('list'),
};

function relative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function render(captures: Capture[]): void {
  els.list.replaceChildren();

  if (captures.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'px-4 py-6 text-center text-xs text-slate-400';
    empty.textContent = 'Nothing saved yet.';
    els.list.append(empty);
    return;
  }

  for (const capture of captures) {
    const item = document.createElement('li');
    item.className = 'group flex items-start gap-2 px-4 py-2 hover:bg-slate-50';

    const link = document.createElement('a');
    link.href = capture.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.className = 'min-w-0 flex-1';

    const title = document.createElement('p');
    title.className = 'truncate text-sm font-medium';
    // textContent, never innerHTML: titles and excerpts come from arbitrary pages.
    title.textContent = capture.title || capture.url;

    const meta = document.createElement('p');
    meta.className = 'truncate text-xs text-slate-400';
    meta.textContent = `${capture.siteName || new URL(capture.url).hostname} · ${relative(capture.createdAt)}`;

    link.append(title, meta);

    const remove = document.createElement('button');
    remove.className =
      'invisible shrink-0 rounded px-1 text-xs text-slate-400 hover:text-red-600 group-hover:visible';
    remove.textContent = 'x';
    remove.title = 'Delete';
    remove.addEventListener('click', async () => {
      await send({ type: 'capture:delete', id: capture.id });
      await refresh();
    });

    item.append(link, remove);
    els.list.append(item);
  }
}

function renderStatus(status: SyncStatus): void {
  const parts: string[] = [status.connected ? status.adapterName : 'This device only'];

  if (status.pending > 0) parts.push(`${status.pending} to upload`);
  if (status.needsAttention > 0) parts.push(`${status.needsAttention} failed`);
  if (status.lastSyncAt) parts.push(`synced ${relative(status.lastSyncAt)}`);

  els.status.textContent = parts.join(' · ');
  els.status.className =
    status.needsAttention > 0
      ? 'px-4 pb-2 text-xs text-red-600'
      : 'px-4 pb-2 text-xs text-slate-500';

  els.connectRow.classList.toggle('hidden', status.adapterId !== 'none');
}

async function refresh(): Promise<void> {
  const [listRes, statusRes] = await Promise.all([
    send<{ ok: true; captures: Capture[] } | { ok: false; error: string }>({ type: 'list' }),
    send<{ ok: true; status: SyncStatus } | { ok: false; error: string }>({ type: 'status' }),
  ]);

  if (listRes.ok) render(listRes.captures);
  if (statusRes.ok) renderStatus(statusRes.status);
}

/** Disable the button for the duration so a double-click cannot double-save. */
async function withBusy(button: HTMLButtonElement, fn: () => Promise<unknown>): Promise<void> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '...';
  try {
    await fn();
  } catch (error) {
    els.status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
    button.textContent = label;
    await refresh();
  }
}

els.savePage.addEventListener('click', () =>
  withBusy(els.savePage, () => send({ type: 'capture:page' })),
);

els.saveSelection.addEventListener('click', () =>
  withBusy(els.saveSelection, () => send({ type: 'capture:selection' })),
);

els.sync.addEventListener('click', () =>
  withBusy(els.sync, () => send({ type: 'sync', interactive: true })),
);

els.connect.addEventListener('click', () =>
  withBusy(els.connect, async () => {
    await send({ type: 'adapter:set', id: 'gdrive' });
    await send({ type: 'adapter:connect' });
  }),
);

void refresh();
