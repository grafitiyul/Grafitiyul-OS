import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { resolveGuidePortalAccess } from '../tours/guidePortal/access.js';
import {
  diffPersonFields,
  normalizeBankDetails,
  personChangeSnapshot,
  recordPersonChanges,
} from '../timeline/personChangelog.js';
import { storeImageAsset, storeProfileImage } from '../people/profileImage.js';

// Guide Portal → פרטים אישיים. Same portal-token credential; the guide can
// VIEW their own operational identity and — when the editPersonalProfile
// permission is on — update name, photo, contact details and bank details.
//
// Product rules:
//   * bank details are NOT secret (every admin may view them) but they are
//     exposed ONLY here and in admin staff management — never in tour DTOs,
//     never to other guides.
//   * every change is recorded in the immutable person changelog
//     (timeline/personChangelog.js, source='guide_portal').
//   * internal admin notes are never exposed.
//
// Caveat (documented, accepted): PersonRef identity mirrors recruitment for
// some staff — a later lifecycle push may refresh name/email/phone.

const router = Router();

function fail(res, r) {
  return res.status(r.status).json({ error: r.error });
}

const LIFECYCLE_LABELS = {
  trainee: 'מתלמד',
  staff: 'צוות',
  evaluator: 'מעריך',
};

function guideOrigin(person) {
  return {
    actorType: 'api',
    actorLabel: `מדריך · ${person.displayName}`,
    createdBy: null,
    createdByName: null,
  };
}

function profileDto(person, profile, permissions) {
  const bank = normalizeBankDetails(profile?.bankDetails);
  return {
    displayName: person.displayName,
    email: person.email || null,
    phone: person.phone || null,
    imageUrl: profile?.imageUrl || null,
    // Recrop support — the untouched original + the crop that produced the
    // current avatar (prefills the shared crop tool).
    imageOriginalUrl: profile?.imageOriginalUrl || null,
    imageCrop: profile?.imageCrop || null,
    lifecycleLabel: LIFECYCLE_LABELS[person.lifecycleHint] || null,
    bank,
    canEdit: permissions.editPersonalProfile,
  };
}

router.get(
  '/:token/profile',
  handle(async (req, res) => {
    const access = await resolveGuidePortalAccess(prisma, {
      portalToken: req.params.token,
    });
    if (!access.ok) return fail(res, access);
    const profile = await prisma.personProfile.findUnique({
      where: { personRefId: access.person.id },
      select: { imageUrl: true, imageOriginalUrl: true, imageCrop: true, bankDetails: true },
    });
    res.set('Cache-Control', 'no-store');
    res.json(profileDto(access.person, profile, access.permissions));
  }),
);

router.put(
  '/:token/profile',
  handle(async (req, res) => {
    const access = await resolveGuidePortalAccess(prisma, {
      portalToken: req.params.token,
    });
    if (!access.ok) return fail(res, access);
    if (!access.permissions.editPersonalProfile) {
      return res.status(403).json({ error: 'not_allowed' });
    }
    const b = req.body || {};

    // ---- identity fields (PersonRef) ----
    const identity = {};
    if (b.displayName !== undefined) {
      const name = String(b.displayName || '').trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: 'empty_name' });
      identity.displayName = name;
    }
    if (b.phone !== undefined) {
      const phone = String(b.phone || '').trim();
      if (phone && !/^[+\d][\d\s\-()]{5,19}$/.test(phone)) {
        return res.status(400).json({ error: 'invalid_phone' });
      }
      identity.phone = phone || null;
    }
    if (b.email !== undefined) {
      const email = String(b.email || '').trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'invalid_email' });
      }
      identity.email = email || null;
    }

    // ---- bank details (PersonProfile.bankDetails, structured) ----
    const bankTouched = b.bank !== undefined;
    const bank = bankTouched ? normalizeBankDetails(b.bank) : null;

    if (Object.keys(identity).length === 0 && !bankTouched) {
      return res.status(400).json({ error: 'no_valid_fields' });
    }

    const profileBefore = await prisma.personProfile.findUnique({
      where: { personRefId: access.person.id },
      select: { imageUrl: true, imageOriginalUrl: true, imageCrop: true, bankDetails: true },
    });
    const beforeSnap = personChangeSnapshot(access.person, profileBefore);

    if (Object.keys(identity).length > 0) {
      await prisma.personRef.update({ where: { id: access.person.id }, data: identity });
    }
    if (bankTouched) {
      await prisma.personProfile.upsert({
        where: { personRefId: access.person.id },
        update: { bankDetails: bank },
        create: { personRefId: access.person.id, bankDetails: bank },
      });
    }

    const afterSnap = personChangeSnapshot(
      { ...access.person, ...identity },
      { ...profileBefore, ...(bankTouched ? { bankDetails: bank } : {}) },
    );
    await recordPersonChanges(prisma, {
      personRefId: access.person.id,
      changes: diffPersonFields(beforeSnap, {
        ...(identity.displayName !== undefined ? { displayName: afterSnap.displayName } : {}),
        ...(identity.phone !== undefined ? { phone: afterSnap.phone } : {}),
        ...(identity.email !== undefined ? { email: afterSnap.email } : {}),
        ...(bankTouched
          ? {
              beneficiary: afterSnap.beneficiary,
              bank: afterSnap.bank,
              branch: afterSnap.branch,
              accountNumber: afterSnap.accountNumber,
            }
          : {}),
      }),
      origin: guideOrigin(access.person),
      source: 'guide_portal',
    });

    const profile = await prisma.personProfile.findUnique({
      where: { personRefId: access.person.id },
      select: { imageUrl: true, imageOriginalUrl: true, imageCrop: true, bankDetails: true },
    });
    const person = await prisma.personRef.findUnique({ where: { id: access.person.id } });
    res.json({ ok: true, ...profileDto(person, profile, access.permissions) });
  }),
);

// Profile photo — same shared pipeline as the admin upload (the shared crop
// tool renders the avatar client-side; the original + crop metadata are kept
// for recrop; previous assets stay available through history).

router.post(
  '/:token/profile/photo/original',
  express.raw({ type: '*/*', limit: '12mb' }),
  handle(async (req, res) => {
    const access = await resolveGuidePortalAccess(prisma, {
      portalToken: req.params.token,
    });
    if (!access.ok) return fail(res, access);
    if (!access.permissions.editPersonalProfile) {
      return res.status(403).json({ error: 'not_allowed' });
    }
    const result = await storeImageAsset(prisma, {
      body: req.body,
      filename: req.query.filename,
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ url: result.url });
  }),
);

router.post(
  '/:token/profile/photo',
  express.raw({ type: '*/*', limit: '12mb' }),
  handle(async (req, res) => {
    const access = await resolveGuidePortalAccess(prisma, {
      portalToken: req.params.token,
    });
    if (!access.ok) return fail(res, access);
    if (!access.permissions.editPersonalProfile) {
      return res.status(403).json({ error: 'not_allowed' });
    }
    let crop = null;
    try {
      crop = req.query.crop ? JSON.parse(String(req.query.crop)) : null;
    } catch {
      /* malformed crop metadata is cosmetic — ignore */
    }
    const result = await storeProfileImage(prisma, access.person.id, {
      body: req.body,
      filename: req.query.filename,
      originalUrl: req.query.originalUrl ? String(req.query.originalUrl) : null,
      crop,
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    await recordPersonChanges(prisma, {
      personRefId: access.person.id,
      changes: diffPersonFields({ imageUrl: result.previousUrl }, { imageUrl: result.url }),
      origin: guideOrigin(access.person),
      source: 'guide_portal',
    });
    res.status(201).json({ url: result.url });
  }),
);

export default router;
