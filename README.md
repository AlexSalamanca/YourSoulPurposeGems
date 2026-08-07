# Your Soul Purpose Gems

Static storefront (plain HTML/CSS/JS) plus Vercel serverless functions for card
payment via [Square](https://squareup.com) and emailed order requests via
[Resend](https://resend.com).

Square rather than another processor because the shop already takes Square at
in-person markets: online and market sales then share one dashboard, one deposit
schedule and one set of tax reports, instead of needing reconciliation across
two processors at year end.

## How the order flow works

The customer picks how they receive the order and how they pay, and those two
choices decide the path:

| Preference | Payment | What happens |
|------------|---------|--------------|
| Pickup | Card | Square Checkout, then `/api/webhook` emails the paid order |
| Pickup | e-Transfer or cash | `/api/submit-order` emails the request; you arrange payment |
| Delivery | Card only | Square Checkout, then `/api/webhook` emails the paid order |

**Delivery is card-only.** Cash cannot be collected at a doorstep nobody
attends, and an e-transfer that never arrives would already have shipped. This
is enforced in `JS/order.js`, not just in the form.

### The card path

1. Customer adds items; the cart lives in `localStorage`.
2. On `cart.html` they fill in their details, choose **Pay now by card**, and the
   browser POSTs the item **ids and quantities** to `/api/create-payment-link`.
3. That function prices every line from `JS/catalog.js`, declares GST and PST
   from `JS/tax.js` as order-scoped taxes, and creates a Square payment link in
   **CAD**. The whole order context is packed into the Square order's
   `metadata` (see "Square's metadata limits" below).
4. The browser redirects to Square's hosted checkout. The site never touches
   card details.
5. On payment, Square calls `/api/webhook` with `payment.updated`. That verifies
   the signature, fetches the order to read its metadata, rebuilds the cart
   through the same catalog and tax modules, and emails it marked **PAID**.
6. The customer lands on `success.html?orderId=…&referenceId=YSPG-…`, which
   clears the cart.

Nothing is emailed when the link is *created* — only when Square confirms the
money arrived. An abandoned checkout leaves the cart intact and your inbox empty.

The sale carries `reference_id = YSPG-…`, so an order in your inbox can be
matched to a payment in the Square dashboard without digging.

### The request path

1. Same form, but **Interac e-Transfer** or **Cash on pickup** (pickup only).
2. The browser POSTs the cart to `/api/submit-order`, which validates it,
   resolves prices from `JS/catalog.js`, and emails you the request.
   `Reply-To` is set to the customer, so replying in your inbox reaches them.
3. The customer is redirected to `success.html?order=YSPG-…`.

### Prices are never trusted from the browser

Every line is looked up by `data-id` in `JS/catalog.js`.

On the **email** path an unknown id still gets through at its last known price,
flagged `(unverified price)` so you know to check it — nothing is being charged,
and a flagged line beats a lost order. On the **card** path an unknown id is
refused with a 400: an id nobody can price is an id nobody should be billed for.

### Delivery addresses

Choosing **Delivery** reveals the address fields. The shop ships **within Canada
only**, so the country selector offers Canada or "Outside Canada"; picking the
latter shows a warning that delivery costs outside Canada are not included in
the prices shown and would be added to the final total, points the customer at
`contact.html`, and blocks the order. `JS/order.js` rejects any non-`CA`
country server-side too. Province and postal-code format are both validated.

To start shipping elsewhere, add the country to `SHIPPING_COUNTRIES` in
`JS/order.js`, add it to the `#addressCountry` selector in `cart.html`, and
decide what to charge for it — there is currently **no shipping fee anywhere in
the code**, so a delivery order is billed exactly the same as a pickup one.

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
JS/order.js                              order validation, shared by both APIs
JS/order-email.js                        the notification email, shared by both
JS/square.js                             Square REST client + webhook signature
api/submit-order.js                      cash / e-transfer requests -> email
api/create-payment-link.js               card orders -> Square Checkout
api/webhook.js                           Square payment confirmed -> email
partials/header.html                     the one copy of the site header
tools/sync-header.js                     copies that header into every page
```

**Every JavaScript file lives in `JS/`.** That is the project convention — new
ones go there too, never in a new top-level folder.

Only files under the top-level `api/` directory become serverless functions on
Vercel, and that name is case-sensitive. `JS/` sits outside it deliberately —
shared code, not endpoints — and must **not** be added to `.vercelignore` or the
functions fail on import.

### Which JS files run where

| File | Browser | Node (API) |
|------|---------|------------|
| `script.js` | yes | no |
| `catalog.js`, `tax.js` | yes | yes — they detect `module.exports` and export both ways |
| `order.js`, `order-email.js`, `square.js` | **no** | yes |

The last three are Node-only: they `require` built-ins and npm packages, so a
`<script src>` tag pointing at one would throw. Nothing links to them, but do
not add one.

Because `JS/` is served as static files, those three are also **publicly
fetchable** at `https://…/JS/order.js`. They contain no secrets — every
credential is read from `process.env` at runtime and never appears in the source
— but the validation rules are readable by anyone who looks. See Known gaps if
you want them blocked.

## Setup

```bash
npm install
```

Then set the environment variables — locally in `.env.local`, and on Vercel
under **Project → Settings → Environment Variables**. See `.env.example`.

| Variable | Required | Notes |
|----------|----------|-------|
| `RESEND_API_KEY` | yes | From https://resend.com/api-keys |
| `SQUARE_ENVIRONMENT` | for card | Only the exact string `production` takes real money |
| `SQUARE_ACCESS_TOKEN` | for card | Developer dashboard → your app → Credentials |
| `SQUARE_LOCATION_ID` | for card | Which location the sale is booked against |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | for card | Shown when you create the subscription |
| `SQUARE_WEBHOOK_URL` | for card | Must match the registered URL character for character |
| `SITE_URL` | no | Origin Square returns to. Falls back to the request's `Origin` |
| `ORDER_EMAIL_TO` | no | Defaults to `yoursoulpurposegems@gmail.com` |
| `ORDER_EMAIL_FROM` | no | Defaults to `orders@yoursoulpurposegems.com` |

Without the Square variables the card option returns a 500 and the cash /
e-transfer path keeps working, so the site does not go down while you set them up.

There is **no Square SDK dependency** — `JS/square.js` calls the REST API with
`fetch`. The SDK has restructured its surface more than once, so pinning to it
means the integration breaks on a major upgrade; the REST API underneath is
pinned by the `Square-Version` header in that file instead.

### Square's metadata limits

The webhook rebuilds the order from the Square order's `metadata`, and Square
constrains that harder than it first appears. All three of these reject the
entire checkout with a 400, so each one was a payment that could not be taken:

| Limit | What broke |
|-------|-----------|
| Max **10** key-value pairs | A key per field came to 11 |
| Max **255** chars per value | — |
| **No empty-string values** | `shipping_line2` is empty for anyone without an apartment |

So `buildMetadata()` packs everything into one JSON blob with short keys and
splits it across `d0`, `d1`, … at 240 characters. A typical order uses one or
two keys; the field caps in that function bound the worst case — a 50-line cart
with every text field maxed — well inside 10. `decodeOrderContext()` in
`api/webhook.js` reverses it. **Change one and you must change the other.**

Square also requires `pre_populated_data.buyer_phone_number` in E.164
(`+17785551234`) and rejects the whole request otherwise — including
`(778) 555-1234`, which is exactly what the cart form's placeholder asks for.
`e164()` normalises it, and omits the prefill entirely if it cannot: a
convenience field must never cost a sale.

A payment link's order stays in `DRAFT` until it is paid, and `SearchOrders`
does not return `DRAFT` orders. To find one, use the id logged as
`Created YSPG-… — Square order …` and call `GET /v2/orders/{id}`.

### The site lives on `www` — this matters more than it looks

Production is **`https://www.yoursoulpurposegems.com`**. The bare apex,
`yoursoulpurposegems.com`, is served by a **different host entirely** and
returns 404 for every path in this project.

That already cost one silent failure: the Square webhook was registered against
the apex, so every paid order was POSTed to that other server, got a 404, and no
email was ever sent. Payments succeeded; notifications vanished.

Three values must carry `www`, and the first two must match each other exactly:

| Where | Value |
|-------|-------|
| Square subscription URL | `https://www.yoursoulpurposegems.com/api/webhook` |
| `SQUARE_WEBHOOK_URL` | `https://www.yoursoulpurposegems.com/api/webhook` |
| `SITE_URL` | `https://www.yoursoulpurposegems.com` |

Square signs the notification URL together with the request body, so the first
two differing by so much as a `www` fails every event — and the failure is
invisible unless you read Square's delivery log.

Pointing the apex at this project as a redirect would remove the whole class of
problem. Until then, treat `www` as part of the domain.

### Square setup

Everything here exists twice — once for sandbox, once for production. The values
are **not interchangeable**, and mixing them is the most common reason a webhook
signature fails.

1. At https://developer.squareup.com/apps, create an application against the
   same Square account used at the markets. Take the **sandbox access token**
   from Credentials.
2. Take the **location id** from Locations (or `GET /v2/locations`).
3. Add the webhook subscription under **Webhooks → Subscriptions**:
   - URL `https://www.yoursoulpurposegems.com/api/webhook`
   - Event `payment.updated`
4. Copy the **signature key** into `SQUARE_WEBHOOK_SIGNATURE_KEY`, and put the
   exact same URL into `SQUARE_WEBHOOK_URL`. Square signs that string together
   with the request body, so a trailing slash or an `http`/`https` mismatch
   fails every event.
5. Leave `SQUARE_ENVIRONMENT=sandbox` and place a test order with one of
   [Square's sandbox test cards](https://developer.squareup.com/docs/devtools/sandbox/payments)
   (`4111 1111 1111 1111`, any future expiry, any CVV, postal `94103`). Confirm
   the PAID email arrives — **the webhook is the only thing that sends it**, so
   if it is misconfigured you take money and never hear about the order.
6. Swap in the production token, location id and signature key, set
   `SQUARE_ENVIRONMENT=production`, and repeat step 5 with a real card. Refund it
   from the dashboard afterwards.

Sandbox payments never appear in the production dashboard or vice versa. Check
which set of credentials is live before concluding a payment is missing.

`SQUARE_ENVIRONMENT` defaults to sandbox when unset, empty or misspelled. That
is deliberate: the failure mode of a typo is then taking fake money, which you
notice, rather than taking real money, which you might not.

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

This serves the pages and the functions together, so `/api/submit-order` and
`/api/create-payment-link` work. A plain static server will serve the pages
but every order submission will fail.

The webhook cannot be tested this way, because Square has to reach the URL from
the internet and cannot see `localhost`. Either use a tunnel (`ngrok http 3000`)
and register the tunnel's URL as **both** the subscription URL and
`SQUARE_WEBHOOK_URL`, or test the webhook on a Vercel preview deployment
instead. The developer dashboard's **Send test event** button is the quickest
way to check signature verification once the URL is reachable.

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

Two cheap checks, both in `api/submit-order.js`, both dependency-free. They guard
the **email** path only: the card path costs an attacker a real payment, which is
its own rate limit.

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
rather than compounded. That one file is loaded by the cart page (as
`window.TAX`) and by all three API functions (as a `require`), so what the
customer sees, what Square charges and what the order email says can never drift
apart. All money is handled in integer cents, so the displayed rows always add up
to the displayed total.

To change the rates, edit only that file. Setting a rate to `0` removes its row
from the cart, the Square checkout and the email; setting `ENABLED = false`
removes tax entirely.

Square is sent each tax as an **order-scoped percentage** ("GST (5%)" at 5%,
"PST (7%)" at 7%) rather than a pre-computed amount, so Square's own tax
reporting is correct and the customer's receipt itemises them the same way an
in-person market receipt does.

That does mean Square performs the final arithmetic, not `JS/tax.js`. Both round
half-up on integer cents from the same subtotal, so they should agree exactly —
and `api/create-payment-link.js` compares its own total against the one Square
returns and logs an error if they ever differ. **If you also configure tax rates
against the location in the Square dashboard, remove the `taxes` block in that
file** or customers get charged tax twice.

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
- **Decide what delivery costs.** There is no shipping fee anywhere in the code,
  so a delivery order is billed exactly the same as a pickup one. If postage
  should be charged, it needs a line item in `api/create-payment-link.js` and
  a matching row in the cart summary.
- **The webhook is not idempotent.** Square retries a delivery it did not get a
  `200` for, and `payment.updated` can legitimately fire more than once for the
  same payment. Either sends the notification email a second time. It cannot
  double-charge anyone — worst case is a duplicate email — but deduplicating by
  `event_id` needs shared state (Vercel KV or Upstash), the same piece rate
  limiting wants.
- **Terms and a refund policy.** Taking card payments raises questions the site
  does not currently answer anywhere: what happens if an item arrives broken,
  how long delivery takes, whether returns are accepted.
- **`JS/order.js`, `JS/order-email.js` and `JS/square.js` are publicly
  fetchable**, because everything under `JS/` is served as a static file. No
  credentials are exposed — all of them are read from `process.env` — but the
  order validation rules can be read by anyone. To block them, add a route to
  `vercel.json`:

  ```json
  {
    "cleanUrls": false,
    "routes": [
      { "src": "/JS/(order|order-email|square)\\.js", "status": 404 },
      { "handle": "filesystem" }
    ]
  }
  ```

  Test that on a preview deployment before promoting it — a malformed `routes`
  array can stop the rest of the site being served.
- **Inventory is not tracked.** Square knows what was sold online but the site
  does not know what is left, so a one-off piece can be bought twice. Square's
  Catalog and Inventory APIs could drive this, which would also let
  `JS/catalog.js` stop being the price source — a larger change worth doing only
  if double-selling actually happens.

The parked `future-payments/` folder was removed: it held an early Stripe
attempt whose README listed five known defects. The live Square code addresses
all of them — prices resolved server-side, currency `CAD`, raw body buffered as
binary for signature verification, `ORDER_EMAIL_TO` honoured, and email failures
logged rather than swallowed. Git history has the originals.
