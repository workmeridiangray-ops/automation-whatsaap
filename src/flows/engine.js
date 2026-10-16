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

// Every flow provides computeQuote(answers) -> quote object with at least
// .total. The two kinds in use:
//   - AJAX-priced flows (buildPriceParams defined): computeQuote calls the
//     site's own live pricing calculator via getLivePrice().
//   - Flat WC-price flows (computeQuote defined directly, e.g. simple fixed-
//     price products): just reads the product's current WooCommerce price.
// Either way engine.js doesn't need to know which kind it's dealing with.
async function computeQuote(flow, answers) {
  if (flow.computeQuote) return flow.computeQuote(answers);
  if (flow.buildPriceParams) return getLivePrice(flow.buildPriceParams(answers));
  throw new Error(`Flow has neither computeQuote nor buildPriceParams — can't price this order.`);
}

// Resolves which WooCommerce product id a completed order should be filed
// against. Defaults to the flow's static productId; a flow whose product
// depends on an answer (e.g. a4_print's ink-type choice) overrides this.
function resolveProductId(flow, answers) {
  if (flow.resolveProductId) return flow.resolveProductId(answers);
  if (flow.buildPriceParams) return flow.buildPriceParams(answers).pid;
  return flow.productId;
}

async function finalizeQuote(phone) {
  const session = require("../services/sessionStore").getSession(phone);
  const flow = flows[session.productKey];
  const a = session.answers;

  // Some products (requiresManualQuote: true) don't have a trustworthy
  // per-unit price to compute from yet — their WC listing has no stated
  // unit (per piece? per box of 100? per pack?), so multiplying a raw price
  // by a customer-entered quantity can produce a wildly wrong number. For
  // those, skip auto-pricing and Razorpay entirely: file the order spec as
  // a pending WooCommerce order for a human to price and send a payment
  // link for, rather than guessing against a real charge.
  if (flow.requiresManualQuote) {
    const order = await createOrder({
      phone,
      productId: flow.productId,
      lineItemName: flow.label,
      total: 0,
      meta: a,
      wpAttachmentId: session.wpAttachmentId,
    });
    saveSession(phone, { step: "done" });
    await sendText(
      phone,
      `Thanks! We've got your ${flow.label} order details (order #${order.id}) and your file.\n` +
        `Our team will confirm the price and send you a payment link shortly.`
    );
    return;
  }

  let quote;
  try {
    quote = await computeQuote(flow, a);
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

  const resolvedProductId = resolveProductId(flow, a);

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
