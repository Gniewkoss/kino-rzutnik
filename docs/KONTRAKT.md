# Kontrakt (etap II)

Zmiana kontraktu tylko za zgodą lidera.

## API wspólne dla wszystkich firm

| Metoda | Ścieżka | Body | Sukces | Odmowa |
|---|---|---|---|---|
| GET | `/api/events` | | `200` lista seansów (bez `seats`), każdy z `price` w groszach | |
| GET | `/api/events/:id` | | `200 { event, takenSeats }`, `event.price` w groszach | `404` brak seansu |
| POST | `/api/reservations` | `{ eventId, seatId, customerName, email }` | `201 { reservationId, expiresAt, amount }`; powtórzone identyczne żądanie: `200` z tą samą rezerwacją | `400` złe dane / brak fotela, `404` brak seansu, `409` fotel zajęty, `429` + `Retry-After` |
| GET | `/api/reservations/:id` | | `200 { status: "held" \| "paid" \| "expired", amount, expiresAt, code? }` oraz pola dla naszego frontendu (niżej) | `404` brak rezerwacji / złe id |
| POST | `/api/reservations/:id/checkout` | | `200 { url }`: strona płatności Stripe'a; kolejne wywołania zwracają tę samą sesję | `404` brak rezerwacji, `409` już opłacona, `410` wygasła, `429` + `Retry-After`, `502` Stripe nie odpowiada, `503` brak kluczy |
| POST | `/api/webhooks/stripe` | surowe zdarzenie Stripe'a z nagłówkiem `Stripe-Signature` | `200 { received: true }` | `400` zły podpis, `500` nieudany zwrot (Stripe ponowi), `503` brak kluczy |
| POST | `/api/reservations/:id/purchase` | | `200 { code }` dla opłaconej rezerwacji (ten sam kod) | `402` nieopłacona, `404` brak rezerwacji / złe id, `410` rezerwacja wygasła |

`takenSeats` = fotele kupione + fotele z rezerwacją, której `expiresAt` jest w przyszłości.

`amount` to cena zapisana w chwili rezerwacji i już się nie zmienia. Waluta to PLN, kwoty w groszach (`3200` = 32 zł).

Z `ALLOW_DIRECT_PURCHASE=true` (tylko testy) `purchase` działa jak w etapie I: `200 { code }` bez płatności.

## API wewnętrzne (tylko nasz frontend)

| Metoda | Ścieżka | Zwraca |
|---|---|---|
| GET | `/api/reservations/:id` | dodatkowo `{ reservationId, eventId, seatId, customerName, refunded?, createdAt, serverTime, event }` |
| GET | `/api/tickets/:code` | `{ code, eventId, seatId, customerName, purchasedAt, amount, event }` |
| GET | `/api/health` | `{ ok: true, stripe, stripeWebhook, ip, forwardedFor }`; `stripe` i `stripeWebhook` mówią tylko, czy klucze są ustawione |

## Płatność

- Sesja Checkout ma `client_reference_id` = id rezerwacji, kwotę `amount` i walutę PLN. Metody płatności ustawia się w panelu Stripe'a.
- Bilet powstaje wyłącznie w webhooku po `checkout.session.completed` z `payment_status: "paid"` (albo `checkout.session.async_payment_succeeded` dla metod z opóźnieniem).
- Płatność po czasie: fotel wolny → bilet; fotel zajęty → automatyczny zwrot, `status: "expired"`, `refunded: true`.

## Strony

| Adres | Ekran | Karta |
|---|---|---|
| `/` | repertuar | A |
| `/events/:id` | mapa sali, klik w wolny fotel → `/reserve` | A |
| `/reserve?eventId=…&seatId=…` | formularz rezerwacji | B |
| `/reservations/:reservationId` | licznik „Trzymamy Twój fotel jeszcze…”, cena, „Zapłać 32 zł” | A |
| `/reservations/:reservationId/payment` | powrót po zapłacie (`success_url`): „Płatność w toku…”, sama zamienia się w bilet | C |
| `/reservations/:reservationId?payment=canceled` | powrót po przerwaniu (`cancel_url`): komunikat i ponowna płatność | C |
| `/tickets/:code` | bilet: film, sala, rząd, miejsce, kod | C |

## Model danych (MongoDB)

```js
// events
{ _id: "seans-2026-11-21-1800", title, startsAt, hall, durationMin, genre, price: 3200, seats: ["A1", …, "H10"] }

// reservations: historia rezerwacji (kto, co, kiedy)
{ _id: "<uuid>", eventId, seatId, customerName, email, amount, status: "held" | "purchased", createdAt, expiresAt, code?, purchasedAt?, stripeSessionId?, paymentIntent?, refundedAt?, refundId? }

// seatHolds: źródło prawdy o zajętości. Jeden dokument na fotel na seansie.
{ _id: "<eventId>|<seatId>", eventId, seatId, reservationId, customerName, email, amount, status: "held" | "purchased", expiresAt, code?, purchasedAt?, stripeSessionId? }
```

W bazie opłacona rezerwacja ma status `purchased`, a API pokazuje go jako `paid`.

`seatId` w formacie rząd + numer: `"F7"`. Sale 8×10: rzędy A–H, miejsca 1–10.
