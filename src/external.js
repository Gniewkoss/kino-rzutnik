// Błąd cudzego systemu. retryable mówi, czy ponawianie ma sens (E03): sieć, 5xx i 429 tak, reszta 4xx nie.
export class ExternalError extends Error {
  constructor(service, message, { status, retryable = true, retryAfterMs, unknownOutcome = false } = {}) {
    super(`${service}: ${message}`);
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    // Żądanie mogło dojść mimo błędu (timeout, 5xx): skutku po naszej stronie nie znamy
    this.unknownOutcome = unknownOutcome;
  }
}

export function fromResponse(service, res, message) {
  const retryAfter = Number(res.headers.get('retry-after'));
  const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
  return new ExternalError(service, `${res.status} ${message}`, {
    status: res.status,
    retryable,
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    unknownOutcome: res.status >= 500,
  });
}
