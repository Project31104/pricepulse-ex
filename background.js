// background.js — service worker; handles API calls + extension-level cache

const API_BASE  = 'http://localhost:5000/api';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SEARCH_PRODUCTS') {
    handleSearch(msg.query).then(sendResponse).catch((err) =>
      sendResponse({ error: err.message })
    );
    return true;
  }

  if (msg.type === 'CLEAR_CACHE') {
    const key = `cache_${msg.query.toLowerCase().trim()}`;
    chrome.storage.local.remove(key);
    // no response needed
  }
});

async function handleSearch(query) {
  const cacheKey = `cache_${query.toLowerCase().trim()}`;

  const stored = await chromeGet(cacheKey);
  if (stored && Date.now() - stored.ts < CACHE_TTL) {
    return { ...stored.data, fromCache: true };
  }

  const url = `${API_BASE}/products/search?q=${encodeURIComponent(query)}`;
  const res  = await fetch(url);
  const json = await res.json();

  if (!res.ok) throw new Error(json.message || `Backend error (${res.status})`);

  const result = {
    products: json.data  || [],
    meta:     json.meta  || {},
    message:  json.message || '',
  };

  await chromeSet(cacheKey, { data: result, ts: Date.now() });
  return result;
}

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
