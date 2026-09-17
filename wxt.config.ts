import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',

  // Not the default ".output": a leading dot makes the folder hidden in
  // macOS file pickers, and "Load unpacked" needs you to navigate into it.
  outDir: 'dist',

  // MV3 on Firefox too (event page rather than service worker, handled by WXT).
  // The MV2 default would leave us without browser.action and browser.scripting,
  // which the background relies on.
  manifestVersion: 3,

  vite: () => ({
    plugins: [tailwindcss()],
  }),

  hooks: {
    /**
     * The content script is registered at runtime, so WXT adds its match
     * pattern to host_permissions. We do not want that: the script is injected
     * on demand under activeTab, after a user gesture, and an install prompt
     * reading "read all your data on all websites" is the single biggest
     * reason people decline an extension like this.
     */
    'build:manifestGenerated'(_wxt, manifest) {
      manifest.host_permissions = manifest.host_permissions?.filter(
        (pattern) => !pattern.includes('://*/*') || pattern.startsWith('https://www.googleapis.com'),
      );
    },
  },

  manifest: ({ browser }) => ({
    name: 'Content Saver',
    description: 'Save links, selections and article text to storage you own.',

    permissions: ['identity', 'activeTab', 'scripting', 'storage', 'alarms', 'contextMenus'],

    // WXT fills `icons` from public/icon/*.png on its own. Chrome falls back
    // to those for the toolbar, but the store review reads default_icon, so
    // state it rather than relying on the fallback.
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },

    host_permissions: ['https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*'],

    commands: {
      'save-page': {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
        description: 'Save the current page',
      },
    },

    // Chrome-only: enables the silent chrome.identity.getAuthToken path.
    // Firefox ignores this block and falls back to launchWebAuthFlow.
    ...(browser === 'chrome'
      ? {
          // Only emitted when a client is actually configured. Chromium
          // rejects the manifest outright if oauth2.client_id is empty, and
          // browsers other than Chrome never use this block anyway.
          ...(process.env.WXT_GOOGLE_CLIENT_ID
            ? {
                oauth2: {
                  client_id: process.env.WXT_GOOGLE_CLIENT_ID,
                  scopes: ['https://www.googleapis.com/auth/drive.appdata'],
                },
              }
            : {}),
          // Pins the extension ID so it matches the registered OAuth client.
          // See README, "Pinning the extension ID".
          ...(process.env.WXT_EXTENSION_KEY ? { key: process.env.WXT_EXTENSION_KEY } : {}),
        }
      : {
          browser_specific_settings: {
            gecko: {
              id: 'content-saver@local',
              strict_min_version: '115.0',
            },
          },
        }),
  }),
});
