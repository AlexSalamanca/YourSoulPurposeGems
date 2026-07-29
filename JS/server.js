// Vercel Serverless Function for Stripe Checkout
// Save this as: api/create-checkout-session.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { items, customerInfo } = req.body;
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No items provided' });
        }
        
        if (!customerInfo || !customerInfo.email) {
            return res.status(400).json({ error: 'Customer information required' });
        }
        
        // Transform cart items to Stripe line items format
        const lineItems = items.map(item => ({
            price_data: {
                currency: 'usd',
                product_data: {
                    name: item.name,
                    images: [item.image],
                },
                unit_amount: Math.round(item.price * 100), // Stripe uses cents
            },
            quantity: item.quantity,
        }));
        
        // Get the origin from the request or use your domain
        const origin = req.headers.origin || 'http://localhost:8000';
        
        // Create session metadata with customer info
        const metadata = {
            customer_name: customerInfo.name,
            customer_email: customerInfo.email,
            delivery_method: customerInfo.deliveryMethod,
            ...(customerInfo.shipping && {
                shipping_street: customerInfo.shipping.street,
                shipping_city: customerInfo.shipping.city,
                shipping_state: customerInfo.shipping.state,
                shipping_postal_code: customerInfo.shipping.postalCode,
                shipping_country: customerInfo.shipping.country
            })
        };
        
        // Create Stripe Checkout session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/cart.html`,
            customer_email: customerInfo.email,
            metadata: metadata,
            ...(customerInfo.deliveryMethod === 'delivery' && customerInfo.shipping && {
                shipping_address_collection: {
                    allowed_countries: [customerInfo.shipping.country]
                }
            })
        });
        
        res.status(200).json({ id: session.id });
        
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message });
    }
};