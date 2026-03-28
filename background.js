// ============================================================
// extension/background.js — Service worker (background script)
// ============================================================
// In Manifest V3, the background script runs as a "service worker"
// — it has no DOM access and can be stopped/restarted by Chrome
// at any time to save memory.
//
// Its two responsibilities:
//   1. Make HTTP requests to the backend on behalf of popup.js
//      (popup.js can't call localhost directly due to CORS restrictions
//       in some Chrome versions — the service worker bypasses this)
//   2. Cache search results in chrome.storage.local to avoid
//      redundant API calls for the same query within 10 minutes
//
// Message types handled:
//   SEARCH_PRODUCTS — fetch prices for a query (with caching)
//   CLEAR_CACHE     — delete the cached result for a query
//                     (triggered by the ↻ refresh button in popup.js)

const API_BASE  = 'http://localhost:5000/api'; // backend URL
const CACHE_TTL = 10 * 60 * 1000;             // cache results for 10 minutes

// ── Message listener ──────────────────────────────────────────────────────────
// chrome.runtime.onMessage fires whenever popup.js calls
// chrome.runtime.sendMessage({ type: "...", ... })
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'SEARCH_PRODUCTS') {
    // Start the async search and pipe the result back to popup.js.
    // We must return `true` to tell Chrome we'll call sendResponse asynchronously.
    handleSearch(msg.query)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keeps the message channel open for the async response
  }

  if (msg.type === 'CLEAR_CACHE') {
    // Remove the cached entry for this query so the next search hits the backend
    const key = `cache_${msg.query.toLowerCase().trim()}`;
    chrome.storage.local.remove(key);
    // No response needed — popup.js doesn't await this message
  }
});

// ── handleSearch ──────────────────────────────────────────────────────────────
/**
 * Checks the local cache first. If the cache is fresh (< 10 min old),
 * returns the cached data immediately. Otherwise fetches from the backend,
 * stores the result in cache, and returns it.
 *
 * @param {string} query — product name to search for
 * @returns {{ products, meta, message, fromCache? }}
 */
async function handleSearch(query) {
  const cacheKey = `cache_${query.toLowerCase().trim()}`;

  // Check chrome.storage.local for a cached result
  const stored = await chromeGet(cacheKey);
  if (stored && Date.now() - stored.ts < CACHE_TTL) {
    // Cache hit — return immediately with a flag so the popup can show "⚡ Cached"
    return { ...stored.data, fromCache: true };
  }

  // Cache miss — call the backend search API
  const url = `${API_BASE}/products/search?q=${encodeURIComponent(query)}`;
  const res  = await fetch(url);
  const json = await res.json();

  // If the backend returned an error status, throw so the catch in the listener
  // sends { error: "..." } back to popup.js
  if (!res.ok) throw new Error(json.message || `Backend error (${res.status})`);

  // Normalise the backend envelope into the shape popup.js expects
  const result = {
    products: json.data    || [],
    meta:     json.meta    || {},
    message:  json.message || '',
  };

  // Store in cache with the current timestamp
  await chromeSet(cacheKey, { data: result, ts: Date.now() });
  return result;
}

// ── chrome.storage helpers ────────────────────────────────────────────────────
// chrome.storage.local uses callbacks, not Promises. These wrappers
// convert them to Promises so we can use async/await cleanly.

function chromeGet(key) {
  return new Promise((resolve) =>
    chrome.storage.local.get(key, (r) => resolve(r[key] ?? null))
  );
}

function chromeSet(key, value) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ [key]: value }, resolve)
  );
}
