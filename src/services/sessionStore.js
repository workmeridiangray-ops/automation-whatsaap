// In-memory session store keyed by customer phone number.
// Swap for Redis/a DB table if you need it to survive restarts or scale across instances.

const sessions = new Map();

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      phone,
      step: "idle", // idle -> product_selected -> asking:<field> -> awaiting_file -> quoted -> awaiting_payment -> done
      productId: null,
      productKey: null, // key into flows/productFlows.js
      answers: {},
      fileMediaId: null,
      wpAttachmentId: null,
      quote: null,
      razorpayLinkId: null,
      updatedAt: Date.now(),
    });
  }
  return sessions.get(phone);
}

function resetSession(phone) {
  sessions.delete(phone);
}

function saveSession(phone, patch) {
  const s = getSession(phone);
  Object.assign(s, patch, { updatedAt: Date.now() });
  sessions.set(phone, s);
  return s;
}

module.exports = { getSession, resetSession, saveSession };
