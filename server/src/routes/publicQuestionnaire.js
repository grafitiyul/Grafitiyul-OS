import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import {
  sendQError,
  publicFormPayload,
  publicSaveAnswers,
  publicSubmit,
} from '../questionnaires/service.js';

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

// Final submit — full server-side validation; 422 problems render inline.
router.post('/form/:token/submit', qh(async (req, res) => {
  await publicSubmit(req.params.token, req.body?.answers);
  res.json({ ok: true });
}));

export default router;
