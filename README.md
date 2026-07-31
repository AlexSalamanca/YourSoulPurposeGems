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
dreamcatchers.html others.html
cart.html success.html contact.html
CSS/style.css                            all styling
JS/script.js                             cart, language switch, nav, slideshow
api/submit-order.js                      the only deployed serverless function
lib/catalog.js                           server-side prices (source of truth)
lib/tax.js                               BC sales tax, shared browser + API
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

`main` needs its explicit `width: 100%`. `body` is a flex column, and an auto
margin on the cross axis cancels `align-items: stretch`, so without it `main`
shrink-wraps its content rather than filling `max-width: 1200px`. A page with a
single product collapsed to roughly 600px because of this.

The product photos are tall, and the subject rarely sits dead centre, so the two
grids handle cropping differently:

- **Category cards** (`services.html`) use `object-fit: cover` with a per-photo
  focal point: `style="--focal-y: 85%"` on the `.product-image`. Smaller values
  crop towards the top of the photo, larger towards the bottom; the default is
  50%. Current values are bracelets 85% (they sit low, below the river),
  quartz 20% (the tray sits high, above the wicker heart), others 42%,
  dreamcatchers 50%. Set this whenever a new card photo looks mis-framed.
- **Product pages** use `items-grid-contain` on the `.items-grid` section —
  taller image area, contain rather than cover, and a lone card stays a sensible
  width and centred instead of sitting in the left third. Used by
  `dreamcatchers.html` and `others.html`.
- **Single items** can opt into the same treatment with `item-image-full` on the
  `.item-image`. `quartz.html` mixes both: the single-stone shots are cropped so
  the stone fills the card, while the photos of several pieces laid down a tray
  use `item-image-full` so nothing is cut off at the ends. Keep items sharing a
  grid row on the same setting, or that row gets one card with dead space under
  its image.

Contain was tried on the category cards first and was wrong there: fitting a
portrait photo into a 512x300 landscape card left the product about 225px wide
with wide empty margins — visible, but too small to read.

## Sales tax

`lib/tax.js` holds the BC rates — GST 5% and PST 7%, each charged on the subtotal
rather than compounded. That one file is loaded by both the cart page (as
`window.TAX`) and `api/submit-order.js` (as a `require`), so what the customer
sees and what the order email says can never drift apart. All money is handled in
integer cents, so the displayed rows always add up to the displayed total.

To change the rates, edit only that file. Setting a rate to `0` removes its row
from both the cart and the email; setting `ENABLED = false` removes tax entirely.

**Please confirm with an accountant before going live.** The rates are correct
for BC, but whether you must charge them depends on your registrations — for GST
there is a small-supplier threshold ($30,000 of revenue over four consecutive
quarters), and PST registration follows different rules. If you are not
registered for one, set that rate to `0`.

## Adding or repricing a product

Two places, and they must agree:

1. The `.add-to-cart` button in `bracelets.html` or `quartz.html`
   (`data-id`, `data-name`, `data-name-es`, `data-price`, `data-image`).
2. The matching entry in `lib/catalog.js`, keyed by the same `data-id`.

If you skip step 2 the item still orders, but the email marks its price
unverified.

Repricing needs **three** edits, not two: the displayed `<p class="item-price">`,
the button's `data-price`, and `lib/catalog.js`. Changing only the displayed one
leaves the customer seeing a price different from the one they are charged. This
has already happened once, on seven products at the same time.

## Known gaps

- **Thirteen prices are placeholders**, invented so the cart would work. Confirm
  each and change it in *both* the page (`data-price` and the displayed
  `.item-price`) and `lib/catalog.js`:
  `dreamcatcher-1` $45.00; `other-1` $22.00, `other-2` $12.00, `other-3` $15.00;
  `bracelet-4` / `bracelet-5` / `bracelet-6` $25.00 each (matched to what the
  other bracelets sell for); `quartz-1` $12.00, `quartz-2` $15.00,
  `quartz-3` $18.00, `quartz-7` $10.00, `quartz-8` $28.00, `quartz-9` $14.00.
- `quartz-4` to `quartz-6` are off the site but still listed in `lib/catalog.js`,
  which is why the live quartz products are numbered 1-3 and 7-9. Ids are
  permanent keys, not display order — see the comment in `lib/catalog.js`.
- `Images/ColagentePuerta.jpeg` is misspelled on disk ("Colagente"). The markup
  matches the file, so it works — but if the file is ever renamed, update
  `others.html` too. Vercel serves from a case-sensitive filesystem.

- The endpoint has no rate limiting, so the order form could be used to spam the
  inbox. Real protection needs either a Vercel KV / Upstash counter or a
  CAPTCHA on the form.
- Descriptions are missing for the first three bracelets on `bracelets.html`
  (the `data-en` / `data-es` copy needs writing).
- The nav header is copy-pasted into all eight pages. It has already drifted
  once; consider a small build step or a shared include if it keeps growing.
