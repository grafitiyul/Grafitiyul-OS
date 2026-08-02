// The staff form surface — load / autosave / submit for ONE token-scoped form.
//
// Mirrors the public surface's central rule: the SUBJECT ALWAYS COMES FROM THE
// LINK ROW. Nothing in the request can redirect a token to another booking,
// another tour, or another guide's summary. There is no id in any path except
// the token itself, so there is nothing to enumerate.
//
// Deliberately NOT reusing publicFormPayload: that path is hard-wired to
// `actor: 'public'` and its resolver refuses staff purposes. Sharing it would
// have meant loosening the guard that keeps internal forms off the customer
// surface. These are two capabilities with different rules, so they get two
// entry points over the same engine.

import { prisma } from '../db.js';
import {
  QError, loadVersion, runtimePayload, startSubmission,
  saveDraftAnswers, submitSubmission,
} from './service.js';
import { resolveStaffFormLink } from './staffLinks.js';
import { getSubjectAdapter, getPurpose } from './registry.js';

/**
 * Everything the staff fill page needs, for the ONE form this token authorizes.
 *
 * Note what is NOT here: no guide identity beyond the scope the link already
 * pins, no tour list, no navigation targets, no portal payload. The response is
 * the form and its own subject, and nothing else.
 */
export async function staffFormPayload(token) {
  const link = await resolveStaffFormLink(token);
  const { submission } = await startSubmission({
    templateId: link.templateId,
    subjectType: link.subjectType,
    subjectId: link.subjectId,
    // The link IS the authorization. The actor is recorded as the guide the
    // link was minted for — never taken from the request.
    actor: { type: 'staff', ref: null, name: null },
    actorScope: link.actorScope || undefined,
    linkId: link.id,
  });
  await prisma.questionnaireLink.update({
    where: { id: link.id },
    // Auditable access: every open of a scoped link is stamped.
    data: { lastUsedAt: new Date() },
  });

  const version = await loadVersion(submission.versionId);
  const adapter = link.subjectType ? getSubjectAdapter(link.subjectType) : null;
  const language = link.language || submission.language;
  const prefill = submission.status === 'draft' && adapter?.prefill
    ? await adapter.prefill(link.subjectId, language)
    : {};

  return {
    status: submission.status,
    language,
    // The subject snapshot the form itself needs (which booking / which tour),
    // frozen at start — the same context a guide sees on the tour page.
    subject: submission.subjectSnapshot || null,
    purposeLabelHe: getPurpose(link.purpose)?.labelHe || link.purpose,
    runtime: runtimePayload(version),
    answers: {
      ...prefill,
      ...Object.fromEntries((submission.answers || []).map((a) => [a.questionKey, a.value])),
    },
    submittedAt: submission.submittedAt,
    // A submitted form shows its read-only result rather than a blank form —
    // the link stays valid and stops being an edit surface.
    readOnly: submission.status !== 'draft',
  };
}

/** The link's own active submission. Request input can never redirect this. */
async function submissionForLink(link) {
  const submission = await prisma.questionnaireSubmission.findFirst({
    where: {
      subjectType: link.subjectType,
      subjectId: link.subjectId,
      purpose: link.purpose,
      ...(link.actorScope ? { actorScope: link.actorScope } : {}),
      status: { in: ['draft', 'submitted', 'reviewed'] },
    },
  });
  if (!submission) throw new QError(404, 'not_found');
  return submission;
}

export async function staffSaveAnswers(token, answers) {
  const link = await resolveStaffFormLink(token);
  const submission = await submissionForLink(link);
  return saveDraftAnswers(submission.id, answers);
}

export async function staffSubmit(token, answers, language) {
  const link = await resolveStaffFormLink(token);
  const submission = await submissionForLink(link);
  if (language) {
    await prisma.questionnaireSubmission.update({
      where: { id: submission.id },
      data: { language },
    });
  }
  // Goes through the CANONICAL submit path, so freezing, snapshots, timeline,
  // tour completion and the automation hook all behave identically to a form
  // filled from the admin surface. A scoped link changes access, not behaviour.
  return submitSubmission(submission.id, {
    answers,
    actor: { type: 'staff', ref: null, name: null },
  });
}
