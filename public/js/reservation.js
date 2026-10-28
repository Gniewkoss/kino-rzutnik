// Karta B: ekran z licznikiem; karta C: przycisk zakupu
import { api, el, fmtTime, fmtDate, seatLabel, showMessage, setBusy } from './common.js';

const reservationId = location.pathname.split('/').pop();
const holding = document.getElementById('holding');
const countdown = document.getElementById('countdown');
const bar = document.getElementById('bar');
const buy = document.getElementById('buy');
const msg = document.getElementById('msg');

let timer;
let eventHref = '/';
let baseTitle = document.title;

function expired() {
  clearInterval(timer);
  document.title = baseTitle;
  holding.classList.add('hidden');
  msg.className = 'notice';
  msg.replaceChildren('Rezerwacja wygasła, fotel wrócił do puli. ', el('a', { href: eventHref }, 'Wybierz fotel jeszcze raz'));
}

function startCountdown(expiresAt, serverTime, totalMs) {
  // Liczymy względem zegara serwera, żeby przesunięty zegar klienta nie oszukał licznika
  const skew = Date.now() - new Date(serverTime).getTime();
  const end = new Date(expiresAt).getTime() + skew;

  const tick = () => {
    const left = Math.max(0, end - Date.now());
    const s = Math.ceil(left / 1000);
    const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    countdown.textContent = text;
    countdown.classList.toggle('low', s <= 30);
    bar.style.width = `${Math.min(100, (left / totalMs) * 100)}%`;
    // Licznik w tytule karty: widać go nawet w innej zakładce
    document.title = `${text} do końca rezerwacji`;
    if (left <= 0) expired();
  };
  tick();
  timer = setInterval(tick, 250);
}

async function load() {
  const { ok, status, data } = await api(`/api/reservations/${encodeURIComponent(reservationId)}`);
  if (!ok) {
    document.getElementById('title').textContent = status === 404 ? 'Nie ma takiej rezerwacji' : 'Nie udało się wczytać rezerwacji';
    document.getElementById('panel').classList.add('hidden');
    document.getElementById('chip').classList.add('hidden');
    return;
  }
  if (data.status === 'purchased') return location.replace(`/tickets/${data.code}`);

  const { event } = data;
  eventHref = `/events/${encodeURIComponent(data.eventId)}`;
  document.getElementById('chip').textContent = data.seatId;
  document.getElementById('back').href = eventHref;
  document.getElementById('title').textContent = seatLabel(data.seatId);
  if (event) {
    baseTitle = `${event.title} – Kino Rzutnik`;
    document.getElementById('meta').textContent =
      `${event.title}, ${fmtDate(event.startsAt)}, ${fmtTime(event.startsAt)}, ${event.hall}. Rezerwacja na: ${data.customerName}.`;
  }

  if (data.status === 'expired') return expired();
  const total = Math.max(1, new Date(data.expiresAt) - new Date(data.createdAt));
  startCountdown(data.expiresAt, data.serverTime, total);
}

let inFlight = false;

buy.addEventListener('click', async () => {
  // Blokada podwójnego „Kupuję”; serwer i tak zwraca ten sam kod
  if (inFlight) return;
  inFlight = true;
  setBusy(buy, true, 'Kupuję bilet', 'Wystawiam bilet');

  try {
    const res = await api(`/api/reservations/${encodeURIComponent(reservationId)}/purchase`, { method: 'POST' });
    if (res.ok) return location.replace(`/tickets/${res.data.code}`);
    if (res.status === 410) return expired();
    showMessage(msg, res.data?.message || 'Nie udało się kupić biletu.', 'notice error');
  } catch {
    showMessage(msg, 'Brak połączenia. Spróbuj ponownie, rezerwacja nadal trwa.', 'notice error');
  }
  inFlight = false;
  setBusy(buy, false, 'Kupuję bilet');
});

load().catch(() => showMessage(msg, 'Brak połączenia z kinem. Odśwież stronę.', 'notice error'));
