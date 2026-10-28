// Limit żądań per klient (IP) w przesuwnym oknie czasowym.
// Trzymany w pamięci procesu, więc aplikacja musi działać jako jedna instancja.
export function rateLimit({ max, windowMs }) {
  const hits = new Map(); // ip -> tablica znaczników czasu

  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, times] of hits) {
      if (times[times.length - 1] <= cutoff) hits.delete(ip);
    }
  }, windowMs);
  sweep.unref();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const key = req.ip || 'unknown';
    const times = (hits.get(key) || []).filter((t) => t > cutoff);

    if (times.length >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
      hits.set(key, times);
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'TOO_MANY_REQUESTS',
        message: `Za dużo rezerwacji. Spróbuj ponownie za ${retryAfterSec} s.`,
      });
    }

    times.push(now);
    hits.set(key, times);
    next();
  };
}
