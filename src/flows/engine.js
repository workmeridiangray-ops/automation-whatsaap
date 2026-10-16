const { sendText, sendButtons, sendList } = require("../services/whatsapp");
const { saveSession } = require("../services/sessionStore");
const flows = require("./productFlows");
const { getLivePrice } = require("../services/livePricing");
const { createPaymentLink } = require("../services/razorpay");
const { createOrder } = require("../services/woocommerce");
const { handleIncomingFile } = require("./fileHandler");

async function askQuestion(phone, flowKey, question) {
  if (question.type === "buttons") {
    await sendButtons(phone, question.prompt, question.options.map((o) => ({ id: o.id, title: o.title })));
  } else if (question.type === "list") {
    await sendList(phone, question.prompt, "Choose", question.options.map((o) => ({ id: o.id, title: o.title })));
  } else if (question.type === "text") {
    await sendText(phone, question.prompt);
  } else if (question.type === "file") {
    await sendText(phone, question.prompt);
  }
}

// File questions are deliberately excluded here: a file is never recorded in
// `answers` while we're waiting for it (only after handleFileUpload runs), so
// treating it like a normal pending question meant it was always returned as
// "next" — handleFlowReply then just re-asked it via the generic branch and
// never reached the code that sets session.step to "awaiting_file". Confirmed
// live: file uploads were rejected with step stuck at "in_flow" even though
// the bot had already sent the "upload your file" prompt.
function nextUnansweredQuestion(flow, answers) {
  return flow.questions.find((q) => q.type !== "file" && !(q.key in answers));
}

// Entry point: product selected from the main menu
async function startFlow(phone, flowKey) {
  const flow = flows[flowKey];
  const session = saveSession(phone, {
    step: "in_flow",
    productKey: flowKey,
    productId: flow.productId,
    answers: {},
  });
  await sendText(phone, `Great — ${flow.label}. A few quick questions to get you an exact price.`);
  const q = nextUnansweredQuestion(flow, session.answers);
  await askQuestion(phone, flowKey, q);
}

// Called for every inbound text/button/list reply once a flow is active
async function handleFlowReply(phone, session, rawValue) {
  const flow = flows[session.productKey];
  const pendingQuestion = nextUnansweredQuestion(flow, session.answers);

  if (!pendingQuestion) return; // shouldn't happen; flow already complete

  if (pendingQuestion.type === "file") {
    await sendText(phone, "Please send the file as a WhatsApp attachment (not as text).");
    return;
  }

  let parsed;
  try {
    parsed = pendingQuestion.parse(rawValue);
  } catch (err) {
    await sendText(phone, `⚠️ ${err.message}`);
    return;
  }

  const answers = { ...session.answers, [pendingQuestion.key]: parsed };
  saveSession(phone, { answers });

  const next = nextUnansweredQuestion(flow, answers);
  if (next) {
    await askQuestion(phone, session.productKey, next);
  } else {
    // All text/button questions done — now wait for the file if the flow needs one
    const needsFile = flow.questions.some((q) => q.type === "file");
    if (needsFile) {
      saveSession(phone, { step: "awaiting_file" });
      await askQuestion(phone, session.productKey, flow.questions.find((q) => q.type === "file"));
    } else {
      await finalizeQuote(phone);
    }
  }
}

async function handleFileUpload(phone, session, mediaId, mimeType) {
  let wpAttachmentId;
  try {
    wpAttachmentId = await handleIncomingFile(mediaId, mimeType);
  } catch (err) {
    // Unsupported file type etc. — tell the customer plainly and leave them
    // in awaiting_file so they can just send a different file, rather than
    // silently failing or bouncing them back to the main menu.
    await sendText(phone, `⚠️ ${err.message}`);
    return;
  }
  saveSession(phone, { fileMediaId: mediaId, wpAttachmentId, answers: { ...session.answers, file: true } });
  await finalizeQuote(phone);
}

async function finalizeQuote(phone) {
  const session = require("../services/sessionStore").getSession(phone);
  const flow = flows[session.productKey];
  const a = session.answers;

  if (!flow.buildPriceParams) {
    console.error(`Flow "${session.productKey}" has no buildPriceParams — can't price this order.`);
    await sendText(phone, "⚠️ Sorry, something's misconfigured on our end. We'll follow up with you directly.");
    return;
  }

  let quote;
  try {
    quote = await getLivePrice(flow.buildPriceParams(a));
  } catch (err) {
    await sendText(
      phone,
      "⚠️ Sorry, I couldn't get a price for that combination right now. Type \"menu\" to try again, or we'll follow up with you directly."
    );
    console.error("Live pricing error:", err);
    return;
  }

  saveSession(phone, { step: "quoted", quote });

  const summary = flow.buildSummary ? flow.buildSummary(a, quote) : "";
  await sendText(
    phone,
    `Your order — ${flow.label}\n${summary}\n\nTotal: ₹${quote.total}\n\nGenerating your payment link...`
  );

  const link = await createPaymentLink({
    amountRupees: quote.total,
    description: `${flow.label} — order ${new Date().toISOString()}`,
    phone,
    referenceId: `${phone}-${Date.now()}`,
  });

  saveSession(phone, { razorpayLinkId: link.id, step: "awaiting_payment" });
  await sendText(phone, `Pay here to confirm your order:\n${link.short_url}`);
}

// Called by the Razorpay webhook once payment is confirmed
async function completeOrderAfterPayment(phone) {
  const session = require("../services/sessionStore").getSession(phone);
  const flow = flows[session.productKey];
  const a = session.answers;

  // Resolve the real WooCommerce product id from the final answers rather
  // than a static flow.productId — needed because a4_print covers two
  // different WC products (Color 12958 / B&W 12953) picked by an in-flow
  // answer, so the only reliable source is the same buildPriceParams(a)
  // call already used to price the order.
  const resolvedProductId = flow.buildPriceParams(a).pid;

  const order = await createOrder({
    phone,
    productId: resolvedProductId,
    lineItemName: flow.label,
    total: session.quote.total,
    meta: a,
    wpAttachmentId: session.wpAttachmentId,
  });

  await sendText(
    phone,
    `✅ Payment received — order #${order.id} confirmed and in production. We'll update you on dispatch.`
  );

  saveSession(phone, { step: "done" });
  return order;
}

module.exports = {
  startFlow,
  handleFlowReply,
  handleFileUpload,
  completeOrderAfterPayment,
};
