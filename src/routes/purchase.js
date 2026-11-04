// Bilet: zakup bezpośredni z etapu I i odczyt biletu po kodzie
import { Router } from 'express';
import { HttpError } from '../errors.js';
import { isReservationId } from '../validation.js';
import { reservationState } from '../holds.js';
import { issueTicket } from '../tickets.js';

export function purchaseRouter(collections, { allowDirectPurchase }) {
  const { reservations, seatHolds } = collections;
  const router = Router();

  router.post('/:id/purchase', async (req, res) => {
    const { id } = req.params;
    if (!isReservationId(id)) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');

    const reservation = await reservations.findOne({ _id: id });
    if (!reservation) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');

    const { state, hold } = await reservationState(seatHolds, reservation);
    if (state === 'purchased') return res.status(200).json({ code: hold.code });
    if (state === 'expired') throw new HttpError(410, 'RESERVATION_EXPIRED', 'Rezerwacja wygasła, fotel wrócił do puli');

    // Od etapu II bilet powstaje dopiero po płatności (webhook Stripe'a)
    if (!allowDirectPurchase) throw new HttpError(402, 'PAYMENT_REQUIRED', 'Bilet wystawiamy po płatności kartą');

    const code = await issueTicket(collections, reservation, { holdFilter: { expiresAt: { $gt: new Date() } } });
    if (!code) throw new HttpError(410, 'RESERVATION_EXPIRED', 'Rezerwacja wygasła, fotel wrócił do puli');
    res.status(200).json({ code });
  });

  return router;
}

export function ticketsRouter({ events, seatHolds }) {
  const router = Router();

  // Bilet po kodzie (poza wspólnym kontraktem): źródłem prawdy jest seatHolds
  router.get('/:code', async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const hold = await seatHolds.findOne({ code, status: 'purchased' });
    if (!hold) throw new HttpError(404, 'TICKET_NOT_FOUND', 'Nie ma takiego biletu');
    const event = await events.findOne(
      { _id: hold.eventId },
      { projection: { title: 1, startsAt: 1, hall: 1, durationMin: 1 } },
    );
    res.json({
      code: hold.code,
      eventId: hold.eventId,
      seatId: hold.seatId,
      customerName: hold.customerName,
      purchasedAt: hold.purchasedAt,
      amount: hold.amount,
      event,
    });
  });

  return router;
}
