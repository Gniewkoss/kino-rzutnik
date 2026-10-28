// Karta C: bilet z kodem, dodanie do kalendarza, udostępnienie, druk
import { api, el, fmtTime, fmtDateShort, parseSeat } from './common.js';

const code = decodeURIComponent(location.pathname.split('/').pop());
const box = document.getElementById('ticket');

const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function calendarFile(data) {
  const { event } = data;
  const start = new Date(event.startsAt);
  const end = new Date(start.getTime() + (event.durationMin || 120) * 60_000);
  const seat = parseSeat(data.seatId);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kino Rzutnik//PL', 'BEGIN:VEVENT',
    `UID:${data.code}@kino-rzutnik`, `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${event.title} (Kino Rzutnik)`,
    `DESCRIPTION:${event.hall}\\, rząd ${seat.row}\\, miejsce ${seat.number}. Kod biletu: ${data.code}`,
    `LOCATION:Kino Rzutnik\\, ${event.hall}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
}

async function load() {
  const { ok, data } = await api(`/api/tickets/${encodeURIComponent(code)}`);
  if (!ok) return box.replaceChildren(el('p', { class: 'empty' }, 'Nie ma biletu o takim kodzie. Sprawdź, czy link jest pełny.'));

  const { event } = data;
  const seat = parseSeat(data.seatId);
  document.title = `Bilet: ${event?.title ?? data.code} – Kino Rzutnik`;
  const fact = (k, v) => el('div', {}, el('dt', {}, k), el('dd', {}, v));

  const share = el('button', { class: 'btn ghost', type: 'button' }, 'Udostępnij bilet');
  share.addEventListener('click', async () => {
    const payload = { title: `Bilet: ${event?.title}`, text: `Kod biletu ${data.code}`, url: location.href };
    if (navigator.share) {
      try { await navigator.share(payload); } catch { /* anulowane */ }
    } else {
      await navigator.clipboard.writeText(location.href);
      share.textContent = 'Skopiowano link';
    }
  });
  const print = el('button', { class: 'btn ghost', type: 'button', onclick: () => window.print() }, 'Drukuj');

  box.replaceChildren(
    el('article', { class: 'ticket', 'aria-label': 'Bilet' },
      el('div', { class: 'ticket-main' },
        el('h2', { class: 'ticket-film' }, event?.title ?? data.eventId),
        el('dl', { class: 'ticket-grid' },
          fact('Data', event ? fmtDateShort(event.startsAt) : '–'),
          fact('Godzina', event ? fmtTime(event.startsAt) : '–'),
          fact('Sala', event?.hall ?? '–'),
          fact('Rząd', seat.row),
          fact('Miejsce', seat.number),
          fact('Widz', data.customerName),
        ),
      ),
      el('div', { class: 'ticket-stub' },
        el('span', { class: 'small', style: 'color:inherit;opacity:.75' }, 'Kod biletu'),
        el('span', { class: 'code' }, data.code),
        el('span', { class: 'small', style: 'color:inherit;opacity:.75' }, 'Pokaż go przy wejściu na salę'),
      ),
    ),
    el('div', { class: 'ticket-actions' },
      event ? el('a', { class: 'btn', href: calendarFile(data), download: `bilet-${data.code}.ics` }, 'Dodaj do kalendarza') : '',
      share,
      print,
    ),
  );
}

load().catch(() => box.replaceChildren(el('p', { class: 'empty' }, 'Brak połączenia. Odśwież stronę.')));
