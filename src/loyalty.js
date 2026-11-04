// Konto punktowe klienta. Źródłem prawdy o saldzie jest Voucherify, u nas leży tylko krótki podgląd.
import { ExternalError } from './external.js';
import { withLock } from './locks.js';
import { HttpError } from './errors.js';

export const WELCOME_POINTS = 1000;
const POINTS_PER_ZLOTY = 10;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 5000;

// Punkty liczymy tylko od części zapłaconej kartą, od pełnych złotych
export const pointsEarnedFor = (cardAmount) => Math.floor(cardAmount / 100) * POINTS_PER_ZLOTY;
export const maxPointsFor = (amount) => Math.floor(amount / 2);

export function createLoyalty(collections, voucherify, config) {
  const { pointsOps, loyaltyMembers } = collections;
  const cache = new Map(); // e-mail -> { points, at }

  function remember(email, points) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.delete(email);
    cache.set(email, { points, at: Date.now() });
  }

  async function saveMember(email, memberId) {
    await loyaltyMembers.updateOne({ _id: email }, { $set: { memberId, updatedAt: new Date() } }, { upsert: true });
    return memberId;
  }

  async function findMemberId(email, options) {
    const known = await loyaltyMembers.findOne({ _id: email });
    if (known) return known.memberId;
    const member = await voucherify.findMemberByCustomer(email, options);
    return member ? saveMember(email, member.code) : null;
  }

  async function ensureMemberId(email) {
    const found = await findMemberId(email);
    if (found) return found;
    const member = await voucherify.createMember(email);
    if (member?.loyalty_card) remember(email, member.loyalty_card.balance);
    return saveMember(email, member.code);
  }

  async function fetchPoints(email, options) {
    const memberId = await findMemberId(email, options);
    if (!memberId) return WELCOME_POINTS;
    const member = await voucherify.getMember(memberId, options);
    return member?.loyalty_card?.balance ?? WELCOME_POINTS;
  }

  return {
    available: Boolean(voucherify),

    // Podgląd salda. Awaria albo koniec limitu nie psują strony: oddajemy ostatnią znaną wartość.
    async getPoints(email) {
      if (!voucherify) throw new HttpError(503, 'LOYALTY_UNAVAILABLE', 'Punkty są chwilowo niedostępne');
      const cached = cache.get(email);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.points;
      try {
        const points = await fetchPoints(email, { lowPriority: true });
        remember(email, points);
        return points;
      } catch (err) {
        if (cached) return cached.points;
        console.warn(err.message);
        throw new HttpError(503, 'LOYALTY_UNAVAILABLE', 'Punkty są chwilowo niedostępne');
      }
    },

    // Świeże saldo przed wydaniem punktów. Zmiana salda w Voucherify jest asynchroniczna,
    // więc tuż po naszej zmianie wierzymy wynikowi tej zmiany, a nie odczytowi.
    async freshPoints(email) {
      const cached = cache.get(email);
      if (cached?.fromWrite && Date.now() - cached.at < CACHE_TTL_MS) return cached.points;
      const points = await fetchPoints(email);
      remember(email, points);
      return points;
    },

    withEmailLock: (email, fn) => withLock(collections, `points:${email}`, fn),

    // Zmiana salda bez klucza idempotencji u dostawcy: najpierw notatka u nas, potem wywołanie,
    // a po niepewnym wyniku (timeout, 5xx) sprawdzamy w historii karty, czy zmiana już doszła.
    async applyOp(opId, email, delta, reason) {
      if (!voucherify) throw new ExternalError('Voucherify', 'brak konfiguracji', { retryable: false });
      const now = new Date();
      const existing = await pointsOps.findOneAndUpdate(
        { _id: opId },
        { $setOnInsert: { email, delta, reason, status: 'pending', uncertain: false, createdAt: now } },
        { upsert: true, returnDocument: 'after' },
      );
      if (existing.status === 'applied') return;

      const memberId = await ensureMemberId(email);

      if (existing.uncertain) {
        const waitMs = existing.lastAttemptAt.getTime() + config.pointsVerifyDelayMs - Date.now();
        if (waitMs > 0) throw new ExternalError('Voucherify', 'czekamy na potwierdzenie zmiany salda', { retryAfterMs: waitMs });
        if (await voucherify.hasTransaction(memberId, opId)) {
          await pointsOps.updateOne({ _id: opId }, { $set: { status: 'applied', appliedAt: new Date() } });
          cache.delete(email);
          return;
        }
      }

      try {
        const result = await voucherify.adjustBalance(memberId, delta, opId, reason);
        await pointsOps.updateOne({ _id: opId }, { $set: { status: 'applied', appliedAt: new Date(), uncertain: false } });
        if (typeof result?.balance === 'number') {
          remember(email, result.balance);
          cache.get(email).fromWrite = true;
        } else {
          cache.delete(email);
        }
      } catch (err) {
        await pointsOps.updateOne(
          { _id: opId },
          { $set: { uncertain: Boolean(err.unknownOutcome), lastAttemptAt: new Date() } },
        );
        throw err;
      }
    },
  };
}
