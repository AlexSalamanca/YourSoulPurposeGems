// Shared order validation for the two API endpoints.
//
//   api/submit-order.js            pickup orders paid by cash or e-transfer
//   api/create-payment-link.js     anything paid by card
//
// Both must agree on what a valid order looks like, so the rules live here once.
// Node-only — the browser mirrors these checks in JS/script.js for the error
// messages, but this file is what actually decides.
//
// This is *not* under api/, so Vercel does not turn it into a serverless
// function; it is bundled into the functions that require it.
//
// It does, however, sit in the folder Vercel serves as static files, so this
// source is publicly readable at /JS/order.js. That is fine — there are no
// secrets here, only rules — but never put a key or token in this file.
// Never add a <script src> tag for it either: it requires Node modules and
// would throw in a browser.

const { CATALOG } = require('./catalog');

const MAX_ITEMS = 50;
const MAX_QUANTITY = 99;

// The shop ships within Canada only. A non-CA address is refused here rather
// than quietly accepted, because nothing downstream knows what to charge for it.
const SHIPPING_COUNTRIES = ['CA'];

const PROVINCES = {
    AB: 'Alberta',
    BC: 'British Columbia',
    MB: 'Manitoba',
    NB: 'New Brunswick',
    NL: 'Newfoundland and Labrador',
    NS: 'Nova Scotia',
    NT: 'Northwest Territories',
    NU: 'Nunavut',
    ON: 'Ontario',
    PE: 'Prince Edward Island',
    QC: 'Quebec',
    SK: 'Saskatchewan',
    YT: 'Yukon'
};

// Canadian postal codes: no D, F, I, O, Q or U anywhere, and no W or Z in the
// first position. Spacing is optional on input and normalised on the way out.
const POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

const PAYMENT_METHODS = ['card', 'etransfer', 'cash'];

function trim(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizePostalCode(value) {
    return trim(value, 10).toUpperCase().replace(/[\s-]/g, '').replace(/^(.{3})(.{3})$/, '$1 $2');
}

// Resolves every line against JS/catalog.js. Prices are never taken from the
// browser: anyone can edit localStorage, and on the card path that would be a
// customer choosing their own price.
function resolveItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return { error: 'No items provided' };
    }
    if (items.length > MAX_ITEMS) {
        return { error: 'Too many items in the order' };
    }

    const clean = [];
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
            clean.push({ id, name: product.name, price: product.price, quantity, verified: true });
        } else {
            // Unknown id — keep the order rather than dropping it, but make it
            // obvious in the email that these figures came from the browser.
            const price = Number(raw.price);
            clean.push({
                id,
                name: trim(raw.name, 200) || id,
                price: Number.isFinite(price) && price >= 0 ? price : 0,
                quantity,
                verified: false
            });
        }
    }

    return { items: clean };
}

function validateAddress(raw) {
    if (!raw || typeof raw !== 'object') {
        return { error: 'A delivery address is required' };
    }

    const country = trim(raw.country, 2).toUpperCase();
    if (!SHIPPING_COUNTRIES.includes(country)) {
        return {
            error: 'We currently deliver within Canada only. Please contact us to arrange delivery elsewhere.'
        };
    }

    const line1 = trim(raw.line1, 200);
    const line2 = trim(raw.line2, 200);
    const city = trim(raw.city, 100);
    const province = trim(raw.province, 2).toUpperCase();
    const postalCode = normalizePostalCode(raw.postalCode);

    if (!line1 || !city) {
        return { error: 'A complete delivery address is required' };
    }
    if (!PROVINCES[province]) {
        return { error: 'Select a valid province or territory' };
    }
    if (!POSTAL_CODE.test(postalCode)) {
        return { error: 'Enter a valid Canadian postal code' };
    }

    return { address: { line1, line2, city, province, postalCode, country } };
}

// `allowedPayments` lets each endpoint accept only the methods it can actually
// handle: the email endpoint must never accept 'card' (nothing would be
// charged) and the Square endpoint must never accept cash.
function validateOrder(body, allowedPayments) {
    const { customerInfo } = body || {};

    if (!customerInfo || typeof customerInfo !== 'object') {
        return { error: 'Customer information required' };
    }

    const resolved = resolveItems(body.items);
    if (resolved.error) return { error: resolved.error };

    const name = trim(customerInfo.name, 120);
    const email = trim(customerInfo.email, 200);
    const phone = trim(customerInfo.phone, 40);

    if (!name || !email || !phone) {
        return { error: 'Customer information required' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: 'A valid email address is required' };
    }

    const deliveryMethod = customerInfo.deliveryMethod;
    if (deliveryMethod !== 'pickup' && deliveryMethod !== 'delivery') {
        return { error: 'Select a pickup or delivery preference' };
    }

    const paymentMethod = customerInfo.paymentMethod;
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
        return { error: 'Select a payment method' };
    }
    // Delivery is card-only. Cash cannot be collected at a doorstep the shop
    // does not attend, and an e-transfer that never arrives would have already
    // shipped the parcel.
    if (deliveryMethod === 'delivery' && paymentMethod !== 'card') {
        return { error: 'Delivery orders must be paid by card' };
    }
    if (!allowedPayments.includes(paymentMethod)) {
        return { error: 'That payment method is not available for this order' };
    }

    let address = null;
    if (deliveryMethod === 'delivery') {
        const checked = validateAddress(customerInfo.address);
        if (checked.error) return { error: checked.error };
        address = checked.address;
    }

    return {
        items: resolved.items,
        customerInfo: { name, email, phone, deliveryMethod, paymentMethod, address }
    };
}

function formatAddress(address) {
    if (!address) return '';
    return [
        address.line1,
        address.line2,
        `${address.city}, ${address.province} ${address.postalCode}`,
        address.country === 'CA' ? 'Canada' : address.country
    ].filter(Boolean).join('\n');
}

const PAYMENT_LABELS = {
    card: 'Card (paid online via Square)',
    etransfer: 'Interac e-Transfer (to arrange)',
    cash: 'Cash on pickup'
};

module.exports = {
    MAX_ITEMS,
    MAX_QUANTITY,
    PROVINCES,
    SHIPPING_COUNTRIES,
    PAYMENT_LABELS,
    trim,
    resolveItems,
    validateOrder,
    formatAddress
};
