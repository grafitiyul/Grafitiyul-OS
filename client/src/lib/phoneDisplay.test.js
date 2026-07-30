import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPhoneDisplay, isoForIntlDigits } from './phone.js';

// The product rule (2026-07-30): canonical storage stays international digits;
// DISPLAY shows Israeli numbers locally and foreign numbers internationally.

test('canonical Israeli mobile → local grouped form', () => {
  assert.equal(formatPhoneDisplay('972521234567'), '052-123-4567');
  assert.equal(formatPhoneDisplay('972508783355'), '050-878-3355');
});

test('every stored shape of the same Israeli number displays identically', () => {
  for (const shape of ['972521234567', '+972521234567', '00972521234567', '0521234567', '+972 52-123-4567']) {
    assert.equal(formatPhoneDisplay(shape), '052-123-4567', shape);
  }
});

test('Israeli landline (9-digit local) groups as 0X-XXX-XXXX', () => {
  assert.equal(formatPhoneDisplay('97231234567'), '03-123-4567');
  assert.equal(formatPhoneDisplay('031234567'), '03-123-4567');
});

test('foreign numbers stay international with the dial code split out', () => {
  assert.equal(formatPhoneDisplay('447974905044'), '+44 7974905044');
  assert.equal(formatPhoneDisplay('5215564221678'), '+52 15564221678');
  assert.equal(formatPhoneDisplay('14438658050'), '+1 4438658050');
});

test('unknown / non-phone input is shown as typed, never mangled', () => {
  assert.equal(formatPhoneDisplay('123'), '123');
  assert.equal(formatPhoneDisplay(''), '');
  assert.equal(formatPhoneDisplay(null), '');
});

test('flag detection: Israeli → null (home needs no flag), foreign → ISO', () => {
  assert.equal(isoForIntlDigits('972521234567'), null);
  assert.equal(isoForIntlDigits('447974905044'), 'GB');
  assert.equal(isoForIntlDigits('5215564221678'), 'MX');
  assert.equal(isoForIntlDigits('97012345678'), 'PS'); // longest-prefix wins over 9/97
  assert.equal(isoForIntlDigits(''), null);
});
