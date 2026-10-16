const express = require("express");
const router = express.Router();
const { getSession, saveSession } = require("../services/sessionStore");
const { sendList, sendText } = require("../services/whatsapp");
const { startFlow, handleFlowReply, handleFileUpload } = require("../flows/engine");
const flows = require("../flows/productFlows");
const { MENU_SECTIONS } = flows;

// Any key defined in productFlows.js is a valid menu selection — new
// products just need an entry added there, no change needed here.
const PRODUCT_KEYS = new Set(Object.keys(flows).filter((k) => flows[k] && flows[k].questions));

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
    console.log(
      `Incoming [${message.type}] from ${phone} — session.step=${session.step}, productKey=${session.productKey}, answers=${JSON.stringify(session.answers)}`
    );

    if (message.type === "text") {
      const text = message.text.body.trim();
      await routeTextOrCommand(phone, session, text);
    } else if (message.type === "interactive") {
      const reply =
        message.interactive.button_reply?.id || message.interactive.list_reply?.id;
      await routeTextOrCommand(phone, session, reply);
    } else if (message.type === "document" || message.type === "image") {
      const mediaId = message.document?.id || message.image?.id;
      const mimeType = message.document?.mime_type || message.image?.mime_type;
      if (session.step === "awaiting_file") {
        console.log(`Accepting file upload, mediaId=${mediaId}, mimeType=${mimeType}`);
        await handleFileUpload(phone, session, mediaId, mimeType);
      } else {
        console.log(`Rejecting file upload — session.step was "${session.step}", not "awaiting_file"`);
        await sendText(phone, "I wasn't expecting a file right now — type \"menu\" to start an order.");
      }
    } else {
      console.log(`Unhandled message type: ${message.type}`);
    }
  } catch (err) {
    console.error("Webhook handling error:", err);
  }
});

async function routeTextOrCommand(phone, session, value) {
  // Explicit "menu" command always shows the product list.
  if (value.toLowerCase() === "menu") {
    saveSession(phone, { step: "idle" });
    return sendMainMenu(phone);
  }

  // A product selection should start its flow regardless of current step —
  // this must be checked before the idle fallback below, otherwise a fresh
  // session (step defaults to "idle") can never progress past the menu.
  if (PRODUCT_KEYS.has(value)) {
    await startFlow(phone, value);
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

  // Idle session with unrecognized input (e.g. "hi") -> show the menu.
  saveSession(phone, { step: "idle" });
  return sendMainMenu(phone);
}

async function sendMainMenu(phone) {
  // WhatsApp list messages cap at 10 rows TOTAL across all sections (not per
  // section) — MENU_SECTIONS in productFlows.js is kept at exactly that
  // limit; adding an 11th product needs a row trimmed/merged elsewhere too.
  await sendList(phone, "What would you like to order?", "Choose", MENU_SECTIONS);
}

module.exports = router;
