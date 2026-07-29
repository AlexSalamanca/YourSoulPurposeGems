# Parked: Stripe payment flow

These files are **not deployed**. Vercel only turns files under the top-level
`api/` directory into serverless functions, so nothing in here runs. They are
kept for the future release that adds online payment.

| File | Becomes |
|------|---------|
| `create-checkout-session.js` | `api/create-checkout-session.js` |
| `webhook.js` | `api/webhook.js` |

They previously lived in an uppercase `API/` folder plus a duplicate copy at
`JS/server.js`. Vercel builds on Linux, where `API/` ≠ `api/`, so those
functions were never routed — and one was misnamed
`create-checkout-sssession.js`. The duplicate has been removed.

## To bring this back

1. Move the two files into `api/`.
2. `npm install stripe` and commit the updated `package.json`.
3. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the Vercel project.
4. Restore the checkout call in `JS/script.js` (removed — see git history for
   `initiateCheckout`) and replace the `pk_test_YOUR_PUBLISHABLE_KEY_HERE`
   placeholder with the real publishable key.
5. Point `success.html` at the session lookup instead of the `?order=` param.

## Known issues to fix before shipping these

- `create-checkout-session.js` trusts client-supplied prices. Resolve line
  items against `lib/catalog.js` instead, the same way `api/submit-order.js`
  does, or a customer can pay whatever they like.
- `webhook.js` builds its raw body by concatenating chunks into a string. That
  corrupts multi-byte characters and breaks signature verification; buffer the
  chunks instead. It also needs `export const config = { api: { bodyParser:
  false } }` (or the Vercel equivalent) so the body is not parsed first.
- `webhook.js` hardcodes `yoursoulpurposegems83@gmail.com`, which does not match
  the address used everywhere else (`yoursoulpurposegems@gmail.com`). Use the
  `ORDER_EMAIL_TO` environment variable.
- `webhook.js` swallows email failures silently — the order would be paid for
  with no notification sent.
- Currency is hardcoded to `usd` while the shop quotes a BC phone number and
  e-transfer. Confirm whether it should be `cad`.
