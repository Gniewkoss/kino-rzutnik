// Ekran z licznikiem i przycisk „Zapłać”, który przenosi na stronę płatności Stripe'a
import { api, el, fmtTime, fmtDate, fmtPrice, seatLabel, showMessage, setBusy } from './common.js';

import { setAccountEmail, refreshPoints, noteSpent } from './account.js';

const reservationId = location.pathname.split('/').pop();
const holding = document.getElementById('holding');
const countdown = document.getElementById('countdown');
const bar = document.getElementById('bar');
const buy = document.getElementById('buy');
const msg = document.getElementById('msg');

let timer;
let eventHref = '/';
let baseTitle = document.title;
let payLabel = 'Zapłać';
let inFlight = false;
let amount = 0;
let maxPoints = 0;
let availablePoints = null;

const pointsBox = document.getElementById('points');
const pointsInput = document.getElementById('points-input');
const pointsHint = document.getElementById('points-hint');

// Liczba punktów, którą można wysłać, albo null, gdy pole jest źle wypełnione
function chosenPoints() {
  if (pointsBox.classList.contains('hidden') || pointsInput.value === '') return pointsBox.classList.contains('hidden') ? 0 : null;
  const points = Number(pointsInput.value);
  return Number.isInteger(points) && points >= 0 && points <= maxPoints ? points : null;
}

// Cena zmienia się od razu, a przycisk pokazuje kwotę do dopłaty
function updatePrice() {
  const points = chosenPoints();
  payLabel = `Zapłać ${fmtPrice(amount - (points ?? 0))}`;
  if (!inFlight) {
    buy.textContent = payLabel;
    buy.disabled = points === null;
  }
  if (pointsBox.classList.contains('hidden')) return;
  pointsHint.classList.toggle('error', points === null);
  pointsHint.textContent = points === null
    ? `Wpisz liczbę od 0 do ${maxPoints}.`
    : `Możesz użyć najwięcej ${maxPoints} pkt (${fmtPrice(maxPoints)}). Cena ${fmtPrice(amount)}, dopłata kartą ${fmtPrice(amount - points)}.`;
}

// Punkty już odjęte dla tej rezerwacji też można wydać, więc doliczamy je do salda
async function loadPoints(data) {
  try {
    const { ok, data: loyalty } = await api(`/api/loyalty?email=${encodeURIComponent(data.email)}`);
    if (!ok) return;
    availablePoints = loyalty.points + (data.pointsUsed ?? 0);
    maxPoints = Math.min(Math.floor(amount / 2), availablePoints);
    pointsInput.max = maxPoints;
    pointsInput.value = data.pointsUsed ?? 0;
    pointsBox.classList.remove('hidden');
    updatePrice();
  } catch { /* bez salda można zapłacić samą kartą */ }
}

pointsInput.addEventListener('input', updatePrice);
document.getElementById('points-max').addEventListener('click', () => {
  pointsInput.value = maxPoints;
  updatePrice();
});

function expired(pointsReturned) {
  clearInterval(timer);
  document.title = baseTitle;
  holding.classList.add('hidden');
  msg.className = 'notice';
  msg.replaceChildren('Rezerwacja wygasła, fotel wrócił do puli. ', pointsReturned ? `${pointsReturned} pkt wróciło na Twoje konto. ` : '', el('a', { href: eventHref }, 'Wybierz fotel jeszcze raz'));
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
  if (data.status === 'paid') return location.replace(`/tickets/${data.code}`);

  const { event } = data;
  eventHref = `/events/${encodeURIComponent(data.eventId)}`;
  setAccountEmail(data.email);
  refreshPoints({ force: true });
  document.getElementById('chip').textContent = data.seatId;
  document.getElementById('back').href = eventHref;
  document.getElementById('title').textContent = seatLabel(data.seatId);
  if (event) {
    baseTitle = `${event.title} – Kino Rzutnik`;
    document.getElementById('meta').textContent =
      `${event.title}, ${fmtDate(event.startsAt)}, ${fmtTime(event.startsAt)}, ${event.hall}. Rezerwacja na: ${data.customerName}.`;
  }

  if (data.status === 'expired') return expired(data.pointsReturned);

  amount = data.amount ?? 0;
  payLabel = `Zapłać ${fmtPrice(amount)}`;
  buy.textContent = payLabel;
  loadPoints(data);
  if (new URLSearchParams(location.search).get('payment') === 'canceled') {
    showMessage(msg, 'Płatność przerwana, nic nie pobraliśmy. Możesz zapłacić jeszcze raz, dopóki trwa rezerwacja.', 'notice');
  }
  const total = Math.max(1, new Date(data.expiresAt) - new Date(data.createdAt));
  startCountdown(data.expiresAt, data.serverTime, total);
}

buy.addEventListener('click', async () => {
  // Blokada podwójnego kliknięcia; serwer i tak oddaje tę samą sesję płatności
  if (inFlight) return;
  inFlight = true;
  setBusy(buy, true, payLabel, 'Przechodzę do płatności');
  msg.className = 'hidden';

  try {
    const res = await api(`/api/reservations/${encodeURIComponent(reservationId)}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ points: chosenPoints() ?? 0 }),
    });
    if (res.ok) {
      // Niech klient zobaczy, jak punkty schodzą, zanim przejdzie na stronę Stripe'a
      const points = chosenPoints() ?? 0;
      if (availablePoints !== null && points > 0) {
        noteSpent(availablePoints - points);
        await new Promise((r) => setTimeout(r, 800));
      }
      return location.assign(res.data.url);
    }
    if (res.status === 410) return expired();
    if (res.status === 409) return location.replace(`/reservations/${encodeURIComponent(reservationId)}/payment`);
    showMessage(msg, res.data?.message || 'Nie udało się rozpocząć płatności.', 'notice error');
  } catch {
    showMessage(msg, 'Brak połączenia. Spróbuj ponownie, rezerwacja nadal trwa.', 'notice error');
  }
  inFlight = false;
  setBusy(buy, false, payLabel);
});

// Powrót przyciskiem „wstecz” ze Stripe'a: przeglądarka odtwarza stronę z zablokowanym przyciskiem
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  inFlight = false;
  setBusy(buy, false, payLabel);
});

load().catch(() => showMessage(msg, 'Brak połączenia z kinem. Odśwież stronę.', 'notice error'));
