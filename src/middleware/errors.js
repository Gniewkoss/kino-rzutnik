import { HttpError } from '../errors.js';

export function notFoundApi(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Nie ma takiego endpointu' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  // Błędy parsera JSON (zły body, za duży body) to błąd klienta, nie serwera
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'INVALID_JSON', message: 'Niepoprawny JSON' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Za duże żądanie' });
  }
  if (err?.status >= 400 && err?.status < 500) {
    return res.status(err.status).json({ error: 'BAD_REQUEST', message: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'INTERNAL', message: 'Błąd serwera' });
}
