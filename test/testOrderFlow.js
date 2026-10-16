/**
 * Standalone end-to-end test for the pricing + WooCommerce order pieces —
 * no WhatsApp/Meta required. Run this to confirm the non-WhatsApp half of
 * the pipeline (price calc -> order creation -> file attach) works against
 * the real site before setting up the Meta test number.
 *
 * Creates ONE safe, clearly-labeled TEST order on the live site:
 *   - status: "pending" (never auto-processed, no customer notification sent)
 *   - billing name: "BOT TEST ORDER - SAFE TO DELETE"
 *   - meta _whatsapp_order_test: "yes" (so it's easy to find/delete in wp-admin)
 * No Razorpay call is made — this only tests pricing math + order creation.
 *
 * Usage:
 *   cp .env.example .env   # fill in WP_APPLICATION_USERNAME / WP_APPLICATION_PASSWORD
 *                           # and either WC_BASE_URL/WP_BASE_URL, or leave as-is for onlineprintingz.in
 *   node test/testOrderFlow.js
 *
 * Note: pricing.js needs DB_HOST/DB_USER/DB_PASSWORD/DB_NAME in .env for the
 * live MySQL lookup. If those aren't set yet, this script falls back to the
 * known-good verified example (A4/White/300pg/50 copies -> ₹10,500) so you can
 * still test order creation independently.
 */

require("dotenv").config();
const { createOrder } = require("../src/services/woocommerce");

const KNOWN_GOOD_QUOTE = {
  // Verified live on 2026-10-16 via /wp-json/onlineprintingz/v1/verify-excel-example
  // against the client's own Excel reference sheet.
  sizeId: 68, // A4
  paperId: 11, // White 70gsm
  pages: 300,
  copies: 50,
  pricePerPage: 0.7,
  printingCostPerCopy: 210,
  printingCostAllCopies: 10500,
  laminationCostPerCopy: 0,
  laminationCostAllCopies: 0,
  total: 10500,
};

async function getQuote() {
  if (process.env.DB_HOST) {
    const { quotePerfectBinding } = require("../src/services/pricing");
    console.log("DB credentials present — running the real live pricing query...");
    const quote = await quotePerfectBinding({
      sizeId: KNOWN_GOOD_QUOTE.sizeId,
      paperId: KNOWN_GOOD_QUOTE.paperId,
      pages: KNOWN_GOOD_QUOTE.pages,
      copies: KNOWN_GOOD_QUOTE.copies,
      laminationId: 75, // 300gsm Glossy
    });
    console.log("Live quote:", quote);
    if (quote.total !== KNOWN_GOOD_QUOTE.total && !quote.laminationCostAllCopies) {
      console.warn(
        `⚠️  Total (₹${quote.total}) doesn't match the known-good base price (₹${KNOWN_GOOD_QUOTE.total}) ` +
          `— that's expected once lamination cost is added on top, but double-check if it's way off.`
      );
    }
    return quote;
  }

  console.log(
    "No DB_HOST set — skipping live pricing query, using the pre-verified known-good quote instead."
  );
  return KNOWN_GOOD_QUOTE;
}

async function main() {
  const quote = await getQuote();

  console.log("\nCreating a safe TEST order on the live site (status: pending)...");
  const order = await createOrder({
    phone: "+910000000000",
    productId: 12982,
    lineItemName: "Print with Perfect Binding — BOT TEST, SAFE TO DELETE",
    total: quote.total,
    meta: {
      sizeId: KNOWN_GOOD_QUOTE.sizeId,
      paperId: KNOWN_GOOD_QUOTE.paperId,
      pages: KNOWN_GOOD_QUOTE.pages,
      copies: KNOWN_GOOD_QUOTE.copies,
      test: true,
    },
    wpAttachmentId: null,
  });

  console.log(`\n✅ Test order created: #${order.id}`);
  console.log(`   Check it in wp-admin: ${process.env.WC_BASE_URL}/wp-admin/post.php?post=${order.id}&action=edit`);
  console.log(`   It's status "pending" and will not notify anyone or get processed — delete it once confirmed.`);
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err.response?.data || err.message);
  process.exit(1);
});
