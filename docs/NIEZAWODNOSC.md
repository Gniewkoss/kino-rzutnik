# Niezawodność: E07 „Poza naszą bazą” i E08 „Saga” w kodzie

## Cała droga zakupu

| Krok | Gdzie | Kto pilnuje | Kod |
|---|---|---|---|
| 1. Punkty schodzą z karty | Voucherify | notatka `pendingOp` + `pointsOps`, po niepewnym wyniku sprawdzenie historii karty (brak klucza idempotencji u dostawcy) | `src/loyalty.js`, `src/saga.js` |
| 2. Sesja płatności | Stripe | klucz idempotencji `checkout:<rezerwacja>:<próba>` | `src/payments.js`, `src/routes/checkout.js` |
| 3. Webhook o płatności | Stripe → nasze API | Stripe ponawia (≥1), podpis | `src/routes/webhooks.js` |
| 4. Bilet, saga i zadania | nasza baza | inbox + outbox w jednej transakcji | `src/routes/webhooks.js`, `src/jobs.js` |
| 5. Punkty za zakup | Voucherify | outbox, ponawianie, jak w kroku 1 | `earn-points` w `src/saga.js` |
| 6. Mail z biletem | Resend | outbox + klucz idempotencji `ticket-email:<rezerwacja>` | `ticket-email` w `src/saga.js`, `src/mail.js` |

## Narzędzia z prezentacji

| Narzędzie | Gdzie |
|---|---|
| 📤 Outbox | kolekcja `jobs` i worker w `src/jobs.js`: te same pola co w E06/E07 (`task`, `input`, `visibleAt`, `totalTried`, `completedAt`, `hasError`) |
| 🔑 Klucz idempotencji | Stripe (sesja, zwrot), Resend (mail), Voucherify przy zakładaniu karty (`source_id` publikacji) |
| ⚖ Dostawca bez klucza | zmiana salda w Voucherify. Punkty to pieniądze, więc nie godzimy się na duplikat: `source_id` operacji + sprawdzenie historii karty przed powtórką |
| 📥 Inbox | kolekcja `inbox`, `_id` = ID zdarzenia Stripe'a, TTL 7 dni, zapis w transakcji ze skutkiem |
| ↩ Kompensacja | zwrot punktów, zamknięcie sesji, zwrot pieniędzy, od końca: `compensate` w `src/saga.js` |
| 🎼 Saga: orkiestracja | kolekcja `sagas`: `status`, `completed`, `results`, `failedStep`. Jeden koordynator, jeden właściciel procesu |
| 🔁 Kompensacja też może paść | to zwykłe zadanie outboxu: ponawianie, klucze idempotencji, `compensatedSteps`, DLQ |
| ⏳ Stan pośredni | „Płatność w toku…” (`public/js/payment.js`). Bilet pojawia się dopiero po webhooku, a punkty za zakup zapisane jako należne dochodzą chwilę później |
| 🪦 DLQ | `hasError: true`, licznik `deadLetters` w `/api/health` |

Choreografii nie używamy: proces ma jednego właściciela, więc wystarcza orkiestracja.

## Dlaczego kompensacja zaczyna od sesji

Sesja Stripe'a żyje minimum 30 minut, a rezerwacja 15 (w teście 2). Gdybyśmy najpierw oddali punkty, klient mógłby jeszcze zapłacić dopłatę po zniżce i mieć i punkty, i tańszy bilet. Dlatego najpierw zamykamy sesję. Jeśli Stripe odpowie, że sesja jest już opłacona, kompensacja się wycofuje (`status: "paying"`), a o losie zakupu decyduje webhook.

## Czego świadomie nie ma

- **Odbicia maila (bounce):** Resend zgłasza je później, swoim webhookiem. Bilet zawsze jest na stronie, więc odbity mail nie blokuje zakupu.
- **Worker w tym samym procesie:** Render uruchamia jedną instancję, więc worker działa w serwerze. Darmowy Render usypia serwer, więc zaległe zadania ruszają po wybudzeniu. Stan jest w bazie, nic nie ginie.
- **`POST /api/reservations` bez transakcji:** fotel i rezerwacja zapisują się osobno, z ręcznym wycofaniem. Po awarii między zapisami fotel zwolni się sam po `expiresAt`, więc skutek jest nieszkodliwy.
