// ============================================
// STATE
// ============================================

const CART_KEY = 'cart';
const LANG_KEY = 'lang';
const MAX_QUANTITY = 99;

let cart = [];
let currentLang = 'en';

// Used to tell a human filling in a form from a script posting instantly.
const pageLoadedAt = Date.now();

// ============================================
// HELPERS
// ============================================

function money(amount) {
    return `$${amount.toFixed(2)}`;
}

function t(en, es) {
    return currentLang === 'es' ? es : en;
}

// ============================================
// CART MANAGEMENT
// ============================================

// localStorage is user-editable, so never trust its shape. Anything that does
// not survive this pass is dropped rather than allowed to crash the cart page.
function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const price = Number(raw.price);
    const quantity = Math.floor(Number(raw.quantity));

    if (!id) return null;
    if (!Number.isFinite(price) || price < 0) return null;
    if (!Number.isFinite(quantity) || quantity < 1) return null;

    return {
        id,
        name: typeof raw.name === 'string' ? raw.name : id,
        nameEs: typeof raw.nameEs === 'string' ? raw.nameEs : '',
        price,
        image: typeof raw.image === 'string' ? raw.image : '',
        quantity: Math.min(quantity, MAX_QUANTITY)
    };
}

function loadCart() {
    let parsed = [];
    try {
        parsed = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch (e) {
        parsed = [];
    }

    const normalized = (Array.isArray(parsed) ? parsed : []).map(normalizeItem).filter(Boolean);
    cart = normalized.map(refreshFromCatalog);

    // Write back only if something actually moved, so a normal page load is not a
    // storage write. Without this the stored copy would stay stale until some
    // other action happened to save the cart.
    const changed = cart.some((item, i) =>
        item.price !== normalized[i].price ||
        item.name !== normalized[i].name ||
        item.nameEs !== normalized[i].nameEs
    );
    if (changed) {
        saveCart();
    } else {
        updateCartCount();
    }
}

// A cart can sit in localStorage for weeks. Re-resolve each line against the
// catalog on load so the customer sees today's name and price — and the same
// ones the order API will bill from. Unknown ids keep what was stored; the API
// flags those separately in the email.
function refreshFromCatalog(item) {
    const entry = catalogEntry(item.id);
    if (!entry) return item;
    if (entry.price === item.price && entry.name === item.name && entry.nameEs === item.nameEs) {
        return item;
    }
    return { ...item, name: entry.name, nameEs: entry.nameEs, price: entry.price };
}

function saveCart() {
    try {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (e) {
        // Private browsing / storage full. The in-memory cart still works for
        // this page, so keep going rather than breaking the button.
        console.warn('Could not save the cart:', e);
    }
    updateCartCount();
}

function clearCartStorage() {
    cart = [];
    try {
        localStorage.removeItem(CART_KEY);
    } catch (e) {
        /* ignore */
    }
    updateCartCount();
}

function updateCartCount() {
    const count = cart.reduce((total, item) => total + item.quantity, 0);
    document.querySelectorAll('.cart-count').forEach(el => {
        el.textContent = count;
    });
}

// JS/catalog.js is the only place a product's name and price are written down.
// Everything that needs either looks it up here, so they can never be right in
// one place and stale in another.
function catalogEntry(id) {
    if (typeof CATALOG === 'undefined' || !CATALOG || !CATALOG[id]) return null;
    const entry = CATALOG[id];
    const price = Number(entry.price);
    if (!Number.isFinite(price) || price < 0) return null;
    return {
        name: typeof entry.name === 'string' && entry.name ? entry.name : id,
        nameEs: typeof entry.nameEs === 'string' ? entry.nameEs : '',
        price
    };
}

function catalogPrice(id) {
    return catalogEntry(id)?.price ?? null;
}

// Fills in the heading and price on each product card from the catalog. The
// pages ship with neither, so if this cannot run the customer sees a blank card
// rather than a name or price that disagrees with the order email.
function renderProductCards() {
    document.querySelectorAll('.add-to-cart').forEach(button => {
        const id = button.dataset.id;
        const details = button.closest('.item-details');
        if (!details) return;

        const heading = details.querySelector('h3');
        const priceTag = details.querySelector('.item-price');
        const entry = catalogEntry(id);

        if (!entry) {
            console.error(`No catalog entry for "${id}" — add one in JS/catalog.js`);
            if (heading) heading.textContent = '';
            if (priceTag) priceTag.textContent = '';
            button.disabled = true;
            return;
        }

        if (priceTag) priceTag.textContent = money(entry.price);

        if (heading) {
            // Written as data-en/data-es so the existing language switcher keeps
            // working on these headings like any other translated element.
            heading.setAttribute('data-en', entry.name);
            heading.setAttribute('data-es', entry.nameEs || entry.name);
            heading.textContent = (currentLang === 'es' && entry.nameEs) ? entry.nameEs : entry.name;
        }
    });
}

function addToCart(button) {
    const id = button.dataset.id;
    const entry = catalogEntry(id);

    if (!entry) {
        console.error(`Refusing to add "${id}" to the cart: no catalog entry.`);
        return;
    }

    // The cart thumbnail is read straight from the photo on the card the customer
    // just clicked, rather than a data-image attribute repeating the same path.
    // There is nothing to keep in sync, so the two cannot disagree — they used to,
    // on bracelet-6.
    const cardImage = button.closest('.item-card')?.querySelector('.item-image img');

    const item = normalizeItem({
        id,
        name: entry.name,
        nameEs: entry.nameEs,
        price: entry.price,
        image: cardImage?.getAttribute('src') || '',
        quantity: 1
    });

    if (!item) {
        console.error('Add to cart button is missing a valid data-id', button.dataset);
        return;
    }

    const existing = cart.find(entry => entry.id === item.id);
    if (existing) {
        if (existing.quantity >= MAX_QUANTITY) return;
        existing.quantity++;
    } else {
        cart.push(item);
    }

    saveCart();
    showAddedToCartMessage();
}

function removeFromCart(id) {
    cart = cart.filter(item => item.id !== id);
    saveCart();
    renderCart();
}

function updateQuantity(id, change) {
    const item = cart.find(entry => entry.id === id);
    if (!item) return;

    const next = item.quantity + change;
    if (next <= 0) {
        removeFromCart(id);
        return;
    }
    if (next > MAX_QUANTITY) return;

    item.quantity = next;
    saveCart();
    renderCart();
}

// ============================================
// "ADDED TO CART" TOAST
// ============================================

let toastTimers = [];

function showAddedToCartMessage() {
    // Clear timers from a previous toast so rapid clicks do not leave one
    // stranded on screen.
    toastTimers.forEach(clearTimeout);
    toastTimers = [];
    document.querySelectorAll('.added-to-cart-message').forEach(el => el.remove());

    const message = document.createElement('div');
    message.className = 'added-to-cart-message';
    message.setAttribute('role', 'status');
    message.textContent = t('Added to cart!', '¡Agregado al carrito!');
    document.body.appendChild(message);

    toastTimers.push(setTimeout(() => {
        message.classList.add('leaving');
        toastTimers.push(setTimeout(() => message.remove(), 300));
    }, 2000));
}

// ============================================
// CART PAGE RENDERING
// ============================================

function renderCart() {
    const cartItemsContainer = document.getElementById('cartItems');
    const emptyCart = document.getElementById('emptyCart');
    const cartContent = document.getElementById('cartContent');

    if (!cartItemsContainer || !emptyCart || !cartContent) return; // Not the cart page

    if (cart.length === 0) {
        emptyCart.style.display = 'block';
        cartContent.style.display = 'none';
        return;
    }

    emptyCart.style.display = 'none';
    cartContent.style.display = 'grid';

    // Built with DOM nodes rather than an innerHTML template: item names come
    // from localStorage, and string concatenation there is both an injection
    // vector and a re-parse per loop iteration.
    const fragment = document.createDocumentFragment();

    cart.forEach(item => {
        const itemName = (currentLang === 'es' && item.nameEs) ? item.nameEs : item.name;

        const row = document.createElement('div');
        row.className = 'cart-item';

        const imageWrap = document.createElement('div');
        imageWrap.className = 'cart-item-image';
        if (item.image) {
            const img = document.createElement('img');
            img.src = item.image;
            img.alt = itemName;
            img.loading = 'lazy';
            imageWrap.appendChild(img);
        }

        const details = document.createElement('div');
        details.className = 'cart-item-details';

        const heading = document.createElement('h3');
        heading.textContent = itemName;

        const price = document.createElement('p');
        price.className = 'cart-item-price';
        price.textContent = money(item.price);

        const controls = document.createElement('div');
        controls.className = 'quantity-controls';
        controls.appendChild(quantityButton('−', item.id, -1, t('Decrease quantity', 'Reducir cantidad')));

        const qtyDisplay = document.createElement('span');
        qtyDisplay.className = 'qty-display';
        qtyDisplay.textContent = item.quantity;
        controls.appendChild(qtyDisplay);

        controls.appendChild(quantityButton('+', item.id, 1, t('Increase quantity', 'Aumentar cantidad')));

        details.append(heading, price, controls);

        const actions = document.createElement('div');
        actions.className = 'cart-item-actions';

        const total = document.createElement('div');
        total.className = 'item-total';
        total.textContent = money(item.price * item.quantity);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-btn';
        remove.dataset.action = 'remove';
        remove.dataset.id = item.id;
        remove.setAttribute('data-en', 'Remove');
        remove.setAttribute('data-es', 'Eliminar');
        remove.textContent = t('Remove', 'Eliminar');

        actions.append(total, remove);
        row.append(imageWrap, details, actions);
        fragment.appendChild(row);
    });

    cartItemsContainer.replaceChildren(fragment);
    updateCartSummary();
}

function quantityButton(label, id, change, ariaLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'qty-btn';
    button.textContent = label;
    button.dataset.action = 'quantity';
    button.dataset.id = id;
    button.dataset.change = String(change);
    button.setAttribute('aria-label', ariaLabel);
    return button;
}

function updateCartSummary() {
    const subtotalElement = document.getElementById('subtotal');
    const totalElement = document.getElementById('total');

    if (!subtotalElement || !totalElement) return;

    const totals = cartTotals();
    subtotalElement.textContent = money(totals.subtotal);
    totalElement.textContent = money(totals.total);

    const taxRows = document.getElementById('taxRows');
    if (!taxRows) return;

    // One row per configured tax. Rebuilt rather than patched so switching a
    // rate off in JS/tax.js removes its row instead of leaving a stale $0.00.
    const fragment = document.createDocumentFragment();
    totals.taxes.forEach(tax => {
        const row = document.createElement('div');
        row.className = 'summary-row';

        // Trailing colon added here, not stored in the label, because the order
        // email appends its own.
        const label = document.createElement('span');
        label.setAttribute('data-en', `${tax.labelEn}:`);
        label.setAttribute('data-es', `${tax.labelEs}:`);
        label.textContent = `${currentLang === 'es' ? tax.labelEs : tax.labelEn}:`;

        const amount = document.createElement('span');
        amount.textContent = money(tax.amount);

        row.append(label, amount);
        fragment.appendChild(row);
    });
    taxRows.replaceChildren(fragment);
}

// Single source of truth for the arithmetic: JS/tax.js is also what the order
// API uses, so the cart and the email can't drift apart. If tax.js failed to
// load, fall back to an untaxed subtotal rather than showing nothing.
function cartTotals() {
    if (typeof TAX !== 'undefined' && TAX && typeof TAX.calculate === 'function') {
        return TAX.calculate(cart);
    }
    console.warn('JS/tax.js did not load — showing an untaxed total.');
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return { subtotal, taxes: [], taxTotal: 0, total: subtotal };
}

// ============================================
// ORDER SUBMISSION (no payment — emails the shop owner)
// ============================================

async function submitOrder(customerInfo) {
    const submitBtn = document.getElementById('submitOrderBtn');

    if (cart.length === 0) {
        alert(t('Your cart is empty.', 'Tu carrito está vacío.'));
        return;
    }

    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = t('Submitting...', 'Enviando...');
    }

    try {
        // Relative path: the API and the pages ship in the same Vercel
        // deployment, so there is no host to hardcode and no CORS hop.
        const response = await fetch('/api/submit-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: cart,
                customerInfo,
                // Bot signals, both checked server-side. See api/submit-order.js.
                website: document.getElementById('website')?.value || '',
                elapsedMs: Date.now() - pageLoadedAt
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(result.error || `Request failed with status ${response.status}`);
        }

        clearCartStorage();
        window.location.href = `./success.html?order=${encodeURIComponent(result.orderNumber || '')}`;
    } catch (error) {
        console.error('Could not submit the order:', error);
        alert(t(
            'An error occurred. Please try again or contact us directly at yoursoulpurposegems@gmail.com.',
            'Ocurrió un error. Por favor intenta de nuevo o contáctanos directamente en yoursoulpurposegems@gmail.com.'
        ));
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText || t('Submit Order Request', 'Enviar Solicitud de Pedido');
        }
    }
}

// ============================================
// LANGUAGE
// ============================================

function applyLanguage() {
    document.documentElement.lang = currentLang;

    const langBtn = document.getElementById('langBtn');
    if (langBtn) {
        // The button shows the language you can switch *to*.
        langBtn.textContent = currentLang === 'en' ? 'ES' : 'EN';
        langBtn.setAttribute('aria-label', t('Switch to Spanish', 'Cambiar a inglés'));
    }

    document.querySelectorAll('[data-en][data-es]').forEach(element => {
        const translation = element.getAttribute(`data-${currentLang}`);
        if (translation) {
            element.textContent = translation;
        }
    });

    if (document.getElementById('cartItems')) {
        renderCart();
    }
}

function switchLanguage() {
    currentLang = currentLang === 'en' ? 'es' : 'en';
    try {
        localStorage.setItem(LANG_KEY, currentLang);
    } catch (e) {
        /* ignore */
    }
    applyLanguage();
}

function loadLanguage() {
    let saved = null;
    try {
        saved = localStorage.getItem(LANG_KEY);
    } catch (e) {
        /* ignore */
    }
    currentLang = saved === 'es' ? 'es' : 'en';
}

// ============================================
// NAVIGATION & UI
// ============================================

function setupNavigation() {
    const burger = document.querySelector('.burger');
    const nav = document.querySelector('.nav-links');

    if (!burger || !nav) return;

    burger.addEventListener('click', () => {
        nav.classList.toggle('active');
        burger.classList.toggle('active');
    });

    nav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            nav.classList.remove('active');
            burger.classList.remove('active');
        });
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth > 768) {
                nav.classList.remove('active');
                burger.classList.remove('active');
            }
        }, 250);
    });
}

function setupSlideshow() {
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.slide-dot');

    if (slides.length === 0) return;

    let currentSlide = 0;

    function showSlide(n) {
        slides.forEach(slide => slide.classList.remove('active'));
        dots.forEach(dot => dot.classList.remove('active'));

        currentSlide = (n + slides.length) % slides.length;

        slides[currentSlide].classList.add('active');
        if (dots[currentSlide]) {
            dots[currentSlide].classList.add('active');
        }
    }

    let slideInterval = setInterval(() => showSlide(currentSlide + 1), 5000);

    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            clearInterval(slideInterval);
            showSlide(index);
            slideInterval = setInterval(() => showSlide(currentSlide + 1), 5000);
        });
    });
}

function setupSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;

            let target = null;
            try {
                target = document.querySelector(href);
            } catch (err) {
                return; // Not a valid selector — let the browser handle it.
            }

            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// ============================================
// CHECKOUT FORM
// ============================================

function setupCheckoutForm() {
    const orderForm = document.getElementById('orderForm');
    if (!orderForm) return;

    orderForm.addEventListener('submit', event => {
        event.preventDefault();

        submitOrder({
            name: document.getElementById('customerName').value.trim(),
            email: document.getElementById('customerEmail').value.trim(),
            phone: document.getElementById('customerPhone').value.trim(),
            deliveryMethod: document.getElementById('deliveryMethod').value
        });
    });
}

// Quantity and remove buttons are created after load, so listen on the
// container instead of binding per button (and instead of inline onclick).
function setupCartInteractions() {
    const cartItemsContainer = document.getElementById('cartItems');
    if (!cartItemsContainer) return;

    cartItemsContainer.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;

        if (button.dataset.action === 'remove') {
            removeFromCart(button.dataset.id);
        } else if (button.dataset.action === 'quantity') {
            updateQuantity(button.dataset.id, Number(button.dataset.change));
        }
    });
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    loadLanguage();
    loadCart();

    setupNavigation();
    setupSlideshow();
    setupSmoothScrolling();
    setupCheckoutForm();
    setupCartInteractions();
    renderProductCards();

    const langBtn = document.getElementById('langBtn');
    if (langBtn) {
        langBtn.addEventListener('click', switchLanguage);
    }

    document.querySelectorAll('.add-to-cart').forEach(button => {
        button.addEventListener('click', event => addToCart(event.currentTarget));
    });

    // applyLanguage() renders the cart as part of its work.
    applyLanguage();
});

// ============================================
// DEBUG HELPERS (call from the browser console)
// ============================================

window.viewCart = () => cart;
window.clearCart = () => {
    clearCartStorage();
    renderCart();
};
