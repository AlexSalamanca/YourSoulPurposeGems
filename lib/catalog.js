// Server-side product catalog.
//
// The order email is a business record, so prices must not be taken on trust
// from the browser — anyone can edit localStorage and post a $0.01 order.
// Every line the API receives is looked up here by id, and the name/price from
// this file is what ends up in the email.
//
// IMPORTANT: when you add or reprice a product in bracelets.html / quartz.html,
// update the matching entry here too. Ids must match the button's data-id.

const CATALOG = {
    'bracelet-1': { name: 'Fire Horse Year Bracelet', nameEs: 'Pulsera Año del Caballo de Fuego', price: 25.00 },
    'bracelet-2': { name: 'Bracelet Serenity & Protection – Amethyst', nameEs: 'Pulsera Serenity & Protection – Amatista', price: 25.00 },
    'bracelet-3': { name: 'The Voice of the Heart', nameEs: 'La Voz del Corazón', price: 30.00 },
    // TODO: all three prices below are placeholders, matched to the $25.00 the
    // other bracelets sell for — confirm them and keep them in sync with the
    // data-price values in bracelets.html.
    'bracelet-4': { name: 'Woven Bracelets', nameEs: 'Pulseras Tejidas', price: 25.00 },
    'bracelet-5': { name: 'White Bracelets', nameEs: 'Pulseras Blancas', price: 25.00 },
    'bracelet-6': { name: 'Pink Bracelets', nameEs: 'Pulseras Rosas', price: 25.00 },

    // TODO: all three prices below are placeholders — confirm them and keep them
    // in sync with the data-price values in quartz.html.
    'quartz-1': { name: "Tiger's Eye", nameEs: 'Ojo de Tigre', price: 12.00 },
    'quartz-2': { name: "Tiger's Eye Heart", nameEs: 'Corazón de Ojo de Tigre', price: 10.00 },
    'quartz-3': { name: 'Rose Quartz', nameEs: 'Cuarzo Rosa', price: 18.00 },

    // quartz-4 to quartz-6 were pulled from quartz.html for now. Their entries stay
    // active on purpose: nothing renders from this file, and a cart still sitting in
    // someone's browser from before the change then resolves to the right name and
    // price instead of arriving as an unverified line in the order email. Delete
    // them only once you are sure no old carts are in flight.
    'quartz-4': { name: 'Smoky Quartz Tower', nameEs: 'Torre de Cuarzo Ahumado', price: 54.99 },
    'quartz-5': { name: 'Citrine Crystal', nameEs: 'Cristal de Citrino', price: 59.99 },
    'quartz-6': { name: 'Crystal Healing Set', nameEs: 'Set de Cristales Sanadores', price: 89.99 },

    // Numbering resumes at 7 because 4-6 are taken by the entries above. Ids are
    // permanent keys, not display order — reusing 4-6 would make an old cart
    // resolve to a different product at a different price.
    // TODO: all three prices below are placeholders — confirm them and keep them
    // in sync with the data-price values in quartz.html.
    'quartz-7': { name: 'Small Amethyst Pieces', nameEs: 'Piezas Pequeñas de Amatista', price: 12.00 },
    'quartz-8': { name: 'Amethyst Sphere', nameEs: 'Esfera de Amatista', price: 18.00 },
    'quartz-9': { name: 'Raw Citrine', nameEs: 'Citrino en Bruto', price: 12.00 },

    // TODO: 45.00 is a placeholder — confirm the real price and keep it in sync
    // with the data-price in dreamcatchers.html.
    'dreamcatcher-1': { name: 'Dreamcatcher Protection – Amethyst', nameEs: 'Atrapasueños Protección – Amatista', price: 45.00 },

    // TODO: all three prices below are placeholders — confirm them and keep them
    // in sync with the data-price values in others.html.
    'other-1': { name: 'Woven Turkish Eye Hanging', nameEs: 'Ojo Turco Tejido', price: 25.00 },
    'other-2': { name: 'Turkish Eye Keychain', nameEs: 'Llavero Ojo Turco', price: 12.00 },
    'other-3': { name: 'Turkish Eye Door Hanger', nameEs: 'Colgante Ojo Turco para Puerta', price: 17.00 }
};

module.exports = { CATALOG };
