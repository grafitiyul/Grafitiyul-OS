import test from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS, triggerByType, CATEGORY_LABELS, KIND_LABELS } from './triggers.js';
import { tourChangeDescription } from './format.js';
import { resolveVariables } from './variables.js';
import { applyTriggerOverrides } from './context.js';
import { buildSyntheticContext } from './synthetic.js';
import { prepareMessageRun } from './prepare.js';
import { validateEventForActivation } from './validation.js';

// ── registry structure ───────────────────────────────────────────────────────

test('the picker catalog is complete: categories, kinds and Hebrew hints', () => {
  for (const t of TRIGGERS) {
    assert.ok(CATEGORY_LABELS[t.category], `${t.type} has a known category`);
    assert.ok(KIND_LABELS[t.kind], `${t.type} has a known kind`);
    assert.ok(t.hintHe?.length > 10, `${t.type} has a Hebrew hint`);
  }
  const byCat = (c) => TRIGGERS.filter((t) => t.category === c).map((t) => t.type);
  assert.deepEqual(byCat('crm'), ['deal_created', 'deal_won', 'deal_lost']);
  assert.deepEqual(byCat('quotes'), ['quote_send', 'reservation_submitted', 'payment_received']);
  assert.deepEqual(byCat('tours'), ['tour_datetime', 'tour_datetime_changed', 'tour_cancelled']);
});

test('kinds distinguish event / anchor / action', () => {
  assert.equal(triggerByType('deal_created').kind, 'event');
  assert.equal(triggerByType('tour_datetime').kind, 'anchor');
  assert.equal(triggerByType('quote_send').kind, 'action');
});

test('the tour anchor trigger is LOCKED to the tour_datetime anchor', () => {
  assert.deepEqual(triggerByType('tour_datetime').anchors, ['tour_datetime']);
  // An event that somehow carries the wrong anchor is blocked from activation.
  const errors = validateEventForActivation({
    internalName: 'x', triggerType: 'tour_datetime', anchorType: 'trigger_time',
    timingMode: 'before', timingAmount: 1, timingUnit: 'days', activityMode: 'all', activityTypes: [],
  });
  assert.ok(errors.some((e) => /עוגן/.test(e)));
});

// ── change description + variables ───────────────────────────────────────────

test('tourChangeDescription: both / date-only / time-only / none', () => {
  const both = { prevDate: '2026-08-10', prevTime: '10:00', newDate: '2026-08-12', newTime: '14:00' };
  assert.equal(tourChangeDescription(both, 'he'), 'מועד הסיור השתנה מ-10/08/2026 בשעה 10:00 ל-12/08/2026 בשעה 14:00');
  assert.match(tourChangeDescription(both, 'en'), /moved from 10\/08\/2026 at 10:00 to 12\/08\/2026 at 14:00/);
  const timeOnly = { prevDate: '2026-08-10', prevTime: '10:00', newDate: '2026-08-10', newTime: '12:30' };
  assert.equal(tourChangeDescription(timeOnly, 'he'), 'שעת הסיור השתנתה מ-10:00 ל-12:30 (10/08/2026)');
  const none = { prevDate: '2026-08-10', prevTime: '10:00', newDate: '2026-08-10', newTime: '10:00' };
  assert.equal(tourChangeDescription(none, 'he'), null);
});

test('change variables resolve from triggerData; honestly missing without it', () => {
  const ctx = applyTriggerOverrides({}, { prevDate: '2026-08-10', prevTime: '10:00', newDate: '2026-08-12', newTime: '14:00' });
  const { values } = resolveVariables(
    ['tour_prev_date', 'tour_prev_time', 'tour_new_date', 'tour_new_time', 'tour_change_description'], ctx, 'he',
  );
  assert.equal(values.tour_prev_date, '10/08/2026');
  assert.equal(values.tour_new_time, '14:00');
  assert.match(values.tour_change_description, /מועד הסיור השתנה/);
  const { missing } = resolveVariables(['tour_change_description'], {}, 'he');
  assert.deepEqual(missing, ['tour_change_description']);
});

// ── quote_send explicit-document override ────────────────────────────────────

test('quote_send data overrides the default quote resolution with the EXACT document', () => {
  const ctx = { quoteDoc: { quoteDocumentId: 'other', publicToken: 'latest-token', versionNo: 9, source: 'latest_produced' }, links: { origin: 'https://x' } };
  applyTriggerOverrides(ctx, { quoteDocumentId: 'qd1', publicToken: 'chosen-token', versionNo: 2 });
  assert.equal(ctx.quoteDoc.publicToken, 'chosen-token');
  assert.equal(ctx.quoteDoc.source, 'explicit_action');
  const { values } = resolveVariables(['quote_link'], ctx, 'he');
  assert.equal(values.quote_link, 'https://x/quote/chosen-token');
});

// ── full dry-run with a change payload ───────────────────────────────────────

const noWindow = async () => ({ windowEnabled: false, window: null, exceptions: [] });

test('prepare renders a change message end-to-end via triggerData', async () => {
  const ctx = buildSyntheticContext({ contactFirstName: 'דנה', phone: '050-0000000' });
  const run = await prepareMessageRun({
    message: { channel: 'whatsapp', audienceType: 'primary_contact', waDestinationType: 'private', languagePolicy: 'he_only', fallbackLanguage: 'he', windowEnabled: false },
    event: { activityMode: 'all', activityTypes: [], orgTypeIds: [], orgSubtypeIds: [], conditions: [], anchorType: 'trigger_time', timingMode: 'immediate' },
    versionContent: { he: { body: '<p>{{customer_first_name}}, {{tour_change_description}}. מועד חדש: {{tour_new_date}} {{tour_new_time}}</p>' }, attachments: [] },
    ctx,
    triggerData: { prevDate: '2026-08-10', prevTime: '10:00', newDate: '2026-08-12', newTime: '14:00' },
    policyLoader: noWindow,
  });
  assert.equal(run.verdict.action, 'send');
  assert.equal(
    run.rendered.body,
    'דנה, מועד הסיור השתנה מ-10/08/2026 בשעה 10:00 ל-12/08/2026 בשעה 14:00. מועד חדש: 12/08/2026 14:00',
  );
});
