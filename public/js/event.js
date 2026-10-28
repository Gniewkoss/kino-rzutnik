// Karta A: mapa sali. Klik w wolny fotel prowadzi do formularza z karty B.
import { api, el, fmtTime, fmtDate, parseSeat, seatLabel, freeSeatsLabel, showMessage } from './common.js';

const eventId = decodeURIComponent(location.pathname.split('/').pop());
const rowsNode = document.getElementById('rows');
const msg = document.getElementById('msg');
const seatButtons = new Map();

function pick(event, seatId, button) {
  // Fotel „przelatuje” do formularza (View Transitions między stronami)
  button.style.viewTransitionName = 'seat';
  location.href = `/reserve?eventId=${encodeURIComponent(event._id)}&seatId=${encodeURIComponent(seatId)}`;
}

function build(event) {
  const rows = new Map();
  for (const seatId of event.seats) {
    const { row } = parseSeat(seatId);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(seatId);
  }

  rowsNode.replaceChildren(
    ...[...rows].map(([row, seats]) => {
      const half = Math.ceil(seats.length / 2);
      const center = (seats.length - 1) / 2;
      const nodes = seats.flatMap((seatId, i) => {
        const btn = el('button', { class: 'seat', type: 'button', style: `--dx2:${(i - center) ** 2}` }, parseSeat(seatId).number);
        btn.addEventListener('click', () => pick(event, seatId, btn));
        seatButtons.set(seatId, btn);
        return i === half ? [el('span', { class: 'aisle' }), btn] : [btn];
      });
      return el('div', { class: 'row' }, el('span', { class: 'row-label' }, row), nodes, el('span', { class: 'row-label' }, row));
    }),
  );
}

function update(takenSeats, first) {
  const taken = new Set(takenSeats);
  for (const [seatId, btn] of seatButtons) {
    const isTaken = taken.has(seatId);
    if (!first && isTaken && !btn.disabled) {
      btn.classList.remove('just-taken');
      void btn.offsetWidth;
      btn.classList.add('just-taken');
    }
    btn.disabled = isTaken;
    const label = `${seatLabel(seatId)}, ${isTaken ? 'zajęty' : 'wolny'}`;
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
}

async function load(first) {
  const { ok, status, data } = await api(`/api/events/${encodeURIComponent(eventId)}`);
  if (!ok) {
    if (first) {
      document.getElementById('title').textContent = status === 404 ? 'Nie ma takiego seansu' : 'Nie udało się wczytać sali';
      document.querySelector('.auditorium').classList.add('hidden');
      document.querySelector('.legend').classList.add('hidden');
      document.querySelector('.live').classList.add('hidden');
    }
    return;
  }
  const { event, takenSeats } = data;
  if (first) {
    document.title = `${event.title} – Kino Rzutnik`;
    document.getElementById('title').textContent = event.title;
    build(event);
  }
  const fact = (k, v) => [el('dt', {}, k), el('dd', {}, v)];
  document.getElementById('facts').replaceChildren(
    ...fact('Kiedy', `${fmtDate(event.startsAt)}, ${fmtTime(event.startsAt)}`),
    ...fact('Gdzie', event.hall),
    ...(event.durationMin ? fact('Czas', `${event.durationMin} min`) : []),
    ...fact('Wolne', freeSeatsLabel(event.seats.length - takenSeats.length)),
  );
  update(takenSeats, first);
}

load(true).catch(() => showMessage(msg, 'Brak połączenia z kinem. Odśwież stronę.', 'notice error'));
// Odświeżamy mapę, żeby widzieć fotele zajęte przez innych i te, które wróciły do puli
setInterval(() => { if (!document.hidden) load(false).catch(() => {}); }, 4000);
