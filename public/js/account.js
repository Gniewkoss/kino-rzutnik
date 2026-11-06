// Punkty klienta w nagłówku każdej strony. „Logowanie” to zapamiętany w tej przeglądarce e-mail:
// konto punktowe jest przypisane do e-maila, a kontrakt API nie ma haseł.
import { api, el } from './common.js';

const KEY = 'kino.account';
const REFRESH_MS = 60_000;
const WATCH_EVERY_MS = 2000;
const WATCH_FOR_MS = 40_000;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Math.round(n).toLocaleString('pl-PL');

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function save() {
  try {
    if (account.email) localStorage.setItem(KEY, JSON.stringify(account));
    else localStorage.removeItem(KEY);
  } catch { /* bez pamięci licznik działa do końca tej strony */ }
}

let account = load();
let shownPoints = account.points ?? null;
let countFrame;
let lastRefresh = 0;

const slot = document.getElementById('account');
const value = el('span', { class: 'points-value' });
const label = el('span', { class: 'points-label' });
const chip = el('button', { class: 'points-chip', type: 'button', popovertarget: 'account-panel', 'aria-haspopup': 'dialog' },
  el('span', { class: 'points-icon', 'aria-hidden': 'true' }), value, label);
const live = el('span', { class: 'sr-only', role: 'status' });
const panel = el('div', { id: 'account-panel', class: 'account-panel', popover: 'auto' });
slot?.append(chip, live, panel);

function renderChip() {
  const known = account.email && shownPoints !== null;
  value.textContent = known ? fmt(shownPoints) : '';
  label.textContent = known ? 'pkt' : account.email ? 'Punkty' : 'Moje punkty';
  chip.setAttribute('aria-label', known ? `Masz ${fmt(shownPoints)} punktów. Otwórz konto` : 'Moje punkty');
}

function renderPanel(note = '') {
  if (account.email) {
    panel.replaceChildren(
      el('p', { class: 'account-email' }, account.email),
      el('p', { class: 'account-balance' }, shownPoints === null ? 'Punkty są chwilowo niedostępne.' : `${fmt(shownPoints)} pkt to ${(shownPoints / 100).toLocaleString('pl-PL')} zł na kolejne bilety.`),
      el('p', { class: 'small' }, 'Za każdy złoty zapłacony kartą dostajesz 10 pkt. Punktami zapłacisz do połowy ceny biletu.'),
      el('button', { class: 'btn ghost', type: 'button', onclick: logout }, 'Wyloguj'),
    );
    return;
  }
  const input = el('input', { id: 'account-email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', required: true, maxlength: 254 });
  panel.replaceChildren(
    el('form', { onsubmit: login, novalidate: false },
      el('div', { class: 'field' },
        el('label', { for: 'account-email' }, 'Twój e-mail'),
        input,
        el('span', { class: 'points-note' }, note || 'Pokażemy Twoje punkty na każdej stronie. Nowy klient ma 1000 pkt na start.'),
      ),
      el('button', { class: 'btn', type: 'submit' }, 'Pokaż moje punkty'),
    ),
  );
}

async function login(e) {
  e.preventDefault();
  const email = e.target.email.value.trim().toLowerCase();
  setAccountEmail(email);
  await refreshPoints({ force: true });
  panel.hidePopover?.();
}

function logout() {
  account = {};
  shownPoints = null;
  save();
  renderChip();
  renderPanel();
  panel.hidePopover?.();
}

// Licznik, puls i „+220 pkt” pod licznikiem. Ruch zawsze odpowiada na zmianę salda, nigdy nie gra sam.
function playChange(from, to) {
  const delta = to - from;
  cancelAnimationFrame(countFrame);
  const gained = delta > 0;
  live.textContent = `${gained ? 'Dodano' : 'Odjęto'} ${fmt(Math.abs(delta))} punktów. Saldo: ${fmt(to)}.`;

  const badge = el('span', { class: `points-delta ${gained ? 'gain' : 'spend'}`, 'aria-hidden': 'true' }, `${gained ? '+' : '−'}${fmt(Math.abs(delta))} pkt`);
  slot.append(badge);

  if (calm.matches) {
    // Bez ruchu, ale zmiana nadal ma być widoczna: kolor licznika i etykieta z różnicą
    value.textContent = fmt(to);
    chip.classList.toggle('gaining', gained);
    setTimeout(() => {
      badge.remove();
      chip.classList.remove('gaining');
    }, 3000);
    return;
  }

  const duration = Math.min(1600, 700 + Math.abs(delta) / 2);
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    value.textContent = fmt(from + delta * (1 - (1 - t) ** 3));
    if (t < 1) countFrame = requestAnimationFrame(tick);
  };
  countFrame = requestAnimationFrame(tick);

  chip.classList.toggle('gaining', gained);
  chip.animate(
    gained
      ? [{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.25 }, { transform: 'scale(.97)', offset: 0.6 }, { transform: 'scale(1)' }]
      : [{ transform: 'scale(1)' }, { transform: 'scale(.92)', offset: 0.3 }, { transform: 'scale(1)' }],
    { duration: gained ? 800 : 420, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
  setTimeout(() => chip.classList.remove('gaining'), duration + 500);

  badge.animate(
    [
      { opacity: 0, transform: 'translate(-50%, -8px) scale(.8)' },
      { opacity: 1, transform: 'translate(-50%, 4px) scale(1.06)', offset: 0.14 },
      { opacity: 1, transform: 'translate(-50%, 8px) scale(1)', offset: 0.8 },
      { opacity: 0, transform: 'translate(-50%, 18px) scale(1)' },
    ],
    { duration: 2600, easing: 'ease-out', fill: 'forwards' },
  ).finished.finally(() => badge.remove());

  if (!gained) return;
  // Iskry z licznika: tylko przy dodaniu punktów, jedyny „wybuch” w całej aplikacji
  const count = 14;
  for (let i = 0; i < count; i++) {
    const spark = el('span', { class: 'points-spark', 'aria-hidden': 'true' });
    slot.append(spark);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const reach = 38 + Math.random() * 44;
    spark.animate(
      [
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        { opacity: 0, transform: `translate(calc(-50% + ${Math.cos(angle) * reach * 1.5}px), calc(-50% + ${Math.sin(angle) * reach}px)) scale(.3)` },
      ],
      { duration: 650 + Math.random() * 450, easing: 'cubic-bezier(.15,.7,.3,1)' },
    ).finished.finally(() => spark.remove());
  }
}

function showPoints(points) {
  const previous = shownPoints;
  shownPoints = points;
  account.points = points;
  save();
  renderPanel();
  if (previous === null || previous === points) {
    renderChip();
    if (previous === null && slot) playChange(0, points);
    return;
  }
  chip.setAttribute('aria-label', `Masz ${fmt(points)} punktów. Otwórz konto`);
  playChange(previous, points);
}

export function setAccountEmail(email) {
  if (!email || email === account.email) return;
  account = { email };
  shownPoints = null;
  save();
  renderChip();
  renderPanel();
}

export const accountEmail = () => account.email;

export async function refreshPoints({ force = false } = {}) {
  if (!account.email || (!force && Date.now() - lastRefresh < REFRESH_MS)) return shownPoints;
  lastRefresh = Date.now();
  const email = account.email;
  try {
    const { ok, data } = await api(`/api/loyalty?email=${encodeURIComponent(email)}`);
    if (ok && account.email === email) showPoints(data.points);
    else if (shownPoints === null) renderChip();
  } catch { /* zostaje ostatnia znana wartość */ }
  return shownPoints;
}

// Klient właśnie wydał punkty: licznik schodzi od razu, bez czekania na serwer
export function noteSpent(pointsLeft) {
  if (account.email && pointsLeft !== shownPoints) showPoints(pointsLeft);
}

// Punkty za zakup dochodzą chwilę po płatności (worker), więc tuż po zakupie patrzymy, kiedy się pojawią
export async function watchForEarnedPoints() {
  if (!account.email) return;
  const before = shownPoints;
  const deadline = Date.now() + WATCH_FOR_MS;
  while (Date.now() < deadline) {
    const now = await refreshPoints({ force: true });
    if (now !== before) return;
    await sleep(WATCH_EVERY_MS);
  }
}

renderChip();
renderPanel();
refreshPoints({ force: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshPoints();
});
