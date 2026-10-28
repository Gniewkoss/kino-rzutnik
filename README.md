# 🎬 Kino Rzutnik

System rezerwacji biletów do kina (projekt PAS S01, etap I). Klient wybiera seans i fotel, trzyma go przez 15 minut (w trybie testowym 2 minuty), a potem kupuje bilet z kodem.

**Stack:** Node.js 20+, Express 5, MongoDB. Frontend to statyczne strony HTML + JS serwowane przez ten sam serwer (monorepo).

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

## Test chaosu

Skrypt atakuje system według wszystkich 11 kryteriów etapu I i liczy punkty:

```bash
RESERVATION_TTL_SECONDS=8 TRUST_PROXY=1 npm start   # w osobnym terminalu, krótki TTL = szybki test
npm run chaos                                        # albo: node scripts/chaos.mjs https://adres-firmy
```

Lokalnie `TRUST_PROXY=1` pozwala skryptowi udawać różnych klientów przez `X-Forwarded-For`. Na wdrożeniu proxy nadpisuje ten nagłówek, więc B5 (drugi klient z innej sieci) trzeba sprawdzić z drugiego urządzenia, np. telefonu na LTE.

## Wdrożenie

Limit ruchu jest trzymany w pamięci procesu, więc aplikacja musi działać jako **jedna instancja** (Render, Railway, Fly.io, VPS). Nie wdrażaj na funkcje serverless.

1. Darmowy klaster MongoDB Atlas (M0), skopiuj connection string.
2. Render → New → Blueprint → to repozytorium (`render.yaml`), w panelu ustaw `MONGODB_URI`.
3. Sprawdź `https://adres/api/health`, potem `npm run chaos -- https://adres`.

## Dokumentacja zespołu

- [docs/KONTRAKT.md](docs/KONTRAKT.md): API, model danych, adresy stron
- [docs/ZAGROZENIA.md](docs/ZAGROZENIA.md): lista zagrożeń i jak każde jest obsłużone
- [docs/KARTY.md](docs/KARTY.md): podział pracy na karty i pliki
