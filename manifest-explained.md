# manifest.json — Field Reference

Chrome extensions are configured by `manifest.json`. Here is what every field in this project's manifest does:

## Top-level fields

| Field | Value | Purpose |
|---|---|---|
| `manifest_version` | `3` | Must be 3 for all new extensions. MV3 uses service workers instead of persistent background pages. |
| `name` | `"PricePulse - Price Comparator"` | Shown in the Chrome extensions page and Web Store. |
| `version` | `"1.0.0"` | Extension version number. Must be incremented when publishing an update. |
| `description` | `"..."` | Short description shown in the Chrome Web Store. |

## icons
Three sizes of the extension icon:
- `16px` — shown in the browser toolbar (small)
- `48px` — shown on the `chrome://extensions` page
- `128px` — shown in the Chrome Web Store

## action
```json
"action": {
  "default_popup": "popup.html",
  "default_title": "PricePulse"
}
```
Defines what happens when the user clicks the extension icon:
- `default_popup` — opens `popup.html` in a small window
- `default_title` — tooltip text shown on hover

## background
```json
"background": { "service_worker": "background.js" }
```
Registers `background.js` as the MV3 service worker. It runs in the background, handles API calls, and manages the cache. Chrome can stop and restart it at any time.

## content_scripts
```json
"content_scripts": [{
  "matches": ["*://*.amazon.in/*", ...],
  "js": ["content.js"],
  "run_at": "document_idle"
}]
```
- `matches` — which URLs to inject the script into (all major Indian e-commerce sites)
- `js` — the script file to inject (`content.js`)
- `run_at: "document_idle"` — wait until the page has fully loaded before injecting

## permissions
```json
"permissions": ["activeTab", "scripting", "storage"]
```
| Permission | Why it's needed |
|---|---|
| `activeTab` | Read the URL and title of the currently active tab |
| `scripting` | Use `chrome.scripting.executeScript` to inject code into the tab and read the product title from the DOM |
| `storage` | Use `chrome.storage.local` to cache search results for 10 minutes |

## host_permissions
```json
"host_permissions": ["*://*.amazon.in/*", ..., "http://localhost:5000/*"]
```
Grants the extension permission to make `fetch()` requests to these domains.
- The e-commerce domains allow the content script to run on those pages
- `http://localhost:5000/*` allows `background.js` to call the local backend API
