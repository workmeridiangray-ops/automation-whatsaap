// Replicates the live site's WC Print Configurator pricing logic for
// "Print with Perfect Binding" (product 12982).
//
// All of the below was verified LIVE against onlineprintingz.in on 2026-10-16
// via the site's own debug REST routes (/wp-json/onlineprintingz/v1/*), not
// guessed:
//
//   - Size IDs:  A5=67, A4=68, B5=69, 6x9=70, B6=71
//     (/onlineprintingz/v1/check-paper-options, product meta _wcpc_available_sizes)
//   - Paper IDs: Natural Shade 70gsm=10, White 70gsm=11
//     (/onlineprintingz/v1/check-paper-options)
//   - Pricing table: wp_wcpc_number_field_rates, real columns:
//     id, field_id, product_id, size_id, paper_id, from_pages, to_pages, price_per_unit, weight_per_unit
//     (/onlineprintingz/v1/check-number-fields -> rates_columns)
//   - The only number field on this product is field_id=1 ("B&W Inner Pages").
//     There is NO separate Color field or color toggle on the live page — this
//     product is B&W only. Don't add a color question/price-addon for it.
//   - Verified against the client's own Excel worked example via
//     /onlineprintingz/v1/verify-excel-example: A4(68) + Natural... wait, White(11)
//     + 300 pages + 50 copies -> price_per_page 0.70, cost/copy 210, total 10500.
//     Matched exactly.
//
//   - Lamination table: wp_wcpc_lamination_pricing, real columns:
//     id, product_id, size_id, lamination_id, from_copies, to_copies, price, weight_grams
//     (/onlineprintingz/v1/inspect-pricing-tables)
//     Valid lamination_id for this product: 75="300 Gsm With Glossy Lamination",
//     76="300 Gsm With Matt Lamination" (plain Gloss/Matt without the 300gsm
//     wrapper were intentionally removed from this product in earlier cleanup).

const mysql = require("mysql2/promise");

let pool;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
    });
  }
  return pool;
}

const FIELD_ID_BW_PAGES = 1; // wp_wcpc_number_fields.id for "B&W Inner Pages" on product 12982

async function getPagePrice({ sizeId, paperId, pageCount }) {
  const [rows] = await getPool().query(
    `SELECT price_per_unit FROM wp_wcpc_number_field_rates
     WHERE field_id = ? AND size_id = ? AND paper_id = ?
       AND ? >= from_pages AND (to_pages IS NULL OR ? <= to_pages)
     LIMIT 1`,
    [FIELD_ID_BW_PAGES, sizeId, paperId, pageCount, pageCount]
  );
  if (!rows.length) {
    throw new Error(
      `No page rate found for size=${sizeId} paper=${paperId} pages=${pageCount}`
    );
  }
  return parseFloat(rows[0].price_per_unit);
}

// Verified live (/onlineprintingz/v1/inspect-pricing-tables): real columns are
// id, product_id, size_id, lamination_id, from_copies, to_copies, price, weight_grams.
// Unlike page pricing, this is scoped per size_id too (not just lamination_id).
// Valid lamination_id values for this product: 75 = "300 Gsm With Glossy Lamination",
// 76 = "300 Gsm With Matt Lamination" (per earlier cleanup — plain Gloss/Matt without
// the 300gsm wrapper were intentionally removed from this product).
async function getLaminationCost({ sizeId, laminationId, copyCount }) {
  const [rows] = await getPool().query(
    `SELECT price FROM wp_wcpc_lamination_pricing
     WHERE product_id = 12982 AND size_id = ? AND lamination_id = ?
       AND ? >= from_copies AND (to_copies IS NULL OR ? <= to_copies)
     LIMIT 1`,
    [sizeId, laminationId, copyCount, copyCount]
  );
  return rows.length ? parseFloat(rows[0].price) : 0;
}

async function quotePerfectBinding({ sizeId, paperId, pages, copies, laminationId }) {
  const pricePerPage = await getPagePrice({ sizeId, paperId, pageCount: pages });

  const printingCostPerCopy = pricePerPage * pages;
  const printingCostAllCopies = printingCostPerCopy * copies;

  const laminationCostPerCopy = laminationId
    ? await getLaminationCost({ sizeId, laminationId, copyCount: copies })
    : 0;
  const laminationCostAllCopies = laminationCostPerCopy * copies;

  const total = printingCostAllCopies + laminationCostAllCopies;

  return {
    pricePerPage,
    printingCostPerCopy,
    printingCostAllCopies,
    laminationCostPerCopy,
    laminationCostAllCopies,
    total: Math.round(total * 100) / 100,
  };
}

module.exports = { quotePerfectBinding, getPagePrice, getLaminationCost };
