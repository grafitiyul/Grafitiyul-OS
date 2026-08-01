// Dependency resolvers — what turns the registry from a catalog into an
// operational control center.
//
// Every automation declares STRUCTURED, RESOLVABLE dependencies (never prose).
// Each resolver reads the owning subsystem LIVE — never a cached copy, never a
// column somebody has to remember to update — and returns a verdict the
// registry renders verbatim:
//
//   { ok, severity, labelHe, detailHe, link }
//
// severity decides what a failure MEANS:
//   'hard' → the automation can NEVER run as configured        → שבורה (Broken)
//   'soft' → it cannot run YET; satisfy the dependency and it   → ממתינה לתלות
//            starts working with no code change
//
// `detailHe` must name the SPECIFIC thing that is wrong ("שאלה q_9f3a12bd אינה
// קיימת בגרסה המפורסמת"), because the whole point is that an operator can read
// the registry and know what to fix — not that something, somewhere, is off.
//
// A definition's declared severity may be overridden per check: a template that
// EXISTS but has no published version is 'soft' (publish it and we are live),
// while a template that does not exist at all is 'hard'.

import { prisma } from '../db.js';
import { reportByNumber } from '../adminReports/registry.js';
import { issueTypeDef } from '../control/registry.js';
import { triggerByType } from '../communication/triggers.js';

/** A dependency verdict. `link` is an admin path the UI turns into a deep link. */
const verdict = (ok, severity, labelHe, detailHe, link = null) =>
  ({ ok, severity, labelHe, detailHe, link });

// Resolvers are keyed by dependency kind. Each receives (dep, ctx) where ctx
// carries a prisma client, so tests inject a stub instead of touching the DB.
const RESOLVERS = {
  // ── Questionnaire ──────────────────────────────────────────────────────────

  questionnaire_template: async (dep, { db }) => {
    const label = `שאלון "${dep.templateKey}"`;
    const t = await db.questionnaireTemplate.findUnique({
      where: { key: dep.templateKey },
      select: { id: true, internalName: true, status: true, currentVersionId: true },
    });
    if (!t) {
      return verdict(false, 'hard', label, `השאלון "${dep.templateKey}" אינו קיים במערכת`);
    }
    const link = `/admin/questionnaires/${t.id}`;
    if (t.status === 'archived') {
      return verdict(false, 'hard', `שאלון "${t.internalName}"`, 'השאלון בארכיון', link);
    }
    if (!t.currentVersionId) {
      // Exists but never published — satisfiable without a code change.
      return verdict(false, 'soft', `שאלון "${t.internalName}"`, 'לשאלון אין גרסה מפורסמת', link);
    }
    if (t.status !== 'active') {
      return verdict(false, 'soft', `שאלון "${t.internalName}"`, 'השאלון אינו פעיל', link);
    }
    return verdict(true, 'hard', `שאלון "${t.internalName}"`, 'פעיל עם גרסה מפורסמת', link);
  },

  // The key must exist in the template's CURRENT PUBLISHED version — that is
  // the structure real submissions are filled against. A key that survives only
  // in a draft would make the automation look healthy while it silently never
  // matches.
  questionnaire_question: async (dep, { db }) => {
    const label = `שאלה ${dep.questionKey}`;
    const t = await db.questionnaireTemplate.findUnique({
      where: { key: dep.templateKey },
      select: { id: true, internalName: true, currentVersionId: true },
    });
    if (!t) return verdict(false, 'hard', label, `השאלון "${dep.templateKey}" אינו קיים`);
    const link = `/admin/questionnaires/${t.id}`;
    if (!t.currentVersionId) {
      return verdict(false, 'soft', label, `לשאלון "${t.internalName}" אין גרסה מפורסמת`, link);
    }
    const q = await db.questionnaireQuestion.findFirst({
      where: { versionId: t.currentVersionId, key: dep.questionKey },
      select: { id: true, label: true },
    });
    if (!q) {
      return verdict(
        false, 'hard', label,
        `השאלה ${dep.questionKey} אינה קיימת בגרסה המפורסמת של "${t.internalName}" — ככל הנראה נמחקה ונוצרה מחדש`,
        link,
      );
    }
    return verdict(true, 'hard', label, `קיימת בגרסה המפורסמת של "${t.internalName}"`, link);
  },

  questionnaire_option: async (dep, { db }) => {
    const label = `תשובה ${dep.optionValue}`;
    const t = await db.questionnaireTemplate.findUnique({
      where: { key: dep.templateKey },
      select: { id: true, internalName: true, currentVersionId: true },
    });
    if (!t) return verdict(false, 'hard', label, `השאלון "${dep.templateKey}" אינו קיים`);
    const link = `/admin/questionnaires/${t.id}`;
    if (!t.currentVersionId) {
      return verdict(false, 'soft', label, `לשאלון "${t.internalName}" אין גרסה מפורסמת`, link);
    }
    const q = await db.questionnaireQuestion.findFirst({
      where: { versionId: t.currentVersionId, key: dep.questionKey },
      select: { id: true },
    });
    if (!q) {
      return verdict(false, 'hard', label, `השאלה ${dep.questionKey} אינה קיימת בגרסה המפורסמת`, link);
    }
    const o = await db.questionnaireQuestionOption.findFirst({
      where: { questionId: q.id, value: dep.optionValue },
      select: { id: true },
    });
    if (!o) {
      return verdict(
        false, 'hard', label,
        `אפשרות התשובה ${dep.optionValue} אינה קיימת בשאלה ${dep.questionKey} בגרסה המפורסמת`,
        link,
      );
    }
    return verdict(true, 'hard', label, 'קיימת בגרסה המפורסמת', link);
  },

  // ── Communication Center ───────────────────────────────────────────────────
  // The automation owns the DECISION to fire a trigger; the Communication
  // Center owns whether any message is configured on it. No configured rule is
  // 'soft': the automation runs correctly, it simply has nothing to send yet.

  communication_trigger: async (dep, { db }) => {
    const t = triggerByType(dep.triggerType);
    const label = `כלל תקשורת · ${t?.labelHe || dep.triggerType}`;
    const link = '/admin/settings/communication';
    if (!t) {
      return verdict(false, 'hard', label, `הטריגר "${dep.triggerType}" אינו קיים בקטלוג הטריגרים`, link);
    }
    const events = await db.communicationEvent.findMany({
      where: { triggerType: dep.triggerType, status: 'active' },
      select: { id: true, messages: { where: { status: 'active', publishedVersionId: { not: null } }, select: { id: true } } },
    });
    const liveMessages = events.reduce((n, e) => n + e.messages.length, 0);
    if (!events.length) {
      return verdict(false, 'soft', label, 'לא הוגדר אירוע תקשורת פעיל על הטריגר הזה', link);
    }
    if (!liveMessages) {
      return verdict(false, 'soft', label, 'קיים אירוע תקשורת פעיל אך אין בו מסר פעיל ומפורסם', link);
    }
    return verdict(true, 'soft', label, `${liveMessages} מסרים פעילים`, link);
  },

  // ── Admin Reports ──────────────────────────────────────────────────────────

  admin_report: async (dep, { db }) => {
    const report = reportByNumber(dep.number);
    const label = `דיווח מנהלים #${dep.number}`;
    const link = '/admin/settings/admin-reports';
    if (!report) {
      // The catalog is code — a missing number means the definition points at
      // a report that no longer exists. Only a code change fixes that.
      return verdict(false, 'hard', label, `דיווח #${dep.number} אינו קיים בקטלוג`, link);
    }
    const cfg = await db.adminReportConfig.findUnique({ where: { reportNumber: Number(dep.number) } });
    const full = `${label} · ${report.nameHe}`;
    if (!cfg) return verdict(false, 'soft', full, 'הדיווח לא הוגדר עדיין (לא נבחר יעד)', link);
    if (!cfg.enabled) return verdict(false, 'soft', full, 'הדיווח מושבת', link);
    // A guide-audience report addresses a person, so only the sending account
    // matters; office reports need a destination chat too.
    const needsChat = report.audience !== 'guides';
    if (!cfg.waAccountId || (needsChat && !cfg.waChatId)) {
      return verdict(false, 'soft', full, 'לדיווח אין יעד WhatsApp מלא', link);
    }
    return verdict(true, 'soft', full, 'מוגדר ופעיל', link);
  },

  // ── Tasks / בקרה / environment ─────────────────────────────────────────────

  task_type: async (dep, { db }) => {
    const label = `סוג משימה "${dep.taskTypeKey}"`;
    const link = '/admin/settings/crm/task-types';
    const tt = await db.taskType.findUnique({
      where: { key: dep.taskTypeKey },
      select: { nameHe: true, isActive: true },
    });
    if (!tt) return verdict(false, 'hard', label, `סוג המשימה "${dep.taskTypeKey}" אינו קיים`, link);
    if (!tt.isActive) return verdict(false, 'soft', `סוג משימה "${tt.nameHe}"`, 'סוג המשימה אינו פעיל', link);
    return verdict(true, 'hard', `סוג משימה "${tt.nameHe}"`, 'קיים ופעיל', link);
  },

  control_issue_type: async (dep) => {
    const label = `סוג תקלה "${dep.issueType}"`;
    const link = '/admin/control';
    return issueTypeDef(dep.issueType)
      ? verdict(true, 'hard', label, 'רשום במרשם התקלות', link)
      : verdict(false, 'hard', label, `סוג התקלה "${dep.issueType}" אינו רשום במרשם בקרה`, link);
  },

  env: async (dep) => {
    const label = `הגדרת סביבה ${dep.name}`;
    return process.env[dep.name]
      ? verdict(true, 'soft', label, 'מוגדרת')
      : verdict(false, 'soft', label, `משתנה הסביבה ${dep.name} אינו מוגדר`);
  },
};

export const DEPENDENCY_KINDS = Object.keys(RESOLVERS);

export function isKnownDependencyKind(kind) {
  return Object.prototype.hasOwnProperty.call(RESOLVERS, kind);
}

/**
 * Resolve ONE dependency. A resolver that throws is reported as a soft unknown
 * rather than crashing the registry — an inspection screen must never be the
 * thing that goes down.
 */
export async function resolveDependency(dep, { db = prisma } = {}) {
  const resolver = RESOLVERS[dep?.kind];
  if (!resolver) {
    return { ...verdict(false, 'hard', `תלות "${dep?.kind}"`, 'סוג תלות לא מוכר'), dep };
  }
  try {
    const res = await resolver(dep, { db });
    // A definition may only ESCALATE a soft check to hard (never the reverse):
    // downgrading a hard structural break to "waiting" would hide a real fault.
    const severity = dep.severity === 'hard' ? 'hard' : res.severity;
    return { ...res, severity, dep };
  } catch (err) {
    return {
      ...verdict(false, 'soft', `תלות "${dep.kind}"`, `בדיקת התלות נכשלה: ${err?.message || err}`),
      dep,
    };
  }
}

/** Resolve every dependency of a definition, in declaration order. */
export async function resolveDependencies(def, { db = prisma } = {}) {
  const list = Array.isArray(def?.dependsOn) ? def.dependsOn : [];
  return Promise.all(list.map((dep) => resolveDependency(dep, { db })));
}
