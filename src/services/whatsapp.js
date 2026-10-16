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

// Up to 10 rows per section, up to 10 sections, for menus with more options
// than buttons allow. `rowsOrSections` can be either a flat array of rows
// (wrapped into a single "Options" section, the original behavior) or an
// array of { title, items } to render as multiple labeled sections.
async function sendList(to, bodyText, buttonLabel, rowsOrSections) {
  const isSections = Array.isArray(rowsOrSections) && rowsOrSections[0] && "items" in rowsOrSections[0];
  const sections = isSections
    ? rowsOrSections.map((s) => ({ title: s.title, rows: s.items }))
    : [{ title: "Options", rows: rowsOrSections }];

  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonLabel,
        sections,
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
