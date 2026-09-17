# Content Saver

A browser extension that saves links, text selections and article content to storage **you** own. No server, no database, no hosting bill.

- **Local-first.** Every capture is written to IndexedDB immediately. Cloud storage is a sync target, never a dependency — saving works offline, signed out, or with an expired token.
- **Bring your own backend.** Google Drive's hidden `appDataFolder` today; OneDrive, Dropbox, GitHub and WebDAV are one file each behind the same `SyncAdapter` interface.
- **Minimal permissions.** No host permissions beyond the Google API endpoints. The content script is injected on demand under `activeTab`, so the install prompt does not say "read all your data on all websites".

## Status

| | |
|---|---|
| Chrome MV3 build | ✅ |
| Firefox MV3 build | ✅ |
| Merge/conflict logic | ✅ 12 tests passing |
| Google Drive adapter | ✅ verified against the live API |
| Cross-device restore | ✅ verified — second browser, captures restored |
| OneDrive / Dropbox / GitHub / WebDAV | ⬜ stubs in `src/adapters/registry.ts` |

Upload and download both work against real Drive, and a fresh install in a
second browser pulls the full history back down. What has *not* been
exercised: concurrent edits on two devices at once (the merge logic is
covered by tests, but never by two live clients), tombstone propagation
across devices, and anything past the first 200 captures (the pull paginates,
but has only ever seen one page).

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` opens a Chrome instance with the extension loaded. For Firefox, `npm run dev:firefox`.

Without OAuth configured, the extension runs on the `none` adapter: everything saves locally and the popup shows "This device only". That path is fully functional and needs no setup at all.

```bash
npm test
npm run compile
npm run build
```

## How it works

```
capture ──▶ IndexedDB (done — the UI updates here) ──▶ outbox
                                                          │
  alarm (5 min) / manual / on-connect ───────────────────▶ │
      pull(cursor) ─▶ merge into local ─▶ push(dirty) ─▶ advance cursor
```

**One capture is one remote file.** No shared mutable blob, so there is no global merge problem — only per-item merges, and those are rare because most fields never change after capture.

**Conflicts resolve on a Lamport counter, not a timestamp.** Browser clocks drift and users change them; timestamp-based last-write-wins silently drops the newer edit whenever two devices disagree by more than the sync interval. See `src/core/clock.ts`.

**Merges are field-aware** (`src/core/merge.ts`):

| Field | Rule | Why |
|---|---|---|
| `tags` | set union | Losing a tag because the other device saved later is the most annoying possible bug |
| `notes` | LWW, loser appended | Never silently discard user prose |
| `deletedAt` | delete always wins | A stale tag edit should not resurrect something you deleted |
| `title`, `archived` | LWW by rev | Cheap, low-stakes |

The merge is commutative and idempotent, so both devices converge on the same record regardless of who syncs first. That property is covered by tests.

**`index.json` is a cache, never the source of truth.** It exists so a fresh device paints a list quickly; if it is missing or corrupt, it rebuilds from the item files.

## Layout

```
src/
  core/        db (IndexedDB), model, clock, merge, engine
  adapters/    SyncAdapter interface + one file per backend
  auth/        token.ts — the only place that knows Chrome and Firefox differ
  entrypoints/ background, content (runtime-registered), popup
tests/         merge and model logic
```

To add a backend, write one file implementing `SyncAdapter` and register it in `src/adapters/registry.ts`. Nothing else changes.

## Google Cloud Console setup

Needed only for Drive sync. Skip it entirely if you just want local saves.

1. **Create a project.** console.cloud.google.com → project dropdown → New Project.

2. **Enable the Drive API.** *APIs & Services → Library* → "Google Drive API" → Enable. Nothing works until this is on.

3. **Configure the OAuth consent screen.** *APIs & Services → OAuth consent screen*:
   - User type **External**; publishing status stays **Testing**.
   - Add your own Google account under *Test users*. Only listed test users can authorize an unverified app, capped at 100.

4. **Add the scope.** On the Scopes step, manually add `https://www.googleapis.com/auth/drive.appdata`.

   > **Check the warning Google shows here.** If `drive.appdata` is flagged as a sensitive scope, public listing requires OAuth verification (app review, privacy policy, homepage). `https://www.googleapis.com/auth/drive.file` with a visible folder is non-sensitive and skips review entirely — worth reconsidering before you commit to the hidden folder.

5. **Pin the extension ID.** The OAuth client is bound to one extension ID, and an unpacked extension's ID changes with its folder path. Click *Pack extension* at `chrome://extensions` once to get a `.pem`, derive the base64 public key from it, and set `WXT_EXTENSION_KEY` in `.env`.

6. **Create the Chrome client.** *Credentials → Create Credentials → OAuth client ID* → type **Chrome Extension** → paste the extension ID. Put the client ID in `.env` as `WXT_GOOGLE_CLIENT_ID`.

7. **Create the Firefox/Edge client.** A second client, type **Web application**, authorized redirect URI `https://<extension-id>.chromiumapp.org/`. Put it in `.env` as `WXT_GOOGLE_WEB_CLIENT_ID`.

8. **Reload and test.** The first interactive auth shows an "unverified app" warning — expected in Testing mode; continue via *Advanced*.

Copy `.env.example` to `.env` and fill in what you created.

## Known constraints

These are properties of the platforms, not bugs to fix:

- **`chrome.identity.getAuthToken` is Chrome-only.** Firefox and Edge use `launchWebAuthFlow` with the **implicit grant**, because a Google "Web application" client requires a client secret at token exchange and no extension can ship a secret. That means access tokens only: ~1 hour, no refresh token, silent re-auth when they lapse.
- **Drive API v3 has no ETags** (v2 did), so there is no `If-Match` conditional write. The field-aware merge is what covers concurrent edits instead; worst case, a simultaneous title edit on two devices keeps one of them.
- **Testing-mode refresh tokens expire after 7 days.** Does not affect the Chrome path. Moving the consent screen to *In production* removes it.
- **`appDataFolder` data is invisible to the user.** They cannot inspect, back up, or migrate it, and "Disconnect app" in Drive settings deletes it without warning.
- **The account email needs a permission we do not request.** The popup shows "Google account" rather than an address; showing the real one means adding `identity.email`.
- **Safari is not free.** $99/year Apple Developer account plus an Xcode wrapper. Chrome Web Store is a one-time $5; Firefox AMO and Edge Add-ons are free.

## Next steps

1. Verify concurrent edits: same capture edited on two devices before either syncs.
2. Add the OneDrive adapter — MSAL PKCE is genuinely cleaner than Google's extension flow.
3. Export/import JSON as an escape hatch, independent of any backend.
4. Full-page list UI with search and tag filtering; the popup is deliberately minimal.
5. Optional passphrase encryption (WebCrypto AES-GCM over `content` and `notes`) behind a toggle.
