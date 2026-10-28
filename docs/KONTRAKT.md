# Kontrakt (etap I)

Zmiana kontraktu tylko za zgodą lidera.

## API wspólne dla wszystkich firm

| Metoda | Ścieżka | Body | Sukces | Odmowa |
|---|---|---|---|---|
| GET | `/api/events` | | `200` lista seansów (bez `seats`) | |
| GET | `/api/events/:id` | | `200 { event, takenSeats }` | `404` brak seansu |
| POST | `/api/reservations` | `{ eventId, seatId, customerName, email }` | `201 { reservationId, expiresAt }`; powtórzone identyczne żądanie: `200` z tą samą rezerwacją | `400` złe dane / brak fotela, `404` brak seansu, `409` fotel zajęty, `429` + `Retry-After` |
| POST | `/api/reservations/:id/purchase` | | `200 { code }` (ponowny zakup zwraca ten sam kod) | `404` brak rezerwacji / złe id, `410` rezerwacja wygasła |

`takenSeats` = fotele kupione + fotele z rezerwacją, której `expiresAt` jest w przyszłości.

## API wewnętrzne (tylko nasz frontend)

| Metoda | Ścieżka | Zwraca |
|---|---|---|
| GET | `/api/reservations/:id` | `{ reservationId, eventId, seatId, customerName, status: held \| expired \| purchased, createdAt, expiresAt, serverTime, code?, event }` |
| GET | `/api/tickets/:code` | `{ code, eventId, seatId, customerName, purchasedAt, event }` |
| GET | `/api/health` | `{ ok: true }` |

## Strony

| Adres | Ekran | Karta |
|---|---|---|
| `/` | repertuar | A |
| `/events/:id` | mapa sali, klik w wolny fotel → `/reserve` | A |
| `/reserve?eventId=…&seatId=…` | formularz rezerwacji | B |
| `/reservations/:reservationId` | licznik „Trzymamy Twój fotel jeszcze…” + „Kupuję bilet” | B + C |
| `/tickets/:code` | bilet: film, sala, rząd, miejsce, kod | C |

## Model danych (MongoDB)

```js
// events
{ _id: "seans-2026-11-21-1800", title, startsAt, hall, durationMin, genre, seats: ["A1", …, "H10"] }

// reservations: historia rezerwacji (kto, co, kiedy)
{ _id: "<uuid>", eventId, seatId, customerName, email, status: "held" | "purchased", createdAt, expiresAt, code?, purchasedAt? }

// seatHolds: źródło prawdy o zajętości. Jeden dokument na fotel na seansie.
{ _id: "<eventId>|<seatId>", eventId, seatId, reservationId, customerName, email, status: "held" | "purchased", expiresAt, code?, purchasedAt? }
```

`seatId` w formacie rząd + numer: `"F7"`. Sale 8×10: rzędy A–H, miejsca 1–10.
