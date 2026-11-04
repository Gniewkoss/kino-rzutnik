// Karta A etapu II: sesja płatności Stripe Checkout z kwotą zapisaną w rezerwacji
import { Router } from 'express';
import { HttpError } from '../errors.js';
import { isReservationId } from '../validation.js';
import { holdKey, reservationState } from '../holds.js';

export function checkoutRouter({ events, reservations, seatHolds }, { payments, limiter }) {
  const router = Router();

  router.post('/:id/checkout', limiter, async (req, res) => {
    const { id } = req.params;
    if (!isReservationId(id)) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');

    const reservation = await reservations.findOne({ _id: id });
    if (!reservation) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');

    const { state } = await reservationState(seatHolds, reservation);
    if (state === 'purchased') throw new HttpError(409, 'ALREADY_PAID', 'Ta rezerwacja jest już opłacona');
    if (state === 'expired') throw new HttpError(410, 'RESERVATION_EXPIRED', 'Rezerwacja wygasła, fotel wrócił do puli');
    if (!payments) throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Płatności są chwilowo niedostępne');

    const event = await events.findOne({ _id: reservation.eventId }, { projection: { title: 1, price: 1 } });
    const { seatId } = reservation;

    let session;
    try {
      session = await payments.createCheckout({
        reservationId: id,
        amount: reservation.amount ?? event.price,
        name: `${event.title}, rząd ${seatId[0]}, miejsce ${seatId.slice(1)}`,
        email: reservation.email,
        expiresAt: reservation.expiresAt,
        metadata: { eventId: reservation.eventId, seatId },
      });
    } catch (err) {
      console.error('Stripe: nie udało się utworzyć sesji:', err.message);
      throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Nie udało się połączyć z płatnościami. Spróbuj ponownie, rezerwacja nadal trwa.');
    }

    // Numer sesji przy fotelu: gdy ktoś inny przejmie wygasły fotel, zamkniemy tę sesję
    const key = holdKey(reservation.eventId, seatId);
    await seatHolds.updateOne({ _id: key, reservationId: id, status: 'held' }, { $set: { stripeSessionId: session.id } });
    await reservations.updateOne({ _id: id }, { $set: { stripeSessionId: session.id } });

    res.status(200).json({ url: session.url });
  });

  return router;
}
