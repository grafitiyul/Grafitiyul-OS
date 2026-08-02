import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORTS, renderReport, renderReportSample, reportByNumber, reportsInGroup } from './registry.js';
import { statusIcon, dayLabel, cityChip, hebrewWeekday } from './guideReports.js';
import { coordinationSendMs, GUIDE_SEND_HOUR, SUMMARY_REMINDERS } from './tourSweeps.js';
import { israelLocalToMs } from '../communication/windows.js';

// ── the status/label rules the owner specified ───────────────────────────────

test('status icons: ✅ done at any distance, then 🔴 / 🔵 / 🟡 by days away', () => {
  for (const d of [0, 1, 2, 3, 4]) assert.equal(statusIcon(true, d), '✅');
  assert.equal(statusIcon(false, 0), '🔴');
  assert.equal(statusIcon(false, 1), '🔴');
  assert.equal(statusIcon(false, 2), '🔵');
  assert.equal(statusIcon(false, 3), '🔵');
  assert.equal(statusIcon(false, 4), '🟡');
});

test('there is deliberately no green bucket', () => {
  const icons = new Set([0, 1, 2, 3, 4].flatMap((d) => [statusIcon(true, d), statusIcon(false, d)]));
  assert.ok(!icons.has('🟢'));
  assert.deepEqual([...icons].sort(), ['✅', '🔴', '🔵', '🟡'].sort());
});

test('date labels: היום, מחר, then the Hebrew weekday name', () => {
  assert.equal(dayLabel(0, '2026-08-02'), 'היום');
  assert.equal(dayLabel(1, '2026-08-03'), 'מחר');
  assert.equal(dayLabel(2, '2026-08-04'), 'שלישי');
  assert.equal(dayLabel(3, '2026-08-05'), 'רביעי');
  assert.equal(dayLabel(4, '2026-08-06'), 'חמישי');
  assert.equal(hebrewWeekday('2026-08-01'), 'שבת');
});

test('the city shows in bold ONLY when it is not the home location', () => {
  assert.equal(cityChip({ cityName: 'ירושלים', locationId: 'l2', homeLocationId: 'l1' }), '*ירושלים*');
  assert.equal(cityChip({ cityName: 'תל אביב', locationId: 'l1', homeLocationId: 'l1' }), null);
  // No home location configured → show the city rather than wrongly hide it.
  assert.equal(cityChip({ cityName: 'חיפה', locationId: 'l2', homeLocationId: null }), '*חיפה*');
  assert.equal(cityChip({ cityName: null }), null);
});

// ── #11 the digest ───────────────────────────────────────────────────────────

test('#11 is one continuous list, one line per call, with the overdue section after a rule', () => {
  const text = renderReport(11, {
    recipient: { name: 'יואב כהן', firstName: 'יואב' },
    guideDigest: {
      coordination: [
        { done: false, daysAway: 0, tourDate: '2026-08-02', customerName: 'משפחת כהן', participants: 4, productName: 'סיור גרפיטי' },
        { done: false, daysAway: 1, tourDate: '2026-08-03', customerName: 'חברת ABC', participants: 18, productName: 'סיור קולינרי', cityName: 'ירושלים', locationId: 'l2', homeLocationId: 'l1' },
        { done: true, daysAway: 4, tourDate: '2026-08-06', customerName: 'רות לוי', participants: 2, productName: 'סדנת גרפיטי' },
      ],
      missingSummaries: [{ tourDate: '2026-07-30', customerName: 'עיריית תל אביב', productName: 'סיור וסדנת גרפיטי' }],
    },
  });
  const rows = text.split('\n');
  assert.equal(rows[0], '☎️ סטטוס שיחות התיאום לימים הקרובים');
  assert.equal(rows[2], '🔴 היום | משפחת כהן (4) | סיור גרפיטי');
  assert.equal(rows[3], '🔴 מחר | חברת ABC (18) | *ירושלים* | סיור קולינרי');
  assert.equal(rows[4], '✅ חמישי | רות לוי (2) | סדנת גרפיטי');
  assert.ok(text.includes('────────────────'));
  assert.ok(text.includes('📝 סיכומי סיור שטרם הושלמו'));
  assert.ok(text.includes('30/07/2026 | עיריית תל אביב | סיור וסדנת גרפיטי'));
  // No portal link at the bottom — explicit owner requirement.
  assert.ok(!/https?:\/\//.test(text));
});

test('#11 omits the overdue section entirely when nothing is overdue', () => {
  const text = renderReport(11, {
    guideDigest: {
      coordination: [{ done: true, daysAway: 0, tourDate: '2026-08-02', customerName: 'א', participants: 1, productName: 'ב' }],
      missingSummaries: [],
    },
  });
  assert.ok(!text.includes('────────────────'));
  assert.ok(!text.includes('סיכומי סיור שטרם הושלמו'));
});

// ── #12 private vs open tour ─────────────────────────────────────────────────

test('#12 for a private tour names the customer, org, product and headcount', () => {
  const text = renderReport(12, {
    recipient: { name: 'יואב כהן', firstName: 'יואב' },
    guideNotice: {
      openTour: false, contactName: 'דנה לוי', orgName: 'עיריית תל אביב',
      productName: 'סיור גרפיטי', participants: 24,
      formUrl: 'https://x/f/SCOPEDTOKEN',
    },
  });
  assert.ok(text.startsWith('☎️ זמן לשיחת תיאום!'));
  assert.match(text, /👤 דנה לוי/);
  assert.match(text, /🏢 עיריית תל אביב/);
  assert.match(text, /👥 24/);
  assert.ok(text.endsWith('לפתיחת הסיור:\n\nhttps://x/f/SCOPEDTOKEN'));
  assert.ok(!text.includes('סיור פתוח'));
});

test('#12 for an open tour is ONE message listing every booking', () => {
  const text = renderReport(12, {
    guideNotice: {
      openTour: true, productName: 'סיור גרפיטי',
      tourDate: '2026-08-04', tourTime: '10:00',
      participants: { total: 11, customers: [
        { label: 'משפחת כהן', count: 2 },
        { label: 'רות לוי', count: 1 },
        { label: 'חברת ABC', count: 8 },
      ] },
      formUrl: 'https://x/f/SCOPEDTOKEN',
    },
  });
  assert.match(text, /🎫 סיור פתוח/);
  assert.match(text, /📅 04\/08\/2026 \| 10:00/);
  assert.match(text, /• משפחת כהן \(2\)\n• רות לוי \(1\)\n• חברת ABC \(8\)/);
  // One message — the three customers appear together, never split.
  assert.equal((text.match(/זמן לשיחת תיאום/g) || []).length, 1);
});

// ── #13 / #14 / #15 / #16 ────────────────────────────────────────────────────

test('#13 announces the joiner and their count', () => {
  const text = renderReport(13, {
    guideNotice: { newCustomerName: 'משפחת כהן', newCustomerCount: 2, tourDate: '2026-08-04', tourTime: '10:00', formUrl: 'https://x' },
  });
  assert.ok(text.startsWith('➕ הצטרף משתתף חדש לסיור פתוח'));
  assert.match(text, /👤 משפחת כהן \(2\)/);
});

test('the summary ladder greets by FIRST name and names the customer', () => {
  const ctx = {
    recipient: { name: 'יואב כהן', firstName: 'יואב' },
    guideNotice: { customerName: 'עיריית תל אביב', tourDate: '2026-08-04', tourTime: '10:00', formUrl: 'https://x' },
  };
  const first = renderReport(14, ctx);
  assert.ok(first.startsWith('📝 הגיע הזמן למלא סיכום סיור'));
  assert.match(first, /היי יואב,/);
  assert.match(first, /מקווים שהיה סיור מוצלח עם עיריית תל אביב\./);

  const r1 = renderReport(15, ctx);
  assert.ok(r1.startsWith('📝 תזכורת למילוי סיכום סיור'));
  assert.match(r1, /יאללה, עכשיו כשזה עדיין חם 😊/);

  const r2 = renderReport(16, ctx);
  assert.ok(r2.startsWith('🔔 סיכום הסיור עדיין ממתין'));
  assert.match(r2, /בלי הסיכום - הסיור עוד לא באמת הסתיים 🙏/);

  for (const t of [first, r1, r2]) assert.ok(t.endsWith('https://x'));
});

test('a guide with no known first name is still greeted, never with "undefined"', () => {
  const text = renderReport(14, { guideNotice: { customerName: 'א', formUrl: 'https://x' } });
  assert.match(text, /היי מדריך,/);
});

// ── scheduling contract ──────────────────────────────────────────────────────

test('#12 is due at 08:00 two days before, walked earlier off blocked days', () => {
  // A Monday tour → D-2 is Saturday → the send moves to Friday 08:00.
  const r = coordinationSendMs('2026-08-03', new Map());
  assert.equal(r.date, '2026-07-31');
  assert.equal(r.movedDays, 1);
  assert.equal(r.ms, israelLocalToMs('2026-07-31', GUIDE_SEND_HOUR * 60));
});

test('the summary ladder is 0h / 3h / 6h after the tour ENDS', () => {
  assert.deepEqual(SUMMARY_REMINDERS, [
    { number: 14, afterHours: 0 },
    { number: 15, afterHours: 3 },
    { number: 16, afterHours: 6 },
  ]);
});

// ── catalog wiring ───────────────────────────────────────────────────────────

test('each workflow owns only its own guide notifications', () => {
  // The coordination-call flow keeps #11–#13; the summary ladder (#14–#16) is
  // surfaced by the סיכום סיור settings page, not by שיחת תיאום.
  assert.deepEqual(reportsInGroup('coordination').map((r) => r.number), [11, 12, 13]);
  assert.deepEqual(reportsInGroup('tour_summary').map((r) => r.number), [14, 15, 16]);

  for (const r of [...reportsInGroup('coordination'), ...reportsInGroup('tour_summary')]) {
    assert.equal(r.audience, 'guides', `#${r.number} addresses a guide`);
    assert.ok(r.triggerHe?.length > 10);
  }
  // The office reports stay where they are. #23/#24 are customer-audience but
  // still belong on the Manager Reports screen: the operator configures and
  // previews them there, they simply address a customer rather than the office.
  assert.deepEqual(reportsInGroup('office').map((r) => r.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.equal(reportByNumber(1).audience, undefined, 'office reports keep the group destination');
});

// ── the activation floor ─────────────────────────────────────────────────────

test('a notification never reports an event from before it was switched on', async () => {
  const { isDue } = await import('./tourSweeps.js');
  const now = 1_000_000_000_000;
  const hourAgo = now - 3_600_000;
  // Due and recent, no floor → fires.
  assert.equal(isDue(hourAgo, now, null), true);
  // The report was enabled AFTER the event was due → never fires.
  assert.equal(isDue(hourAgo, now, now - 60_000), false);
  // Enabled before it was due → fires.
  assert.equal(isDue(hourAgo, now, now - 7_200_000), true);
  // Not yet due, and stale, both stay false regardless of the floor.
  assert.equal(isDue(now + 1, now, null), false);
  assert.equal(isDue(now - 4 * 86_400_000, now, null), false);
  assert.equal(isDue(null, now, null), false);
});

test('#11 says so out loud when there are no upcoming coordination calls', () => {
  const text = renderReport(11, {
    guideDigest: { coordination: [], missingSummaries: [{ tourDate: '2026-07-30', customerName: 'א', productName: 'ב' }] },
  });
  assert.match(text, /אין שיחות תיאום לימים הקרובים\./);
  // …and never opens with a blank gap before the separator.
  assert.ok(!text.includes('\n\n\n'));
});

test('#12 for an open tour with no registrations says so, never a blank gap', () => {
  const text = renderReport(12, {
    guideNotice: {
      openTour: true, productName: 'סיור גרפיטי', tourDate: '2026-07-30', tourTime: '18:00',
      participants: { total: 0, customers: [] }, formUrl: 'https://x',
    },
  });
  assert.match(text, /👥 משתתפים:\n• עדיין אין נרשמים/);
  assert.ok(!text.includes('\n\n\n'));
});

// ── SECURITY REGRESSION GUARD ────────────────────────────────────────────────
// Messages #12-#16 once linked guides to /p/<portalToken>/tour/<id>, which is
// the whole-portal token with a path appended: truncate the path and you have
// the entire portal. This test exists so that link shape can never come back.

test('NO guide notification may ever contain a portal link', () => {
  const guideNumbers = REPORTS.filter((r) => r.audience === 'guides').map((r) => r.number);
  assert.ok(guideNumbers.length >= 5, 'expected the guide notification family');

  for (const number of guideNumbers) {
    const text = renderReportSample(number);
    assert.ok(text, `#${number} renders`);
    // The portal surface is /p/<token>. A form link is /f/<token>.
    assert.equal(/\/p\/[A-Za-z0-9_-]+/.test(text), false,
      `#${number} contains a guide-portal link:\n${text}`);
    assert.equal(text.includes('/tour/'), false,
      `#${number} contains a portal tour deep link:\n${text}`);
  }
});

test('every form-invitation message carries a FORM-scoped link', () => {
  // The replacement must actually be PRESENT — a message with no link would
  // pass the portal guard above while being useless. #11 is excluded: it is a
  // daily status list, not an invitation to fill anything.
  for (const number of [12, 13, 14, 15, 16]) {
    const text = renderReportSample(number);
    assert.ok(/\/f\/[A-Za-z0-9_-]+/.test(text) || text.includes('—'),
      `#${number} has neither a form link nor an honest dash:\n${text}`);
  }
});
