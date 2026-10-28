import { HttpError } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value, field, maxLen) {
  // typeof chroni też przed wstrzyknięciem operatorów Mongo, np. { "$gt": "" }
  if (typeof value !== 'string') throw new HttpError(400, 'VALIDATION', `Pole ${field} jest wymagane`);
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(400, 'VALIDATION', `Pole ${field} nie może być puste`);
  if (trimmed.length > maxLen) throw new HttpError(400, 'VALIDATION', `Pole ${field} jest za długie`);
  return trimmed;
}

export function parseReservationBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'VALIDATION', 'Brak danych rezerwacji');
  }
  const eventId = text(body.eventId, 'eventId', 200);
  const seatId = text(body.seatId, 'seatId', 20);
  const customerName = text(body.customerName, 'customerName', 100);
  const email = text(body.email, 'email', 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'VALIDATION', 'Niepoprawny adres e-mail');
  return { eventId, seatId, customerName, email };
}

export function isReservationId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}
