// Reset manifest — the deterministic, evidence-based list of what may be removed
// from GOS during the stabilization phase.
//
// The point of this module is that "remove test data" is a DANGEROUS instruction
// when executed on a production database that also contains real customers whose
// names happen to be short, and real internal deals. So nothing here classifies
// anything as removable on a name alone:
//
//   a record is removable ONLY IF
//     (1) it is GOS-native            — no legacy crosswalk, so nothing to mirror
//   AND (2) its identity matches an EXPLICIT test pattern (never a fuzzy guess)
//   AND (3) every real-world-impact probe returns zero.
//
// Any single non-zero impact probe pins the record to `keep` and records WHY,
// even if it is obviously a test record. Money, customer-facing documents, sent
// communications and seat registrations always win over a name match. A false
// "keep" costs one manual decision; a false "delete" costs real business data.
//
// The manifest is content-hashed. The executor refuses to run against a manifest
// whose hash does not match the one the owner approved, so "I approved a list"
// and "this is the list being deleted" are the same statement.

import crypto from 'node:crypto';

// Identity patterns for test/demo records. Deliberately anchored and narrow —
// an unanchored /בדיקה/ would match a real deal titled "בדיקת התאמה ללקוח".
//
// NOTE on \b: JavaScript's word boundary is ASCII-only, so it never fires after
// a Hebrew letter. The Hebrew patterns therefore use an explicit
// "not followed by another letter" lookahead (\p{L}) instead — which is what \b
// was meant to express and, unlike \b, actually works here.
export const TEST_PATTERNS = Object.freeze([
  { name: 'bedika_numbered', re: /^בדיקה\s*\d*$/u },
  { name: 'bedikat_maarechet', re: /^בדיקת\s+מערכת(?!\p{L})/u },
  { name: 'qa_prefix', re: /^QA(?!\p{L})/u },
  { name: 'test_word', re: /^(test|testing)\b/iu },
  { name: 'demo_word', re: /^demo\b/iu },
]);

export function matchTestPattern(title) {
  const s = String(title ?? '').trim();
  if (!s) return null;
  for (const p of TEST_PATTERNS) if (p.re.test(s)) return p.name;
  return null;
}

// Entities the manifest may never contain, whatever else is true. Configuration
// and system entities are preserved by construction, not by remembering to.
export const PROTECTED_TABLES = Object.freeze([
  'DealStage', 'DealSource', 'LostReason', 'Product', 'ProductVariant', 'Location',
  'PriceRule', 'TicketType', 'Addon', 'PaymentTerm', 'PaymentMethod', 'OrganizationType',
  'AdminUser', 'PersonRef', 'PersonProfile', 'Team', 'OpenTourTemplate', 'TourScheduleRule',
  'CommunicationTemplate', 'TaskType', 'QuoteTemplate', 'QuoteSection', 'ContentItem',
  'ActivityComponent', 'DocumentSource', 'CalendarMarker', 'HolidayRule', 'GuidePortalSettings',
  'WhatsAppAccount', 'WhatsAppTemplate', 'LegacyRecord', 'MigrationDecision', 'MigrationRun',
  '_prisma_migrations',
]);

// Every probe that proves a deal touched the real world. Each is (table, column).
// `loose` marks columns that are references by convention with no FK, which is
// exactly why they must be probed explicitly — a cascade would never reveal them.
export const IMPACT_PROBES = Object.freeze([
  { key: 'payments', table: 'PaymentRequest', column: 'dealId', why: 'has payment requests' },
  { key: 'paymentLinks', table: 'DealPaymentLink', column: 'dealId', why: 'has payment links' },
  { key: 'customPayLinks', table: 'DealCustomPaymentLink', column: 'dealId', why: 'has custom payment links' },
  { key: 'icountDocs', table: 'IcountDocument', column: 'dealId', why: 'has iCount documents' },
  { key: 'quoteDocs', table: 'QuoteDocument', column: 'dealId', why: 'has produced quote documents' },
  { key: 'bookings', table: 'Booking', column: 'dealId', why: 'has bookings' },
  { key: 'registrations', table: 'TicketRegistration', column: 'dealId', why: 'has seat registrations' },
  { key: 'files', table: 'DealFile', column: 'dealId', why: 'has files' },
  { key: 'emailThreads', table: 'EmailThread', column: 'linkedDealId', why: 'has linked email threads' },
  { key: 'reservations', table: 'ReservationGroup', column: 'createdDealId', why: 'was created by an agent reservation' },
  { key: 'commDeliveries', table: 'CommunicationDelivery', column: 'dealId', loose: true, why: 'has sent communications' },
  { key: 'scheduledEmails', table: 'ScheduledEmail', column: 'dealId', loose: true, why: 'has scheduled emails' },
  { key: 'adminReports', table: 'AdminReportDelivery', column: 'dealId', loose: true, why: 'appeared in an admin report' },
  { key: 'icountWebhooks', table: 'IcountWebhookLog', column: 'dealId', loose: true, why: 'has iCount webhook activity' },
  { key: 'ingressEvents', table: 'IngressEvent', column: 'dealId', loose: true, why: 'was created by external ingress' },
]);

/**
 * QA-reservation evidence.
 *
 * Every GOS-native test deal in production was created by the Agent Reservations
 * pipeline, so the blanket "a reservation blocks removal" rule pins all of them
 * to `keep`. That rule is right by default — a reservation produces an immutable
 * signed ReservationDocument — but it is too blunt when the reservation itself
 * is provably a QA artefact.
 *
 * This resolves that with EVIDENCE, never with a looser name match. A session
 * qualifies as QA only if the reservation's own record says so:
 *   - the submitting organization's name matches a test pattern
 *     (production has "בדיקת מערכת — סוכנות נסיעות (זמני)" — self-labelled temporary), or
 *   - the person who signed it matches a test pattern ("QA Automated Test", …).
 *
 * A reservation submitted through a REAL organization with no signer evidence is
 * deliberately NOT qualified, however test-like the deal title looks. Those stay
 * in `keep` for a human call.
 */
export async function probeReservationQa(db, dealId) {
  if (!(await exists(db, 'ReservationGroup')) || !(await exists(db, 'ReservationSession'))) return null;
  const rows = await db.$queryRawUnsafe(`
    SELECT s.id AS "sessionId", s."sessionNo", s."signerName", o.name AS "orgName"
    FROM "ReservationGroup" g
    JOIN "ReservationSession" s ON s.id = g."sessionId"
    LEFT JOIN "Organization" o ON o.id = s."organizationId"
    WHERE g."createdDealId" = $1`, dealId);
  if (!rows.length) return null;

  const sessions = rows.map((r) => {
    const orgPattern = matchTestPattern(r.orgName);
    const signerPattern = matchTestPattern(r.signerName);
    return {
      sessionId: r.sessionId,
      sessionNo: Number(r.sessionNo),
      orgName: r.orgName || null,
      signerName: r.signerName || null,
      qa: !!(orgPattern || signerPattern),
      evidence: orgPattern
        ? `test agency org "${r.orgName}"`
        : signerPattern ? `test signer "${r.signerName}"` : null,
    };
  });
  return { sessions, allQa: sessions.every((s) => s.qa) };
}

const exists = async (db, table) => {
  const r = await db.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, table);
  return r.length > 0;
};

/**
 * Probe one deal against every impact signal. Returns { counts, blockers[] }.
 * A table that does not exist in this schema version is skipped, not assumed
 * empty silently — it is reported as `skipped` so the manifest stays honest.
 */
export async function probeDealImpact(db, dealId, { probes = IMPACT_PROBES } = {}) {
  const counts = {};
  const blockers = [];
  const skipped = [];
  for (const p of probes) {
    if (!(await exists(db, p.table))) { skipped.push(p.table); continue; }
    const r = await db.$queryRawUnsafe(
      `SELECT count(*)::bigint AS n FROM "${p.table}" WHERE "${p.column}" = $1`, dealId);
    const n = Number(r[0]?.n ?? 0);
    counts[p.key] = n;
    if (n > 0) blockers.push(`${p.why} (${n})`);
  }
  return { counts, blockers, skipped };
}

/**
 * Build the manifest. READ-ONLY — it opens no transaction and writes nothing.
 */
export async function buildResetManifest(db, { now = new Date() } = {}) {
  // GOS-native deals only: a crosswalked deal belongs to the mirror, never here.
  const natives = await db.$queryRawUnsafe(`
    SELECT d.id, d."orderNo", d.title, d.status, d."createdAt", d."valueMinor"::text AS "valueMinor"
    FROM "Deal" d
    WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyRecord" l WHERE l."entityType"='Deal' AND l."entityId" = d.id)
    ORDER BY d."orderNo"`);

  const remove = [];
  const removeQaReservations = [];
  const keep = [];

  for (const d of natives) {
    const pattern = matchTestPattern(d.title);
    const { counts, blockers, skipped } = await probeDealImpact(db, d.id);
    const entry = {
      entity: 'Deal',
      id: d.id,
      orderNo: Number(d.orderNo),
      title: d.title,
      status: d.status,
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
      valueMinor: String(d.valueMinor ?? '0'),
      pattern,
      impact: counts,
      skippedProbes: skipped,
    };

    const hasValue = String(d.valueMinor ?? '0') !== '0';
    // Is the ONLY thing blocking removal a reservation, and is that reservation
    // itself provably a QA artefact? That is tier 2 — never auto-removed, listed
    // and hashed separately so it takes its own explicit approval.
    const onlyReservationBlocks =
      blockers.length > 0 &&
      Object.entries(counts).every(([k, n]) => n === 0 || k === 'reservations');

    if (!pattern) {
      keep.push({ ...entry, reason: 'no test pattern — treated as real business data' });
    } else if (!blockers.length) {
      // Tier 1 is the strictest tier and has no corroborating evidence beyond
      // the title, so a non-zero value is enough to hold it back.
      if (hasValue) {
        keep.push({ ...entry, reason: `test pattern "${pattern}" but carries a non-zero value (${d.valueMinor})` });
      } else {
        remove.push({ ...entry, reason: `test pattern "${pattern}", zero real-world impact` });
      }
    } else if (onlyReservationBlocks) {
      const qa = await probeReservationQa(db, d.id);
      if (qa?.allQa) {
        // `valueMinor` is deliberately NOT a blocker here. On a reservation-created
        // deal the value is computed by the pricing engine from the same QA
        // submission, so it is an artefact of the test — not evidence of a real
        // deal. The QA identity of the session (test agency org / QA signer) is
        // far stronger evidence than a number the system generated for itself.
        removeQaReservations.push({
          ...entry,
          reservations: qa.sessions,
          reason: `test pattern "${pattern}"; only impact is a QA reservation (${qa.sessions.map((s) => `#${s.sessionNo} ${s.evidence}`).join(', ')})`
            + (hasValue ? `; engine-computed value ${d.valueMinor} is a QA artefact, not real money` : ''),
        });
      } else {
        keep.push({
          ...entry,
          reservations: qa?.sessions || [],
          reason: `test pattern "${pattern}" but its reservation has no QA evidence — ${
            (qa?.sessions || []).map((s) => `#${s.sessionNo} org "${s.orgName}" signer "${s.signerName ?? '—'}"`).join(', ')
          } — needs a manual decision`,
        });
      }
    } else {
      keep.push({ ...entry, reason: `test pattern "${pattern}" but real-world impact: ${blockers.join('; ')}` });
    }
  }

  // Contacts/Organizations that exist ONLY because of removable deals. A contact
  // linked to any surviving deal, or carrying its own history, is never removed.
  const removeIds = remove.map((r) => r.id);
  const orphanContacts = removeIds.length ? await db.$queryRawUnsafe(`
    SELECT c.id, c."firstNameHe", c."lastNameHe"
    FROM "Contact" c
    WHERE NOT EXISTS (SELECT 1 FROM "LegacyRecord" l WHERE l."entityType"='Contact' AND l."entityId"=c.id)
      AND EXISTS (SELECT 1 FROM "DealContact" dc WHERE dc."contactId"=c.id AND dc."dealId" = ANY($1::text[]))
      AND NOT EXISTS (SELECT 1 FROM "DealContact" dc WHERE dc."contactId"=c.id AND NOT (dc."dealId" = ANY($1::text[])))
    ORDER BY c.id`, removeIds) : [];

  // Tier-2 collateral: the QA reservation sessions themselves, and the temporary
  // test agency org, once nothing real is left pointing at them. Deleting a
  // session cascades its groups and its ReservationDocument (verified against the
  // live schema), so the QA PDFs go with it rather than being orphaned.
  const qaSessions = [];
  const seenSessions = new Set();
  for (const d of removeQaReservations) {
    for (const s of d.reservations || []) {
      if (seenSessions.has(s.sessionId)) continue;
      seenSessions.add(s.sessionId);
      qaSessions.push({
        entity: 'ReservationSession', id: s.sessionId, sessionNo: s.sessionNo,
        orgName: s.orgName, signerName: s.signerName,
        reason: `QA reservation (${s.evidence}); cascades its groups and its ReservationDocument`,
      });
    }
  }

  const qaOrgs = qaSessions.length ? await db.$queryRawUnsafe(`
    SELECT o.id, o.name FROM "Organization" o
    WHERE NOT EXISTS (SELECT 1 FROM "LegacyRecord" l WHERE l."entityType"='Organization' AND l."entityId"=o.id)
      AND EXISTS (SELECT 1 FROM "ReservationSession" s WHERE s."organizationId"=o.id AND s.id = ANY($1::text[]))
      AND NOT EXISTS (SELECT 1 FROM "ReservationSession" s WHERE s."organizationId"=o.id AND NOT (s.id = ANY($1::text[])))
      AND NOT EXISTS (SELECT 1 FROM "Deal" d WHERE d."organizationId"=o.id AND NOT (d.id = ANY($2::text[])))
      AND NOT EXISTS (SELECT 1 FROM "ContactOrganization" co WHERE co."organizationId"=o.id)
    ORDER BY o.id`, [...seenSessions], removeQaReservations.map((d) => d.id)) : [];

  const manifest = {
    kind: 'gos-reset-manifest',
    version: 2,
    builtAt: now.toISOString(),
    rules: {
      patterns: TEST_PATTERNS.map((p) => ({ name: p.name, re: String(p.re) })),
      impactProbes: IMPACT_PROBES.map((p) => `${p.table}.${p.column}`),
      protectedTables: PROTECTED_TABLES,
      tiers: {
        1: 'test pattern + zero real-world impact — approve with --approve',
        2: 'test pattern + the ONLY impact is a reservation that is itself provably QA — approve SEPARATELY with --approve-qa',
      },
    },
    summary: {
      nativeDealsExamined: natives.length,
      dealsToRemove: remove.length,
      qaReservationDealsToRemove: removeQaReservations.length,
      qaSessionsToRemove: qaSessions.length,
      qaOrgsToRemove: qaOrgs.length,
      dealsKept: keep.length,
      orphanContactsToRemove: orphanContacts.length,
    },
    remove: {
      deals: remove,
      contacts: orphanContacts.map((c) => ({
        entity: 'Contact', id: c.id, name: `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim(),
        reason: 'linked exclusively to removable test deals, no legacy crosswalk',
      })),
    },
    removeQaReservations: {
      deals: removeQaReservations,
      sessions: qaSessions,
      organizations: qaOrgs.map((o) => ({
        entity: 'Organization', id: o.id, name: o.name,
        reason: 'temporary test agency org; no legacy crosswalk, no contacts, and nothing but QA sessions left pointing at it',
      })),
    },
    keep,
  };
  manifest.manifestSha256 = manifestHash(manifest);
  manifest.qaReservationsSha256 = qaReservationsHash(manifest);
  return manifest;
}

/**
 * Content identity of the manifest: hashes the ORDERED removal ids only.
 * Deliberately not the whole document — the hash must survive a re-run that
 * produces identical decisions with a different `builtAt`, and must change the
 * instant the removal set changes by one record.
 */
export function manifestHash(manifest) {
  const lines = [
    ...manifest.remove.deals.map((d) => `deal:${d.id}`),
    ...manifest.remove.contacts.map((c) => `contact:${c.id}`),
  ].sort();
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

// Tier 2 hashes SEPARATELY and is approved SEPARATELY. Approving the removal of
// zero-impact test deals must never silently carry the deletion of signed
// reservation documents along with it.
export function qaReservationsHash(manifest) {
  const t2 = manifest.removeQaReservations || { deals: [], sessions: [], organizations: [] };
  const lines = [
    ...t2.deals.map((d) => `deal:${d.id}`),
    ...t2.sessions.map((s) => `session:${s.id}`),
    ...t2.organizations.map((o) => `org:${o.id}`),
  ].sort();
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

/**
 * Execute a manifest. Refuses unless:
 *   - a verified backup id is supplied (checked by the caller, before this runs)
 *   - the approved hash matches the manifest being executed
 *   - the manifest was rebuilt against the CURRENT database and still agrees
 *
 * Deletion relies on the schema's own cascade rules inside one transaction, so
 * this never hand-rolls a delete order that could drift from the schema.
 */
export async function executeResetManifest(db, manifest, { approvedHash, approvedQaHash = null, dryRun = true }) {
  const hash = manifestHash(manifest);
  if (!approvedHash) {
    const e = new Error('no_approved_hash: the manifest must be approved by hash before execution');
    e.code = 'NO_APPROVED_HASH';
    throw e;
  }
  if (approvedHash !== hash) {
    const e = new Error(`manifest_changed: approved ${approvedHash} but current manifest is ${hash} — re-review before executing`);
    e.code = 'MANIFEST_CHANGED';
    throw e;
  }

  // Tier 2 is opt-in and separately approved. Silence here means "tier 1 only".
  const t2 = manifest.removeQaReservations || { deals: [], sessions: [], organizations: [] };
  let includeQa = false;
  if (approvedQaHash) {
    const qaHash = qaReservationsHash(manifest);
    if (approvedQaHash !== qaHash) {
      const e = new Error(`qa_manifest_changed: approved ${approvedQaHash} but current QA tier is ${qaHash} — re-review before executing`);
      e.code = 'QA_MANIFEST_CHANGED';
      throw e;
    }
    includeQa = true;
  }

  const dealsToDelete = [...manifest.remove.deals, ...(includeQa ? t2.deals : [])];
  const result = {
    dryRun, includeQa,
    deals: 0, contacts: 0, sessions: 0, organizations: 0,
    dealIds: [], contactIds: [], sessionIds: [], organizationIds: [],
  };

  if (dryRun) {
    result.deals = dealsToDelete.length;
    result.contacts = manifest.remove.contacts.length;
    result.sessions = includeQa ? t2.sessions.length : 0;
    result.organizations = includeQa ? t2.organizations.length : 0;
    result.dealIds = dealsToDelete.map((d) => d.id);
    result.contactIds = manifest.remove.contacts.map((c) => c.id);
    result.sessionIds = includeQa ? t2.sessions.map((s) => s.id) : [];
    result.organizationIds = includeQa ? t2.organizations.map((o) => o.id) : [];
    return result;
  }

  // The QA reservation is an EXPECTED blocker for tier-2 deals — it is the thing
  // that was separately approved. Every other blocker still aborts the run.
  const t2Ids = new Set(t2.deals.map((d) => d.id));

  await db.$transaction(async (tx) => {
    for (const d of dealsToDelete) {
      // Re-verify inside the transaction: the world may have changed since the
      // manifest was built, and a deal that gained a payment in the meantime
      // must not be deleted just because it was approved five minutes ago.
      const { counts, blockers } = await probeDealImpact(tx, d.id);
      const unexpected = t2Ids.has(d.id)
        ? Object.entries(counts).filter(([k, n]) => n > 0 && k !== 'reservations').length > 0
        : blockers.length > 0;
      if (unexpected) {
        const e = new Error(`impact_appeared: deal ${d.orderNo} gained real-world impact since the manifest was built (${blockers.join('; ')})`);
        e.code = 'IMPACT_APPEARED';
        throw e;
      }
      await tx.$executeRawUnsafe(`DELETE FROM "Deal" WHERE id = $1`, d.id);
      result.deals++;
      result.dealIds.push(d.id);
    }
    if (includeQa) {
      // Sessions cascade to their groups and their ReservationDocument.
      for (const s of t2.sessions) {
        await tx.$executeRawUnsafe(`DELETE FROM "ReservationSession" WHERE id = $1`, s.id);
        result.sessions++;
        result.sessionIds.push(s.id);
      }
    }
    for (const c of manifest.remove.contacts) {
      await tx.$executeRawUnsafe(`DELETE FROM "Contact" WHERE id = $1`, c.id);
      result.contacts++;
      result.contactIds.push(c.id);
    }
    if (includeQa) {
      for (const o of t2.organizations) {
        await tx.$executeRawUnsafe(`DELETE FROM "Organization" WHERE id = $1`, o.id);
        result.organizations++;
        result.organizationIds.push(o.id);
      }
    }
  });
  return result;
}
