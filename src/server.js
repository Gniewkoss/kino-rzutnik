import { config } from './config.js';
import { connect, disconnect } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';

const collections = await connect();
await seed(collections);

const app = createApp(collections, config);
const server = app.listen(config.port, () => {
  console.log(`🎬 Kino Rzutnik działa na http://localhost:${config.port}`);
  console.log(`   rezerwacja ważna ${config.reservationTtlMs / 1000} s, limit ${config.rateLimitMax} rezerwacji / ${config.rateLimitWindowMs / 1000} s na klienta`);
});

async function shutdown() {
  server.close();
  await disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
