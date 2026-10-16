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

module.exports = {
  perfect_binding: {
    productId: 12982,
    label: "Print with Perfect Binding",
    questions: [
      {
        key: "sizeId",
        prompt: "Select size:",
        type: "list",
        options: SIZE_OPTIONS,
        parse: (v) => parseInt(v, 10),
      },
      // No B&W/Color toggle here on purpose: confirmed live against the site's
      // own debug endpoint (/wp-json/onlineprintingz/v1/check-number-fields) —
      // product 12982 has exactly one number field ("B&W Inner Pages"), no
      // separate Color field. This product is B&W only; don't ask the question.
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
        // Verified live (/onlineprintingz/v1/inspect-pricing-tables +
        // check-lam-options) — these are the only two lamination options this
        // product was kept on after an earlier cleanup (plain Gloss/Matt and the
        // bare "None" option were removed from THIS product specifically).
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
    ],
  },
};

// paperKey -> DB paper_id. Confirmed live via the site's own debug endpoints
// (/wp-json/onlineprintingz/v1/check-paper-options + verify-excel-example,
// which matched the client's Excel worked example exactly: paper_id 11,
// A4, 300pg, B&W, 50 copies -> ₹0.70/page, ₹10,500 total).
const PAPER_ID_MAP = {
  natural: 10, // "70 Gsm Natural Shade Book Printing Paper"
  white: 11, // "70 Gsm White Paper"
};

module.exports.PAPER_ID_MAP = PAPER_ID_MAP;
