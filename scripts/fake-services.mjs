#!/usr/bin/env node
// Atrapa Stripe'a, Voucherify i Resend do testów bez kont, na jednym porcie.
// Odwzorowuje tylko to, co sprawdziliśmy w dokumentacji. Nie zastępuje próby na prawdziwych usługach.
// Nie jest częścią aplikacji. Uruchomienie osobno: WEBHOOK_URL=… WEBHOOK_SECRET=… node scripts/fake-services.mjs
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function signPayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

export function paidEvent(session, type = 'checkout.session.completed') {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type,
    data: { object: { ...session, status: 'complete', payment_status: 'paid', payment_intent: `pi_${session.id}` } },
  });
}

// Stripe wysyła formularz: line_items[0][price_data][unit_amount]=3200
const parseForm = (body) => Object.fromEntries(new URLSearchParams(body));

export function startFakeServices({ port = 4242, webhookUrl, webhookSecret, initialPoints = 1000 } = {}) {
  const state = {
    sessions: new Map(), byKey: new Map(), refunds: [], expired: [], stripeDown: false,
    members: new Map(), // e-mail -> karta
    publications: new Map(),
    transactions: [],
    voucherifyCalls: [],
    voucherifyDown: false,
    voucherifyFail: [], // kolejne odpowiedzi na zmianę salda: 'applied-then-500' | '500' | '429'
    emails: [], emailKeys: new Map(), resendFail: [],
  };
  const memberByCode = (code) => [...state.members.values()].find((m) => m.code === code);

  function voucherify(req, url, body, json, res) {
    state.voucherifyCalls.push(`${req.method} ${url.pathname}`);
    if (state.voucherifyDown) return json(503, { message: 'Atrapa: Voucherify nie działa' });

    const list = /^\/v1\/loyalties\/([^/]+)\/members$/.exec(url.pathname);
    if (list && req.method === 'GET') {
      const member = state.members.get(url.searchParams.get('customer'));
      return json(200, { object: 'list', data_ref: 'vouchers', vouchers: member ? [member] : [], total: member ? 1 : 0 });
    }
    if (list && req.method === 'POST') {
      const { customer, source_id: sourceId } = JSON.parse(body);
      const known = state.publications.get(sourceId);
      if (known) return json(200, known);
      const member = { id: `v_${randomUUID()}`, code: `KINO-${randomUUID().slice(0, 8)}`, holder_id: `cust_${customer.source_id}`, loyalty_card: { points: initialPoints, balance: initialPoints } };
      state.members.set(customer.source_id, member);
      state.publications.set(sourceId, member);
      return json(200, member);
    }
    const balance = /^\/v1\/loyalties\/members\/([^/]+)\/balance$/.exec(url.pathname);
    if (balance && req.method === 'POST') {
      const member = memberByCode(decodeURIComponent(balance[1]));
      if (!member) return json(404, { message: 'brak karty' });
      const mode = state.voucherifyFail.shift();
      if (mode === '429') {
        res.setHeader('Retry-After', '1');
        return json(429, { code: 429, message: 'too many requests' });
      }
      if (mode === '500') return json(500, { message: 'Atrapa: błąd' });
      const { points, source_id: sourceId, reason } = JSON.parse(body);
      member.loyalty_card.balance = Math.max(0, member.loyalty_card.balance + points);
      if (points > 0) member.loyalty_card.points += points;
      state.transactions.push({ id: `vtx_${state.transactions.length}`, code: member.code, source_id: sourceId, reason, points });
      if (mode === 'applied-then-500') return json(500, { message: 'Atrapa: zapisano, ale odpowiedź padła' });
      return json(200, { object: 'balance', type: 'loyalty_card', points, total: member.loyalty_card.points, balance: member.loyalty_card.balance });
    }
    const transactions = /^\/v1\/loyalties\/members\/([^/]+)\/transactions$/.exec(url.pathname);
    if (transactions) {
      const code = decodeURIComponent(transactions[1]);
      return json(200, { object: 'list', data: state.transactions.filter((t) => t.code === code).reverse() });
    }
    const get = /^\/v1\/loyalties\/members\/([^/]+)$/.exec(url.pathname);
    if (get) {
      const member = memberByCode(decodeURIComponent(get[1]));
      return member ? json(200, member) : json(404, { message: 'brak karty' });
    }
    return json(404, { message: 'Atrapa: nie ma takiego zasobu' });
  }

  function resend(req, body, json) {
    const mode = state.resendFail.shift();
    if (mode === '500') return json(500, { name: 'application_error', message: 'Atrapa: błąd' });
    if (mode === '403') return json(403, { name: 'validation_error', message: 'Atrapa: niezweryfikowana domena' });
    const key = req.headers['idempotency-key'];
    if (state.emailKeys.has(key)) return json(200, { id: state.emailKeys.get(key) });
    const id = randomUUID();
    state.emailKeys.set(key, id);
    state.emails.push({ id, ...JSON.parse(body) });
    return json(200, { id });
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const json = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      if (url.pathname.startsWith('/v1/loyalties')) return voucherify(req, url, body, json, res);
      if (req.method === 'POST' && url.pathname === '/emails') return resend(req, body, json);

      if (url.pathname.startsWith('/v1/') && state.stripeDown) return json(500, { error: { type: 'api_error', message: 'Atrapa: Stripe nie działa' } });

      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        const key = req.headers['idempotency-key'];
        if (state.byKey.has(key)) return json(200, state.sessions.get(state.byKey.get(key)));
        const form = parseForm(body);
        // Prawdziwe API odrzuca ten parametr przy tworzeniu sesji
        if (Object.keys(form).some((k) => k.startsWith('payment_method_types'))) {
          return json(400, { error: { type: 'invalid_request_error', message: 'Atrapa: payment_method_types nie jest obsługiwane' } });
        }
        const id = `cs_test_${randomUUID().replaceAll('-', '')}`;
        const session = {
          id,
          object: 'checkout.session',
          url: `http://localhost:${port}/pay/${id}`,
          client_reference_id: form.client_reference_id,
          amount_total: Number(form['line_items[0][price_data][unit_amount]']),
          currency: form['line_items[0][price_data][currency]'],
          customer_email: form.customer_email,
          expires_at: Number(form.expires_at),
          success_url: form.success_url,
          cancel_url: form.cancel_url,
          status: 'open',
          payment_status: 'unpaid',
        };
        state.sessions.set(id, session);
        state.byKey.set(key, id);
        return json(200, session);
      }

      const expire = /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/.exec(url.pathname);
      if (req.method === 'POST' && expire) {
        const session = state.sessions.get(expire[1]);
        if (session.status !== 'open') return json(400, { error: { type: 'invalid_request_error', message: 'Only open sessions can be expired' } });
        session.status = 'expired';
        state.expired.push(expire[1]);
        return json(200, session);
      }
      const retrieve = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && retrieve) return json(200, state.sessions.get(retrieve[1]));

      if (req.method === 'POST' && url.pathname === '/v1/refunds') {
        const key = req.headers['idempotency-key'];
        let refund = state.refunds.find((r) => r.key === key);
        if (!refund) {
          refund = { id: `re_${randomUUID()}`, object: 'refund', key, payment_intent: parseForm(body).payment_intent };
          state.refunds.push(refund);
        }
        return json(200, refund);
      }

      // Strona płatności do klikania w przeglądarce
      const pay = /^\/pay\/([^/]+)(\/ok)?$/.exec(url.pathname);
      const session = pay && state.sessions.get(pay[1]);
      if (session && pay[2]) {
        session.status = 'complete';
        const payload = paidEvent(session);
        await fetch(webhookUrl, { method: 'POST', body: payload, headers: { 'Stripe-Signature': signPayload(payload, webhookSecret) } });
        res.writeHead(303, { Location: session.success_url });
        return res.end();
      }
      if (session) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>Atrapa Stripe'a</title><h1>Atrapa Stripe'a: ${session.amount_total / 100} zł</h1><p><a href="/pay/${session.id}/ok">Zapłać</a></p><p><a href="${session.cancel_url}">Przerwij</a></p>`);
      }
      json(404, { error: { type: 'invalid_request_error', message: 'Atrapa: nie ma takiego zasobu' } });
    });
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ state, close: () => server.close() })));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startFakeServices({
    port: Number(process.env.PORT || 4242),
    webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/stripe',
    webhookSecret: process.env.WEBHOOK_SECRET || 'whsec_test',
  });
  console.log('Atrapa usług działa');
}
