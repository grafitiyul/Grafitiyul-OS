// IDENTITY IMPORT (Slice 6) — the first writer of production Contacts and
// Organizations, from Snapshot #1 + the MigrationDecision ledger.
//
// ── THE CONTRACT (accumulated owner-approved rules, each enforced here) ───────
//  * The import consumes DECISIONS only. It never reads a proposal's suggested
//    merge, never re-derives matching, never guesses.
//  * No decision → SEPARATE contacts. An undecided duplicate cluster imports
//    every member as its own contact — a tidiness debt, never a wrong merge.
//  * getDeletedPersonIds is the FIRST-PASS filter: an owner-deleted id can never
//    become an entity through any path (clustered, separate, unclustered).
//  * "New Contact" spam and EMPTY SHELLS (no deal/activity/note/file/participant
//    link) are not imported — they stay in Snapshot #1 + the archive.
//  * Name-cleanup decisions are binding: owner fields verbatim; `organization`
//    creates/maps an Organization with NO contact payload; `exclude`/`deleted`
//    import nothing.
//  * Identity corrections are already folded into stored decision results by the
//    canonical resolvers; where no decision exists they are applied here through
//    the same applyIdentityEdit.
//  * Organizations follow the per-source disposition map verbatim: canonical
//    orgs with owner-edited names + units, standalone `new:<id>` as-is, excluded
//    rows create nothing, routed members fold into their target.
//  * IDEMPOTENT: LegacyRecord (sourceSystem, sourceType, sourceId) is the
//    crosswalk; an already-imported source id is skipped and its existing entity
//    id is reused for references. Re-running never duplicates.
//
// planIdentityImport() is PURE (no I/O) so every rule above is unit-testable;
// executeIdentityPlan() materializes the plan in chunked createMany writes.
import crypto from 'node:crypto';
import { isNewContactName } from '../phoneCompare.js';
import { applyIdentityEdit } from '../review/contactIdentity.js';
import { defaultFields, validateContactNames, legacyIdFromNameKey } from '../review/nameCleanup.js';
import { isResolved } from '../review/queues.js';

const t = (s) => String(s ?? '').trim();
const newId = () => crypto.randomUUID();

// A reference to an organization that will exist: either planned in this run
// ({ plannedId }) or already alive ({ existingId }).
const refId = (ref) => ref?.plannedId ?? ref?.existingId ?? null;

export function planIdentityImport({
  persons, organizations, orgRows, contactRows, nameRows,
  identityEdits = {}, spamIds = new Set(), deletedIds = new Set(),
  existingPersonXwalk = new Map(), existingOrgXwalk = new Map(),
}) {
  const problems = [];
  const plan = { organizations: [], units: [], contacts: [], phones: [], emails: [], orgLinks: [], legacyRecords: [] };
  const skipped = { spam: 0, deleted: 0, shells: 0, nameExcluded: 0, orgTreatment: 0, alreadyImported: 0, invalid: 0, orgExcluded: 0, orgAlreadyImported: 0, orgNoName: 0 };

  const personById = new Map(persons.map((p) => [p.legacyId, p]));
  const nameByPerson = new Map();
  for (const r of nameRows) {
    const id = legacyIdFromNameKey(r.subjectKey);
    if (id != null) nameByPerson.set(id, r);
  }

  // ══ ORGANIZATIONS ════════════════════════════════════════════════════════
  // Pass 1 — clusters: consume each stored decision's canonical result.
  const clusterRefBySubject = new Map(); // org-queue subjectKey → org ref
  const memberDest = new Map();          // legacy org id → {ref, unitRef|null} | {excluded:treatment} | {pendingKey, unitKey}
  const standaloneNeeded = new Set();    // legacy org ids that become their own org

  for (const row of orgRows) {
    if (!isResolved(row.status) || !row.decision) {
      // The gate guarantees none; fail safe anyway.
      for (const m of row.proposal?.members || []) memberDest.set(m.legacyId, { excluded: { contacts: 'no_organization' } });
      problems.push(`אשכול ארגונים לא מוכרע: ${row.subjectKey} — חבריו יובאו ללא ארגון`);
      continue;
    }
    const d = row.decision;
    const result = d.result || {};
    let canonicalRef = null;
    if (result.organization) {
      if (d.mergeIntoGosId) {
        canonicalRef = { existingId: d.mergeIntoGosId };
      } else {
        // Idempotency: crosswalk rows are stored per MEMBER org id — a canonical
        // already exists iff any of its organization-members is already mapped.
        const already = (result.organization.members || [])
          .map((m) => existingOrgXwalk.get(String(m.legacyId)))
          .find(Boolean);
        canonicalRef = already ? { existingId: already } : { plannedId: newId() };
        if (already) skipped.orgAlreadyImported++;
        else {
          plan.organizations.push({
            id: canonicalRef.plannedId,
            name: t(result.organization.name),
            organizationTypeId: d.organizationTypeId || null,
            sourceTag: `cluster:${row.subjectKey}`,
          });
        }
      }
      clusterRefBySubject.set(row.subjectKey, canonicalRef);
      for (const m of result.organization.members || []) memberDest.set(m.legacyId, { ref: canonicalRef, unitRef: null });
    }
    for (const u of result.units || []) {
      const unitRef = { plannedId: newId() };
      plan.units.push({ id: unitRef.plannedId, orgRef: canonicalRef, name: t(u.name), key: u.key });
      for (const m of u.members || []) memberDest.set(m.legacyId, { ref: canonicalRef, unitRef });
    }
    for (const e of result.elsewhere || []) {
      memberDest.set(e.legacyId, { pendingKey: e.targetOrganizationKey, unitKey: e.targetUnitKey || null });
    }
    for (const [legacyId, disp] of Object.entries(d.dispositions || {})) {
      if (disp.disposition === 'excluded') {
        memberDest.set(Number(legacyId), { excluded: disp.linkedEntityTreatment || {} });
        skipped.orgExcluded++;
      } else if (disp.disposition === 'other_organization' && disp.targetOrganizationKey === `new:${legacyId}`) {
        standaloneNeeded.add(Number(legacyId));
      }
    }
  }

  // Standalone orgs: every snapshot org never claimed by a cluster, plus the
  // members explicitly sent standalone.
  const standaloneRef = new Map(); // legacy org id → ref
  for (const o of organizations) {
    const claimed = memberDest.has(o.legacyId) || standaloneNeeded.has(o.legacyId);
    if (claimed && !standaloneNeeded.has(o.legacyId)) continue;
    const already = existingOrgXwalk.get(String(o.legacyId));
    if (already) { standaloneRef.set(o.legacyId, { existingId: already }); skipped.orgAlreadyImported++; continue; }
    const name = t(o.name);
    if (!name) { skipped.orgNoName++; continue; } // nameless junk is not an Organization
    const ref = { plannedId: newId() };
    standaloneRef.set(o.legacyId, ref);
    plan.organizations.push({ id: ref.plannedId, name, organizationTypeId: null, sourceTag: String(o.legacyId) });
  }

  // Pass 2 — resolve deferred `other_organization` targets against the built refs.
  const resolveKey = (key) => {
    if (!key) return null;
    if (key.startsWith('gos:')) return { existingId: key.slice(4) };
    if (key.startsWith('prop:')) return clusterRefBySubject.get(key.slice(5)) || null;
    if (key.startsWith('new:')) return standaloneRef.get(Number(key.slice(4))) || null;
    return null;
  };
  for (const [legacyId, dest] of memberDest) {
    if (!dest.pendingKey) continue;
    const ref = resolveKey(dest.pendingKey);
    if (!ref) {
      problems.push(`ארגון מקור ${legacyId}: יעד ${dest.pendingKey} לא נבנה — הרשומה תישאר ללא יעד`);
      memberDest.set(legacyId, { excluded: { contacts: 'no_organization' } });
      continue;
    }
    memberDest.set(legacyId, { ref, unitRef: null, unitKey: dest.unitKey });
  }

  // Where does a PERSON's org link land? (legacy org id → {ref, unitRef}|null)
  const orgLinkFor = (legacyOrgId) => {
    if (legacyOrgId == null) return null;
    const dest = memberDest.get(legacyOrgId);
    if (dest?.ref) return { ref: dest.ref, unitRef: dest.unitRef || null };
    if (dest?.excluded) {
      const tr = dest.excluded;
      if (tr.contacts === 'reassign' && tr.contactsTargetOrganizationKey) {
        const ref = resolveKey(tr.contactsTargetOrganizationKey);
        return ref ? { ref, unitRef: null } : null;
      }
      return null; // no_organization / exceptional → no link
    }
    const sa = standaloneRef.get(legacyOrgId);
    return sa ? { ref: sa, unitRef: null } : null;
  };

  // Crosswalk rows for every legacy org that maps to a destination.
  for (const o of organizations) {
    if (existingOrgXwalk.has(String(o.legacyId))) continue;
    const dest = memberDest.get(o.legacyId);
    const ref = dest?.ref || standaloneRef.get(o.legacyId) || null;
    if (!ref) continue; // excluded / nameless → no entity, no crosswalk row
    plan.legacyRecords.push({
      sourceSystem: 'pipedrive', sourceType: 'organization', sourceId: String(o.legacyId),
      entityType: 'Organization', entityRef: ref,
    });
  }

  // ══ NAME-CLEANUP "זה ארגון" DECISIONS ═══════════════════════════════════
  // A person record that is really an organization: create/map the org, import
  // NO contact, crosswalk the person to the Organization entity.
  const personIsOrg = new Map(); // person id → ref | null(create:false)
  for (const [pid, row] of nameByPerson) {
    if (!isResolved(row.status) || row.decision?.treatment !== 'organization') continue;
    const o = row.decision.organization || {};
    if (!o.create) { personIsOrg.set(pid, null); continue; }
    // Idempotency: this person's crosswalk row already points at its Organization.
    const alreadyEntity = existingPersonXwalk.get(String(pid));
    if (alreadyEntity) { personIsOrg.set(pid, { existingId: alreadyEntity }); continue; }
    let ref = o.targetOrganizationKey ? resolveKey(o.targetOrganizationKey) : null;
    if (!ref && o.targetOrganizationKey) {
      problems.push(`רשומה ${pid}: ארגון היעד ${o.targetOrganizationKey} לא נבנה`);
      continue;
    }
    if (!ref) {
      ref = { plannedId: newId() };
      plan.organizations.push({ id: ref.plannedId, name: t(o.name), organizationTypeId: null, sourceTag: `person:${pid}` });
    }
    personIsOrg.set(pid, ref);
    if (!existingPersonXwalk.has(String(pid))) {
      plan.legacyRecords.push({
        sourceSystem: 'pipedrive', sourceType: 'person', sourceId: String(pid),
        entityType: 'Organization', entityRef: ref,
      });
    }
  }

  // ══ CONTACTS ═════════════════════════════════════════════════════════════
  const nameTreatment = (pid) => {
    const row = nameByPerson.get(pid);
    return row && isResolved(row.status) ? row.decision?.treatment ?? null : null;
  };
  const skipReason = (p) => {
    if (spamIds.has(p.legacyId)) return 'spam';
    if (deletedIds.has(p.legacyId)) return 'deleted';
    const tr = nameTreatment(p.legacyId);
    if (tr === 'exclude' || tr === 'deleted') return 'nameExcluded';
    if (tr === 'organization') return 'orgTreatment';
    if (!p.importable) return 'shells';
    return null;
  };

  // Merge map from DECIDED duplicate clusters only.
  const survivorOf = new Map();
  for (const row of contactRows) {
    if (!isResolved(row.status) || row.status === 'rejected') continue;
    const d = row.decision;
    if (!d?.primaryLegacyId) continue;
    for (const mid of d.mergeLegacyIds || []) survivorOf.set(mid, { primary: d.primaryLegacyId, row });
  }

  const seen = new Set();
  for (const p of persons) {
    if (seen.has(p.legacyId)) continue;
    seen.add(p.legacyId);
    if (existingPersonXwalk.has(String(p.legacyId))) { skipped.alreadyImported++; continue; }
    const reason = skipReason(p);
    if (reason) { skipped[reason]++; continue; }

    const merge = survivorOf.get(p.legacyId);
    if (merge) {
      // Folded into a survivor — unless the survivor itself is skipped, in which
      // case the merge cannot happen and this member imports separately (fail-safe:
      // an unapplied merge is recoverable via the crosswalk; a lost record is not).
      const primaryPerson = personById.get(merge.primary);
      if (primaryPerson && !skipReason(primaryPerson)) {
        plan.legacyRecords.push({
          sourceSystem: 'pipedrive', sourceType: 'person', sourceId: String(p.legacyId),
          entityType: 'Contact', entityRef: { survivorPersonId: merge.primary },
        });
        continue;
      }
      problems.push(`איחוד לא ישים: הרשומה השורדת ${merge.primary} אינה מיובאת — ${p.legacyId} ייובא בנפרד`);
    }

    // Name fields: the owner's decided fields are binding; else the default split.
    const nameRow = nameByPerson.get(p.legacyId);
    const decidedFields = isResolved(nameRow?.status) && nameRow.decision?.treatment === 'import' ? nameRow.decision.fields : null;
    const fields = decidedFields || defaultFields(p.firstName, p.lastName);
    if (!validateContactNames(fields).valid) { skipped.invalid++; problems.push(`רשומה ${p.legacyId} "${p.name}" ללא שם פרטי — דולגה`); continue; }

    // Identity: a decided merge-survivor uses its cluster result (identity
    // corrections already folded in by the canonical resolver at decision time);
    // otherwise the correction is applied here through the same resolver.
    let phones;
    let emails;
    const asPrimary = merge ? null : contactRows.find((r) => isResolved(r.status) && r.status !== 'rejected' && r.decision?.primaryLegacyId === p.legacyId && (r.decision.mergeLegacyIds || []).length > 0);
    if (asPrimary) {
      phones = (asPrimary.decision.result?.primary?.phones || []).map(t).filter(Boolean);
      emails = (asPrimary.decision.result?.primary?.emails || []).map(t).filter(Boolean);
    } else {
      const eff = applyIdentityEdit(p, identityEdits[p.legacyId] || null);
      phones = eff.phones;
      emails = eff.emails;
    }
    // Owner-edited phones from Name Cleanup override everything.
    const decidedPhones = isResolved(nameRow?.status) && Array.isArray(nameRow.decision?.phones) ? nameRow.decision.phones : null;
    let phoneRows;
    if (decidedPhones) {
      phoneRows = decidedPhones.filter((x) => !x.remove).map((x, i) => ({ value: t(x.value), isPrimary: !!x.isPrimary || i === 0 }));
    } else {
      phoneRows = [...new Set(phones)].map((v, i) => ({ value: v, isPrimary: i === 0 }));
    }

    const contactId = newId();
    plan.contacts.push({
      id: contactId,
      firstNameHe: t(fields.firstNameHe), lastNameHe: t(fields.lastNameHe),
      firstNameEn: t(fields.firstNameEn), lastNameEn: t(fields.lastNameEn),
    });
    const uniquePhones = [];
    for (const row of phoneRows) if (row.value && !uniquePhones.some((x) => x.value === row.value)) uniquePhones.push(row);
    uniquePhones.forEach((row, i) => plan.phones.push({ contactId, value: row.value, isPrimary: row.isPrimary && !uniquePhones.slice(0, i).some((x) => x.isPrimary), sortOrder: i }));
    [...new Set(emails)].forEach((v, i) => plan.emails.push({ contactId, value: v, isPrimary: i === 0, sortOrder: i }));

    const link = orgLinkFor(p.orgId ?? null);
    if (link) plan.orgLinks.push({ contactId, orgRef: link.ref, unitRef: link.unitRef, isPrimary: true });

    plan.legacyRecords.push({
      sourceSystem: 'pipedrive', sourceType: 'person', sourceId: String(p.legacyId),
      entityType: 'Contact', entityRef: { plannedId: contactId },
    });
  }

  // Survivor crosswalk references resolve to the survivor's planned contact id.
  const contactIdByPerson = new Map();
  for (const lr of plan.legacyRecords) {
    if (lr.entityType === 'Contact' && lr.entityRef.plannedId) contactIdByPerson.set(Number(lr.sourceId), lr.entityRef.plannedId);
  }
  for (const lr of plan.legacyRecords) {
    if (lr.entityRef?.survivorPersonId != null) {
      // The survivor is either planned in this run or already imported earlier —
      // both resolve to a concrete Contact id.
      const target = contactIdByPerson.get(lr.entityRef.survivorPersonId)
        || existingPersonXwalk.get(String(lr.entityRef.survivorPersonId)) || null;
      if (target) lr.entityRef = { plannedId: target };
      else { lr.entityRef = null; problems.push(`crosswalk: לרשומה ${lr.sourceId} אין שורד — נרשמת ללא ישות`); }
    }
  }

  return {
    plan, skipped, problems,
    stats: {
      organizations: plan.organizations.length,
      units: plan.units.length,
      contacts: plan.contacts.length,
      phones: plan.phones.length,
      emails: plan.emails.length,
      orgLinks: plan.orgLinks.length,
      legacyRecords: plan.legacyRecords.length,
      skipped,
    },
  };
}

// Materialize the plan. Chunked createMany; every row carries the batch id via
// LegacyRecord.importBatchId. Safe to re-run: the planner already skipped every
// source id present in the crosswalk.
export async function executeIdentityPlan(prisma, { plan }, { batchId, chunk = 500, log = () => {} } = {}) {
  const chunks = (arr) => { const out = []; for (let i = 0; i < arr.length; i += chunk) out.push(arr.slice(i, i + chunk)); return out; };
  const idOf = (ref) => refId(ref);

  for (const c of chunks(plan.organizations)) {
    await prisma.organization.createMany({ data: c.map((o) => ({ id: o.id, name: o.name, organizationTypeId: o.organizationTypeId })) });
  }
  log(`organizations: ${plan.organizations.length}`);
  const units = plan.units.map((u) => ({ id: u.id, organizationId: idOf(u.orgRef), name: u.name })).filter((u) => u.organizationId);
  for (const c of chunks(units)) await prisma.organizationUnit.createMany({ data: c });
  log(`units: ${units.length}`);
  for (const c of chunks(plan.contacts)) await prisma.contact.createMany({ data: c });
  log(`contacts: ${plan.contacts.length}`);
  for (const c of chunks(plan.phones)) await prisma.contactPhone.createMany({ data: c });
  for (const c of chunks(plan.emails)) await prisma.contactEmail.createMany({ data: c });
  log(`phones: ${plan.phones.length} · emails: ${plan.emails.length}`);
  const links = plan.orgLinks
    .map((l) => ({ contactId: l.contactId, organizationId: idOf(l.orgRef), organizationUnitId: l.unitRef ? idOf(l.unitRef) : null, isPrimary: true }))
    .filter((l) => l.organizationId);
  for (const c of chunks(links)) await prisma.contactOrganization.createMany({ data: c, skipDuplicates: true });
  log(`org links: ${links.length}`);
  const lrs = plan.legacyRecords.map((lr) => ({
    sourceSystem: lr.sourceSystem, sourceType: lr.sourceType, sourceId: lr.sourceId,
    entityType: lr.entityRef ? lr.entityType : null,
    entityId: lr.entityRef ? idOf(lr.entityRef) : null,
    importBatchId: batchId,
    snapshotId: lr.snapshotId ?? null,
  }));
  for (const c of chunks(lrs)) await prisma.legacyRecord.createMany({ data: c, skipDuplicates: true });
  log(`legacy records: ${lrs.length}`);
  return { batchId };
}
