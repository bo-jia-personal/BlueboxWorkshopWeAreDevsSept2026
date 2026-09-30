const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const port = Number(process.env.PORT || 8088);
const paymentUrl = process.env.PAYMENT_URL || 'http://localhost:4004';
const postgrestUrl = process.env.POSTGREST_URL || 'http://localhost:3000';

/** Parses a positive safe integer or returns its default.
 * @param {string|number|undefined} value Configured numeric value.
 * @param {number} fallback Value used when the input is invalid.
 * @returns {number} Positive safe integer.
 */
const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const databaseConcurrency = positiveInteger(
  process.env.DATABASE_CONCURRENCY,
  10,
);
const databaseQueueLimit = positiveInteger(
  process.env.DATABASE_QUEUE_LIMIT,
  100,
);
let activeDatabaseRequests = 0;
const databaseQueue = [];
const products = [
  {
    id: 'aurora-mug',
    name: 'Aurora Field Mug',
    description: 'A durable enamel mug for early starts and late ideas.',
    priceCents: 2400,
    category: 'Desk',
    emoji: '☕',
  },
  {
    id: 'signal-notebook',
    name: 'Signal Notebook',
    description: 'Dot-grid pages for diagrams, traces, and half-formed plans.',
    priceCents: 1800,
    category: 'Desk',
    emoji: '📓',
  },
  {
    id: 'orbit-lamp',
    name: 'Orbit Desk Lamp',
    description: 'A warm, adjustable glow for focused work.',
    priceCents: 6400,
    category: 'Studio',
    emoji: '💡',
  },
  {
    id: 'cloud-socks',
    name: 'Cloudline Socks',
    description: 'Soft merino socks for long pairing sessions.',
    priceCents: 1600,
    category: 'Wear',
    emoji: '🧦',
  },
  {
    id: 'field-bag',
    name: 'Field Notes Bag',
    description: 'A compact canvas carry for your everyday kit.',
    priceCents: 5200,
    category: 'Carry',
    emoji: '👜',
  },
  {
    id: 'night-hoodie',
    name: 'Night Shift Hoodie',
    description: 'A heavyweight layer for cool offices and warmer thinking.',
    priceCents: 7200,
    category: 'Wear',
    emoji: '🧥',
  },
];

/** Writes an HTTP response with the requested content type.
 * @param {import('node:http').ServerResponse} res Outgoing response.
 * @param {number} status HTTP status code.
 * @param {unknown} value Response body.
 * @param {string} [type='application/json'] Response content type.
 * @returns {void}
 */
const send = (res, status, value, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(value) : value);
};

/** Reads and parses a JSON request body.
 * @param {import('node:http').IncomingMessage} req Incoming request stream.
 * @returns {Promise<object>} Parsed body, or an empty object for an empty body.
 */
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let value = '';
    req.on('data', (chunk) => {
      value += chunk;
    });
    req.on('end', () => resolve(value ? JSON.parse(value) : {}));
    req.on('error', reject);
  });

/** Acquires an active database slot or queues the request within the configured limit.
 * @returns {Promise<void>} Resolves when a database slot is acquired.
 */
const acquireDatabaseSlot = () =>
  new Promise((resolve, reject) => {
    if (activeDatabaseRequests < databaseConcurrency) {
      activeDatabaseRequests += 1;
      resolve();
      return;
    }
    if (databaseQueue.length >= databaseQueueLimit) {
      console.error(
        JSON.stringify({
          event: 'database_queue_full',
          concurrency: databaseConcurrency,
          queueLimit: databaseQueueLimit,
        }),
      );
      const error = new Error('database request queue full');
      error.statusCode = 503;
      reject(error);
      return;
    }
    databaseQueue.push(resolve);
  });

/** Releases a database slot and transfers it to the next queued request.
 * @returns {void}
 */
const releaseDatabaseSlot = () => {
  const next = databaseQueue.shift();
  if (next) next();
  else activeDatabaseRequests -= 1;
};

/** Sends a request through PostgREST while holding a bounded database slot.
 * @param {string} url PostgREST path and query.
 * @param {object} [options] Fetch options.
 * @returns {Promise<unknown>} Parsed response body.
 */
const database = async (url, options = {}) => {
  await acquireDatabaseSlot();
  try {
    const response = await fetch(`${postgrestUrl}${url}`, {
      ...options,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text };
    }
    if (!response.ok)
      throw new Error(
        data?.message ||
          data?.details ||
          `Database request failed: ${response.status}`,
      );
    return data;
  } finally {
    releaseDatabaseSlot();
  }
};

/** Adds API sale fields and selects the effective price for a database product.
 * @param {object} product Raw PostgREST product row.
 * @returns {object} Product mapped to the shop API response shape.
 */
const mapProduct = (product) => {
  const salePriceCents = product.sale_price_cents ?? null;
  return {
    ...product,
    onSale: salePriceCents !== null,
    originalPriceCents: product.price_cents,
    salePriceCents,
    priceCents: salePriceCents ?? product.price_cents,
    price_cents: undefined,
    sale_price_cents: undefined,
  };
};

/** Loads a user's cart and maps each joined product to the API response shape.
 * @param {string} userId Cart owner identifier.
 * @returns {Promise<object[]>} Cart entries with mapped products and quantities.
 */
const cart = (userId) =>
  database(
    `/carts?user_id=eq.${encodeURIComponent(userId)}&select=quantity,products(*)`,
  ).then((items) =>
    items.map((item) => ({
      product: mapProduct(item.products),
      quantity: item.quantity,
    })),
  );

/** Logs a product action without including customer identifiers.
 * @param {string} action Action name such as cart_add or purchase.
 * @param {string} productId Product identifier.
 * @param {number} quantity Number of units involved.
 * @returns {void}
 */
const recordProductAction = (action, productId, quantity) =>
  console.log(
    JSON.stringify({
      event: 'shop.product_action',
      action,
      product_id: productId,
      quantity,
    }),
  );

/** Handles shop API routes and sends their HTTP responses.
 * @param {import('node:http').IncomingMessage} req Incoming request.
 * @param {import('node:http').ServerResponse} res Outgoing response.
 * @param {URL} url Parsed request URL.
 * @returns {Promise<void>} Resolves after the route response is sent.
 */
async function route(req, res, url) {
  if (url.pathname === '/health')
    return send(res, 200, { status: 'ok', service: 'shop-api' });
  if (url.pathname === '/api/products' && req.method === 'GET')
    return send(
      res,
      200,
      (await database('/products?select=*&order=name')).map(mapProduct),
    );
  const userId = url.searchParams.get('userId') || 'workshop-user';
  if (url.pathname === '/api/cart' && req.method === 'GET')
    return send(res, 200, await cart(userId));
  if (url.pathname === '/api/cart' && req.method === 'POST') {
    const input = await readBody(req);
    const existing = await database(
      `/carts?user_id=eq.${encodeURIComponent(userId)}&product_id=eq.${encodeURIComponent(input.productId)}&select=quantity`,
    );
    const quantity = (existing[0]?.quantity || 0) + Number(input.quantity || 1);
    await database('/carts', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        user_id: userId,
        product_id: input.productId,
        quantity,
      }),
    });
    recordProductAction(
      'cart_add',
      input.productId,
      Number(input.quantity || 1),
    );
    return send(res, 200, await cart(userId));
  }
  if (url.pathname === '/api/cart' && req.method === 'DELETE') {
    await database(`/carts?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    return send(res, 204, null);
  }
  if (url.pathname === '/api/checkout' && req.method === 'POST') {
    const input = await readBody(req);
    const items = await cart(userId);
    if (!items.length) return send(res, 400, { error: 'Your cart is empty' });
    const totalCents = items.reduce(
      (total, item) => total + item.product.priceCents * item.quantity,
      0,
    );
    const orderId = `order_${randomUUID().slice(0, 8)}`;

    /** Charges the current order with a bounded payment timeout.
     * @param {number} attempt Payment attempt number.
     * @returns {Promise<object>} Payment service response.
     */
    const charge = (attempt) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 150);
      return fetch(`${paymentUrl}/charge`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amountCents: totalCents,
          email: input.email,
          orderId,
          attempt,
          cardLast4: input.cardNumber?.slice(-4),
        }),
      })
        .then((response) => response.json())
        .finally(() => clearTimeout(timeout));
    };
    let payment;
    try {
      payment = await charge(1);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'payment_timeout_retrying',
          orderId,
          reason: error.name,
        }),
      );
      payment = await charge(2);
    }
    if (payment.status !== 'approved')
      return send(res, 402, { error: 'Payment was declined' });
    for (const item of items)
      recordProductAction('purchase', item.product.id, item.quantity);
    await database(`/carts?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    return send(res, 200, {
      orderId,
      totalCents,
      payment,
      shipping: input.shipping,
    });
  }
  if (['/', '/index.html', '/cart', '/checkout'].includes(url.pathname))
    return send(
      res,
      200,
      fs.readFileSync(path.join(__dirname, 'frontend/index.html'), 'utf8'),
      'text/html',
    );
  if (url.pathname === '/app.js')
    return send(
      res,
      200,
      fs.readFileSync(path.join(__dirname, 'frontend/app.js'), 'utf8'),
      'text/javascript',
    );
  if (url.pathname === '/styles.css')
    return send(
      res,
      200,
      fs.readFileSync(path.join(__dirname, 'frontend/styles.css'), 'utf8'),
      'text/css',
    );
  if (url.pathname === '/flash-sale.css')
    return send(
      res,
      200,
      fs.readFileSync(path.join(__dirname, 'frontend/flash-sale.css'), 'utf8'),
      'text/css',
    );
  return send(res, 404, { error: 'Not found' });
}

/** Converts an uncaught route error into a logged HTTP error response.
 * @param {Error} error Route error.
 * @param {import('node:http').ServerResponse} res Outgoing response.
 * @returns {void}
 */
const handleRouteError = (error, res) => {
  console.error(error);
  send(res, error.statusCode || 500, { error: error.message });
};

/** Parses and dispatches one incoming HTTP request.
 * @param {import('node:http').IncomingMessage} req Incoming request.
 * @param {import('node:http').ServerResponse} res Outgoing response.
 * @returns {Promise<void>} Resolves after the route or error response is sent.
 */
const handleRequest = (req, res) =>
  route(req, res, new URL(req.url, `http://${req.headers.host}`)).catch(
    (error) => handleRouteError(error, res),
  );

/** Logs the shop API address after the HTTP server starts listening.
 * @returns {void}
 */
const onServerListening = () =>
  console.log(`shop API and frontend running at http://localhost:${port}`);

http.createServer(handleRequest).listen(port, onServerListening);
