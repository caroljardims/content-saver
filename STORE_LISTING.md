# Chrome Web Store listing

Draft copy for the dashboard. Nothing here is code; it exists so the wording is
version-controlled alongside what it describes.

## Name

```
Nécessaire
```

## Summary (132 characters max)

```
Save links, selections and article text to storage you own. Local-first, no account, syncs through your own Google Drive.
```

## Category

Productivity → Workflow & Planning

## Detailed description

```
Nécessaire keeps the things you want to come back to — an article, a
paragraph, a link — without handing them to anyone else.

Everything you save is written to your own browser first, so saving is instant
and works offline. Connect your Google Drive and your captures sync across
browsers through your own account. Don't connect anything, and it works exactly
the same, just on one device.

There is no server behind this extension. No account to create, no database
holding your reading, no analytics. Your captures live on your machine and, if
you choose, in your own Drive.

WHAT IT DOES

• Save a whole page — the readable article text, without the navigation and ads
• Save just the text you selected
• Save a link from the right-click menu
• Read what you saved without leaving the popup
• Copy or share any capture
• Sync across browsers through your own Google Drive

PRIVACY

The extension reads a page only when you ask it to save that page, and only the
tab you are looking at. It does not track browsing, does not run in the
background on sites you visit, and sends nothing to the developer.

If you connect Google Drive, it uses a hidden application folder that only this
extension can see. It has no access to the rest of your Drive.

OPEN SOURCE

https://github.com/caroljardims/content-saver
```

## Permission justifications

The dashboard asks for one per permission. Keep these factual — reviewers check
them against the code.

| Permission | Justification |
|---|---|
| `activeTab` | Reads the content of the tab the user is currently viewing, only when they click Save or use the context menu. This is what lets the extension avoid requesting access to all sites. |
| `scripting` | Injects the article-extraction script into the active tab at the moment the user saves it, rather than declaring a content script that runs everywhere. |
| `storage` | Stores captured items and the user's sync preference locally in the browser. |
| `identity` | Performs the Google OAuth flow so the user can connect their own Google Drive for syncing. Optional; the extension is fully functional without it. |
| `alarms` | Schedules the periodic background sync with the user's Drive. Service workers cannot use timers for this. |
| `contextMenus` | Adds the right-click options for saving a page, a selection, or a link. |
| `https://www.googleapis.com/*` | Calls the Google Drive API to sync the user's saved items to their own Drive account, and oauth2.googleapis.com to revoke the token on disconnect. No other hosts are contacted. |
| Remote code | **None.** All JavaScript is bundled in the package. No remotely hosted code is loaded, injected or executed; no `eval`, no `new Function`. Verified against the build: every script tag is package-local and the only network endpoints are googleapis.com, oauth2.googleapis.com and accounts.google.com. |

## Single purpose statement

```
Nécessaire saves web content — links, text selections and article text — for
later reading, and optionally syncs it to the user's own Google Drive.
```

## Data usage disclosures

- **Does it collect personally identifiable information?** No
- **Health information?** No
- **Financial information?** No
- **Authentication information?** No — an OAuth token for the user's own Drive
  is held locally on the device; it is never transmitted to the developer.
- **Personal communications?** No
- **Location?** No
- **Web history?** No — only the specific pages the user chooses to save.
- **User activity?** No
- **Website content?** Yes — the text of pages the user explicitly saves,
  stored locally and optionally in the user's own Google Drive.

Certify all three: not sold to third parties, not used for unrelated purposes,
not used to determine creditworthiness.

## OAuth status

`drive.appdata` is classified **non-sensitive** by Google, confirmed in Cloud
Console under Data Access. Publishing therefore requires no OAuth verification
and the consent screen can be set to In production directly.

## Assets still needed

- [ ] At least one screenshot, 1280×800 or 640×400
- [x] Privacy policy and terms at public URLs — published at
      <https://caroljardims.com.br/content-saver/privacy> and
      <https://caroljardims.com.br/content-saver/terms>. The landing page lives at
      <https://caroljardims.com.br/content-saver>. Paste the privacy URL into the
      dashboard.
- [ ] Promotional tile 440×280 (optional)
