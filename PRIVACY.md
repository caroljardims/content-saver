# Privacy Policy — Nécessaire

_Last updated: 16 September 2026_

Nécessaire is a browser extension that saves links, text selections and
article text so you can read them later. This policy describes exactly what it
does with that data.

## The short version

Nécessaire has no servers. There is no backend, no database, no analytics
and no account with us — there is no "us" to have an account with. Everything
you save stays on your own device unless you choose to connect your own Google
Drive, in which case it goes to your Drive and nowhere else.

## What is collected

Only what you explicitly save. When you click "Save page", "Save selection", or
use the context menu, the extension stores:

- the page URL, title and site name
- the article text or the text you selected
- the date you saved it, and any tags or notes you add

The extension does not track your browsing. It reads a page only at the moment
you ask it to save that page, and only the tab you are looking at. It does not
run on pages in the background, does not record history, and does not observe
tabs you have not asked it to save.

## Where it is stored

**On your device.** Every capture is written to your browser's local storage
(IndexedDB). This is the primary copy and it never leaves your machine on its
own.

**In your Google Drive, only if you connect it.** If you connect an account,
captures are synced to a private application folder in your own Google Drive.
That data lives in your Drive, under your Google account, counting against your
storage quota. We have no access to it.

The extension requests only the
`https://www.googleapis.com/auth/drive.appdata` scope, which can read and write
a hidden folder reserved for this extension. It cannot see, read or modify any
other file in your Drive.

## What is never done

- No data is sent to the developer or to any third party.
- No analytics, telemetry, crash reporting or usage statistics.
- No advertising, no profiling, no data sold or shared.
- Nothing is transmitted anywhere except between your browser and your own
  Google Drive.

## Authentication

If you connect Google Drive, an access token is stored in your browser's
extension storage so syncing can continue without asking you to sign in
repeatedly. The token is held only on your device and is discarded when you
disconnect your account.

## Deleting your data

- **Individual captures:** delete them in the extension. The deletion syncs to
  your Drive copy.
- **Everything local:** removing the extension deletes its local storage.
- **Everything in Drive:** go to Google Drive → Settings → Manage apps →
  Nécessaire → Delete hidden app data. Because the application folder is
  hidden, this is the only way to remove it, and it cannot be undone.

## Children

Nécessaire is not directed at children and collects no personal information
from anyone.

## Changes

If this policy changes, the updated version will be published here with a new
date. Material changes will be noted in the extension's release notes.

## Contact

Questions or concerns: open an issue at
<https://github.com/caroljardims/content-saver/issues>.
