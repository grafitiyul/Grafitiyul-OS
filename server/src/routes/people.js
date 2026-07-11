import crypto from 'node:crypto';
import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { getRecruitmentSnapshot } from './recruitment.js';
import { userOrigin } from '../timeline/events.js';
import {
  diffPersonFields,
  normalizeBankDetails,
  personChangeSnapshot,
  recordPersonChanges,
  PERSON_FIELD_LABELS,
} from '../timeline/personChangelog.js';
import { storeImageAsset, storeProfileImage } from '../people/profileImage.js';
import { ASSIGNABLE_WHERE } from '../people/eligibility.js';

// Guide (PersonRef + PersonProfile) CRUD, portal token management, image
// upload, and the categorized procedures endpoint that drives the admin
// profile's three procedures sections.
//
// Architecture notes:
//   * identitySource='recruitment' means name/email/phone are a mirror —
//     updates through this route are allowed only for displayName (cached
//     for list display) and contact cache fields flagged by the caller.
//     Full identity ownership is reserved for a future flip to
//     identitySource='management'.
//   * portalToken is the portal's only auth today. It is URL-safe and
//     generated from 24 bytes of crypto randomness.
//   * Image storage reuses the MediaAsset table (same as procedure media).
//     One fewer subsystem, one URL convention: /api/media/:id.

const router = Router();

// ---------- Token helper ----------

function newPortalToken() {
  // 24 bytes → 32 char URL-safe base64 string. Enough entropy that guessing
  // is infeasible; short enough to paste into a share URL.
  return crypto.randomBytes(24).toString('base64url');
}

// ---------- Shared include for PersonRef reads ----------

const PERSON_INCLUDE = {
  profile: true,
  team: { select: { id: true, displayName: true } },
};

// ---------- Upstream sync ----------
// Upsert local PersonRef rows from the recruitment export. Identity fields
// (displayName / email / phone) reflect the latest upstream snapshot;
// operational fields (portalToken, portalEnabled, status, teamRefId,
// PersonProfile) are NEVER touched on an existing row — they're owned by
// this system.
//
// Called from two places:
//   * The list endpoint (sync-on-read) so /admin/people always reflects
//     the current recruitment roster without user action.
//   * POST /import (retained for admin-triggered force refresh).
async function syncFromUpstream() {
  const snap = await getRecruitmentSnapshot();
  let updated = 0;
  let missingFromGos = 0;
  let skippedManagement = 0;

  // Evaluator ("פורטל ממשב") portal tokens, surfaced from recruitment. The export
  // returns portalToken = the person's active evaluator portal token for anyone who
  // HAS one — a guide (evaluator via guide_id) OR a candidate-sourced staff member
  // (evaluator via candidate_id, migration 129). GOS reads it here and the list
  // endpoint turns it into a full recruitment /e/<token> URL — GOS is the user-
  // facing place, the token still physically lives in recruitment. We do NOT store
  // it (no duplicate ownership); it's a live read-through.
  const evaluatorTokens = new Map();

  for (const p of snap.people) {
    const externalPersonId = String(p.externalPersonId || '').trim();
    const displayName = String(p.displayName || '').trim();
    if (!externalPersonId || !displayName) continue;

    if (p.portalToken) {
      evaluatorTokens.set(externalPersonId, String(p.portalToken));
    }

    const existing = await prisma.personRef.findUnique({
      where: { externalPersonId },
      select: { id: true, identitySource: true },
    });
    if (existing) {
      // Phase G: GOS OWNS identity for identitySource='management' rows (staff /
      // guides / evaluators). The upstream pull must NOT overwrite their
      // name/email/phone — those are edited in GOS now. Skip them entirely.
      if (existing.identitySource === 'management') {
        skippedManagement += 1;
        continue;
      }
      // Otherwise (identitySource='recruitment' — e.g. active trainees) the pull
      // is still an identity mirror for EXISTING people (name/email/phone).
      // lifecycleHint is never touched; portalEnabled / access / profile /
      // teamRef are local-only.
      const data = {
        displayName,
        email: p.email || null,
        phone: p.phone || null,
        identitySyncedAt: new Date(),
      };
      if (p.portalToken) data.portalToken = p.portalToken;
      await prisma.personRef.update({ where: { externalPersonId }, data });
      updated += 1;
    } else {
      // Slice E: GOS no longer DERIVES the roster from recruitment. People enter
      // GOS via staff-events (training_started / accepted_to_team), not this pull.
      // We do NOT create here — surface the gap instead (visible, no hidden
      // re-derivation of the roster).
      missingFromGos += 1;
    }
  }

  // Reconcile safety net: a GOS 'trainee' no longer in the recruitment active
  // roster MAY have been rejected/dropped upstream with a missed event push.
  //
  // SAFETY (post-incident): this net is a HEURISTIC and must NEVER destroy data.
  // "Missing from roster" is ambiguous — it also matches a trainee who was
  // promoted via a path that didn't (yet) emit accepted_to_team, or a transient
  // export glitch. So we only REVOKE ACCESS here; we do NOT delete. Actual
  // deletion happens only on the explicit training_rejected event / reject-training
  // trigger (a real, recorded rejection). ONLY trainees are touched. Skipped when
  // the snapshot is empty (guards against wiping access on a bad/empty fetch).
  let revoked = 0;
  if (snap.people.length > 0) {
    const roster = new Set(
      snap.people.map((p) => String(p.externalPersonId || '').trim()).filter(Boolean),
    );
    const trainees = await prisma.personRef.findMany({
      where: { lifecycleHint: 'trainee' },
      select: { id: true, externalPersonId: true, portalEnabled: true },
    });
    for (const t of trainees) {
      if (!roster.has(t.externalPersonId) && t.portalEnabled) {
        // Revoke access only — never delete. The person is preserved for review.
        await prisma.personRef.update({ where: { id: t.id }, data: { portalEnabled: false, accessRevokedAt: new Date() } });
        revoked += 1;
      }
    }
  }

  return { updated, missingFromGos, skippedManagement, revoked, total: snap.people.length, evaluatorTokens };
}

// Build the full evaluator ("פורטל ממשב") portal URL from a recruitment token.
// The /e/<token> page is served by the recruitment SPA at its own origin.
function evaluatorPortalUrl(token) {
  const base = String(process.env.RECRUITMENT_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base || !token) return null;
  return `${base}/e/${token}`;
}

// ---------- List ----------
// Sync-on-read: every call refreshes from recruitment before returning
// the merged roster. No manual import button. If upstream is down we
// still return the existing DB rows — admins get best-effort visibility
// with an explicit `upstream.ok=false` flag so the UI can surface the
// problem.
//
// Response shape:
//   {
//     people:   [PersonRef rows, identity = upstream-synced, operational = local],
//     upstream: { ok: true,  syncedAt, created, updated, total }
//               | { ok: false, error, detail }
//   }

router.get(
  '/',
  handle(async (_req, res) => {
    let upstream;
    let evaluatorTokens = new Map();
    try {
      const r = await syncFromUpstream();
      evaluatorTokens = r.evaluatorTokens || new Map();
      upstream = {
        ok: true,
        syncedAt: new Date().toISOString(),
        updated: r.updated,
        missingFromGos: r.missingFromGos,
        skippedManagement: r.skippedManagement,
        revoked: r.revoked,
        total: r.total,
      };
    } catch (e) {
      // Log server-side so operators can see the root cause in Railway
      // logs; serve the current DB state anyway so the UI isn't blocked
      // by a transient upstream outage or misconfigured env var.
      console.error('[people list] upstream sync failed:', e);
      upstream = {
        ok: false,
        error: e?.message || 'upstream_error',
        detail: e?.detail || null,
      };
    }

    const people = await prisma.personRef.findMany({
      include: PERSON_INCLUDE,
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
    });

    // Attach the evaluator ("פורטל ממשב") portal URL read-through (guides only;
    // null when the guide has no active evaluator link or upstream is down).
    const withLinks = people.map((p) => ({
      ...p,
      evaluatorPortalUrl: evaluatorPortalUrl(evaluatorTokens.get(p.externalPersonId)),
    }));

    res.json({ people: withLinks, upstream });
  }),
);

// ---------- Assignable staff (Tour team pickers) ----------
// The canonical eligibility rule (people/eligibility.js) in list form —
// every Tour-assignment surface reads THIS list, and the assignment
// endpoint re-enforces the same rule on write.
// NOTE: registered before '/:id' so the literal path wins.

router.get(
  '/assignable',
  handle(async (_req, res) => {
    const people = await prisma.personRef.findMany({
      where: ASSIGNABLE_WHERE,
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        displayName: true,
        status: true,
        lifecycleHint: true,
        profile: { select: { imageUrl: true } },
        team: { select: { id: true, displayName: true } },
      },
    });
    res.json({ people });
  }),
);

// ---------- Get one ----------

router.get(
  '/:id',
  handle(async (req, res) => {
    const person = await prisma.personRef.findUnique({
      where: { id: req.params.id },
      include: PERSON_INCLUDE,
    });
    if (!person) return res.status(404).json({ error: 'not found' });
    res.json(person);
  }),
);

// ---------- Force refresh (admin-triggered) ----------
// The list endpoint already syncs on every read, so /import is retained
// only as an explicit "sync now and tell me what happened" affordance
// for operational troubleshooting. It performs the same upsert.
router.post(
  '/import',
  handle(async (_req, res) => {
    const r = await syncFromUpstream();
    res.json(r);
  }),
);

// ---------- Update identity fields ----------
// identitySource='recruitment' → these fields are a cache of the upstream
// mirror (the admin can correct a stale value; the pull may re-sync it).
// identitySource='management' (Phase G, live for staff/guides) → GOS OWNS
// identity: edits here are authoritative and the upstream pull no longer
// overwrites them. Same endpoint for both.

router.put(
  '/:id',
  handle(async (req, res) => {
    const { displayName, email, phone, teamRefId, status } = req.body || {};
    const data = {};
    if (displayName !== undefined) data.displayName = String(displayName).trim();
    if (email !== undefined) data.email = email || null;
    if (phone !== undefined) data.phone = phone || null;
    if (teamRefId !== undefined) data.teamRefId = teamRefId || null;
    if (status !== undefined) {
      if (!['active', 'blocked'].includes(status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }
      data.status = status;
    }
    const before = await prisma.personRef.findUnique({
      where: { id: req.params.id },
      select: { displayName: true, email: true, phone: true },
    });
    if (!before) return res.status(404).json({ error: 'not found' });
    const person = await prisma.personRef.update({
      where: { id: req.params.id },
      data,
      include: PERSON_INCLUDE,
    });
    // Identity edits are part of the immutable person changelog (admin source).
    await recordPersonChanges(prisma, {
      personRefId: person.id,
      changes: diffPersonFields(before, {
        displayName: data.displayName,
        email: data.email,
        phone: data.phone,
      }),
      origin: await userOrigin(req.adminAuth?.userId),
      source: 'admin',
    });
    res.json(person);
  }),
);

// ---------- Update operational profile ----------

router.put(
  '/:id/profile',
  handle(async (req, res) => {
    const { imageUrl, description, notes, bankDetails } = req.body || {};
    const data = {};
    if (imageUrl !== undefined) {
      data.imageUrl = imageUrl || null;
      // Removing the photo also drops the recrop state (original + crop) —
      // the assets themselves stay in MediaAsset for history previews.
      if (!imageUrl) {
        data.imageOriginalUrl = null;
        data.imageCrop = null;
      }
    }
    if (description !== undefined) data.description = description || null;
    if (notes !== undefined) data.notes = notes || null;
    // Every bank write is normalized to the ONE structured shape (legacy
    // free-form JSON degrades to nulls and gets replaced on first save).
    if (bankDetails !== undefined) {
      data.bankDetails = bankDetails === null ? normalizeBankDetails(null) : normalizeBankDetails(bankDetails);
    }

    const before = await prisma.personProfile.findUnique({
      where: { personRefId: req.params.id },
      select: { imageUrl: true, bankDetails: true },
    });
    const profile = await prisma.personProfile.upsert({
      where: { personRefId: req.params.id },
      update: data,
      create: { personRefId: req.params.id, ...data },
    });
    // Changelog for the tracked profile fields (imageUrl + bank). description
    // and internal notes are deliberately untracked (admin working notes).
    const beforeSnap = personChangeSnapshot(null, before);
    const afterSnap = personChangeSnapshot(null, profile);
    await recordPersonChanges(prisma, {
      personRefId: req.params.id,
      changes: diffPersonFields(beforeSnap, {
        ...(imageUrl !== undefined ? { imageUrl: afterSnap.imageUrl } : {}),
        ...(bankDetails !== undefined
          ? {
              beneficiary: afterSnap.beneficiary,
              bank: afterSnap.bank,
              branch: afterSnap.branch,
              accountNumber: afterSnap.accountNumber,
            }
          : {}),
      }),
      origin: await userOrigin(req.adminAuth?.userId),
      source: 'admin',
    });
    res.json(profile);
  }),
);

// ---------- Profile change history (immutable) + restore ----------
//
// One shared audit mechanism: TimelineEntry subjectType='person',
// kind='change' (see timeline/personChangelog.js). Restore applies the OLD
// value of one field as a brand-new audited change — history is never
// rewritten or deleted.

router.get(
  '/:id/changes',
  handle(async (req, res) => {
    const entries = await prisma.timelineEntry.findMany({
      where: { subjectType: 'person', subjectId: req.params.id, kind: 'change' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        actorType: true,
        actorLabel: true,
        createdByName: true,
        data: true,
      },
    });
    res.json({ entries });
  }),
);

router.post(
  '/:id/changes/:entryId/restore',
  handle(async (req, res) => {
    const fieldKey = String(req.body?.fieldKey || '');
    if (!PERSON_FIELD_LABELS[fieldKey]) {
      return res.status(400).json({ error: 'unknown_field' });
    }
    const entry = await prisma.timelineEntry.findFirst({
      where: {
        id: req.params.entryId,
        subjectType: 'person',
        subjectId: req.params.id,
        kind: 'change',
      },
      select: { id: true, data: true },
    });
    if (!entry) return res.status(404).json({ error: 'entry_not_found' });
    const change = (entry.data?.changes || []).find((c) => c.fieldKey === fieldKey);
    if (!change) return res.status(404).json({ error: 'field_not_in_entry' });

    const person = await prisma.personRef.findUnique({
      where: { id: req.params.id },
      include: { profile: true },
    });
    if (!person) return res.status(404).json({ error: 'not found' });
    const beforeSnap = personChangeSnapshot(person, person.profile);
    const restored = change.oldValue ?? null;

    if (fieldKey === 'displayName' || fieldKey === 'email' || fieldKey === 'phone') {
      if (fieldKey === 'displayName' && !String(restored || '').trim()) {
        return res.status(400).json({ error: 'empty_name' });
      }
      await prisma.personRef.update({
        where: { id: person.id },
        data: { [fieldKey]: restored },
      });
    } else if (fieldKey === 'imageUrl') {
      await prisma.personProfile.upsert({
        where: { personRefId: person.id },
        update: { imageUrl: restored },
        create: { personRefId: person.id, imageUrl: restored },
      });
    } else {
      // Bank family — merge the restored logical field into the structured
      // bankDetails shape.
      const bank = normalizeBankDetails(person.profile?.bankDetails);
      if (fieldKey === 'beneficiary') bank.beneficiary = restored;
      if (fieldKey === 'accountNumber') bank.accountNumber = restored;
      if (fieldKey === 'bank') {
        bank.bankCode = restored?.code ?? null;
        bank.bankName = restored?.name ?? null;
      }
      if (fieldKey === 'branch') {
        bank.branchCode = restored?.code ?? null;
        bank.branchName = restored?.name ?? null;
      }
      await prisma.personProfile.upsert({
        where: { personRefId: person.id },
        update: { bankDetails: bank },
        create: { personRefId: person.id, bankDetails: bank },
      });
    }

    await recordPersonChanges(prisma, {
      personRefId: person.id,
      changes: diffPersonFields(beforeSnap, { [fieldKey]: restored }),
      origin: await userOrigin(req.adminAuth?.userId),
      source: 'admin',
      restoredFromEntryId: entry.id,
    });
    const fresh = await prisma.personRef.findUnique({
      where: { id: person.id },
      include: PERSON_INCLUDE,
    });
    res.json(fresh);
  }),
);

// ---------- Portal controls ----------

router.post(
  '/:id/portal/rotate',
  handle(async (req, res) => {
    const person = await prisma.personRef.update({
      where: { id: req.params.id },
      data: { portalToken: newPortalToken() },
      include: PERSON_INCLUDE,
    });
    res.json(person);
  }),
);

router.put(
  '/:id/portal/enabled',
  handle(async (req, res) => {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled_boolean_required' });
    }
    // Stamp the audit timestamp that matches the new state. Keeps the
    // other one as-is (we want to remember when access was first
    // granted even after a later revoke + regrant cycle).
    const data = { portalEnabled: enabled };
    if (enabled) data.accessGrantedAt = new Date();
    else data.accessRevokedAt = new Date();
    const person = await prisma.personRef.update({
      where: { id: req.params.id },
      data,
      include: PERSON_INCLUDE,
    });
    res.json(person);
  }),
);

// Friendlier alias used by the unified "אנשים וגישה" UI. Same body
// shape as the legacy /portal/enabled endpoint above (`{ enabled }`) —
// kept separate only so the URL reads as the domain concept (access)
// rather than the implementation detail (portal toggle).
router.put(
  '/:id/access',
  handle(async (req, res) => {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled_boolean_required' });
    }
    const data = { portalEnabled: enabled };
    if (enabled) data.accessGrantedAt = new Date();
    else data.accessRevokedAt = new Date();
    const person = await prisma.personRef.update({
      where: { id: req.params.id },
      data,
      include: PERSON_INCLUDE,
    });
    res.json(person);
  }),
);

// ---------- Lifecycle status (GOS-owned, Slice B) ----------
// The person's lifecycle is now owned by GOS, not mirrored from recruitment.
// Explicit control (not a lossy binary toggle): set the exact status.
//   'trainee' → lifecycleHint = 'trainee'
//   'staff'   → lifecycleHint = 'staff'
//   'none'    → lifecycleHint = null   (ללא שיוך / אחר)
// Uses the existing `lifecycleHint` field — no schema change. syncFromUpstream no
// longer overwrites this on existing rows, so a value set here is authoritative.
// Values: 'trainee' | 'staff' | 'former' | 'none'. There is intentionally NO
// 'rejected' — a rejected trainee is deleted (see /:id/reject-training + the
// staff-events ingest), not stored as a GOS status. 'former' (עזב) is only for a
// real staff member who left; it also closes access.
const LIFECYCLE_MAP = { trainee: 'trainee', staff: 'staff', former: 'former', none: null };
router.put(
  '/:id/lifecycle',
  handle(async (req, res) => {
    const raw = req.body?.lifecycle;
    if (!Object.prototype.hasOwnProperty.call(LIFECYCLE_MAP, raw)) {
      return res
        .status(400)
        .json({ error: 'invalid_lifecycle', allowed: ['trainee', 'staff', 'former', 'none'] });
    }
    const data = { lifecycleHint: LIFECYCLE_MAP[raw] };
    // 'former' = veteran staff who left → close access as well.
    if (raw === 'former') {
      data.portalEnabled = false;
      data.accessRevokedAt = new Date();
    }
    const person = await prisma.personRef.update({
      where: { id: req.params.id },
      data,
      include: PERSON_INCLUDE,
    });
    res.json(person);
  }),
);

// ---------- Accept to team (GOS-initiated trigger) ----------
// The GOS admin promotes a trainee → staff. This is NOT a plain lifecycle edit:
// it is the official "accepted to team" business event. Recruitment is the
// recorder — GOS calls it; recruitment creates the team_members row and emits the
// SINGLE accepted_to_team event back to GOS (awaited), which flips THIS PersonRef
// to staff (lifecycleHint='staff', identitySource='management'). GOS does not flip
// locally, so there is exactly one acceptance path and one event. On recruitment
// failure we fail visibly and change nothing.
router.post(
  '/:id/accept-to-team',
  handle(async (req, res) => {
    const person = await prisma.personRef.findUnique({
      where: { id: req.params.id },
      select: { id: true, externalPersonId: true, lifecycleHint: true },
    });
    if (!person) return res.status(404).json({ error: 'not_found' });
    if (person.lifecycleHint !== 'trainee') {
      return res.status(400).json({ error: 'not_a_trainee' });
    }
    const base = process.env.RECRUITMENT_API_BASE_URL;
    const secret = process.env.STAFF_EVENT_SECRET;
    if (!base || !secret) return res.status(500).json({ error: 'recruitment_trigger_not_configured' });

    let r;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      r = await fetch(`${String(base).replace(/\/+$/, '')}/api/staff/accept-to-team`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-staff-event-secret': secret },
        body: JSON.stringify({ externalPersonId: person.externalPersonId }),
        signal: ctl.signal,
      });
      clearTimeout(t);
    } catch (e) {
      return res.status(502).json({ error: 'recruitment_unavailable', detail: e?.message || 'network error' });
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(502).json({ error: 'recruitment_accept_failed', status: r.status, detail: txt.slice(0, 300) });
    }
    // Recruitment recorded acceptance + emitted accepted_to_team, which GOS ingested
    // synchronously (staffEvents) → this PersonRef is now staff. Return the fresh row.
    const updated = await prisma.personRef.findUnique({
      where: { id: person.id },
      include: PERSON_INCLUDE,
    });
    res.json({ ok: true, person: updated });
  }),
);

// ---------- Evaluator portal link (GOS-initiated regenerate) ----------
// GOS is the user-facing place to (re)generate the evaluator ("פורטל ממשב") link.
// The token still physically lives in recruitment (temporary), so GOS triggers
// recruitment's secret-gated rotate, which get-or-creates the guide's evaluator
// and issues one fresh token. GOS builds and returns the /e/<token> URL. Only
// guides have an evaluator portal. Visible error on failure (no hidden fallback).
router.post(
  '/:id/evaluator-portal/rotate',
  handle(async (req, res) => {
    const person = await prisma.personRef.findUnique({
      where: { id: req.params.id },
      select: { externalPersonId: true, lifecycleHint: true },
    });
    if (!person) return res.status(404).json({ error: 'not_found' });
    // Eligible = a staff member sourced from a guide OR a candidate (both can be a
    // mentor/evaluator). Recruitment resolves the evaluator by guide_id / candidate_id.
    const ext = String(person.externalPersonId || '');
    const eligible = person.lifecycleHint === 'staff' && (ext.startsWith('guide:') || ext.startsWith('candidate:'));
    if (!eligible) {
      return res.status(400).json({ error: 'not_eligible', message: 'פורטל ממשב זמין לאנשי צוות בלבד' });
    }
    const base = process.env.RECRUITMENT_API_BASE_URL;
    const secret = process.env.STAFF_EVENT_SECRET;
    if (!base || !secret) return res.status(500).json({ error: 'recruitment_trigger_not_configured' });

    let r;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      r = await fetch(`${String(base).replace(/\/+$/, '')}/api/staff/evaluator-portal/rotate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-staff-event-secret': secret },
        body: JSON.stringify({ externalPersonId: person.externalPersonId }),
        signal: ctl.signal,
      });
      clearTimeout(t);
    } catch (e) {
      return res.status(502).json({ error: 'recruitment_unavailable', detail: e?.message || 'network error' });
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(502).json({ error: 'evaluator_portal_rotate_failed', status: r.status, detail: txt.slice(0, 300) });
    }
    const body = await r.json().catch(() => ({}));
    res.json({ ok: true, url: evaluatorPortalUrl(body.token) });
  }),
);

// ---------- Reject in training (GOS-initiated trigger) ----------
// The GOS admin can start a "reject in training". Recruitment is the ONLY system
// that RECORDS the rejection outcome, so GOS calls recruitment first; only on
// recruitment success does GOS apply its effect (revoke access + HARD DELETE the
// PersonRef). GOS never records a rejection status. On recruitment failure we fail
// visibly and change nothing (no false rejection).
router.post(
  '/:id/reject-training',
  handle(async (req, res) => {
    const person = await prisma.personRef.findUnique({
      where: { id: req.params.id },
      select: { id: true, externalPersonId: true, lifecycleHint: true },
    });
    if (!person) return res.status(404).json({ error: 'not_found' });
    if (person.lifecycleHint !== 'trainee') {
      return res.status(400).json({ error: 'not_a_trainee' });
    }
    const base = process.env.RECRUITMENT_API_BASE_URL;
    const secret = process.env.STAFF_EVENT_SECRET;
    if (!base || !secret) return res.status(500).json({ error: 'recruitment_trigger_not_configured' });

    let r;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      r = await fetch(`${String(base).replace(/\/+$/, '')}/api/staff/reject-training`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-staff-event-secret': secret },
        body: JSON.stringify({ externalPersonId: person.externalPersonId }),
        signal: ctl.signal,
      });
      clearTimeout(t);
    } catch (e) {
      return res.status(502).json({ error: 'recruitment_unavailable', detail: e?.message || 'network error' });
    }
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(502).json({ error: 'recruitment_reject_failed', status: r.status, detail: txt.slice(0, 300) });
    }
    // Recruitment recorded the outcome → apply GOS effect (revoke + delete).
    await prisma.personRef.update({ where: { id: person.id }, data: { portalEnabled: false, accessRevokedAt: new Date() } });
    await prisma.personRef.delete({ where: { id: person.id } });
    res.json({ ok: true, deleted: true });
  }),
);

// ---------- Image upload ----------
// Stored as a MediaAsset so we reuse the existing media pipeline (auth,
// caching, URL convention). The returned URL is what the client writes
// into PersonProfile.imageUrl.

// Step 1 of the crop flow — store the untouched original (profile untouched).
router.post(
  '/:id/image/original',
  express.raw({ type: '*/*', limit: '12mb' }),
  handle(async (req, res) => {
    const result = await storeImageAsset(prisma, {
      body: req.body,
      filename: req.query.filename,
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ url: result.url });
  }),
);

router.post(
  '/:id/image',
  express.raw({ type: '*/*', limit: '12mb' }),
  handle(async (req, res) => {
    // Shared pipeline with the guide-portal photo route (people/profileImage
    // .js) — validate, store MediaAsset, repoint profile; old assets stay.
    // `originalUrl` + `crop` come from the shared crop tool (recrop support).
    let crop = null;
    try {
      crop = req.query.crop ? JSON.parse(String(req.query.crop)) : null;
    } catch {
      /* malformed crop metadata is cosmetic — ignore */
    }
    const result = await storeProfileImage(prisma, req.params.id, {
      body: req.body,
      filename: req.query.filename,
      originalUrl: req.query.originalUrl ? String(req.query.originalUrl) : null,
      crop,
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    await recordPersonChanges(prisma, {
      personRefId: req.params.id,
      changes: diffPersonFields({ imageUrl: result.previousUrl }, { imageUrl: result.url }),
      origin: await userOrigin(req.adminAuth?.userId),
      source: 'admin',
    });
    res.status(201).json({ url: result.url, assetId: result.assetId });
  }),
);

// ---------- Delete ----------

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.personRef.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---------- Procedures categorization for this guide ----------
//
// Returns three buckets matching the admin profile spec:
//   * toLearn  — mandatory flows the guide still has to complete
//   * available — optional flows + any approved flows (the learner's
//     "reference shelf" — completed ones stay accessible)
//   * learned — approved flows only, with the guide's answers (read-only)
//
// Visibility rule for a flow to appear in any bucket:
//   flow.openToAll
//   OR the guide's teamRefId is in FlowTargetTeam for this flow
//   OR FlowTargetPerson exists for this flow + personRefId
//
// Category rule (requires the existing Attempt model):
//   * No attempt             → not_started
//   * status='in_progress'   → in_progress
//   * status='submitted'     → waiting_for_approval  (or needs_correction
//                              if any latest FlowAnswer.status='rejected')
//   * status='approved'      → approved
//
// Mandatory drives the bucket:
//   * mandatory AND (not approved) → toLearn
//   * approved                      → available + learned
//   * not mandatory AND not started → available
//   * not mandatory AND in progress → toLearn (the guide is actively
//     doing it; keep it visible in the "pending" bucket until they stop
//     or finish — otherwise pausing an optional flow would lose it from
//     the learn view)

router.get(
  '/:id/procedures',
  handle(async (req, res) => {
    const person = await prisma.personRef.findUnique({
      where: { id: req.params.id },
      select: { id: true, externalPersonId: true, teamRefId: true },
    });
    if (!person) return res.status(404).json({ error: 'not found' });

    // All visible flows. The OR list covers the three visibility paths.
    const visibleFlows = await prisma.flow.findMany({
      where: {
        status: 'published',
        OR: [
          { openToAll: true },
          person.teamRefId
            ? { targetTeams: { some: { teamRefId: person.teamRefId } } }
            : { id: '__never_match__' },
          { targetPeople: { some: { personRefId: person.id } } },
        ],
      },
      select: {
        id: true,
        title: true,
        description: true,
        mandatory: true,
        openToAll: true,
        updatedAt: true,
      },
      orderBy: [{ mandatory: 'desc' }, { title: 'asc' }],
    });

    if (visibleFlows.length === 0) {
      return res.json({ toLearn: [], available: [], learned: [] });
    }

    // Latest attempt per flow for this person. We take ALL attempts so we
    // can compute answers for the "learned" bucket, then fold by flow.
    const attempts = await prisma.attempt.findMany({
      where: {
        externalPersonId: person.externalPersonId,
        flowId: { in: visibleFlows.map((f) => f.id) },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        answers: {
          orderBy: [{ stepId: 'asc' }, { version: 'desc' }],
        },
      },
    });

    // Keep only the most recent attempt per flow (first match because
    // ordered desc).
    const latestByFlow = new Map();
    for (const a of attempts) {
      if (!latestByFlow.has(a.flowId)) latestByFlow.set(a.flowId, a);
    }

    const toLearn = [];
    const available = [];
    const learned = [];

    for (const flow of visibleFlows) {
      const attempt = latestByFlow.get(flow.id) || null;
      const state = deriveState(attempt);
      const row = {
        flowId: flow.id,
        title: flow.title,
        description: flow.description,
        mandatory: flow.mandatory,
        openToAll: flow.openToAll,
        attemptId: attempt?.id || null,
        state,
        submittedAt: attempt?.submittedAt || null,
        approvedAt: attempt?.approvedAt || null,
      };

      if (state === 'approved') {
        available.push(row);
        learned.push({
          ...row,
          answers: latestAnswers(attempt),
        });
      } else if (!flow.mandatory && state === 'not_started') {
        available.push(row);
      } else {
        toLearn.push(row);
      }
    }

    res.json({ toLearn, available, learned });
  }),
);

// Derive a guide-facing state from an Attempt row. Returns one of:
//   'not_started' | 'in_progress' | 'waiting_for_approval'
//   | 'needs_correction' | 'approved'
function deriveState(attempt) {
  if (!attempt) return 'not_started';
  if (attempt.status === 'in_progress') return 'in_progress';
  if (attempt.status === 'approved') return 'approved';
  if (attempt.status === 'submitted') {
    // Latest FlowAnswer per step; if any is rejected, the learner has
    // corrections to make.
    const latestPerStep = new Map();
    for (const ans of attempt.answers) {
      if (!latestPerStep.has(ans.stepId)) {
        latestPerStep.set(ans.stepId, ans);
      }
    }
    for (const ans of latestPerStep.values()) {
      if (ans.status === 'rejected') return 'needs_correction';
    }
    return 'waiting_for_approval';
  }
  return 'in_progress';
}

// Flatten to the latest answer per step (for the "שנלמדו" read-only view).
// Keyed by stepId so folderRef-derived answers (which have null
// flowNodeId) appear too.
function latestAnswers(attempt) {
  if (!attempt) return [];
  const latestPerStep = new Map();
  for (const ans of attempt.answers) {
    if (!latestPerStep.has(ans.stepId)) {
      latestPerStep.set(ans.stepId, {
        stepId: ans.stepId,
        flowNodeId: ans.flowNodeId, // may be null for folderRef-expanded
        questionItemId: ans.questionItemId,
        openText: ans.openText,
        answerChoice: ans.answerChoice,
        answerLabel: ans.answerLabel,
        status: ans.status,
        adminComment: ans.adminComment,
        reviewedAt: ans.reviewedAt,
      });
    }
  }
  return Array.from(latestPerStep.values());
}

export default router;
