# 🎬 Kino Rzutnik

System rezerwacji biletów do kina (projekt PAS S01, etap II). Klient wybiera seans i fotel, trzyma go przez 15 minut (w trybie testowym 2 minuty), płaci kartą na stronie Stripe'a i wraca po bilet z kodem.

**Stack:** Node.js 20+, Express 5, MongoDB, Stripe Checkout (tryb testowy). Frontend to statyczne strony HTML + JS serwowane przez ten sam serwer (monorepo).

## Uruchomienie

```bash
npm install
npm run dev
```

Bez `MONGODB_URI` serwer startuje z MongoDB w pamięci (pierwsze uruchomienie pobiera binarkę mongod). Z prawdziwą bazą: skopiuj `.env.example` do `.env` albo użyj `docker compose up`.

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

## Test chaosu

Etap II, bez konta Stripe. Skrypt sam uruchamia serwer i atrapę API Stripe'a (podpisy, powtórzone webhooki, płatność po czasie, zwroty, awaria Stripe'a):

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
- [docs/KARTY.md](docs/KARTY.md): podział pracy na karty i pliki
