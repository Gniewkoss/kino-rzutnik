#!/usr/bin/env node
// Test chaosu: atakuje system według 11 kryteriów etapu I i liczy punkty.
// Użycie: node scripts/chaos.mjs [BASE_URL]   (domyślnie http://localhost:3000)
// Lokalnie warto uruchomić serwer z krótkim TTL, np. RESERVATION_TTL_SECONDS=8 TRUST_PROXY=1 npm start

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let ipCounter = 1;

// Każdy "klient" ma własny adres w X-Forwarded-For (działa lokalnie z TRUST_PROXY=1;
// za prawdziwym proxy nagłówek jest nadpisywany i wszyscy to jeden klient)
const newClient = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

async function call(method, path, body, ip = newClient()) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

const is2 = (s) => s >= 200 && s < 300;
const is4 = (s) => s >= 400 && s < 500;
const is5 = (s) => s >= 500;

function record(id, name, points, note) {
  results.push({ id, name, points, note });
  const icon = points === 1 ? '✅' : points === 0.5 ? '🟡' : '❌';
  console.log(`${icon} ${id} ${name}: ${points} pkt  ${note}`);
}

let pool = [];
async function freeSeat() {
  if (!pool.length) {
    const { data: events } = await call('GET', '/api/events');
    for (const e of events) {
      const { data } = await call('GET', `/api/events/${encodeURIComponent(e._id)}`);
      const taken = new Set(data.takenSeats);
      pool.push(...data.event.seats.filter((s) => !taken.has(s)).map((seatId) => ({ eventId: e._id, seatId })));
    }
    pool.sort(() => Math.random() - 0.5);
  }
  if (!pool.length) throw new Error('Brak wolnych miejsc do testów');
  return pool.pop();
}

const person = (n) => ({ customerName: `Tester ${n}`, email: `tester${n}.${Date.now()}@example.com` });

async function takenSeats(eventId) {
  return (await call('GET', `/api/events/${encodeURIComponent(eventId)}`)).data.takenSeats;
}

async function waitUntil(iso, extraMs = 0) {
  const ms = new Date(iso).getTime() + extraMs - Date.now();
  if (ms > 0) await sleep(ms);
}

// Po expiresAt sprawdza co sekundę przez 2 min; zwraca opóźnienie w ms albo null
async function pollUntil(expiresAt, check) {
  const start = new Date(expiresAt).getTime();
  while (Date.now() - start < 125_000) {
    if (await check()) return Date.now() - start;
    await sleep(1000);
  }
  return null;
}

async function precondition() {
  const list = await call('GET', '/api/events');
  if (!is2(list.status) || !Array.isArray(list.data) || !list.data.length) throw new Error('GET /api/events nie działa');
  const seat = await freeSeat();
  const r = await call('POST', '/api/reservations', { ...seat, ...person('pre') });
  if (!is2(r.status) || !r.data?.reservationId || !r.data?.expiresAt) throw new Error(`Rezerwacja nie działa (${r.status})`);
  const ttl = (new Date(r.data.expiresAt) - Date.now()) / 1000;
  const p = await call('POST', `/api/reservations/${r.data.reservationId}/purchase`);
  if (!is2(p.status) || !p.data?.code) throw new Error(`Zakup nie działa (${p.status})`);
  console.log(`Warunek wstępny OK. Czas rezerwacji ≈ ${Math.round(ttl)} s ${Math.abs(ttl - 120) < 10 ? '(tryb testowy)' : '(UWAGA: tryb testowy to 120 s)'}\n`);
}

async function A1() {
  const r = await call('GET', '/api/events/nie-ma-takiego');
  record('A1', 'Zły request', is4(r.status) ? 1 : r.status === 200 ? 0.5 : 0, `status ${r.status}`);
}

async function A2() {
  const seat = await freeSeat();
  const r = await call('POST', '/api/reservations', { ...seat, ...person('a2') });
  if (!(await takenSeats(seat.eventId)).includes(seat.seatId)) return record('A2', 'Obietnice czasowe', 0, 'zarezerwowane miejsce nie jest w takenSeats');
  await waitUntil(r.data.expiresAt);
  const delay = await pollUntil(r.data.expiresAt, async () => !(await takenSeats(seat.eventId)).includes(seat.seatId));
  record('A2', 'Obietnice czasowe', delay === null ? 0 : delay <= 15_000 ? 1 : 0.5, delay === null ? 'miejsce nie zniknęło' : `zniknęło po ${(delay / 1000).toFixed(1)} s`);
}

async function B1() {
  const seat = await freeSeat();
  const body = { ...seat, ...person('b1') };
  const ip = newClient();
  const a = await call('POST', '/api/reservations', body, ip);
  const b = await call('POST', '/api/reservations', body, ip);
  const seat2 = await freeSeat();
  const body2 = { ...seat2, ...person('b1p') };
  const [c, d] = await Promise.all([call('POST', '/api/reservations', body2, ip), call('POST', '/api/reservations', body2, ip)]);

  const anyFive = [a, b, c, d].some((r) => is5(r.status));
  const sameSeq = is2(a.status) && is2(b.status) && a.data.reservationId === b.data.reservationId;
  const samePar = is2(c.status) && is2(d.status) && c.data.reservationId === d.data.reservationId;
  const twoSeq = is2(a.status) && is2(b.status) && a.data.reservationId !== b.data.reservationId;
  const twoPar = is2(c.status) && is2(d.status) && c.data.reservationId !== d.data.reservationId;
  let pts;
  if (anyFive || twoSeq || twoPar) pts = 0;
  else if (sameSeq && samePar) pts = 1;
  else pts = 0.5;
  record('B1', 'Idempotentność', pts, `po kolei ${a.status}/${b.status}, równolegle ${c.status}/${d.status}`);
}

async function B2() {
  const seat = await freeSeat();
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call('POST', '/api/reservations', { ...seat, ...person(`b2-${i}`) })));
  const ok = rs.filter((r) => is2(r.status)).length;
  const four = rs.filter((r) => is4(r.status)).length;
  const five = rs.filter((r) => is5(r.status)).length;
  const pts = ok === 1 && four === 19 ? 1 : ok === 1 ? 0.5 : 0;
  record('B2', 'Odporność na wyścigi', pts, `2xx: ${ok}, 4xx: ${four}, 5xx: ${five}`);
}

async function B3() {
  const seat = await freeSeat();
  const before = await takenSeats(seat.eventId);
  const cases = [
    { ...seat, eventId: 'nie-ma-takiego', ...person('b3') },
    { ...seat, seatId: 'Z99', ...person('b3') },
    { ...seat, customerName: '', email: 'b3@example.com' },
    { ...seat, customerName: 'Ktoś', email: '' },
    { ...seat, customerName: 'Ktoś', email: 'to-nie-email' },
    { ...seat, eventId: { $gt: '' }, ...person('b3') },
    '{zepsuty json',
  ];
  const rs = [];
  for (const c of cases) rs.push(await call('POST', '/api/reservations', c));
  const after = await takenSeats(seat.eventId);
  const saved = after.length !== before.length;
  const all4 = rs.every((r) => is4(r.status));
  record('B3', 'Zły request', saved ? 0 : all4 ? 1 : 0.5, `statusy ${rs.map((r) => r.status).join(',')}${saved ? ', ZAPISANO' : ''}`);
}

async function B4() {
  const seat = await freeSeat();
  const r = await call('POST', '/api/reservations', { ...seat, ...person('b4x') });
  await waitUntil(r.data.expiresAt);
  const delay = await pollUntil(r.data.expiresAt, async () => is2((await call('POST', '/api/reservations', { ...seat, ...person('b4y') })).status));
  record('B4', 'Obietnice czasowe', delay === null ? 0 : delay <= 15_000 ? 1 : 0.5, delay === null ? 'nie udało się' : `udało się po ${(delay / 1000).toFixed(1)} s`);
}

async function B5() {
  const attacker = newClient();
  const seats = [];
  for (let i = 0; i < 100; i++) seats.push(await freeSeat().catch(() => ({ eventId: 'x', seatId: 'x' })));
  const start = Date.now();
  const attack = (async () => {
    const out = [];
    for (let i = 0; i < 100; i++) {
      out.push(call('POST', '/api/reservations', { ...seats[i], ...person(`b5-${i}`) }, attacker));
      await sleep(90);
    }
    return Promise.all(out);
  })();
  await sleep(3000);
  const other = await call('POST', '/api/reservations', { ...(await freeSeat()), ...person('b5-other') });
  const rs = await attack;
  const limited = rs.filter((r) => r.status === 429);
  const withRetry = limited.filter((r) => r.headers.get('retry-after'));
  const five = rs.filter((r) => is5(r.status)).length;
  let pts;
  if (!limited.length || !is2(other.status) || five) pts = 0;
  else if (withRetry.length === limited.length) pts = 1;
  else pts = 0.5;
  record('B5', 'Nadmiar ruchu', pts, `${limited.length}× 429 (Retry-After: ${withRetry.length}), drugi klient: ${other.status}, czas ${((Date.now() - start) / 1000).toFixed(1)} s`);
}

async function C1() {
  const mk = async () => (await call('POST', '/api/reservations', { ...(await freeSeat()), ...person('c1') })).data.reservationId;
  const id1 = await mk();
  const a = await call('POST', `/api/reservations/${id1}/purchase`);
  const b = await call('POST', `/api/reservations/${id1}/purchase`);
  const id2 = await mk();
  const [c, d] = await Promise.all([call('POST', `/api/reservations/${id2}/purchase`), call('POST', `/api/reservations/${id2}/purchase`)]);
  const rs = [a, b, c, d];
  const anyFive = rs.some((r) => is5(r.status));
  const diff = (x, y) => is2(x.status) && is2(y.status) && x.data.code !== y.data.code;
  const same = (x, y) => is2(x.status) && is2(y.status) && x.data.code === y.data.code;
  const pts = anyFive || diff(a, b) || diff(c, d) ? 0 : same(a, b) && same(c, d) ? 1 : 0.5;
  record('C1', 'Idempotentność', pts, `po kolei ${a.status}/${b.status}, równolegle ${c.status}/${d.status}`);
}

async function C2() {
  let worst = 1;
  const notes = [];
  for (let round = 0; round < 5; round++) {
    const seat = await freeSeat();
    const x = await call('POST', '/api/reservations', { ...seat, ...person(`c2x${round}`) });
    await waitUntil(x.data.expiresAt);
    const [p, y] = await Promise.all([
      call('POST', `/api/reservations/${x.data.reservationId}/purchase`),
      call('POST', '/api/reservations', { ...seat, ...person(`c2y${round}`) }),
    ]);
    const owners = (is2(p.status) ? 1 : 0) + (is2(y.status) ? 1 : 0);
    if (owners > 1) worst = 0;
    else if (is5(p.status) || is5(y.status)) worst = Math.min(worst, 0.5);
    notes.push(`${p.status}/${y.status}`);
  }
  record('C2', 'Odporność na wyścigi', worst, `zakup X / rezerwacja Y: ${notes.join(', ')}`);
}

async function C3() {
  const a = await call('POST', '/api/reservations/00000000-0000-4000-8000-000000000000/purchase');
  const b = await call('POST', '/api/reservations/abc/purchase');
  const ticket = is2(a.status) || is2(b.status);
  record('C3', 'Zły request', ticket ? 0 : is4(a.status) && is4(b.status) ? 1 : 0.5, `statusy ${a.status}, ${b.status}`);
}

async function C4() {
  const late = await call('POST', '/api/reservations', { ...(await freeSeat()), ...person('c4a') });
  const seat = await freeSeat();
  const early = await call('POST', '/api/reservations', { ...seat, ...person('c4b') });
  const bought = await call('POST', `/api/reservations/${early.data.reservationId}/purchase`);
  await waitUntil(late.data.expiresAt, 500);
  const p = await call('POST', `/api/reservations/${late.data.reservationId}/purchase`);
  // Czekamy, aż minie pierwotny czas rezerwacji kupionego miejsca (+ zapas)
  await waitUntil(early.data.expiresAt, 5_000);
  const stillTaken = (await takenSeats(seat.eventId)).includes(seat.seatId);
  const steal = await call('POST', '/api/reservations', { ...seat, ...person('c4c') });
  let pts;
  if (is2(p.status) || !stillTaken || is2(steal.status) || !is2(bought.status)) pts = 0;
  else pts = is4(p.status) ? 1 : 0.5;
  record('C4', 'Obietnice czasowe', pts, `zakup po czasie: ${p.status}; kupione miejsce zajęte: ${stillTaken}; próba przejęcia: ${steal.status}`);
}

console.log(`🎯 Test chaosu: ${BASE}\n`);
try {
  await precondition();
} catch (e) {
  console.log(`❌ Warunek wstępny niespełniony: ${e.message}\nWynik: 0`);
  process.exit(1);
}

// Testy czasowe biegną równolegle, żeby nie czekać kilka razy po 2 minuty
// Na wdrożeniu wszystkie żądania idą z jednego IP: przerwy, żeby testy nie wpadały w limit ruchu
const isLocal = /localhost|127\.0\.0\.1/.test(BASE);
const cooldown = () => (isLocal ? Promise.resolve() : sleep(11_000));

await A1();
await B1();
await cooldown();
await B2();
await cooldown();
await B3();
await C1();
await C3();
await cooldown();
const timed = [A2(), B4(), C2(), C4()];
await Promise.all(timed);
await cooldown();
if (!isLocal) console.log('ℹ️  B5 z jednego IP: "drugi klient" to ten sam adres, więc 429 dla niego jest tu oczekiwane. Sprawdź B5 z innej sieci.');
await B5();

const order = ['A1', 'A2', 'B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'C4'];
const sum = results.reduce((s, r) => s + r.points, 0);
const score = Math.round((3 * sum / 11) * 2) / 2;
console.log(`\nSuma: ${sum} / 11 → test chaosu: ${score} / 3`);
for (const id of order) if (!results.find((r) => r.id === id)) console.log(`(brak wyniku dla ${id})`);
