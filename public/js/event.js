// Karta A: mapa sali. Klik w wolny fotel prowadzi do formularza z karty B.
import { api, el, fmtTime, fmtDate, parseSeat, seatLabel, showMessage } from './common.js';

const eventId = decodeURIComponent(location.pathname.split('/').pop());
const rowsNode = document.getElementById('rows');
const msg = document.getElementById('msg');

function render(event, takenSeats) {
  const taken = new Set(takenSeats);
  const rows = new Map();
  for (const seatId of event.seats) {
    const { row } = parseSeat(seatId);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(seatId);
  }

  rowsNode.replaceChildren(
    ...[...rows].map(([row, seats]) => {
      const half = Math.ceil(seats.length / 2);
      const buttons = seats.map((seatId, i) => {
        const isTaken = taken.has(seatId);
        const btn = el('button', {
          class: 'seat',
          type: 'button',
          title: `${seatLabel(seatId)}${isTaken ? ' (zajęty)' : ''}`,
          'aria-label': `${seatLabel(seatId)}${isTaken ? ', zajęty' : ', wolny'}`,
          disabled: isTaken,
          onclick: () => {
            location.href = `/reserve?eventId=${encodeURIComponent(event._id)}&seatId=${encodeURIComponent(seatId)}`;
          },
        }, parseSeat(seatId).number);
        return i === half ? [el('span', { class: 'aisle' }), btn] : btn;
      });
      return el('div', { class: 'row' },
        el('span', { class: 'row-label' }, row), buttons.flat(), el('span', { class: 'row-label' }, row));
    }),
  );
}

async function load(first) {
  const { ok, status, data } = await api(`/api/events/${encodeURIComponent(eventId)}`);
  if (!ok) {
    if (first) {
      document.getElementById('title').textContent = status === 404 ? 'Nie ma takiego seansu' : 'Coś poszło nie tak';
      rowsNode.closest('.hall').classList.add('hidden');
    }
    return;
  }
  const { event, takenSeats } = data;
  if (first) {
    document.title = `${event.title} · Kino Rzutnik`;
    document.getElementById('title').textContent = event.title;
    document.getElementById('meta').textContent =
      `${fmtDate(event.startsAt)}, ${fmtTime(event.startsAt)} · ${event.hall} · ${event.seats.length - takenSeats.length} wolnych foteli`;
  }
  render(event, takenSeats);
}

load(true).catch(() => showMessage(msg, 'Brak połączenia z kinem. Odśwież stronę.'));
// Odświeżamy mapę, żeby widzieć fotele zajęte przez innych i te, które wróciły do puli
setInterval(() => load(false).catch(() => {}), 5000);
