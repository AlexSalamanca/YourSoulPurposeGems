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
4. That function validates everything, resolves prices from `JS/catalog.js`,
   and emails the order to the shop owner via [Resend](https://resend.com).
   `Reply-To` is set to the customer, so replying in your inbox reaches them.
5. The customer is redirected to `success.html?order=YSPG-…`.

Prices are **not** trusted from the browser. Anything the customer sends is
looked up by `data-id` in `JS/catalog.js`, and that name and price is what goes
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
JS/catalog.js                            names + prices, shared browser + API
JS/tax.js                                BC sales tax, shared browser + API
api/submit-order.js                      the only deployed serverless function
partials/header.html                     the one copy of the site header
tools/sync-header.js                     copies that header into every page
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
| `ORDER_EMAIL_FROM` | no | Defaults to `orders@yoursoulpurposegems.com` |

### About the sender address

Mail goes out from `orders@yoursoulpurposegems.com`, a domain verified in Resend,
so orders can be delivered to any address.

**That domain must stay verified.** If Resend verification lapses or the DNS
records change, every send fails and the API returns `502 Could not send the order
email`. The Vercel function logs print the reason as
`Resend rejected the order email: …`.

To send from somewhere else, set `ORDER_EMAIL_FROM` rather than editing the code —
but it must also be a Resend-verified domain. Resend's shared
`onboarding@resend.dev` needs no verification but only delivers to the address
that owns the Resend account, which is why it is no longer the default.

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

## The shared header

The nav is identical on all ten pages, so it lives in `partials/header.html` and
is copied into each page between `<!-- header:start -->` and `<!-- header:end -->`
markers.

```bash
npm run sync-header
```

Edit the partial, run that, done. To check without writing anything — useful
before a deploy:

```bash
npm run check-header
```

That exits non-zero and names any page whose header has drifted from the partial.

This is a sync script rather than a runtime include on purpose: the nav is the
site's primary navigation, so it should be in the HTML that ships rather than
injected by JavaScript, and Vercel still deploys plain static files with no build
step. The tradeoff is that you have to remember to run it — `npm run check-header`
is there to catch you when you forget.

Drift here is not hypothetical: it is how `cart.html` ended up linking to a
`cart-simple.html` that never existed.

## Bot protection on the order form

Two cheap checks, both in `api/submit-order.js`, both dependency-free:

- **Honeypot** — a `website` field hidden from people (`.visually-hidden`, not
  `display: none`, which bots detect). Bots that fill every field complete it.
- **Timing** — the form is rejected if it is submitted under `MIN_FILL_MS`
  (3 seconds) after the page loaded.

Both answer `200` with a plausible order number and send no email. Telling a bot
why it failed only teaches it what to change. Rejections are logged as
`Discarded a likely automated submission`, so check the Vercel logs if a real
customer ever reports a silent failure.

The timing value must be **strictly positive** to count. `Number(null)` is `0`,
and an earlier `>= 0` check meant a null timing field silently rejected genuine
orders. A lost order costs far more than a spam email, so every ambiguous case is
allowed through.

**This is not rate limiting.** It stops drive-by form spam, not a determined
attacker. Real per-IP throttling needs shared state across serverless invocations
— Vercel KV or Upstash — which is the remaining piece if abuse ever becomes real.

## Sales tax

`JS/tax.js` holds the BC rates — GST 5% and PST 7%, each charged on the subtotal
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

## Renaming or repricing a product

**Change it in `JS/catalog.js`. That is the whole job.**

A product's name and price are written down in exactly one place. The pages carry
neither: each loads `JS/catalog.js` and fills in the card heading and price tag
from there, keyed by the button's `data-id`. The cart re-resolves both on load, so
a cart saved before a change shows the new values, and the order API reads the
same file.

Both used to live in three places at once, and both drifted — prices on seven
products, names on six. A customer could see one price and be billed another, or
buy a "Small Tiger's Eye" and have the order email say "Tiger's Eye", which is
exactly the information you need to pack the right item. `data-price`,
`data-name` and `data-name-es` no longer exist.

Spanish names come from `nameEs` and drive the language switcher.

## Adding a product

1. Add an entry to `JS/catalog.js` with a new id, including `nameEs`.
2. Add a card in the page with a matching `data-id` on its `.add-to-cart` button.
   Give it an empty `<h3></h3>` and `<p class="item-price"></p>` — both are filled
   at runtime.
3. Make sure the page loads `JS/catalog.js` before `JS/script.js`.

A card whose `data-id` has no catalog entry renders blank with its Add to Cart
button disabled and an explanation in the browser console. A catalog entry with no
card simply never renders.

One tradeoff: because names and prices are injected at runtime, they are not in
the raw HTML for crawlers that do not execute JavaScript. Search engines
generally do run it, and the page `<title>`, meta description and image `alt`
text still carry the product names. A small build step (see Known gaps) would
remove the tradeoff entirely.

## Known gaps

Nothing below is a code defect. These are decisions, content and infrastructure
that need a human.

- **Confirm every price.** They all live in `JS/catalog.js` and are live as
  written, taxed at 12%. Several began as placeholders before being set
  deliberately, so read that file top to bottom once and confirm each figure.
- **Send one real test order** now that the sender is `orders@yoursoulpurposegems.com`.
  The domain is verified, so delivery to any address should work — worth one
  end-to-end order to confirm, and to check it does not land in spam.
- **Confirm the GST/PST obligation with an accountant.** See the Sales tax
  section — the rates are right for BC, but whether you must charge them depends
  on your registrations.
- **Update the domain in `sitemap.xml` and `robots.txt`.** Both currently assume
  `yoursoulpurposegems.com`. Resubmit the sitemap in Google Search Console once
  the real host is live.
- **Real rate limiting** needs shared state across serverless invocations —
  Vercel KV or Upstash. The honeypot and timing checks stop drive-by spam only.
- **`Images/logo2.jpg` is unused**, as is the logo in the header: the brand
  renders as text while `Images/logo.jpeg` (a full elephant / tree-of-life mark)
  is used only as the favicon. Worth deciding whether it belongs in the header.
- **Product names and prices are injected at runtime**, so they are not in the raw
  HTML for crawlers that do not run JavaScript. Google does run it, and titles,
  meta descriptions and `alt` text carry the names. A build step would remove the
  tradeoff and could replace `tools/sync-header.js` at the same time.
- `quartz-4` to `quartz-6` are off the site but still listed in `JS/catalog.js`,
  which is why the live quartz products are numbered 1-3 and 7-9. Ids are
  permanent keys, not display order — see the comment in `JS/catalog.js`.
- `future-payments/README.md` lists five issues in the parked Stripe code,
  including one that trusts client-supplied prices and one that breaks webhook
  signature verification. All out of scope until payments are switched on.
