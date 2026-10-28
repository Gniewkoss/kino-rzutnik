// Karta B: formularz rezerwacji fotela
import { api, fmtTime, fmtDate, seatLabel, showMessage } from './common.js';

const params = new URLSearchParams(location.search);
const eventId = params.get('eventId') || '';
const seatId = params.get('seatId') || '';

const form = document.getElementById('form');
const submit = document.getElementById('submit');
const msg = document.getElementById('msg');

document.getElementById('seat').textContent = seatLabel(seatId);
document.getElementById('back').href = `/events/${encodeURIComponent(eventId)}`;

api(`/api/events/${encodeURIComponent(eventId)}`).then(({ ok, data }) => {
  if (!ok) {
    showMessage(msg, 'Nie ma takiego seansu.');
    submit.disabled = true;
    return;
  }
  const { event, takenSeats } = data;
  document.getElementById('meta').textContent = `${event.title} · ${fmtDate(event.startsAt)}, ${fmtTime(event.startsAt)} · ${event.hall}`;
  if (!event.seats.includes(seatId)) {
    showMessage(msg, 'Nie ma takiego fotela w tej sali.');
    submit.disabled = true;
  } else if (takenSeats.includes(seatId)) {
    showMessage(msg, 'Ten fotel jest już zajęty. Wróć do sali i wybierz inny.');
    submit.disabled = true;
  }
});

let inFlight = false;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Blokada podwójnego kliknięcia; serwer i tak jest idempotentny
  if (inFlight) return;

  const customerName = form.customerName.value.trim();
  const email = form.email.value.trim();
  if (!customerName) return showMessage(msg, 'Podaj imię i nazwisko.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMessage(msg, 'Podaj poprawny adres e-mail.');

  inFlight = true;
  submit.disabled = true;
  submit.textContent = 'Rezerwuję…';
  msg.className = 'hidden';

  try {
    const res = await api('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({ eventId, seatId, customerName, email }),
    });
    if (res.ok) {
      location.replace(`/reservations/${res.data.reservationId}`);
      return;
    }
    if (res.status === 409) showMessage(msg, 'Ktoś był szybszy i ten fotel jest już zajęty. Wróć do sali i wybierz inny.');
    else if (res.status === 429) showMessage(msg, `Za dużo prób. Spróbuj ponownie za ${res.headers.get('Retry-After') || 'kilka'} s.`);
    else showMessage(msg, res.data?.message || 'Nie udało się zarezerwować fotela.');
  } catch {
    showMessage(msg, 'Brak połączenia. Spróbuj ponownie.');
  }
  inFlight = false;
  submit.disabled = false;
  submit.textContent = 'Zarezerwuj';
});
