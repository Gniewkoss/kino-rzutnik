// Mail z biletem przez Resend. Resend obsługuje klucz idempotencji, więc powtórka nie wyśle drugiego maila.
import { ExternalError, fromResponse } from './external.js';

const TIMEOUT_MS = 10_000;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const zloty = (grosze) => `${(grosze / 100).toLocaleString('pl-PL', { minimumFractionDigits: grosze % 100 ? 2 : 0 })} zł`;
const pointsLabel = (n) => `${n} pkt`;

export function ticketEmail({ code, title, startsAt, hall, seatId, customerName, cardAmount, pointsUsed, pointsEarned, ticketUrl }) {
  const when = new Date(startsAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long', timeStyle: 'short' });
  const seat = `rząd ${seatId[0]}, miejsce ${seatId.slice(1)}`;
  const lines = [
    ['Seans', title],
    ['Kiedy', when],
    ['Gdzie', `${hall}, ${seat}`],
    ['Widz', customerName],
    ['Kod biletu', code],
    ['Zapłacono kartą', zloty(cardAmount)],
    ['Zapłacono punktami', `${pointsLabel(pointsUsed)} (${zloty(pointsUsed)})`],
    ['Zebrane punkty', pointsLabel(pointsEarned)],
  ];
  return {
    subject: `Twój bilet: ${title}, kod ${code}`,
    text: `${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nBilet: ${ticketUrl}\nPokaż kod przy wejściu na salę.`,
    html: `<h1 style="font-family:sans-serif">Twój bilet</h1><table style="font-family:sans-serif;border-collapse:collapse">${lines
      .map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#555">${escapeHtml(k)}</td><td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`)
      .join('')}</table><p style="font-family:sans-serif"><a href="${escapeHtml(ticketUrl)}">Otwórz bilet</a>. Pokaż kod przy wejściu na salę.</p>`,
  };
}

export function createMailer(config) {
  if (!config.resendApiKey) return null;
  return {
    async send({ to, subject, text, html, idempotencyKey }) {
      let res;
      try {
        res = await fetch(`${config.resendApiUrl}/emails`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text, html }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new ExternalError('Resend', err.message, { unknownOutcome: true });
      }
      if (res.ok) return res.json();
      const body = await res.text().catch(() => '');
      const error = fromResponse('Resend', res, body);
      // Ten sam klucz w trakcie obsługi: to tylko chwila, spróbujemy znowu
      if (res.status === 409 && body.includes('concurrent_idempotent_requests')) error.retryable = true;
      throw error;
    },
  };
}
