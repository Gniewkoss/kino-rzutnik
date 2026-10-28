// Przykładowe dane: 3 seanse w 2 salach po 8×10 foteli (rzędy A–H, miejsca 1–10)
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const SEATS_PER_ROW = 10;

export function hallSeats() {
  return ROWS.flatMap((row) => Array.from({ length: SEATS_PER_ROW }, (_, i) => `${row}${i + 1}`));
}

export const sampleEvents = [
  {
    _id: 'seans-2026-11-21-1800',
    title: 'Kosmiczna podróż',
    startsAt: '2026-11-21T18:00:00Z',
    hall: 'Sala 1',
    durationMin: 128,
    genre: 'Sci-fi',
    seats: hallSeats(),
  },
  {
    _id: 'seans-2026-11-21-2030',
    title: 'Cisza nad jeziorem',
    startsAt: '2026-11-21T20:30:00Z',
    hall: 'Sala 2',
    durationMin: 104,
    genre: 'Dramat',
    seats: hallSeats(),
  },
  {
    _id: 'seans-2026-11-22-1630',
    title: 'Złodziej zegarów',
    startsAt: '2026-11-22T16:30:00Z',
    hall: 'Sala 1',
    durationMin: 96,
    genre: 'Komedia kryminalna',
    seats: hallSeats(),
  },
];

export async function seed({ events }) {
  // $setOnInsert: seed nie nadpisuje danych, które już są w bazie
  await events.bulkWrite(
    sampleEvents.map(({ _id, ...rest }) => ({
      updateOne: { filter: { _id }, update: { $setOnInsert: rest }, upsert: true },
    })),
  );
}
