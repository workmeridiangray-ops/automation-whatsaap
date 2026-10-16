const Razorpay = require("razorpay");
const crypto = require("crypto");

// Lazy-init: the Razorpay SDK throws immediately at construction time if
// key_id/key_secret are missing. Building it eagerly at module load would
// crash the whole server on boot before Razorpay keys are even configured —
// confirmed live on Render (first deploy failed with exactly this). Build it
// on first use instead, so the rest of the bot (menu, questions, pricing,
// order creation) works fine even before Razorpay is wired up.
let rzp;
function client() {
  if (!rzp) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error(
        "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — add them to create real payment links."
      );
    }
    rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return rzp;
}

// amount in rupees -> Razorpay expects paise
async function createPaymentLink({ amountRupees, description, phone, referenceId }) {
  const link = await client().paymentLink.create({
    amount: Math.round(amountRupees * 100),
    currency: "INR",
    description,
    customer: { contact: phone },
    notify: { sms: true, whatsapp: false }, // we send the link ourselves via WhatsApp
    reference_id: referenceId,
    callback_url: `${process.env.WC_BASE_URL}/`,
    callback_method: "get",
  });
  return link; // includes id, short_url
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET not set.");
  }
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return expected === signatureHeader;
}

module.exports = { createPaymentLink, verifyWebhookSignature };
