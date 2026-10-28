# Lista zagrożeń (etap I)

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
| 11 | Limit widzi IP proxy zamiast klienta i blokuje wszystkich | B5 | `TRUST_PROXY=1` na hostingu. |
| 12 | Kilka instancji aplikacji = osobne liczniki limitu | B5 | Wdrażamy jedną instancję. Przy skalowaniu limit trzeba przenieść do Redisa. |
| 13 | Zegar klienta się spieszy i licznik kłamie | UI | Serwer zwraca `serverTime`, licznik liczy względem niego. Decyzję i tak podejmuje serwer. |
| 14 | Nieoczekiwany wyjątek zwraca HTML albo wisi | wszystkie | Globalny handler błędów: zawsze JSON, `5xx` tylko dla prawdziwych błędów serwera. |
