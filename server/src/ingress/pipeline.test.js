import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, seedContact, seedOpenDeal } from './testDb.js';
import { ingest, receiveEvent, processEvent, retryDelayMs, MAX_ATTEMPTS } from './pipeline.js';
import { buildEvent } from './contract.js';

const leadEvent = (over = {}) =>
  buildEvent({
    kind: 'lead',
    source: 'website_form',
    sourceKey: 'contact_page',
    person: { fullName: 'דור כהן', phone: '050-123-4567', email: 'dor@example.com' },
    context: { message: 'מעוניין בסיור', pageUrl: 'https://grafitiyul.co.il/tour?utm_source=facebook&utm_campaign=summer' },
    attributionInput: { url: 'https://grafitiyul.co.il/tour?utm_source=facebook&utm_campaign=summer' },
    ...over,
  });

const raw = { any: 'payload' };

test('pipeline: a new lead creates exactly one contact and one deal', async () => {
  const db = createTestDb();
  const r = await ingest(
    { source: 'website_form', sourceKey: 'contact_page', rawPayload: raw, canonicalEvent: leadEvent() },
    db,
  );
  assert.equal(r.status, 'processed');
  assert.equal(r.outcome, 'created_deal');
  assert.equal(db._tables.contact.length, 1);
  assert.equal(db._tables.deal.length, 1);
  assert.equal(db._tables.dealContact.length, 1);

  const deal = db._tables.deal[0];
  assert.equal(deal.status, 'open');
  assert.match(deal.title, /דור כהן/);
  // Attribution reached the deal's human-readable source line.
  assert.match(deal.source, /Meta/);
  assert.match(deal.source, /summer/);
});

test('pipeline: the raw payload is persisted before processing', async () => {
  const db = createTestDb();
  await ingest({ source: 'website_form', rawPayload: raw, canonicalEvent: leadEvent() }, db);
  const ev = db._tables.ingressEvent[0];
  assert.deepEqual(ev.rawPayload, raw);
  assert.ok(ev.normalized, 'normalized form stored for observability');
  assert.equal(ev.attribution.utmSource, 'facebook');
  assert.equal(ev.dedupeKey, 'p:972501234567');
});

test('pipeline: intake note and history entry are both written', async () => {
  const db = createTestDb();
  await ingest({ source: 'website_form', rawPayload: raw, canonicalEvent: leadEvent() }, db);
  const kinds = db._tables.timelineEntry.map((t) => t.kind);
  assert.ok(kinds.includes('note'), 'pinned operational note');
  assert.ok(kinds.includes('change'), 'immutable history event');
  const note = db._tables.timelineEntry.find((t) => t.kind === 'note');
  assert.equal(note.isPinned, true);
  assert.equal(note.isSystem, false, 'operational note stays editable');
  assert.match(note.body, /מעוניין בסיור/);
});

test('idempotency: the same delivery twice produces one deal', async () => {
  const db = createTestDb();
  const args = { source: 'meta_lead_ads', externalId: 'lead_123', rawPayload: raw, canonicalEvent: leadEvent() };
  const first = await ingest(args, db);
  const second = await ingest(args, db);
  assert.equal(first.status, 'processed');
  assert.equal(second.status, 'duplicate');
  assert.equal(db._tables.deal.length, 1);
  assert.equal(db._tables.ingressEvent.length, 1);
});

test('idempotency: a concurrent unique-constraint race is reported as duplicate, not an error', async () => {
  const db = createTestDb();
  const args = { source: 'meta_lead_ads', externalId: 'lead_race', rawPayload: raw };
  await receiveEvent(args, db);
  const again = await receiveEvent(args, db);
  assert.equal(again.duplicate, true);
});

test('dedupe: a repeat lead inside the window annotates the open deal instead of duplicating', async () => {
  const db = createTestDb();
  const contactId = seedContact(db, { phone: '050-123-4567', email: 'dor@example.com' });
  const dealId = seedOpenDeal(db, contactId);

  const r = await ingest(
    { source: 'website_form', externalId: 'x1', rawPayload: raw, canonicalEvent: leadEvent() },
    db,
  );
  assert.equal(r.outcome, 'annotated_deal');
  assert.equal(r.dealId, dealId);
  assert.equal(db._tables.deal.length, 1, 'no second deal created');
  assert.equal(db._tables.contact.length, 1, 'no duplicate contact created');
  const note = db._tables.timelineEntry.find((t) => /פנייה נוספת/.test(t.body || ''));
  assert.ok(note, 'repeat-contact note written on the existing deal');
});

test('dedupe: an old closed deal does not suppress a genuinely new lead', async () => {
  const db = createTestDb();
  const contactId = seedContact(db, { phone: '050-123-4567' });
  seedOpenDeal(db, contactId, { status: 'won' }); // not open → not a live conversation

  const r = await ingest({ source: 'website_form', externalId: 'x2', rawPayload: raw, canonicalEvent: leadEvent() }, db);
  assert.equal(r.outcome, 'created_deal');
  assert.equal(db._tables.deal.length, 2);
  assert.equal(db._tables.contact.length, 1, 'existing contact reused');
});

test('dedupe: a deal older than the window does not suppress a new lead', async () => {
  const db = createTestDb();
  const contactId = seedContact(db, { phone: '050-123-4567' });
  seedOpenDeal(db, contactId, { createdAt: new Date(Date.now() - 90 * 24 * 3600 * 1000) });

  const r = await ingest({ source: 'website_form', externalId: 'x3', rawPayload: raw, canonicalEvent: leadEvent() }, db);
  assert.equal(r.outcome, 'created_deal');
});

test('dedupe: orders are never suppressed even with an open deal', async () => {
  const db = createTestDb();
  const contactId = seedContact(db, { phone: '050-123-4567' });
  seedOpenDeal(db, contactId);

  const order = leadEvent({
    kind: 'order',
    source: 'woocommerce',
    sourceKey: 'primary',
    order: { total: '480.00', items: [{ name: 'סיור', externalId: '6031', quantity: 2 }] },
  });
  const r = await ingest({ source: 'woocommerce', sourceKey: 'primary', externalId: '1001', rawPayload: raw, canonicalEvent: order }, db);
  assert.equal(r.outcome, 'created_deal');
  const deal = db._tables.deal.find((d) => d.valueMinor);
  assert.equal(deal.valueMinor, 48000n, 'money stored as minor units');
});

test('existing contact is enriched with a channel it did not have', async () => {
  const db = createTestDb();
  const contactId = seedContact(db, { phone: '050-123-4567' }); // no email on file
  await ingest({ source: 'website_form', externalId: 'x4', rawPayload: raw, canonicalEvent: leadEvent() }, db);
  const emails = db._tables.contactEmail.filter((e) => e.contactId === contactId);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].value, 'dor@example.com');
  // The existing phone is NOT duplicated or rewritten.
  assert.equal(db._tables.contactPhone.filter((p) => p.contactId === contactId).length, 1);
  assert.equal(db._tables.contactPhone[0].value, '050-123-4567', 'stored phone left exactly as typed');
});

test('dry-run: every decision is made and recorded, nothing is written', async () => {
  const db = createTestDb();
  const r = await ingest(
    { source: 'website_form', externalId: 'dry1', rawPayload: raw, canonicalEvent: leadEvent(), dryRun: true },
    db,
  );
  assert.equal(r.status, 'dry_run');
  assert.equal(r.decision.action, 'create');
  assert.equal(db._tables.deal.length, 0, 'no deal');
  assert.equal(db._tables.contact.length, 0, 'no contact');
  assert.equal(db._tables.timelineEntry.length, 0, 'no notes');

  const ev = db._tables.ingressEvent[0];
  assert.equal(ev.status, 'dry_run');
  assert.equal(ev.outcome, 'would_create_deal');
  assert.ok(ev.normalized, 'full normalized payload still recorded for comparison');
});

test('dry-run against an existing contact reports the annotate decision without writing', async () => {
  const db = createTestDb();
  const contactId = seedContact(db, { phone: '050-123-4567' });
  const dealId = seedOpenDeal(db, contactId);
  const r = await ingest(
    { source: 'website_form', externalId: 'dry2', rawPayload: raw, canonicalEvent: leadEvent(), dryRun: true },
    db,
  );
  assert.equal(r.decision.action, 'annotate');
  assert.equal(r.dealId, dealId);
  assert.equal(db._tables.timelineEntry.length, 0);
});

test('failure: a lead with no phone and no email fails permanently and does not retry', async () => {
  const db = createTestDb();
  const bad = leadEvent({ person: { fullName: 'אלמוני' } });
  const r = await ingest({ source: 'website_form', externalId: 'bad1', rawPayload: raw, canonicalEvent: bad }, db);
  assert.equal(r.status, 'failed');
  assert.equal(r.failureCode, 'no_usable_identity');
  assert.equal(r.retryable, false);
  const ev = db._tables.ingressEvent[0];
  assert.equal(ev.nextRetryAt, null, 'permanent failure schedules no retry');
  assert.equal(db._tables.deal.length, 0);
});

test('failure: a missing canonical event is a permanent contract failure', async () => {
  const db = createTestDb();
  const r = await ingest({ source: 'website_form', externalId: 'bad2', rawPayload: raw, canonicalEvent: null }, db);
  assert.equal(r.status, 'failed');
  assert.equal(r.failureCode, 'canonical_event_missing');
});

test('failure: a transient fault schedules a retry with backoff', async () => {
  const db = createTestDb();
  const { event } = await receiveEvent({ source: 'website_form', externalId: 'boom', rawPayload: raw }, db);
  // Force a transient fault inside the persist stage.
  db.deal.create = async () => {
    throw new Error('connection reset');
  };
  const r = await processEvent(event.id, { db, canonicalEvent: leadEvent() });
  assert.equal(r.status, 'pending');
  assert.equal(r.failureCode, 'internal_error');
  assert.equal(r.retryable, true);
  const ev = db._tables.ingressEvent[0];
  assert.equal(ev.attemptCount, 1);
  assert.ok(ev.nextRetryAt instanceof Date, 'retry scheduled');
  const att = db._tables.ingressAttempt[0];
  assert.equal(att.status, 'failed');
  assert.equal(att.stage, 'persist');
});

test('failure: retries are exhausted into a dead state for human review', async () => {
  const db = createTestDb();
  const { event } = await receiveEvent({ source: 'website_form', externalId: 'dead', rawPayload: raw }, db);
  db._tables.ingressEvent[0].attemptCount = MAX_ATTEMPTS - 1;
  db.deal.create = async () => {
    throw new Error('still broken');
  };
  const r = await processEvent(event.id, { db, canonicalEvent: leadEvent() });
  assert.equal(r.status, 'dead');
  assert.equal(db._tables.ingressEvent[0].nextRetryAt, null);
});

test('retry backoff grows exponentially and is capped at one hour', () => {
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(2), 120_000);
  assert.equal(retryDelayMs(3), 240_000);
  assert.equal(retryDelayMs(20), 3_600_000);
});

test('reprocessing an already-processed event is a no-op', async () => {
  const db = createTestDb();
  const r1 = await ingest({ source: 'website_form', externalId: 'once', rawPayload: raw, canonicalEvent: leadEvent() }, db);
  const evId = db._tables.ingressEvent[0].id;
  const r2 = await processEvent(evId, { db, canonicalEvent: leadEvent() });
  assert.equal(r2.skipped, true);
  assert.equal(r2.dealId, r1.dealId);
  assert.equal(db._tables.deal.length, 1);
});

test('ambiguous phone ownership attaches to one contact and flags it loudly', async () => {
  const db = createTestDb();
  seedContact(db, { firstName: 'א', phone: '050-123-4567' });
  seedContact(db, { firstName: 'ב', phone: '0501234567' }); // same number, different spelling
  const r = await ingest({ source: 'website_form', externalId: 'amb', rawPayload: raw, canonicalEvent: leadEvent() }, db);
  assert.equal(r.status, 'processed');
  assert.equal(db._tables.contact.length, 2, 'no third contact invented');
  const note = db._tables.timelineEntry.find((t) => /יותר מאיש קשר אחד/.test(t.body || ''));
  assert.ok(note, 'ambiguity surfaced on the deal for a human to resolve');
});

test('organization is matched but never created from an inbound lead', async () => {
  const db = createTestDb({ organizations: [{ id: 'org1', name: 'חברת בדיקה' }] });
  const withOrg = leadEvent({ organization: { name: 'חברת בדיקה' } });
  const r = await ingest({ source: 'website_form', externalId: 'org1', rawPayload: raw, canonicalEvent: withOrg }, db);
  assert.equal(r.organizationId, 'org1');
  assert.equal(db._tables.deal[0].activityType, 'business', 'linked org forces business classification');

  const db2 = createTestDb();
  const unknown = leadEvent({ organization: { name: 'לא קיים בע"מ' } });
  const r2 = await ingest({ source: 'website_form', externalId: 'org2', rawPayload: raw, canonicalEvent: unknown }, db2);
  assert.equal(r2.organizationId, null);
  assert.equal(db2._tables.organization.length, 0, 'no organization minted from a web form');
});

test('the deal source catalogue entry is created once and then reused', async () => {
  const db = createTestDb();
  await ingest({ source: 'website_form', externalId: 'a', rawPayload: raw, canonicalEvent: leadEvent() }, db);
  await ingest({ source: 'website_form', externalId: 'b', rawPayload: raw, canonicalEvent: leadEvent({ person: { fullName: 'אחר', phone: '0529999999' } }) }, db);
  assert.equal(db._tables.dealSource.length, 1);
  assert.equal(db._tables.dealSource[0].label, 'טופס באתר');
});
