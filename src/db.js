import { MongoClient } from 'mongodb';
import { config } from './config.js';

let client;
let memoryServer;

export async function connect() {
  let uri = config.mongoUri;
  if (!uri) {
    // Brak MONGODB_URI: baza w pamięci, tylko do lokalnego developmentu
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
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
  };

  await collections.seatHolds.createIndex({ eventId: 1 });
  // Kod biletu ma być unikalny; indeks obejmuje tylko dokumenty, które kod już mają
  const withCode = { partialFilterExpression: { code: { $type: 'string' } } };
  await collections.seatHolds.createIndex({ code: 1 }, { unique: true, ...withCode });
  await collections.reservations.createIndex({ code: 1 }, { unique: true, ...withCode });

  return collections;
}

export async function disconnect() {
  await client?.close();
  await memoryServer?.stop();
}
