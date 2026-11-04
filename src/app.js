import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventsRouter } from './routes/events.js';
import { reservationsRouter } from './routes/reservations.js';
import { purchaseRouter, ticketsRouter } from './routes/purchase.js';
import { checkoutRouter } from './routes/checkout.js';
import { stripeWebhook } from './routes/webhooks.js';
import { createPayments } from './payments.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler, notFoundApi } from './middleware/errors.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(collections, config) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  const payments = createPayments(config);
  const limiter = () => rateLimit({ max: config.rateLimitMax, windowMs: config.rateLimitWindowMs });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Przed express.json: podpis Stripe'a liczy się z surowego ciała żądania
  app.post(
    '/api/webhooks/stripe',
    express.raw({ type: () => true, limit: '1mb' }),
    stripeWebhook(collections, { payments, webhookSecret: config.stripeWebhookSecret }),
  );
  app.use(express.json({ limit: '10kb' }));

  // ip: adres, który widzi limit ruchu (do sprawdzenia konfiguracji TRUST_PROXY na hostingu)
  app.get('/api/health', (req, res) => res.json({
    ok: true,
    ip: req.ip,
    forwardedFor: req.get('x-forwarded-for') || null,
    // Czy klucze Stripe'a są ustawione (same klucze nigdy nie wychodzą z serwera)
    stripe: Boolean(payments),
    stripeWebhook: Boolean(config.stripeWebhookSecret),
  }));
  app.use('/api/events', eventsRouter(collections));
  app.use(
    '/api/reservations',
    reservationsRouter(collections, {
      ttlMs: config.reservationTtlMs,
      limiter: limiter(),
      payments,
    }),
  );
  app.use('/api/reservations', checkoutRouter(collections, { payments, limiter: limiter() }));
  app.use('/api/reservations', purchaseRouter(collections, { allowDirectPurchase: config.allowDirectPurchase }));
  app.use('/api/tickets', ticketsRouter(collections));
  app.use('/api', notFoundApi);

  // Strony z kontraktu
  const page = (file) => (req, res) => res.sendFile(path.join(publicDir, file));
  app.get('/', page('index.html'));
  app.get('/events/:id', page('event.html'));
  app.get('/reserve', page('reserve.html'));
  app.get('/reservations/:id', page('reservation.html'));
  app.get('/reservations/:id/payment', page('payment.html'));
  app.get('/tickets/:code', page('ticket.html'));
  app.use(express.static(publicDir, { index: false }));
  app.use((req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

  app.use(errorHandler);
  return app;
}
