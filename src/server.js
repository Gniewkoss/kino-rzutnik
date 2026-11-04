import { config } from './config.js';
import { connect, disconnect } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { createServices } from './services.js';
import { startWorker } from './jobs.js';

const collections = await connect();
await seed(collections);

const services = createServices(collections, config);
const app = createApp(collections, config, services);
const stopWorker = startWorker(collections, services.sagas.handlers, config);
const stopSweeper = services.sagas.startSweeper();

const server = app.listen(config.port, () => {
  console.log(`🎬 Kino Rzutnik działa na http://localhost:${config.port}`);
  console.log(`   rezerwacja ważna ${config.reservationTtlMs / 1000} s, limit ${config.rateLimitMax} rezerwacji / ${config.rateLimitWindowMs / 1000} s na klienta`);
});

async function shutdown() {
  server.close();
  stopWorker();
  stopSweeper();
  await disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
