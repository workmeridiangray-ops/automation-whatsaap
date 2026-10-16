// Thrown by a manual-quote-eligible product's computeQuote when its live
// WooCommerce price is still exactly the placeholder value recorded in
// productFlows.js's BASELINE_PRICES — i.e. nobody has set a real price yet.
// engine.js catches this specifically (distinct from a genuine pricing
// error) and routes to the manual-quote order path instead of failing.
class ManualQuoteNeededError extends Error {}

module.exports = { ManualQuoteNeededError };
