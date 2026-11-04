// Webhook Stripe'a: jedyne miejsce, w którym płatność staje się biletem.
// Inbox, bilet, saga i outbox zapisują się w jednej transakcji: albo wszystko, albo nic, i Stripe ponowi.
import { HttpError } from '../errors.js';
import { isReservationId } from '../validation.js';
import { issueTicket } from '../tickets.js';
import { enqueue } from '../jobs.js';
import { pointsEarnedFor } from '../loyalty.js';
import { newSaga } from '../saga.js';

const DUPLICATE_KEY = 11000;
const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

async function applyPaidSession(collections, session, tx) {
  const { reservations, sagas } = collections;
  const id = session.client_reference_id;
  const reservation = isReservationId(id) ? await reservations.findOne({ _id: id }, { session: tx }) : null;
  if (!reservation) return console.warn(`Webhook: sesja ${session.id} bez znanej rezerwacji, pomijam`);
  if (session.payment_status !== 'paid') return;

  const saga = await sagas.findOne({ _id: id }, { session: tx });
  const pointsUsed = saga?.pointsUsed ?? 0;
  const amount = reservation.amount ?? saga?.amount;

  if (session.currency !== 'pln' || (amount !== undefined && session.amount_total !== amount - pointsUsed)) {
    return console.error(`Webhook: sesja ${session.id} ma inną kwotę niż rezerwacja ${id}, nie wystawiam biletu`);
  }

  const details = { paymentIntent: session.payment_intent };

  // Sesja, której już nie używamy (klient zmienił liczbę punktów): tej płatności nie przypisujemy do biletu
  if (saga?.results?.sessionId && saga.results.sessionId !== session.id) {
    await enqueue(collections, `refund:${session.id}`, 'refund-session', { sessionId: session.id, paymentIntent: session.payment_intent }, { session: tx });
    return;
  }

  // Bez warunku expiresAt: pieniądze już są. Jeśli nikt nie przejął fotela, bilet nadal się należy.
  const compensated = saga && ['compensating', 'compensated'].includes(saga.status);
  const ticket = compensated ? null : await issueTicket(collections, reservation, { details: { stripeSessionId: session.id, ...details }, session: tx });

  if (!ticket) {
    // Fotel ma już ktoś inny: kompensacja. Zwrot pieniędzy i punktów robi worker, z ponawianiem i kluczem idempotencji.
    await sagas.updateOne(
      { _id: id },
      {
        $set: { status: 'compensating', failedStep: 'seat', 'results.sessionId': session.id, 'results.paymentIntent': session.payment_intent },
        $addToSet: { completed: 'charge' },
        $setOnInsert: { type: 'ticket-purchase', email: reservation.email, amount, expiresAt: reservation.expiresAt, pointsUsed: 0, attempt: 1, compensatedSteps: [], createdAt: new Date() },
      },
      { upsert: true, session: tx },
    );
    await enqueue(collections, `compensate:${id}:seat`, 'compensate-purchase', { reservationId: id }, { session: tx });
    console.warn(`Webhook: płatność po czasie, fotel zajęty, zwrot dla rezerwacji ${id}`);
    return;
  }
  if (!ticket.issued) return;

  const cardAmount = session.amount_total;
  const pointsEarned = pointsEarnedFor(cardAmount);
  const { status, completed, results, ...insertOnly } = newSaga(reservation, amount);
  await sagas.updateOne(
    { _id: id },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        cardAmount,
        pointsEarned,
        'results.sessionId': session.id,
        'results.paymentIntent': session.payment_intent,
      },
      $addToSet: { completed: 'charge' },
      $setOnInsert: insertOnly,
    },
    { upsert: true, session: tx },
  );
  await enqueue(collections, `earn:${id}`, 'earn-points', { reservationId: id, email: reservation.email, points: pointsEarned }, { session: tx });
  await enqueue(collections, `email:${id}`, 'ticket-email', { reservationId: id }, { session: tx });
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

    if (PAID_EVENTS.has(event.type)) {
      try {
        await collections.transaction(async (tx) => {
          await collections.inbox.insertOne({ _id: event.id, type: event.type, processedAt: new Date() }, { session: tx });
          await applyPaidSession(collections, event.data.object, tx);
        });
      } catch (err) {
        // E11000 = to zdarzenie już obsłużyliśmy
        if (err?.code !== DUPLICATE_KEY) throw err;
      }
    }
    res.json({ received: true }); // 200 także dla duplikatu
  };
}
