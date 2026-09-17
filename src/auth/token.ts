import { browser } from 'wxt/browser';
import { randomState } from './pkce';

/** Hidden per-app folder. Enough to sync, cannot create anything visible. */
export const SCOPE_APPDATA = 'https://www.googleapis.com/auth/drive.appdata';

/**
 * Files this app creates, visible in the user's Drive. Requested separately
 * and only when the user asks to export something, so the common case never
 * has to consent to it. Non-sensitive, unlike the broader Drive scopes.
 */
export const SCOPE_DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

const SCOPES = [SCOPE_APPDATA];
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKENINFO = 'https://www.googleapis.com/oauth2/v3/tokeninfo';

/** Chrome exposes getAuthToken; Firefox and Edge do not. */
function hasNativeAuth(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.identity?.getAuthToken === 'function';
}

function nativeClientId(): string | undefined {
  const manifest = browser.runtime.getManifest() as { oauth2?: { client_id?: string } };
  const id = manifest.oauth2?.client_id;
  return id && !id.startsWith('REPLACE_ME') ? id : undefined;
}

function webClientId(): string | undefined {
  return import.meta.env.WXT_GOOGLE_WEB_CLIENT_ID || undefined;
}

/**
 * Fail with something a human can act on. Without this the user is handed
 * a raw Google error page, which says nothing about the real cause.
 */
function assertConfigured(): void {
  if (nativeClientId() || webClientId()) return;
  throw new Error(
    'Google Drive is not set up yet. Add your OAuth client ID to .env and rebuild - see the README.',
  );
}

// --- Chrome path ------------------------------------------------------

function chromeToken(interactive: boolean, scopes: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes }, (token) => {
      const error = chrome.runtime.lastError;
      if (error || !token) {
        reject(new Error(error?.message ?? 'No token returned'));
        return;
      }
      resolve(token as string);
    });
  });
}

function chromeInvalidate(token: string): Promise<void> {
  return new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, () => resolve()));
}

// --- Firefox / Edge path ---------------------------------------------

/**
 * Implicit grant, deliberately.
 *
 * A Google "Web application" client requires a client secret at the token
 * exchange, and there is no way to ship a secret in an extension. So on
 * non-Chrome browsers we take the access token straight from the redirect
 * fragment: no refresh token, roughly one hour of validity, and a silent
 * re-auth with interactive:false when it lapses.
 */
interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Keyed by scope set, not global. A drive.appdata token cannot write a visible
 * file and a drive.file token cannot see the hidden folder, so caching them
 * under one key would hand the wrong token to whichever call came second.
 */
const tokenKey = (scopes: string[]) => `googleWebToken:${[...scopes].sort().join(' ')}`;

/**
 * Persisted, not held in a module variable.
 *
 * The MV3 service worker is torn down after ~30s idle, which would discard an
 * in-memory token. Every later background sync then found itself "not
 * connected" and silently skipped uploading, while clicking Connect appeared
 * to work every time.
 */
async function readToken(scopes: string[]): Promise<CachedToken | null> {
  const key = tokenKey(scopes);
  const stored = await browser.storage.local.get(key);
  return (stored[key] as CachedToken | undefined) ?? null;
}

async function writeToken(scopes: string[], value: CachedToken | null): Promise<void> {
  const key = tokenKey(scopes);
  if (value) await browser.storage.local.set({ [key]: value });
  else await browser.storage.local.remove(key);
}

async function webAuthToken(interactive: boolean, scopes: string[]): Promise<string> {
  const cached = await readToken(scopes);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const clientId = webClientId();
  if (!clientId) throw new Error('WXT_GOOGLE_WEB_CLIENT_ID is not set');

  const redirectUri = browser.identity.getRedirectURL();
  const state = randomState();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    prompt: interactive ? 'consent' : 'none',
  });

  const redirect = await browser.identity.launchWebAuthFlow({
    url: `${AUTH_ENDPOINT}?${params}`,
    interactive,
  });
  if (!redirect) throw new Error('Authorization was cancelled');

  const fragment = new URLSearchParams(new URL(redirect).hash.slice(1));
  if (fragment.get('state') !== state) throw new Error('OAuth state mismatch');

  const token = fragment.get('access_token');
  if (!token) throw new Error(fragment.get('error') ?? 'No access token in redirect');

  const expiresIn = Number(fragment.get('expires_in') ?? 3600);
  await writeToken(scopes, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

// --- Public API -------------------------------------------------------

/**
 * One entry point for both browsers. Everything above this line is the only
 * place that knows Chrome and Firefox authenticate differently.
 */
export async function getToken({
  interactive = false,
  scopes = SCOPES,
}: { interactive?: boolean; scopes?: string[] } = {}): Promise<string> {
  assertConfigured();

  // getAuthToken exists in every Chromium build, but only actually works in
  // Google Chrome with a signed-in profile. Arc, Brave and Vivaldi expose it
  // and then fail, so treat a failure as "use the web flow instead" rather
  // than as fatal.
  if (hasNativeAuth() && nativeClientId()) {
    try {
      return await chromeToken(interactive, scopes);
    } catch (error) {
      if (!webClientId()) throw error;
    }
  }

  return webAuthToken(interactive, scopes);
}

export async function invalidateToken(token: string, scopes: string[] = SCOPES): Promise<void> {
  if (hasNativeAuth() && nativeClientId()) await chromeInvalidate(token);

  const cached = await readToken(scopes);
  if (cached?.token === token) await writeToken(scopes, null);
}

export async function signOut(): Promise<void> {
  try {
    const token = await getToken({ interactive: false });
    await invalidateToken(token);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' });
  } catch {
    // Already signed out, or never signed in. Nothing to undo.
  }
  // Drop every scope's token, not just the sync one.
  await writeToken(SCOPES, null);
  await writeToken([SCOPE_DRIVE_FILE], null);
}

/** The signed-in account's email, for display in the popup. */
export async function accountLabel(): Promise<string> {
  try {
    const token = await getToken({ interactive: false });
    const res = await fetch(`${TOKENINFO}?access_token=${token}`);
    if (!res.ok) return 'Google account';
    const info = (await res.json()) as { email?: string };
    return info.email ?? 'Google account';
  } catch {
    return 'Google account';
  }
}
