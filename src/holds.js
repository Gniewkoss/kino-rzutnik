// Wspólne reguły dla dokumentów seatHolds (jeden dokument = jeden fotel na jednym seansie)

export function holdKey(eventId, seatId) {
  return `${eventId}|${seatId}`;
}

// 'free' | 'held' | 'purchased'
export function holdState(hold, now) {
  if (!hold) return 'free';
  if (hold.status === 'purchased') return 'purchased';
  if (hold.status === 'held' && hold.expiresAt > now) return 'held';
  return 'free';
}
