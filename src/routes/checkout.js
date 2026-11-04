// Karty A i B: sesja płatności Stripe Checkout na kwotę z rezerwacji pomniejszoną o punkty
import { Router } from 'express';
import { HttpError } from '../errors.js';
import { isReservationId } from '../validation.js';
import { holdKey, reservationState } from '../holds.js';
import { withLock } from '../locks.js';
import { maxPointsFor } from '../loyalty.js';
import { newSaga } from '../saga.js';
import { ExternalError } from '../external.js';

function parsePoints(body) {
  const points = body?.points ?? 0;
  if (!Number.isInteger(points) || points < 0) throw new HttpError(400, 'INVALID_POINTS', 'Liczba punktów musi być liczbą całkowitą, nie mniejszą niż 0');
  return points;
}

const loyaltyDown = (err) => {
  console.warn(err.message);
  return new HttpError(503, 'LOYALTY_UNAVAILABLE', 'Punkty są chwilowo niedostępne. Spróbuj ponownie albo zapłać bez punktów.');
};

export function checkoutRouter(collections, { payments, loyalty, sagas: sagaService, limiter }) {
  const { events, reservations, seatHolds, sagas } = collections;
  const router = Router();

  async function refuseUnlessHeld(reservation) {
    const { state } = await reservationState(seatHolds, reservation);
    if (state === 'purchased') throw new HttpError(409, 'ALREADY_PAID', 'Ta rezerwacja jest już opłacona');
    if (state === 'expired') throw new HttpError(410, 'RESERVATION_EXPIRED', 'Rezerwacja wygasła, fotel wrócił do puli');
  }

  // Punkty schodzą przed sesją, więc wszystko pod jedną blokadą: podwójne „Zapłać” nie wyda punktów dwa razy
  async function prepareSession(reservation, event, amount, points) {
    const id = reservation._id;
    await refuseUnlessHeld(reservation);

    await sagas.updateOne({ _id: id }, { $setOnInsert: newSaga(reservation, amount) }, { upsert: true });
    let saga = await sagas.findOne({ _id: id });
    if (saga.status !== 'running') throw new HttpError(410, 'RESERVATION_EXPIRED', 'Rezerwacja wygasła, fotel wrócił do puli');

    try {
      saga = await sagaService.finishPendingPoints(saga);
    } catch (err) {
      if (err instanceof ExternalError) throw loyaltyDown(err);
      throw err;
    }

    if (points === saga.pointsUsed && saga.results.sessionUrl) return saga.results.sessionUrl;

    if (points !== saga.pointsUsed) {
      // Inna liczba punktów to inna kwota. Starą sesję trzeba zamknąć, żeby nie dało się zapłacić dwa razy.
      if (saga.results.sessionId) {
        let closed;
        try {
          closed = await payments.expireSession(saga.results.sessionId);
        } catch (err) {
          console.error('Stripe: nie udało się zamknąć sesji:', err.message);
          throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Nie udało się połączyć z płatnościami. Spróbuj ponownie, rezerwacja nadal trwa.');
        }
        if (closed === 'complete') throw new HttpError(409, 'ALREADY_PAID', 'Ta rezerwacja jest już opłacona');
        saga = await sagas.findOneAndUpdate(
          { _id: id },
          { $inc: { attempt: 1 }, $unset: { 'results.sessionId': '', 'results.sessionUrl': '' }, $pull: { completed: 'session' } },
          { returnDocument: 'after' },
        );
      }

      const extra = points - saga.pointsUsed;
      try {
        if (extra > 0) {
          // Sprawdzenie salda i odjęcie punktów pod blokadą e-maila: dwa zakupy naraz nie wydadzą tych samych punktów
          const { busy, value } = await loyalty.withEmailLock(reservation.email, async () => {
            const balance = await loyalty.freshPoints(reservation.email);
            if (balance < extra) throw new HttpError(409, 'INSUFFICIENT_POINTS', `Masz za mało punktów: ${balance}, a potrzeba ${extra}`);
            return sagaService.changePoints(saga, points);
          });
          if (busy) throw new HttpError(409, 'CHECKOUT_IN_PROGRESS', 'Inna płatność tego klienta właśnie trwa. Spróbuj za chwilę.');
          saga = value;
        } else {
          saga = await sagaService.changePoints(saga, points);
        }
      } catch (err) {
        if (err instanceof ExternalError) throw loyaltyDown(err);
        throw err;
      }
    }

    let session;
    try {
      session = await payments.createCheckout({
        reservationId: id,
        attempt: saga.attempt,
        amount: amount - points,
        name: `${event.title}, rząd ${reservation.seatId[0]}, miejsce ${reservation.seatId.slice(1)}`,
        email: reservation.email,
        expiresAt: reservation.expiresAt,
        metadata: { eventId: reservation.eventId, seatId: reservation.seatId, pointsUsed: String(points) },
      });
    } catch (err) {
      console.error('Stripe: nie udało się utworzyć sesji:', err.message);
      // Błąd trwały: ponawianie nic nie da, więc od razu oddajemy punkty. Przejściowy: punkty czekają na ponowienie.
      if (err.type === 'StripeInvalidRequestError' && saga.pointsUsed > 0) {
        await sagaService.changePoints(saga, 0).catch((e) => console.error(e.message));
      }
      throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Nie udało się połączyć z płatnościami. Spróbuj ponownie, rezerwacja nadal trwa.');
    }

    await sagas.updateOne(
      { _id: id },
      { $set: { 'results.sessionId': session.id, 'results.sessionUrl': session.url }, $addToSet: { completed: 'session' } },
    );
    return session.url;
  }

  router.post('/:id/checkout', limiter, async (req, res) => {
    const { id } = req.params;
    if (!isReservationId(id)) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');

    const reservation = await reservations.findOne({ _id: id });
    if (!reservation) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');

    await refuseUnlessHeld(reservation);
    if (!payments) throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Płatności są chwilowo niedostępne');

    const event = await events.findOne({ _id: reservation.eventId }, { projection: { title: 1, price: 1 } });
    const amount = reservation.amount ?? event.price;
    const points = parsePoints(req.body);
    if (points > maxPointsFor(amount)) {
      throw new HttpError(400, 'POINTS_OVER_LIMIT', `Punktami zapłacisz najwyżej połowę ceny: ${maxPointsFor(amount)} pkt`);
    }
    if (points > 0 && !loyalty.available) throw new HttpError(503, 'LOYALTY_UNAVAILABLE', 'Punkty są chwilowo niedostępne. Możesz zapłacić bez punktów.');

    const { busy, value: url } = await withLock(collections, `checkout:${id}`, () => prepareSession(reservation, event, amount, points));
    if (busy) throw new HttpError(409, 'CHECKOUT_IN_PROGRESS', 'Płatność tej rezerwacji właśnie się przygotowuje. Spróbuj za chwilę.');
    res.status(200).json({ url });
  });

  return router;
}
