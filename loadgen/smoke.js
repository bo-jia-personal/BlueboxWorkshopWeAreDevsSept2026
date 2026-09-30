import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.TARGET_URL || 'http://shop:8088';
const products = ['aurora-mug', 'signal-notebook', 'orbit-lamp', 'cloud-socks', 'field-bag', 'night-hoodie'];

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '60s',
  thresholds: {
    http_req_failed: ['rate<0.25'],
  },
};

function jsonRequest(method, path, payload, tags) {
  return http.request(method, `${baseUrl}${path}`, payload ? JSON.stringify(payload) : null, {
    headers: { 'Content-Type': 'application/json' },
    tags,
  });
}

export default function () {
  const userId = `loadgen-${__VU}-${__ITER}`;
  const tags = { workload: 'workshop-shop', user_id: userId };

  const catalog = http.get(`${baseUrl}/api/products`, { tags: { ...tags, operation: 'catalog' } });
  check(catalog, { 'catalog responds': response => response.status === 200 });
  const catalogProducts = catalog.json();
  const saleProducts = catalogProducts.filter(product => product.onSale);
  check(catalog, {
    'exactly two products have a 20% sale': response => saleProducts.length === 2 && saleProducts.every(product => product.priceCents === product.salePriceCents && product.salePriceCents === Math.round(product.originalPriceCents * 0.8)),
  });
  const saleProduct = saleProducts.length ? saleProducts[__VU % saleProducts.length] : catalogProducts[0];
  const productIds = [saleProduct.id, ...products.filter(productId => productId !== saleProduct.id).slice(0, 3)];

  productIds.forEach(productId => {
    const add = jsonRequest('POST', `/api/cart?userId=${userId}`, { productId, quantity: 1 }, { ...tags, operation: 'cart_add' });
    check(add, {
      'cart accepts item': response => response.status === 200,
      'cart returns the discounted sale price': response => {
        if (productId !== saleProduct.id) return true;
        const item = response.json().find(entry => entry.product.id === saleProduct.id);
        return item?.product.onSale && item.product.priceCents === item.product.salePriceCents;
      },
    });
  });

  const cart = http.get(`${baseUrl}/api/cart?userId=${userId}`, { tags: { ...tags, operation: 'cart_read' } });
  check(cart, { 'cart responds': response => response.status === 200 });
  const cartTotalCents = cart.json().reduce((total, item) => total + item.product.priceCents * item.quantity, 0);

  if (__ITER % 3 === 0) {
    const checkout = jsonRequest('POST', `/api/checkout?userId=${userId}`, {
      email: `loadgen-${__VU}@example.com`,
      cardNumber: '4242424242424242',
      shipping: { firstName: 'Load', lastName: 'Generator', address: '1 Workshop Way', city: 'Localhost', postalCode: '8088' },
    }, { ...tags, operation: 'checkout' });
    check(checkout, {
      'checkout responds': response => response.status === 200,
      'checkout charges the discounted cart total': response => response.status !== 200 || response.json().totalCents === cartTotalCents,
    });
  }

  sleep(0.5);
}
