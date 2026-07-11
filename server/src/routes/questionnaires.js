import express, { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { storeQuestionnaireUpload, MAX_UPLOAD_BYTES } from '../questionnaires/uploads.js';
import { listPurposes } from '../questionnaires/registry.js';
import { QUESTION_TYPE_KEYS } from '../questionnaires/types.js';
import {
  QError, sendQError,
  listTemplates, getTemplate, createTemplate, updateTemplateMeta, deleteTemplate,
  getVersionRuntime, updateVersionMeta, createNextDraft, publishVersion,
  createSection, updateSection, deleteSection,
  createQuestion, updateQuestion, deleteQuestion,
  createOption, updateOption, deleteOption, reorderOptions, updateLayout,
  getPurposeConfig, setPurposeConfig,
  startSubmission, getSubmission, saveDraftAnswers, submitSubmission, voidSubmission,
  listSubmissions, renderSubmissionAnswers, staffActorFromAuth,
  getOrCreatePublicLink, rotatePublicLink,
} from '../questionnaires/service.js';

// Questionnaire Engine — ADMIN routes (builder + staff submission flows).
// Public token-link routes land in a later slice on their own router.
// All business rules live in the service; this file is HTTP translation only.

const router = Router();

// handle() + typed QError translation in one wrapper.
const qh = (fn) =>
  handle(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!sendQError(res, e)) throw e;
    }
  });

// Staff actor from the admin session (attribution on submissions).
const staffActor = (req) => staffActorFromAuth(req.adminAuth);

// ── registry / config (literal paths BEFORE /:id) ───────────────────────────

router.get('/purposes', qh(async (_req, res) => {
  const purposes = listPurposes();
  const configs = await Promise.all(purposes.map((p) => getPurposeConfig(p.key)));
  res.json({
    questionTypes: QUESTION_TYPE_KEYS,
    purposes: purposes.map((p, i) => ({ ...p, config: configs[i] })),
  });
}));

router.put('/purpose-config/:purpose', qh(async (req, res) => {
  res.json(await setPurposeConfig(req.params.purpose, req.body?.templateId || null));
}));

// ── public links (operator side) ─────────────────────────────────────────────

// Get-or-create the ONE active public link for (subject, purpose). Returns the
// absolute URL the operator copies/sends (sending itself stays manual — GOS
// never auto-sends customer communication).
router.post('/links', qh(async (req, res) => {
  const { purpose, subjectType, subjectId } = req.body || {};
  const link = await getOrCreatePublicLink({ purpose, subjectType, subjectId });
  res.json({ ...link, url: `${req.protocol}://${req.get('host')}/form/${link.token}` });
}));

// Rotate: revoke the current link and mint a fresh token (old URL dies).
router.post('/links/:id/rotate', qh(async (req, res) => {
  const link = await rotatePublicLink(req.params.id);
  res.json({ ...link, url: `${req.protocol}://${req.get('host')}/form/${link.token}` });
}));

// Answer upload (staff fill) — images + PDF, magic-byte sniffed, 15MB cap.
// Returns the answer-value shape ({ assetId, url, name, mime, size }).
router.post(
  '/upload',
  express.raw({ type: '*/*', limit: `${Math.ceil(MAX_UPLOAD_BYTES / 1024 / 1024) + 1}mb` }),
  qh(async (req, res) => {
    res.status(201).json(await storeQuestionnaireUpload(req.body, req.query.filename));
  }),
);

// ── submissions ──────────────────────────────────────────────────────────────

router.get('/submissions', qh(async (req, res) => {
  const { subjectType, subjectId, purpose, templateId, status } = req.query;
  res.json(await listSubmissions({ subjectType, subjectId, purpose, templateId, status }));
}));

router.post('/submissions/start', qh(async (req, res) => {
  const { templateId, purpose, subjectType, subjectId, actorScope } = req.body || {};
  const { submission, created } = await startSubmission({
    templateId, purpose, subjectType, subjectId, actorScope,
    actor: await staffActor(req),
  });
  res.status(created ? 201 : 200).json(submission);
}));

router.get('/submissions/:id', qh(async (req, res) => {
  const { submission, runtime, prefill, lifecycle } = await getSubmission(req.params.id);
  res.json({
    submission,
    runtime,
    prefill,
    lifecycle,
    rendered: submission.status !== 'draft' ? renderSubmissionAnswers(submission) : null,
  });
}));

router.put('/submissions/:id/answers', qh(async (req, res) => {
  res.json(await saveDraftAnswers(req.params.id, req.body?.answers));
}));

router.post('/submissions/:id/submit', qh(async (req, res) => {
  const submission = await submitSubmission(req.params.id, {
    answers: req.body?.answers,
    actor: await staffActor(req),
  });
  res.json(submission);
}));

router.post('/submissions/:id/void', qh(async (req, res) => {
  res.json(await voidSubmission(req.params.id));
}));

// ── versions ─────────────────────────────────────────────────────────────────

router.get('/versions/:versionId', qh(async (req, res) => {
  res.json(await getVersionRuntime(req.params.versionId));
}));

router.put('/versions/:versionId', qh(async (req, res) => {
  await updateVersionMeta(req.params.versionId, req.body || {});
  res.json(await getVersionRuntime(req.params.versionId));
}));

router.post('/versions/:versionId/publish', qh(async (req, res) => {
  res.json(await publishVersion(req.params.versionId));
}));

router.put('/versions/:versionId/layout', qh(async (req, res) => {
  res.json(await updateLayout(req.params.versionId, req.body || {}));
}));

router.post('/versions/:versionId/sections', qh(async (req, res) => {
  res.status(201).json(await createSection(req.params.versionId, req.body || {}));
}));

// ── sections / questions / options ──────────────────────────────────────────

router.put('/sections/:sectionId', qh(async (req, res) => {
  res.json(await updateSection(req.params.sectionId, req.body || {}));
}));

router.delete('/sections/:sectionId', qh(async (req, res) => {
  await deleteSection(req.params.sectionId);
  res.status(204).end();
}));

router.post('/sections/:sectionId/questions', qh(async (req, res) => {
  res.status(201).json(await createQuestion(req.params.sectionId, req.body || {}));
}));

router.put('/questions/:questionId', qh(async (req, res) => {
  res.json(await updateQuestion(req.params.questionId, req.body || {}));
}));

router.delete('/questions/:questionId', qh(async (req, res) => {
  await deleteQuestion(req.params.questionId);
  res.status(204).end();
}));

router.post('/questions/:questionId/options', qh(async (req, res) => {
  res.status(201).json(await createOption(req.params.questionId, req.body || {}));
}));

router.put('/questions/:questionId/options/reorder', qh(async (req, res) => {
  res.json(await reorderOptions(req.params.questionId, req.body?.ids));
}));

router.put('/options/:optionId', qh(async (req, res) => {
  res.json(await updateOption(req.params.optionId, req.body || {}));
}));

router.delete('/options/:optionId', qh(async (req, res) => {
  await deleteOption(req.params.optionId);
  res.status(204).end();
}));

// ── templates (catch-all /:id LAST) ─────────────────────────────────────────

router.get('/', qh(async (req, res) => {
  res.json(await listTemplates({ purpose: req.query.purpose, status: req.query.status }));
}));

router.post('/', qh(async (req, res) => {
  res.status(201).json(await createTemplate(req.body || {}));
}));

router.get('/:id', qh(async (req, res) => {
  res.json(await getTemplate(req.params.id));
}));

router.put('/:id', qh(async (req, res) => {
  res.json(await updateTemplateMeta(req.params.id, req.body || {}));
}));

router.post('/:id/versions', qh(async (req, res) => {
  const r = await createNextDraft(req.params.id);
  res.status(r.existed ? 200 : 201).json(r);
}));

router.delete('/:id', qh(async (req, res) => {
  await deleteTemplate(req.params.id);
  res.status(204).end();
}));

export default router;
export { QError };
