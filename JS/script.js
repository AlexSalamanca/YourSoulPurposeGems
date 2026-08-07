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
// ORDER SUBMISSION
// ============================================
//
// Two endpoints, chosen by the payment method:
//
//   card               /api/create-payment-link -> redirect to Square Checkout
//   cash / e-transfer  /api/submit-order        -> emails the shop owner
//
// The server enforces the same split, so an edited page cannot email an order
// that was meant to be paid for, or reach Square with a cash order.

async function submitOrder(customerInfo) {
    const submitBtn = document.getElementById('submitOrderBtn');

    if (cart.length === 0) {
        showFormError(t('Your cart is empty.', 'Tu carrito está vacío.'));
        return;
    }

    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = customerInfo.paymentMethod === 'card'
            ? t('Redirecting to payment...', 'Redirigiendo al pago...')
            : t('Submitting...', 'Enviando...');
    }
    hideFormError();

    try {
        if (customerInfo.paymentMethod === 'card') {
            await startCardCheckout(customerInfo);
        } else {
            await sendOrderRequest(customerInfo);
        }
    } catch (error) {
        console.error('Could not submit the order:', error);
        showFormError(error.message || t(
            'An error occurred. Please try again or contact us directly at yoursoulpurposegems@gmail.com.',
            'Ocurrió un error. Por favor intenta de nuevo o contáctanos directamente en yoursoulpurposegems@gmail.com.'
        ));
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText || t('Submit Order Request', 'Enviar Solicitud de Pedido');
        }
    }
}

// The card path sends ids and quantities only. Every line is priced from
// JS/catalog.js server-side, and an id that is not in it is refused outright
// rather than charged at whatever the browser claimed.
function orderLines() {
    return cart.map(item => ({ id: item.id, quantity: item.quantity }));
}

async function startCardCheckout(customerInfo) {
    // Relative path: the API and the pages ship in the same Vercel deployment,
    // so there is no host to hardcode and no CORS hop.
    const response = await fetch('/api/create-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: orderLines(), customerInfo })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.url) {
        throw new Error(result.error || t(
            'Could not start the payment. Please try again.',
            'No se pudo iniciar el pago. Por favor intenta de nuevo.'
        ));
    }

    // The cart is deliberately left in place until the payment succeeds —
    // success.html clears it. Someone who abandons Square's page comes back to
    // a cart that still has their items in it.
    window.location.href = result.url;
}

async function sendOrderRequest(customerInfo) {
    const response = await fetch('/api/submit-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            // Full lines, not just ids: nothing is being charged here, and a
            // line whose id has since left the catalog is more useful in the
            // email at its last known price — flagged as unverified — than at
            // $0.00. The server still prefers the catalog wherever it has one.
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

// Mirrors the rules in JS/order.js. The server is what actually decides — this
// exists so the customer is told before filling the rest of the form in, not
// after a round trip.
const CANADIAN_POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

function el(id) {
    return document.getElementById(id);
}

function showFormError(message) {
    const box = el('formError');
    if (!box) {
        alert(message);
        return;
    }
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideFormError() {
    const box = el('formError');
    if (box) {
        box.hidden = true;
        box.textContent = '';
    }
}

function selectedPaymentMethod() {
    return document.querySelector('input[name="paymentMethod"]:checked')?.value || '';
}

// Called whenever the delivery preference, country or payment method changes.
// Everything conditional about the form is decided here in one place, so the
// states cannot drift apart.
function updateCheckoutForm() {
    const deliveryMethod = el('deliveryMethod')?.value || '';
    const isDelivery = deliveryMethod === 'delivery';
    const addressFields = el('addressFields');
    const paymentFields = el('paymentFields');

    if (!addressFields || !paymentFields) return;

    addressFields.hidden = !isDelivery;
    paymentFields.hidden = deliveryMethod === '';

    // required is toggled rather than set in the HTML: a required field inside a
    // hidden fieldset makes the browser refuse to submit while being unable to
    // focus what it is complaining about.
    ['addressLine1', 'addressCity', 'addressProvince', 'addressPostalCode'].forEach(id => {
        const field = el(id);
        if (field) field.required = isDelivery;
    });

    const outsideCanada = isDelivery && el('addressCountry')?.value !== 'CA';
    const warning = el('countryWarning');
    if (warning) warning.hidden = !outsideCanada;

    // Address lines are pointless while we cannot deliver there, so they are
    // switched off along with the requirement.
    if (outsideCanada) {
        ['addressLine1', 'addressLine2', 'addressCity', 'addressProvince', 'addressPostalCode'].forEach(id => {
            const field = el(id);
            if (field) {
                field.required = false;
                field.disabled = true;
            }
        });
    } else {
        ['addressLine1', 'addressLine2', 'addressCity', 'addressProvince', 'addressPostalCode'].forEach(id => {
            const field = el(id);
            if (field) field.disabled = false;
        });
    }

    // Delivery is card-only. Disabling rather than hiding keeps the reason
    // visible — the note underneath explains why.
    document.querySelectorAll('.payment-option[data-pickup-only]').forEach(option => {
        const radio = option.querySelector('input[type="radio"]');
        option.classList.toggle('is-disabled', isDelivery);
        if (radio) {
            radio.disabled = isDelivery;
            if (isDelivery && radio.checked) radio.checked = false;
        }
    });

    const note = el('deliveryPaymentNote');
    if (note) note.hidden = !isDelivery;

    if (isDelivery) {
        const card = document.querySelector('input[name="paymentMethod"][value="card"]');
        if (card && !selectedPaymentMethod()) card.checked = true;
    }

    document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
        radio.required = deliveryMethod !== '';
    });

    updateSubmitButton();
}

// The button says what pressing it will do. Written as data-en/data-es so the
// language switcher keeps working on it like any other translated element.
function updateSubmitButton() {
    const button = el('submitOrderBtn');
    if (!button) return;

    const outsideCanada = el('deliveryMethod')?.value === 'delivery'
        && el('addressCountry')?.value !== 'CA';

    let en, es;
    if (outsideCanada) {
        en = 'Contact Us to Order';
        es = 'Contáctanos para Ordenar';
    } else if (selectedPaymentMethod() === 'card') {
        en = 'Continue to Payment';
        es = 'Continuar al Pago';
    } else {
        en = 'Submit Order Request';
        es = 'Enviar Solicitud de Pedido';
    }

    button.setAttribute('data-en', en);
    button.setAttribute('data-es', es);
    button.textContent = t(en, es);
    button.disabled = false;
}

// Returns the customerInfo to send, or null after reporting what is missing.
function collectCustomerInfo() {
    const deliveryMethod = el('deliveryMethod').value;
    const paymentMethod = selectedPaymentMethod();

    if (!deliveryMethod) {
        showFormError(t('Choose pickup or delivery.', 'Elige recoger o entrega a domicilio.'));
        return null;
    }
    if (!paymentMethod) {
        showFormError(t('Choose a payment method.', 'Elige un método de pago.'));
        return null;
    }

    const info = {
        name: el('customerName').value.trim(),
        email: el('customerEmail').value.trim(),
        phone: el('customerPhone').value.trim(),
        deliveryMethod,
        paymentMethod,
        address: null
    };

    if (deliveryMethod !== 'delivery') {
        return info;
    }

    if (el('addressCountry').value !== 'CA') {
        showFormError(t(
            'We deliver within Canada only. Please contact us to arrange delivery elsewhere — shipping costs would be added to your total.',
            'Solo entregamos dentro de Canadá. Por favor contáctanos para coordinar la entrega en otro país — los costos de envío se agregarían a tu total.'
        ));
        return null;
    }

    const postalCode = el('addressPostalCode').value.trim();
    if (!CANADIAN_POSTAL_CODE.test(postalCode)) {
        showFormError(t('Enter a valid Canadian postal code, for example V6B 1A1.',
                        'Ingresa un código postal canadiense válido, por ejemplo V6B 1A1.'));
        return null;
    }

    info.address = {
        line1: el('addressLine1').value.trim(),
        line2: el('addressLine2').value.trim(),
        city: el('addressCity').value.trim(),
        province: el('addressProvince').value,
        postalCode,
        country: 'CA'
    };

    if (!info.address.line1 || !info.address.city || !info.address.province) {
        showFormError(t('Fill in your full delivery address.', 'Completa tu dirección de entrega.'));
        return null;
    }

    return info;
}

function setupCheckoutForm() {
    const orderForm = document.getElementById('orderForm');
    if (!orderForm) return;

    el('deliveryMethod')?.addEventListener('change', () => {
        hideFormError();
        updateCheckoutForm();
    });

    el('addressCountry')?.addEventListener('change', () => {
        hideFormError();
        updateCheckoutForm();
    });

    orderForm.addEventListener('change', event => {
        if (event.target.name === 'paymentMethod') {
            hideFormError();
            updateSubmitButton();
        }
    });

    orderForm.addEventListener('submit', event => {
        event.preventDefault();

        const customerInfo = collectCustomerInfo();
        if (customerInfo) submitOrder(customerInfo);
    });

    updateCheckoutForm();
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
