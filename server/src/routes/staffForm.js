// Staff form fill — token-gated, UNAUTHENTICATED, single-form capability.
//
// This route exists to replace guide-portal deep links in operational messages.
// A token here authorizes ONE questionnaire instance and nothing else: there is
// no route to a tour list, a profile, payments, training or another booking's
// form, because none of those endpoints live under this router.
//
// The subject always comes from the link row (see staffForm.js), so there is no
// id in any path but the token and nothing to enumerate.

import express, { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { sendQError } from '../questionnaires/service.js';
import { staffFormPayload, staffSaveAnswers, staffSubmit } from '../questionnaires/staffForm.js';
import { resolveStaffFormLink } from '../questionnaires/staffLinks.js';
import { storeQuestionnaireUpload, MAX_UPLOAD_BYTES } from '../questionnaires/uploads.js';

const router = Router();

const qh = (fn) =>
  handle(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!sendQError(res, e)) throw e;
    }
  });

router.get('/form/:token', qh(async (req, res) => {
  res.json(await staffFormPayload(req.params.token));
}));

router.put('/form/:token/answers', qh(async (req, res) => {
  res.json(await staffSaveAnswers(req.params.token, req.body?.answers));
}));

router.post(
  '/form/:token/upload',
  express.raw({ type: '*/*', limit: `${Math.ceil(MAX_UPLOAD_BYTES / 1024 / 1024) + 1}mb` }),
  qh(async (req, res) => {
    await resolveStaffFormLink(req.params.token); // capability check first
    res.status(201).json(await storeQuestionnaireUpload(req.body, req.query.filename));
  }),
);

router.post('/form/:token/submit', qh(async (req, res) => {
  await staffSubmit(req.params.token, req.body?.answers, req.body?.language);
  res.json({ ok: true });
}));

export default router;
