// British Columbia sales tax, shared by the cart page and the order API so the
// customer and the order email can never disagree on the arithmetic.
//
// Loaded two ways from this one file:
//   browser  <script src="./lib/tax.js"></script>   -> window.TAX
//   node     require('../lib/tax')                  -> module.exports
//
// ---------------------------------------------------------------------------
// IMPORTANT, please confirm with an accountant before going live.
// These are BC's standard rates, but whether *you* must charge them is a
// separate question and depends on your registrations:
//   - GST: you are a "small supplier" and generally must not charge GST until
//     your revenue passes $30,000 over four consecutive quarters.
//   - PST: registration rules differ from GST and are not revenue-based in the
//     same way.
// If you are not registered for one of them, set its rate to 0 below — the row
// disappears from the cart and the email automatically. If you are registered
// for neither, set ENABLED to false.
// ---------------------------------------------------------------------------

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TAX = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const ENABLED = true;

    const RATES = [
        { code: 'GST', rate: 0.05, labelEn: 'GST (5%)', labelEs: 'GST (5%)' },
        { code: 'PST', rate: 0.07, labelEn: 'PST (7%)', labelEs: 'PST (7%)' }
    ];

    // Money is handled in integer cents throughout. Working in floats meant
    // 0.07 * 12.10 style rounding drift that could put the customer's total a
    // cent away from the emailed one.
    function toCents(dollars) {
        return Math.round(Number(dollars) * 100);
    }

    // In BC, GST and PST are each charged on the selling price. Neither is
    // applied on top of the other, so both are calculated from the subtotal.
    function calculate(items) {
        const subtotal = (items || []).reduce(
            (sum, item) => sum + toCents(item.price) * Math.floor(Number(item.quantity)),
            0
        );

        const taxes = ENABLED
            ? RATES.filter(r => r.rate > 0).map(r => ({
                  code: r.code,
                  rate: r.rate,
                  labelEn: r.labelEn,
                  labelEs: r.labelEs,
                  amount: Math.round(subtotal * r.rate) / 100
              }))
            : [];

        const taxCents = taxes.reduce((sum, t) => sum + toCents(t.amount), 0);

        return {
            subtotal: subtotal / 100,
            taxes,
            taxTotal: taxCents / 100,
            total: (subtotal + taxCents) / 100
        };
    }

    return { ENABLED, RATES, calculate };
}));
