// POST /api/submit-order
//
// Takes the cart + customer details from cart.html and emails the order to the
// shop owner. No payment is taken here — that lands in a future release (see
// future-payments/).
//
// Required environment variable on Vercel:
//   RESEND_API_KEY   your Resend API key
// Optional:
//   ORDER_EMAIL_TO   where orders are sent (default: yoursoulpurposegems@gmail.com)
//   ORDER_EMAIL_FROM verified sender (default: Resend's shared onboarding sender)

const { Resend } = require('resend');
const { CATALOG } = require('../JS/catalog');
const TAX = require('../JS/tax');

const MAX_ITEMS = 50;
const MAX_QUANTITY = 99;
// A person needs longer than this to read the cart and type their details. Scripts
// that POST the moment the page loads do not. Deliberately generous — the cost of
// a false positive is a lost order.
const MIN_FILL_MS = 3000;
const DEFAULT_TO = 'yoursoulpurposegems@gmail.com';
// onboarding@resend.dev works without domain verification but can only deliver
// to the address that owns the Resend account. Swap in orders@<your-domain>
// via ORDER_EMAIL_FROM once the domain is verified.
const DEFAULT_FROM = 'Your Soul Purpose Gems <onboarding@resend.dev>';

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

        const validation = validateOrder(body);
        if (validation.error) {
            return res.status(400).json({ error: validation.error });
        }

        const { items, customerInfo } = validation;
        // Recomputed here from catalog prices via the same module the cart page
        // uses, so the emailed total always matches what the customer was shown.
        const totals = TAX.calculate(items);
        const orderNumber = `YSPG-${Date.now()}`;
        const placedAt = new Date().toLocaleString('en-CA', { timeZone: 'America/Vancouver' });

        const resend = new Resend(process.env.RESEND_API_KEY);
        const payload = { orderNumber, placedAt, customerInfo, items, totals };

        const { error } = await resend.emails.send({
            from: process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
            to: process.env.ORDER_EMAIL_TO || DEFAULT_TO,
            // camelCase: the SDK maps replyTo -> reply_to itself and silently
            // drops an unrecognised reply_to key.
            replyTo: customerInfo.email,
            subject: `New order request - ${customerInfo.name} - ${orderNumber}`,
            html: renderOrderHtml(payload),
            text: renderOrderText(payload)
        });

        if (error) {
            // Resend returns errors in the body rather than throwing.
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

// ============================================
// VALIDATION
// ============================================

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

function validateOrder(body) {
    const { items, customerInfo } = body;

    if (!Array.isArray(items) || items.length === 0) {
        return { error: 'No items provided' };
    }
    if (items.length > MAX_ITEMS) {
        return { error: 'Too many items in the order' };
    }
    if (!customerInfo || typeof customerInfo !== 'object') {
        return { error: 'Customer information required' };
    }

    const name = trim(customerInfo.name, 120);
    const email = trim(customerInfo.email, 200);
    const phone = trim(customerInfo.phone, 40);
    const deliveryMethod = customerInfo.deliveryMethod === 'delivery' ? 'delivery' : 'pickup';

    if (!name || !email || !phone) {
        return { error: 'Customer information required' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: 'A valid email address is required' };
    }
    if (customerInfo.deliveryMethod !== 'pickup' && customerInfo.deliveryMethod !== 'delivery') {
        return { error: 'Select a pickup or delivery preference' };
    }

    const cleanItems = [];
    for (const raw of items) {
        if (!raw || typeof raw !== 'object') {
            return { error: 'Invalid cart item' };
        }

        const id = trim(raw.id, 60);
        const quantity = Math.floor(Number(raw.quantity));

        if (!id) {
            return { error: 'Invalid cart item' };
        }
        if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
            return { error: `Invalid quantity for item "${id}"` };
        }

        const product = CATALOG[id];
        if (product) {
            cleanItems.push({ id, name: product.name, price: product.price, quantity, verified: true });
        } else {
            // Unknown id — keep the order rather than dropping it, but make it
            // obvious in the email that these figures came from the browser.
            const price = Number(raw.price);
            cleanItems.push({
                id,
                name: trim(raw.name, 200) || id,
                price: Number.isFinite(price) && price >= 0 ? price : 0,
                quantity,
                verified: false
            });
        }
    }

    return {
        items: cleanItems,
        customerInfo: { name, email, phone, deliveryMethod }
    };
}

function trim(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// ============================================
// EMAIL RENDERING
// ============================================

// Customer-supplied text lands in an HTML email, so escape it.
function esc(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function money(amount) {
    return `$${amount.toFixed(2)}`;
}

function renderOrderHtml({ orderNumber, placedAt, customerInfo, items, totals }) {
    const hasUnverified = items.some(item => !item.verified);

    const rows = items.map(item => `
        <tr>
            <td style="padding:10px;border-bottom:1px solid #eee;">${esc(item.name)}${item.verified ? '' : ' <span style="color:#b45309;">(unverified price)</span>'}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;">${money(item.price)}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;">${money(item.price * item.quantity)}</td>
        </tr>
    `).join('');

    const unverifiedNotice = hasUnverified ? `
        <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;margin:20px 0;">
            <strong>Heads up:</strong> one or more items were not found in the server-side
            catalog (JS/catalog.js), so their name and price came straight from the
            customer's browser. Confirm those figures before quoting.
        </div>
    ` : '';

    return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#333;">
    <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#6B46C1 0%,#9333EA 100%);color:#fff;padding:30px;text-align:center;border-radius:10px 10px 0 0;">
            <h1 style="margin:0;font-size:24px;">New Order Request</h1>
            <p style="margin:8px 0 0;">Order ${esc(orderNumber)}</p>
        </div>

        <div style="background:#f9f9f9;padding:30px;">
            <div style="background:#fff;padding:20px;border-radius:5px;margin-bottom:20px;">
                <h2 style="margin-top:0;font-size:18px;">Customer Information</h2>
                <p style="margin:4px 0;"><strong>Name:</strong> ${esc(customerInfo.name)}</p>
                <p style="margin:4px 0;"><strong>Email:</strong> ${esc(customerInfo.email)}</p>
                <p style="margin:4px 0;"><strong>Phone:</strong> ${esc(customerInfo.phone)}</p>
                <p style="margin:4px 0;"><strong>Preference:</strong> ${customerInfo.deliveryMethod === 'pickup' ? 'Pickup' : 'Delivery'}</p>
                <p style="margin:4px 0;"><strong>Submitted:</strong> ${esc(placedAt)} (Pacific)</p>
            </div>

            <h2 style="font-size:18px;">Order Items</h2>
            <table style="width:100%;border-collapse:collapse;margin:12px 0 20px;">
                <thead>
                    <tr>
                        <th style="background:#6B46C1;color:#fff;padding:12px;text-align:left;">Item</th>
                        <th style="background:#6B46C1;color:#fff;padding:12px;text-align:center;">Qty</th>
                        <th style="background:#6B46C1;color:#fff;padding:12px;text-align:right;">Price</th>
                        <th style="background:#6B46C1;color:#fff;padding:12px;text-align:right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                    <tr>
                        <td colspan="3" style="padding:10px 15px;text-align:right;">Subtotal:</td>
                        <td style="padding:10px 15px;text-align:right;">${money(totals.subtotal)}</td>
                    </tr>
                    ${totals.taxes.map(tax => `
                    <tr>
                        <td colspan="3" style="padding:10px 15px;text-align:right;">${esc(tax.labelEn)}:</td>
                        <td style="padding:10px 15px;text-align:right;">${money(tax.amount)}</td>
                    </tr>`).join('')}
                    <tr style="font-weight:bold;background:#f0f0f0;">
                        <td colspan="3" style="padding:15px;text-align:right;">TOTAL:</td>
                        <td style="padding:15px;text-align:right;">${money(totals.total)}</td>
                    </tr>
                </tbody>
            </table>

            ${unverifiedNotice}

            <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:20px;">
                <h3 style="margin-top:0;font-size:16px;">Next Steps</h3>
                <p style="margin:4px 0;">1. Contact the customer via WhatsApp at ${esc(customerInfo.phone)}</p>
                <p style="margin:4px 0;">2. Arrange payment (cash or e-transfer)</p>
                <p style="margin:4px 0;">3. Coordinate ${customerInfo.deliveryMethod === 'pickup' ? 'pickup' : 'delivery'} details</p>
                <p style="margin:4px 0;">4. Send the invoice once payment is confirmed</p>
            </div>
        </div>

        <div style="text-align:center;padding:20px;color:#666;font-size:13px;">
            <p style="margin:0;">Automated notification from Your Soul Purpose Gems</p>
            <p style="margin:4px 0 0;">Reply to this email to answer the customer directly.</p>
        </div>
    </div>
</body>
</html>`;
}

function renderOrderText({ orderNumber, placedAt, customerInfo, items, totals }) {
    const lines = items.map(item =>
        `  ${item.quantity} x ${item.name} @ ${money(item.price)} = ${money(item.price * item.quantity)}${item.verified ? '' : '  [unverified price]'}`
    );

    const pad = label => `${label}:`.padEnd(12);

    return [
        'NEW ORDER REQUEST',
        '=================',
        '',
        `Order:      ${orderNumber}`,
        `Submitted:  ${placedAt} (Pacific)`,
        '',
        'CUSTOMER',
        '--------',
        `Name:       ${customerInfo.name}`,
        `Email:      ${customerInfo.email}`,
        `Phone:      ${customerInfo.phone}`,
        `Preference: ${customerInfo.deliveryMethod === 'pickup' ? 'Pickup' : 'Delivery'}`,
        '',
        'ITEMS',
        '-----',
        ...lines,
        '',
        `  ${pad('Subtotal')}${money(totals.subtotal)}`,
        ...totals.taxes.map(tax => `  ${pad(tax.labelEn)}${money(tax.amount)}`),
        `  ${pad('TOTAL')}${money(totals.total)}`,
        '',
        'No payment was taken. Contact the customer to arrange payment and handover.'
    ].join('\n');
}
