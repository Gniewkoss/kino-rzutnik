#!/usr/bin/env node
// Test etapu II bez konta Stripe: sam uruchamia serwer (baza w pamięci) i atrapę API Stripe'a.
// Użycie: npm run chaos:stripe
import { spawn } from 'node:child_process';
import { startFakeStripe, signPayload, paidEvent } from './fake-stripe.mjs';

const PORT = 3100;
const STRIPE_PORT = 4300;
const SECRET = 'whsec_chaos';
const TTL_SECONDS = 3;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fake = await startFakeStripe({ port: STRIPE_PORT, webhookUrl: `${BASE}/api/webhooks/stripe`, webhookSecret: SECRET });
const server = spawn('node', ['src/server.js'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: {
    ...process.env,
    MONGODB_URI: '',
    PORT: String(PORT),
    RESERVATION_TTL_SECONDS: String(TTL_SECONDS),
    RATE_LIMIT_MAX: '1000',
    PUBLIC_URL: BASE,
    STRIPE_SECRET_KEY: 'sk_test_chaos',
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_API_BASE: `http://localhost:${STRIPE_PORT}`,
    ALLOW_DIRECT_PURCHASE: '',
  },
});

let failed = 0;
function check(name, ok, note = '') {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${note ? `  ${note}` : ''}`);
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const webhook = (payload, signature) => fetch(`${BASE}/api/webhooks/stripe`, {
  method: 'POST',
  headers: signature ? { 'Stripe-Signature': signature, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  body: payload,
});
const signedWebhook = (payload) => webhook(payload, signPayload(payload, SECRET));

let seatNo = 0;
let eventId;
async function reserve(seatId = `${'ABCDEFGH'[Math.floor(seatNo / 10)]}${(seatNo++ % 10) + 1}`, who = seatId) {
  const r = await call('POST', '/api/reservations', { eventId, seatId, customerName: `Tester ${who}`, email: `t${who}@example.com` });
  return { ...r, seatId, id: r.data?.reservationId };
}
const status = async (id) => (await call('GET', `/api/reservations/${id}`)).data;
const sessionOf = (id) => [...fake.state.sessions.values()].find((s) => s.client_reference_id === id);

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    await sleep(300);
  }

  // Karta A: cena i checkout
  const list = await call('GET', '/api/events');
  eventId = list.data[0]._id;
  check('A: GET /api/events ma price', list.data.every((e) => e.price === 3200));
  check('A: GET /api/events/:id ma price', (await call('GET', `/api/events/${eventId}`)).data.event.price === 3200);

  const r1 = await reserve();
  check('A: rezerwacja zwraca amount', r1.status === 201 && r1.data.amount === 3200);
  const repeat = await reserve(r1.seatId, r1.seatId);
  check('A: powtórzona rezerwacja ma tę samą kwotę', repeat.status === 200 && repeat.data.amount === 3200);

  const [c1, c2] = await Promise.all([call('POST', `/api/reservations/${r1.id}/checkout`), call('POST', `/api/reservations/${r1.id}/checkout`)]);
  check('A: checkout zwraca { url }', c1.status === 200 && Object.keys(c1.data).join() === 'url', c1.data?.url);
  check('A: podwójne „Zapłać” to ta sama sesja', c1.data.url === c2.data.url && fake.state.sessions.size === 1);
  const s1 = sessionOf(r1.id);
  check('A: sesja ma kwotę z rezerwacji, PLN i client_reference_id', s1.amount_total === 3200 && s1.currency === 'pln' && s1.client_reference_id === r1.id);
  check('A: sesja żyje min. 30 minut od teraz', s1.expires_at >= Date.now() / 1000 + 30 * 60);
  check('A: adresy powrotu z PUBLIC_URL', s1.success_url === `${BASE}/reservations/${r1.id}/payment` && s1.cancel_url.startsWith(`${BASE}/reservations/${r1.id}?`));
  check('A: checkout nieistniejącej rezerwacji to 404', (await call('POST', '/api/reservations/abc/checkout')).status === 404);

  // Karta C: status i strony powrotu
  const held = await status(r1.id);
  check('C: GET status "held", amount, expiresAt, bez kodu', held.status === 'held' && held.amount === 3200 && held.expiresAt && !held.code);
  check('C: strona powrotu po zapłacie istnieje', (await fetch(s1.success_url)).status === 200);
  check('C: strona po przerwaniu istnieje', (await fetch(s1.cancel_url)).status === 200);
  const again = await call('POST', `/api/reservations/${r1.id}/checkout`);
  check('C: po przerwaniu można płacić dalej', again.status === 200);

  // Sam zakup bez płatności nie daje biletu
  check('Bilet bez płatności: purchase to 402', (await call('POST', `/api/reservations/${r1.id}/purchase`)).status === 402);

  // Karta B: podpis
  const payload = paidEvent(s1);
  check('B: brak podpisu to 400', (await webhook(payload)).status === 400);
  check('B: zły podpis to 400', (await webhook(payload, signPayload(payload, 'whsec_zly'))).status === 400);
  check('B: stary podpis to 400', (await webhook(payload, signPayload(payload, SECRET, Math.floor(Date.now() / 1000) - 3600))).status === 400);
  check('B: podmienione ciało to 400', (await webhook(payload.replace('3200', '1'), signPayload(payload, SECRET))).status === 400);
  check('B: po złych podpisach dalej "held"', (await status(r1.id)).status === 'held');

  // Karta B: płatność
  check('B: dobry podpis to 200', (await signedWebhook(payload)).status === 200);
  const paid = await status(r1.id);
  check('B: rezerwacja "paid" z kodem', paid.status === 'paid' && /^RZ-/.test(paid.code), paid.code);
  check('B: powtórzony webhook to ten sam kod', (await signedWebhook(payload)).status === 200 && (await status(r1.id)).code === paid.code);
  const parallel = await Promise.all(Array.from({ length: 5 }, () => signedWebhook(paidEvent(s1))));
  check('B: 5 równoległych webhooków', parallel.every((r) => r.status === 200) && (await status(r1.id)).code === paid.code);
  check('B: bilet istnieje i ma kwotę', (await call('GET', `/api/tickets/${paid.code}`)).data.amount === 3200);
  check('A: checkout opłaconej rezerwacji to 409', (await call('POST', `/api/reservations/${r1.id}/checkout`)).status === 409);
  check('Etap I: purchase opłaconej zwraca ten sam kod', (await call('POST', `/api/reservations/${r1.id}/purchase`)).data.code === paid.code);

  // Zdarzenia, które nie są naszą płatnością
  const other = JSON.stringify({ id: 'evt_x', object: 'event', type: 'payment_intent.created', data: { object: {} } });
  check('B: inne zdarzenia to 200', (await signedWebhook(other)).status === 200);
  const stranger = paidEvent({ id: 'cs_obcy', client_reference_id: null, amount_total: 3000, currency: 'usd' });
  check('B: sesja bez rezerwacji to 200', (await signedWebhook(stranger)).status === 200);

  const r2 = await reserve();
  const wrong = paidEvent({ id: 'cs_zla_kwota', client_reference_id: r2.id, amount_total: 100, currency: 'pln' });
  await signedWebhook(wrong);
  check('B: zła kwota nie daje biletu', (await status(r2.id)).status === 'held');
  const unpaid = JSON.parse(paidEvent({ id: 'cs_bez_zaplaty', client_reference_id: r2.id, amount_total: 3200, currency: 'pln' }));
  unpaid.data.object.payment_status = 'unpaid';
  await signedWebhook(JSON.stringify(unpaid));
  check('B: payment_status "unpaid" nie daje biletu', (await status(r2.id)).status === 'held');

  // Awaria Stripe'a
  const r3 = await reserve();
  fake.state.down = true;
  const down = await call('POST', `/api/reservations/${r3.id}/checkout`);
  fake.state.down = false;
  check('Stripe nie działa: 5xx z komunikatem', down.status === 502 && down.data.message);
  check('Stripe nie działa: rezerwacja trwa dalej', (await status(r3.id)).status === 'held');
  check('Stripe wrócił: checkout działa', (await call('POST', `/api/reservations/${r3.id}/checkout`)).status === 200);

  // Płatność po czasie
  const late = await reserve();
  const taken = await reserve();
  await call('POST', `/api/reservations/${late.id}/checkout`);
  await call('POST', `/api/reservations/${taken.id}/checkout`);
  const sLate = sessionOf(late.id);
  const sTaken = sessionOf(taken.id);
  await sleep(TTL_SECONDS * 1000 + 300);

  check('Po czasie: status "expired"', (await status(late.id)).status === 'expired');
  check('Po czasie: checkout to 410', (await call('POST', `/api/reservations/${late.id}/checkout`)).status === 410);

  await signedWebhook(paidEvent(sLate));
  const lateStatus = await status(late.id);
  check('Po czasie, fotel wolny: bilet się należy, bez zwrotu', lateStatus.status === 'paid' && fake.state.refunds.length === 0);

  const newcomer = await reserve(taken.seatId, 'nowy');
  check('Fotel po wygasłej rezerwacji może wziąć ktoś inny', newcomer.status === 201);
  await sleep(200);
  check('Przejęcie fotela zamyka starą sesję', fake.state.expired.includes(sTaken.id));

  const lost = paidEvent(sTaken);
  check('Po czasie, fotel zajęty: webhook to 200', (await signedWebhook(lost)).status === 200);
  const lostStatus = await status(taken.id);
  check('Po czasie, fotel zajęty: bez biletu, ze zwrotem', lostStatus.status === 'expired' && lostStatus.refunded === true && !lostStatus.code);
  check('Zwrot dotyczy właściwej płatności', fake.state.refunds[0]?.payment_intent === `pi_${sTaken.id}`);
  await signedWebhook(lost);
  check('Powtórzony webhook nie robi drugiego zwrotu', fake.state.refunds.length === 1);
  check('Fotel nowej osoby nietknięty', (await status(newcomer.id)).status === 'held');
} finally {
  server.kill();
  fake.close();
}

console.log(failed ? `\n${failed} niezaliczonych` : '\nWszystko zaliczone');
process.exit(failed ? 1 : 0);
