// Webhook handler for Stripe events
// Save this as: api/webhook.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        // Get raw body for signature verification
        const body = await getRawBody(req);
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
        console.log(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        // Send order confirmation email to business owner
        await sendOrderNotification(session);
    }

    res.json({ received: true });
};

// Helper function to get raw body
async function getRawBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
        });
        req.on('end', () => {
            resolve(data);
        });
        req.on('error', reject);
    });
}

// Send order notification email
async function sendOrderNotification(session) {
    try {
        const metadata = session.metadata;
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        
        // Build order details
        let orderDetails = `
NEW ORDER RECEIVED!
===================

Order ID: ${session.id}
Payment Status: ${session.payment_status}
Amount Paid: $${(session.amount_total / 100).toFixed(2)}

CUSTOMER INFORMATION:
---------------------
Name: ${metadata.customer_name}
Email: ${metadata.customer_email}
Delivery Method: ${metadata.delivery_method}

${metadata.delivery_method === 'delivery' ? `
SHIPPING ADDRESS:
-----------------
${metadata.shipping_street}
${metadata.shipping_city}, ${metadata.shipping_state} ${metadata.shipping_postal_code}
${metadata.shipping_country}
` : 'PICKUP ORDER - No shipping address'}

ORDER ITEMS:
------------
${lineItems.data.map(item => `${item.quantity}x ${item.description} - $${(item.amount_total / 100).toFixed(2)}`).join('\n')}

TOTAL: $${(session.amount_total / 100).toFixed(2)}
        `;

        // Send email using your email service
        // You'll need to set up an email service (SendGrid, Resend, etc.)
        // For now, we'll use a simple fetch to a third-party service
        
        const emailData = {
            to: 'yoursoulpurposegems83@gmail.com',
            subject: `New Order - ${metadata.customer_name}`,
            text: orderDetails
        };

        // Using Resend (free tier: 100 emails/day)
        if (process.env.RESEND_API_KEY) {
            await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'onboarding@resend.dev',
                    to: emailData.to,
                    subject: emailData.subject,
                    text: emailData.text
                })
            });
        }

        console.log('Order notification sent successfully');
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}