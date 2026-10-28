// Karta B: rezerwacja fotela (trzymany przez RESERVATION_TTL_SECONDS)
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../errors.js';
import { parseReservationBody, isReservationId } from '../validation.js';
import { holdKey, holdState } from '../holds.js';

const DUPLICATE_KEY = 11000;

export function reservationsRouter({ events, reservations, seatHolds }, { ttlMs, limiter }) {
  const router = Router();

  router.post('/', limiter, async (req, res) => {
    const input = parseReservationBody(req.body);

    const event = await events.findOne({ _id: input.eventId }, { projection: { seats: 1 } });
    if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Nie ma takiego seansu');
    if (!event.seats.includes(input.seatId)) {
      throw new HttpError(400, 'SEAT_NOT_FOUND', 'Nie ma takiego fotela w tej sali');
    }

    const key = holdKey(input.eventId, input.seatId);

    // Dwie próby: jeśli między zderzeniem a odczytem cudza rezerwacja akurat wygasła
    for (let attempt = 0; attempt < 2; attempt++) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs);
      const reservationId = randomUUID();

      try {
        // Atomowo: fotel wolny (brak dokumentu) albo trzymany przez wygasłą rezerwację.
        // Jeśli fotel jest zajęty, filtr nie pasuje, upsert próbuje wstawić ten sam _id
        // i baza zwraca duplicate key. Dzięki temu z 20 równoległych prób wygrywa jedna.
        await seatHolds.updateOne(
          { _id: key, status: 'held', expiresAt: { $lte: now } },
          {
            $set: {
              eventId: input.eventId,
              seatId: input.seatId,
              reservationId,
              customerName: input.customerName,
              email: input.email,
              status: 'held',
              expiresAt,
              createdAt: now,
            },
            $unset: { code: '', purchasedAt: '' },
          },
          { upsert: true },
        );
      } catch (err) {
        if (err?.code !== DUPLICATE_KEY) throw err;

        const hold = await seatHolds.findOne({ _id: key });
        const state = holdState(hold, new Date());
        if (state === 'free') continue;

        // Idempotentność: ten sam klient powtórzył to samo żądanie, oddajemy tę samą rezerwację
        if (state === 'held' && hold.email === input.email && hold.customerName === input.customerName) {
          return res.status(200).json({ reservationId: hold.reservationId, expiresAt: hold.expiresAt });
        }
        throw new HttpError(409, 'SEAT_TAKEN', 'Ten fotel jest już zajęty');
      }

      try {
        await reservations.insertOne({ _id: reservationId, ...input, status: 'held', expiresAt, createdAt: now });
      } catch (err) {
        // Nie zostawiamy fotela zablokowanego przez rezerwację, której nie ma
        await seatHolds.deleteOne({ _id: key, reservationId, status: 'held' }).catch(() => {});
        throw err;
      }

      return res.status(201).json({ reservationId, expiresAt });
    }

    throw new HttpError(409, 'SEAT_TAKEN', 'Ten fotel jest już zajęty');
  });

  // Stan rezerwacji dla ekranu z licznikiem (poza wspólnym kontraktem)
  router.get('/:id', async (req, res) => {
    if (!isReservationId(req.params.id)) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');
    const reservation = await reservations.findOne({ _id: req.params.id });
    if (!reservation) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'Nie ma takiej rezerwacji');

    const now = new Date();
    const hold = await seatHolds.findOne({ _id: holdKey(reservation.eventId, reservation.seatId) });
    const mine = hold?.reservationId === reservation._id;
    const state = mine ? holdState(hold, now) : 'free';
    const status = state === 'purchased' ? 'purchased' : state === 'held' ? 'held' : 'expired';

    const event = await events.findOne(
      { _id: reservation.eventId },
      { projection: { title: 1, startsAt: 1, hall: 1, durationMin: 1 } },
    );

    res.json({
      reservationId: reservation._id,
      eventId: reservation.eventId,
      seatId: reservation.seatId,
      customerName: reservation.customerName,
      status,
      createdAt: reservation.createdAt,
      expiresAt: reservation.expiresAt,
      serverTime: now,
      code: status === 'purchased' ? hold.code : undefined,
      event,
    });
  });

  return router;
}
