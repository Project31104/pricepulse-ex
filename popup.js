// extension/popup.js
// Loaded as a plain <script> tag after:
//   chart.js, priceHistoryStorage.js, priceTracker.js
// All three expose globals: Chart, window.priceHistoryStorage,
// window.trackProductPrice, window.generateProductId

const $ = (id) => document.getElementById(id);

const ui = {
  productBar:   $('product-bar'),
  productName:  $('product-name'),
  btnRefresh:   $('btn-refresh'),
  searchInput:  $('search-input'),
  btnSearch:    $('btn-search'),
  spinner:      $('state-spinner'),
  error:        $('state-error'),
  errorMsg:     $('error-msg'),
  empty:        $('state-empty'),
  results:      $('results'),
  priceHistory: $('price-history'),
  priceChart:   $('price-chart'),
  priceStats:   $('price-stats'),
};

let currentQuery     = '';
let currentProductId = null;
let chart            = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  const { title, url } = await getPageInfo();
  if (title) {
    currentQuery     = title;
    currentProductId = window.generateProductId(url, title);
    ui.productName.textContent = title;
    ui.searchInput.value       = title;
    show(ui.productBar);
    await search(title);
  }
})();

// ── Events ────────────────────────────────────────────────────────────────────
ui.btnSearch.addEventListener('click', () => {
  const q = ui.searchInput.value.trim();
  if (!q) return;
  currentQuery     = q;
  // For manual searches there is no product URL, so generate ID from the query text
  currentProductId = window.generateProductId(null, q);
  search(q);
});

ui.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ui.btnSearch.click();
});

ui.btnRefresh.addEventListener('click', () => {
  if (currentQuery) {
    chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', query: currentQuery });
    search(currentQuery);
  }
});

// ── getPageInfo ───────────────────────────────────────────────────────────────
async function getPageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { title: null, url: null };

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const SELECTORS = [
          '#productTitle', '#title span',
          'span.B_NuCI', 'h1.yhB1nd span',
          'h1.x-item-title__mainTitle span', '#itemTitle',
          'h1[data-buy-box-listing-title]', 'h1.wt-text-body-03',
          'h1.pdp-title', 'h1.pdp-e-i-head',
          'h1',
        ];
        for (const sel of SELECTORS) {
          const t = document.querySelector(sel)?.innerText?.trim();
          if (t && t.length > 2) return t;
        }
        return null;
      },
    });
    return { title: result || null, url: tab.url };
  } catch {
    return { title: null, url: null };
  }
}

// ── search ────────────────────────────────────────────────────────────────────
async function search(query) {
  setState('loading');
  try {
    const data = await chrome.runtime.sendMessage({ type: 'SEARCH_PRODUCTS', query });
    if (data?.error) throw new Error(data.error);
    render(data);
  } catch (err) {
    setState('error', err.message || 'Could not reach the backend. Is it running on port 5000?');
  }
}

// ── render ────────────────────────────────────────────────────────────────────
function render({ products, meta, fromCache }) {
  if (!products?.length) { setState('empty'); return; }

  setState('results');

  const minPrice  = Math.min(...products.map((p) => p.price));
  const fetchedAt = meta?.fetchedAt ? new Date(meta.fetchedAt) : new Date();
  const timeStr   = fetchedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const partialMsg = meta?.partialErrors?.length
    ? `<p class="partial-warn">⚠ Partial results — ${meta.partialErrors.join('; ')}</p>`
    : '';

  ui.results.innerHTML =
    `<div class="results-meta">
       ${fromCache
         ? '<span class="badge badge-cache">⚡ Cached</span>'
         : '<span class="badge badge-live">🟢 Live</span>'}
       <span class="updated-at">Updated ${timeStr}</span>
     </div>
     ${partialMsg}` +
    products.map((p) => {
      const isCheapest = p.price === minPrice;
      const stars = p.rating
        ? `${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))} ${p.rating}`
        : '';
      return `
        <div class="card ${isCheapest ? 'cheapest' : ''}">
          <div class="card-body">
            <div class="card-top">
              <span class="card-platform">${esc(p.platform)}</span>
              ${isCheapest ? '<span class="card-badge">BEST PRICE</span>' : ''}
            </div>
            <div class="card-title">${esc(p.name || p.title || '')}</div>
            ${stars ? `<div class="card-rating">${stars}</div>` : ''}
          </div>
          <div class="card-right">
            <div class="card-price">${formatInr(p.price)}</div>
            ${p.url ? `<a class="card-link" href="${esc(p.url)}" target="_blank">View →</a>` : ''}
          </div>
        </div>`;
    }).join('');

  // Track the cheapest price seen and attempt to show history chart
  if (currentProductId && currentQuery) {
    // 1. Save to local IndexedDB (works offline)
    window.trackProductPrice({
      productId:    currentProductId,
      title:        currentQuery,
      currentPrice: minPrice,
    });
    // 2. Persist to backend DB (cross-device, long-term storage)
    chrome.runtime.sendMessage({
      type:      'RECORD_PRICE_SNAPSHOT',
      productId: currentProductId,
      title:     currentQuery,
      price:     minPrice,
    });
    showPriceHistory(currentProductId);
  }
}

// ── showPriceHistory ──────────────────────────────────────────────────────────
// Data flow:
//   1. Ask background.js for backend history (GET /api/products/price-history)
//   2. Also read local IndexedDB history (works offline)
//   3. Merge both sources, de-duplicate by date string, sort chronologically
//   4. Render Chart.js line chart + lowest / highest / avg stats
async function showPriceHistory(productId) {
  try {
    // Fetch from both sources in parallel
    const [backendResult, localHistory] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_PRICE_HISTORY', productId }),
      window.priceHistoryStorage.getProductHistory(productId),
    ]);

    // Normalise backend snapshots → { dateKey, price }
    const backendPoints = (backendResult?.data ?? []).map((s) => ({
      dateKey: s.date,          // already "YYYY-MM-DD"
      price:   s.price,
    }));

    // Normalise local IndexedDB snapshots → { dateKey, price }
    const localPoints = (localHistory?.prices ?? []).map((p) => ({
      dateKey: new Date(p.timestamp).toISOString().split('T')[0],
      price:   p.price,
    }));

    // Merge: use a Map keyed by date so each calendar day appears once.
    // Backend entries overwrite local ones for the same day.
    const byDate = new Map();
    [...localPoints, ...backendPoints].forEach(({ dateKey, price }) => {
      byDate.set(dateKey, price);
    });

    // Sort chronologically (ISO date strings sort lexicographically)
    const merged = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

    if (merged.length < 2) { hide(ui.priceHistory); return; }

    show(ui.priceHistory);

    // Destroy previous Chart instance to avoid "Canvas already in use" error
    if (chart) { chart.destroy(); chart = null; }

    const labels = merged.map(([date]) =>
      new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    );
    const data = merged.map(([, price]) => price);

    chart = new Chart(ui.priceChart.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label:                'Price (₹)',
          data,
          borderColor:          '#6366f1',
          backgroundColor:      'rgba(99,102,241,0.08)',
          tension:              0.3,
          pointRadius:          4,
          pointBackgroundColor: '#6366f1',
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${formatInr(ctx.parsed.y)}` } },
        },
        scales: {
          y: {
            beginAtZero: false,
            ticks: { callback: (val) => formatInr(val), font: { size: 10 } },
          },
          x: { ticks: { font: { size: 10 } } },
        },
      },
    });

    // Stats: prefer backend-computed values, fall back to local calculation
    const minPrice = backendResult?.stats?.min ?? Math.min(...data);
    const maxPrice = backendResult?.stats?.max ?? Math.max(...data);
    const avgPrice = backendResult?.stats?.avg ?? Math.round(data.reduce((a, b) => a + b, 0) / data.length);
    const current  = backendResult?.stats?.current ?? data[data.length - 1];
    const goodDeal = current <= avgPrice;

    ui.priceStats.innerHTML = `
      <p><strong>Lowest:</strong>  ${formatInr(minPrice)}</p>
      <p><strong>Highest:</strong> ${formatInr(maxPrice)}</p>
      <p><strong>Avg:</strong>     ${formatInr(avgPrice)}
        ${goodDeal ? '<span style="color:#16a34a;font-weight:700"> ✓ Good deal</span>' : ''}
      </p>
    `;
  } catch (err) {
    console.error('Failed to show price history:', err);
    hide(ui.priceHistory);
  }
}

// ── setState ──────────────────────────────────────────────────────────────────
function setState(state, msg = '') {
  hide(ui.spinner);
  hide(ui.error);
  hide(ui.empty);
  hide(ui.priceHistory);
  if (state !== 'results') ui.results.innerHTML = '';
  if      (state === 'loading') show(ui.spinner);
  else if (state === 'error')  { ui.errorMsg.textContent = msg; show(ui.error); }
  else if (state === 'empty')    show(ui.empty);
}

function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatInr(price) {
  if (price == null || isNaN(price)) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(price);
}
