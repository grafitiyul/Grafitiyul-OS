// Test-data purge — the owner-approved business rule.
//
//     Every GOS Deal whose orderNo is >= 27000 is test/fake data.
//
// This supersedes the evidence classifier in resetManifest.js, which was
// deliberately narrow (QA naming, signer identity, reservation evidence) and
// therefore missed test deals that simply did not look like tests. The rule here
// is structural, not inferential: the 27000 sequence is where GOS-native
// numbering starts, so every record in it was created during system testing.
// Names do not exempt a record; order numbers decide.
//
// What the rule does NOT do is delete anything shared. The whole difficulty is
// that a test deal can hang off a parent that also supports a real deal, and a
// naive cascade would take the real one with it. Every parent is therefore
// checked for surviving children before it is touched:
//
//   * a ReservationSession that also created a deal below 27000 → RETAINED
//   * a TourEvent with a booking or registration from a surviving deal → RETAINED
//   * a Contact/Organization with any surviving relationship → RETAINED
//   * an EmailThread → never deleted; its deal link is nulled (real correspondence)
//
// Deletion order respects the schema's RESTRICT constraints
// (Booking.dealId, Booking.tourEventId, TicketRegistration.tourEventId), which a
// plain `DELETE FROM Deal` would violate.

import crypto from 'node:crypto';

export const TEST_ORDER_FLOOR = 27000;

/** Deletion order, derived from the live FK graph. Order is load-bearing. */
export const PURGE_ORDER = Object.freeze([
  'TicketRegistration', 'Booking', 'PayrollEntry', 'PayrollActivity',
  'TourEvent', 'Deal', 'TimelineEntry', 'ReservationSession', 'Contact', 'Organization',
]);

/**
 * Build the complete purge plan. READ-ONLY.
 */
export async function buildPurgePlan(db, { floor = TEST_ORDER_FLOOR } = {}) {
  const q = (sql, ...a) => db.$queryRawUnsafe(sql, ...a);
  const num = (v) => (typeof v === 'bigint' ? Number(v) : v);

  const deals = (await q(`
    SELECT d.id, d."orderNo", d.title, d.status, d."valueMinor"::text AS "valueMinor",
           EXISTS (SELECT 1 FROM "LegacyRecord" l WHERE l."entityType"='Deal' AND l."entityId"=d.id) AS crosswalked
    FROM "Deal" d WHERE d."orderNo" >= $1 ORDER BY d."orderNo"`, floor))
    .map((d) => ({ ...d, orderNo: num(d.orderNo) }));

  const dealIds = deals.map((d) => d.id);

  // A crosswalked deal in the test range would mean the rule collides with real
  // migrated data. It cannot happen (imported ids are all < 27000) — but if it
  // ever did, deleting would destroy migrated history, so it is a hard stop.
  const crosswalked = deals.filter((d) => d.crosswalked);

  if (!dealIds.length) {
    return { floor, deals: [], dealIds: [], crosswalked, tours: [], sessions: [], contacts: [], organizations: [], dependents: {}, retained: [], planHash: planHash([], [], [], [], []) };
  }

  // ── tours reachable from the test deals ────────────────────────────────────
  const tours = (await q(`
    SELECT t.id, t.date::date AS date, t.status, t."gcalEventId",
      EXISTS (SELECT 1 FROM "LegacyRecord" l WHERE l."entityType"='TourEvent' AND l."entityId"=t.id) AS crosswalked,
      (SELECT count(*)::int FROM "Booking" b2 WHERE b2."tourEventId"=t.id AND NOT (b2."dealId" = ANY($1::text[]))) AS other_bookings,
      (SELECT count(*)::int FROM "TicketRegistration" r2 WHERE r2."tourEventId"=t.id
         AND (r2."dealId" IS NULL OR NOT (r2."dealId" = ANY($1::text[])))) AS other_regs
    FROM "TourEvent" t
    WHERE EXISTS (SELECT 1 FROM "Booking" b WHERE b."tourEventId"=t.id AND b."dealId" = ANY($1::text[]))
       OR EXISTS (SELECT 1 FROM "TicketRegistration" r WHERE r."tourEventId"=t.id AND r."dealId" = ANY($1::text[]))
    ORDER BY t.date`, dealIds)).map((t) => ({ ...t, other_bookings: num(t.other_bookings), other_regs: num(t.other_regs) }));

  const retained = [];
  const deletableTours = [];
  for (const t of tours) {
    if (t.crosswalked) { retained.push({ kind: 'TourEvent', id: t.id, reason: 'legacy-migrated tour — never deleted by this rule' }); continue; }
    if (t.other_bookings > 0 || t.other_regs > 0) {
      retained.push({ kind: 'TourEvent', id: t.id, reason: `shared: ${t.other_bookings} booking(s) / ${t.other_regs} registration(s) from surviving deals` });
      continue;
    }
    deletableTours.push(t);
  }
  const tourIds = deletableTours.map((t) => t.id);

  // ── reservation sessions ───────────────────────────────────────────────────
  const sessionRows = (await q(`
    SELECT s.id, s."sessionNo",
      count(*) FILTER (WHERE g."createdDealId" = ANY($1::text[]))::int AS test_deals,
      count(*) FILTER (WHERE g."createdDealId" IS NOT NULL AND NOT (g."createdDealId" = ANY($1::text[])))::int AS other_deals
    FROM "ReservationSession" s
    LEFT JOIN "ReservationGroup" g ON g."sessionId" = s.id
    GROUP BY 1,2 HAVING count(*) FILTER (WHERE g."createdDealId" = ANY($1::text[])) > 0
    ORDER BY s."sessionNo"`, dealIds)).map((s) => ({ ...s, sessionNo: num(s.sessionNo), test_deals: num(s.test_deals), other_deals: num(s.other_deals) }));

  const sessions = [];
  for (const s of sessionRows) {
    if (s.other_deals > 0) {
      retained.push({ kind: 'ReservationSession', id: s.id, reason: `shared: also created ${s.other_deals} surviving deal(s) — its signed document must survive` });
    } else sessions.push(s);
  }

  // ── contacts exclusive to the test deals ───────────────────────────────────
  const contactRows = (await q(`
    SELECT c.id, c."contactNo", trim(coalesce(c."firstNameHe",'')||' '||coalesce(c."lastNameHe",'')) AS name,
      EXISTS (SELECT 1 FROM "LegacyRecord" l WHERE l."entityType"='Contact' AND l."entityId"=c.id) AS crosswalked,
      (SELECT count(*)::int FROM "DealContact" dc WHERE dc."contactId"=c.id AND NOT (dc."dealId" = ANY($1::text[]))) AS other_deals,
      (SELECT count(*)::int FROM "WhatsAppChat" w WHERE w."contactId"=c.id) AS wa,
      (SELECT count(*)::int FROM "ReservationSession" s WHERE s."contactId"=c.id
         AND NOT EXISTS (SELECT 1 FROM "ReservationGroup" g WHERE g."sessionId"=s.id AND g."createdDealId" = ANY($1::text[]))) AS other_resv,
      (SELECT count(*)::int FROM "EmailThread" e WHERE e."linkedDealId" IS NOT NULL
         AND NOT (e."linkedDealId" = ANY($1::text[]))
         AND EXISTS (SELECT 1 FROM "DealContact" dc2 WHERE dc2."contactId"=c.id AND dc2."dealId"=e."linkedDealId")) AS other_email
    FROM "Contact" c
    WHERE EXISTS (SELECT 1 FROM "DealContact" dc WHERE dc."contactId"=c.id AND dc."dealId" = ANY($1::text[]))
    ORDER BY c."contactNo"`, dealIds)).map((c) => ({
      ...c, contactNo: num(c.contactNo), other_deals: num(c.other_deals),
      wa: num(c.wa), other_resv: num(c.other_resv), other_email: num(c.other_email),
    }));

  const contacts = [];
  for (const c of contactRows) {
    const why = c.crosswalked ? 'legacy-migrated contact'
      : c.other_deals > 0 ? `linked to ${c.other_deals} surviving deal(s)`
      : c.wa > 0 ? `has ${c.wa} WhatsApp conversation(s)`
      : c.other_resv > 0 ? 'has an unrelated reservation'
      : c.other_email > 0 ? 'has unrelated email correspondence'
      : null;
    if (why) retained.push({ kind: 'Contact', id: c.id, label: c.name, reason: why });
    else contacts.push(c);
  }

  // ── organizations exclusive to the test deals ──────────────────────────────
  const orgRows = (await q(`
    SELECT o.id, o."orgNo", o.name,
      EXISTS (SELECT 1 FROM "LegacyRecord" l WHERE l."entityType"='Organization' AND l."entityId"=o.id) AS crosswalked,
      (SELECT count(*)::int FROM "Deal" d WHERE d."organizationId"=o.id AND NOT (d.id = ANY($1::text[]))) AS other_deals,
      (SELECT count(*)::int FROM "ContactOrganization" co WHERE co."organizationId"=o.id
         AND NOT (co."contactId" = ANY($2::text[]))) AS other_contacts,
      (SELECT count(*)::int FROM "ReservationSession" s WHERE s."organizationId"=o.id
         AND NOT (s.id = ANY($3::text[]))) AS other_resv
    FROM "Organization" o
    WHERE EXISTS (SELECT 1 FROM "Deal" d WHERE d."organizationId"=o.id AND d.id = ANY($1::text[]))
       OR EXISTS (SELECT 1 FROM "ReservationSession" s JOIN "ReservationGroup" g ON g."sessionId"=s.id
                  WHERE s."organizationId"=o.id AND g."createdDealId" = ANY($1::text[]))
    ORDER BY o.name`, dealIds, contacts.map((c) => c.id), sessions.map((s) => s.id)))
    .map((o) => ({ ...o, orgNo: num(o.orgNo), other_deals: num(o.other_deals), other_contacts: num(o.other_contacts), other_resv: num(o.other_resv) }));

  const organizations = [];
  for (const o of orgRows) {
    const why = o.crosswalked ? 'legacy-migrated organization'
      : o.other_deals > 0 ? `linked to ${o.other_deals} surviving deal(s)`
      : o.other_contacts > 0 ? `has ${o.other_contacts} surviving contact link(s)`
      : o.other_resv > 0 ? 'has an unrelated reservation'
      : null;
    if (why) retained.push({ kind: 'Organization', id: o.id, label: o.name, reason: why });
    else organizations.push(o);
  }

  // ── dependent counts, for the report and the audit export ──────────────────
  const count = async (table, col, ids) => {
    if (!ids.length) return 0;
    try { return num((await q(`SELECT count(*)::int AS n FROM "${table}" WHERE "${col}" = ANY($1::text[])`, ids))[0].n); }
    catch { return null; }
  };
  const dependents = {
    DealContact: await count('DealContact', 'dealId', dealIds),
    QuoteVersion: await count('QuoteVersion', 'dealId', dealIds),
    QuoteOffer: await count('QuoteOffer', 'dealId', dealIds),
    QuoteDocument: await count('QuoteDocument', 'dealId', dealIds),
    IcountDocument: await count('IcountDocument', 'dealId', dealIds),
    PaymentRequest: await count('PaymentRequest', 'dealId', dealIds),
    DealPaymentLink: await count('DealPaymentLink', 'dealId', dealIds),
    DealCustomPaymentLink: await count('DealCustomPaymentLink', 'dealId', dealIds),
    DealFile: await count('DealFile', 'dealId', dealIds),
    DealTourPlan: await count('DealTourPlan', 'dealId', dealIds),
    DealMarketing: await count('DealMarketing', 'dealId', dealIds),
    Task: await count('Task', 'dealId', dealIds),
    Booking: await count('Booking', 'dealId', dealIds),
    TicketRegistration: await count('TicketRegistration', 'dealId', dealIds),
    TourAssignment: await count('TourAssignment', 'tourEventId', tourIds),
    TourGallery: await count('TourGallery', 'tourEventId', tourIds),
    TourEventActivityComponent: await count('TourEventActivityComponent', 'tourEventId', tourIds),
    PayrollActivity: await count('PayrollActivity', 'tourEventId', tourIds),
    TimelineEntry: num((await q(
      `SELECT count(*)::int AS n FROM "TimelineEntry" WHERE "subjectType"='deal' AND "subjectId" = ANY($1::text[])`, dealIds))[0].n),
    EmailThread_unlinked: await count('EmailThread', 'linkedDealId', dealIds),
  };

  // External artefacts that survive OUTSIDE GOS and must be reported, never
  // silently forgotten: accounting documents live in iCount, calendar events
  // live in Google. Deleting the GOS row does not remove them.
  const external = {
    icountDocuments: (await q(`SELECT d."orderNo", i.doctype, i.docnum, i."amountMinor"::text AS amount
      FROM "IcountDocument" i JOIN "Deal" d ON d.id=i."dealId" WHERE i."dealId" = ANY($1::text[])
      ORDER BY d."orderNo", i.docnum`, dealIds)).map((r) => ({ ...r, orderNo: num(r.orderNo), docnum: num(r.docnum) })),
    googleCalendarEvents: deletableTours.filter((t) => t.gcalEventId).map((t) => ({ tourId: t.id, date: t.date, gcalEventId: t.gcalEventId })),
  };

  return {
    floor,
    deals, dealIds, crosswalked,
    tours: deletableTours, tourIds,
    sessions, contacts, organizations,
    dependents, external, retained,
    planHash: planHash(dealIds, tourIds, sessions.map((s) => s.id), contacts.map((c) => c.id), organizations.map((o) => o.id)),
  };
}

/** Content identity of the plan: the ordered set of primary rows to delete. */
export function planHash(dealIds, tourIds, sessionIds, contactIds, orgIds) {
  const lines = [
    ...dealIds.map((i) => `deal:${i}`),
    ...tourIds.map((i) => `tour:${i}`),
    ...sessionIds.map((i) => `session:${i}`),
    ...contactIds.map((i) => `contact:${i}`),
    ...orgIds.map((i) => `org:${i}`),
  ].sort();
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

/**
 * Execute the plan. One transaction, ordered to satisfy every RESTRICT.
 */
export async function executePurge(db, plan, { approvedHash, dryRun = true }) {
  if (plan.crosswalked.length) {
    const e = new Error(
      `crosswalked_deal_in_test_range: ${plan.crosswalked.length} deal(s) at/above ${plan.floor} carry a legacy crosswalk. ` +
      `Deleting them would destroy migrated history.`);
    e.code = 'CROSSWALKED_IN_RANGE';
    throw e;
  }
  if (!approvedHash) {
    const e = new Error('no_approved_hash: the purge plan must be approved by hash');
    e.code = 'NO_APPROVED_HASH';
    throw e;
  }
  if (approvedHash !== plan.planHash) {
    const e = new Error(`plan_changed: approved ${approvedHash} but current plan is ${plan.planHash}`);
    e.code = 'PLAN_CHANGED';
    throw e;
  }

  const result = { dryRun, deleted: {} };
  const { dealIds, tourIds } = plan;
  const sessionIds = plan.sessions.map((s) => s.id);
  const contactIds = plan.contacts.map((c) => c.id);
  const orgIds = plan.organizations.map((o) => o.id);

  if (dryRun) {
    result.deleted = {
      Deal: dealIds.length, TourEvent: tourIds.length, ReservationSession: sessionIds.length,
      Contact: contactIds.length, Organization: orgIds.length,
    };
    return result;
  }

  await db.$transaction(async (tx) => {
    const run = async (label, sql, ...a) => {
      const n = await tx.$executeRawUnsafe(sql, ...a);
      result.deleted[label] = (result.deleted[label] || 0) + n;
    };
    const has = (a) => a && a.length > 0;

    // Real correspondence is NEVER deleted — only its link to a test deal.
    if (has(dealIds)) {
      await run('EmailThread(unlinked)', `UPDATE "EmailThread" SET "linkedDealId" = NULL WHERE "linkedDealId" = ANY($1::text[])`, dealIds);
    }

    // RESTRICT constraints first: registrations and bookings block both Deal and TourEvent.
    if (has(dealIds)) await run('TicketRegistration', `DELETE FROM "TicketRegistration" WHERE "dealId" = ANY($1::text[])`, dealIds);
    if (has(tourIds)) await run('TicketRegistration', `DELETE FROM "TicketRegistration" WHERE "tourEventId" = ANY($1::text[])`, tourIds);
    if (has(dealIds)) await run('Booking', `DELETE FROM "Booking" WHERE "dealId" = ANY($1::text[])`, dealIds);
    if (has(tourIds)) await run('Booking', `DELETE FROM "Booking" WHERE "tourEventId" = ANY($1::text[])`, tourIds);

    // Payroll: entries reference activities, activities reference tours (SET NULL),
    // so both are removed explicitly or the activity would survive detached.
    if (has(tourIds)) {
      await run('PayrollEntry', `DELETE FROM "PayrollEntry" WHERE "activityId" IN
        (SELECT id FROM "PayrollActivity" WHERE "tourEventId" = ANY($1::text[]))`, tourIds);
      await run('PayrollActivity', `DELETE FROM "PayrollActivity" WHERE "tourEventId" = ANY($1::text[])`, tourIds);
    }

    // TourEvent cascades TourAssignment / TourGallery / activity components.
    if (has(tourIds)) await run('TourEvent', `DELETE FROM "TourEvent" WHERE id = ANY($1::text[])`, tourIds);

    // Loose (no-FK) references must be cleared explicitly — a cascade never sees them.
    for (const [table, col] of [
      ['CommunicationDelivery', 'dealId'], ['AdminReportDelivery', 'dealId'],
      ['ScheduledEmail', 'dealId'], ['IcountWebhookLog', 'dealId'],
    ]) {
      if (!has(dealIds)) break;
      try { await run(table, `DELETE FROM "${table}" WHERE "${col}" = ANY($1::text[])`, dealIds); } catch { /* absent in this schema */ }
    }
    if (has(dealIds)) {
      await run('TimelineEntry', `DELETE FROM "TimelineEntry" WHERE "subjectType"='deal' AND "subjectId" = ANY($1::text[])`, dealIds);
    }

    // Deal cascades quotes, documents, payments, tasks, marketing, contacts links.
    if (has(dealIds)) await run('Deal', `DELETE FROM "Deal" WHERE id = ANY($1::text[])`, dealIds);

    // Sessions cascade their groups and their ReservationDocument.
    if (has(sessionIds)) await run('ReservationSession', `DELETE FROM "ReservationSession" WHERE id = ANY($1::text[])`, sessionIds);
    if (has(contactIds)) await run('Contact', `DELETE FROM "Contact" WHERE id = ANY($1::text[])`, contactIds);
    if (has(orgIds)) await run('Organization', `DELETE FROM "Organization" WHERE id = ANY($1::text[])`, orgIds);
  }, { timeout: 180_000, maxWait: 30_000 });

  return result;
}
