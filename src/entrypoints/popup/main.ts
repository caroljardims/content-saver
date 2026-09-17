import type { Capture } from '../../core/model';
import type { SyncStatus } from '../../core/engine';
import { send, type CaptureSummary } from '../../lib/messages';
import { icon, type IconName } from '../../lib/icons';
import './style.css';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  savePage: $<HTMLButtonElement>('save-page'),
  saveSelection: $<HTMLButtonElement>('save-selection'),
  sync: $<HTMLButtonElement>('sync'),
  connect: $<HTMLButtonElement>('connect'),
  connectRow: $('connect-row'),
  disconnect: $<HTMLButtonElement>('disconnect'),
  status: $('status'),
  list: $<HTMLUListElement>('list'),
};

/** Which rows are open. Popup-lifetime only - it closes often enough. */
const expanded = new Set<string>();

/**
 * A row action that reports its own outcome in place, then reverts. Saves
 * every button re-implementing the same disabled/label/restore dance.
 */
function action(label: string, name: IconName, run: () => Promise<string>): HTMLButtonElement {
  const button = document.createElement('button');
  button.className =
    'flex items-center gap-1 rounded-full px-2 py-1 text-muted transition-colors hover:bg-soft hover:text-ink disabled:opacity-50';

  const glyph = icon(name);
  const text = document.createElement('span');
  text.textContent = label;
  button.append(glyph, text);

  button.addEventListener('click', async () => {
    button.disabled = true;
    text.textContent = '...';
    try {
      text.textContent = await run();
      glyph.replaceWith(icon('check'));
    } catch (error) {
      text.textContent = error instanceof Error ? error.message.slice(0, 40) : 'Failed';
      button.classList.add('text-rose');
    } finally {
      button.disabled = false;
      setTimeout(() => {
        text.textContent = label;
        button.replaceChildren(icon(name), text);
        button.classList.remove('text-rose');
      }, 2000);
    }
  });

  return button;
}

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
    'max-h-64 overflow-y-auto rounded-xl bg-soft p-3 text-xs leading-relaxed break-words whitespace-pre-wrap text-ink/90 select-text';
  body.textContent = 'Loading...';

  const actions = document.createElement('div');
  actions.className = 'mt-2 flex flex-wrap items-center gap-1 text-xs';

  const open = document.createElement('a');
  open.href = capture.url;
  open.target = '_blank';
  open.rel = 'noreferrer';
  open.className =
    'flex items-center gap-1 rounded-full px-2 py-1 text-clay transition-colors hover:bg-soft';
  const openLabel = document.createElement('span');
  openLabel.textContent = 'Open original';
  open.append(icon('external'), openLabel);

  const copy = action('Copy text', 'copy', async () => {
    await navigator.clipboard.writeText(bodies.get(capture.id) ?? '');
    return 'Copied';
  });

  const share = action('Share', 'share', async () => {
    const payload = {
      title: capture.title || capture.url,
      text: capture.excerpt || undefined,
      url: capture.url,
    };

    // The share sheet needs a user gesture and is not available everywhere;
    // falling back to the clipboard keeps the button meaningful regardless.
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return 'Shared';
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return 'Share';
      }
    }
    await navigator.clipboard.writeText(capture.url);
    return 'Link copied';
  });

  actions.append(open, copy, share);

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
  header.className = 'flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-soft';

  const toggle = document.createElement('button');
  toggle.className = 'flex min-w-0 flex-1 items-start gap-2 text-left';
  toggle.setAttribute('aria-expanded', String(expanded.has(capture.id)));

  const caret = icon('chevron', 'size-3.5 text-clay');
  caret.classList.add('mt-0.5', 'transition-transform', 'duration-150');

  const text = document.createElement('span');
  text.className = 'min-w-0 flex-1';

  const title = document.createElement('p');
  title.className = 'truncate text-sm font-medium';
  title.textContent = capture.title || capture.url;

  const meta = document.createElement('p');
  meta.className = 'truncate text-xs text-muted';
  const bits = [capture.siteName || hostOf(capture.url), relative(capture.createdAt)];
  if (capture.contentLength > 0) bits.push(words(capture.contentLength));
  meta.textContent = bits.join(' · ');

  text.append(title, meta);
  toggle.append(caret, text);

  const remove = document.createElement('button');
  remove.className =
    'invisible shrink-0 rounded-full p-1.5 text-muted transition-colors group-hover:visible hover:bg-soft hover:text-rose';
  remove.append(icon('trash'));
  remove.title = 'Delete';
  remove.setAttribute('aria-label', 'Delete');
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
    empty.className = 'px-4 py-8 text-center text-xs text-muted';
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

  // Surface the error as soon as something starts failing. Waiting for the
  // fifth attempt meant "1 to upload - synced just now" sat there looking
  // merely slow while it was actually broken.
  const broken = status.needsAttention > 0 || status.failing > 0;
  if (broken && status.lastError) parts.push(status.lastError);

  els.status.textContent = parts.join(' · ');
  els.status.className = broken
    ? 'px-4 pt-2.5 pb-1 text-xs text-rose'
    : 'px-4 pt-2.5 pb-1 text-xs text-muted';

  // Keyed off the live connection, not the stored adapter id. Keying it off
  // the id meant a failed connection hid the only button that could retry it.
  const linked = status.adapterId !== 'none' && status.connected;
  els.connectRow.classList.toggle('hidden', linked);
  els.disconnect.classList.toggle('hidden', !linked);
}

async function refresh(): Promise<void> {
  const [listRes, statusRes] = await Promise.all([
    send<{ ok: true; captures: CaptureSummary[] } | { ok: false; error: string }>({ type: 'list' }),
    send<{ ok: true; status: SyncStatus } | { ok: false; error: string }>({ type: 'status' }),
  ]);

  if (statusRes.ok) renderStatus(statusRes.status);
  if (listRes.ok) render(listRes.captures);
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
    const res = await send({ type: 'adapter:connect', id: 'gdrive' });
    if (!res.ok) throw new Error(res.error);
  }),
);

els.disconnect.addEventListener('click', () =>
  withBusy(els.disconnect, () => send({ type: 'adapter:disconnect' })),
);

void refresh();
