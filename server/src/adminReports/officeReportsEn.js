// English renderers for the office reports (#1–#10).
//
// ── Why they live in a separate file ────────────────────────────────────────
// registry.js already carries ten definitions with their Hebrew renderers,
// samples and trigger documentation. Interleaving a second renderer into each
// would have doubled the length of the file that is hardest to scan. These are
// attached to their definitions at the bottom of registry.js, so each report is
// still ONE object with two renderers — the bilingual guard proves it.
//
// The contract is exactly the one #11–#24 already follow: same context, same
// facts, same order, same icons. Only the words differ. `bilingual.test.js`
// fails if either language shows a fact the other does not.
//
// Note what stays Hebrew: business DATA (customer names, product names,
// organisations). Those records have no English field, so an English report
// shows an English frame around Hebrew values. That is honest — inventing a
// transliteration would be worse than showing the real name.

import { formatDateHe, formatMoney } from '../communication/format.js';
import { contactFullName } from '../communication/context.js';
import { adminDisplayName } from '../admin/displayName.js';
import { wonActorLabel } from '../deals/wonActor.js';
import { COORDINATION_MONITOR_DAYS } from './coordination.js';

const lines = (arr) => arr.filter((l) => l !== null && l !== undefined).join('\n');

/** "Name - Organization", or just the name — the English twin of customerLine. */
function customerLineEn(ctx) {
  const name = contactFullName(ctx.contact) || null;
  const org = ctx.org?.name || null;
  if (name && org) return `${name} - ${org}`;
  return name || org || '—';
}

const dealLinkEn = (ctx) =>
  (ctx.deal?.orderNo != null && ctx.links?.origin
    ? `${ctx.links.origin}/admin/crm/deals/${ctx.deal.orderNo}`
    : '—');

const ownerNameEn = (ctx) => (ctx.owner ? adminDisplayName(ctx.owner) || '—' : '—');
const tourDateEn = (ctx) => formatDateHe(ctx.tour?.date || ctx.deal?.tourDate) || '—';
const tourTimeEn = (ctx) => ctx.tour?.startTime || ctx.deal?.tourTime || '';
const partyLabelEn = (i) => [i.customerName, i.orgName].filter(Boolean).join(' - ') || '—';
const tourPageEn = (ctx, id) => (ctx.links?.origin && id ? `${ctx.links.origin}/admin/tours/${id}` : null);

export const OFFICE_REPORTS_EN = {
  1: (ctx) => lines([
    '💳 A customer added a payment 💳',
    '',
    customerLineEn(ctx),
    '',
    `Amount paid: ${formatMoney(ctx.payment?.completedAmountMinor, ctx.payment?.currency) || '—'}`,
    `Activity date: ${tourDateEn(ctx)} ${tourTimeEn(ctx)}`.trim(),
    '',
    // Same frozen wonActor as the Hebrew line — one resolver, two languages.
    `Owner: ${wonActorLabel(ctx.deal?.wonActor, 'en')}`,
    `Deal: ${dealLinkEn(ctx)}`,
  ]),

  2: (ctx) => {
    const q = ctx.quoteReport || {};
    const totalMinor = q.totalMinor != null
      ? q.totalMinor
      : (q.isPrimary ? ctx.deal?.valueMinor ?? null : null);
    const currency = q.currency || ctx.deal?.currency || 'ILS';
    return lines([
      '🆕 A new quote 🆕',
      '',
      `Customer: ${customerLineEn(ctx)}`,
      `Date: ${tourDateEn(ctx)}`,
      `Time: ${tourTimeEn(ctx) || '—'}`,
      `Activity: ${ctx.tour?.product?.nameHe || ctx.deal?.product?.nameHe || '—'}`,
      `Location: ${ctx.tour?.location?.nameHe || ctx.deal?.location?.nameHe || '—'}`,
      `Participants: ${ctx.deal?.participants ?? '—'}`,
      `Amount: ${formatMoney(totalMinor, currency) || '—'}`,
      `Offer type: ${q.isPrimary === true ? 'primary' : q.isPrimary === false ? 'parallel' : '—'}`,
      `Owner: ${ownerNameEn(ctx)}`,
      `Deal: ${dealLinkEn(ctx)}`,
      `Quote: ${q.publicToken && ctx.links?.origin ? `${ctx.links.origin}/quote/${q.publicToken}` : '—'}`,
    ]);
  },

  3: (ctx) => {
    const c = ctx.changeReport || {};
    const stamp = (d, t) => [formatDateHe(d) || null, t || null].filter(Boolean).join(', ') || '—';
    return lines([
      '⌚ Tour date or time changed ⌚',
      '',
      customerLineEn(ctx),
      `Previous: ${stamp(c.prevDate, c.prevTime)}`,
      `New: ${stamp(c.newDate, c.newTime)}`,
      '',
      `Changed by: ${c.actor ? adminDisplayName(c.actor) || '—' : '—'}`,
      `Deal: ${dealLinkEn(ctx)}`,
    ]);
  },

  4: (ctx) => {
    const c = ctx.coordinationReport || {};
    return lines([
      '✅ Coordination call done on time ✅',
      '',
      `Guide: ${c.guideName || '—'}`,
      `Customer: ${customerLineEn(ctx)}`,
      `Tour: ${[c.productName, c.cityName].filter(Boolean).join(' - ') || '—'}`,
      `Tour date: ${formatDateHe(c.tourDate) || '—'} ${c.tourTime || ''}`.trim(),
      `Participants: ${c.participants ?? '—'}`,
      '',
      `Form: ${tourPageEn(ctx, c.tourEventId) || '—'}`,
      `Deal: ${dealLinkEn(ctx)}`,
    ]);
  },

  5: (ctx) => {
    const c = ctx.coordinationReport || {};
    return lines([
      '⛔ Coordination call done late ⛔',
      '',
      `Guide: ${c.guideName || '—'}`,
      `Customer: ${customerLineEn(ctx)}`,
      `Tour: ${[c.productName, c.cityName].filter(Boolean).join(' - ') || '—'}`,
      `Tour date: ${formatDateHe(c.tourDate) || '—'} ${c.tourTime || ''}`.trim(),
      `Participants: ${c.participants ?? '—'}`,
      `Late by: ${c.latenessLabel || '—'}`,
      '',
      `Form: ${tourPageEn(ctx, c.tourEventId) || '—'}`,
      `Deal: ${dealLinkEn(ctx)}`,
    ]);
  },

  6: (ctx) => {
    const items = ctx.aggregate?.items || [];
    const icon = { overdue: '⛔', open: '⌛', done: '✅' };
    return lines([
      `📞 Coordination calls for the next ${COORDINATION_MONITOR_DAYS} days 📞`,
      '',
      ...items.map((i) => {
        const late = i.status === 'done' && i.wasLate ? ' (late)' : '';
        return `${icon[i.status] || '⌛'} ${i.guideName || '—'} - ${partyLabelEn(i)} - ${i.participants ?? '—'}${late}`;
      }),
    ]);
  },

  7: (ctx) => {
    const items = ctx.aggregate?.items || [];
    return lines([
      '📝 Tour summaries not submitted 📝',
      '',
      ...items.map((i) =>
        `⛔ ${i.guideName || '—'} - ${i.productName || '—'} - ${partyLabelEn(i)} - ${formatDateHe(i.tourDate) || '—'} ${i.tourTime || ''}`.trim()),
    ]);
  },

  8: (ctx) => {
    const s = ctx.summaryReport || {};
    return lines([
      '📝 A tour summary was not submitted 📝',
      '',
      `Guide: ${s.guideName || '—'}`,
      `Customer: ${customerLineEn(ctx)}`,
      `Tour: ${[s.productName, s.cityName].filter(Boolean).join(' - ') || '—'}`,
      `Tour date: ${formatDateHe(s.tourDate) || '—'} ${s.tourTime || ''}`.trim(),
      '',
      'Thanks,',
      'Grafibot',
    ]);
  },

  9: (ctx) => {
    const q = ctx.signedQuote || {};
    return lines([
      '✍️ A quote was signed ✍️',
      '',
      `Customer: ${contactFullName(ctx.contact) || '—'}`,
      `Organization: ${ctx.org?.name || '—'}`,
      `Tour date: ${formatDateHe(q.tourDate) || '—'} ${q.tourTime || ''}`.trim(),
      `Product: ${q.productName || '—'}`,
      `Amount: ${formatMoney(q.totalMinor, 'ILS') || '—'}`,
      '',
      'To approve:',
      dealLinkEn(ctx),
    ]);
  },

  10: (ctx) => {
    const a = ctx.agentOrder || {};
    const groups = a.groups || [];
    const head = [
      '📥 A new agent order 📥',
      '',
      `Agent: ${contactFullName(ctx.contact) || '—'}`,
      `Organization: ${ctx.org?.name || '—'}`,
      `Order number: ${a.orderNo ?? '—'}`,
    ];
    const link = (g) =>
      (ctx.links?.origin && g.dealOrderNo != null
        ? `${ctx.links.origin}/admin/crm/deals/${g.dealOrderNo}`
        : '—');

    // Same shape rule as the Hebrew: one group reads as a full block, several
    // read as a list plus the order total.
    if (groups.length === 1) {
      const g = groups[0];
      return lines([
        ...head,
        `Activity date: ${formatDateHe(g.tourDate) || '—'} ${g.tourTime || ''}`.trim(),
        `Product: ${g.productName || '—'}`,
        `Participants: ${g.participants ?? '—'}`,
        `Order amount: ${formatMoney(g.totalMinor, 'ILS') || '—'}`,
        '',
        `Deal: ${link(g)}`,
      ]);
    }
    return lines([
      ...head,
      '',
      ...groups.map((g) => `• ${formatDateHe(g.tourDate) || '—'} ${g.tourTime || ''} · ${g.productName || '—'} · ${g.participants ?? '—'} · ${formatMoney(g.totalMinor, 'ILS') || '—'} · ${link(g)}`.trim()),
      '',
      `Order total: ${formatMoney(a.totalMinor, 'ILS') || '—'}`,
    ]);
  },
};

/** English names, so the bilingual guard can see the claim. */
export const OFFICE_REPORT_NAMES_EN = {
  1: 'A customer paid through a payment link',
  2: 'A quote was produced',
  3: 'Tour date or time changed',
  4: 'Coordination call done on time',
  5: 'Coordination call done late',
  6: `Coordination-call monitor for the next ${COORDINATION_MONITOR_DAYS} days`,
  7: 'Tour summaries missing from the last 7 days',
  8: "Yesterday's tour summaries that were not submitted",
  9: 'A quote was signed',
  10: 'A new agent order',
};
