// Generic pricing for ANY WCPC-configured product, by calling the live site's
// OWN pricing calculator (the same AJAX endpoint the customer's browser hits
// while configuring an order on the product page) instead of re-implementing
// its logic in Node against the plugin's DB tables.
//
// Why this exists: the plugin (WC Print Configurator) computes price server-side
// via admin-ajax.php?action=wcpc_price, keyed by product_id. That one endpoint
// already knows every product's own rate tables, binding/cover price, print-type
// surcharge, and shipping — verified live on 2026-10-17 to exactly reproduce the
// previously-verified Excel example (A4 + White + 300pg + 50 copies = ₹10,500)
// for product 12982, and to return correctly-scoped data for a sibling product
// (14849, Soft Binding) too. Replicating this product-by-product in Node (the
// original approach) meant re-deriving DB table structure per product, which
// doesn't scale to 27 products — calling the real calculator does.
//
// The endpoint requires a WP nonce (check_ajax_referer('wcpc_front','nonce')).
// A nonce is tied to the WP nonce lifecycle (~12-24h), not a login session, so
// we fetch one from any live WCPC-enabled product page and cache it, retrying
// once with a freshly-fetched nonce if a call reports failure.

const axios = require("axios");

const SITE_URL = process.env.SITE_URL || "https://onlineprintingz.in";
const AJAX_URL = `${SITE_URL}/wp-admin/admin-ajax.php`;
// Any permanently-live WCPC product page works as a nonce source — Perfect
// Binding (12982) is the most stable one we've verified.
const NONCE_SOURCE_PATH = "/product/print-with-perfect-binding/";

let cachedNonce = null;
let cachedNonceAt = 0;
const NONCE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // refetch well before the ~12h WP tick boundary

async function fetchFreshNonce() {
  const { data: html } = await axios.get(`${SITE_URL}${NONCE_SOURCE_PATH}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; OnlinePrintingzBot/1.0)" },
  });
  // The page embeds: var wcpcF={"ajax":"...","nonce":"<hex>","pid":"...",...}
  const match = html.match(/var\s+wcpcF\s*=\s*\{[^}]*"nonce":"([a-f0-9]+)"/);
  if (!match) {
    throw new Error("Could not find WCPC nonce on product page — site markup may have changed.");
  }
  cachedNonce = match[1];
  cachedNonceAt = Date.now();
  return cachedNonce;
}

async function getNonce({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedNonce && Date.now() - cachedNonceAt < NONCE_MAX_AGE_MS) {
    return cachedNonce;
  }
  return fetchFreshNonce();
}

// params: { pid, sizeId, paperId, pages, qty, printId, coverBindingId, bindId,
//           packingId, mode, extra }
// printId defaults to 8 ("Single Side") for page_based products that don't
// ask about it — confirmed live that single vs double doesn't change price
// for the binding-type products, and the bot has never asked customers that.
// Note some product categories reuse "print_id" for a completely different
// choice (large-format products use 59=B&W/61=Color instead of 8=Single/
// 9=Double) — callers pass whichever value is correct for that product.
// `extra` is a plain object of any additional raw POST fields a particular
// product's calculator needs (e.g. sticker's stk_width/stk_height/
// wcpc_stk_shape) that don't fit the common named params above.
async function getLivePrice(params) {
  const callOnce = async (nonce) => {
    const body = new URLSearchParams({
      action: "wcpc_price",
      nonce,
      pid: String(params.pid),
      mode: params.mode || "page_based",
      size_id: String(params.sizeId || 0),
      print_id: String(params.printId || 8),
      paper_id: String(params.paperId || 0),
      pages: String(params.pages || 1),
      qty: String(params.qty || 1),
    });
    if (params.coverBindingId) body.set("cover_binding_id", String(params.coverBindingId));
    if (params.bindId) body.set("bind_id", String(params.bindId));
    if (params.packingId) body.set("packing_id", String(params.packingId));
    if (params.extra) {
      for (const [k, v] of Object.entries(params.extra)) {
        if (v !== undefined && v !== null) body.set(k, String(v));
      }
    }

    const { data } = await axios.post(AJAX_URL, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return data;
  };

  let nonce = await getNonce();
  let result = await callOnce(nonce);

  if (!result || result.success !== true) {
    // Likely an expired/invalid nonce — refresh once and retry.
    nonce = await getNonce({ forceRefresh: true });
    result = await callOnce(nonce);
  }

  if (!result || result.success !== true) {
    const message = (result && result.data) || "Unknown pricing error from site.";
    throw new Error(`Live pricing call failed: ${JSON.stringify(message)}`);
  }

  const d = result.data;
  return {
    pricePerPage: parseFloat(d.base_price),
    pagesCostPerCopy: parseFloat(d.pages_cost),
    bindPrice: parseFloat(d.bind_price || 0),
    bindLabel: d.bind_label || "",
    coverPrice: parseFloat(d.cover_price || 0),
    coverLabel: d.cover_label || "",
    printTypePrice: parseFloat(d.printtype_price || 0),
    printTypeLabel: d.printtype_label || "",
    shippingCost: parseFloat(d.shipping_cost || 0),
    perCopy: parseFloat(d.per_copy),
    // d.total arrives as a formatted currency string ("₹10,500.00") — strip
    // symbol/commas to get a plain number for Razorpay (which needs paise).
    total: parseFloat(String(d.total).replace(/[^\d.]/g, "")),
    weightGrams: parseFloat(String(d.weight).replace(/,/g, "")),
    qty: d.qty,
    raw: d,
  };
}

module.exports = { getLivePrice };
