// extension/services/priceHistoryStorage.js
// Loaded as a plain <script> tag — no ES module syntax.
// Exposes window.priceHistoryStorage as a global for popup.js to use.

class PriceHistoryStorage {
  constructor() {
    this.dbName  = 'PriceHistoryDB';
    this.version = 1;
  }

  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror        = () => reject(request.error);
      request.onsuccess      = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'productId' });
        }
      };
    });
  }

  async saveProductHistory(productId, title, price) {
    const db          = await this.openDB();
    const transaction = db.transaction(['products'], 'readwrite');
    const store       = transaction.objectStore('products');

    const existing = await new Promise((resolve) => {
      const req = store.get(productId);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(undefined);
    });

    const now      = Date.now();
    const newEntry = { price, timestamp: now };

    if (existing) {
      const lastEntry   = existing.prices[existing.prices.length - 1];
      const timeDiff    = now - lastEntry.timestamp;
      const priceChanged = lastEntry.price !== price;
      const intervalMs  = 6 * 60 * 60 * 1000; // record at most once per 6 hours unless price changed

      if (priceChanged || timeDiff >= intervalMs) {
        existing.prices.push(newEntry);
        store.put(existing);
      }
    } else {
      store.add({ productId, title, prices: [newEntry] });
    }

    // Wait for transaction to complete before closing
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror    = () => reject(transaction.error);
    });

    db.close();
  }

  async getProductHistory(productId) {
    const db          = await this.openDB();
    const transaction = db.transaction(['products'], 'readonly');
    const store       = transaction.objectStore('products');

    return new Promise((resolve) => {
      const req = store.get(productId);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror   = () => { db.close(); resolve(null); };
    });
  }
}

// Expose as a global so popup.js can access it without ES module imports
window.priceHistoryStorage = new PriceHistoryStorage();
