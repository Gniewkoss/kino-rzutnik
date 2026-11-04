// Karta A etapu III: saldo punktów klienta
import { Router } from 'express';
import { HttpError } from '../errors.js';
import { normalizeEmail } from '../validation.js';

export function loyaltyRouter({ loyalty, limiter }) {
  const router = Router();

  router.get('/', limiter, async (req, res) => {
    // W adresie "+" znaczy spację, a delivered+jan@resend.dev to poprawny e-mail. Spacji w e-mailu być nie może.
    const raw = typeof req.query.email === 'string' ? req.query.email.replaceAll(' ', '+') : '';
    const email = normalizeEmail(raw);
    if (!email) throw new HttpError(400, 'VALIDATION', 'Niepoprawny adres e-mail');
    res.json({ email, points: await loyalty.getPoints(email) });
  });

  return router;
}
