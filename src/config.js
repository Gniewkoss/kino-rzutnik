function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Zmienna ${name} musi być liczbą, jest: ${raw}`);
  return n;
}

export const config = {
  port: int('PORT', 3000),
  mongoUri: process.env.MONGODB_URI || '',
  mongoDb: process.env.MONGODB_DB || 'kino',
  // 15 minut na produkcji; w trybie testowym ustawiamy 120 (2 minuty)
  reservationTtlMs: int('RESERVATION_TTL_SECONDS', 900) * 1000,
  rateLimitMax: int('RATE_LIMIT_MAX', 30),
  rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 10_000),
  trustProxy: int('TRUST_PROXY', 0),
};
