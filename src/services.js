// Cudze systemy i saga w jednym miejscu. Brak klucza danej usługi nie blokuje startu aplikacji.
import { createPayments } from './payments.js';
import { createVoucherify } from './voucherify.js';
import { createLoyalty } from './loyalty.js';
import { createMailer } from './mail.js';
import { createSagas } from './saga.js';

export function createServices(collections, config) {
  const payments = createPayments(config);
  const voucherify = createVoucherify(config);
  const loyalty = createLoyalty(collections, voucherify, config);
  const mailer = createMailer(config);
  const sagas = createSagas(collections, { payments, loyalty, mailer, config });
  return { payments, loyalty, mailer, sagas };
}
