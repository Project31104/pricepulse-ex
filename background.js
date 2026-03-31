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

const API_BASE  = 'https://pricepulse-be.onrender.com/api';
const CACHE_TTL = 10 * 60 * 1000;
const RETRY_DELAY_MS = 8000; // Render cold-start can take ~7-10s

// ── Message listener ──────────────────────────────────────────────────────────
// chrome.runtime.onMessage fires whenever popup.js calls
// chrome.runtime.sendMessage({ type: "...", ... })
// Returns true for async handlers to keep the message channel open.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'SEARCH_PRODUCTS') {
    handleSearch(msg.query)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === 'CLEAR_CACHE') {
    const key = `cache_${msg.query.toLowerCase().trim()}`;
    chrome.storage.local.remove(key);
    // No async response needed
    return false;
  }

  // ── Price history ─────────────────────────────────────────────────────────
  // The service worker proxies these to the backend so the popup doesn't
  // need to make direct localhost fetch calls (avoids CORS issues).

  if (msg.type === 'GET_PRICE_HISTORY') {
    // GET /api/products/price-history?productId=...
    // Returns { data: [{date, price}], stats: {min, max, avg, current} }
    fetchPriceHistory(msg.productId)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async — keep channel open
  }

  if (msg.type === 'RECORD_PRICE_SNAPSHOT') {
    // POST /api/products/price-history — fire-and-forget, no response needed
    recordPriceSnapshot(msg.productId, msg.title, msg.price).catch(() => {});
    return false;
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

  // Cache miss — call the backend search API (retry once for Render cold start)
  const url = `${API_BASE}/products/search?q=${encodeURIComponent(query)}`;
  console.log('[PricePulse] Fetching:', url);
  let res;
  try {
    res = await fetch(url);
  } catch (networkErr) {
    console.warn('[PricePulse] First attempt failed, retrying after cold-start delay…', networkErr.message);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    res = await fetch(url);
  }
  console.log('[PricePulse] Response status:', res.status);
  const json = await res.json();
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

// ── fetchPriceHistory ──────────────────────────────────────────────────────────────
/**
 * Calls GET /api/products/price-history?productId=<id>
 * Returns the backend envelope's data field:
 *   { data: [{date, price}], stats: {min, max, avg, current} }
 * On network failure returns { data: [], stats: null } so the popup
 * degrades gracefully to the local IndexedDB history.
 */
async function fetchPriceHistory(productId) {
  try {
    const res  = await fetch(`${API_BASE}/products/price-history?productId=${encodeURIComponent(productId)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `Backend error (${res.status})`);
    return json.data ?? { data: [], stats: null };
  } catch (err) {
    console.warn('[PricePulse] fetchPriceHistory failed:', err.message);
    return { data: [], stats: null };
  }
}

// ── recordPriceSnapshot ──────────────────────────────────────────────────────────
/**
 * Calls POST /api/products/price-history to persist a price snapshot.
 * Fire-and-forget — errors are silently swallowed so a backend outage
 * never breaks the popup's main search flow.
 */
async function recordPriceSnapshot(productId, title, price) {
  const res = await fetch(`${API_BASE}/products/price-history`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ productId, title, price }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || `Backend error (${res.status})`);
  }
} 
