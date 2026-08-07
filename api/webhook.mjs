// POST /api/webhook
//
// Square calls this when a payment changes state. It is the only place a card
// order turns into an email, because it is the only place we know the money
// actually arrived — the browser returning to success.html proves nothing.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS .mjs AND USES A Request/Response HANDLER
//
// Signature verification hashes the exact bytes Square sent, so the body must
// reach us unparsed. The legacy way to arrange that —
//   module.exports.config = { api: { bodyParser: false } }
// — is a Next.js pattern that Vercel's current Node runtime ignores. It was
// verified ignored in production: req.body arrived as a parsed object, the raw
// bytes were gone, and every webhook failed with "Invalid signature" while
// payments succeeded. Silent lost orders.
//
// Vercel's documented way to get a raw body is the Web-standard handler below,
// where `await request.arrayBuffer()` is the untouched payload. .mjs because
// package.json has no "type": "module" — the extension makes this one file ESM
// without disturbing the CommonJS modules it imports.
//
// Do not convert this back to a (req, res) handler.
// ---------------------------------------------------------------------------
//
// Required environment variables — see JS/square.js. In particular
// SQUARE_WEBHOOK_URL must match the URL registered in Square character for
// character, because Square signs that string together with the body.
//
// Set the subscription up in the Square Developer dashboard:
//   Webhooks -> Subscriptions -> Add
//   URL     https://www.yoursoulpurposegems.com/api/webhook
//   Events  payment.updated
//
// Sandbox and production have separate subscriptions and separate signature
// keys. Testing against the wrong one fails every signature check.

// Default imports, then destructure: these are CommonJS modules, and named
// imports from CJS depend on static analysis that does not always succeed.
import taxModule from '../JS/tax.js';
import orderModule from '../JS/order.js';
import orderEmailModule from '../JS/order-email.js';
import squareModule from '../JS/square.js';

const TAX = taxModule;
const { resolveItems } = orderModule;
const { sendOrderEmail, placedAtPacific } = orderEmailModule;
const { squareRequest, verifyWebhookSignature } = squareModule;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

// Only POST is exported, so every other method gets a 405 from the runtime.
export async function POST(request) {
    let event;
    try {
        // The untouched bytes. Not request.text() — hashing must not depend on
        // a decode/re-encode round trip.
        const rawBody = Buffer.from(await request.arrayBuffer());
        verifyWebhookSignature(rawBody, request.headers.get('x-square-hmacsha256-signature'));
        event = JSON.parse(rawBody.toString('utf8'));
    } catch (error) {
        // A 400 tells Square not to retry: a body we cannot verify will not
        // verify on the second attempt either.
        console.error('Webhook signature verification failed:', error.message);
        return json({ error: 'Invalid signature' }, 400);
    }

    // payment.updated fires on every state change — APPROVED, COMPLETED,
    // CANCELED, FAILED. Only a completed one is money in the account.
    const payment = event?.data?.object?.payment;
    if (event?.type !== 'payment.updated' || !payment) {
        return json({ received: true });
    }

    if (payment.status !== 'COMPLETED') {
        console.log(`Payment ${payment.id} is ${payment.status}; no email sent.`);
        return json({ received: true });
    }

    try {
        await notify(payment);
        console.log(`Order email sent for payment ${payment.id}`);
    } catch (error) {
        // The customer has already been charged. Retrying the whole webhook
        // would risk a duplicate email without fixing anything, so log loudly
        // and acknowledge — the payment is still visible in the Square
        // dashboard, which is the fallback record.
        console.error(`ORDER EMAIL FAILED for completed payment ${payment.id}:`, error);
    }

    return json({ received: true });
}

async function notify(payment) {
    if (!payment.order_id) {
        throw new Error(`Payment ${payment.id} has no order_id, so there is nothing to look up`);
    }

    // The webhook carries the payment, not the order, and the cart lives in the
    // order's metadata — so fetch it.
    const { order } = await squareRequest(`/v2/orders/${encodeURIComponent(payment.order_id)}`);
    if (!order) {
        throw new Error(`Square returned no order for ${payment.order_id}`);
    }

    const context = decodeOrderContext(order.metadata || {});

    // Rebuilt from the ids and quantities we stored, through the same catalog
    // and tax modules the cart page used, rather than from Square's line items.
    const resolved = resolveItems(decodeItems(context.i));
    if (resolved.error) {
        throw new Error(`Could not rebuild the cart from metadata: ${resolved.error}`);
    }

    const totals = TAX.calculate(resolved.items);
    const chargedTotal = (payment.amount_money?.amount || 0) / 100;

    // If these disagree, something changed in catalog.js between the link being
    // created and the payment landing. The email still goes out; the warning
    // tells the shop owner which figure Square actually took.
    if (Math.abs(chargedTotal - totals.total) > 0.005) {
        console.warn(
            `Payment ${payment.id}: Square charged ${chargedTotal} but the catalog now totals ${totals.total}.`
        );
    }

    const address = context.a ? {
        line1: context.a.l1,
        line2: context.a.l2 || '',
        city: context.a.c,
        province: context.a.pr,
        postalCode: context.a.pc,
        country: context.a.co
    } : null;

    const { error } = await sendOrderEmail({
        orderNumber: order.reference_id || payment.order_id,
        placedAt: placedAtPacific(),
        customerInfo: {
            name: context.n || 'Unknown',
            email: context.e || payment.buyer_email_address || '',
            phone: context.p || '',
            deliveryMethod: context.d === 'delivery' ? 'delivery' : 'pickup',
            paymentMethod: 'card',
            address
        },
        items: resolved.items,
        totals,
        paid: true
    });

    if (error) throw error;
}

// create-payment-link.js packs the whole order context into one JSON blob split
// across d0, d1, ... — Square allows only 10 metadata pairs of 255 characters
// each. Concatenating in order rebuilds the original string, splits included.
export function decodeOrderContext(metadata) {
    let encoded = '';
    for (let i = 0; metadata[`d${i}`] !== undefined; i++) {
        encoded += metadata[`d${i}`];
    }

    if (!encoded) {
        throw new Error('Square order carries no d0 metadata — nothing to rebuild the order from');
    }

    let context;
    try {
        context = JSON.parse(encoded);
    } catch (e) {
        throw new Error(`Order metadata is not valid JSON (${encoded.length} chars reassembled): ${e.message}`);
    }

    if (!context || typeof context !== 'object' || typeof context.i !== 'string') {
        throw new Error('Order metadata is missing the item list');
    }

    return context;
}

// "bracelet-1:2,quartz-3:1" -> [{id, quantity}, ...]
export function decodeItems(encoded) {
    return String(encoded)
        .split(',')
        .filter(Boolean)
        .map(part => {
            const separator = part.lastIndexOf(':');
            return { id: part.slice(0, separator), quantity: Number(part.slice(separator + 1)) };
        });
}
