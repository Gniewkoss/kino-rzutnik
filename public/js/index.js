// Karta A: repertuar
import { api, el, fmtTime, fmtDate, freeSeatsLabel } from './common.js';

const list = document.getElementById('list');

async function load() {
  const { ok, data } = await api('/api/events');
  if (!ok) return list.replaceChildren(el('p', { class: 'empty' }, 'Nie udało się wczytać repertuaru. Odśwież stronę.'));
  if (!data.length) return list.replaceChildren(el('p', { class: 'empty' }, 'Na razie nie ma seansów w sprzedaży.'));

  // Zajętość sali z endpointu szczegółów
  const details = await Promise.all(data.map((e) => api(`/api/events/${encodeURIComponent(e._id)}`)));

  const byDay = new Map();
  data.forEach((event, i) => {
    const day = fmtDate(event.startsAt);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ event, detail: details[i].ok ? details[i].data : null });
  });

  list.replaceChildren(
    ...[...byDay].map(([day, items]) =>
      el('section', { class: 'day' },
        el('h2', { class: 'day-name' }, day),
        items.map(({ event, detail }) => {
          const total = detail?.event.seats.length ?? 0;
          const free = detail ? total - detail.takenSeats.length : null;
          return el('a', { class: 'show', href: `/events/${encodeURIComponent(event._id)}` },
            el('time', { class: 'show-time', datetime: event.startsAt }, fmtTime(event.startsAt)),
            el('div', {},
              el('h3', { class: 'show-title' }, event.title),
              el('p', { class: 'show-meta' }, [event.genre, event.durationMin && `${event.durationMin} min`].filter(Boolean).join(', ')),
            ),
            el('div', { class: 'show-side' },
              el('span', {}, el('strong', {}, event.hall), free === null ? '' : `, ${freeSeatsLabel(free)}`),
              free === null ? '' : el('div', {
                class: 'meter', role: 'img', 'aria-label': `Sala zajęta w ${Math.round(((total - free) / total) * 100)}%`,
                style: `--fill:${((total - free) / total) * 100}%`,
              }, el('span')),
            ),
          );
        }),
      ),
    ),
  );
}

load().catch(() => list.replaceChildren(el('p', { class: 'empty' }, 'Brak połączenia z kinem. Odśwież stronę.')));
