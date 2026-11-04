// Wystawienie biletu: wspólne dla webhooka Stripe'a i zakupu bezpośredniego z etapu I
import { randomBytes } from 'node:crypto';
import { holdKey } from './holds.js';

// Bez znaków mylących się na bilecie (0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function ticketCode() {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `RZ-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

// Atomowo zamienia „trzymany” na „kupiony”. Ten sam dokument zmienia rezerwacja innej osoby,
// więc baza rozstrzyga wyścig. Zwraca { code, issued } albo null, gdy fotel nie należy już do rezerwacji.
// issued mówi, czy bilet powstał właśnie teraz, czy był już wcześniej.
export async function issueTicket({ reservations, seatHolds }, reservation, { holdFilter = {}, details = {}, session } = {}) {
  const id = reservation._id;
  const key = holdKey(reservation.eventId, reservation.seatId);

  const won = await seatHolds.findOneAndUpdate(
    { _id: key, reservationId: id, status: 'held', ...holdFilter },
    { $set: { status: 'purchased', code: ticketCode(), purchasedAt: new Date() } },
    { returnDocument: 'after', session },
  );

  // Równoległe wystawienie mogło wygrać chwilę wcześniej: oddajemy ten sam kod
  const hold = won ?? (await seatHolds.findOne({ _id: key }, { session }));
  if (hold?.reservationId !== id || hold.status !== 'purchased') return null;

  await reservations.updateOne(
    { _id: id },
    { $set: { status: 'purchased', code: hold.code, purchasedAt: hold.purchasedAt, ...details } },
    { session },
  );
  return { code: hold.code, issued: Boolean(won) };
}
