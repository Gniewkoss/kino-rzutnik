// Karta C etapu II: strona powrotu po zapłacie. Sama zamienia się w bilet, gdy webhook potwierdzi płatność.
// Sam powrót niczego nie potwierdza: kod biletu pokazujemy dopiero, gdy API zwróci status "paid".
import { api, el, fmtTime, fmtDate, seatLabel } from './common.js';

const reservationId = location.pathname.split('/')[2];
const pending = document.getElementById('pending');
const note = document.getElementById('pending-note');
const msg = document.getElementById('msg');
const reservationHref = `/reservations/${encodeURIComponent(reservationId)}`;

// Webhook bywa wolniejszy od powrotu klienta, więc "expired" tuż po powrocie nie jest jeszcze ostateczne
const EXPIRED_GRACE_MS = 45_000;
const SLOW_MS = 30_000;
const startedAt = Date.now();
let filled = false;

function finish(...content) {
  pending.classList.add('hidden');
  msg.className = 'notice';
  msg.replaceChildren(...content);
}

function fill(data) {
  if (filled) return;
  filled = true;
  const { event } = data;
  document.getElementById('chip').textContent = data.seatId;
  document.getElementById('title').textContent = seatLabel(data.seatId);
  document.getElementById('back').href = `/events/${encodeURIComponent(data.eventId)}`;
  if (event) document.getElementById('meta').textContent = `${event.title}, ${fmtDate(event.startsAt)}, ${fmtTime(event.startsAt)}, ${event.hall}.`;
}

async function poll() {
  let next = 1500;
  try {
    const { ok, status, data } = await api(`/api/reservations/${encodeURIComponent(reservationId)}`);
    if (status === 404) return finish('Nie ma takiej rezerwacji.');
    if (ok) {
      fill(data);
      const waited = Date.now() - startedAt;
      if (data.status === 'paid') return location.replace(`/tickets/${data.code}`);
      if (data.refunded) {
        return finish('Płatność dotarła po czasie i ktoś inny zajął już ten fotel, więc zwróciliśmy pieniądze na Twoją kartę. Użyte punkty też wracają na konto. ', el('a', { href: `/events/${encodeURIComponent(data.eventId)}` }, 'Wybierz inny fotel'));
      }
      if (data.status === 'expired' && waited > EXPIRED_GRACE_MS) {
        return finish('Rezerwacja wygasła, fotel wrócił do puli. Jeśli karta została obciążona, zwrócimy pieniądze. Użyte punkty wracają na konto. ', el('a', { href: `/events/${encodeURIComponent(data.eventId)}` }, 'Wybierz fotel jeszcze raz'));
      }
      if (waited > SLOW_MS) {
        next = 4000;
        note.replaceChildren('Potwierdzenie trwa dłużej niż zwykle. Możesz zostać na tej stronie. Jeśli nie płacisz, ', el('a', { href: reservationHref }, 'wróć do rezerwacji'), '.');
      }
    }
  } catch { /* chwilowy brak sieci: próbujemy dalej */ }
  setTimeout(poll, next);
}

poll();
