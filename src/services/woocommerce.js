const axios = require("axios");

// Verified live (2026-10-16): the WP Application Password authenticates against
// both /wp/v2 and /wc/v3 via Basic Auth, since the admin user it belongs to has
// manage_woocommerce capability. Falls back to dedicated WC_CONSUMER_KEY/SECRET
// if you'd rather use separate REST API keys (WooCommerce > Settings > Advanced
// > REST API) — set those instead and this picks them up automatically.
function wcClient() {
  return axios.create({
    baseURL: `${process.env.WC_BASE_URL}/wp-json/wc/v3`,
    auth: {
      username: process.env.WC_CONSUMER_KEY || process.env.WP_APPLICATION_USERNAME,
      password: process.env.WC_CONSUMER_SECRET || process.env.WP_APPLICATION_PASSWORD,
    },
  });
}

function wpClient() {
  return axios.create({
    baseURL: `${process.env.WP_BASE_URL}/wp-json/wp/v2`,
    auth: {
      username: process.env.WP_APPLICATION_USERNAME,
      password: process.env.WP_APPLICATION_PASSWORD,
    },
  });
}

// Uploads a buffer (the customer's print file) to the WP media library.
async function uploadMedia(buffer, filename, mimeType) {
  const res = await wpClient().post("/media", buffer, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": mimeType,
    },
  });
  return res.data; // includes id, source_url
}

// Creates a real WooCommerce order, with the customer's file + order spec
// recorded as order notes (visible in wp-admin) and the WP attachment linked.
async function createOrder({ phone, productId, lineItemName, total, meta, wpAttachmentId }) {
  const res = await wcClient().post("/orders", {
    status: "pending", // flips to "processing" by the Razorpay-paid webhook
    billing: {
      first_name: "WhatsApp Customer",
      phone,
    },
    line_items: [
      {
        name: lineItemName,
        product_id: productId,
        quantity: 1,
        total: String(total),
        subtotal: String(total),
      },
    ],
    meta_data: [
      { key: "_whatsapp_order", value: "yes" },
      { key: "_whatsapp_customer_phone", value: phone },
      { key: "_order_spec", value: JSON.stringify(meta) },
      ...(wpAttachmentId ? [{ key: "_uploaded_file_id", value: wpAttachmentId }] : []),
    ],
  });
  return res.data; // includes id, order_key
}

async function setOrderProcessing(orderId) {
  return wcClient().put(`/orders/${orderId}`, { status: "processing" });
}

// Fetches a product's live price straight from WooCommerce rather than
// hardcoding it in the bot — so a price change on the site is picked up
// automatically. Used for the "simple" (non-configurator) products, where
// the listed price IS the per-unit/per-pack price and the configurator is
// switched off (_wcpc_enabled = 0 or absent).
async function getProductPrice(productId) {
  const res = await wcClient().get(`/products/${productId}`);
  const price = parseFloat(res.data.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Product ${productId} has no valid live price (got "${res.data.price}").`);
  }
  return price;
}

module.exports = { uploadMedia, createOrder, setOrderProcessing, getProductPrice };
