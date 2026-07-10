import express, { Router } from 'express';
import { handle } from '../asyncHandler.js';
import {
  sendQError,
  publicFormPayload,
  publicSaveAnswers,
  publicSubmit,
  resolvePublicLink,
} from '../questionnaires/service.js';
import { storeQuestionnaireUpload, MAX_UPLOAD_BYTES } from '../questionnaires/uploads.js';

// PUBLIC (unauthenticated) questionnaire fill — token-gated, same philosophy
// as the public quote page: the high-entropy QuestionnaireLink.token is the
// whole capability; no id enumeration, no admin data, and `/api` is already
// no-store so the customer always sees the live published form.
//
// The subject (which Booking / TourEvent) ALWAYS comes from the link row —
// a token can never be redirected to another booking by request input.

const router = Router();

const qh = (fn) =>
  handle(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!sendQError(res, e)) throw e;
    }
  });

// Load (and start-or-resume) the form behind a token.
router.get('/form/:token', qh(async (req, res) => {
  res.json(await publicFormPayload(req.params.token));
}));

// Draft autosave — best-effort, draft-only (server refuses after submit).
router.put('/form/:token/answers', qh(async (req, res) => {
  res.json(await publicSaveAnswers(req.params.token, req.body?.answers));
}));

// Answer upload — gated by a LIVE link token (resolve throws 404 otherwise),
// images + PDF only, magic-byte sniffed, 15MB cap. The stored asset id is
// unguessable and the answer merely references it.
router.post(
  '/form/:token/upload',
  express.raw({ type: '*/*', limit: `${Math.ceil(MAX_UPLOAD_BYTES / 1024 / 1024) + 1}mb` }),
  qh(async (req, res) => {
    await resolvePublicLink(req.params.token); // capability check first
    res.status(201).json(await storeQuestionnaireUpload(req.body, req.query.filename));
  }),
);

// Final submit — full server-side validation; 422 problems render inline.
// `language` records what the customer actually saw (manual switch mid-fill).
router.post('/form/:token/submit', qh(async (req, res) => {
  await publicSubmit(req.params.token, req.body?.answers, req.body?.language);
  res.json({ ok: true });
}));

export default router;
