import { browser } from 'wxt/browser';
import { randomState } from './pkce';

const SCOPES = ['https://www.googleapis.com/auth/drive.appdata'];
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKENINFO = 'https://www.googleapis.com/oauth2/v3/tokeninfo';

/** Chrome exposes getAuthToken; Firefox and Edge do not. */
function hasNativeAuth(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.identity?.getAuthToken === 'function';
}

// --- Chrome path ------------------------------------------------------

function chromeToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
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

let webToken: CachedToken | null = null;

async function webAuthToken(interactive: boolean): Promise<string> {
  if (webToken && webToken.expiresAt > Date.now() + 60_000) return webToken.token;

  const clientId = import.meta.env.WXT_GOOGLE_WEB_CLIENT_ID;
  if (!clientId) throw new Error('WXT_GOOGLE_WEB_CLIENT_ID is not set');

  const redirectUri = browser.identity.getRedirectURL();
  const state = randomState();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
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
  webToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

// --- Public API -------------------------------------------------------

/**
 * One entry point for both browsers. Everything above this line is the only
 * place that knows Chrome and Firefox authenticate differently.
 */
export async function getToken({ interactive = false } = {}): Promise<string> {
  return hasNativeAuth() ? chromeToken(interactive) : webAuthToken(interactive);
}

export async function invalidateToken(token: string): Promise<void> {
  if (hasNativeAuth()) {
    await chromeInvalidate(token);
    return;
  }
  if (webToken?.token === token) webToken = null;
}

export async function signOut(): Promise<void> {
  try {
    const token = await getToken({ interactive: false });
    await invalidateToken(token);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' });
  } catch {
    // Already signed out, or never signed in. Nothing to undo.
  }
  webToken = null;
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
