// GET  /api/diagnose?token=yspg-diag-7f3a9c2e   what the running function sees
// POST /api/diagnose?token=yspg-diag-7f3a9c2e   whether the raw body survives
//
// TEMPORARY. Delete this file once the webhook is confirmed working.
//
// Deliberately built the same way as api/webhook.mjs — a Web-standard handler
// in a .mjs file — so that what this reports about raw-body handling is true of
// the webhook too. The previous CommonJS version of this file is what proved
// `config = { api: { bodyParser: false } }` is ignored by Vercel: it reported
// `typeof req.body === "object"`, meaning the bytes were already gone.
//
// Reports NO secret values — only whether each variable is set, its length and
// last four characters, and non-secret values (URLs, commit sha) wrapped in
// >>><<< so trailing spaces and newlines are visible.

import crypto from 'node:crypto';

const TOKEN = 'yspg-diag-7f3a9c2e';
const EXPECTED_WEBHOOK_URL = 'https://www.yoursoulpurposegems.com/api/webhook';

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

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

function authorised(request) {
    try {
        return new URL(request.url).searchParams.get('token') === TOKEN;
    } catch (e) {
        return false;
    }
}

function report(request) {
    const env = process.env;
    return {
        handler: 'Web-standard (Request/Response) in .mjs — same as api/webhook.mjs',
        deployment: {
            commit: show(env.VERCEL_GIT_COMMIT_SHA),
            branch: show(env.VERCEL_GIT_COMMIT_REF),
            vercelEnv: show(env.VERCEL_ENV),
            note: 'commit must match your latest push'
        },
        square: {
            SQUARE_ENVIRONMENT: show(env.SQUARE_ENVIRONMENT),
            isProduction: env.SQUARE_ENVIRONMENT === 'production',
            SQUARE_ACCESS_TOKEN: describeSecret(env.SQUARE_ACCESS_TOKEN),
            SQUARE_LOCATION_ID: show(env.SQUARE_LOCATION_ID),
            SQUARE_WEBHOOK_SIGNATURE_KEY: describeSecret(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
            SQUARE_WEBHOOK_URL: show(env.SQUARE_WEBHOOK_URL),
            webhookUrlMatchesExpected: env.SQUARE_WEBHOOK_URL === EXPECTED_WEBHOOK_URL
        },
        email: {
            RESEND_API_KEY: describeSecret(env.RESEND_API_KEY),
            ORDER_EMAIL_TO: show(env.ORDER_EMAIL_TO),
            ORDER_EMAIL_FROM: show(env.ORDER_EMAIL_FROM)
        },
        site: {
            SITE_URL: show(env.SITE_URL),
            requestHost: show(new URL(request.url).host)
        }
    };
}

export async function GET(request) {
    if (!authorised(request)) return json({ error: 'Not found' }, 404);
    return json(report(request));
}

export async function POST(request) {
    if (!authorised(request)) return json({ error: 'Not found' }, 404);

    const out = report(request);

    // The whole point: with a Web-standard handler the payload is reachable as
    // raw bytes no matter what Content-Type the caller sent.
    let raw = null;
    let readError = null;
    try {
        raw = Buffer.from(await request.arrayBuffer());
    } catch (e) {
        readError = e.message;
    }

    out.rawBody = {
        bytesRead: raw ? raw.length : null,
        sha256: raw ? crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16) : null,
        readError,
        verdict: raw && raw.length > 0
            ? 'OK — raw bytes reachable, signature verification can work'
            : 'BROKEN — no raw bytes'
    };

    // Recomputes the signature exactly as JS/square.js does, using the
    // configured URL, so we can confirm the key and URL agree with Square
    // without either being revealed. If Square's own signature over the same
    // body matches this, everything lines up.
    if (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY && raw) {
        const hmac = crypto.createHmac('sha256', process.env.SQUARE_WEBHOOK_SIGNATURE_KEY);
        hmac.update(process.env.SQUARE_WEBHOOK_URL || '', 'utf8');
        hmac.update(raw);
        out.rawBody.signatureWeWouldExpect = hmac.digest('base64');
        out.rawBody.signatureReceived = request.headers.get('x-square-hmacsha256-signature') || '(none sent)';
        out.rawBody.signaturesMatch =
            out.rawBody.signatureWeWouldExpect === out.rawBody.signatureReceived;
    }

    return json(out);
}
