// Stripe Checkout (wyłącznie tryb testowy). Bez klucza zwraca null, a API odpowiada 503.
import Stripe from 'stripe';

// Stripe nie pozwala na sesję krótszą niż 30 minut od utworzenia
const SESSION_MIN_SECONDS = 30 * 60 + 60;

export function createPayments(config) {
  if (!config.stripeSecretKey) return null;

  const options = { timeout: 10_000, maxNetworkRetries: 2 };
  if (config.stripeApiBase) {
    // Tylko do testów: scripts/fake-stripe.mjs udaje API Stripe'a
    const url = new URL(config.stripeApiBase);
    Object.assign(options, { host: url.hostname, port: url.port, protocol: url.protocol.replace(':', '') });
  }
  const stripe = new Stripe(config.stripeSecretKey, options);

  return {
    // Ten sam klucz idempotencji i te same parametry: podwójne „Zapłać” i ponowna próba po
    // przerwaniu płatności trafiają na tę samą sesję, więc klient nie zapłaci dwa razy.
    createCheckout({ reservationId, amount, name, email, expiresAt, metadata }) {
      return stripe.checkout.sessions.create(
        {
          mode: 'payment',
          client_reference_id: reservationId,
          customer_email: email,
          metadata,
          line_items: [{ quantity: 1, price_data: { currency: 'pln', unit_amount: amount, product_data: { name } } }],
          expires_at: Math.floor(new Date(expiresAt).getTime() / 1000) + SESSION_MIN_SECONDS,
          success_url: `${config.publicUrl}/reservations/${reservationId}/payment`,
          cancel_url: `${config.publicUrl}/reservations/${reservationId}?payment=canceled`,
        },
        { idempotencyKey: `checkout:${reservationId}` },
      );
    },

    constructEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
    },

    refund(session) {
      return stripe.refunds.create({ payment_intent: session.payment_intent }, { idempotencyKey: `refund:${session.id}` });
    },

    expireSession(sessionId) {
      return stripe.checkout.sessions.expire(sessionId);
    },
  };
}
