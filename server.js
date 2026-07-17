const express = require('express');
const path = require('path');
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_YOUR_KEY_HERE');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ── Helpers ── */
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const PROMOS_FILE = path.join(__dirname, 'promos.json');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function genId() {
  return 'SS-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
}

/* ── Stripe: Create Payment Intent ── */
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, items, customer } = req.body;
    if (!amount || amount < 50) return res.status(400).json({ error: 'Invalid amount' });
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount), // cents
      currency: 'usd',
      metadata: {
        customerName: customer?.name || '',
        customerEmail: customer?.email || '',
        itemCount: items?.length || 0
      }
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Orders ── */
app.post('/api/orders', (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  const order = {
    id: genId(),
    items: req.body.items || [],
    customer: req.body.customer || {},
    subtotal: req.body.subtotal || 0,
    discount: req.body.discount || 0,
    shipping: req.body.shipping || 0,
    total: req.body.total || 0,
    promoCode: req.body.promoCode || null,
    status: 'new',
    createdAt: new Date().toISOString(),
    stripePaymentId: req.body.stripePaymentId || null
  };
  orders.push(order);
  writeJSON(ORDERS_FILE, orders);
  res.json(order);
});

app.get('/api/orders', (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  res.json(orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.patch('/api/orders/:id', (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });
  if (req.body.status) orders[idx].status = req.body.status;
  writeJSON(ORDERS_FILE, orders);
  res.json(orders[idx]);
});

/* ── Stats ── */
app.get('/api/stats', (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now - 7 * 86400000);
  const monthAgo = new Date(now - 30 * 86400000);

  let today = 0, week = 0, month = 0, total = 0;
  const sellerMap = {};

  orders.forEach(o => {
    const d = new Date(o.createdAt);
    const amt = o.total || 0;
    total += amt;
    if (o.createdAt?.slice(0, 10) === todayStr) today += amt;
    if (d >= weekAgo) week += amt;
    if (d >= monthAgo) month += amt;
    (o.items || []).forEach(it => {
      sellerMap[it.name] = (sellerMap[it.name] || 0) + (it.qty || 1);
    });
  });

  const topSellers = Object.entries(sellerMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  res.json({
    today: +today.toFixed(2),
    week: +week.toFixed(2),
    month: +month.toFixed(2),
    total: +total.toFixed(2),
    orderCount: orders.length,
    avgValue: orders.length ? +(total / orders.length).toFixed(2) : 0,
    topSellers
  });
});

/* ── Promos ── */
app.post('/api/promo', (req, res) => {
  const promos = readJSON(PROMOS_FILE);
  const code = (req.body.code || '').toUpperCase().trim();
  const discount = parseInt(req.body.discount) || 0;
  if (!code || discount < 1 || discount > 100) return res.status(400).json({ error: 'Invalid promo' });
  if (promos.find(p => p.code === code)) return res.status(409).json({ error: 'Code already exists' });
  const promo = { code, discount, active: true, createdAt: new Date().toISOString() };
  promos.push(promo);
  writeJSON(PROMOS_FILE, promos);
  res.json(promo);
});

app.get('/api/promos', (req, res) => {
  res.json(readJSON(PROMOS_FILE));
});

app.delete('/api/promo/:code', (req, res) => {
  let promos = readJSON(PROMOS_FILE);
  const before = promos.length;
  promos = promos.filter(p => p.code !== req.params.code.toUpperCase());
  if (promos.length === before) return res.status(404).json({ error: 'Not found' });
  writeJSON(PROMOS_FILE, promos);
  res.json({ ok: true });
});

app.patch('/api/promo/:code', (req, res) => {
  const promos = readJSON(PROMOS_FILE);
  const p = promos.find(p => p.code === req.params.code.toUpperCase());
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.body.active !== undefined) p.active = req.body.active;
  writeJSON(PROMOS_FILE, promos);
  res.json(p);
});

/* ── Admin page ── */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

/* ── Catch-all ── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Street Scentz running on port ${PORT}`);
});
