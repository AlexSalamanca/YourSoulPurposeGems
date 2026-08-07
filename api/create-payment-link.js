// POST /api/create-payment-link
//
// The card path. Builds a Square Checkout payment link from the cart and answers
// with the hosted-checkout URL for the browser to redirect to. Nothing is emailed
// here — api/webhook.js does that once Square confirms the money arrived, so an
// abandoned checkout never turns into an order in the shop owner's inbox.
//
// Prices come from JS/catalog.js, never from the request. The browser sends only
// ids and quantities; anything it claims about price is ignored.
//
// Because this is the same Square account used at the markets, an online sale
// lands in the same dashboard, deposits and tax reports as an in-person one.
//
// Required environment variables — see JS/square.js.
// Optional:
//   SITE_URL   canonical site origin, e.g. https://yoursoulpurposegems.com

const crypto = require('crypto');
const TAX = require('../JS/tax');
const { validateOrder } = require('../JS/order');
const { squareRequest, isProduction } = require('../JS/square');

const CURRENCY = 'CAD';
const ALLOWED_PAYMENTS = ['card'];

// Square caps an order metadata value at 255 characters and allows at most 10
// of them. See buildMetadata() for how the order context is packed to fit.
const METADATA_CHUNK = 240;
const METADATA_MAX_KEYS = 10;

// The redirect URL is echoed back from the request's Origin header, so only
// hosts the shop actually runs on are honoured. Otherwise someone could hand a
// customer a checkout link that returns them to a page of the attacker's
// choosing wearing the shop's Square branding.
const ALLOWED_HOSTS = [/(^|\.)yoursoulpurposegems\.com$/, /\.vercel\.app$/, /^localhost$/, /^127\.0\.0\.1$/];

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
        console.error('SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID must both be set');
        return res.status(500).json({ error: 'Card payment is not configured' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

        const validation = validateOrder(body, ALLOWED_PAYMENTS);
        if (validation.error) {
            return res.status(400).json({ error: validation.error });
        }

        const { items, customerInfo } = validation;

        // validateOrder() lets an id that is not in the catalog through with the
        // browser's own price, because the email path would rather flag a stale
        // line than lose the order. Charging one is a different matter: an id
        // nobody can price is an id nobody should be billed for.
        const unknown = items.filter(item => !item.verified).map(item => item.id);
        if (unknown.length) {
            console.error('Refusing to charge for items missing from the catalog:', unknown);
            return res.status(400).json({
                error: 'Some items are no longer available. Please refresh the page and try again.'
            });
        }

        // Same module the cart page uses, so the amount Square charges is the
        // one the customer read in the summary.
        const totals = TAX.calculate(items);
        const orderNumber = `YSPG-${Date.now()}`;

        const payload = await squareRequest('/v2/online-checkout/payment-links', {
            method: 'POST',
            body: {
                // One key per attempt. Square returns the original link rather
                // than creating a second one if the same key arrives twice.
                idempotency_key: crypto.randomUUID(),
                order: buildOrder({ orderNumber, customerInfo, items, totals }),
                checkout_options: {
                    redirect_url: `${safeOrigin(req)}/success.html`,
                    // The delivery address is collected on our own form, and
                    // asking again here would make the customer type it twice.
                    ask_for_shipping_address: false
                },
                pre_populated_data: prePopulated(customerInfo),
                payment_note: `${orderNumber} — ${customerInfo.deliveryMethod === 'delivery' ? 'DELIVERY' : 'Pickup'}`
            }
        });

        const url = payload.payment_link?.url;
        if (!url) {
            throw new Error('Square did not return a payment link URL');
        }

        // Square applies the tax percentages itself, so its arithmetic is the
        // one that gets charged. It should agree with JS/tax.js to the cent —
        // if it ever does not, this is where we find out rather than the
        // customer.
        const squareTotal = payload.related_resources?.orders?.[0]?.total_money?.amount;
        if (typeof squareTotal === 'number' && squareTotal !== Math.round(totals.total * 100)) {
            console.error(
                `Total mismatch on ${orderNumber}: the cart showed ${Math.round(totals.total * 100)} ` +
                `cents but Square will charge ${squareTotal}. Check the rates in JS/tax.js.`
            );
        }

        // Logged so a "the customer says they paid" question can be answered
        // from the Vercel logs alone. A payment link's order sits in DRAFT
        // until it is paid, and SearchOrders hides DRAFT unless asked for it —
        // so the id is worth recording rather than hunting for later.
        console.log(`Created ${orderNumber} — Square order ${payload.payment_link?.order_id}`);

        if (!isProduction()) {
            console.warn(`Square is in SANDBOX mode — ${orderNumber} will not take real money.`);
        }

        return res.status(200).json({ url, orderNumber });
    } catch (error) {
        console.error('Error creating the Square payment link:', error);
        // Square's messages can name internal configuration, so they are logged
        // rather than returned.
        return res.status(500).json({ error: 'Could not start the payment. Please try again.' });
    }
};

function buildOrder({ orderNumber, customerInfo, items, totals }) {
    return {
        location_id: process.env.SQUARE_LOCATION_ID,
        // Shows against the sale in the Square dashboard, so an order in the
        // inbox can be matched to a payment without digging.
        reference_id: orderNumber,
        line_items: items.map(item => ({
            name: item.name,
            // Square wants the quantity as a string.
            quantity: String(item.quantity),
            base_price_money: {
                amount: Math.round(item.price * 100),
                currency: CURRENCY
            }
        })),
        // GST and PST are declared as order-scoped percentages rather than
        // folded into the prices, so Square's own tax reporting is correct and
        // the customer's receipt itemises them. Both are charged on the
        // subtotal, neither on the other — the BC rule JS/tax.js implements.
        taxes: totals.taxes.map(tax => ({
            uid: tax.code,
            name: tax.labelEn,
            percentage: percentageString(tax.rate),
            scope: 'ORDER'
        })),
        metadata: buildMetadata({ customerInfo, items })
    };
}

// 0.05 -> "5". Going through toFixed first because 0.05 * 100 is
// 5.000000000000001 in binary floating point, and Square rejects that.
function percentageString(rate) {
    return String(Number((rate * 100).toFixed(6)));
}

// Square wants buyer_phone_number in E.164 ("+17785551234") and rejects the
// WHOLE request with INVALID_PHONE_NUMBER if it gets anything else — including
// "(778) 555-1234", which is exactly what the form's placeholder asks for. That
// failed every card order until it was caught against the live sandbox.
//
// Anything that cannot be normalised confidently is omitted rather than sent:
// prefilling the phone is a convenience, and it must never cost a sale. The
// number the customer typed still reaches the shop owner via the order
// metadata and the email, unchanged.
function e164(phone) {
    const raw = String(phone || '').replace(/[\s().-]/g, '');

    if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;

    const digits = raw.replace(/\D/g, '');
    // North American numbers, with or without the country code.
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

    return null;
}

function prePopulated(customerInfo) {
    const data = {
        buyer_email: customerInfo.email
    };

    const phone = e164(customerInfo.phone);
    if (phone) {
        data.buyer_phone_number = phone;
    } else {
        console.warn(`Could not normalise "${customerInfo.phone}" to E.164; leaving it off the checkout prefill.`);
    }

    if (customerInfo.address) {
        data.buyer_address = {
            address_line_1: customerInfo.address.line1,
            address_line_2: customerInfo.address.line2 || undefined,
            locality: customerInfo.address.city,
            administrative_district_level_1: customerInfo.address.province,
            postal_code: customerInfo.address.postalCode,
            country: customerInfo.address.country
        };
    }

    return data;
}

// Everything the webhook needs to rebuild the order, packed into one JSON blob
// split across d0, d1, ... — decoded by decodeOrderContext() in api/webhook.js.
//
// Square is strict here in three ways, all of which cost a rejected checkout:
//   - at most 10 key-value pairs per order component
//   - at most 255 characters per value
//   - no empty-string values (MISSING_REQUIRED_PARAMETER)
//
// A key per field breached the first limit at 11 keys. One chunked blob uses at
// most 7, never has an empty value (the JSON always has content), and leaves
// room for the cart to grow. Short field names and the caps below keep the
// worst case — a 50-line cart with every text field at its maximum — provably
// inside 10 chunks.
function buildMetadata({ customerInfo, items }) {
    const context = {
        n: cap(customerInfo.name, 80),
        e: cap(customerInfo.email, 120),
        p: cap(customerInfo.phone, 25),
        d: customerInfo.deliveryMethod,
        m: customerInfo.paymentMethod,
        i: items.map(item => `${item.id}:${item.quantity}`).join(',')
    };

    if (customerInfo.address) {
        context.a = {
            l1: cap(customerInfo.address.line1, 120),
            l2: cap(customerInfo.address.line2, 80),
            c: cap(customerInfo.address.city, 60),
            pr: customerInfo.address.province,
            pc: customerInfo.address.postalCode,
            co: customerInfo.address.country
        };
    }

    const parts = chunk(JSON.stringify(context), METADATA_CHUNK);

    // Unreachable given the caps above, but a silent overflow would mean an
    // order whose address the webhook cannot read — fail loudly instead.
    if (parts.length > METADATA_MAX_KEYS) {
        throw new Error(
            `Order context needs ${parts.length} metadata keys; Square allows ${METADATA_MAX_KEYS}`
        );
    }

    const metadata = {};
    parts.forEach((part, i) => { metadata[`d${i}`] = part; });
    return metadata;
}

function cap(value, maxLength) {
    return String(value == null ? '' : value).slice(0, maxLength);
}

function chunk(value, size) {
    const parts = [];
    for (let i = 0; i < value.length; i += size) {
        parts.push(value.slice(i, i + size));
    }
    return parts.length ? parts : [''];
}

function safeOrigin(req) {
    const configured = process.env.SITE_URL && process.env.SITE_URL.replace(/\/+$/, '');
    if (configured) return configured;

    const header = req.headers.origin;
    if (header) {
        try {
            const url = new URL(header);
            if (ALLOWED_HOSTS.some(pattern => pattern.test(url.hostname))) {
                return url.origin;
            }
        } catch (e) {
            /* fall through */
        }
        console.warn('Ignoring an unrecognised Origin header:', header);
    }

    return 'https://yoursoulpurposegems.com';
}
