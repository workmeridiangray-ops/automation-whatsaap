require("dotenv").config();
const express = require("express");
const whatsappWebhook = require("./routes/whatsappWebhook");
const razorpayWebhook = require("./routes/razorpayWebhook");

const app = express();

app.get("/", (req, res) => res.send("onlineprintingz WhatsApp ordering bot — running"));

app.use("/webhook/whatsapp", express.json(), whatsappWebhook);
app.use("/webhook/razorpay", express.raw({ type: "application/json" }), razorpayWebhook);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on :${PORT}`));
