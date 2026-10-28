// Karta C: bilet z kodem
import { api, el, fmtTime, fmtDateShort, parseSeat } from './common.js';

const code = decodeURIComponent(location.pathname.split('/').pop());
const box = document.getElementById('ticket');

async function load() {
  const { ok, data } = await api(`/api/tickets/${encodeURIComponent(code)}`);
  if (!ok) {
    box.replaceChildren(el('p', { class: 'empty' }, 'Nie ma takiego biletu.'));
    return;
  }
  const { event } = data;
  const seat = parseSeat(data.seatId);
  const field = (label, value) => el('div', {}, el('div', { class: 'ticket-label' }, label), el('strong', {}, value));

  box.replaceChildren(
    el('div', { class: 'ticket' },
      el('div', { class: 'ticket-main' },
        el('div', { class: 'ticket-label' }, 'Kino Rzutnik · bilet'),
        el('div', { class: 'film' }, event?.title ?? data.eventId),
        el('div', { class: 'ticket-grid' },
          field('Data', event ? fmtDateShort(event.startsAt) : '—'),
          field('Godzina', event ? fmtTime(event.startsAt) : '—'),
          field('Sala', event?.hall ?? '—'),
          field('Rząd', seat.row),
          field('Miejsce', seat.number),
          field('Widz', data.customerName),
        ),
      ),
      el('div', { class: 'ticket-stub' },
        el('div', { class: 'ticket-label' }, 'Kod biletu'),
        el('div', { class: 'ticket-code' }, data.code),
      ),
    ),
  );
}

load().catch(() => box.replaceChildren(el('p', { class: 'empty' }, 'Brak połączenia. Odśwież stronę.')));
