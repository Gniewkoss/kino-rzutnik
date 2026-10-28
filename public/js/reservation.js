// Karta B: ekran z licznikiem; karta C: przycisk zakupu
import { api, fmtTime, fmtDate, seatLabel, showMessage } from './common.js';

const reservationId = location.pathname.split('/').pop();
const holding = document.getElementById('holding');
const countdown = document.getElementById('countdown');
const bar = document.getElementById('bar');
const buy = document.getElementById('buy');
const msg = document.getElementById('msg');

let timer;

function expired() {
  clearInterval(timer);
  holding.classList.add('hidden');
  showMessage(msg, 'Rezerwacja wygasła, fotel wrócił do puli.', 'info');
}

function startCountdown(expiresAt, serverTime, totalMs) {
  // Liczymy względem zegara serwera, żeby przesunięty zegar klienta nie oszukał licznika
  const skew = Date.now() - new Date(serverTime).getTime();
  const end = new Date(expiresAt).getTime() + skew;

  const tick = () => {
    const left = Math.max(0, end - Date.now());
    const s = Math.ceil(left / 1000);
    countdown.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    countdown.classList.toggle('low', s <= 30);
    bar.style.width = `${Math.min(100, (left / totalMs) * 100)}%`;
    if (left <= 0) expired();
  };
  tick();
  timer = setInterval(tick, 250);
}

async function load() {
  const { ok, status, data } = await api(`/api/reservations/${encodeURIComponent(reservationId)}`);
  if (!ok) {
    document.getElementById('title').textContent = status === 404 ? 'Nie ma takiej rezerwacji' : 'Coś poszło nie tak';
    document.getElementById('panel').classList.add('hidden');
    return;
  }
  if (data.status === 'purchased') {
    location.replace(`/tickets/${data.code}`);
    return;
  }

  const { event } = data;
  document.getElementById('seat').textContent = seatLabel(data.seatId);
  document.getElementById('back').href = `/events/${encodeURIComponent(data.eventId)}`;
  if (event) {
    document.getElementById('title').textContent = event.title;
    document.getElementById('meta').textContent = `${fmtDate(event.startsAt)}, ${fmtTime(event.startsAt)} · ${event.hall} · rezerwacja na: ${data.customerName}`;
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
  buy.disabled = true;
  buy.textContent = 'Kupuję…';

  try {
    const res = await api(`/api/reservations/${encodeURIComponent(reservationId)}/purchase`, { method: 'POST' });
    if (res.ok) {
      location.replace(`/tickets/${res.data.code}`);
      return;
    }
    if (res.status === 410) return expired();
    showMessage(msg, res.data?.message || 'Nie udało się kupić biletu.');
  } catch {
    showMessage(msg, 'Brak połączenia. Spróbuj ponownie, rezerwacja nadal trwa.');
  }
  inFlight = false;
  buy.disabled = false;
  buy.textContent = 'Kupuję bilet';
});

load().catch(() => showMessage(msg, 'Brak połączenia z kinem. Odśwież stronę.'));
