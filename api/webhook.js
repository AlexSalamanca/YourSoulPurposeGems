// POST /api/webhook
//
// Square calls this when a payment changes state. It is the only place a card
// order turns into an email, because it is the only place we know the money
// actually arrived — the browser returning to success.html proves nothing.
//
// Required environment variables — see JS/square.js. In particular
// SQUARE_WEBHOOK_URL must match the URL registered below character for
// character, because Square signs that string together with the body.
//
// Set the subscription up in the Square Developer dashboard:
//   Webhooks -> Subscriptions -> Add
//   URL     https://www.yoursoulpurposegems.com/api/webhook
//   Events  payment.updated
//
// Sandbox and production have separate subscriptions and separate signature
// keys. Testing against the wrong one fails every signature check.

const TAX = require('../JS/tax');
const { resolveItems } = require('../JS/order');
const { sendOrderEmail, placedAtPacific } = require('../JS/order-email');
const { squareRequest, verifyWebhookSignature } = require('../JS/square');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let event;
    try {
        const rawBody = await readRawBody(req);
        verifyWebhookSignature(rawBody, req.headers['x-square-hmacsha256-signature']);
        event = JSON.parse(rawBody.toString('utf8'));
    } catch (error) {
        // A 400 tells Square not to retry: a body we cannot verify will not
        // verify on the second attempt either.
        console.error('Webhook signature verification failed:', error.message);
        return res.status(400).json({ error: 'Invalid signature' });
    }

    // payment.updated fires on every state change — APPROVED, COMPLETED,
    // CANCELED, FAILED. Only a completed one is money in the account.
    const payment = event?.data?.object?.payment;
    if (event?.type !== 'payment.updated' || !payment) {
        return res.status(200).json({ received: true });
    }

    if (payment.status !== 'COMPLETED') {
        console.log(`Payment ${payment.id} is ${payment.status}; no email sent.`);
        return res.status(200).json({ received: true });
    }

    try {
        await notify(payment);
    } catch (error) {
        // The customer has already been charged. Retrying the whole webhook
        // would risk a duplicate email without fixing anything, so log loudly
        // and acknowledge — the payment is still visible in the Square
        // dashboard, which is the fallback record.
        console.error(`ORDER EMAIL FAILED for completed payment ${payment.id}:`, error);
    }

    return res.status(200).json({ received: true });
};

// Signature verification hashes the exact bytes Square sent, so the body must
// not be parsed before we see it. Vercel's Node runtime reads this off the
// module, so it has to be attached after the handler assignment above — setting
// it first would be wiped out by it.
module.exports.config = {
    api: { bodyParser: false }
};

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
function decodeOrderContext(metadata) {
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
function decodeItems(encoded) {
    return String(encoded)
        .split(',')
        .filter(Boolean)
        .map(part => {
            const separator = part.lastIndexOf(':');
            return { id: part.slice(0, separator), quantity: Number(part.slice(separator + 1)) };
        });
}

async function readRawBody(req) {
    // If bodyParser was not disabled, Vercel hands us a parsed object and the
    // stream is spent. Say so plainly rather than failing on a signature
    // mismatch that looks like a wrong key.
    if (req.body !== undefined && !Buffer.isBuffer(req.body) && typeof req.body !== 'string') {
        throw new Error('Request body was parsed before verification — the bodyParser:false config is not taking effect');
    }
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');

    // Buffered as binary, not concatenated as a string: a string join splits
    // multi-byte characters across chunk boundaries and corrupts the hash.
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    }
    return Buffer.concat(chunks);
}
