import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventsRouter } from './routes/events.js';
import { reservationsRouter } from './routes/reservations.js';
import { purchaseRouter, ticketsRouter } from './routes/purchase.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler, notFoundApi } from './middleware/errors.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(collections, config) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(express.json({ limit: '10kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/events', eventsRouter(collections));
  app.use(
    '/api/reservations',
    reservationsRouter(collections, {
      ttlMs: config.reservationTtlMs,
      limiter: rateLimit({ max: config.rateLimitMax, windowMs: config.rateLimitWindowMs }),
    }),
  );
  app.use('/api/reservations', purchaseRouter(collections));
  app.use('/api/tickets', ticketsRouter(collections));
  app.use('/api', notFoundApi);

  // Strony z kontraktu
  const page = (file) => (req, res) => res.sendFile(path.join(publicDir, file));
  app.get('/', page('index.html'));
  app.get('/events/:id', page('event.html'));
  app.get('/reserve', page('reserve.html'));
  app.get('/reservations/:id', page('reservation.html'));
  app.get('/tickets/:code', page('ticket.html'));
  app.use(express.static(publicDir, { index: false }));
  app.use((req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

  app.use(errorHandler);
  return app;
}
