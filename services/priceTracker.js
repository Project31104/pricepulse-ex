// extension/services/priceTracker.js
// Loaded as a plain <script> tag — no ES module syntax.
// Exposes window.trackProductPrice and window.generateProductId as globals.

/**
 * trackProductPrice({ productId, title, currentPrice })
 * Saves the current price to IndexedDB history if conditions are met
 * (price changed or 6+ hours since last record).
 */
async function trackProductPrice({ productId, title, currentPrice }) {
  try {
    await window.priceHistoryStorage.saveProductHistory(productId, title, currentPrice);
  } catch (error) {
    console.error('Failed to track product price:', error);
  }
}

/**
 * generateProductId(url, title)
 * Creates a stable short ID from a product URL or title.
 * Used as the IndexedDB key for a product's history record.
 */
function generateProductId(url, title) {
  const source = url || title || 'unknown';
  return btoa(unescape(encodeURIComponent(source)))
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 32);
}

window.trackProductPrice  = trackProductPrice;
window.generateProductId  = generateProductId;
