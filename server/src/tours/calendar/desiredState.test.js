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
  EVENT_COLOR_ID,
} from './desiredState.js';

function makeTour(overrides = {}) {
  return {
    id: 'tour1',
    date: '2026-07-20',
    startTime: '10:00',
    tourLanguage: 'he',
    product: { nameHe: 'סיור גרפיטי פלורנטין', nameEn: 'Florentin Graffiti Tour' },
    productVariant: { durationHours: 2.5 },
    location: null,
    assignments: [
      { displayName: 'דנה', personRef: { email: 'dana@example.com' } },
      { displayName: 'יואב', personRef: { email: 'Yoav@Example.com ' } },
    ],
    activityComponents: [],
    ...overrides,
  };
}

// ── title ─────────────────────────────────────────────────────────────────────

test('title = full variant name | DD.MM.YYYY | HH:MM (hebrew)', () => {
  const { event, warnings } = buildDesiredEvent(makeTour());
  assert.equal(event.summary, 'סיור גרפיטי פלורנטין | 20.07.2026 | 10:00');
  assert.equal(event.description, DESCRIPTION_HE);
  assert.equal(warnings.length, 0);
});

test('title includes the variant city when the tour has one', () => {
  const { event } = buildDesiredEvent(
    makeTour({ location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' } }),
  );
  assert.equal(event.summary, 'סיור גרפיטי פלורנטין · תל אביב | 20.07.2026 | 10:00');
});

test('title falls back to the variant relation city when tour.location is null', () => {
  const { event } = buildDesiredEvent(
    makeTour({
      productVariant: { durationHours: 2.5, location: { nameHe: 'חיפה', nameEn: null } },
    }),
  );
  assert.equal(event.summary, 'סיור גרפיטי פלורנטין · חיפה | 20.07.2026 | 10:00');
});

test('non-hebrew tour: english variant name + english description', () => {
  const { event } = buildDesiredEvent(
    makeTour({ tourLanguage: 'fr', location: { nameHe: 'תל אביב', nameEn: 'Tel Aviv' } }),
  );
  assert.equal(event.summary, 'Florentin Graffiti Tour · Tel Aviv | 20.07.2026 | 10:00');
  assert.equal(event.description, DESCRIPTION_EN);
});

test('non-hebrew tour without english name falls back to hebrew name', () => {
  const { event } = buildDesiredEvent(
    makeTour({ tourLanguage: 'en', product: { nameHe: 'סיור', nameEn: null } }),
  );
  assert.equal(event.summary, 'סיור | 20.07.2026 | 10:00');
});

test('title date/time segments track the tour date/time', () => {
  const moved = buildDesiredEvent(makeTour({ date: '2026-08-04', startTime: '12:00' }));
  assert.equal(moved.event.summary, 'סיור גרפיטי פלורנטין | 04.08.2026 | 12:00');
});

test('null language counts as hebrew (business default)', () => {
  assert.equal(isHebrewTour(null), true);
  assert.equal(isHebrewTour('he'), true);
  assert.equal(isHebrewTour('en'), false);
  assert.equal(isHebrewTour('ru'), false);
});

// ── color / duration / attendees / location ──────────────────────────────────

test('events default to the orange (Tangerine) palette color', () => {
  const { event } = buildDesiredEvent(makeTour());
  assert.equal(event.colorId, EVENT_COLOR_ID);
  assert.equal(EVENT_COLOR_ID, '6');
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

// ── diff: operational fields ──────────────────────────────────────────────────

// What Google would return for a fully-GOS-synced event (offset datetimes).
function existingFromDesired(desired) {
  return {
    summary: desired.summary,
    description: desired.description,
    colorId: desired.colorId,
    location: desired.location,
    start: { dateTime: new Date(wallTimeToEpoch(desired.start.dateTime.slice(0, 10), desired.start.dateTime.slice(11, 16))).toISOString() },
    end: { dateTime: new Date(wallTimeToEpoch(desired.end.dateTime.slice(0, 10), desired.end.dateTime.slice(11, 16))).toISOString() },
    attendees: desired.attendees.map((a) => ({ ...a, responseStatus: 'accepted' })),
    extendedProperties: desired.extendedProperties,
  };
}

function baselinesOf(desired) {
  return { summary: desired.summary, description: desired.description, colorId: desired.colorId };
}

test('diffEvent: identical state → null patch (no API write, no guest spam)', () => {
  const { event } = buildDesiredEvent(makeTour());
  const { patch, written } = diffEvent(existingFromDesired(event), event, baselinesOf(event));
  assert.equal(patch, null);
  assert.deepEqual(written, baselinesOf(event));
});

test('diffEvent: date change patches start+end AND the derived title date segment', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  const moved = buildDesiredEvent(makeTour({ date: '2026-07-21' })).event;
  const { patch, written } = diffEvent(existing, moved, baselinesOf(event));
  assert.deepEqual(Object.keys(patch).sort(), ['end', 'start', 'summary']);
  assert.equal(patch.start.dateTime, '2026-07-21T10:00:00');
  assert.equal(patch.summary, 'סיור גרפיטי פלורנטין | 21.07.2026 | 10:00');
  assert.equal(written.summary, patch.summary); // new baseline follows the write
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
  const { patch } = diffEvent(existing, grown, baselinesOf(event));
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
  const { patch } = diffEvent(existing, shrunk, baselinesOf(event));
  assert.deepEqual(patch.attendees, [{ email: 'dana@example.com', responseStatus: 'accepted' }]);
});

test('diffEvent: removing the LAST guide sends an explicit empty attendee list', () => {
  const { event } = buildDesiredEvent(
    makeTour({ assignments: [{ displayName: 'דנה', personRef: { email: 'dana@example.com' } }] }),
  );
  const existing = existingFromDesired(event);
  const empty = buildDesiredEvent(makeTour({ assignments: [] })).event;
  const { patch } = diffEvent(existing, empty, baselinesOf(event));
  assert.deepEqual(patch.attendees, []); // regression: [] must be SENT, not omitted
});

test('diffEvent: organizer/resource rows in Google response never count as guests', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  existing.attendees = [
    { email: 'info@grafitiyul.co.il', organizer: true, responseStatus: 'accepted' },
    ...existing.attendees,
  ];
  assert.equal(diffEvent(existing, event, baselinesOf(event)).patch, null);
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
  const { patch } = diffEvent(existing, changed, baselinesOf(event));
  assert.deepEqual(Object.keys(patch).sort(), ['end', 'summary']);
});

// ── diff: presentation-field ownership (manual edits in Google) ──────────────

test('manual title in Google survives a time change; times still sync (scenario 5)', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  existing.summary = 'כותרת ידנית של המפעיל'; // manual edit: differs from baseline
  const moved = buildDesiredEvent(makeTour({ startTime: '14:00' })).event;
  const { patch, written } = diffEvent(existing, moved, baselinesOf(event));
  assert.ok(patch.start && patch.end); // operational fields converge
  assert.equal(patch.summary, undefined); // manual title preserved
  assert.equal(written.summary, event.summary); // baseline unchanged → revert restores ownership
});

test('manual description survives a guide add; guide still invited (scenario 6)', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  existing.description = 'תיאור ידני';
  const grown = buildDesiredEvent(
    makeTour({
      assignments: [
        { displayName: 'דנה', personRef: { email: 'dana@example.com' } },
        { displayName: 'יואב', personRef: { email: 'yoav@example.com' } },
        { displayName: 'חדש', personRef: { email: 'new@example.com' } },
      ],
    }),
  ).event;
  const { patch } = diffEvent(existing, grown, baselinesOf(event));
  assert.ok(patch.attendees);
  assert.equal(patch.description, undefined);
});

test('manual color survives a date change; date still syncs (scenario 7)', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  existing.colorId = '11'; // operator recolored to Tomato in Google
  const moved = buildDesiredEvent(makeTour({ date: '2026-07-25' })).event;
  const { patch, written } = diffEvent(existing, moved, baselinesOf(event));
  assert.ok(patch.start && patch.end);
  assert.equal(patch.colorId, undefined);
  assert.equal(written.colorId, EVENT_COLOR_ID); // baseline kept for future revert
});

test('manual revert to the GOS value hands ownership back', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event); // current == baseline again
  const moved = buildDesiredEvent(makeTour({ date: '2026-07-25' })).event;
  const { patch } = diffEvent(existing, moved, baselinesOf(event));
  assert.equal(patch.summary, moved.summary); // GOS-owned again → follows default
});

test('legacy event (no baselines) → GOS adopts presentation fields once', () => {
  const { event } = buildDesiredEvent(makeTour());
  const existing = existingFromDesired(event);
  existing.summary = 'כותרת מהגרסה הישנה';
  delete existing.colorId;
  const { patch, written } = diffEvent(existing, event, {}); // no baselines stored
  assert.equal(patch.summary, event.summary); // adopted (title format rollout)
  assert.equal(patch.colorId, EVENT_COLOR_ID); // colored orange
  assert.equal(written.summary, event.summary);
});

// ── Open Tour template enrichment (duration override + meeting-point fallback) ─

test('open-tour template durationHoursOverride forces the calendar duration', () => {
  // Variant says 2.5h, but the template pins 4h → end = start + 4h.
  const { event } = buildDesiredEvent(
    makeTour({ startTime: '10:00', openTourTemplate: { durationHoursOverride: 4 } }),
  );
  assert.match(event.end.dateTime, /T14:00:00$/);
});

test('a non-positive/absent override falls back to the variant duration', () => {
  const { event } = buildDesiredEvent(
    makeTour({ startTime: '10:00', openTourTemplate: { durationHoursOverride: 0 } }),
  );
  assert.match(event.end.dateTime, /T12:30:00$/); // 2.5h variant duration
});

test('open-tour meeting point is the location fallback when no workshop component', () => {
  const { event } = buildDesiredEvent(
    makeTour({ activityComponents: [], openTourTemplate: { meetingPoint: 'כיכר דיזנגוף' } }),
  );
  assert.equal(event.location, 'כיכר דיזנגוף');
});

test('a workshop component location still wins over the template meeting point', () => {
  const { event } = buildDesiredEvent(
    makeTour({
      activityComponents: [{ sortOrder: 0, workshopLocation: { nameHe: 'הסטודיו', address: 'רח\' 1' } }],
      openTourTemplate: { meetingPoint: 'כיכר דיזנגוף' },
    }),
  );
  assert.equal(event.location, 'הסטודיו — רח\' 1');
});
