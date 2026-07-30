# Your Soul Purpose Gems

Static storefront (plain HTML/CSS/JS) plus one Vercel serverless function that
emails order requests to the shop owner. **No payment is taken online** — that
is planned for a future release (see `future-payments/`).

## How the order flow works

1. Customer adds items on `bracelets.html` / `quartz.html`. The cart lives in
   `localStorage`.
2. On `cart.html` they fill in name, email, phone and pickup/delivery, then hit
   **Submit Order Request**.
3. The browser POSTs the cart to `/api/submit-order`.
4. That function validates everything, resolves prices from `lib/catalog.js`,
   and emails the order to the shop owner via [Resend](https://resend.com).
   `Reply-To` is set to the customer, so replying in your inbox reaches them.
5. The customer is redirected to `success.html?order=YSPG-…`.

Prices are **not** trusted from the browser. Anything the customer sends is
looked up by `data-id` in `lib/catalog.js`, and that name and price is what goes
in the email. An unknown id still gets through, but is flagged
`(unverified price)` so you know to check it.

## Layout

```
index.html about.html services.html      static pages
bracelets.html quartz.html               product listings
cart.html success.html contact.html
CSS/style.css                            all styling
JS/script.js                             cart, language switch, nav, slideshow
api/submit-order.js                      the only deployed serverless function
lib/catalog.js                           server-side prices (source of truth)
future-payments/                         parked Stripe code — NOT deployed
```

Only files under the top-level `api/` directory become serverless functions on
Vercel, and that name is case-sensitive.

## Setup

```bash
npm install
```

Then set the environment variables — locally in `.env.local`, and on Vercel
under **Project → Settings → Environment Variables**. See `.env.example`.

| Variable | Required | Notes |
|----------|----------|-------|
| `RESEND_API_KEY` | yes | From https://resend.com/api-keys |
| `ORDER_EMAIL_TO` | no | Defaults to `yoursoulpurposegems@gmail.com` |
| `ORDER_EMAIL_FROM` | no | Defaults to Resend's shared `onboarding@resend.dev` |

### About the sender address

Until you verify your own domain in Resend, leave `ORDER_EMAIL_FROM` unset. The
fallback `onboarding@resend.dev` works with no setup **but only delivers to the
email address that owns the Resend account.** If order emails are not arriving,
that is almost always why. Once your domain is verified, set
`ORDER_EMAIL_FROM="Your Soul Purpose Gems <orders@yourdomain.com>"`.

## Run locally

```bash
npx vercel dev
```

This serves the pages and the function together, so `/api/submit-order` works.
A plain static server will serve the pages but every order submission will fail.

## Layout notes

The fixed header's height lives in one place, the `--header-h` custom property
in `CSS/style.css`. Every page offsets its content by it and the off-canvas menu
hangs below it, so change it there rather than reintroducing hardcoded pixel
values. It is 70px on desktop and 76px at the mobile breakpoint, where controls
grow to 44px touch targets.

A page whose content starts straight after the header — with no `.hero` to
provide the offset — needs `class="page-main"` on its `<main>`, or the first
heading will sit behind the header.

The brand in the header is the only flex item allowed to shrink. It scales via
`clamp()` and truncates as a last resort so the burger menu can never be pushed
off-screen on a narrow phone.

## Adding or repricing a product

Two places, and they must agree:

1. The `.add-to-cart` button in `bracelets.html` or `quartz.html`
   (`data-id`, `data-name`, `data-name-es`, `data-price`, `data-image`).
2. The matching entry in `lib/catalog.js`, keyed by the same `data-id`.

If you skip step 2 the item still orders, but the email marks its price
unverified.

## Known gaps

- The endpoint has no rate limiting, so the order form could be used to spam the
  inbox. Real protection needs either a Vercel KV / Upstash counter or a
  CAPTCHA on the form.
- Descriptions are missing for the first three bracelets on `bracelets.html`
  (the `data-en` / `data-es` copy needs writing).
- Products 4–6 on both listing pages are still Unsplash stock photos with
  placeholder copy. These hotlink to unsplash.com and do rot — one
  (`photo-1603731096203`) had already 404'd and was swapped out. Replacing them
  with real photos in `Images/` removes the dependency entirely.
- The nav header is copy-pasted into all eight pages. It has already drifted
  once; consider a small build step or a shared include if it keeps growing.
