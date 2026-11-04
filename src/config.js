function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Zmienna ${name} musi być liczbą, jest: ${raw}`);
  return n;
}

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
// Projekt działa wyłącznie w trybie testowym: klucz produkcyjny zatrzymuje start serwera
if (/^(sk|rk)_live_/.test(stripeSecretKey)) throw new Error('STRIPE_SECRET_KEY: dozwolone są tylko klucze testowe (sk_test_…)');

const port = int('PORT', 3000);

export const config = {
  port,
  mongoUri: process.env.MONGODB_URI || '',
  mongoDb: process.env.MONGODB_DB || 'kino',
  // 15 minut na produkcji; w trybie testowym ustawiamy 120 (2 minuty)
  reservationTtlMs: int('RESERVATION_TTL_SECONDS', 900) * 1000,
  rateLimitMax: int('RATE_LIMIT_MAX', 30),
  rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 10_000),
  trustProxy: int('TRUST_PROXY', 0),
  stripeSecretKey,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripeApiBase: process.env.STRIPE_API_BASE || '',
  // Adresy powrotu ze Stripe'a. Nie bierzemy ich z nagłówka Host, bo ten ustawia klient.
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  // Zakup bez płatności z etapu I. Tylko do testów, np. npm run chaos
  allowDirectPurchase: process.env.ALLOW_DIRECT_PURCHASE === 'true',
};
