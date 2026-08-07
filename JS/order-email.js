// Builds and sends the order notification to the shop owner.
//
// One renderer covers both paths so a paid card order and a cash pickup request
// arrive in the same shape:
//   api/submit-order.js  paid: false — nothing has been collected yet
//   api/webhook.js       paid: true  — Square has already taken the money
//
// Not under api/, so Vercel does not route it as a function — it is bundled
// into the ones that require it. Node-only: never add a <script src> tag for
// it, and never put a key in it, since /JS/ is served publicly.

const { Resend } = require('resend');
const { PAYMENT_LABELS, formatAddress } = require('./order');

const DEFAULT_TO = 'yoursoulpurposegems@gmail.com';
// Sends from the shop's own verified domain, so orders can be delivered to any
// address. This must stay a domain that is verified in Resend — an unverified one
// makes every send fail. ORDER_EMAIL_FROM overrides it without a code change.
const DEFAULT_FROM = 'Your Soul Purpose Gems <orders@yoursoulpurposegems.com>';

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

function placedAtPacific() {
    return new Date().toLocaleString('en-CA', { timeZone: 'America/Vancouver' });
}

// Sends the notification and reports whether it worked. Callers decide what a
// failure means: the email endpoint fails the request, the webhook logs loudly
// and still 200s so Square stops retrying a payment that already succeeded.
async function sendOrderEmail(payload) {
    if (!process.env.RESEND_API_KEY) {
        return { error: new Error('RESEND_API_KEY is not configured') };
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { orderNumber, customerInfo, paid } = payload;

    const { error } = await resend.emails.send({
        from: process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
        to: process.env.ORDER_EMAIL_TO || DEFAULT_TO,
        // camelCase: the SDK maps replyTo -> reply_to itself and silently drops
        // an unrecognised reply_to key.
        replyTo: customerInfo.email,
        subject: `${paid ? 'PAID order' : 'New order request'} - ${customerInfo.name} - ${orderNumber}`,
        html: renderOrderHtml(payload),
        text: renderOrderText(payload)
    });

    // Resend returns errors in the body rather than throwing.
    return { error: error || null };
}

function nextSteps(customerInfo, paid) {
    const handover = customerInfo.deliveryMethod === 'pickup' ? 'pickup' : 'delivery';

    if (paid) {
        return [
            `Payment is already collected — nothing to chase.`,
            `Contact the customer via WhatsApp at ${customerInfo.phone} to confirm ${handover}.`,
            customerInfo.deliveryMethod === 'delivery'
                ? 'Ship to the address above and send the tracking number.'
                : 'Agree a pickup time and place.'
        ];
    }

    return [
        `Contact the customer via WhatsApp at ${customerInfo.phone}`,
        customerInfo.paymentMethod === 'cash'
            ? 'Confirm the cash total to bring to the pickup'
            : 'Send your e-transfer details and wait for the payment to land',
        'Agree a pickup time and place',
        'Send the invoice once payment is confirmed'
    ];
}

function renderOrderHtml(payload) {
    const { orderNumber, placedAt, customerInfo, items, totals, paid } = payload;
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

    const addressBlock = customerInfo.address ? `
                <p style="margin:12px 0 4px;"><strong>Delivery address:</strong></p>
                <p style="margin:0;white-space:pre-line;">${esc(formatAddress(customerInfo.address))}</p>
    ` : '';

    const paymentBanner = paid
        ? `<div style="background:#dcfce7;border-left:4px solid #16a34a;padding:16px;margin:0 0 20px;">
               <strong>Paid in full.</strong> Square has collected ${money(totals.total)} CAD for this order.
           </div>`
        : `<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:16px;margin:0 0 20px;">
               <strong>No payment has been taken.</strong> The customer chose
               ${esc(PAYMENT_LABELS[customerInfo.paymentMethod] || customerInfo.paymentMethod)}.
           </div>`;

    const steps = nextSteps(customerInfo, paid)
        .map((step, i) => `<p style="margin:4px 0;">${i + 1}. ${esc(step)}</p>`)
        .join('');

    return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#333;">
    <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#6B46C1 0%,#9333EA 100%);color:#fff;padding:30px;text-align:center;border-radius:10px 10px 0 0;">
            <h1 style="margin:0;font-size:24px;">${paid ? 'Paid Order' : 'New Order Request'}</h1>
            <p style="margin:8px 0 0;">Order ${esc(orderNumber)}</p>
        </div>

        <div style="background:#f9f9f9;padding:30px;">
            ${paymentBanner}

            <div style="background:#fff;padding:20px;border-radius:5px;margin-bottom:20px;">
                <h2 style="margin-top:0;font-size:18px;">Customer Information</h2>
                <p style="margin:4px 0;"><strong>Name:</strong> ${esc(customerInfo.name)}</p>
                <p style="margin:4px 0;"><strong>Email:</strong> ${esc(customerInfo.email)}</p>
                <p style="margin:4px 0;"><strong>Phone:</strong> ${esc(customerInfo.phone)}</p>
                <p style="margin:4px 0;"><strong>Preference:</strong> ${customerInfo.deliveryMethod === 'pickup' ? 'Pickup' : 'Delivery'}</p>
                <p style="margin:4px 0;"><strong>Payment:</strong> ${esc(PAYMENT_LABELS[customerInfo.paymentMethod] || customerInfo.paymentMethod)}</p>
                ${addressBlock}
                <p style="margin:12px 0 4px;"><strong>Submitted:</strong> ${esc(placedAt)} (Pacific)</p>
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
                        <td style="padding:15px;text-align:right;">${money(totals.total)} CAD</td>
                    </tr>
                </tbody>
            </table>

            ${unverifiedNotice}

            <div style="background:#fff;border-left:4px solid #6B46C1;padding:20px;">
                <h3 style="margin-top:0;font-size:16px;">Next Steps</h3>
                ${steps}
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

function renderOrderText(payload) {
    const { orderNumber, placedAt, customerInfo, items, totals, paid } = payload;

    const lines = items.map(item =>
        `  ${item.quantity} x ${item.name} @ ${money(item.price)} = ${money(item.price * item.quantity)}${item.verified ? '' : '  [unverified price]'}`
    );

    const pad = label => `${label}:`.padEnd(12);

    const addressLines = customerInfo.address
        ? ['', 'DELIVERY ADDRESS', '----------------', formatAddress(customerInfo.address)]
        : [];

    return [
        paid ? 'PAID ORDER' : 'NEW ORDER REQUEST',
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
        `Payment:    ${PAYMENT_LABELS[customerInfo.paymentMethod] || customerInfo.paymentMethod}`,
        ...addressLines,
        '',
        'ITEMS',
        '-----',
        ...lines,
        '',
        `  ${pad('Subtotal')}${money(totals.subtotal)}`,
        ...totals.taxes.map(tax => `  ${pad(tax.labelEn)}${money(tax.amount)}`),
        `  ${pad('TOTAL')}${money(totals.total)} CAD`,
        '',
        'NEXT STEPS',
        '----------',
        ...nextSteps(customerInfo, paid).map((step, i) => `  ${i + 1}. ${step}`)
    ].join('\n');
}

module.exports = { sendOrderEmail, renderOrderHtml, renderOrderText, placedAtPacific, money, esc };
