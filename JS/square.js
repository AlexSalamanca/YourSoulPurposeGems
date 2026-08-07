// A small Square client built on fetch, rather than the `square` npm package.
//
// Two reasons. The SDK has restructured its surface more than once (Client ->
// SquareClient, checkoutApi -> checkout.paymentLinks), so pinning to it means
// the integration breaks on a major upgrade; and it is a large dependency for
// the three calls this site makes. The REST API underneath is versioned by the
// Square-Version header below and is stable.
//
// Node 18+ has global fetch — see "engines" in package.json.
//
// Node-only, despite living in JS/ alongside the browser scripts: it requires
// `crypto` and would throw in a page. /JS/ is served publicly, so every
// credential below is read from process.env at runtime and none is written
// here — keep it that way.
//
// Required environment variables:
//   SQUARE_ACCESS_TOKEN            access token for the environment below
//   SQUARE_LOCATION_ID             which location the sale is booked against
//   SQUARE_ENVIRONMENT             'production' to take real money.
//                                  ANY other value (or unset) means sandbox.
//   SQUARE_WEBHOOK_SIGNATURE_KEY   from the webhook subscription
//   SQUARE_WEBHOOK_URL             the exact URL registered in Square

const crypto = require('crypto');

// Square's API is versioned by date. Pin it: leaving it off means Square picks
// the account's default version, which can change under you without a deploy.
// Check the changelog before raising it.
const SQUARE_VERSION = '2025-01-23';

const PRODUCTION_HOST = 'https://connect.squareup.com';
const SANDBOX_HOST = 'https://connect.squareupsandbox.com';

// Sandbox is the default on purpose. A missing or misspelled environment
// variable then takes fake money instead of quietly taking real money — the
// failure that is easy to notice, rather than the one that is not.
function isProduction() {
    return process.env.SQUARE_ENVIRONMENT === 'production';
}

function apiHost() {
    return isProduction() ? PRODUCTION_HOST : SANDBOX_HOST;
}

async function squareRequest(path, { method = 'GET', body } = {}) {
    const token = process.env.SQUARE_ACCESS_TOKEN;
    if (!token) {
        throw new Error('SQUARE_ACCESS_TOKEN is not configured');
    }

    const response = await fetch(`${apiHost()}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Square-Version': SQUARE_VERSION,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        // Square reports problems as an `errors` array rather than a message,
        // and the detail is the only part worth reading in a log.
        const detail = (payload.errors || [])
            .map(e => `${e.category}/${e.code}: ${e.detail || ''}`.trim())
            .join('; ');
        const error = new Error(detail || `Square returned HTTP ${response.status}`);
        error.status = response.status;
        error.errors = payload.errors || [];
        throw error;
    }

    return payload;
}

// Square signs the notification URL concatenated with the raw body, so the URL
// registered in the dashboard has to match SQUARE_WEBHOOK_URL character for
// character — a trailing slash or http/https mismatch fails every event.
function verifyWebhookSignature(rawBody, signatureHeader) {
    const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    const url = process.env.SQUARE_WEBHOOK_URL;

    if (!key) throw new Error('SQUARE_WEBHOOK_SIGNATURE_KEY is not configured');
    if (!url) throw new Error('SQUARE_WEBHOOK_URL is not configured');
    if (!signatureHeader) throw new Error('Request has no x-square-hmacsha256-signature header');

    const hmac = crypto.createHmac('sha256', key);
    hmac.update(url, 'utf8');
    hmac.update(rawBody);
    const expected = hmac.digest();

    let provided;
    try {
        provided = Buffer.from(signatureHeader, 'base64');
    } catch (e) {
        throw new Error('Signature header is not valid base64');
    }

    // timingSafeEqual throws on a length mismatch, so check that first — and
    // compare rather than return early, to keep the comparison constant-time.
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        throw new Error('Signature does not match');
    }
}

module.exports = { squareRequest, verifyWebhookSignature, isProduction, SQUARE_VERSION };
