// THE product catalog. This is the only place a price is written down.
//
// The product pages carry no prices of their own: each page loads this file and
// fills in its price tags from here, keyed by the button's data-id. The cart
// re-resolves prices from here too, so a cart saved before a price change shows
// the current figure. To reprice something, change it here and nowhere else.
//
// The order API reads the same file, which is what makes the emailed total
// trustworthy — prices are never taken from the browser, where anyone could edit
// localStorage and post a $0.01 order.
//
// Loaded two ways from this one file:
//   browser  <script src="./JS/catalog.js"></script>  -> window.CATALOG
//   node     require('../JS/catalog')                 -> { CATALOG }
//
// Adding a product: add an entry here, then add a card in the page with a
// matching data-id on its .add-to-cart button.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.CATALOG = factory().CATALOG;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

const CATALOG = {
    'bracelet-1': { name: 'Fire Horse Year Bracelet', nameEs: 'Pulsera Año del Caballo de Fuego', price: 25.00 },
    'bracelet-2': { name: 'Bracelet Serenity & Protection – Amethyst', nameEs: 'Pulsera Serenity & Protection – Amatista', price: 25.00 },
    'bracelet-3': { name: 'The Voice of the Heart / Lapis Lazuli and Amethyst', nameEs: 'La voz del corazón / Lapislázuli y Amatista', price: 30.00 },
    'bracelet-4': { name: 'Woven Bracelets', nameEs: 'Pulseras Tejidas', price: 25.00 },
    'bracelet-5': { name: 'White Bracelets', nameEs: 'Pulseras Blancas', price: 25.00 },
    'bracelet-6': { name: 'Rose Quartz Bracelets', nameEs: 'Pulsera de quarzo rosa', price: 25.00 },
    'quartz-1': { name: "Small Tiger's Eye", nameEs: 'Ojo de Tigre Pequeño', price: 12.00 },
    'quartz-2': { name: "Small Tiger's Eye Heart", nameEs: 'Corazón de Ojo de Tigre Pequeño', price: 10.00 },
    'quartz-3': { name: 'Medium Rose Quartz', nameEs: 'Cuarzo Rosa Mediano', price: 18.00 },

    // quartz-4 to quartz-6 were pulled from quartz.html for now. Their entries stay
    // here on purpose: an entry with no matching card simply never renders, and a
    // cart still sitting in someone's browser from before the change then resolves
    // to the right name and price instead of arriving as an unverified line in the
    // order email. Delete them only once you are sure no old carts are in flight.
    'quartz-4': { name: 'Smoky Quartz Tower', nameEs: 'Torre de Cuarzo Ahumado', price: 54.99 },
    'quartz-5': { name: 'Citrine Crystal', nameEs: 'Cristal de Citrino', price: 59.99 },
    'quartz-6': { name: 'Crystal Healing Set', nameEs: 'Set de Cristales Sanadores', price: 89.99 },

    // Numbering resumes at 7 because 4-6 are taken by the entries above. Ids are
    // permanent keys, not display order — reusing 4-6 would make an old cart
    // resolve to a different product at a different price.
    'quartz-7': { name: 'Small Amethyst Pieces', nameEs: 'Piezas Pequeñas de Amatista', price: 12.00 },
    'quartz-8': { name: 'Amethyst Sphere', nameEs: 'Esfera de Amatista', price: 18.00 },
    'quartz-9': { name: 'Small Raw Citrine', nameEs: 'Citrino en Bruto Pequeño', price: 12.00 },
    'dreamcatcher-1': { name: 'Dreamcatcher Protection – Amethyst', nameEs: 'Atrapasueños Protección – Amatista', price: 45.00 },
    'other-1': { name: 'Woven Turkish Eye Hanging', nameEs: 'Ojo Turco Tejido', price: 25.00 },
    'other-2': { name: 'Turkish Eye Keychain', nameEs: 'Llavero Ojo Turco', price: 12.00 },
    'other-3': { name: 'Turkish Eye Door Hanger', nameEs: 'Colgante Ojo Turco para Puerta', price: 17.00 }
};

return { CATALOG };
}));
