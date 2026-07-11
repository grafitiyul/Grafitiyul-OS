import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDesiredEvent,
  diffEvent,
  wallTimeToEpoch,
  epochToWallTime,
  isHebrewTour,
  DESCRIPTION_HE,
  DESCRIPTION_EN,
  CALENDAR_TIMEZONE,
} from './desiredState.js';

function makeTour(overrides = {}) {
  return {
    id: 'tour1',
    date: '2026-07-20',
    startTime: '10:00',
    tourLanguage: 'he',
    product: { nameHe: 'סיור גרפיטי פלורנטין', nameEn: 'Florentin Graffiti Tour' },
    productVariant: { durationHours: 2.5 },
    assignments: [
      { displayName: 'דנה', personRef: { email: 'dana@example.com' } },
      { displayName: 'יואב', personRef: { email: 'Yoav@Example.com ' } },
    ],
    activityComponents: [],
    ...overrides,
  };
}

test('hebrew tour: hebrew title + hebrew description', () => {
  const { event, warnings } = buildDesiredEvent(makeTour());
  assert.equal(event.summary, 'סיור גרפיטי פלורנטין');
  assert.equal(event.description, DESCRIPTION_HE);
  assert.equal(warnings.length, 0);
});

test('non-hebrew tour: english title + english description', () => {
  const { event } = buildDesiredEvent(makeTour({ tourLanguage: 'fr' }));
  assert.equal(event.summary, 'Florentin Graffiti Tour');
  assert.equal(event.description, DESCRIPTION_EN);
});

test('non-hebrew tour without english name falls back to hebrew name', () => {
  const { event } = buildDesiredEvent(
    makeTour({ tourLanguage: 'en', product: { nameHe: 'סיור', nameEn: null } }),
  );
  assert.equal(event.summary, 'סיור');
});

test('null language counts as hebrew (business default)', () => {
  assert.equal(isHebrewTour(null), true);
  assert.equal(isHebrewTour('he'), true);
  assert.equal(isHebrewTour('en'), false);
  assert.equal(isHebrewTour('ru'), false);
});

test('duration derives from variant: 2.5h from 10:00 ends 12:30', () => {
  const { event } = buildDesiredEvent(makeTour());
  assert.equal(event.start.dateTime, '2026-07-20T10:00:00');
  assert.equal(event.start.timeZone, CALENDAR_TIMEZONE);
  assert.equal(event.end.dateTime, '2026-07-20T12:30:00');
});

test('missing variant duration → 2h default + warning', () => {
  const { event, warnings } = buildDesiredEvent(makeTour({ productVariant: null }));
  assert.equal(event.end.dateTime, '2026-07-20T12:00:00');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /משך/);
});

test('duration crossing midnight rolls the end date', () => {
  const { event } = buildDesiredEvent(
    makeTour({ startTime: '23:00', productVariant: { durationHours: 2 } }),
  );
  assert.equal(event.end.dateTime, '2026-07-21T01:00:00');
});

test('attendees: every assignment regardless of role, normalized + deduped', () => {
  const { event } = buildDesiredEvent(
    makeTour({
      assignments: [
        { displayName: 'א', role: 'lead_guide', personRef: { email: 'a@x.com' } },
        { displayName: 'ב', role: 'workshop_assistant', personRef: { email: 'A@X.com' } },
        { displayName: 'ג', role: 'guide', personRef: { email: 'c@x.com' } },
      ],
    }),
  );
  assert.deepEqual(event.attendees, [{ email: 'a@x.com' }, { email: 'c@x.com' }]);
});

test('missing email is a warning, never a failure — everyone else still syncs', () => {
  const { event, warnings } = buildDesiredEvent(
    makeTour({
      assignments: [
        { displayName: 'בלי מייל', personRef: { email: null } },
        { displayName: 'עם מייל', personRef: { email: 'ok@x.com' } },
        { displayName: 'נמחק', personRef: null },
      ],
    }),
  );
  assert.deepEqual(event.attendees, [{ email: 'ok@x.com' }]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /בלי מייל/);
});

test('location: workshop locations in sort order, deduped; empty when none', () => {
  const withLocs = buildDesiredEvent(
    makeTour({
      activityComponents: [
        { sortOrder: 2, workshopLocation: { nameHe: 'סדנה ב', address: null } },
        { sortOrder: 0, workshopLocation: { nameHe: 'סדנה א', address: 'רחוב 1, תל אביב' } },
        { sortOrder: 1, workshopLocation: null },
        { sortOrder: 3, workshopLocation: { nameHe: 'סדנה א', address: 'רחוב 1, תל אביב' } },
      ],
    }),
  );
  assert.equal(withLocs.event.location, 'סדנה א — רחוב 1, תל אביב, סדנה ב');
  const noLocs = buildDesiredEvent(makeTour());
  assert.equal(noLocs.event.location, '');
});

test('event carries the idempotency stamp and locks guest edits', () => {
  const { event } = buildDesiredEvent(makeTour());
  assert.equal(event.extendedProperties.private.gosTourEventId, 'tour1');
  assert.equal(event.guestsCanModify, false);
  assert.equal(event.guestsCanInviteOthers, false);
});

// ── timezone math ─────────────────────────────────────────────────────────────

test('wallTimeToEpoch handles IDT (summer, UTC+3) and IST (winter, UTC+2)', () => {
  assert.equal(wallTimeToEpoch('2026-07-20', '10:00'), Date.parse('2026-07-20T10:00:00+03:00'));
  assert.equal(wallTimeToEpoch('2026-01-20', '10:00'), Date.parse('2026-01-20T10:00:00+02:00'));
});

test('epochToWallTime round-trips', () => {
  const epoch = wallTimeToEpoch('2026-07-20', '23:45');
  assert.equal(epochToWallTime(epoch), '2026-07-20T23:45:00');
});

// ── diff ──────────────────────────────────────────────────────────────────────

function existingFromDesired(desired) {
  // What Google would return for a fully-synced event (offset-form datetimes).
  return {
    summary: desired.summary,
    description: desired.description,
    location: desired.location,
    start: { dateTime: new Date(wallTimeToEpoch(desired.start.dateTime.slice(0, 10), desired.start.dateTime.slice(11, 16))).toISOString() },
    end: { dateTime: new Date(wallTimeToEpoch(desired.end.dateTime.slice(0, 10), desired.end.dateTime.slice(11, 16))).toISOString() },
    attendees: desired.attendees.map((a) => ({ ...a, responseStatus: 'accepted' })),
    extendedProperties: desired.extendedProperties,
  };
}

test('diffEvent: identical state → null (no API write, no guest spam)', () => {
  const { event } = buildDesiredEvent(makeTour());
  assert.equal(diffEvent(existingFromDesired(event), event), null);
});

test('diffEvent: date change patches start+end only', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  const moved = buildDesiredEvent(makeTour({ date: '2026-07-21' })).event;
  const patch = diffEvent(existing, moved);
  assert.deepEqual(Object.keys(patch).sort(), ['end', 'start']);
  assert.equal(patch.start.dateTime, '2026-07-21T10:00:00');
});

test('diffEvent: added guide patches attendees, keeping RSVPs of existing ones', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  const grown = buildDesiredEvent(
    makeTour({
      assignments: [
        { displayName: 'דנה', personRef: { email: 'dana@example.com' } },
        { displayName: 'יואב', personRef: { email: 'yoav@example.com' } },
        { displayName: 'חדש', personRef: { email: 'new@example.com' } },
      ],
    }),
  ).event;
  const patch = diffEvent(existing, grown);
  assert.deepEqual(Object.keys(patch), ['attendees']);
  assert.deepEqual(patch.attendees, [
    { email: 'dana@example.com', responseStatus: 'accepted' },
    { email: 'yoav@example.com', responseStatus: 'accepted' },
    { email: 'new@example.com' },
  ]);
});

test('diffEvent: removed guide patches attendees', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  const shrunk = buildDesiredEvent(
    makeTour({ assignments: [{ displayName: 'דנה', personRef: { email: 'dana@example.com' } }] }),
  ).event;
  const patch = diffEvent(existing, shrunk);
  assert.deepEqual(patch.attendees, [{ email: 'dana@example.com', responseStatus: 'accepted' }]);
});

test('diffEvent: organizer/resource rows in Google response never count as guests', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  existing.attendees = [
    { email: 'info@grafitiyul.co.il', organizer: true, responseStatus: 'accepted' },
    ...existing.attendees,
  ];
  assert.equal(diffEvent(existing, event), null);
});

test('diffEvent: variant change patches title and end time', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  const changed = buildDesiredEvent(
    makeTour({
      product: { nameHe: 'סדנת גרפיטי', nameEn: 'Graffiti Workshop' },
      productVariant: { durationHours: 3 },
    }),
  ).event;
  const patch = diffEvent(existing, changed);
  assert.deepEqual(Object.keys(patch).sort(), ['end', 'summary']);
});
