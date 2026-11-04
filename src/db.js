import { MongoClient } from 'mongodb';
import { config } from './config.js';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

let client;
let memoryServer;

export async function connect() {
  let uri = config.mongoUri;
  if (!uri) {
    // Brak MONGODB_URI: baza w pamięci, tylko do lokalnego developmentu
    // Replica set, bo outbox i inbox potrzebują transakcji
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = memoryServer.getUri();
    console.warn('⚠️  Brak MONGODB_URI, używam MongoDB w pamięci (dane znikną po restarcie)');
  }
  client = new MongoClient(uri, { maxPoolSize: 50 });
  await client.connect();
  const db = client.db(config.mongoDb);

  const collections = {
    events: db.collection('events'),
    reservations: db.collection('reservations'),
    // Jeden dokument na fotel (_id = "eventId|seatId"). To on rozstrzyga, kto trzyma miejsce.
    seatHolds: db.collection('seatHolds'),
    // Outbox: wiadomości do cudzych systemów, zapisywane w transakcji z naszymi danymi
    jobs: db.collection('jobs'),
    // Inbox: ID zdarzeń Stripe'a, które już obsłużyliśmy
    inbox: db.collection('inbox'),
    // Postęp zakupu przez kilka systemów (punkty, płatność, bilet)
    sagas: db.collection('sagas'),
    // Zmiany salda w Voucherify; to dziennik intencji, saldo jest tylko tam
    pointsOps: db.collection('pointsOps'),
    // E-mail -> numer karty w Voucherify, żeby nie zużywać limitu wywołań na wyszukiwanie
    loyaltyMembers: db.collection('loyaltyMembers'),
    locks: db.collection('locks'),
    transaction: (fn) => client.withSession((session) => session.withTransaction(() => fn(session))),
  };

  await collections.seatHolds.createIndex({ eventId: 1 });
  // Kod biletu ma być unikalny; indeks obejmuje tylko dokumenty, które kod już mają
  const withCode = { partialFilterExpression: { code: { $type: 'string' } } };
  await collections.seatHolds.createIndex({ code: 1 }, { unique: true, ...withCode });
  await collections.reservations.createIndex({ code: 1 }, { unique: true, ...withCode });

  await collections.jobs.createIndex({ completedAt: 1, hasError: 1, visibleAt: 1 });
  await collections.jobs.createIndex({ completedAt: 1 }, { expireAfterSeconds: WEEK_SECONDS, partialFilterExpression: { completedAt: { $type: 'date' } } });
  // Stripe ponawia do 3 dni, więc 7 dni pamięci wystarczy
  await collections.inbox.createIndex({ processedAt: 1 }, { expireAfterSeconds: WEEK_SECONDS });
  await collections.sagas.createIndex({ status: 1, expiresAt: 1 });
  await collections.pointsOps.createIndex({ status: 1 });
  await collections.loyaltyMembers.createIndex({ updatedAt: 1 });
  await collections.locks.createIndex({ until: 1 });

  return collections;
}

export async function disconnect() {
  await client?.close();
  await memoryServer?.stop();
}
