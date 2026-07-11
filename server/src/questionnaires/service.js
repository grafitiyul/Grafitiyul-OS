// Questionnaire Engine service — the ONE DB-orchestration layer every route
// (admin builder now, tour + public routes in later slices) goes through.
// Blueprint: docs/architecture/questionnaire-engine-design.md.
//
// Hard invariants enforced here (not in routes):
//   • a PUBLISHED version accepts no structural writes (version_immutable)
//   • a SUBMITTED submission accepts no answer writes (submission_immutable)
//   • publish = validate → freeze → flip currentVersionId, atomically
//   • one ACTIVE submission per (subject, purpose) on singleton templates —
//     DB-enforced via singletonKey, race-safe via P2002 recovery
//   • subject binding goes through the Subject Adapter Registry, purpose
//     legality through the Purpose Registry

import crypto from 'node:crypto';
import { prisma } from '../db.js';
import './adapters/index.js';
import { normalizeLocalizedInput, resolveLocalized } from '../../../shared/questionnaire/localized.mjs';
import {
  newKey,
  orderedSections,
  flatQuestions,
  buildQuestionSnapshot,
  buildSingletonKey,
  cloneStructureForNewVersion,
} from './structure.js';
import { isKnownType, typeHasOptions } from './types.js';
import { validateVersionForPublish } from './publishRules.js';
import { validateSubmissionAnswers, sanitizeDraftAnswers } from './validation.js';
import { getPurpose, isValidPurpose, purposeAllowsSubject, getSubjectAdapter } from './registry.js';
import { submissionLifecycle } from './lifecyclePolicy.js';

// Typed service error → routes translate to HTTP without string-matching.
export class QError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function sendQError(res, e) {
  if (e instanceof QError) {
    res.status(e.status).json({ error: e.code, ...e.extra });
    return true;
  }
  return false;
}

// ── structure loading ────────────────────────────────────────────────────────

const STRUCTURE_INCLUDE = {
  sections: {
    orderBy: { sortOrder: 'asc' },
    include: {
      questions: {
        orderBy: { sortOrder: 'asc' },
        include: { options: { orderBy: { sortOrder: 'asc' } } },
      },
    },
  },
};

export async function loadVersion(versionId, client = prisma) {
  const version = await client.questionnaireVersion.findUnique({
    where: { id: versionId },
    include: { ...STRUCTURE_INCLUDE, template: true },
  });
  if (!version) throw new QError(404, 'version_not_found');
  return version;
}

function structureOf(version) {
  return { sections: version.sections };
}

// The exact payload the fill runtime consumes — one shape for preview (draft),
// staff fill and public fill.
export function runtimePayload(version) {
  const t = version.template;
  return {
    template: {
      id: t.id,
      key: t.key,
      purpose: t.purpose,
      title: t.title,
      description: t.description,
      audience: t.audience,
      defaultLanguage: t.defaultLanguage,
      supportedLanguages: t.supportedLanguages,
    },
    version: {
      id: version.id,
      versionNo: version.versionNo,
      status: version.status,
      displayMode: version.displayMode,
      intro: version.intro,
      outro: version.outro,
    },
    sections: orderedSections(structureOf(version)).map((s) => ({
      id: s.id,
      key: s.key,
      title: s.title,
      description: s.description,
      collapsible: s.collapsible,
      collapsedByDefault: s.collapsedByDefault,
      visibleWhen: s.visibleWhen,
      questions: s.questions.map((q) => ({
        id: q.id,
        key: q.key,
        type: q.type,
        label: q.label,
        helpText: q.helpText,
        placeholder: q.placeholder,
        required: q.required,
        config: q.config,
        visibleWhen: q.visibleWhen,
        options: q.options.map((o) => ({ id: o.id, value: o.value, label: o.label })),
      })),
    })),
  };
}

async function assertDraftVersion(versionId, client = prisma) {
  const v = await client.questionnaireVersion.findUnique({
    where: { id: versionId },
    select: { id: true, status: true, templateId: true },
  });
  if (!v) throw new QError(404, 'version_not_found');
  if (v.status !== 'draft') throw new QError(409, 'version_immutable');
  return v;
}

// ── templates ────────────────────────────────────────────────────────────────

const TEMPLATE_LIST_SELECT = {
  id: true, key: true, purpose: true, internalName: true, title: true,
  status: true, audience: true, defaultLanguage: true, supportedLanguages: true,
  singletonPerSubject: true, currentVersionId: true, createdAt: true, updatedAt: true,
  currentVersion: { select: { id: true, versionNo: true, publishedAt: true } },
  versions: {
    select: { id: true, versionNo: true, status: true, publishedAt: true, notes: true, updatedAt: true },
    orderBy: { versionNo: 'desc' },
  },
  _count: { select: { submissions: true } },
};

export async function listTemplates({ purpose, status } = {}) {
  return prisma.questionnaireTemplate.findMany({
    where: {
      ...(purpose ? { purpose } : {}),
      ...(status ? { status } : { status: { not: 'archived' } }),
    },
    select: TEMPLATE_LIST_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getTemplate(templateId) {
  const t = await prisma.questionnaireTemplate.findUnique({
    where: { id: templateId },
    select: TEMPLATE_LIST_SELECT,
  });
  if (!t) throw new QError(404, 'template_not_found');
  return t;
}

function slugifyKey(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return s || null;
}

export async function createTemplate({ internalName, purpose, key, title, audience }) {
  const name = String(internalName || '').trim();
  if (!name) throw new QError(400, 'internal_name_required');
  if (!isValidPurpose(purpose)) throw new QError(400, 'invalid_purpose');
  const p = getPurpose(purpose);
  const templateKey = slugifyKey(key) || `tpl_${crypto.randomBytes(4).toString('hex')}`;
  const titleMap = normalizeLocalizedInput(title, 'he') || { he: name };

  return prisma.$transaction(async (tx) => {
    const template = await tx.questionnaireTemplate.create({
      data: {
        key: templateKey,
        purpose,
        internalName: name,
        title: titleMap,
        audience: audience || p.audience || 'staff',
        singletonPerSubject: !!p.singleton,
        status: 'draft',
      },
    });
    // Every template starts with draft v1 + one default section, so the
    // builder always lands on something editable.
    await tx.questionnaireVersion.create({
      data: {
        templateId: template.id,
        versionNo: 1,
        status: 'draft',
        sections: { create: { key: newKey('s'), title: { he: 'כללי' }, sortOrder: 0 } },
      },
    });
    return template;
  }).catch((e) => {
    if (e?.code === 'P2002') throw new QError(409, 'template_key_taken');
    throw e;
  });
}

export async function updateTemplateMeta(templateId, patch) {
  const t = await prisma.questionnaireTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw new QError(404, 'template_not_found');
  const data = {};
  if (patch.internalName !== undefined) {
    const n = String(patch.internalName).trim();
    if (!n) throw new QError(400, 'internal_name_required');
    data.internalName = n;
  }
  if (patch.title !== undefined) {
    const m = normalizeLocalizedInput(patch.title);
    if (!m) throw new QError(400, 'title_required');
    data.title = m;
  }
  if (patch.description !== undefined) data.description = normalizeLocalizedInput(patch.description);
  if (patch.audience !== undefined) {
    if (!['public', 'staff', 'both'].includes(patch.audience)) throw new QError(400, 'invalid_audience');
    data.audience = patch.audience;
  }
  if (patch.defaultLanguage !== undefined) data.defaultLanguage = String(patch.defaultLanguage);
  if (patch.supportedLanguages !== undefined) {
    if (!Array.isArray(patch.supportedLanguages) || patch.supportedLanguages.length === 0) {
      throw new QError(400, 'invalid_supported_languages');
    }
    data.supportedLanguages = patch.supportedLanguages.map(String);
  }
  if (patch.allowResumeOnOldVersion !== undefined) data.allowResumeOnOldVersion = !!patch.allowResumeOnOldVersion;
  if (patch.status !== undefined) {
    if (!['draft', 'active', 'archived'].includes(patch.status)) throw new QError(400, 'invalid_status');
    data.status = patch.status;
  }
  return prisma.questionnaireTemplate.update({ where: { id: templateId }, data });
}

export async function deleteTemplate(templateId) {
  const t = await prisma.questionnaireTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, _count: { select: { submissions: true } } },
  });
  if (!t) throw new QError(404, 'template_not_found');
  if (t._count.submissions > 0) throw new QError(409, 'template_has_submissions');
  await prisma.questionnaireTemplate.delete({ where: { id: templateId } });
}

// ── versions ─────────────────────────────────────────────────────────────────

export async function getVersionRuntime(versionId) {
  const version = await loadVersion(versionId);
  return runtimePayload(version);
}

export async function updateVersionMeta(versionId, patch) {
  await assertDraftVersion(versionId);
  const data = {};
  if (patch.displayMode !== undefined) {
    if (!['full_list', 'step_by_step'].includes(patch.displayMode)) throw new QError(400, 'invalid_display_mode');
    data.displayMode = patch.displayMode;
  }
  if (patch.intro !== undefined) data.intro = normalizeLocalizedInput(patch.intro);
  if (patch.outro !== undefined) data.outro = normalizeLocalizedInput(patch.outro);
  if (patch.notes !== undefined) data.notes = patch.notes ? String(patch.notes).slice(0, 2000) : null;
  return prisma.questionnaireVersion.update({ where: { id: versionId }, data });
}

// New draft cloned from the template's current published version (§6). One
// draft at a time — a second call returns the existing draft (idempotent).
export async function createNextDraft(templateId) {
  const template = await prisma.questionnaireTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, currentVersionId: true },
  });
  if (!template) throw new QError(404, 'template_not_found');

  const existingDraft = await prisma.questionnaireVersion.findFirst({
    where: { templateId, status: 'draft' },
    select: { id: true },
  });
  if (existingDraft) return { id: existingDraft.id, existed: true };

  if (!template.currentVersionId) throw new QError(409, 'no_published_version');
  const current = await loadVersion(template.currentVersionId);
  const clonedSections = cloneStructureForNewVersion(structureOf(current));
  const last = await prisma.questionnaireVersion.findFirst({
    where: { templateId },
    orderBy: { versionNo: 'desc' },
    select: { versionNo: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const v = await tx.questionnaireVersion.create({
      data: {
        templateId,
        versionNo: (last?.versionNo ?? 0) + 1,
        status: 'draft',
        displayMode: current.displayMode,
        intro: current.intro,
        outro: current.outro,
      },
    });
    for (const s of clonedSections) {
      const { questions, ...sectionData } = s;
      const sec = await tx.questionnaireSection.create({ data: { ...sectionData, versionId: v.id } });
      for (const q of questions) {
        const { options, ...qData } = q;
        await tx.questionnaireQuestion.create({
          data: {
            ...qData,
            versionId: v.id,
            sectionId: sec.id,
            options: { create: options },
          },
        });
      }
    }
    return v;
  });
  return { id: created.id, existed: false };
}

export async function publishVersion(versionId) {
  const version = await loadVersion(versionId);
  if (version.status !== 'draft') throw new QError(409, 'version_not_draft');
  const errors = validateVersionForPublish({ template: version.template, structure: structureOf(version) });
  if (errors.length) throw new QError(422, 'publish_validation_failed', { problems: errors });

  return prisma.$transaction(async (tx) => {
    // Archive the previously-published version (history stays readable).
    if (version.template.currentVersionId && version.template.currentVersionId !== versionId) {
      await tx.questionnaireVersion.update({
        where: { id: version.template.currentVersionId },
        data: { status: 'archived' },
      });
    }
    const published = await tx.questionnaireVersion.update({
      where: { id: versionId },
      data: { status: 'published', publishedAt: new Date() },
    });
    await tx.questionnaireTemplate.update({
      where: { id: version.templateId },
      data: {
        currentVersionId: versionId,
        // First publish flips the template live.
        ...(version.template.status === 'draft' ? { status: 'active' } : {}),
      },
    });
    return published;
  });
}

// ── sections / questions / options (draft-only writes) ──────────────────────

export async function createSection(versionId, { title }) {
  await assertDraftVersion(versionId);
  const last = await prisma.questionnaireSection.findFirst({
    where: { versionId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return prisma.questionnaireSection.create({
    data: {
      versionId,
      key: newKey('s'),
      title: normalizeLocalizedInput(title, 'he') || { he: 'מקטע חדש' },
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
}

async function loadSectionDraft(sectionId) {
  const s = await prisma.questionnaireSection.findUnique({
    where: { id: sectionId },
    select: { id: true, versionId: true, version: { select: { status: true } } },
  });
  if (!s) throw new QError(404, 'section_not_found');
  if (s.version.status !== 'draft') throw new QError(409, 'version_immutable');
  return s;
}

export async function updateSection(sectionId, patch) {
  await loadSectionDraft(sectionId);
  const data = {};
  if (patch.title !== undefined) {
    const m = normalizeLocalizedInput(patch.title);
    if (!m) throw new QError(400, 'title_required');
    data.title = m;
  }
  if (patch.description !== undefined) data.description = normalizeLocalizedInput(patch.description);
  if (patch.collapsible !== undefined) data.collapsible = !!patch.collapsible;
  if (patch.collapsedByDefault !== undefined) data.collapsedByDefault = !!patch.collapsedByDefault;
  if (patch.visibleWhen !== undefined) data.visibleWhen = patch.visibleWhen ?? null;
  return prisma.questionnaireSection.update({ where: { id: sectionId }, data });
}

export async function deleteSection(sectionId) {
  await loadSectionDraft(sectionId);
  await prisma.questionnaireSection.delete({ where: { id: sectionId } });
}

export async function createQuestion(sectionId, input) {
  const s = await loadSectionDraft(sectionId);
  const type = String(input.type || '');
  if (!isKnownType(type)) throw new QError(400, 'unknown_question_type');
  const last = await prisma.questionnaireQuestion.findFirst({
    where: { sectionId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return prisma.questionnaireQuestion.create({
    data: {
      versionId: s.versionId,
      sectionId,
      key: newKey('q'),
      type,
      label: normalizeLocalizedInput(input.label, 'he') || { he: '' },
      helpText: normalizeLocalizedInput(input.helpText),
      placeholder: normalizeLocalizedInput(input.placeholder),
      required: !!input.required,
      config: input.config && typeof input.config === 'object' ? input.config : null,
      visibleWhen: input.visibleWhen ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    include: { options: true },
  });
}

async function loadQuestionDraft(questionId) {
  const q = await prisma.questionnaireQuestion.findUnique({
    where: { id: questionId },
    select: { id: true, versionId: true, type: true, version: { select: { status: true } } },
  });
  if (!q) throw new QError(404, 'question_not_found');
  if (q.version.status !== 'draft') throw new QError(409, 'version_immutable');
  return q;
}

export async function updateQuestion(questionId, patch) {
  const q = await loadQuestionDraft(questionId);
  const data = {};
  if (patch.type !== undefined) {
    if (!isKnownType(patch.type)) throw new QError(400, 'unknown_question_type');
    data.type = patch.type;
  }
  if (patch.label !== undefined) data.label = normalizeLocalizedInput(patch.label) || { he: '' };
  if (patch.helpText !== undefined) data.helpText = normalizeLocalizedInput(patch.helpText);
  if (patch.placeholder !== undefined) data.placeholder = normalizeLocalizedInput(patch.placeholder);
  if (patch.required !== undefined) data.required = !!patch.required;
  if (patch.config !== undefined) data.config = patch.config && typeof patch.config === 'object' ? patch.config : null;
  if (patch.visibleWhen !== undefined) data.visibleWhen = patch.visibleWhen ?? null;
  return prisma.questionnaireQuestion.update({
    where: { id: questionId },
    data,
    include: { options: { orderBy: { sortOrder: 'asc' } } },
  });
}

export async function deleteQuestion(questionId) {
  await loadQuestionDraft(questionId);
  await prisma.questionnaireQuestion.delete({ where: { id: questionId } });
}

export async function createOption(questionId, { label, value }) {
  const q = await loadQuestionDraft(questionId);
  if (!typeHasOptions(q.type)) throw new QError(400, 'type_has_no_options');
  const last = await prisma.questionnaireQuestionOption.findFirst({
    where: { questionId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return prisma.questionnaireQuestionOption.create({
    data: {
      questionId,
      value: String(value || '').trim() || newKey('o'),
      label: normalizeLocalizedInput(label, 'he') || { he: '' },
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  }).catch((e) => {
    if (e?.code === 'P2002') throw new QError(409, 'option_value_taken');
    throw e;
  });
}

export async function updateOption(optionId, patch) {
  const o = await prisma.questionnaireQuestionOption.findUnique({
    where: { id: optionId },
    select: { id: true, questionId: true, question: { select: { version: { select: { status: true } } } } },
  });
  if (!o) throw new QError(404, 'option_not_found');
  if (o.question.version.status !== 'draft') throw new QError(409, 'version_immutable');
  const data = {};
  if (patch.label !== undefined) data.label = normalizeLocalizedInput(patch.label) || { he: '' };
  if (patch.value !== undefined) {
    const v = String(patch.value).trim();
    if (!v) throw new QError(400, 'option_value_required');
    data.value = v;
  }
  return prisma.questionnaireQuestionOption.update({ where: { id: optionId }, data }).catch((e) => {
    if (e?.code === 'P2002') throw new QError(409, 'option_value_taken');
    throw e;
  });
}

export async function deleteOption(optionId) {
  const o = await prisma.questionnaireQuestionOption.findUnique({
    where: { id: optionId },
    select: { id: true, question: { select: { version: { select: { status: true } } } } },
  });
  if (!o) throw new QError(404, 'option_not_found');
  if (o.question.version.status !== 'draft') throw new QError(409, 'version_immutable');
  await prisma.questionnaireQuestionOption.delete({ where: { id: optionId } });
}

// One call persists the whole drag-and-drop layout: section order + per-
// section question order (moves across sections included).
export async function updateLayout(versionId, { sectionOrder, questions }) {
  await assertDraftVersion(versionId);
  const sections = await prisma.questionnaireSection.findMany({
    where: { versionId },
    select: { id: true },
  });
  const validSectionIds = new Set(sections.map((s) => s.id));
  const ops = [];
  if (Array.isArray(sectionOrder)) {
    sectionOrder.forEach((id, i) => {
      if (validSectionIds.has(id)) {
        ops.push(prisma.questionnaireSection.update({ where: { id }, data: { sortOrder: i } }));
      }
    });
  }
  if (questions && typeof questions === 'object') {
    for (const [sectionId, ids] of Object.entries(questions)) {
      if (!validSectionIds.has(sectionId) || !Array.isArray(ids)) continue;
      ids.forEach((qid, i) => {
        ops.push(prisma.questionnaireQuestion.updateMany({
          where: { id: qid, versionId },
          data: { sectionId, sortOrder: i },
        }));
      });
    }
  }
  if (ops.length) await prisma.$transaction(ops);
  return { ok: true };
}

export async function reorderOptions(questionId, ids) {
  await loadQuestionDraft(questionId);
  if (!Array.isArray(ids) || !ids.length) return { ok: true };
  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.questionnaireQuestionOption.updateMany({
        where: { id, questionId },
        data: { sortOrder: i },
      })),
  );
  return { ok: true };
}

// ── purpose config ───────────────────────────────────────────────────────────

export async function getPurposeConfig(purpose) {
  if (!isValidPurpose(purpose)) throw new QError(400, 'invalid_purpose');
  return prisma.questionnairePurposeConfig.findUnique({
    where: { purpose },
    include: { template: { select: TEMPLATE_LIST_SELECT } },
  });
}

export async function setPurposeConfig(purpose, templateId) {
  if (!isValidPurpose(purpose)) throw new QError(400, 'invalid_purpose');
  if (templateId) {
    const t = await prisma.questionnaireTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, purpose: true },
    });
    if (!t) throw new QError(404, 'template_not_found');
    if (t.purpose !== purpose) throw new QError(400, 'template_purpose_mismatch');
  }
  return prisma.questionnairePurposeConfig.upsert({
    where: { purpose },
    create: { purpose, templateId: templateId || null },
    update: { templateId: templateId || null },
    include: { template: { select: TEMPLATE_LIST_SELECT } },
  });
}

// ── submissions ──────────────────────────────────────────────────────────────

const SUBMISSION_INCLUDE = {
  answers: { orderBy: { sortOrder: 'asc' } },
  template: { select: { id: true, key: true, internalName: true, purpose: true, defaultLanguage: true, supportedLanguages: true, allowResumeOnOldVersion: true, currentVersionId: true } },
};

async function resolveSubjectOrThrow({ purpose, subjectType, subjectId }) {
  if (!purposeAllowsSubject(purpose, subjectType || null)) {
    throw new QError(400, 'subject_type_not_allowed');
  }
  if (!subjectType) return null;
  if (!subjectId) throw new QError(400, 'subject_id_required');
  const adapter = getSubjectAdapter(subjectType);
  if (!adapter) throw new QError(400, 'unknown_subject_type');
  if (!(await adapter.exists(subjectId))) throw new QError(404, 'subject_not_found');
  return adapter;
}

// Get-or-create the active submission for a subject+purpose (§14). Resume is
// the default: an existing draft/submitted submission is returned as-is.
export async function startSubmission({ templateId, purpose, subjectType, subjectId, actor, linkId, actorScope }) {
  let template;
  if (templateId) {
    template = await prisma.questionnaireTemplate.findUnique({ where: { id: templateId } });
  } else if (purpose) {
    const cfg = await prisma.questionnairePurposeConfig.findUnique({ where: { purpose } });
    if (!cfg?.templateId) throw new QError(409, 'purpose_not_configured');
    template = await prisma.questionnaireTemplate.findUnique({ where: { id: cfg.templateId } });
  }
  if (!template) throw new QError(404, 'template_not_found');
  if (template.status !== 'active') throw new QError(409, 'template_not_active');
  if (!template.currentVersionId) throw new QError(409, 'no_published_version');

  const adapter = await resolveSubjectOrThrow({
    purpose: template.purpose,
    subjectType: subjectType || null,
    subjectId: subjectId || null,
  });

  // perActor purposes (tour_summary): the submission belongs to ONE guide.
  // The scope is mandatory and must be a real assignee of the subject — the
  // adapter validates so the engine stays subject-agnostic.
  const perActor = !!getPurpose(template.purpose)?.perActor;
  const scope = perActor ? String(actorScope || '') : null;
  if (perActor) {
    if (!scope) throw new QError(400, 'actor_scope_required');
    if (adapter?.validateActorScope && !(await adapter.validateActorScope(subjectId, scope))) {
      throw new QError(400, 'invalid_actor_scope');
    }
  }

  // Resume path — the singleton's active submission wins.
  if (template.singletonPerSubject && subjectType && subjectId) {
    const existing = await prisma.questionnaireSubmission.findFirst({
      where: {
        subjectType, subjectId,
        purpose: template.purpose,
        ...(perActor ? { actorScope: scope } : {}),
        status: { in: ['draft', 'submitted', 'reviewed'] },
      },
      include: SUBMISSION_INCLUDE,
    });
    if (existing) return { submission: existing, created: false };
  }

  // No NEW tour-operational submission once its answers would already be
  // locked (closedAt + the purpose's grace). Within the tour summary's 48h
  // post-completion window a guide who hasn't started yet MAY still start.
  if (getPurpose(template.purpose)?.tourOperational && adapter?.closedAt && subjectId) {
    const closedAt = await adapter.closedAt(subjectId);
    const probe = submissionLifecycle({ purpose: template.purpose, status: 'draft', frozenAt: null }, closedAt);
    if (probe.answersLocked) throw new QError(409, 'subject_closed');
  }

  // Staff-audience purposes are INTERNAL forms — they render in the
  // template's own language (typically Hebrew → RTL), never the tour/customer
  // language the adapter resolves. That customer-language leak is what made
  // internal Hebrew questionnaires render left-aligned LTR on English tours.
  const language =
    (getPurpose(template.purpose)?.audience === 'staff'
      ? template.defaultLanguage
      : adapter && (await adapter.resolveLanguage?.(subjectId))) ||
    template.defaultLanguage ||
    'he';
  const subjectSnapshot = adapter ? await adapter.displayContext?.(subjectId, language) : null;

  let submission;
  try {
    submission = await prisma.questionnaireSubmission.create({
      data: {
        templateId: template.id,
        versionId: template.currentVersionId,
        subjectType: subjectType || null,
        subjectId: subjectId || null,
        purpose: template.purpose,
        status: 'draft',
        language: template.supportedLanguages.includes(language) ? language : template.defaultLanguage,
        submittedByType: actor?.type || 'staff',
        submittedByRef: actor?.ref || null,
        submittedByName: actor?.name || null,
        linkId: linkId || null,
        subjectSnapshot: subjectSnapshot || undefined,
        actorScope: scope,
        singletonKey: template.singletonPerSubject
          ? buildSingletonKey({ subjectType, subjectId, purpose: template.purpose, actorScope: scope })
          : null,
      },
      include: SUBMISSION_INCLUDE,
    });
  } catch (e) {
    if (e?.code === 'P2002') {
      // Concurrent start won the singleton race — return the winner.
      const winner = await prisma.questionnaireSubmission.findFirst({
        where: {
          subjectType, subjectId,
          purpose: template.purpose,
          ...(perActor ? { actorScope: scope } : {}),
          status: { in: ['draft', 'submitted', 'reviewed'] },
        },
        include: SUBMISSION_INCLUDE,
      });
      if (winner) return { submission: winner, created: false };
    }
    throw e;
  }

  if (adapter?.onStarted) {
    try {
      await adapter.onStarted(subjectId, submission, prisma);
    } catch (err) {
      console.warn(`questionnaire onStarted hook failed for ${subjectType}:${subjectId}:`, err.message);
    }
  }
  return { submission, created: true };
}

// ── tour-operational lifecycle (live-until-frozen) ──────────────────────────
// For tourOperational purposes the stored versionId is only "last resolved":
// until frozenAt is set the submission follows template.currentVersionId, and
// the STRUCTURE FREEZE (version pin + per-answer snapshots) happens ONCE —
// lazily, the first time the submission is touched after its tour closed.
// The ANSWER LOCK is a separate, derived concept: closedAt + the purpose's
// answerLockGraceMs (lifecyclePolicy) — a structure-frozen tour summary stays
// answer-editable through its 48h post-completion window.

// Pin the historical record: snapshot every answer against the (already
// synced) version, then stamp frozenAt. Answers whose question no longer
// exists keep whatever snapshot they had — data is never dropped by a freeze.
async function freezeSubmission(submission) {
  const answers = await prisma.questionnaireAnswer.findMany({
    where: { submissionId: submission.id },
  });
  const version = await loadVersion(submission.versionId);
  const structure = structureOf(version);
  const questions = flatQuestions(structure);
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const orderOf = new Map(questions.map((q, i) => [q.key, i]));
  const defaultLanguage = version.template.defaultLanguage;
  await prisma.$transaction(async (tx) => {
    for (const a of answers) {
      const q = byKey.get(a.questionKey);
      await tx.questionnaireAnswer.update({
        where: { id: a.id },
        data: {
          questionId: q?.id || null,
          questionSnapshot: q
            ? buildQuestionSnapshot(q, submission.language, defaultLanguage)
            : a.questionSnapshot,
          sortOrder: orderOf.get(a.questionKey) ?? a.sortOrder ?? 0,
        },
      });
    }
    await tx.questionnaireSubmission.update({
      where: { id: submission.id },
      data: { frozenAt: new Date() },
    });
  });
}

// Resolve the CURRENT lifecycle state of a loaded submission row and apply
// its side effects: sync to the live published version while the tour is
// open, or structure-freeze once it closed. Returns the (possibly updated)
// row + lifecycle. Row needs: id, templateId, versionId, purpose, status,
// frozenAt, language, subjectType, subjectId.
async function applyLifecycle(submission) {
  const base = submissionLifecycle(submission);
  if (!base.liveVersion) return { submission, lifecycle: base };

  const adapter = submission.subjectType ? getSubjectAdapter(submission.subjectType) : null;
  const closedAt = adapter?.closedAt ? await adapter.closedAt(submission.subjectId) : null;

  let out = submission;
  if (!out.frozenAt) {
    if (closedAt) {
      // Tour closed → structure freeze NOW (version pin + snapshots). Answers
      // may still be editable within the purpose's post-completion window.
      await freezeSubmission(out);
      out = { ...out, frozenAt: new Date() };
    } else {
      // Tour still open → follow the CURRENT published version, and normalize
      // legacy rows that inherited the tour/customer language to the
      // template's own language (internal forms render RTL Hebrew).
      const template = await prisma.questionnaireTemplate.findUnique({
        where: { id: out.templateId },
        select: { currentVersionId: true, defaultLanguage: true },
      });
      const sync = {};
      if (template?.currentVersionId && template.currentVersionId !== out.versionId) {
        sync.versionId = template.currentVersionId;
      }
      if (template?.defaultLanguage && out.language !== template.defaultLanguage) {
        sync.language = template.defaultLanguage;
      }
      if (Object.keys(sync).length) {
        await prisma.questionnaireSubmission.update({ where: { id: out.id }, data: sync });
        out = { ...out, ...sync };
      }
    }
  }
  return { submission: out, lifecycle: submissionLifecycle(out, closedAt) };
}

export async function getSubmission(submissionId) {
  const loaded = await prisma.questionnaireSubmission.findUnique({
    where: { id: submissionId },
    include: SUBMISSION_INCLUDE,
  });
  if (!loaded) throw new QError(404, 'submission_not_found');
  const { submission, lifecycle } = await applyLifecycle(loaded);
  const version = await loadVersion(submission.versionId);
  const prefill =
    submission.status === 'draft' && submission.subjectType
      ? (await getSubjectAdapter(submission.subjectType)?.prefill?.(submission.subjectId, submission.language)) || {}
      : {};
  return {
    submission,
    runtime: runtimePayload(version),
    prefill,
    lifecycle: { ...lifecycle, frozenAt: submission.frozenAt || null },
  };
}

export async function saveDraftAnswers(submissionId, answers) {
  const loaded = await prisma.questionnaireSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true, templateId: true, versionId: true, purpose: true,
      status: true, frozenAt: true, language: true, subjectType: true, subjectId: true,
    },
  });
  if (!loaded) throw new QError(404, 'submission_not_found');
  const { submission, lifecycle } = await applyLifecycle(loaded);
  if (lifecycle.answersLocked) throw new QError(409, 'submission_frozen');
  if (!lifecycle.editable) throw new QError(409, 'submission_immutable');

  const version = await loadVersion(submission.versionId);
  const structure = structureOf(version);
  const { accepted, removed } = sanitizeDraftAnswers(structure, answers);
  const byKey = new Map(flatQuestions(structure).map((q) => [q.key, q]));

  const ops = [];
  for (const key of removed) {
    ops.push(prisma.questionnaireAnswer.deleteMany({ where: { submissionId, questionKey: key } }));
  }
  for (const [key, value] of Object.entries(accepted)) {
    ops.push(prisma.questionnaireAnswer.upsert({
      where: { submissionId_questionKey: { submissionId, questionKey: key } },
      create: { submissionId, questionKey: key, questionId: byKey.get(key)?.id || null, value },
      update: { value },
    }));
  }
  if (ops.length) await prisma.$transaction(ops);
  await prisma.questionnaireSubmission.update({ where: { id: submissionId }, data: { updatedAt: new Date() } });
  return { ok: true, saved: Object.keys(accepted).length, cleared: removed.length };
}

// Final submit: server-authoritative validation → frozen answers with
// per-question snapshots → status flip → subject onSubmitted hook (atomic
// with the freeze — timeline is local DB).
export async function submitSubmission(submissionId, { answers, actor } = {}) {
  const loaded = await prisma.questionnaireSubmission.findUnique({
    where: { id: submissionId },
    include: { answers: true },
  });
  if (!loaded) throw new QError(404, 'submission_not_found');
  const { submission, lifecycle } = await applyLifecycle(loaded);
  if (lifecycle.answersLocked) throw new QError(409, 'submission_frozen');
  if (!lifecycle.editable) throw new QError(409, 'submission_immutable');

  const version = await loadVersion(submission.versionId);
  const structure = structureOf(version);
  const defaultLanguage = version.template.defaultLanguage;

  // Body answers (full final map) win; otherwise submit what was draft-saved.
  const finalMap = answers && typeof answers === 'object' && !Array.isArray(answers)
    ? answers
    : Object.fromEntries(submission.answers.map((a) => [a.questionKey, a.value]));

  const { errors, cleanAnswers } = validateSubmissionAnswers(structure, finalMap);
  if (errors.length) throw new QError(422, 'validation_failed', { problems: errors });

  const questionsInOrder = flatQuestions(structure);
  const orderOf = new Map(questionsInOrder.map((q, i) => [q.key, i]));
  const byKey = new Map(questionsInOrder.map((q) => [q.key, q]));

  const isFirstSubmit = submission.status === 'draft';
  const updated = await prisma.$transaction(async (tx) => {
    // Rewrite only keys the current structure knows. Answers to questions
    // that were removed from the definition are PRESERVED with their old
    // snapshots — historical data is never dropped by a definition change.
    const structureKeys = questionsInOrder.map((q) => q.key);
    await tx.questionnaireAnswer.deleteMany({
      where: { submissionId, questionKey: { in: structureKeys } },
    });
    for (const { key, value } of cleanAnswers) {
      const q = byKey.get(key);
      await tx.questionnaireAnswer.create({
        data: {
          submissionId,
          questionKey: key,
          questionId: q?.id || null,
          value,
          questionSnapshot: q ? buildQuestionSnapshot(q, submission.language, defaultLanguage) : null,
          sortOrder: orderOf.get(key) ?? 0,
        },
      });
    }
    const frozen = await tx.questionnaireSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        ...(actor?.type ? { submittedByType: actor.type } : {}),
        ...(actor?.ref !== undefined ? { submittedByRef: actor.ref } : {}),
        ...(actor?.name !== undefined ? { submittedByName: actor.name } : {}),
      },
      include: SUBMISSION_INCLUDE,
    });
    // Timeline event only on the FIRST submit — re-submits after reopening
    // (tour-operational lifecycle) update answers/submittedAt without
    // spamming the deal/tour feeds.
    if (isFirstSubmit && frozen.subjectType) {
      const adapter = getSubjectAdapter(frozen.subjectType);
      if (adapter?.onSubmitted) await adapter.onSubmitted(frozen.subjectId, frozen, tx);
    }
    return frozen;
  });
  return updated;
}

// Void frees the singleton slot (operator "redo" path). History row stays.
export async function voidSubmission(submissionId) {
  const s = await prisma.questionnaireSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, status: true, frozenAt: true },
  });
  if (!s) throw new QError(404, 'submission_not_found');
  if (s.status === 'void') return { ok: true };
  // A frozen submission is the tour's historical record — it cannot be
  // voided out of the singleton slot anymore.
  if (s.frozenAt) throw new QError(409, 'submission_frozen');
  await prisma.questionnaireSubmission.update({
    where: { id: submissionId },
    data: { status: 'void', singletonKey: null },
  });
  return { ok: true };
}

export async function listSubmissions({ subjectType, subjectId, purpose, templateId, status } = {}) {
  return prisma.questionnaireSubmission.findMany({
    where: {
      ...(subjectType ? { subjectType } : {}),
      ...(subjectId ? { subjectId } : {}),
      ...(purpose ? { purpose } : {}),
      ...(templateId ? { templateId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      template: { select: { id: true, internalName: true, purpose: true } },
      version: { select: { versionNo: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

// ── public links (§12) ───────────────────────────────────────────────────────
// GOS-native convention: high-entropy plaintext token, exact-match resolve,
// no enumeration (same as QuoteDocument.publicToken). The link binds the URL
// to (subject, purpose, template) — the SUBJECT ALWAYS COMES FROM THE LINK,
// never from client input, so a token can only ever reach its own booking.

function newPublicToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// Get-or-create the ONE active public link for (subject, purpose). Idempotent:
// the operator can copy the same URL again and again; rotation = revoke+mint.
export async function getOrCreatePublicLink({ purpose, subjectType, subjectId }) {
  // Registry is the SSOT for who a purpose serves — staff-only purposes
  // (coordination) never mint public links, whatever the template says.
  if (getPurpose(purpose)?.audience === 'staff') throw new QError(409, 'purpose_internal_only');
  const cfg = await prisma.questionnairePurposeConfig.findUnique({ where: { purpose } });
  if (!cfg?.templateId) throw new QError(409, 'purpose_not_configured');
  const template = await prisma.questionnaireTemplate.findUnique({ where: { id: cfg.templateId } });
  if (!template) throw new QError(404, 'template_not_found');
  if (template.status !== 'active') throw new QError(409, 'template_not_active');
  if (!template.currentVersionId) throw new QError(409, 'no_published_version');
  if (!['public', 'both'].includes(template.audience)) throw new QError(409, 'template_not_public');

  const adapter = await resolveSubjectOrThrow({ purpose, subjectType, subjectId });
  const language = (adapter && (await adapter.resolveLanguage?.(subjectId))) || null;

  const existing = await prisma.questionnaireLink.findFirst({
    where: { templateId: template.id, subjectType, subjectId, purpose, isActive: true },
  });
  if (existing) return existing;
  return prisma.questionnaireLink.create({
    data: {
      templateId: template.id,
      subjectType,
      subjectId,
      purpose,
      token: newPublicToken(),
      language: language && template.supportedLanguages.includes(language) ? language : null,
    },
  });
}

export async function rotatePublicLink(linkId) {
  const link = await prisma.questionnaireLink.findUnique({ where: { id: linkId } });
  if (!link) throw new QError(404, 'link_not_found');
  return prisma.$transaction(async (tx) => {
    await tx.questionnaireLink.update({ where: { id: linkId }, data: { isActive: false } });
    return tx.questionnaireLink.create({
      data: {
        templateId: link.templateId,
        subjectType: link.subjectType,
        subjectId: link.subjectId,
        purpose: link.purpose,
        token: newPublicToken(),
        language: link.language,
        label: link.label,
      },
    });
  });
}

// Resolve a public token → live link, with every guard the public surface
// needs. Generic 404s — probing can't distinguish revoked/expired/missing.
export async function resolvePublicLink(token) {
  const link = await prisma.questionnaireLink.findUnique({
    where: { token: String(token || '') },
    include: { template: true },
  });
  if (!link || !link.isActive) throw new QError(404, 'not_found');
  if (link.expiresAt && link.expiresAt < new Date()) throw new QError(404, 'not_found');
  if (link.template.status !== 'active' || !link.template.currentVersionId) {
    throw new QError(404, 'not_found');
  }
  // Legacy links of purposes that turned staff-only die generically — the
  // public surface must not expose internal operational questionnaires.
  if (getPurpose(link.purpose)?.audience === 'staff') throw new QError(404, 'not_found');
  return link;
}

// Customer-safe subject snapshot — the public payload never leaks internal
// ids/refs beyond what the customer already knows about their own booking.
function publicSubjectContext(snapshot) {
  if (!snapshot) return null;
  return {
    title: snapshot.title ?? null,
    subtitle: snapshot.subtitle ?? null,
    date: snapshot.date ?? null,
    startTime: snapshot.startTime ?? null,
  };
}

// The whole public form payload: start-or-resume the subject's submission
// under the PUBLIC actor and return exactly what the fill page needs.
export async function publicFormPayload(token) {
  const link = await resolvePublicLink(token);
  const { submission } = await startSubmission({
    templateId: link.templateId,
    subjectType: link.subjectType,
    subjectId: link.subjectId,
    actor: { type: 'public', ref: null, name: null },
    linkId: link.id,
  });
  await prisma.questionnaireLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
  const version = await loadVersion(submission.versionId);
  const adapter = link.subjectType ? getSubjectAdapter(link.subjectType) : null;
  const language = link.language || submission.language;
  const prefill = submission.status === 'draft' && adapter?.prefill
    ? await adapter.prefill(link.subjectId, language)
    : {};
  return {
    status: submission.status,
    language,
    subject: publicSubjectContext(submission.subjectSnapshot),
    runtime: runtimePayload(version),
    answers: Object.fromEntries((submission.answers || []).map((a) => [a.questionKey, a.value])),
    submittedAt: submission.submittedAt,
    outroOnly: submission.status !== 'draft',
  };
}

// Locate the link's active submission for the write paths. The submission is
// found through the LINK's subject — client input can't redirect it.
async function activeSubmissionForLink(link) {
  const submission = await prisma.questionnaireSubmission.findFirst({
    where: {
      subjectType: link.subjectType,
      subjectId: link.subjectId,
      purpose: link.purpose,
      status: { in: ['draft', 'submitted', 'reviewed'] },
    },
  });
  if (!submission) throw new QError(404, 'not_found');
  return submission;
}

export async function publicSaveAnswers(token, answers) {
  const link = await resolvePublicLink(token);
  const submission = await activeSubmissionForLink(link);
  return saveDraftAnswers(submission.id, answers);
}

export async function publicSubmit(token, answers, language) {
  const link = await resolvePublicLink(token);
  const submission = await activeSubmissionForLink(link);
  // The customer may have switched language mid-fill — record the language
  // they actually SAW so the frozen answer snapshots resolve to it.
  if (
    language &&
    language !== submission.language &&
    link.template.supportedLanguages.includes(language) &&
    submission.status === 'draft'
  ) {
    await prisma.questionnaireSubmission.update({
      where: { id: submission.id },
      data: { language },
    });
  }
  const frozen = await submitSubmission(submission.id, {
    answers,
    actor: { type: 'public', ref: null, name: null },
  });
  if (link.singleUse) {
    await prisma.questionnaireLink.update({ where: { id: link.id }, data: { isActive: false } });
  }
  return frozen;
}

// Staff actor from the admin session — resolves the username snapshot the
// same way the timeline's userOrigin() does (req.adminAuth carries userId only).
export async function staffActorFromAuth(auth) {
  const userId = auth?.userId || null;
  if (!userId) return { type: 'staff', ref: null, name: null };
  const u = await prisma.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
  return { type: 'staff', ref: userId, name: u?.username || null };
}

// Human-readable single-language rendering of a completed submission — built
// from the frozen answer snapshots ONLY (never the live version tree).
export function renderSubmissionAnswers(submission) {
  return (submission.answers || [])
    .filter((a) => a.questionSnapshot)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((a) => {
      const snap = a.questionSnapshot;
      let display = a.value;
      if (snap.options?.length) {
        const labelOf = (v) =>
          snap.options.find((o) => o.value === v)?.label ??
          (typeof v === 'string' && v.startsWith('__other__:') ? v.slice('__other__:'.length) : v);
        display = Array.isArray(a.value) ? a.value.map(labelOf) : labelOf(a.value);
      }
      return {
        questionKey: a.questionKey,
        label: snap.label,
        type: snap.type,
        sectionKey: snap.sectionKey,
        sectionTitle: snap.sectionTitle,
        value: a.value,
        display,
      };
    });
}

export { resolveLocalized };
