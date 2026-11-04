// Outbox: zadania do cudzych systemów. Zapis w transakcji z naszymi danymi, wysyłka przez worker (co najmniej raz).
const DUPLICATE_KEY = 11000;
const LEASE_MS = 60_000;
const MAX_TRIES = 12;
const MAX_BACKOFF_MS = 15 * 60_000;

// _id z treści zadania: drugi zapis tego samego zadania nic nie zmienia
export async function enqueue({ jobs }, _id, task, input, { session } = {}) {
  const now = new Date();
  const doc = { _id, task, input, visibleAt: now, totalTried: 0, completedAt: null, hasError: false, createdAt: now };
  try {
    await jobs.updateOne({ _id }, { $setOnInsert: doc }, { upsert: true, session });
  } catch (err) {
    if (err?.code !== DUPLICATE_KEY) throw err;
  }
}

export function startWorker(collections, handlers, config) {
  const { jobs } = collections;
  let running = true;
  let timer;

  async function runOne() {
    const now = new Date();
    const job = await jobs.findOneAndUpdate(
      { completedAt: null, hasError: false, visibleAt: { $lte: now } },
      { $set: { visibleAt: new Date(now.getTime() + LEASE_MS) }, $inc: { totalTried: 1 } },
      { sort: { visibleAt: 1 }, returnDocument: 'after' },
    );
    if (!job) return false;

    try {
      await handlers[job.task](job.input, job);
      await jobs.updateOne({ _id: job._id }, { $set: { completedAt: new Date(), lastError: null } });
    } catch (err) {
      const giveUp = err?.retryable === false || job.totalTried >= MAX_TRIES;
      // Backoff z losowym rozrzutem; czas podany przez dostawcę (Retry-After) ma pierwszeństwo
      const backoff = Math.min(config.jobRetryBaseMs * 2 ** (job.totalTried - 1), MAX_BACKOFF_MS) * (0.5 + Math.random() / 2);
      await jobs.updateOne(
        { _id: job._id },
        {
          $set: {
            lastError: String(err?.message ?? err),
            ...(giveUp ? { hasError: true } : { visibleAt: new Date(Date.now() + Math.max(err?.retryAfterMs ?? 0, backoff)) }),
          },
        },
      );
      if (giveUp) console.error(`DLQ: zadanie ${job._id} odłożone po ${job.totalTried} próbach: ${err?.message ?? err}`);
      else console.warn(`Zadanie ${job._id}, próba ${job.totalTried}: ${err?.message ?? err}`);
    }
    return true;
  }

  async function loop() {
    if (!running) return;
    try {
      while (running && (await runOne()));
    } catch (err) {
      console.error('Worker:', err.message);
    }
    if (running) {
      timer = setTimeout(loop, config.workerPollMs);
      timer.unref();
    }
  }
  loop();

  return () => {
    running = false;
    clearTimeout(timer);
  };
}
