# Lista zagrożeń (etapy I i II)

| # | Co może pójść nie tak | Kryterium | Jak to obsługujemy |
|---|---|---|---|
| 1 | Dwie osoby rezerwują ten sam fotel w tej samej milisekundzie | B2 | Fotel to jeden dokument `seatHolds` o stałym `_id`. Rezerwacja to atomowy upsert z warunkiem „wolny albo wygasły”. Gdy fotel jest zajęty, baza odrzuca wstawienie (duplicate key) i dostajemy `409`. Nie ma okna „sprawdź, potem zapisz”. |
| 2 | Klient klika „Zarezerwuj” dwa razy albo przeglądarka ponawia żądanie | B1 | Przegrany zapis sprawdza, czy fotel trzyma ten sam e-mail i imię. Jeśli tak, zwraca tę samą rezerwację (`200`). W UI przycisk blokuje się na czas żądania. |
| 3 | Podwójne „Kupuję” | C1 | Zakup to atomowa zmiana `held → purchased`. Drugi zakup widzi, że rezerwacja jest już kupiona, i zwraca ten sam kod. |
| 4 | Zakup X i rezerwacja Y dokładnie w chwili wygaśnięcia | C2 | Obie operacje zmieniają ten sam dokument `seatHolds` warunkowo, więc baza wykonuje je po kolei. Wygrywa jedna, druga dostaje `410` / `409`. |
| 5 | Wygasła rezerwacja dalej blokuje fotel | A2, B4 | Nie ma crona do sprzątania. Ważność liczymy przy każdym odczycie i zapisie (`expiresAt > teraz`), więc fotel wraca do puli dokładnie o `expiresAt`. |
| 6 | Kupiony fotel się zwalnia po czasie rezerwacji | C4 | Status `purchased` nie ma terminu ważności, a warunek rezerwacji wymaga `status: "held"`. |
| 7 | Zakup po czasie | C4 | Warunek `expiresAt > teraz` w atomowym update; po czasie `410`. |
| 8 | Złe dane: brak pól, pusty e-mail, fotel spoza sali, nieistniejący seans, zepsuty JSON | B3, A1, C3 | Walidacja przed zapisem (`400` / `404`). Błąd parsera JSON to `400`, nie `500`. Id rezerwacji musi być UUID, inaczej `404`. |
| 9 | Wstrzyknięcie operatorów Mongo (`{"eventId": {"$gt": ""}}`) | B3 | Każde pole musi być stringiem. |
| 10 | Jeden klient zalewa API rezerwacjami i zajmuje całą salę | B5 | Limit 30 rezerwacji / 10 s na IP, potem `429` z `Retry-After`. Inni klienci nie są blokowani. |
| 11 | Limit widzi IP proxy zamiast klienta i blokuje wszystkich | B5 | `TRUST_PROXY` ustawione na liczbę proxy na hostingu (Render: `3`). |
| 12 | Kilka instancji aplikacji = osobne liczniki limitu | B5 | Wdrażamy jedną instancję. Przy skalowaniu limit trzeba przenieść do Redisa. |
| 13 | Zegar klienta się spieszy i licznik kłamie | UI | Serwer zwraca `serverTime`, licznik liczy względem niego. Decyzję i tak podejmuje serwer. |
| 14 | Nieoczekiwany wyjątek zwraca HTML albo wisi | wszystkie | Globalny handler błędów: zawsze JSON, `5xx` tylko dla prawdziwych błędów serwera. |

## Etap II: Stripe jako usługa zewnętrzna

| # | Co może pójść nie tak | Karta | Jak to obsługujemy |
|---|---|---|---|
| 15 | Ktoś wysyła fałszywy webhook „zapłacono” | B | Podpis sprawdza `constructEvent` na surowym ciele żądania. Brak podpisu, zły albo stary podpis, zmienione ciało: `400`, bez zmian w bazie. Bez `STRIPE_WEBHOOK_SECRET` webhook odpowiada `503`, nigdy nie przyjmuje zdarzeń bez podpisu. |
| 16 | Stripe wysyła to samo zdarzenie kilka razy albo równolegle | B | Wystawienie biletu to atomowa zmiana `held → purchased`. Każdy kolejny webhook dostaje `200` i ten sam kod. |
| 17 | Klient płaci po czasie, bo sesja Stripe'a żyje minimum 30 minut, a rezerwacja 15 (w teście 2) | B | Webhook nie sprawdza `expiresAt`. Jeśli fotel nadal jest przy tej rezerwacji, klient dostaje bilet, bo pieniądze już są. |
| 18 | Klient płaci po czasie, a fotel ma już ktoś inny | B | Nie ma podwójnej sprzedaży: warunek dotyczy `reservationId`, więc bilet nie powstaje. Webhook robi automatyczny zwrot (klucz idempotencji chroni przed drugim), a klient widzi komunikat o zwrocie. Dodatkowo przejęcie fotela zamyka starą sesję Stripe'a. |
| 19 | Podwójne kliknięcie „Zapłać” albo dwie karty przeglądarki: dwie sesje i dwa obciążenia | A | Klucz idempotencji `checkout:<reservationId>` i niezmienne parametry: zawsze ta sama sesja. |
| 20 | Klient zmienia kwotę w przeglądarce | A | Kwota nie przychodzi od klienta. Serwer bierze ją z rezerwacji, gdzie została zapisana w chwili rezerwowania. |
| 21 | Zmiana ceny seansu w trakcie rezerwacji | A | `amount` w rezerwacji już się nie zmienia. Webhook sprawdza, czy kwota i waluta sesji zgadzają się z rezerwacją. |
| 22 | Klient wchodzi na stronę powrotu bez płacenia | C | Strona niczego nie potwierdza, tylko czyta `GET /api/reservations/:id`. Kod pojawia się dopiero przy statusie `paid`, czyli po webhooku. |
| 23 | Bilet za darmo przez `POST /purchase` z etapu I | C | Endpoint dalej odpowiada `404` / `410` i oddaje kod opłaconej rezerwacji, ale ważna nieopłacona dostaje `402`. Stary zakup włącza tylko `ALLOW_DIRECT_PURCHASE=true` w testach. |
| 24 | Webhook przychodzi później niż klient albo serwer śpi (darmowy Render) | C | Strona „płatność w toku…” odpytuje status i sama zamienia się w bilet. Status `expired` tuż po powrocie nie jest ostateczny przez 45 s. Stripe ponawia webhook przez kilka dni, jeśli nie dostanie `2xx`. |
| 25 | Stripe nie działa albo nie odpowiada | A | Limit 10 s, ponowienia po stronie SDK, potem `502` z komunikatem. Rezerwacja trwa dalej i można kliknąć jeszcze raz. Bez kluczy: `503`. |
| 26 | Zwrot się nie udaje | B | Webhook odpowiada `500`, więc Stripe ponowi zdarzenie i zwrot też. |
| 27 | Wyciek klucza albo prawdziwe pieniądze | wszystkie | Klucze tylko w zmiennych środowiskowych na serwerze, nie w repozytorium ani w przeglądarce. Klucz `sk_live_` / `rk_live_` zatrzymuje start serwera. |
| 28 | Fałszywy adres powrotu przez nagłówek `Host` | A | Adresy powrotu biorą się z konfiguracji (`PUBLIC_URL` / `RENDER_EXTERNAL_URL`), nie z żądania. |
| 29 | Zalewanie `checkout`, każde żądanie to wywołanie Stripe'a | A | Osobny limit na IP, taki sam jak dla rezerwacji: `429` + `Retry-After`. |
