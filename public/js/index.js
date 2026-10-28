// Karta A: repertuar
import { api, el, fmtTime, fmtDate } from './common.js';

const list = document.getElementById('list');

async function load() {
  const { ok, data } = await api('/api/events');
  if (!ok) {
    list.replaceChildren(el('p', { class: 'empty' }, 'Nie udało się pobrać repertuaru. Odśwież stronę.'));
    return;
  }
  if (!data.length) {
    list.replaceChildren(el('p', { class: 'empty' }, 'Brak seansów.'));
    return;
  }

  // Liczba wolnych foteli z endpointu szczegółów
  const details = await Promise.all(data.map((e) => api(`/api/events/${encodeURIComponent(e._id)}`)));

  const byDay = new Map();
  data.forEach((event, i) => {
    const day = fmtDate(event.startsAt);
    if (!byDay.has(day)) byDay.set(day, []);
    const d = details[i].ok ? details[i].data : null;
    const free = d ? d.event.seats.length - d.takenSeats.length : null;
    byDay.get(day).push({ event, free });
  });

  const nodes = [];
  for (const [day, items] of byDay) {
    nodes.push(el('h2', {}, day));
    nodes.push(
      el('div', { class: 'screenings' },
        items.map(({ event, free }) =>
          el('a', { class: 'screening', href: `/events/${encodeURIComponent(event._id)}` },
            el('div', { class: 'time' }, fmtTime(event.startsAt)),
            el('div', {},
              el('div', { class: 'title' }, event.title),
              el('div', { class: 'meta' }, [event.hall, event.genre, event.durationMin && `${event.durationMin} min`].filter(Boolean).join(' · ')),
            ),
            el('div', { class: 'free' }, free === null ? '' : [el('strong', {}, free), 'wolnych foteli']),
          ),
        ),
      ),
    );
  }
  list.replaceChildren(...nodes);
}

load();
