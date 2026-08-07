// GET  /api/diagnose?token=yspg-diag-7f3a9c2e   what the running function sees
// POST /api/diagnose?token=yspg-diag-7f3a9c2e   whether the raw body survives
//
// TEMPORARY. Delete this file once the webhook is confirmed working.
//
// It reports NO secret values — only whether each variable is set, how long it
// is, and the non-secret ones (URLs, the commit sha) wrapped in >>><<< so
// trailing spaces and newlines are visible. Pasting a value into the Vercel UI
// with a stray newline is a common and completely invisible cause of a failing
// signature.
//
// The token is not real security, just a guard against casual discovery.

const crypto = require('crypto');

const TOKEN = 'yspg-diag-7f3a9c2e';

// Wraps a value so invisible characters become obvious.
function show(value) {
    if (value === undefined) return '(NOT SET)';
    if (value === '') return '(EMPTY STRING)';
    return `>>>${value}<<<`;
}

function describeSecret(value) {
    if (value === undefined) return '(NOT SET)';
    if (value === '') return '(EMPTY STRING)';
    const trailing = value !== value.trim();
    return `set, ${value.length} chars, ends "${value.slice(-4)}"${trailing ? '  ** HAS LEADING/TRAILING WHITESPACE **' : ''}`;
}

module.exports = async (req, res) => {
    // Read the token from req.query if Vercel populated it, otherwise from the
    // URL directly — do not assume the helper is there.
    let token = req.query?.token;
    if (token === undefined) {
        try {
            token = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams.get('token');
        } catch (e) {
            token = null;
        }
    }

    if (token !== TOKEN) {
        return res.status(404).json({ error: 'Not found' });
    }

    const env = process.env;
    const expectedWebhookUrl = 'https://www.yoursoulpurposegems.com/api/webhook';

    const report = {
        deployment: {
            commit: show(env.VERCEL_GIT_COMMIT_SHA),
            branch: show(env.VERCEL_GIT_COMMIT_REF),
            vercelEnv: show(env.VERCEL_ENV),
            // If this is not the commit you last pushed, the running code is
            // stale and no env change has taken effect either.
            note: 'commit must match your latest push'
        },

        square: {
            SQUARE_ENVIRONMENT: show(env.SQUARE_ENVIRONMENT),
            isProduction: env.SQUARE_ENVIRONMENT === 'production',
            SQUARE_ACCESS_TOKEN: describeSecret(env.SQUARE_ACCESS_TOKEN),
            SQUARE_LOCATION_ID: show(env.SQUARE_LOCATION_ID),
            SQUARE_WEBHOOK_SIGNATURE_KEY: describeSecret(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
            SQUARE_WEBHOOK_URL: show(env.SQUARE_WEBHOOK_URL),
            webhookUrlMatchesExpected: env.SQUARE_WEBHOOK_URL === expectedWebhookUrl,
            expected: show(expectedWebhookUrl)
        },

        email: {
            RESEND_API_KEY: describeSecret(env.RESEND_API_KEY),
            ORDER_EMAIL_TO: show(env.ORDER_EMAIL_TO),
            ORDER_EMAIL_FROM: show(env.ORDER_EMAIL_FROM)
        },

        site: {
            SITE_URL: show(env.SITE_URL),
            requestHost: show(req.headers.host)
        }
    };

    if (req.method !== 'POST') {
        return res.status(200).json(report);
    }

    // The part that cannot be checked any other way: does this function receive
    // the body as raw bytes, or has Vercel already parsed it? api/webhook.js
    // uses the identical config export, so whatever happens here happens there.
    const bodyType = req.body === undefined ? 'undefined'
        : Buffer.isBuffer(req.body) ? 'Buffer'
        : typeof req.body === 'string' ? 'string'
        : Array.isArray(req.body) ? 'array'
        : typeof req.body;

    let raw = null;
    let readError = null;
    try {
        if (Buffer.isBuffer(req.body)) raw = req.body;
        else if (typeof req.body === 'string') raw = Buffer.from(req.body, 'utf8');
        else if (req.body === undefined) {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
            }
            raw = Buffer.concat(chunks);
        }
    } catch (e) {
        readError = e.message;
    }

    report.rawBody = {
        'typeof req.body': bodyType,
        // Buffer, string, or undefined all mean the raw bytes are reachable.
        // 'object' means Vercel parsed the JSON and the bytes are gone — which
        // would make signature verification impossible.
        bodyParserDisabled: bodyType === 'undefined' || bodyType === 'Buffer' || bodyType === 'string',
        bytesRead: raw ? raw.length : null,
        sha256: raw ? crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16) : null,
        readError,
        verdict: bodyType === 'object'
            ? 'BROKEN — Vercel parsed the body; signature verification cannot work'
            : 'OK — raw bytes are reachable'
    };

    // Proves the signature key in this deployment matches the one Square is
    // signing with, without revealing either. Sign a fixed string the same way
    // Square does; if the caller computes the same digest from the key shown in
    // the Square dashboard, the keys match.
    if (env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
        const hmac = crypto.createHmac('sha256', env.SQUARE_WEBHOOK_SIGNATURE_KEY);
        hmac.update('yspg-key-fingerprint');
        report.signatureKeyFingerprint = hmac.digest('base64').slice(0, 12);
    }

    return res.status(200).json(report);
};

// Mirrors api/webhook.js exactly, so this endpoint tests the real mechanism.
module.exports.config = {
    api: { bodyParser: false }
};
