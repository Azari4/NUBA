const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const port = 34129;
const base = `http://127.0.0.1:${port}`;
let server;
let startupLog = '';

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${base}/api/products`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`El servidor de prueba no inició. ${startupLog}`);
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      PORT: String(port), DATABASE_URL: 'pgmem', JWT_SECRET: 'test-secret',
      ADMIN_USER: 'admin', ADMIN_PASSWORD: 'test-password', WHATSAPP_NUMBER: '5491100000000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', data => { startupLog += data; });
  server.stderr.on('data', data => { startupLog += data; });
  await waitForServer();
});

test.after(() => server?.kill());

test('cliente puede ver catálogo y crear un pedido con precio calculado por el servidor', async () => {
  const products = await (await fetch(`${base}/api/products`)).json();
  assert.ok(products.length > 0);
  const product = products.find(p => p.variants?.some(v => v.stock > 0 && p.price > 0));
  assert.ok(product, 'debe existir un producto vendible de prueba');
  const variant = product.variants.find(v => v.stock > 0);
  const response = await fetch(`${base}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customer: { name: 'Cliente de prueba', phone: '1112345678', delivery: 'Retiro' },
      // El precio inyectado no forma parte del contrato: el backend debe ignorarlo.
      items: [{ id: product.id, variantId: variant.id, quantity: 1, price: 1 }],
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${body.error}; producto=${product.id}; variante=${variant.id}; stock=${variant.stock}`);
  const order = body;
  assert.match(order.orderNumber, /^NUBA-/);
  assert.equal(order.total, Number(product.price) + Number(variant.additional_price));
  assert.match(order.whatsapp, /^https:\/\/wa\.me\//);
});

test('pedido inválido se rechaza sin crear orden', async () => {
  const response = await fetch(`${base}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customer: { name: 'A', phone: '1' }, items: [{ id: 1, quantity: 0 }] }),
  });
  assert.equal(response.status, 400);
});
