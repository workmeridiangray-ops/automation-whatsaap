// Declarative question sequence + pricing per product. Add a new entry to
// `flows` below to wire up another product — engine.js walks `questions`
// generically, then calls that flow's own computeQuote(answers) (or, for the
// live-AJAX flows, buildPriceParams(answers) + getLivePrice()) to get a
// price, and buildSummary(answers, quote) for the order-confirmation message.
// No per-product branching lives in engine.js — it's all here, declaratively,
// per flow.

const { getProductPrice } = require("../services/woocommerce");

const SIZE_OPTIONS = [
  { id: "67", title: "A5" },
  { id: "68", title: "A4" },
  { id: "69", title: "B5" },
  { id: "70", title: "6x9" },
  { id: "71", title: "B6" },
];

const PAPER_OPTIONS = [
  { id: "natural", title: "Natural Shade 70gsm" },
  { id: "white", title: "White 70gsm" },
];

// paperKey -> DB paper_id, used by the binding + A4 print flows. Confirmed
// live via the site's own debug endpoints + verify-excel-example (A4 +
// White + 300pg + 50 copies -> ₹0.70/page, ₹10,500 total — matched the
// client's own Excel worked example exactly).
const PAPER_ID_MAP = {
  natural: 10, // "70 Gsm Natural Shade Book Printing Paper"
  white: 11, // "70 Gsm White Paper"
};

function positiveInt(label, example) {
  return (v) => {
    const n = parseInt(String(v).trim(), 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Enter a valid ${label}, e.g. ${example}`);
    return n;
  };
}

// ---------------------------------------------------------------------------
// 1) "Print with X Binding" — Perfect/Soft/Wire-O/Spiral/Rexin/Hard Case.
//    Confirmed live on 2026-10-17: all 6 share identical configurator setup
//    (same available sizes 67-71, same paper options 10/11, same lamination
//    options 75/76 at the same sizes, same page_based pricing mode) — they
//    were clearly cloned from one another, so one factory covers all 6.
// ---------------------------------------------------------------------------
function bindingFlow({ key, productId, label }) {
  return {
    key,
    productId,
    label,
    questions: [
      { key: "sizeId", prompt: "Select size:", type: "list", options: SIZE_OPTIONS, parse: (v) => parseInt(v, 10) },
      // No B&W/Color toggle on purpose: confirmed live these products have
      // exactly one number field ("B&W Inner Pages") — B&W only.
      { key: "paperKey", prompt: "Paper type:", type: "list", options: PAPER_OPTIONS, parse: (v) => v },
      { key: "pages", prompt: "How many pages?", type: "text", parse: positiveInt("page count", 300) },
      { key: "copies", prompt: "How many copies?", type: "text", parse: positiveInt("quantity", 50) },
      {
        key: "laminationId",
        prompt: "Cover finish:",
        type: "list",
        // Verified live for all 6 — only these two lamination options were
        // kept on this product line after an earlier site cleanup.
        options: [
          { id: "75", title: "300gsm Glossy" },
          { id: "76", title: "300gsm Matt" },
        ],
        parse: (v) => parseInt(v, 10),
      },
      { key: "file", prompt: "Please upload your print-ready file now (PDF or image).", type: "file" },
    ],
    buildPriceParams: (a) => ({
      pid: productId,
      mode: "page_based",
      sizeId: a.sizeId,
      paperId: PAPER_ID_MAP[a.paperKey],
      pages: a.pages,
      qty: a.copies,
      coverBindingId: a.laminationId,
    }),
    buildSummary: (a, quote) =>
      `Size: ${a.sizeId}, Paper: ${a.paperKey}\n` +
      `${a.pages} pages × ${a.copies} copies\n` +
      `Cover finish: ${quote.coverLabel || (a.laminationId === 75 ? "300gsm Glossy" : "300gsm Matt")}`,
  };
}

const BINDING_PRODUCTS = [
  { key: "perfect_binding", productId: 12982, label: "Print with Perfect Binding" },
  { key: "soft_binding", productId: 14849, label: "Print with Soft Binding" },
  { key: "wireo_binding", productId: 14848, label: "Print with Wire-O Binding" },
  { key: "spiral_binding", productId: 14847, label: "Print with Spiral Binding" },
  { key: "rexin_binding", productId: 14846, label: "Print with Rexin Binding" },
  { key: "hardcase_binding", productId: 14845, label: "Print with Hard Case Binding" },
];

// ---------------------------------------------------------------------------
// 2) A4 document printing — Color Print & Black & White Print. Confirmed
//    live: fixed A4 size (size_id=4), paper 10/11, print_id 8/9 for single/
//    double side, no binding needed for a simple print job (left as loose
//    sheets — bind_id omitted). Page-based pricing, real per-page rates
//    confirmed live (B&W ₹1.00/pg at 2+ pages, Color ₹8.00/pg double-sided).
// ---------------------------------------------------------------------------
// Color Print (12958) and Black & White Print (12953) are otherwise-identical
// A4 document-printing products that only differ in which rate table (and
// therefore which productId) applies — merged into one flow with a leading
// ink-type question rather than two separate menu rows, to stay within
// WhatsApp's 10-row-total limit across all list sections.
function a4PrintFlow() {
  return {
    key: "a4_print",
    label: "A4 Document Print",
    questions: [
      {
        key: "inkType",
        prompt: "Black & White or Color?",
        type: "buttons",
        options: [
          { id: "bw", title: "Black & White" },
          { id: "color", title: "Color" },
        ],
        parse: (v) => v,
      },
      { key: "paperKey", prompt: "Paper type:", type: "list", options: PAPER_OPTIONS, parse: (v) => v },
      {
        key: "sides",
        prompt: "Single or double sided?",
        type: "buttons",
        options: [
          { id: "8", title: "Single Side" },
          { id: "9", title: "Double Side" },
        ],
        parse: (v) => parseInt(v, 10),
      },
      { key: "pages", prompt: "How many pages?", type: "text", parse: positiveInt("page count", 20) },
      { key: "copies", prompt: "How many copies?", type: "text", parse: positiveInt("quantity", 1) },
      { key: "file", prompt: "Please upload your print-ready file now (PDF or image).", type: "file" },
    ],
    // No static productId here on purpose — this flow covers two different
    // WC products (Color 12958 / B&W 12953) picked by the inkType answer.
    // engine.js resolves the real pid via buildPriceParams(answers).pid once
    // the flow is complete, both for pricing and for the WC order line item.
    buildPriceParams: (a) => ({
      pid: a.inkType === "color" ? 12958 : 12953,
      mode: "page_based",
      sizeId: 4, // A4 — the only size either product offers
      paperId: PAPER_ID_MAP[a.paperKey],
      printId: a.sides,
      pages: a.pages,
      qty: a.copies,
    }),
    buildSummary: (a, quote) =>
      `A4 ${a.inkType === "color" ? "Color" : "B&W"}, Paper: ${a.paperKey}, ${quote.printTypeLabel}\n` +
      `${a.pages} pages × ${a.copies} copies`,
  };
}

// ---------------------------------------------------------------------------
// 3) Large-format printing — A0 Image Printing & A0 Line Drawing (CAD).
//    Confirmed live: multiple sheet sizes, several paper stocks, a flat
//    per-sheet print price (not a per-page slab — these are single large
//    sheets, "pages" stays 1), print_id uses 59=B&W/61=Color (NOT the
//    8/9 single/double codes used elsewhere), optional rolled/folded
//    packing as a real line-item extra (confirmed ₹50 for Rolled).
// ---------------------------------------------------------------------------
const LARGE_FORMAT_SIZE_OPTIONS = [
  { id: "3", title: "A3" },
  { id: "4", title: "A4" },
  { id: "23", title: "A0" },
  { id: "72", title: "A2" },
  { id: "73", title: "A1" },
  { id: "91", title: "FS" },
  { id: "115", title: "13x19" },
];
const LARGE_FORMAT_PAPER_OPTIONS = [
  { id: "10", title: "70gsm Natural Shade" },
  { id: "11", title: "70gsm White" },
  { id: "93", title: "Colotec Paper" },
  { id: "94", title: "Bond" },
  { id: "95", title: "Green Sheet" },
  { id: "96", title: "100gsm Paper" },
  { id: "97", title: "130 Art Paper" },
];

function largeFormatFlow({ key, productId, label, colorChoiceAllowed }) {
  const questions = [
    { key: "sizeId", prompt: "Select sheet size:", type: "list", options: LARGE_FORMAT_SIZE_OPTIONS, parse: (v) => parseInt(v, 10) },
    { key: "paperId", prompt: "Select paper/material:", type: "list", options: LARGE_FORMAT_PAPER_OPTIONS, parse: (v) => parseInt(v, 10) },
  ];
  if (colorChoiceAllowed) {
    questions.push({
      key: "printId",
      prompt: "Black & White or Color?",
      type: "buttons",
      options: [
        { id: "59", title: "B&W" },
        { id: "61", title: "Color" },
      ],
      parse: (v) => parseInt(v, 10),
    });
  }
  questions.push(
    { key: "copies", prompt: "How many copies?", type: "text", parse: positiveInt("quantity", 1) },
    {
      key: "packingId",
      prompt: "Packing:",
      type: "buttons",
      options: [
        { id: "78", title: "Rolled" },
        { id: "80", title: "Folded" },
      ],
      parse: (v) => parseInt(v, 10),
    },
    { key: "file", prompt: "Please upload your print-ready file now (PDF or image).", type: "file" }
  );

  return {
    key,
    productId,
    label,
    questions,
    buildPriceParams: (a) => ({
      pid: productId,
      mode: "page_based",
      sizeId: a.sizeId,
      paperId: a.paperId,
      printId: colorChoiceAllowed ? a.printId : 59, // CAD line drawings are B&W-only
      pages: 1, // a single large sheet, not page-counted
      qty: a.copies,
      packingId: a.packingId,
    }),
    buildSummary: (a, quote) => {
      const sizeLabel = LARGE_FORMAT_SIZE_OPTIONS.find((o) => o.id === String(a.sizeId))?.title || a.sizeId;
      const paperLabel = LARGE_FORMAT_PAPER_OPTIONS.find((o) => o.id === String(a.paperId))?.title || a.paperId;
      return (
        `${sizeLabel}, ${paperLabel}${colorChoiceAllowed ? `, ${quote.printTypeLabel}` : ""}\n` +
        `${a.copies} copies, Packing: ${a.packingId === 78 ? "Rolled" : "Folded"}`
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 4) Sticker — custom/any-shape stickers priced by area (cm² -> in²) and
//    material. Confirmed live: shape is fixed to "custom" (the only option
//    on the live site), material maps to paper_id 116-120, width/height
//    submitted in cm as stk_width/stk_height, mode=qty_based.
// ---------------------------------------------------------------------------
const STICKER_MATERIAL_OPTIONS = [
  { id: "116", title: "Standard - Economical" },
  { id: "117", title: "Thin Film (Indoor)" },
  { id: "118", title: "Transparent (Indoor)" },
  { id: "119", title: "Kraft Paper" },
  { id: "120", title: "Premium Vinyl (Indoor/Outdoor)" },
];

const stickerFlow = {
  key: "sticker",
  productId: 9635,
  label: "Sticker",
  questions: [
    { key: "materialId", prompt: "Material:", type: "list", options: STICKER_MATERIAL_OPTIONS, parse: (v) => parseInt(v, 10) },
    {
      key: "widthCm",
      prompt: "Width in cm? (0.5in–18in range, so roughly 1.3cm–45.7cm)",
      type: "text",
      parse: (v) => {
        const n = parseFloat(v.trim());
        if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a valid width in cm, e.g. 5");
        return n;
      },
    },
    {
      key: "heightCm",
      prompt: "Height in cm? (0.5in–12in range, so roughly 1.3cm–30.5cm)",
      type: "text",
      parse: (v) => {
        const n = parseFloat(v.trim());
        if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a valid height in cm, e.g. 5");
        return n;
      },
    },
    { key: "copies", prompt: "How many stickers?", type: "text", parse: positiveInt("quantity", 100) },
    { key: "file", prompt: "Please upload your design file now (PDF or image).", type: "file" },
  ],
  buildPriceParams: (a) => ({
    pid: 9635,
    mode: "qty_based",
    paperId: a.materialId,
    qty: a.copies,
    extra: {
      wcpc_stk_shape: "custom",
      stk_width: a.widthCm,
      stk_height: a.heightCm,
    },
  }),
  buildSummary: (a) => {
    const material = STICKER_MATERIAL_OPTIONS.find((o) => o.id === String(a.materialId))?.title || a.materialId;
    return `${a.widthCm}cm × ${a.heightCm}cm, ${material}\n${a.copies} stickers`;
  },
};

// ---------------------------------------------------------------------------
// 5) Auto-or-manual products — the WCPC configurator is switched OFF on
//    these (_wcpc_enabled=0) and, checked live on 2026-10-17, their WC
//    "price" field had no stated unit anywhere on the product page (no
//    "per 100", "per box", "per piece", etc.). Naively multiplying that
//    price by a customer-typed quantity produced a nonsense number in
//    testing (₹277.67 × 500 "cards" = ₹1,38,835) — not safe to charge a
//    real customer. BASELINE_PRICES below is a snapshot of that known-bad
//    placeholder price for each one, taken the same day.
//
//    This flow self-upgrades with NO code change or redeploy needed: every
//    time an order comes in, it fetches the product's CURRENT live price
//    from WooCommerce and compares it to the snapshot. Unchanged -> still
//    nobody has set a real price, so it falls back to a manual-quote order
//    (no auto-pricing, no Razorpay link — a human quotes it). Changed (any
//    different value) -> that's a deliberate price edit on the site, so it
//    auto-prices as price × quantity from then on, same as the other
//    simple products. So: fix a price on the website, and the very next
//    WhatsApp order for that product uses it automatically.
// ---------------------------------------------------------------------------
const BASELINE_PRICES = {
  15062: 277.67, // Business Cards
  15063: 364.5, // Letter Heads
  15064: 431.5, // Envelopes
  15065: 323.15, // Certificates
  15167: 900.0, // Invitation Cards
  15057: 162.12, // Flyers
  15061: 344.09, // Posters
  15059: 530.34, // Brochures
  15058: 409.05, // Danglers
  15056: 251.2, // Custom Paper Box
  15173: 10000.0, // ID Card with Rope & Holder
  15176: 2000.0, // Custom Printed Round Badge
  15179: 50.0, // Custom Shape Flash Cards
  15236: 409.05, // Flashcards
  15235: 159.07, // Catalogue
};

const { ManualQuoteNeededError } = require("./errors");

function autoOrManualFlow({ key, productId, label }) {
  return {
    key,
    productId,
    label,
    questions: [
      { key: "copies", prompt: "How many would you like?", type: "text", parse: positiveInt("quantity", 1) },
      { key: "file", prompt: "Please upload your print-ready file now (PDF or image).", type: "file" },
    ],
    computeQuote: async (a) => {
      const unitPrice = await getProductPrice(productId);
      const baseline = BASELINE_PRICES[productId];
      if (baseline !== undefined && Math.abs(unitPrice - baseline) < 0.005) {
        throw new ManualQuoteNeededError(
          `Product ${productId} still has its placeholder price (₹${baseline}) — not set for sale yet.`
        );
      }
      return {
        unitPrice,
        total: Math.round(unitPrice * a.copies * 100) / 100,
      };
    },
    buildSummary: (a, quote) => `${a.copies} × ₹${quote.unitPrice} = ₹${quote.total}`,
  };
}

const SIMPLE_PRODUCTS = [
  { key: "business_cards", productId: 15062, label: "Business Cards" },
  { key: "letter_heads", productId: 15063, label: "Letter Heads" },
  { key: "envelopes", productId: 15064, label: "Envelopes" },
  { key: "certificates", productId: 15065, label: "Certificates" },
  { key: "invitation_cards", productId: 15167, label: "Invitation Cards" },
  { key: "flyers", productId: 15057, label: "Flyers" },
  { key: "posters", productId: 15061, label: "Posters" },
  { key: "brochures", productId: 15059, label: "Brochures" },
  { key: "danglers", productId: 15058, label: "Danglers" },
  { key: "custom_paper_box", productId: 15056, label: "Custom Paper Box" },
  { key: "id_card_rope", productId: 15173, label: "ID Card with Rope & Holder" },
  { key: "round_badge", productId: 15176, label: "Custom Printed Round Badge" },
  { key: "custom_shape_flashcards", productId: 15179, label: "Custom Shape Flash Cards" },
  { key: "flashcards", productId: 15236, label: "Flashcards" },
  { key: "catalogue", productId: 15235, label: "Catalogue" },
];

// ---------------------------------------------------------------------------

const flows = {};
for (const p of BINDING_PRODUCTS) flows[p.key] = bindingFlow(p);
for (const p of SIMPLE_PRODUCTS) flows[p.key] = autoOrManualFlow(p);

flows.a4_print = a4PrintFlow();

flows.a0_image_printing = largeFormatFlow({
  key: "a0_image_printing",
  productId: 14924,
  label: "A0 Image Printing",
  colorChoiceAllowed: true,
});
flows.a0_cad_printing = largeFormatFlow({
  key: "a0_cad_printing",
  productId: 13380,
  label: "A0 Line Drawing (CAD) Printing",
  colorChoiceAllowed: false, // confirmed live: no color option shown for this product
});

flows.sticker = stickerFlow;

// 25 products total now — far over WhatsApp's 10-row-total-per-message limit
// for a single list, so the menu is two-tier: a short top-level category
// list, and each category sends its own product sub-list (each ≤10 rows)
// when picked. Category ids are prefixed "cat_" so routing can tell a
// category selection apart from a product selection.
const CATEGORIES = [
  {
    id: "cat_binding",
    title: "Binding",
    items: BINDING_PRODUCTS.map((p) => ({ id: p.key, title: p.label.replace("Print with ", "") })),
  },
  {
    id: "cat_printing",
    title: "Printing Services",
    items: [
      { id: "a4_print", title: "A4 Document Print" },
      { id: "a0_image_printing", title: "A0 Image Printing" },
      { id: "a0_cad_printing", title: "A0 CAD/Line Drawing" },
      { id: "sticker", title: "Stickers" },
    ],
  },
  {
    id: "cat_stationery",
    title: "Business & Stationery",
    items: [
      { id: "business_cards", title: "Business Cards" },
      { id: "letter_heads", title: "Letter Heads" },
      { id: "envelopes", title: "Envelopes" },
      { id: "certificates", title: "Certificates" },
      { id: "invitation_cards", title: "Invitation Cards" },
    ],
  },
  {
    id: "cat_marketing",
    title: "Marketing Prints",
    items: [
      { id: "flyers", title: "Flyers" },
      { id: "posters", title: "Posters" },
      { id: "brochures", title: "Brochures" },
      { id: "danglers", title: "Danglers" },
    ],
  },
  {
    id: "cat_specialty",
    title: "Specialty & Packaging",
    items: [
      { id: "custom_paper_box", title: "Custom Paper Box" },
      { id: "id_card_rope", title: "ID Card with Rope & Holder" },
      { id: "round_badge", title: "Round Badge" },
      { id: "custom_shape_flashcards", title: "Custom Shape Flash Cards" },
      { id: "flashcards", title: "Flashcards" },
      { id: "catalogue", title: "Catalogue" },
    ],
  },
];

module.exports = flows;
module.exports.BINDING_PRODUCTS = BINDING_PRODUCTS;
module.exports.SIMPLE_PRODUCTS = SIMPLE_PRODUCTS;
module.exports.PAPER_ID_MAP = PAPER_ID_MAP;
module.exports.CATEGORIES = CATEGORIES;
