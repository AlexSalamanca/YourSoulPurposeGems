// POST /api/submit-order
//
// The no-payment path: a pickup order the customer wants to settle with cash or
// e-transfer. Takes the cart + customer details from cart.html and emails the
// order to the shop owner.
//
// Card payments do NOT come through here — they go to
// api/create-payment-link.js, and the notification email is sent by
// api/webhook.js once Square confirms the money arrived. Accepting 'card' here
// would email an order that nobody ever charged.
//
// Required environment variable on Vercel:
//   RESEND_API_KEY   your Resend API key
// Optional:
//   ORDER_EMAIL_TO   where orders are sent (default: yoursoulpurposegems@gmail.com)
//   ORDER_EMAIL_FROM sender address (default: orders@yoursoulpurposegems.com)

const TAX = require('../JS/tax');
const { validateOrder } = require('../JS/order');
const { sendOrderEmail, placedAtPacific } = require('../JS/order-email');

// A person needs longer than this to read the cart and type their details. Scripts
// that POST the moment the page loads do not. Deliberately generous — the cost of
// a false positive is a lost order.
const MIN_FILL_MS = 3000;

// Cash and e-transfer only. See the note at the top of the file.
const ALLOWED_PAYMENTS = ['etransfer', 'cash'];

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

    if (!process.env.RESEND_API_KEY) {
        console.error('RESEND_API_KEY is not configured');
        return res.status(500).json({ error: 'Email service is not configured' });
    }

    try {
        // Vercel parses JSON bodies for us, but be tolerant of a raw string.
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

        // Bot checks come before validation so a flood costs us nothing but a 200
        // and no email. Both answer with success on purpose: telling a bot why it
        // was rejected just teaches it what to change.
        if (looksAutomated(body)) {
            console.warn('Discarded a likely automated submission', {
                honeypot: !!body.website,
                elapsedMs: body.elapsedMs
            });
            return res.status(200).json({
                success: true,
                message: 'Order request submitted successfully',
                orderNumber: `YSPG-${Date.now()}`
            });
        }

        const validation = validateOrder(body, ALLOWED_PAYMENTS);
        if (validation.error) {
            return res.status(400).json({ error: validation.error });
        }

        const { items, customerInfo } = validation;
        // Recomputed here from catalog prices via the same module the cart page
        // uses, so the emailed total always matches what the customer was shown.
        const totals = TAX.calculate(items);
        const orderNumber = `YSPG-${Date.now()}`;

        const { error } = await sendOrderEmail({
            orderNumber,
            placedAt: placedAtPacific(),
            customerInfo,
            items,
            totals,
            paid: false
        });

        if (error) {
            console.error('Resend rejected the order email:', error);
            return res.status(502).json({ error: 'Could not send the order email' });
        }

        return res.status(200).json({
            success: true,
            message: 'Order request submitted successfully',
            orderNumber
        });
    } catch (error) {
        console.error('Error submitting order:', error);
        return res.status(500).json({ error: 'Failed to submit order' });
    }
};

// Cheap, dependency-free bot signals. Neither is real rate limiting — a determined
// attacker can defeat both — but together they stop the drive-by form spam that
// makes up almost all of it. Per-IP throttling needs shared state; see the README.
function looksAutomated(body) {
    // 1. Honeypot: a field hidden from people that bots fill in anyway.
    if (typeof body.website === 'string' && body.website.trim() !== '') return true;

    // 2. Timing: submitted faster than a person could fill the form in.
    //    Must be strictly positive to count as a signal. Number(null) is 0, so
    //    `>= 0` here rejected real orders whose timing field arrived as null —
    //    an old cached page or a privacy tool stripping the value is enough to
    //    cause that. A lost order costs far more than a spam email that slips
    //    through, and the honeypot still covers this case.
    const elapsed = Number(body.elapsedMs);
    if (Number.isFinite(elapsed) && elapsed > 0 && elapsed < MIN_FILL_MS) return true;

    return false;
}
