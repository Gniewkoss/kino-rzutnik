#!/usr/bin/env node
// Jednorazowo zakłada kampanię lojalnościową w sandboxie: każda nowa karta startuje z 1000 punktów.
// Użycie: VOUCHERIFY_APP_ID=… VOUCHERIFY_APP_TOKEN=… npm run voucherify:setup
const { VOUCHERIFY_APP_ID: appId, VOUCHERIFY_APP_TOKEN: appToken, VOUCHERIFY_API_URL: apiUrl = 'https://api.voucherify.io' } = process.env;
if (!appId || !appToken) {
  console.error('Ustaw VOUCHERIFY_APP_ID i VOUCHERIFY_APP_TOKEN');
  process.exit(1);
}

const res = await fetch(`${apiUrl}/v1/loyalties`, {
  method: 'POST',
  headers: { 'X-App-Id': appId, 'X-App-Token': appToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Kino Rzutnik',
    type: 'AUTO_UPDATE',
    voucher: {
      type: 'LOYALTY_CARD',
      loyalty_card: { points: 1000 },
      code_config: { pattern: 'KINO-#######' },
    },
  }),
});
const body = await res.json();
if (!res.ok) {
  console.error(`Nie udało się (${res.status}):`, body);
  process.exit(1);
}
console.log(`VOUCHERIFY_CAMPAIGN_ID=${body.id}`);
