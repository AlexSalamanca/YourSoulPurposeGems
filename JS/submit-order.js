// Vercel Serverless Function to handle order submissions
// Save this as: api/submit-order.js

const { Resend } = require('resend');
const PDFDocument = require('pdfkit');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { items, customerInfo } = req.body;
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No items provided' });
        }
        
        if (!customerInfo || !customerInfo.name || !customerInfo.email || !customerInfo.phone) {
            return res.status(400).json({ error: 'Customer information required' });
        }
        
        // Calculate totals
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const orderNumber = `YSPG-${Date.now()}`;
        
        // Generate PDF Invoice
        const pdfBuffer = await generateInvoicePDF({
            orderNumber,
            customerInfo,
            items,
            subtotal
        });
        
        // Send email with Resend
        const resend = new Resend(process.env.RESEND_API_KEY);
        
        await resend.emails.send({
            from: 'orders@yourdomain.com', // Change to your verified domain
            to: 'yoursoulpurposegems@gmail.com',
            subject: `New Order Request - ${customerInfo.name} - ${orderNumber}`,
            html: generateOrderEmailHTML({
                orderNumber,
                customerInfo,
                items,
                subtotal
            }),
            attachments: [
                {
                    filename: `invoice-${orderNumber}.pdf`,
                    content: pdfBuffer
                }
            ]
        });
        
        res.status(200).json({ 
            success: true, 
            message: 'Order request submitted successfully',
            orderNumber: orderNumber
        });
        
    } catch (error) {
        console.error('Error submitting order:', error);
        res.status(500).json({ error: 'Failed to submit order' });
    }
};

// Generate email HTML
function generateOrderEmailHTML({ orderNumber, customerInfo, items, subtotal }) {
    const itemsHTML = items.map(item => `
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">$${item.price.toFixed(2)}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">$${(item.price * item.quantity).toFixed(2)}</td>
        </tr>
    `).join('');
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #6B46C1 0%, #9333EA 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 30px; }
                .order-details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th { background: #6B46C1; color: white; padding: 12px; text-align: left; }
                .total-row { font-weight: bold; font-size: 1.2em; background: #f0f0f0; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🛒 New Order Request</h1>
                    <p>Order #${orderNumber}</p>
                </div>
                
                <div class="content">
                    <div class="order-details">
                        <h2>Customer Information</h2>
                        <p><strong>Name:</strong> ${customerInfo.name}</p>
                        <p><strong>Email:</strong> ${customerInfo.email}</p>
                        <p><strong>Phone:</strong> ${customerInfo.phone}</p>
                        <p><strong>Delivery Method:</strong> ${customerInfo.deliveryMethod === 'pickup' ? 'Pickup' : 'Delivery'}</p>
                    </div>
                    
                    <h2>Order Items</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th style="text-align: center;">Qty</th>
                                <th style="text-align: right;">Price</th>
                                <th style="text-align: right;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHTML}
                            <tr class="total-row">
                                <td colspan="3" style="padding: 15px; text-align: right;">TOTAL:</td>
                                <td style="padding: 15px; text-align: right;">$${subtotal.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                    
                    <div class="order-details" style="background: #fff3cd; border-left: 4px solid #ffc107;">
                        <h3>⚠️ Next Steps</h3>
                        <p>1. Contact customer via WhatsApp at ${customerInfo.phone}</p>
                        <p>2. Arrange payment (cash or e-transfer)</p>
                        <p>3. Coordinate ${customerInfo.deliveryMethod === 'pickup' ? 'pickup' : 'delivery'} details</p>
                        <p>4. Send invoice to customer once payment is confirmed</p>
                    </div>
                </div>
                
                <div class="footer">
                    <p>This is an automated notification from Your Soul Purpose Gems</p>
                    <p>Invoice PDF is attached to this email</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

// Generate PDF Invoice
async function generateInvoicePDF({ orderNumber, customerInfo, items, subtotal }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        
        // Header
        doc.fontSize(24)
           .fillColor('#6B46C1')
           .text('Your Soul Purpose Gems', { align: 'center' })
           .moveDown(0.5);
        
        doc.fontSize(14)
           .fillColor('#666')
           .text('Order Invoice', { align: 'center' })
           .moveDown(2);
        
        // Order Info
        doc.fontSize(10)
           .fillColor('#000')
           .text(`Order Number: ${orderNumber}`)
           .text(`Date: ${new Date().toLocaleDateString()}`)
           .moveDown(1);
        
        // Customer Info
        doc.fontSize(12)
           .fillColor('#6B46C1')
           .text('Customer Information:')
           .moveDown(0.3);
        
        doc.fontSize(10)
           .fillColor('#000')
           .text(`Name: ${customerInfo.name}`)
           .text(`Email: ${customerInfo.email}`)
           .text(`Phone: ${customerInfo.phone}`)
           .text(`Delivery: ${customerInfo.deliveryMethod === 'pickup' ? 'Pickup' : 'Delivery'}`)
           .moveDown(2);
        
        // Items Table Header
        const tableTop = doc.y;
        doc.fontSize(10)
           .fillColor('#6B46C1');
        
        doc.text('Item', 50, tableTop, { width: 250 });
        doc.text('Qty', 300, tableTop, { width: 50, align: 'center' });
        doc.text('Price', 350, tableTop, { width: 80, align: 'right' });
        doc.text('Total', 430, tableTop, { width: 80, align: 'right' });
        
        doc.moveTo(50, tableTop + 15)
           .lineTo(550, tableTop + 15)
           .stroke();
        
        // Items
        let yPosition = tableTop + 25;
        doc.fillColor('#000');
        
        items.forEach(item => {
            doc.fontSize(10)
               .text(item.name, 50, yPosition, { width: 250 })
               .text(item.quantity.toString(), 300, yPosition, { width: 50, align: 'center' })
               .text(`$${item.price.toFixed(2)}`, 350, yPosition, { width: 80, align: 'right' })
               .text(`$${(item.price * item.quantity).toFixed(2)}`, 430, yPosition, { width: 80, align: 'right' });
            
            yPosition += 25;
        });
        
        // Total
        doc.moveTo(50, yPosition)
           .lineTo(550, yPosition)
           .stroke();
        
        yPosition += 15;
        doc.fontSize(12)
           .fillColor('#6B46C1')
           .text('TOTAL:', 350, yPosition, { width: 80, align: 'right' })
           .text(`$${subtotal.toFixed(2)}`, 430, yPosition, { width: 80, align: 'right' });
        
        // Payment Notice
        yPosition += 40;
        doc.fontSize(10)
           .fillColor('#666')
           .text('Payment to be arranged via WhatsApp', 50, yPosition, { width: 500, align: 'center' })
           .text('Payment methods: Cash or E-Transfer', 50, yPosition + 15, { width: 500, align: 'center' });
        
        // Footer
        doc.fontSize(8)
           .fillColor('#999')
           .text('Thank you for your order!', 50, 700, { width: 500, align: 'center' })
           .text('yoursoulpurposegems@gmail.com | (778) 554-3220', 50, 715, { width: 500, align: 'center' });
        
        doc.end();
    });
}