// Wspólne reguły dla dokumentów seatHolds (jeden dokument = jeden fotel na jednym seansie)

export function holdKey(eventId, seatId) {
  return `${eventId}|${seatId}`;
}

// Stan rezerwacji wynika z fotela: 'held' | 'purchased' | 'expired'
export async function reservationState(seatHolds, reservation, now = new Date()) {
  const hold = await seatHolds.findOne({ _id: holdKey(reservation.eventId, reservation.seatId) });
  const state = hold?.reservationId === reservation._id ? holdState(hold, now) : 'free';
  return { state: state === 'free' ? 'expired' : state, hold };
}

// 'free' | 'held' | 'purchased'
export function holdState(hold, now) {
  if (!hold) return 'free';
  if (hold.status === 'purchased') return 'purchased';
  if (hold.status === 'held' && hold.expiresAt > now) return 'held';
  return 'free';
}
