#!/usr/bin/env node
// Test etapów II i III bez kont: sam uruchamia serwer (baza w pamięci) i atrapę Stripe'a, Voucherify i Resend.
// Użycie: npm run chaos:stripe
import { spawn } from 'node:child_process';
import { startFakeServices, signPayload, paidEvent } from './fake-services.mjs';

const PORT = 3100;
const STRIPE_PORT = 4300;
const SECRET = 'whsec_chaos';
const TTL_SECONDS = 3;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fake = await startFakeServices({ port: STRIPE_PORT, webhookUrl: `${BASE}/api/webhooks/stripe`, webhookSecret: SECRET });
const server = spawn('node', ['src/server.js'], {
  stdio: ["ignore", "ignore", process.env.CHAOS_LOGS ? "inherit" : "ignore"],
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
    VOUCHERIFY_APP_ID: 'chaos',
    VOUCHERIFY_APP_TOKEN: 'chaos',
    VOUCHERIFY_CAMPAIGN_ID: 'camp_chaos',
    VOUCHERIFY_API_URL: `http://localhost:${STRIPE_PORT}`,
    RESEND_API_KEY: 're_chaos',
    RESEND_API_URL: `http://localhost:${STRIPE_PORT}`,
    WORKER_POLL_MS: '100',
    SAGA_SWEEP_MS: '200',
    JOB_RETRY_BASE_MS: '100',
    POINTS_VERIFY_DELAY_MS: '300',
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
const sessionOf = (id, amount) => [...fake.state.sessions.values()].filter((s) => s.client_reference_id === id && (amount === undefined || s.amount_total === amount)).at(-1);

async function until(read, test, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!test(value) && Date.now() < deadline) {
    await sleep(100);
    value = await read();
  }
  return value;
}

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
  check('A: podwójne „Zapłać” to ta sama sesja', c1.data.url === c2.data?.url && fake.state.sessions.size === 1);
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
  fake.state.stripeDown = true;
  const down = await call('POST', `/api/reservations/${r3.id}/checkout`);
  fake.state.stripeDown = false;
  check('Stripe nie działa: 5xx z komunikatem', down.status === 502 && down.data.message);
  check('Stripe nie działa: rezerwacja trwa dalej', (await status(r3.id)).status === 'held');
  check('Stripe wrócił: checkout działa', (await call('POST', `/api/reservations/${r3.id}/checkout`)).status === 200);

  // Płatność po czasie: klient zdążył zapłacić tuż przed wygaśnięciem, webhook dochodzi po nim
  const late = await reserve();
  const taken = await reserve();
  await call('POST', `/api/reservations/${late.id}/checkout`);
  await call('POST', `/api/reservations/${taken.id}/checkout`);
  const sLate = sessionOf(late.id);
  const sTaken = sessionOf(taken.id);
  sLate.status = 'complete';
  sTaken.status = 'complete';
  await sleep(TTL_SECONDS * 1000 + 600);

  check('Po czasie: status "expired"', (await status(late.id)).status === 'expired');
  check('Po czasie: checkout to 410', (await call('POST', `/api/reservations/${late.id}/checkout`)).status === 410);

  await signedWebhook(paidEvent(sLate));
  const lateStatus = await status(late.id);
  check('Po czasie, fotel wolny: bilet się należy, bez zwrotu', lateStatus.status === 'paid' && fake.state.refunds.length === 0);

  const newcomer = await reserve(taken.seatId, 'nowy');
  check('Fotel po wygasłej rezerwacji może wziąć ktoś inny', newcomer.status === 201);

  const lost = paidEvent(sTaken);
  check('Po czasie, fotel zajęty: webhook to 200', (await signedWebhook(lost)).status === 200);
  const lostStatus = await until(() => status(taken.id), (d) => d.refunded === true);
  check('Po czasie, fotel zajęty: bez biletu, ze zwrotem', lostStatus?.status === 'expired' && !lostStatus.code);
  check('Zwrot dotyczy właściwej płatności', fake.state.refunds[0]?.payment_intent === `pi_${sTaken.id}`);
  await signedWebhook(lost);
  await signedWebhook(paidEvent(sTaken));
  await sleep(500);
  check('Powtórzony webhook nie robi drugiego zwrotu', fake.state.refunds.length === 1);
  check('Fotel nowej osoby nietknięty', (await status(newcomer.id)).status === 'held');

  // Etap III: saldo
  const welcome = await call('GET', '/api/loyalty?email=delivered+nowy@resend.dev');
  check('III A: nowy e-mail ma 1000 pkt', welcome.status === 200 && welcome.data.points === 1000 && welcome.data.email === 'delivered+nowy@resend.dev', JSON.stringify(welcome.data));
  check('III A: samo sprawdzenie salda nie zakłada karty', !fake.state.members.has('delivered+nowy@resend.dev'));
  check('III A: zły e-mail to 400', (await call('GET', '/api/loyalty?email=abc')).status === 400);
  const callsBefore = fake.state.voucherifyCalls.length;
  await call('GET', '/api/loyalty?email=delivered+nowy@resend.dev');
  check('III A: powtórka salda nie zużywa limitu Voucherify', fake.state.voucherifyCalls.length === callsBefore);

  // Etap III: zakup z punktami (przykład z wytycznych: 1000 pkt, dopłata 22 zł, 220 pkt)
  const jan = 'delivered+jan@resend.dev';
  const reserveAs = async (email) => {
    const seatId = `${'ABCDEFGH'[Math.floor(seatNo / 10)]}${(seatNo++ % 10) + 1}`;
    const r = await call('POST', '/api/reservations', { eventId, seatId, customerName: 'Jan <b>Test</b>', email });
    return { ...r, seatId, id: r.data?.reservationId };
  };
  const balanceOf = (email) => fake.state.members.get(email)?.loyalty_card.balance;
  const p1 = await reserveAs(jan);
  check('III B: ponad połowę ceny to 400', (await call('POST', `/api/reservations/${p1.id}/checkout`, { points: 1601 })).status === 400);
  for (const bad of [-1, 1.5, '100', { $gt: 0 }]) {
    check(`III B: points ${JSON.stringify(bad)} to 400`, (await call('POST', `/api/reservations/${p1.id}/checkout`, { points: bad })).status === 400);
  }
  check('III B: za mało punktów to 409', (await call('POST', `/api/reservations/${p1.id}/checkout`, { points: 1500 })).status === 409);
  check('III B: odmowa nie rusza salda', (balanceOf(jan) ?? 1000) === 1000);

  const [pay1, pay2, pay3] = await Promise.all([1, 2, 3].map(() => call('POST', `/api/reservations/${p1.id}/checkout`, { points: 1000 })));
  check('III B: trzy kliknięcia, ta sama sesja', pay1.status === 200 && pay1.data.url === pay2.data?.url && pay2.data?.url === pay3.data?.url);
  check('III B: punkty zeszły raz', balanceOf(jan) === 0, `saldo ${balanceOf(jan)}`);
  const sJan = sessionOf(p1.id);
  check('III B: sesja na 22 zł', sJan.amount_total === 2200);
  check('III C: pointsUsed przed zapłatą', (await status(p1.id)).pointsUsed === 1000);

  const again500 = await call('POST', `/api/reservations/${p1.id}/checkout`, { points: 500 });
  const sJan2 = sessionOf(p1.id, 2700);
  check('III B: zmiana punktów to nowa sesja na 27 zł', again500.status === 200 && Boolean(sJan2));
  check('III B: stara sesja zamknięta', sJan.status === 'expired');
  check('III B: różnica punktów wróciła', balanceOf(jan) === 500);
  await call('POST', `/api/reservations/${p1.id}/checkout`, { points: 1000 });
  const sJan3 = [...fake.state.sessions.values()].filter((s) => s.client_reference_id === p1.id && s.status === 'open');
  check('III B: zawsze jedna otwarta sesja', sJan3.length === 1 && sJan3[0].amount_total === 2200 && balanceOf(jan) === 0);

  const stale = paidEvent(sJan);
  await signedWebhook(stale);
  await until(async () => fake.state.refunds.length, (n) => n === 2);
  check('III: płatność za starą sesję wraca, bez biletu', fake.state.refunds.length === 2 && (await status(p1.id)).status === 'held');

  sJan3[0].status = 'complete';
  fake.state.voucherifyFail.push('applied-then-500');
  await signedWebhook(paidEvent(sJan3[0]));
  const janPaid = await status(p1.id);
  check('III C: po zapłacie pointsUsed i pointsEarned', janPaid.status === 'paid' && janPaid.pointsUsed === 1000 && janPaid.pointsEarned === 220);
  await until(async () => balanceOf(jan), (b) => b === 220, 6000);
  await sleep(1500);
  check('III A: punkty za zakup naliczone raz, mimo błędu po zapisie', balanceOf(jan) === 220, `saldo ${balanceOf(jan)}`);
  check('III A: jedna transakcja za zakup', fake.state.transactions.filter((t) => t.source_id === `${p1.id}:earn`).length === 1);

  const mail = await until(async () => fake.state.emails.find((m) => m.to[0] === jan), Boolean);
  check('III C: mail z biletem i podsumowaniem', Boolean(mail) && mail.text.includes(janPaid.code) && mail.text.includes('22 zł') && mail.text.includes('1000 pkt') && mail.text.includes('220 pkt'));
  check('III C: mail nie wstrzykuje HTML z imienia', Boolean(mail) && !mail.html.includes('<b>Test</b>'));
  await signedWebhook(paidEvent(sJan3[0]));
  await sleep(500);
  check('III C: powtórzony webhook bez drugiego maila', fake.state.emails.filter((m) => m.to[0] === jan).length === 1);
  const ticketData = (await call('GET', `/api/tickets/${janPaid.code}`)).data;
  check('III C: podsumowanie na bilecie', ticketData.cardAmount === 2200 && ticketData.pointsUsed === 1000 && ticketData.pointsEarned === 220);
  check('III A: saldo w API po zakupie', (await call('GET', `/api/loyalty?email=${encodeURIComponent(jan)}`)).data.points === 220);

  // Kompensacja: rezerwacja wygasa bez płatności
  const anna = 'delivered+anna@resend.dev';
  const p2 = await reserveAs(anna);
  await call('POST', `/api/reservations/${p2.id}/checkout`, { points: 800 });
  check('III saga: punkty zeszły', balanceOf(anna) === 200);
  const sAnna = sessionOf(p2.id);
  await sleep(TTL_SECONDS * 1000 + 300);
  const annaBack = await until(async () => balanceOf(anna), (b) => b === 1000, 5000);
  check('III saga: po wygaśnięciu punkty wracają', annaBack === 1000, `saldo ${annaBack}`);
  check('III saga: sesja zamknięta przed zwrotem punktów', sAnna.status === 'expired');
  check('III saga: API pokazuje zwrot', (await status(p2.id)).pointsReturned === 800);

  // Kompensacja: płatność po czasie, fotel zajęty, oddajemy i pieniądze, i punkty
  const ola = 'delivered+ola@resend.dev';
  const p3 = await reserveAs(ola);
  await call('POST', `/api/reservations/${p3.id}/checkout`, { points: 1000 });
  const sOla = sessionOf(p3.id);
  sOla.status = 'complete';
  await sleep(TTL_SECONDS * 1000 + 300);
  const thief = await call('POST', '/api/reservations', { eventId, seatId: p3.seatId, customerName: 'Inny', email: 'delivered+inny@resend.dev' });
  check('III saga: fotel przejęty', thief.status === 201);
  await signedWebhook(paidEvent(sOla));
  const olaBack = await until(async () => balanceOf(ola), (b) => b === 1000, 5000);
  const olaStatus = await status(p3.id);
  check('III saga: zwrot pieniędzy i punktów', olaBack === 1000 && olaStatus.refunded === true && olaStatus.status === 'expired', JSON.stringify(olaStatus.refunded));
  await sleep(300);
  check('III saga: bez punktów za nieudany zakup', fake.state.transactions.every((t) => t.source_id !== `${p3.id}:earn`));

  // Awarie Voucherify
  fake.state.voucherifyDown = true;
  const noVoucher = await reserveAs('delivered+awaria@resend.dev');
  const cardOnly = await call('POST', `/api/reservations/${noVoucher.id}/checkout`, {});
  check('III awaria: bez punktów płatność działa', cardOnly.status === 200);
  const withPoints = await call('POST', `/api/reservations/${noVoucher.id}/checkout`, { points: 100 });
  check('III awaria: z punktami 503 z komunikatem', withPoints.status === 503 && withPoints.data.message);
  check('III awaria: saldo 503, gdy nic nie wiemy', (await call('GET', '/api/loyalty?email=delivered+pusty@resend.dev')).status === 503);
  fake.state.voucherifyDown = false;

  const eve = 'delivered+eve@resend.dev';
  const p4 = await reserveAs(eve);
  await call('POST', `/api/reservations/${p4.id}/checkout`, { points: 100 });
  const sEve = sessionOf(p4.id);
  fake.state.voucherifyDown = true;
  sEve.status = 'complete';
  await signedWebhook(paidEvent(sEve));
  const evePaid = await status(p4.id);
  check('III awaria: płatność daje bilet mimo awarii punktów', evePaid.status === 'paid');
  await until(async () => fake.state.emails.find((m) => m.to[0] === eve), Boolean);
  check('III awaria: mail wychodzi mimo awarii punktów', fake.state.emails.some((m) => m.to[0] === eve));
  fake.state.voucherifyDown = false;
  const eveBalance = await until(async () => balanceOf(eve), (b) => b === 900 + 310, 20_000);
  check('III awaria: punkty dochodzą po powrocie Voucherify', eveBalance === 1210, `saldo ${eveBalance}`);

  // Awarie Resend
  const bob = 'delivered+bob@resend.dev';
  const p5 = await reserveAs(bob);
  await call('POST', `/api/reservations/${p5.id}/checkout`, {});
  const sBob = sessionOf(p5.id);
  fake.state.resendFail.push('500');
  sBob.status = 'complete';
  await signedWebhook(paidEvent(sBob));
  const bobMail = await until(async () => fake.state.emails.find((m) => m.to[0] === bob), Boolean, 5000);
  check('III mail: błąd 500 Resend, ponowienie dowozi mail', Boolean(bobMail));

  const zed = 'bounced+zed@resend.dev';
  const p6 = await reserveAs(zed);
  await call('POST', `/api/reservations/${p6.id}/checkout`, {});
  const sZed = sessionOf(p6.id);
  fake.state.resendFail.push('403');
  sZed.status = 'complete';
  await signedWebhook(paidEvent(sZed));
  const dead = await until(async () => (await call('GET', '/api/health')).data.deadLetters, (n) => n >= 1, 5000);
  check('III mail: odmowa Resend trafia do DLQ', dead >= 1);
  check('III mail: bilet jest mimo odmowy maila', (await status(p6.id)).status === 'paid');
} finally {
  server.kill();
  fake.close();
}

console.log(failed ? `\n${failed} niezaliczonych` : '\nWszystko zaliczone');
process.exit(failed ? 1 : 0);
