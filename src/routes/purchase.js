// Karta C: zakup biletu na podstawie ważnej rezerwacji
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { HttpError } from '../errors.js';
import { isReservationId } from '../validation.js';
import { holdKey } from '../holds.js';

// Bez znaków mylących się na bilecie (0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function ticketCode() {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `RZ-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function purchaseRouter({ events, reservations, seatHolds }) {
  const router = Router();

  router.post('/:id/purchase', async (req, res) => {
    const { id } = req.params;
    if (!isReservationId(id)) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');

    const reservation = await reservations.findOne({ _id: id });
    if (!reservation) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');
    if (reservation.status === 'purchased') return res.status(200).json({ code: reservation.code });

    const key = holdKey(reservation.eventId, reservation.seatId);
    const now = new Date();
    const code = ticketCode();

    // Atomowo: kupić można tylko własną, jeszcze ważną rezerwację.
    // Ten sam dokument zmienia rezerwacja innej osoby, więc baza rozstrzyga wyścig.
    const won = await seatHolds.findOneAndUpdate(
      { _id: key, reservationId: id, status: 'held', expiresAt: { $gt: now } },
      { $set: { status: 'purchased', code, purchasedAt: now } },
      { returnDocument: 'after' },
    );

    let finalCode;
    if (won) {
      finalCode = won.code;
    } else {
      // Równoległy zakup tej samej rezerwacji mógł wygrać chwilę wcześniej: oddajemy ten sam kod
      const hold = await seatHolds.findOne({ _id: key });
      if (hold?.reservationId === id && hold.status === 'purchased') {
        finalCode = hold.code;
      } else {
        throw new HttpError(410, 'RESERVATION_EXPIRED', 'Rezerwacja wygasła, fotel wrócił do puli');
      }
    }

    await reservations.updateOne(
      { _id: id },
      { $set: { status: 'purchased', code: finalCode, purchasedAt: now } },
    );
    res.status(200).json({ code: finalCode });
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
      event,
    });
  });

  return router;
}
