import crypto from 'node:crypto';
import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { detectMime, kindOfMime } from '../media/detectMime.js';
import { getRecruitmentSnapshot } from './recruitment.js';

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

  for (const p of snap.people) {
    const externalPersonId = String(p.externalPersonId || '').trim();
    const displayName = String(p.displayName || '').trim();
    if (!externalPersonId || !displayName) continue;

    const existing = await prisma.personRef.findUnique({
      where: { externalPersonId },
    });
    if (existing) {
      // GOS OWNS the roster + lifecycle (Slices B–E). The pull is now ONLY an
      // identity mirror for EXISTING people (name/email/phone — identity
      // ownership is intentionally deferred). lifecycleHint is never touched;
      // portalEnabled / access / profile / teamRef are local-only.
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

  // Reconcile safety net (Slice D): a GOS 'trainee' no longer in the recruitment
  // active roster was rejected/dropped upstream and its direct event push may have
  // been missed → remove it (revoke + HARD DELETE). ONLY trainees — staff / former
  // / none are GOS-owned and never auto-removed. Skipped when the snapshot is empty
  // (guards against wiping everyone on a bad/empty fetch).
  let removed = 0;
  if (snap.people.length > 0) {
    const roster = new Set(
      snap.people.map((p) => String(p.externalPersonId || '').trim()).filter(Boolean),
    );
    const trainees = await prisma.personRef.findMany({
      where: { lifecycleHint: 'trainee' },
      select: { id: true, externalPersonId: true },
    });
    for (const t of trainees) {
      if (!roster.has(t.externalPersonId)) {
        await prisma.personRef.update({ where: { id: t.id }, data: { portalEnabled: false, accessRevokedAt: new Date() } });
        await prisma.personRef.delete({ where: { id: t.id } });
        removed += 1;
      }
    }
  }

  return { updated, missingFromGos, removed, total: snap.people.length };
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
    try {
      const r = await syncFromUpstream();
      upstream = {
        ok: true,
        syncedAt: new Date().toISOString(),
        updated: r.updated,
        missingFromGos: r.missingFromGos,
        removed: r.removed,
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

    res.json({ people, upstream });
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
// When identitySource='recruitment', only the fields we cache locally
// (displayName / email / phone) are writable — the admin can still correct
// a stale mirror. When identitySource='management' (future), the same
// fields become authoritative. Either way, the same endpoint.

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
    const person = await prisma.personRef.update({
      where: { id: req.params.id },
      data,
      include: PERSON_INCLUDE,
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
    if (imageUrl !== undefined) data.imageUrl = imageUrl || null;
    if (description !== undefined) data.description = description || null;
    if (notes !== undefined) data.notes = notes || null;
    if (bankDetails !== undefined) data.bankDetails = bankDetails ?? undefined;

    const profile = await prisma.personProfile.upsert({
      where: { personRefId: req.params.id },
      update: data,
      create: { personRefId: req.params.id, ...data },
    });
    res.json(profile);
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

const MAX_IMAGE = 10 * 1024 * 1024; // 10 MB is plenty for profile photos
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

router.post(
  '/:id/image',
  express.raw({ type: '*/*', limit: '12mb' }),
  handle(async (req, res) => {
    const body = req.body;
    const filename = String(req.query.filename || 'profile').slice(0, 200);
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'empty_body' });
    }
    if (body.length > MAX_IMAGE) {
      return res.status(413).json({ error: 'too_large' });
    }
    const mime = detectMime(body);
    if (!mime || kindOfMime(mime) !== 'image' || !ALLOWED_IMAGE.has(mime)) {
      return res
        .status(400)
        .json({ error: 'unsupported_or_corrupt_image' });
    }

    // Persist the image and update the profile in one transaction so a
    // successful upload always leaves imageUrl pointing at a real asset.
    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.create({
        data: {
          kind: 'image',
          mimeType: mime,
          filename,
          byteSize: body.length,
          bytes: body,
        },
        select: { id: true },
      });
      const url = `/api/media/${asset.id}`;
      const profile = await tx.personProfile.upsert({
        where: { personRefId: req.params.id },
        update: { imageUrl: url },
        create: { personRefId: req.params.id, imageUrl: url },
      });
      return { asset, profile };
    });

    res.status(201).json({
      url: result.profile.imageUrl,
      assetId: result.asset.id,
    });
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
