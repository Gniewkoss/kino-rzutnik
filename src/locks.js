// Krótka blokada w bazie, ten sam trik co rezerwacja fotela: unikalne _id i warunek „wygasła”.
// Wygasa sama, więc padnięty proces nikogo nie zablokuje na stałe.
const DUPLICATE_KEY = 11000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withLock({ locks }, key, fn, { holdMs = 30_000, waitMs = 15_000 } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const now = new Date();
    try {
      await locks.updateOne(
        { _id: key, until: { $lte: now } },
        { $set: { until: new Date(now.getTime() + holdMs) } },
        { upsert: true },
      );
      break;
    } catch (err) {
      if (err?.code !== DUPLICATE_KEY) throw err;
      if (Date.now() > deadline) return { busy: true };
      await sleep(150);
    }
  }
  try {
    return { value: await fn() };
  } finally {
    await locks.deleteOne({ _id: key }).catch(() => {});
  }
}
