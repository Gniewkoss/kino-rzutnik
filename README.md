# 🎬 Kino Rzutnik

System rezerwacji biletów do kina (projekt PAS S01, etap III). Klient wybiera seans i fotel, trzyma go przez 15 minut (w trybie testowym 2 minuty), płaci kartą na stronie Stripe'a, częściowo także punktami, i dostaje bilet z kodem na stronie i mailem.

**Stack:** Node.js 20+, Express 5, MongoDB, Stripe Checkout, Voucherify i Resend (tryby testowe). Frontend to statyczne strony HTML + JS serwowane przez ten sam serwer (monorepo).

## Uruchomienie

```bash
npm install
npm run dev
```

Bez `MONGODB_URI` serwer startuje z MongoDB w pamięci (pierwsze uruchomienie pobiera binarkę mongod). Baza musi być replica setem, bo outbox i inbox używają transakcji; Atlas i `docker compose` już nim są. Z prawdziwą bazą: skopiuj `.env.example` do `.env` albo użyj `docker compose up`.

Aplikacja: http://localhost:3000

## Konfiguracja

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `MONGODB_URI` | (pamięć) | adres MongoDB, np. Atlas |
| `MONGODB_DB` | `kino` | nazwa bazy |
| `RESERVATION_TTL_SECONDS` | `900` | czas ważności rezerwacji; **tryb testowy: `120`** |
| `RATE_LIMIT_MAX` | `30` | ile rezerwacji jeden klient (IP) może wysłać w oknie |
| `RATE_LIMIT_WINDOW_MS` | `10000` | długość okna limitu |
| `TRUST_PROXY` | `0` | liczba proxy przed aplikacją (na Render: `3`), żeby limit widział prawdziwe IP; sprawdzisz to w `/api/health` |
| `STRIPE_SECRET_KEY` | (brak) | klucz testowy `sk_test_…`; klucz `sk_live_…` zatrzymuje start serwera; bez klucza `checkout` odpowiada `503` |
| `STRIPE_WEBHOOK_SECRET` | (brak) | sekret `whsec_…` do sprawdzania podpisu webhooka |
| `PUBLIC_URL` | `RENDER_EXTERNAL_URL` albo `http://localhost:PORT` | adres sklepu do powrotów ze Stripe'a |
| `VOUCHERIFY_APP_ID`, `VOUCHERIFY_APP_TOKEN` | (brak) | klucze projektu Sandbox; bez nich płatność działa, tylko bez punktów |
| `VOUCHERIFY_CAMPAIGN_ID` | (brak) | kampania lojalnościowa, zakłada ją `npm run voucherify:setup` |
| `VOUCHERIFY_API_URL` | `https://api.voucherify.io` | adres API, jeśli konto jest na innym klastrze |
| `RESEND_API_KEY` | (brak) | klucz Resend; bez niego zakup działa, tylko bez maila |
| `MAIL_FROM` | `Kino Rzutnik <onboarding@resend.dev>` | nadawca maili |
| `ALLOW_DIRECT_PURCHASE` | `false` | `true` włącza zakup bez płatności z etapu I, tylko do testów |

## Stripe

1. Załóż konto Stripe i zostań w trybie testowym. Skopiuj klucz `sk_test_…`.
2. Dodaj nauczyciela: Settings → Team → New member, rola z dostępem tylko do odczytu.
3. Wdrożenie: w Stripe'ie Developers → Webhooks → Add endpoint, adres `https://kino-rzutnik.onrender.com/api/webhooks/stripe`, zdarzenia `checkout.session.completed` i `checkout.session.async_payment_succeeded`. W panelu Render ustaw `STRIPE_SECRET_KEY` i `STRIPE_WEBHOOK_SECRET` z tego endpointu.
4. Lokalnie:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... npm run dev
```

Czy klucze są ustawione, pokazuje `/api/health` (`stripe`, `stripeWebhook`).

| Karta testowa | Wynik |
|---|---|
| `4242 4242 4242 4242` | płatność udana |
| `4000 0000 0000 0002` | odmowa |
| `4000 0025 0000 3155` | dodatkowe potwierdzenie (3D Secure) |

Data ważności dowolna w przyszłości, CVC dowolne trzy cyfry.

`stripe trigger checkout.session.completed` tworzy sesję z własną kwotą i walutą, więc webhook ją odrzuci, jeśli nie zgadza się z rezerwacją. Pełny przepływ najlepiej sprawdzić przyciskiem „Zapłać”.

## Voucherify i Resend

1. Załóż konto Voucherify i pracuj w projekcie Sandbox. Klucze znajdziesz w ustawieniach projektu (Application ID i Secret Key).
2. Załóż kampanię, w której każda nowa karta ma 1000 punktów. Skrypt wypisze `VOUCHERIFY_CAMPAIGN_ID`:

```bash
VOUCHERIFY_APP_ID=... VOUCHERIFY_APP_TOKEN=... npm run voucherify:setup
```

3. Załóż konto Resend i klucz API. Bez własnej domeny maile dochodzą tylko na adres właściciela konta i na `delivered@resend.dev` (także `delivered+jan@resend.dev`).
4. Ustaw `VOUCHERIFY_APP_ID`, `VOUCHERIFY_APP_TOKEN`, `VOUCHERIFY_CAMPAIGN_ID` i `RESEND_API_KEY` w panelu Render.

Sandbox Voucherify przyjmuje 100 wywołań na godzinę. Zakup z punktami zużywa kilka, więc wystarczy na kilkanaście zakupów. Stan pokazuje `/api/health` (`voucherify`, `resend`, `deadLetters`).

## Test chaosu

Etapy II i III, bez kont. Skrypt sam uruchamia serwer i atrapę Stripe'a, Voucherify i Resend (podpisy, powtórzone webhooki, płatność po czasie, punkty, kompensacje, awarie usług). Atrapa nie zastępuje próby na prawdziwych usługach:

```bash
npm run chaos:stripe
```

Etap I: skrypt atakuje system według wszystkich 11 kryteriów i liczy punkty. Kupuje bilety bez płatności, więc potrzebuje `ALLOW_DIRECT_PURCHASE=true`:

```bash
ALLOW_DIRECT_PURCHASE=true RESERVATION_TTL_SECONDS=8 TRUST_PROXY=1 npm start   # w osobnym terminalu, krótki TTL = szybki test
npm run chaos                                        # albo: node scripts/chaos.mjs https://adres-firmy
```

Lokalnie `TRUST_PROXY=1` pozwala skryptowi udawać różnych klientów przez `X-Forwarded-For`. Na wdrożeniu proxy nadpisuje ten nagłówek, więc B5 (drugi klient z innej sieci) trzeba sprawdzić z drugiego urządzenia, np. telefonu na LTE.

## Wdrożenie

Limit ruchu jest trzymany w pamięci procesu, więc aplikacja musi działać jako **jedna instancja** (Render, Railway, Fly.io, VPS). Nie wdrażaj na funkcje serverless.

1. Darmowy klaster MongoDB Atlas (M0), skopiuj connection string.
2. Render → New → Blueprint → to repozytorium (`render.yaml`), w panelu ustaw `MONGODB_URI` i klucze Stripe'a (sekcja wyżej).
3. Sprawdź `https://adres/api/health`, potem `npm run chaos -- https://adres`.

## Dokumentacja zespołu

- [docs/KONTRAKT.md](docs/KONTRAKT.md): API, model danych, adresy stron
- [docs/ZAGROZENIA.md](docs/ZAGROZENIA.md): lista zagrożeń i jak każde jest obsłużone
- [docs/NIEZAWODNOSC.md](docs/NIEZAWODNOSC.md): outbox, inbox, saga i kompensacje w kodzie
- [docs/KARTY.md](docs/KARTY.md): podział pracy na karty i pliki
