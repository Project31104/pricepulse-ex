// popup.js

const $ = (id) => document.getElementById(id);

const ui = {
  productBar:  $('product-bar'),
  productName: $('product-name'),
  btnRefresh:  $('btn-refresh'),
  searchInput: $('search-input'),
  btnSearch:   $('btn-search'),
  spinner:     $('state-spinner'),
  error:       $('state-error'),
  errorMsg:    $('error-msg'),
  empty:       $('state-empty'),
  results:     $('results'),
};

let currentQuery = '';

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  const title = await getPageTitle();
  if (title) {
    currentQuery = title;
    ui.productName.textContent = title;
    ui.searchInput.value = title;
    show(ui.productBar);
    await search(title);
  }
})();

// ── Events ────────────────────────────────────────────────────────────────────
ui.btnSearch.addEventListener('click', () => {
  const q = ui.searchInput.value.trim();
  if (q) { currentQuery = q; search(q); }
});
ui.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ui.btnSearch.click();
});
ui.btnRefresh.addEventListener('click', () => {
  if (currentQuery) {
    // Clear extension cache for this query so we get fresh data
    chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', query: currentQuery });
    search(currentQuery);
  }
});

// ── Core ──────────────────────────────────────────────────────────────────────
async function getPageTitle() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const SELECTORS = [
          '#productTitle', '#title span',
          'span.B_NuCI', 'h1.yhB1nd span',
          'h1.x-item-title__mainTitle span', '#itemTitle',
          'h1[data-buy-box-listing-title]', 'h1.wt-text-body-03',
          'h1.pdp-title', 'h1.pdp-e-i-head', 'h1',
        ];
        for (const sel of SELECTORS) {
          const t = document.querySelector(sel)?.innerText?.trim();
          if (t && t.length > 2) return t;
        }
        return null;
      },
    });
    return result || null;
  } catch {
    return null;
  }
}

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

// ── Render ────────────────────────────────────────────────────────────────────
function render({ products, meta, fromCache }) {
  if (!products?.length) { setState('empty'); return; }

  setState('results');

  const minPrice   = Math.min(...products.map((p) => p.price));
  const fetchedAt  = meta?.fetchedAt ? new Date(meta.fetchedAt) : new Date();
  const timeStr    = fetchedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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
            ${p.url
              ? `<a class="card-link" href="${esc(p.url)}" target="_blank">View →</a>`
              : ''}
          </div>
        </div>`;
    }).join('');
}

// ── State helpers ─────────────────────────────────────────────────────────────
function setState(state, msg = '') {
  hide(ui.spinner); hide(ui.error); hide(ui.empty);
  if (state !== 'results') ui.results.innerHTML = '';
  if (state === 'loading')       show(ui.spinner);
  else if (state === 'error')  { ui.errorMsg.textContent = msg; show(ui.error); }
  else if (state === 'empty')    show(ui.empty);
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Format a number as ₹1,23,456 (Indian locale) */
function formatInr(price) {
  if (price == null || isNaN(price)) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    style:    'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(price);
}
