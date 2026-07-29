// ============================================
// CART MANAGEMENT
// ============================================

let cart = JSON.parse(localStorage.getItem('cart')) || [];
console.log("Loaded cart:", cart);
console.log("Script loaded at:", performance.now());

// Load cart from localStorage on page load
function loadCart() {
    const savedCart = localStorage.getItem('cart');
    console.log('Loading cart from localStorage:', savedCart);
    console.log('localStorage keys:', Object.keys(localStorage));
    
    if (savedCart) {
        try {
            cart = JSON.parse(savedCart);
            console.log('Cart parsed successfully:', cart);
        } catch (e) {
            console.error('Error parsing cart:', e);
            cart = [];
        }
    } else {
        console.log('No cart found in localStorage');
        cart = [];
    }
    updateCartCount();
    console.log('Cart after loading:', cart);
}

// Update cart count badge
function updateCartCount() {
    const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
    const cartCountElements = document.querySelectorAll('.cart-count');
    cartCountElements.forEach(el => {
        el.textContent = cartCount;
    });
}

function saveCart() {
    console.log("Saving cart:", cart);
    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartCount();
}


// Add item to cart
function addToCart(button) {
    console.log("Button dataset:", button.dataset);
    console.log("Cart BEFORE add:", cart);

    const { id, name, nameEs, price, image } = button.dataset;

    const existingItem = cart.find(item => item.id === id);

    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({
            id,
            name,
            nameEs,
            price: parseFloat(price),
            image,
            quantity: 1
        });
    }

    console.log("Cart AFTER add:", cart);

    saveCart();
}


// Show "Added to Cart" message
function showAddedToCartMessage() {
    const message = document.createElement('div');
    message.className = 'added-to-cart-message';
    message.textContent = currentLang === 'en' ? 'Added to cart!' : '¡Agregado al carrito!';
    message.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 1rem 2rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(message);
    
    setTimeout(() => {
        message.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => message.remove(), 300);
    }, 2000);
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Remove item from cart
function removeFromCart(id) {
    cart = cart.filter(item => item.id !== id);
    saveCart();
    renderCart();
}

// Update item quantity
function updateQuantity(id, change) {
    const item = cart.find(item => item.id === id);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) {
            removeFromCart(id);
        } else {
            saveCart();
            renderCart();
        }
    }
}

// Render cart page
function renderCart() {
    const cartItemsContainer = document.getElementById('cartItems');
    const emptyCart = document.getElementById('emptyCart');
    const cartContent = document.getElementById('cartContent');
    
    if (!cartItemsContainer) return; // Not on cart page
    
    console.log('Rendering cart, items:', cart); // Debug log
    
    if (cart.length === 0) {
        emptyCart.style.display = 'block';
        cartContent.style.display = 'none';
        return;
    }
    
    emptyCart.style.display = 'none';
    cartContent.style.display = 'grid';
    
    cartItemsContainer.innerHTML = '';
    
    cart.forEach(item => {
        const itemTotal = (item.price * item.quantity).toFixed(2);
        const itemName = currentLang === 'es' ? item.nameEs : item.name;
        
        const cartItemHTML = `
            <div class="cart-item">
                <div class="cart-item-image">
                    <img src="${item.image}" alt="${itemName}">
                </div>
                <div class="cart-item-details">
                    <h3>${itemName}</h3>
                    <p class="cart-item-price">${item.price.toFixed(2)}</p>
                    <div class="quantity-controls">
                        <button class="qty-btn" onclick="updateQuantity('${item.id}', -1)">−</button>
                        <span class="qty-display">${item.quantity}</span>
                        <button class="qty-btn" onclick="updateQuantity('${item.id}', 1)">+</button>
                    </div>
                </div>
                <div class="cart-item-actions">
                    <div class="item-total">${itemTotal}</div>
                    <button class="remove-btn" onclick="removeFromCart('${item.id}')" data-en="Remove" data-es="Eliminar">Remove</button>
                </div>
            </div>
        `;
        
        cartItemsContainer.innerHTML += cartItemHTML;
    });
    
    updateCartSummary();
    
    // Update language for dynamically added elements
    const translatableElements = cartItemsContainer.querySelectorAll('[data-en][data-es]');
    translatableElements.forEach(element => {
        element.textContent = element.getAttribute(`data-${currentLang}`);
    });
}

// Update cart summary
function updateCartSummary() {
    const subtotalElement = document.getElementById('subtotal');
    const totalElement = document.getElementById('total');
    
    if (!subtotalElement || !totalElement) return; // Not on cart page
    
    const subtotal = cart.reduce((total, item) => total + (item.price * item.quantity), 0);
    
    subtotalElement.textContent = `${subtotal.toFixed(2)}`;
    totalElement.textContent = `${subtotal.toFixed(2)}`;
}

// Submit Order (Simple - No Payment)
async function submitOrder(customerInfo) {
    // Replace with your deployed Vercel URL after deployment
    const backendUrl = 'https://your-vercel-app.vercel.app';
    
    try {
        // Show loading state
        const submitBtn = document.getElementById('submitOrderBtn');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = currentLang === 'en' ? 'Submitting...' : 'Enviando...';
        
        // Call your backend to submit order
        const response = await fetch(`${backendUrl}/api/submit-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                items: cart,
                customerInfo: customerInfo
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to submit order');
        }
        
        const result = await response.json();
        
        // Clear cart
        cart = [];
        localStorage.removeItem('cart');
        updateCartCount();
        
        // Show success message
        alert(currentLang === 'en' 
            ? `Order submitted successfully! Order #${result.orderNumber}\n\nWe will contact you via WhatsApp shortly to arrange payment and delivery.`
            : `¡Pedido enviado exitosamente! Pedido #${result.orderNumber}\n\nTe contactaremos por WhatsApp pronto para coordinar el pago y la entrega.`
        );
        
        // Redirect to home
        window.location.href = './home.html';
        
    } catch (error) {
        console.error('Error:', error);
        alert(currentLang === 'en' 
            ? 'An error occurred. Please try again or contact us directly.'
            : 'Ocurrió un error. Por favor intenta de nuevo o contáctanos directamente.');
        const submitBtn = document.getElementById('submitOrderBtn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = currentLang === 'en' ? 'Submit Order Request' : 'Enviar Solicitud de Pedido';
        }
    }
}

// Stripe Checkout (Keep for future use)
async function initiateCheckout(customerInfo) {
    // Replace with your actual Stripe publishable key from https://dashboard.stripe.com/test/apikeys
    const stripe = Stripe('pk_test_YOUR_PUBLISHABLE_KEY_HERE');
    
    // Replace with your deployed Vercel URL after deployment
    const backendUrl = 'https://your-vercel-app.vercel.app';
    
    try {
        // Show loading state
        const checkoutBtn = document.getElementById('checkoutBtn');
        const originalText = checkoutBtn.textContent;
        checkoutBtn.disabled = true;
        checkoutBtn.textContent = currentLang === 'en' ? 'Processing...' : 'Procesando...';
        
        // Call your backend to create checkout session
        const response = await fetch(`${backendUrl}/api/create-checkout-session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                items: cart,
                customerInfo: customerInfo
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to create checkout session');
        }
        
        const session = await response.json();
        
        // Redirect to Stripe Checkout
        const result = await stripe.redirectToCheckout({
            sessionId: session.id
        });
        
        if (result.error) {
            alert(result.error.message);
            checkoutBtn.disabled = false;
            checkoutBtn.textContent = originalText;
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred. Please try again.');
        const checkoutBtn = document.getElementById('checkoutBtn');
        if (checkoutBtn) {
            checkoutBtn.disabled = false;
            checkoutBtn.textContent = currentLang === 'en' ? 'Proceed to Checkout' : 'Proceder al Pago';
        }
    }
}

// ============================================
// NAVIGATION & UI
// ============================================

// Burger Menu Toggle
const burger = document.querySelector('.burger');
const nav = document.querySelector('.nav-links');
const navLinks = document.querySelectorAll('.nav-links a');

// Language Switcher
let currentLang = 'en';
const langBtn = document.getElementById('langBtn');

function switchLanguage() {
    currentLang = currentLang === 'en' ? 'es' : 'en';
    langBtn.textContent = currentLang === 'en' ? 'ES' : 'EN';
    
    // Update all elements with data-en and data-es attributes
    const translatableElements = document.querySelectorAll('[data-en][data-es]');
    translatableElements.forEach(element => {
        const translation = element.getAttribute(`data-${currentLang}`);
        if (translation) {
            element.textContent = translation;
        }
    });
    
    // Re-render cart if on cart page to update language
    if (typeof renderCart === 'function' && document.getElementById('cartItems')) {
        renderCart();
    }
}

if (langBtn) {
    langBtn.addEventListener('click', switchLanguage);
}

burger.addEventListener('click', () => {
    nav.classList.toggle('active');
    burger.classList.toggle('active');
});

// Close menu when clicking a link
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        nav.classList.remove('active');
        burger.classList.remove('active');
    });
});

// ============================================
// SLIDESHOW
// ============================================

let currentSlide = 0;
const slides = document.querySelectorAll('.slide');
const dots = document.querySelectorAll('.slide-dot');

function showSlide(n) {
    slides.forEach(slide => slide.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));
    
    currentSlide = (n + slides.length) % slides.length;
    
    slides[currentSlide].classList.add('active');
    dots[currentSlide].classList.add('active');
}

function nextSlide() {
    showSlide(currentSlide + 1);
}

// Auto-advance slideshow (only if slides exist)
if (slides.length > 0) {
    let slideInterval = setInterval(nextSlide, 5000);

    // Manual navigation with dots
    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            clearInterval(slideInterval);
            showSlide(index);
            slideInterval = setInterval(nextSlide, 5000);
        });
    });
}

// ============================================
// WINDOW RESIZE HANDLING
// ============================================

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        // Close mobile menu on resize to desktop
        if (window.innerWidth > 768) {
            nav.classList.remove('active');
            burger.classList.remove('active');
        }
    }, 250);
});

// ============================================
// SMOOTH SCROLLING
// ============================================

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        
        // Ignore if it's just "#" or empty
        if (!href || href === '#') return;
        
        const target = document.querySelector(href);
        
        // Only scroll if the target element exists on THIS page
        if (target) {
            e.preventDefault();
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
        // If target doesn't exist, let the browser handle the link normally
    });
});

// ============================================
// INITIALIZATION
// ============================================

// 1. Wait for the page to load
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing cart system...');
    
    // Load saved cart
    loadCart();

    // If on cart page, render it
    if (document.getElementById('cartItems')) {
        console.log('Rendering cart page...');
        renderCart();
        
        // Setup checkout form
        setupCheckoutForm();
    }

    // Attach add-to-cart listeners (product pages)
    const cartButtons = document.querySelectorAll('.add-to-cart');
    cartButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            addToCart(e.currentTarget);
        });
    });
});

// Setup checkout form functionality
function setupCheckoutForm() {
    const orderForm = document.getElementById('orderForm');
    
    // Handle form submission for simple orders
    if (orderForm) {
        orderForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const customerInfo = {
                name: document.getElementById('customerName').value,
                email: document.getElementById('customerEmail').value,
                phone: document.getElementById('customerPhone').value,
                deliveryMethod: document.getElementById('deliveryMethod').value
            };
            
            submitOrder(customerInfo);
        });
    }
    
    // Old checkout form setup (for Stripe version - keep for future)
    const deliveryMethod = document.getElementById('deliveryMethod');
    const shippingFields = document.getElementById('shippingFields');
    const checkoutForm = document.getElementById('checkoutForm');
    const country = document.getElementById('country');
    const stateLabel = document.getElementById('stateLabel');
    
    // Show/hide shipping fields based on delivery method
    if (deliveryMethod && shippingFields) {
        deliveryMethod.addEventListener('change', function() {
            if (this.value === 'delivery') {
                shippingFields.style.display = 'block';
                // Make shipping fields required
                document.getElementById('street').required = true;
                document.getElementById('city').required = true;
                document.getElementById('state').required = true;
                document.getElementById('postalCode').required = true;
            } else {
                shippingFields.style.display = 'none';
                // Make shipping fields optional
                document.getElementById('street').required = false;
                document.getElementById('city').required = false;
                document.getElementById('state').required = false;
                document.getElementById('postalCode').required = false;
            }
        });
    }
    
    // Update state label based on country
    if (country) {
        country.addEventListener('change', function() {
            if (this.value === 'US') {
                stateLabel.textContent = 'State *';
            } else if (this.value === 'CA') {
                stateLabel.textContent = 'Province *';
            } else {
                stateLabel.textContent = 'State/Province *';
            }
        });
    }
    
    // Handle form submission for Stripe checkout (keep for future)
    if (checkoutForm) {
        checkoutForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const customerInfo = {
                name: document.getElementById('customerName').value,
                email: document.getElementById('customerEmail').value,
                deliveryMethod: document.getElementById('deliveryMethod').value
            };
            
            if (customerInfo.deliveryMethod === 'delivery') {
                customerInfo.shipping = {
                    street: document.getElementById('street').value,
                    city: document.getElementById('city').value,
                    state: document.getElementById('state').value,
                    postalCode: document.getElementById('postalCode').value,
                    country: document.getElementById('country').value
                };
            }
            
            initiateCheckout(customerInfo);
        });
    }
}


// Helper functions for debugging (can be called from browser console)
window.viewCart = function() {
    console.log('Current cart:', cart);
    console.log('LocalStorage cart:', localStorage.getItem('cart'));
    return cart;
};

window.clearCart = function() {
    cart = [];
    localStorage.removeItem('cart');
    updateCartCount();
    if (document.getElementById('cartItems')) {
        renderCart();
    }
    console.log('Cart cleared');
};