# Karty etapu I

Karty łączą się tylko przez [kontrakt](KONTRAKT.md). Każdy zaczyna od zaślepek, więc nikt nie czeka na nikogo.

| Karta | Pliki | Zakres |
|---|---|---|
| **A. Repertuar i sala** | `src/routes/events.js`, `src/seed.js`, `public/index.html`, `public/event.html`, `public/js/index.js`, `public/js/event.js` | lista seansów, mapa sali z ekranem i rzędami A–H, zajęte wyszarzone, klik w wolny → `/reserve` |
| **B. Rezerwacja fotela** | `src/routes/reservations.js`, `src/validation.js`, `public/reserve.html`, `public/js/reserve.js`, ekran licznika w `public/js/reservation.js` | formularz „Rząd F, miejsce 7”, zapis rezerwacji, licznik „Trzymamy Twój fotel jeszcze 14:32” |
| **C. Zakup biletu** | `src/routes/purchase.js`, przycisk w `public/js/reservation.js`, `public/ticket.html`, `public/js/ticket.js` | „Kupuję bilet”, bilet z kodem, komunikat „Rezerwacja wygasła, fotel wrócił do puli” |
| **L1. Limit ruchu** (lider, z listy zagrożeń) | `src/middleware/rateLimit.js` | `429` + `Retry-After` per IP |
| **L2. Błędy i spięcie** (lider) | `src/middleware/errors.js`, `src/app.js`, `scripts/chaos.mjs`, wdrożenie | kody 2xx/4xx/5xx, test chaosu przed demo |

Wspólne: `src/holds.js` (reguły `seatHolds`, zmiana tylko za zgodą lidera), `public/js/common.js`, `public/css/style.css`.

# Karty etapu II

Karty są niezależne tak jak w etapie I. Stripe jest schowany w `src/payments.js`, a do testów bez konta służy `scripts/fake-stripe.mjs`.

| Karta | Pliki | Zakres |
|---|---|---|
| **A. Checkout** | `src/routes/checkout.js`, `src/payments.js`, `src/seed.js`, ceny w `public/js/`, przycisk w `public/js/reservation.js` | `price` i `amount`, cena przy seansie i na ekranie rezerwacji, „Zapłać 32 zł”, przejście na stronę Stripe'a |
| **B. Webhook** | `src/routes/webhooks.js`, `src/tickets.js` | podpis, oznaczenie rezerwacji jako opłaconej, kod biletu, zwrot przy płatności po czasie |
| **C. Powrót do sklepu** | `GET /api/reservations/:id` w `src/routes/reservations.js`, `public/payment.html`, `public/js/payment.js`, komunikat po przerwaniu w `public/js/reservation.js` | „Płatność w toku…”, która sama zamienia się w bilet, ponowna płatność po przerwaniu |
| **L3. Spięcie** (lider) | `scripts/chaos-stripe.mjs`, `scripts/fake-stripe.mjs`, `docs/`, konfiguracja Stripe'a i Rendera | kontrakt wewnętrzny, lista zagrożeń 15–29, test przed demo |
