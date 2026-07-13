import test from 'node:test';
import assert from 'node:assert/strict';
import { durationToMs, durationLabelHe, defaultPaymentLinkMessage, DEFAULT_HOLD } from '../../../shared/reservationDuration.mjs';

test('default hold is 3 hours', () => {
  assert.deepEqual(DEFAULT_HOLD, { value: 3, unit: 'hours' });
});

test('durationToMs converts minutes/hours/days', () => {
  assert.equal(durationToMs(30, 'minutes'), 30 * 60_000);
  assert.equal(durationToMs(3, 'hours'), 3 * 3_600_000);
  assert.equal(durationToMs(2, 'days'), 2 * 86_400_000);
  assert.equal(durationToMs(0, 'hours'), null);
});

test('durationLabelHe matches the product examples exactly', () => {
  assert.equal(durationLabelHe(30, 'minutes'), '30 דקות');
  assert.equal(durationLabelHe(1, 'minutes'), 'דקה אחת');
  assert.equal(durationLabelHe(1, 'hours'), 'שעה אחת');
  assert.equal(durationLabelHe(3, 'hours'), '3 שעות');
  assert.equal(durationLabelHe(1, 'days'), 'יום אחד');
  assert.equal(durationLabelHe(2, 'days'), '2 ימים');
});

test('default message interpolates the live duration label', () => {
  assert.equal(defaultPaymentLinkMessage(3, 'hours', 'LINK'), 'המערכת שומרת לכם את המקום בסיור למשך 3 שעות, עד הסדרת התשלום:\nLINK');
  assert.equal(defaultPaymentLinkMessage(1, 'days'), 'המערכת שומרת לכם את המקום בסיור למשך יום אחד, עד הסדרת התשלום:');
  assert.match(defaultPaymentLinkMessage(30, 'minutes'), /למשך 30 דקות/);
});
