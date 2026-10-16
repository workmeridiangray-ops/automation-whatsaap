const Razorpay = require("razorpay");
const crypto = require("crypto");

const rzp = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// amount in rupees -> Razorpay expects paise
async function createPaymentLink({ amountRupees, description, phone, referenceId }) {
  const link = await rzp.paymentLink.create({
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
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return expected === signatureHeader;
}

module.exports = { createPaymentLink, verifyWebhookSignature };
