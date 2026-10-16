const axios = require("axios");

const BASE = `https://graph.facebook.com/v20.0`;

function client() {
  return axios.create({
    baseURL: `${BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}`,
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

async function sendText(to, body) {
  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

// Up to 3 quick-reply buttons (WhatsApp's limit)
async function sendButtons(to, bodyText, buttons) {
  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

// Up to 10 rows, for menus with more options than buttons allow
async function sendList(to, bodyText, buttonLabel, rows) {
  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonLabel,
        sections: [{ title: "Options", rows }],
      },
    },
  });
}

async function getMediaUrl(mediaId) {
  const res = await axios.get(`${BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
  });
  return res.data.url; // short-lived, must be fetched immediately with the same auth header
}

async function downloadMedia(mediaUrl) {
  const res = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
  });
  return res.data; // Buffer
}

module.exports = { sendText, sendButtons, sendList, getMediaUrl, downloadMedia };
