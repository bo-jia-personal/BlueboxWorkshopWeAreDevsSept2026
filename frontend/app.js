const userId = 'workshop-user';

/** Formats a cent amount as a US dollar price.
 * @param {number} cents Price in cents.
 * @returns {string} Formatted currency.
 */
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

/** Builds the sale badge for a discounted product.
 * @param {object} product Product returned by the shop API.
 * @returns {string} Badge markup, or an empty string when not on sale.
 */
const saleBadge = (product) =>
  product.onSale ? '<mark class="sale-badge">20% OFF</mark>' : '';

/** Builds regular or discounted price markup for a quantity.
 * @param {object} product Product returned by the shop API.
 * @param {number} [quantity=1] Number of units to price.
 * @returns {string} Price markup for the requested quantity.
 */
const priceMarkup = (product, quantity = 1) =>
  product.onSale
    ? `<span class="price-stack"><del>${money(product.originalPriceCents * quantity)}</del> <strong>${money(product.priceCents * quantity)}</strong></span>`
    : `<strong>${money(product.priceCents * quantity)}</strong>`;

/** Sends a request to the shop API and parses its response.
 * @param {string} path API path.
 * @param {RequestInit} [options] Fetch options.
 * @returns {Promise<unknown>} Parsed response data, or null for HTTP 204.
 */
const api = (path, options) =>
  fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  }).then(async (response) => {
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  });
let products = [];
let cart = [];

/** Updates the navigation cart item count.
 * @returns {void}
 */
const renderCount = () => {
  document.querySelector('#cart-count').textContent = cart.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
};

/** Loads the current user's cart and renders it.
 * @returns {Promise<void>} Resolves after the cart response is applied.
 */
const loadCart = () =>
  api(`/api/cart?userId=${userId}`).then((items) => {
    cart = items;
    renderCart();
  });
/** Renders cart items, sale prices, and the discounted total.
 * @returns {void}
 */
const renderCart = () => {
  renderCount();
  const target = document.querySelector('#cart-items');
  if (!target) return;
  target.innerHTML = cart.length
    ? cart
        .map(
          (item) =>
            `<div class="cart-item"><span>${item.product.emoji} ${item.product.name} × ${item.quantity} ${saleBadge(item.product)}</span>${priceMarkup(item.product, item.quantity)}</div>`,
        )
        .join('')
    : '<p class="muted">Your cart is empty.</p>';
  const total = cart.reduce(
    (sum, item) => sum + item.product.priceCents * item.quantity,
    0,
  );
  const totalElement = document.querySelector('#cart-total');
  if (totalElement) totalElement.textContent = money(total);
};
/** Adds one product to the current user's cart.
 * @param {string} id Product ID.
 * @returns {Promise<void>} Resolves after the cart is refreshed.
 */
const add = (id) =>
  api(`/api/cart?userId=${userId}`, {
    method: 'POST',
    body: JSON.stringify({ productId: id, quantity: 1 }),
  }).then((items) => {
    cart = items;
    renderCart();
  });

/** Renders catalog products and connects their add-to-cart buttons.
 * @param {object[]} items Products returned by the catalog endpoint.
 * @returns {void}
 */
const renderProducts = (items) => {
  products = items;
  document.querySelector('#status').textContent = `${items.length} items`;
  document.querySelector('#products').innerHTML = items
    .map(
      (product) => `
        <article class="product">
          <div class="product-art">${product.emoji}</div>
          ${saleBadge(product)}
          <p class="category">${product.category}</p>
          <h3>${product.name}</h3>
          <p>${product.description}</p>
          <div class="product-foot">
            ${priceMarkup(product)}
            <button data-id="${product.id}">Add to cart</button>
          </div>
        </article>
      `,
    )
    .join('');
  document
    .querySelectorAll('[data-id]')
    .forEach((button) =>
      button.addEventListener('click', addProductFromButton),
    );
};

/** Adds the product identified by a catalog button click.
 * @param {MouseEvent} event Click event from a product button.
 * @returns {Promise<void>} Resolves after the cart is refreshed.
 */
const addProductFromButton = (event) => add(event.currentTarget.dataset.id);

/** Displays a catalog loading error in the page status element.
 * @param {Error} error Error returned while loading catalog products.
 * @returns {void}
 */
const handleCatalogError = (error) => {
  document.querySelector('#status').textContent = error.message;
};

/** Loads and renders the catalog page.
 * @returns {void}
 */
const shopPage = () => {
  document.querySelector('#app').innerHTML = `
      <section class="intro">
        <p class="eyebrow">Workshop commerce lab</p>
        <h1>Useful things for<br><em>curious work.</em></h1>
        <p>A tiny, editable ecommerce experience with a PostgreSQL catalog, persistent cart, checkout, and payment service.</p>
      </section>
      <section>
        <div class="section-heading">
          <h2>Shop the field notes</h2>
          <span id="status">Loading...</span>
        </div>
        <div id="products" class="product-grid"></div>
      </section>
    `;
  api('/api/products').then(renderProducts).catch(handleCatalogError);
};

/** Renders the cart page and its order summary.
 * @returns {void}
 */
const cartPage = () => {
  document.querySelector('#app').innerHTML = `
      <section class="page-heading">
        <p class="eyebrow">Your selection</p>
        <h1>Cart</h1>
        <p>Review your pieces, then move through a simple two-step checkout.</p>
      </section>
      <section class="cart-layout">
        <div>
          <div id="cart-items"></div>
          <a class="back-link" href="/">← Continue shopping</a>
        </div>
        <aside class="summary">
          <h2>Order summary</h2>
          <div class="total">
            <span>Total</span>
            <strong id="cart-total">$0.00</strong>
          </div>
          <a class="primary" href="/checkout">Continue to checkout</a>
        </aside>
      </section>
    `;
  renderCart();
};

/** Renders the checkout form and current order summary.
 * @returns {void}
 */
const checkoutPage = () => {
  document.querySelector('#app').innerHTML =
    `<section class="page-heading"><p class="eyebrow">Almost there</p><h1>Checkout</h1><p>Everything here is intentionally simple enough to edit during a workshop.</p></section><section class="checkout-layout"><form id="checkout"><fieldset><legend>1. Contact</legend><label>Email<input id="email" type="email" value="shopper@example.com" required></label></fieldset><fieldset><legend>2. Delivery</legend><div class="form-grid"><label>First name<input id="firstName" required></label><label>Last name<input id="lastName" required></label></div><label>Address<input id="address" required></label><div class="form-grid"><label>City<input id="city" required></label><label>Postal code<input id="postalCode" required></label></div></fieldset><fieldset><legend>3. Payment</legend><label>Card number<input id="cardNumber" inputmode="numeric" value="4242 4242 4242 4242" minlength="12" required></label><div class="form-grid"><label>Expiry<input value="12/30" required></label><label>CVV<input value="123" required></label></div></fieldset><button class="primary" type="submit">Pay and place order</button><p id="result"></p></form><aside class="summary"><h2>Your order</h2><div id="checkout-items"></div><div class="total"><span>Total</span><strong id="checkout-total">$0.00</strong></div><p class="muted">Secure demo payment. No real card is charged.</p></aside></section>`;
  const total = cart.reduce(
    (sum, item) => sum + item.product.priceCents * item.quantity,
    0,
  );
  document.querySelector('#checkout-total').textContent = money(total);
  document.querySelector('#checkout-items').innerHTML = cart
    .map(
      (item) =>
        `<p>${item.product.name} × ${item.quantity} ${saleBadge(item.product)}${priceMarkup(item.product, item.quantity)}</p>`,
    )
    .join('');
  document
    .querySelector('#checkout')
    .addEventListener('submit', submitCheckout);
};

/** Submits the checkout form to create and pay for an order.
 * @param {SubmitEvent} event Form submission event.
 * @returns {void}
 */
const submitCheckout = (event) => {
  event.preventDefault();
  const result = document.querySelector('#result');
  result.textContent = 'Processing payment...';
  api(`/api/checkout?userId=${userId}`, {
    method: 'POST',
    body: JSON.stringify({
      email: document.querySelector('#email').value,
      cardNumber: document.querySelector('#cardNumber').value,
      shipping: {
        firstName: document.querySelector('#firstName').value,
        lastName: document.querySelector('#lastName').value,
        address: document.querySelector('#address').value,
        city: document.querySelector('#city').value,
        postalCode: document.querySelector('#postalCode').value,
      },
    }),
  })
    .then((order) => handleCheckoutSuccess(order, result))
    .catch((error) => handleCheckoutError(error, result));
};

/** Displays the successful order result and clears the local cart.
 * @param {object} order Successful checkout response from the shop API.
 * @param {HTMLElement} result Element used to show checkout status.
 * @returns {void}
 */
const handleCheckoutSuccess = (order, result) => {
  result.textContent = `Order ${order.orderId} paid. Transaction ${order.payment.transactionId}.`;
  cart = [];
  renderCount();
};

/** Displays a checkout error to the shopper.
 * @param {Error} error Error returned while submitting checkout.
 * @param {HTMLElement} result Element used to show checkout status.
 * @returns {void}
 */
const handleCheckoutError = (error, result) => {
  result.textContent = error.message;
};

/** Selects the page that matches the current browser path.
 * @returns {void}
 */
const renderCurrentPage = () => {
  if (location.pathname === '/cart') cartPage();
  else if (location.pathname === '/checkout') checkoutPage();
  else shopPage();
};

loadCart().then(renderCurrentPage);
