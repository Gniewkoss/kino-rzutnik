// Karta B: formularz rezerwacji fotela
import { api, el, fmtTime, fmtDate, seatLabel, showMessage, setBusy } from './common.js';

const params = new URLSearchParams(location.search);
const eventId = params.get('eventId') || '';
const seatId = params.get('seatId') || '';

const form = document.getElementById('form');
const submit = document.getElementById('submit');
const msg = document.getElementById('msg');
const backHref = `/events/${encodeURIComponent(eventId)}`;

document.getElementById('chip').textContent = seatId || '?';
document.getElementById('seat').textContent = seatLabel(seatId);
document.getElementById('back').href = backHref;

const fail = (text) => {
  msg.className = 'notice error';
  msg.replaceChildren(text, ' ', el('a', { href: backHref }, 'Wybierz inny fotel'));
};

api(`/api/events/${encodeURIComponent(eventId)}`).then(({ ok, data }) => {
  if (!ok) { fail('Nie ma takiego seansu.'); submit.disabled = true; return; }
  const { event, takenSeats } = data;
  document.title = `${seatId}, ${event.title} – Kino Rzutnik`;
  document.getElementById('meta').textContent = `${event.title}, ${fmtDate(event.startsAt)}, ${fmtTime(event.startsAt)}, ${event.hall}`;
  if (!event.seats.includes(seatId)) { fail('W tej sali nie ma takiego fotela.'); submit.disabled = true; }
  else if (takenSeats.includes(seatId)) { fail('Ten fotel jest już zajęty.'); submit.disabled = true; }
});

let inFlight = false;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Blokada podwójnego kliknięcia; serwer i tak jest idempotentny
  if (inFlight) return;
  if (!form.checkValidity()) {
    form.querySelector(':invalid').focus();
    return form.reportValidity();
  }

  inFlight = true;
  setBusy(submit, true, 'Zarezerwuj fotel', 'Rezerwuję');
  msg.className = 'hidden';

  try {
    const res = await api('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({ eventId, seatId, customerName: form.customerName.value.trim(), email: form.email.value.trim() }),
    });
    if (res.ok) return location.replace(`/reservations/${res.data.reservationId}`);
    if (res.status === 409) fail('Ktoś zarezerwował ten fotel przed chwilą.');
    else if (res.status === 429) showMessage(msg, `Za dużo prób naraz. Spróbuj ponownie za ${res.headers.get('Retry-After') || 'kilka'} s.`, 'notice error');
    else showMessage(msg, res.data?.message || 'Nie udało się zarezerwować fotela.', 'notice error');
  } catch {
    showMessage(msg, 'Brak połączenia. Spróbuj ponownie.', 'notice error');
  }
  inFlight = false;
  setBusy(submit, false, 'Zarezerwuj fotel');
});
