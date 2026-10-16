const express = require("express");
const router = express.Router();
const { verifyWebhookSignature } = require("../services/razorpay");
const { completeOrderAfterPayment } = require("../flows/engine");

// Mounted with express.raw() in server.js so we can verify the HMAC signature
// against the exact raw bytes Razorpay signed.
router.post("/", async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const valid = verifyWebhookSignature(req.body, signature);
  if (!valid) return res.sendStatus(400);

  res.sendStatus(200); // ack immediately

  try {
    const payload = JSON.parse(req.body.toString());
    if (payload.event === "payment_link.paid") {
      const link = payload.payload.payment_link.entity;
      const phone = link.reference_id.split("-")[0]; // we set reference_id = `${phone}-${Date.now()}`
      await completeOrderAfterPayment(phone);
    }
  } catch (err) {
    console.error("Razorpay webhook error:", err);
  }
});

module.exports = router;
