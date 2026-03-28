// ============================================================
// extension/content.js — DOM product title extractor
// ============================================================
// This is a "content script" — Chrome injects it into every
// matching e-commerce page automatically (based on the `matches`
// list in manifest.json).
//
// Its only job is to find the product title on the current page
// and return it when the popup asks for it.
//
// Communication flow:
//   popup.js sends  → { type: "GET_PRODUCT_TITLE" }
//   content.js replies → { title: "Apple iPhone 13 128GB..." }
//
// Note: popup.js also uses chrome.scripting.executeScript to run
// the same selector logic inline — content.js is the passive
// listener fallback for older message-based calls.

// CSS selectors for the product title element on each supported site.
// Listed from most specific to most generic — we stop at the first match.
const SELECTORS = [
  // Amazon — the main product title element
  '#productTitle',
  '#title span',
  // Flipkart — product name heading
  'span.B_NuCI',
  'h1.yhB1nd span',
  // eBay — item title
  'h1.x-item-title__mainTitle span',
  '#itemTitle',
  // Etsy — listing title
  'h1[data-buy-box-listing-title]',
  'h1.wt-text-body-03',
  // Myntra — product display page title
  'h1.pdp-title',
  // Snapdeal — product display page heading
  'h1.pdp-e-i-head',
  // Generic fallback — works on many sites that use a single <h1>
  'h1',
];

/**
 * extractTitle()
 * Walks through the SELECTORS list and returns the first non-empty
 * text content found. Returns null if nothing matches.
 */
function extractTitle() {
  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.innerText?.trim();
      // Require at least 3 characters to avoid matching empty or single-char elements
      if (text && text.length > 2) return text;
    }
  }
  return null; // no product title found on this page
}

// Listen for messages from popup.js or background.js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_PRODUCT_TITLE') {
    // Call extractTitle and send the result back to whoever asked
    sendResponse({ title: extractTitle() });
  }
});
