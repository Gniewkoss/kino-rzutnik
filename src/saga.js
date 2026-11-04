// Saga zakupu (orkiestracja). Dokument w sagas pamięta, co się już udało, więc proces może paść, a stan zostaje.
//
//   krok            akcja                         kompensacja
//   points          punkty schodzą z karty        zwrot punktów na kartę
//   session         sesja Stripe Checkout         zamknięcie sesji
//   charge          klient zapłacił (webhook)     zwrot pieniędzy
//   bilet           kod biletu                    (ostatni krok, potem już tylko ≥1: punkty i mail)
import { enqueue } from './jobs.js';
import { withLock } from './locks.js';
import { ExternalError } from './external.js';
import { ticketEmail } from './mail.js';

const SWEEP_BATCH = 20;

export const newSaga = (reservation, amount) => ({
  type: 'ticket-purchase',
  status: 'running', // running | paying | completed | compensating | compensated
  email: reservation.email,
  amount,
  expiresAt: reservation.expiresAt,
  pointsUsed: 0,
  attempt: 1,
  completed: [],
  compensatedSteps: [],
  results: {},
  createdAt: new Date(),
});

export function createSagas(collections, { payments, loyalty, mailer, config }) {
  const { sagas, reservations, events } = collections;

  // Notatka przed wywołaniem: po awarii wiadomo, jaka zmiana salda była w toku, i kończymy ją zamiast zgadywać
  async function finishPendingPoints(saga) {
    const { pendingOp: op } = saga;
    if (!op) return saga;
    try {
      await loyalty.applyOp(op.id, saga.email, op.delta, op.reason);
    } catch (err) {
      if (err?.retryable === false) await sagas.updateOne({ _id: saga._id }, { $unset: { pendingOp: '' } });
      throw err;
    }
    return sagas.findOneAndUpdate(
      { _id: saga._id },
      {
        $set: { pointsUsed: op.target },
        $unset: { pendingOp: '' },
        ...(op.target > 0 ? { $addToSet: { completed: 'points' } } : { $pull: { completed: 'points' } }),
      },
      { returnDocument: 'after' },
    );
  }

  async function changePoints(saga, target) {
    const pendingOp = {
      id: `${saga._id}:points:${saga.attempt}:${target}`,
      delta: saga.pointsUsed - target,
      target,
      reason: `Bilet, rezerwacja ${saga._id}`,
    };
    const noted = await sagas.findOneAndUpdate({ _id: saga._id }, { $set: { pendingOp } }, { returnDocument: 'after' });
    return finishPendingPoints(noted);
  }

  async function compensate(reservationId) {
    let saga = await sagas.findOne({ _id: reservationId });
    if (!saga) return;
    saga = await finishPendingPoints(saga);

    const steps = [...saga.completed].reverse();
    for (const step of steps) {
      if (saga.compensatedSteps?.includes(step)) continue;

      if (step === 'charge') {
        const refund = await payments.refund({ id: saga.results.sessionId, payment_intent: saga.results.paymentIntent });
        await reservations.updateOne({ _id: reservationId }, { $set: { refundedAt: new Date(), refundId: refund.id } });
      } else if (step === 'session' && !saga.completed.includes('charge')) {
        // Najpierw zamykamy sesję: inaczej klient zapłaciłby pełną dopłatę za punkty, które już mu oddaliśmy
        const closed = await payments.expireSession(saga.results.sessionId);
        if (closed === 'complete') {
          // Klient zdążył zapłacić. O dalszym losie zakupu zdecyduje webhook.
          await sagas.updateOne({ _id: reservationId }, { $set: { status: 'paying' } });
          return;
        }
      } else if (step === 'points' && saga.pointsUsed > 0) {
        await loyalty.applyOp(`${reservationId}:return`, saga.email, saga.pointsUsed, `Zwrot punktów, rezerwacja ${reservationId}`);
        await sagas.updateOne({ _id: reservationId }, { $set: { pointsUsed: 0, 'results.pointsReturned': saga.pointsUsed } });
      }
      await sagas.updateOne({ _id: reservationId }, { $addToSet: { compensatedSteps: step } });
    }
    await sagas.updateOne({ _id: reservationId }, { $set: { status: 'compensated', compensatedAt: new Date() } });
  }

  const handlers = {
    // Klient nie zdążył, a fotel mógł przejąć ktoś inny. Też pod blokadą checkoutu tej rezerwacji.
    async 'compensate-purchase'({ reservationId }) {
      const { busy } = await withLock(collections, `checkout:${reservationId}`, () => compensate(reservationId));
      if (busy) throw new ExternalError('Saga', 'checkout tej rezerwacji jeszcze trwa', { retryAfterMs: 5000 });
    },

    // Płatność za sesję, która nie jest już aktualna: bilet nie powstał, więc oddajemy pieniądze
    async 'refund-session'({ sessionId, paymentIntent }) {
      await payments.refund({ id: sessionId, payment_intent: paymentIntent });
    },

    async 'earn-points'({ reservationId, email, points }) {
      if (!loyalty.available) return console.warn(`Brak Voucherify: pomijam ${points} pkt dla rezerwacji ${reservationId}`);
      await loyalty.applyOp(`${reservationId}:earn`, email, points, `Punkty za bilet, rezerwacja ${reservationId}`);
      await sagas.updateOne({ _id: reservationId }, { $set: { 'results.pointsCredited': true } });
    },

    async 'ticket-email'({ reservationId }) {
      if (!mailer) return console.warn(`Brak Resend: pomijam mail dla rezerwacji ${reservationId}`);
      const reservation = await reservations.findOne({ _id: reservationId });
      const saga = await sagas.findOne({ _id: reservationId });
      const event = await events.findOne({ _id: reservation.eventId });
      const mail = ticketEmail({
        code: reservation.code,
        title: event.title,
        startsAt: event.startsAt,
        hall: event.hall,
        seatId: reservation.seatId,
        customerName: reservation.customerName,
        cardAmount: saga.cardAmount,
        pointsUsed: saga.pointsUsed,
        pointsEarned: saga.pointsEarned,
        ticketUrl: `${config.publicUrl}/tickets/${reservation.code}`,
      });
      const sent = await mailer.send({ to: reservation.email, ...mail, idempotencyKey: `ticket-email:${reservationId}` });
      await reservations.updateOne({ _id: reservationId }, { $set: { mailId: sent.id, mailSentAt: new Date() } });
    },
  };

  // Rezerwacja wygasła bez płatności. Bez crona na każdą z osobna: po restarcie sweep zaczyna od zaległych.
  async function sweepExpired() {
    const expired = await sagas.find({ status: 'running', expiresAt: { $lte: new Date() } }, { projection: { _id: 1 } }).limit(SWEEP_BATCH).toArray();
    for (const { _id } of expired) {
      await collections.transaction(async (session) => {
        const claimed = await sagas.updateOne({ _id, status: 'running' }, { $set: { status: 'compensating', failedStep: 'expired' } }, { session });
        if (claimed.modifiedCount) await enqueue(collections, `compensate:${_id}:expired`, 'compensate-purchase', { reservationId: _id }, { session });
      });
    }
  }

  function startSweeper() {
    let stopped = false;
    let timer;
    const tick = async () => {
      if (stopped) return;
      try {
        await sweepExpired();
      } catch (err) {
        console.error('Sweep:', err.message);
      }
      if (!stopped) {
        timer = setTimeout(tick, config.sagaSweepMs);
        timer.unref();
      }
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  return { handlers, startSweeper, finishPendingPoints, changePoints };
}
