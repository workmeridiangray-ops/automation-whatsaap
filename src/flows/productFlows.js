// Declarative question sequence per product. Add a new entry here to wire up
// another product — the engine in flows/engine.js walks this generically.

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

// All 6 "Print with X Binding" products (Perfect + 5 siblings) share the exact
// same configurator setup — confirmed live on 2026-10-17: same available sizes
// (67-71), same paper options (10/11), same lamination options (75/76 at the
// same sizes), same page_based pricing mode. They were clearly cloned from one
// another. Each has its own product-specific rate tables, but the question
// flow and the pricing call are identical except for which productId/pid is
// used — so this is generated once per binding type rather than copy-pasted.
function bindingQuestions() {
  return [
    {
      key: "sizeId",
      prompt: "Select size:",
      type: "list",
      options: SIZE_OPTIONS,
      parse: (v) => parseInt(v, 10),
    },
    // No B&W/Color toggle here on purpose: confirmed live against the site's
    // own debug endpoint — these products have exactly one number field
    // ("B&W Inner Pages"), no separate Color field. B&W only; don't ask.
    {
      key: "paperKey",
      prompt: "Paper type:",
      type: "list",
      options: PAPER_OPTIONS,
      parse: (v) => v,
    },
    {
      key: "pages",
      prompt: "How many pages?",
      type: "text",
      parse: (v) => {
        const n = parseInt(v.trim(), 10);
        if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a valid page count, e.g. 300");
        return n;
      },
    },
    {
      key: "copies",
      prompt: "How many copies?",
      type: "text",
      parse: (v) => {
        const n = parseInt(v.trim(), 10);
        if (!Number.isFinite(n) || n <= 0) throw new Error("Enter a valid quantity, e.g. 50");
        return n;
      },
    },
    {
      key: "laminationId",
      prompt: "Cover finish:",
      type: "list",
      // Verified live for all 6 binding products — these two are the only
      // lamination options kept (plain Gloss/Matt and a bare "None" were
      // removed from this product line in earlier cleanup).
      options: [
        { id: "75", title: "300gsm Glossy" },
        { id: "76", title: "300gsm Matt" },
      ],
      parse: (v) => parseInt(v, 10),
    },
    {
      key: "file",
      prompt: "Please upload your print-ready file now (PDF or image).",
      type: "file",
    },
  ];
}

const BINDING_PRODUCTS = [
  { key: "perfect_binding", productId: 12982, label: "Print with Perfect Binding" },
  { key: "soft_binding", productId: 14849, label: "Print with Soft Binding" },
  { key: "wireo_binding", productId: 14848, label: "Print with Wire-O Binding" },
  { key: "spiral_binding", productId: 14847, label: "Print with Spiral Binding" },
  { key: "rexin_binding", productId: 14846, label: "Print with Rexin Binding" },
  { key: "hardcase_binding", productId: 14845, label: "Print with Hard Case Binding" },
];

const flows = {};
for (const p of BINDING_PRODUCTS) {
  flows[p.key] = {
    productId: p.productId,
    label: p.label,
    isBindingProduct: true, // tells engine.js to use the generic live-pricing path
    questions: bindingQuestions(),
  };
}

module.exports = flows;
module.exports.BINDING_PRODUCTS = BINDING_PRODUCTS;

// paperKey -> DB paper_id. Confirmed live via the site's own debug endpoints
// (/wp-json/onlineprintingz/v1/check-paper-options + verify-excel-example,
// which matched the client's Excel worked example exactly: paper_id 11,
// A4, 300pg, B&W, 50 copies -> ₹0.70/page, ₹10,500 total). Same paper_ids
// confirmed live for all 6 binding products.
const PAPER_ID_MAP = {
  natural: 10, // "70 Gsm Natural Shade Book Printing Paper"
  white: 11, // "70 Gsm White Paper"
};

module.exports.PAPER_ID_MAP = PAPER_ID_MAP;
