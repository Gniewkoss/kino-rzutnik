#!/usr/bin/env node
// Atrapa API Stripe'a do testów bez konta: sesje, zwroty i strona płatności wysyłająca podpisany webhook.
// Nie jest częścią aplikacji. Uruchomienie osobno: WEBHOOK_URL=… WEBHOOK_SECRET=… node scripts/fake-stripe.mjs
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
function parseForm(body) {
  return Object.fromEntries(new URLSearchParams(body));
}

export function startFakeStripe({ port = 4242, webhookUrl, webhookSecret } = {}) {
  const state = { sessions: new Map(), byKey: new Map(), refunds: [], expired: [], down: false };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const json = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (state.down) return json(500, { error: { type: 'api_error', message: 'Atrapa: Stripe nie działa' } });

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
        state.expired.push(expire[1]);
        return json(200, { ...state.sessions.get(expire[1]), status: 'expired' });
      }

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
  await startFakeStripe({
    port: Number(process.env.PORT || 4242),
    webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/stripe',
    webhookSecret: process.env.WEBHOOK_SECRET || 'whsec_test',
  });
  console.log('Atrapa Stripe\'a działa');
}
