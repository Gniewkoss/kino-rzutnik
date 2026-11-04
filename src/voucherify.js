// Klient Voucherify. Sandbox przyjmuje 100 wywołań na godzinę, a przekroczenie blokuje dostęp,
// więc po 429 milkniemy do podanego czasu, a saldo do podglądu oddajemy jako pierwsze, gdy limit się kończy.
import { ExternalError, fromResponse } from './external.js';

const TIMEOUT_MS = 8000;
const BREAKER_FAILURES = 5;
const BREAKER_OPEN_MS = 30_000;
const KEEP_FOR_PAYMENTS = 25;

export function createVoucherify(config) {
  if (!config.voucherifyAppId || !config.voucherifyAppToken || !config.voucherifyCampaignId) return null;

  const campaign = encodeURIComponent(config.voucherifyCampaignId);
  let failures = 0;
  let blockedUntil = 0;
  let remaining = Infinity;

  async function request(method, path, { body, lowPriority = false } = {}) {
    const now = Date.now();
    if (now < blockedUntil) {
      throw new ExternalError('Voucherify', 'chwilowo nie wysyłamy żądań', { retryAfterMs: blockedUntil - now });
    }
    if (lowPriority && remaining < KEEP_FOR_PAYMENTS) {
      throw new ExternalError('Voucherify', 'oszczędzamy limit wywołań na płatności');
    }

    let res;
    try {
      res = await fetch(config.voucherifyApiUrl + path, {
        method,
        headers: {
          'X-App-Id': config.voucherifyAppId,
          'X-App-Token': config.voucherifyAppToken,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (++failures >= BREAKER_FAILURES) blockedUntil = Date.now() + BREAKER_OPEN_MS;
      throw new ExternalError('Voucherify', err.message, { unknownOutcome: true });
    }

    const left = Number(res.headers.get('x-rate-limit-remaining'));
    if (res.headers.has('x-rate-limit-remaining') && Number.isFinite(left)) remaining = left;

    if (res.status === 429) {
      const retryAt = Number(res.headers.get('x-rate-limit-retry')) * 1000;
      const error = fromResponse('Voucherify', res, 'przekroczony limit wywołań');
      const waitMs = error.retryAfterMs ?? (retryAt > Date.now() ? retryAt - Date.now() : 60_000);
      blockedUntil = Date.now() + waitMs;
      error.retryAfterMs = waitMs;
      throw error;
    }
    if (res.status >= 500) {
      if (++failures >= BREAKER_FAILURES) blockedUntil = Date.now() + BREAKER_OPEN_MS;
    } else {
      failures = 0;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw fromResponse('Voucherify', res, await res.text().catch(() => ''));
    return res.json();
  }

  return {
    // Karta klienta albo null. Niczego nie zakłada, więc samo sprawdzenie salda nie tworzy kont.
    async findMemberByCustomer(email, options) {
      const list = await request('GET', `/v1/loyalties/${campaign}/members?limit=1&customer=${encodeURIComponent(email)}`, options);
      return list?.vouchers?.[0] ?? null;
    },

    getMember(memberId, options) {
      return request('GET', `/v1/loyalties/members/${encodeURIComponent(memberId)}`, options);
    },

    // source_id publikacji: ten sam klient przy powtórce dostaje tę samą kartę.
    // Karta startuje z punktami z kampanii (1000), więc nie ma osobnego kroku „punkty powitalne”.
    createMember(email) {
      return request('POST', `/v1/loyalties/${campaign}/members`, {
        body: { customer: { source_id: email, email }, source_id: `kino-member:${email}` },
      });
    },

    adjustBalance(memberId, points, opId, reason) {
      return request('POST', `/v1/loyalties/members/${encodeURIComponent(memberId)}/balance`, {
        body: { points, source_id: opId, reason },
      });
    },

    // Voucherify nie ma klucza idempotencji, ale pamięta nasz source_id przy transakcji
    async hasTransaction(memberId, opId) {
      const list = await request('GET', `/v1/loyalties/members/${encodeURIComponent(memberId)}/transactions?limit=20&order=-id`);
      return Boolean(list?.data?.some((t) => t.source_id === opId));
    },
  };
}
