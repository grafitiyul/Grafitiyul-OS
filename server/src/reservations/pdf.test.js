import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReservationPdf, paginateGroups } from './pdf.js';
import { looksLikePdf, countPdfPages } from '../services/pdfRender.js';

// Reservation PDF — rendered through the canonical Documents engine. These
// tests verify real output bytes (magic, page math) and the pagination rule
// that keeps the signature/footer block clear on the last page.

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function makeGroup(i, over = {}) {
  return {
    groupName: `קבוצה ${i}`,
    locationLabel: 'חיפה',
    productLabel: 'סיור גרפיטי',
    tourDate: '2026-08-01',
    tourTime: '10:30',
    participants: 40 + i,
    tourLanguage: 'en',
    onSiteContactName: i % 2 ? 'יוסי לוי' : null,
    onSiteContactPhone: i % 2 ? '050-1234567' : null,
    notes: i % 3 ? 'להביא כובעים' : null,
    createdDealOrderNo: i % 2 ? 28100 + i : null,
    ...over,
  };
}

function makeSession(groupCount, over = {}) {
  return {
    sessionNo: 1042,
    language: 'he',
    submittedAt: new Date('2026-07-16T10:00:00Z'),
    signerName: 'דנה כהן',
    signatureMethod: 'drawn',
    signatureBytes: PNG_1PX,
    agentName: 'דנה כהן',
    organizationName: 'סוכנות הצפון',
    groups: Array.from({ length: groupCount }, (_, i) => makeGroup(i + 1)),
    ...over,
  };
}

test('single-group session renders a one-page PDF', async () => {
  const pdf = await buildReservationPdf(makeSession(1));
  assert.ok(looksLikePdf(pdf));
  assert.equal(await countPdfPages(pdf), 1);
});

test('many groups paginate: 4 on the first page, 6 per page after', () => {
  const pages = paginateGroups(Array.from({ length: 17 }, (_, i) => i));
  assert.deepEqual(
    pages.map((p) => p.length),
    [4, 6, 6, 1],
  );
});

test('a 12-group session renders across multiple pages', async () => {
  const pdf = await buildReservationPdf(makeSession(12));
  assert.ok(looksLikePdf(pdf));
  assert.equal(await countPdfPages(pdf), 3); // 4 + 6 + 2
});

test('typed signature (no image bytes) and English language render cleanly', async () => {
  const pdf = await buildReservationPdf(
    makeSession(2, {
      language: 'en',
      signatureMethod: 'typed',
      signatureBytes: null,
      agentName: 'Dana Cohen',
      organizationName: 'North Agency',
    }),
  );
  assert.ok(looksLikePdf(pdf));
  assert.equal(await countPdfPages(pdf), 1);
});

test('renders without optional data (no signature name, no labels, no notes)', async () => {
  const pdf = await buildReservationPdf(
    makeSession(1, {
      signerName: null,
      signatureBytes: null,
      groups: [
        makeGroup(1, {
          locationLabel: null,
          productLabel: null,
          tourLanguage: null,
          onSiteContactName: null,
          onSiteContactPhone: null,
          notes: null,
          createdDealOrderNo: null,
          tourTime: null,
        }),
      ],
    }),
  );
  assert.ok(looksLikePdf(pdf));
});
