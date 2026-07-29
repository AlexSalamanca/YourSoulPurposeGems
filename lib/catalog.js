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
    'bracelet-3': { name: 'The Voice of the Heart', nameEs: 'La Voz del Corazón', price: 34.99 },
    'bracelet-4': { name: 'Crystal Energy Bracelet', nameEs: 'Pulsera de Energía Cristalina', price: 39.99 },
    'bracelet-5': { name: 'Charm Bracelet', nameEs: 'Pulsera con Dijes', price: 44.99 },
    'bracelet-6': { name: 'Minimalist Chain Bracelet', nameEs: 'Pulsera Minimalista de Cadena', price: 19.99 },

    'quartz-1': { name: 'Clear Quartz Point', nameEs: 'Punta de Cuarzo Transparente', price: 49.99 },
    'quartz-2': { name: 'Rose Quartz Heart', nameEs: 'Corazón de Cuarzo Rosa', price: 39.99 },
    'quartz-3': { name: 'Amethyst Cluster', nameEs: 'Racimo de Amatista', price: 69.99 },
    'quartz-4': { name: 'Smoky Quartz Tower', nameEs: 'Torre de Cuarzo Ahumado', price: 54.99 },
    'quartz-5': { name: 'Citrine Crystal', nameEs: 'Cristal de Citrino', price: 59.99 },
    'quartz-6': { name: 'Crystal Healing Set', nameEs: 'Set de Cristales Sanadores', price: 89.99 }
};

module.exports = { CATALOG };
