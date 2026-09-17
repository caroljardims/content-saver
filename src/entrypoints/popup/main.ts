import type { Capture } from '../../core/model';
import type { SyncStatus } from '../../core/engine';
import { send, type CaptureSummary } from '../../lib/messages';
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

/** Which rows are open. Popup-lifetime only - it closes often enough. */
const expanded = new Set<string>();

/** Bodies already fetched, so collapsing and reopening costs nothing. */
const bodies = new Map<string, string>();

function relative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function words(count: number): string {
  if (count < 1000) return `${count} chars`;
  return `${Math.round(count / 1000)}k chars`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function bodyFor(capture: CaptureSummary): Promise<string> {
  const cached = bodies.get(capture.id);
  if (cached !== undefined) return cached;

  const res = await send<{ ok: true; capture: Capture } | { ok: false; error: string }>({
    type: 'capture:get',
    id: capture.id,
  });

  const text = res.ok ? res.capture.content : '';
  bodies.set(capture.id, text);
  return text;
}

function buildPanel(capture: CaptureSummary): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'px-4 pb-3';

  const body = document.createElement('p');
  // max-h + overflow so a long article scrolls inside the row instead of
  // stretching the popup to the height of the whole page.
  body.className =
    'max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs leading-relaxed text-slate-700 select-text dark:bg-slate-800 dark:text-slate-300';
  body.textContent = 'Loading...';

  const actions = document.createElement('div');
  actions.className = 'mt-2 flex items-center gap-3 text-xs';

  const open = document.createElement('a');
  open.href = capture.url;
  open.target = '_blank';
  open.rel = 'noreferrer';
  open.className = 'text-slate-500 underline hover:text-slate-900 dark:hover:text-slate-200';
  open.textContent = 'Open original';

  const copy = document.createElement('button');
  copy.className = 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200';
  copy.textContent = 'Copy text';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(bodies.get(capture.id) ?? '');
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy text'), 1200);
  });

  actions.append(open, copy);
  panel.append(body, actions);

  void bodyFor(capture).then((text) => {
    // textContent, never innerHTML: this is arbitrary text from a web page.
    body.textContent =
      text.trim() ||
      capture.excerpt.trim() ||
      'No text was captured for this item - only the link.';
    copy.classList.toggle('hidden', !text.trim());
  });

  return panel;
}

function buildRow(capture: CaptureSummary): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'group';

  const header = document.createElement('div');
  header.className = 'flex items-start gap-2 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800';

  const toggle = document.createElement('button');
  toggle.className = 'flex min-w-0 flex-1 items-start gap-2 text-left';
  toggle.setAttribute('aria-expanded', String(expanded.has(capture.id)));

  const caret = document.createElement('span');
  caret.className = 'mt-0.5 shrink-0 text-xs text-slate-400 transition-transform';
  caret.textContent = '>';

  const text = document.createElement('span');
  text.className = 'min-w-0 flex-1';

  const title = document.createElement('p');
  title.className = 'truncate text-sm font-medium';
  title.textContent = capture.title || capture.url;

  const meta = document.createElement('p');
  meta.className = 'truncate text-xs text-slate-400';
  const bits = [capture.siteName || hostOf(capture.url), relative(capture.createdAt)];
  if (capture.contentLength > 0) bits.push(words(capture.contentLength));
  meta.textContent = bits.join(' · ');

  text.append(title, meta);
  toggle.append(caret, text);

  const remove = document.createElement('button');
  remove.className =
    'invisible shrink-0 rounded px-1 text-xs text-slate-400 hover:text-red-600 group-hover:visible';
  remove.textContent = 'x';
  remove.title = 'Delete';
  remove.addEventListener('click', async () => {
    await send({ type: 'capture:delete', id: capture.id });
    expanded.delete(capture.id);
    bodies.delete(capture.id);
    await refresh();
  });

  header.append(toggle, remove);
  item.append(header);

  const apply = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    caret.classList.toggle('rotate-90', open);
    item.querySelector('[data-panel]')?.remove();

    if (open) {
      const panel = buildPanel(capture);
      panel.dataset.panel = 'true';
      item.append(panel);
    }
  };

  toggle.addEventListener('click', () => {
    const open = !expanded.has(capture.id);
    if (open) expanded.add(capture.id);
    else expanded.delete(capture.id);
    apply(open);
  });

  if (expanded.has(capture.id)) apply(true);

  return item;
}

function render(captures: CaptureSummary[]): void {
  els.list.replaceChildren();

  if (captures.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'px-4 py-6 text-center text-xs text-slate-400';
    empty.textContent = 'Nothing saved yet.';
    els.list.append(empty);
    return;
  }

  for (const capture of captures) els.list.append(buildRow(capture));
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
    send<{ ok: true; captures: CaptureSummary[] } | { ok: false; error: string }>({ type: 'list' }),
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
