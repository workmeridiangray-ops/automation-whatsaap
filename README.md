# onlineprintingz WhatsApp Ordering Bot

WhatsApp-native ordering: customer picks a product → answers guided questions → uploads
a print file → gets a live price (pulled from the site's real WC Print Configurator
pricing tables) → pays via Razorpay → a real WooCommerce order is created automatically.

Currently wired for **Print with Perfect Binding (product 12982)** — the first product,
chosen because its pricing logic (`wp_wcpc_number_field_rates`, `wp_wcpc_lamination_pricing`)
is already fully mapped from earlier work on the site.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill in:
   - **WhatsApp**: Meta App dashboard → WhatsApp → API Setup (phone number ID, permanent token).
     Needs a verified Meta Business + WhatsApp Business Platform access.
   - **WooCommerce**: WooCommerce → Settings → Advanced → REST API → create a key with
     Read/Write permissions.
   - **WordPress**: an Application Password for the admin account (for media uploads).
   - **DB**: read access to the WooCommerce database (Hostinger phpMyAdmin credentials or
     a dedicated read-only MySQL user) — used for live pricing lookups.
   - **Razorpay**: API keys + a webhook secret (set up a webhook in Razorpay dashboard
     pointed at `https://<your-render-url>/webhook/razorpay`, subscribed to
     `payment_link.paid`).
3. `npm start` (or deploy to Render as a web service — same pattern as the existing
   AI Print Designer microservice).
4. In the Meta App dashboard, set the webhook URL to
   `https://<your-render-url>/webhook/whatsapp` and the verify token to match
   `WHATSAPP_VERIFY_TOKEN` in `.env`.

## Status: pricing logic verified live (2026-10-16)

Everything in `src/services/pricing.js` and `src/flows/productFlows.js` was checked
against the real onlineprintingz.in database via the site's own debug REST routes
(`/wp-json/onlineprintingz/v1/check-paper-options`, `check-number-fields`,
`inspect-pricing-tables`, `verify-excel-example`) — not guessed:

- Size IDs (67–71), paper IDs (10=Natural, 11=White), the real `wp_wcpc_number_field_rates`
  and `wp_wcpc_lamination_pricing` column names, and the two valid lamination IDs (75, 76)
  for this product are all confirmed.
- Confirmed there is **no Color option** on product 12982's live page (only one number
  field, "B&W Inner Pages") — the bot's flow correctly skips that question.
- Cross-checked against the client's own Excel worked example: A4, White paper, 300 pages,
  50 copies → ₹0.70/page, ₹10,500 total. Matched exactly via `verify-excel-example`.

**Still before going live:**
- Test the full flow end-to-end with a real (small) order, including a real Razorpay
  payment and confirming the WooCommerce order + uploaded file land correctly in wp-admin.
- Those debug routes (`/wp-json/onlineprintingz/v1/*`) are open on the live site with no
  auth beyond the WP Application Password — consider removing them once this bot (and
  any other tooling depending on them) is no longer actively being built against.

## Adding another product

1. Add an entry to `src/flows/productFlows.js` with its question sequence.
2. Add a pricing function in `src/services/pricing.js` if its pricing mechanism differs
   from Perfect Binding (WC Print Configurator has multiple parallel pricing tables —
   verify which one actually drives each product's live page before assuming).
3. Branch on `session.productKey` in `finalizeQuote()` in `src/flows/engine.js`.
4. Add a row to the main menu in `src/routes/whatsappWebhook.js`.

## Architecture

```
WhatsApp customer
   │
   ▼
Meta Cloud API ──webhook──▶ /webhook/whatsapp (Express)
                                  │
                       flows/engine.js (state machine, per-phone session)
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                 ▼                 ▼
        services/pricing.js  services/woocommerce.js  services/razorpay.js
        (MySQL query against   (REST API: media        (payment link +
         wp_wcpc_* tables)      upload, order create)    webhook verify)
```

Session state is in-memory (`services/sessionStore.js`) — fine for one instance;
swap for Redis if you need multiple server instances or persistence across restarts.
