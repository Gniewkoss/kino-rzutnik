// Wspólne helpery dla wszystkich stron

export async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* pusta odpowiedź */ }
  return { ok: res.ok, status: res.status, data, headers: res.headers };
}

const tz = 'Europe/Warsaw';
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: tz });
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
export const fmtDateShort = (iso) => new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', timeZone: tz });

// "F7" -> { row: "F", number: 7 }
export function parseSeat(seatId) {
  const m = /^([A-Z])(\d+)$/.exec(seatId || '');
  return m ? { row: m[1], number: Number(m[2]) } : { row: '?', number: seatId };
}
export const seatLabel = (seatId) => {
  const { row, number } = parseSeat(seatId);
  return `Rząd ${row}, miejsce ${number}`;
};

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children.flat()) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export function showMessage(node, text, kind = 'error') {
  node.className = `msg ${kind}`;
  node.textContent = text;
}

// Polska odmiana: 1 wolny fotel, 2 wolne fotele, 5 wolnych foteli
export function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
export const freeSeatsLabel = (n) => `${n} ${plural(n, 'wolny fotel', 'wolne fotele', 'wolnych foteli')}`;

export function setBusy(button, busy, idleText, busyText) {
  button.disabled = busy;
  button.replaceChildren(...(busy ? [el('span', { class: 'spinner', 'aria-hidden': 'true' }), busyText] : [idleText]));
}
