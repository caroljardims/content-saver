import { getToken, invalidateToken, SCOPE_DRIVE_FILE } from '../auth/token';
import type { Capture } from '../core/model';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_NAME = 'Content Saver';

const SCOPES = [SCOPE_DRIVE_FILE];

/**
 * Deliberately separate from the sync adapter.
 *
 * Sync lives in the hidden appDataFolder under drive.appdata. This writes a
 * real file the user can open, share and keep after uninstalling, which needs
 * drive.file - a different scope with a different consent screen. Keeping the
 * two apart means the everyday sync path never asks for write access to
 * visible Drive files.
 */
async function driveFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken({ interactive: true, scopes: SCOPES });
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && retry) {
    await invalidateToken(token, SCOPES);
    return driveFetch(url, init, false);
  }
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

/**
 * drive.file only ever lists files this app created, so this finds our own
 * folder without being able to see anything else in the user's Drive.
 */
async function ensureFolder(): Promise<string> {
  const params = new URLSearchParams({
    q: `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id)',
    pageSize: '1',
  });
  const found = (await (await driveFetch(`${FILES}?${params}`)).json()) as {
    files?: { id: string }[];
  };
  if (found.files?.[0]) return found.files[0].id;

  const created = (await (
    await driveFetch(`${FILES}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    })
  ).json()) as { id: string };
  return created.id;
}

/** Drive rejects these outright in a filename. */
function safeName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '-').trim();
  return (cleaned || 'Untitled').slice(0, 120);
}

function toMarkdown(capture: Capture): string {
  const saved = new Date(capture.createdAt).toLocaleString();
  const header = [
    `# ${capture.title || capture.url}`,
    '',
    `[${capture.siteName || capture.url}](${capture.url})`,
    `Saved ${saved}`,
  ];
  if (capture.tags.length) header.push('', `Tags: ${capture.tags.join(', ')}`);
  if (capture.notes) header.push('', '## Notes', '', capture.notes);

  const body = capture.content.trim() || capture.excerpt.trim();
  if (body) header.push('', '---', '', body);

  return header.join('\n');
}

export interface ExportResult {
  fileId: string;
  link: string;
}

/** Write one capture into the user's visible Drive as a Markdown file. */
export async function exportCaptureToDrive(capture: Capture): Promise<ExportResult> {
  const folderId = await ensureFolder();
  const boundary = `boundary-${crypto.randomUUID()}`;
  const metadata = {
    name: `${safeName(capture.title)}.md`,
    parents: [folderId],
    mimeType: 'text/markdown',
    description: capture.url,
  };

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/markdown; charset=UTF-8',
    '',
    toMarkdown(capture),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const file = (await (
    await driveFetch(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
  ).json()) as { id: string; webViewLink?: string };

  return {
    fileId: file.id,
    link: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
  };
}
