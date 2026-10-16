const express = require("express");
const router = express.Router();
const { getSession, saveSession } = require("../services/sessionStore");
const { sendList, sendText } = require("../services/whatsapp");
const { startFlow, handleFlowReply, handleFileUpload } = require("../flows/engine");

// Meta webhook verification (GET)
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Incoming messages (POST)
router.post("/", async (req, res) => {
  res.sendStatus(200); // ack immediately; Meta retries on timeout

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message) return; // delivery receipts etc. — ignore

    const phone = message.from;
    const session = getSession(phone);

    if (message.type === "text") {
      const text = message.text.body.trim();
      await routeTextOrCommand(phone, session, text);
    } else if (message.type === "interactive") {
      const reply =
        message.interactive.button_reply?.id || message.interactive.list_reply?.id;
      await routeTextOrCommand(phone, session, reply);
    } else if (message.type === "document" || message.type === "image") {
      const mediaId = message.document?.id || message.image?.id;
      if (session.step === "awaiting_file") {
        await handleFileUpload(phone, session, mediaId);
      } else {
        await sendText(phone, "I wasn't expecting a file right now — type \"menu\" to start an order.");
      }
    }
  } catch (err) {
    console.error("Webhook handling error:", err);
  }
});

async function routeTextOrCommand(phone, session, value) {
  if (value.toLowerCase() === "menu" || session.step === "idle") {
    saveSession(phone, { step: "idle" });
    await sendList(phone, "What would you like to order?", "Choose", [
      { id: "perfect_binding", title: "Perfect Binding" },
      // add more rows here as more products are wired into flows/productFlows.js
    ]);
    return;
  }

  if (session.step === "idle" || value === "perfect_binding") {
    await startFlow(phone, "perfect_binding");
    return;
  }

  if (session.step === "in_flow") {
    await handleFlowReply(phone, session, value);
    return;
  }

  if (session.step === "awaiting_file") {
    await sendText(phone, "Please attach the file directly in WhatsApp.");
    return;
  }

  if (session.step === "awaiting_payment") {
    await sendText(phone, "Payment link already sent — complete that to confirm your order.");
    return;
  }

  await sendText(phone, "Type \"menu\" to start a new order.");
}

module.exports = router;
