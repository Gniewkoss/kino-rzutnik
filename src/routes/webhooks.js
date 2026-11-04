// Karta B etapu II: webhook Stripe'a, jedyne miejsce, w którym płatność staje się biletem
import { HttpError } from '../errors.js';
import { isReservationId } from '../validation.js';
import { issueTicket } from '../tickets.js';

const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

async function handlePaidSession(collections, payments, session) {
  const { reservations } = collections;
  const id = session.client_reference_id;
  const reservation = isReservationId(id) ? await reservations.findOne({ _id: id }) : null;
  if (!reservation) return console.warn(`Webhook: sesja ${session.id} bez znanej rezerwacji, pomijam`);
  if (session.payment_status !== 'paid') return;

  if (
    session.currency !== 'pln' ||
    (reservation.amount !== undefined && session.amount_total !== reservation.amount)
  ) {
    return console.error(`Webhook: sesja ${session.id} ma inną kwotę niż rezerwacja ${id}, nie wystawiam biletu`);
  }

  // Bez warunku expiresAt: pieniądze już są. Sesja Stripe'a żyje min. 30 minut, więc klient
  // może zapłacić po czasie. Jeśli nikt nie przejął fotela, bilet nadal mu się należy.
  const code = await issueTicket(collections, reservation, {
    details: { stripeSessionId: session.id, paymentIntent: session.payment_intent },
  });
  if (code || reservation.refundedAt) return;

  // Fotel ma już ktoś inny: nie sprzedajemy go drugi raz, tylko oddajemy pieniądze.
  // Błąd zwrotu to 500, więc Stripe ponowi webhook; klucz idempotencji chroni przed drugim zwrotem.
  const refund = await payments.refund(session);
  await reservations.updateOne({ _id: id }, { $set: { refundedAt: new Date(), refundId: refund.id } });
  console.warn(`Webhook: płatność po czasie, fotel zajęty, zwrot ${refund.id} dla rezerwacji ${id}`);
}

export function stripeWebhook(collections, { payments, webhookSecret }) {
  return async (req, res) => {
    if (!payments || !webhookSecret) throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Płatności nie są skonfigurowane');

    let event;
    try {
      event = payments.constructEvent(req.body, req.get('stripe-signature'));
    } catch {
      throw new HttpError(400, 'INVALID_SIGNATURE', 'Niepoprawny podpis webhooka');
    }

    if (PAID_EVENTS.has(event.type)) await handlePaidSession(collections, payments, event.data.object);
    res.json({ received: true });
  };
}
