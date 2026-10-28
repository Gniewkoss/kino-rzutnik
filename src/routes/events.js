// Karta A: wydarzenia (seanse) i mapa miejsc
import { Router } from 'express';
import { HttpError } from '../errors.js';

export function eventsRouter({ events, seatHolds }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const list = await events.find({}, { projection: { seats: 0 } }).sort({ startsAt: 1 }).toArray();
    res.json(list);
  });

  router.get('/:id', async (req, res) => {
    const event = await events.findOne({ _id: req.params.id });
    if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Nie ma takiego seansu');

    // Zajęte = kupione albo z ważną rezerwacją. Wygasłe liczymy w chwili odczytu,
    // więc fotel wraca do puli dokładnie o expiresAt, bez czekania na sprzątanie.
    const now = new Date();
    const taken = await seatHolds
      .find(
        { eventId: event._id, $or: [{ status: 'purchased' }, { status: 'held', expiresAt: { $gt: now } }] },
        { projection: { seatId: 1 } },
      )
      .toArray();

    res.json({ event, takenSeats: taken.map((h) => h.seatId) });
  });

  return router;
}
