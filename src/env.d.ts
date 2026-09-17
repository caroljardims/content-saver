/// <reference types="wxt/vite-builder-env" />

/**
 * Build-time config. Values come from .env (see .env.example); WXT inlines
 * anything prefixed WXT_ into the bundle.
 */
interface ImportMetaEnv {
  /** Web application OAuth client, used by the Firefox/Edge launchWebAuthFlow path. */
  readonly WXT_GOOGLE_WEB_CLIENT_ID?: string;
}
