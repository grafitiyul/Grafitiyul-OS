// THE registry of operational question roles — what each one drives.
//
// ── Why this file exists ────────────────────────────────────────────────────
// Runtime behaviour used to hang off automation definitions, and the builder
// protected the question keys those definitions named: deleting a referenced
// question was refused, so an automation could not be silently broken.
//
// The automations are gone. Behaviour now hangs off `config.<x>Role`, and for a
// while nothing protected those at all — deleting the question carrying
// `summaryRole: 'payment_left'` would have silently stopped report #19 with no
// error, no warning and no way to notice except a manager wondering why the
// alerts stopped.
//
// So the protection moved to where the behaviour moved. This module is the ONE
// answer to "what depends on this question?", and both the builder warning and
// the delete guard read it.
//
// Adding an operational role = one entry here. Nothing else changes.

import { SUMMARY_ROLES, PAYMENT_LEFT_ROLE } from '../reviewItems/kinds/tourSummary.js';
import { LOGISTICS_ROLES } from '../reviewItems/kinds/logisticsReport.js';
import { COORDINATION_ROLES } from './coordinationRoles.js';

/**
 * Every operational role, by the config key that carries it.
 *
 * `consumerHe` names what actually breaks — an operator deleting a question
 * needs to read a consequence, not a role name they have never seen.
 */
const ROLE_SOURCES = [
  {
    configKey: 'summaryRole',
    roles: [
      ...SUMMARY_ROLES.map((r) => ({
        role: r.role,
        labelHe: r.labelHe,
        consumerHe: 'כרטיס סיכום הסיור במשימות הנהלה',
      })),
      {
        role: PAYMENT_LEFT_ROLE,
        labelHe: 'הושאר תשלום',
        consumerHe: 'דיווח מנהלים #19 — הושאר תשלום אחרי הסיור',
      },
    ],
  },
  {
    configKey: 'logisticsRole',
    roles: LOGISTICS_ROLES.map((r) => ({
      role: r.role,
      labelHe: r.labelHe,
      consumerHe: 'הדו״ח הלוגיסטי + דיווח מנהלים #20',
    })),
  },
  {
    configKey: 'coordinationRole',
    roles: COORDINATION_ROLES.map((r) => ({
      role: r.role,
      labelHe: r.labelHe,
      consumerHe: coordinationConsumer(r.role),
    })),
  },
];

function coordinationConsumer(role) {
  switch (role) {
    case 'participant_count_matches':
    case 'corrected_participant_count':
    case 'participant_count_change_note':
      return 'כרטיס שינוי כמות המשתתפים + דיווחי מנהלים #21 ו-#22';
    case 'send_meeting_point_followup':
      return 'הודעת נקודת המפגש ללקוח (#23)';
    case 'send_restaurant_recommendations':
      return 'הודעת המלצות המסעדות ללקוח (#24)';
    default:
      return 'שיחת התיאום';
  }
}

const BY_CONFIG_KEY = new Map(ROLE_SOURCES.map((s) => [s.configKey, new Map(s.roles.map((r) => [r.role, r]))]));

export const OPERATIONAL_CONFIG_KEYS = ROLE_SOURCES.map((s) => s.configKey);

/**
 * What depends on THIS question, from its own config.
 * Returns [] for an ordinary content question — most questions are ordinary.
 */
export function operationalDependents(question) {
  const cfg = question?.config;
  if (!cfg || typeof cfg !== 'object') return [];
  const out = [];
  for (const [configKey, roles] of BY_CONFIG_KEY) {
    const roleValue = cfg[configKey];
    if (!roleValue) continue;
    const def = roles.get(roleValue);
    out.push({
      configKey,
      role: roleValue,
      // An unknown role is still reported: config naming a role the code does
      // not implement is exactly the drift worth showing, not hiding.
      labelHe: def?.labelHe || roleValue,
      consumerHe: def?.consumerHe || 'תפקיד שאינו מוכר לקוד — כדאי לבדוק',
      known: !!def,
    });
  }
  return out;
}

/**
 * Does this OPTION drive behaviour?
 *
 * `config.affirmativeOption` names the option key that counts as "yes" for a
 * logistics question. Deleting that option leaves the question intact and the
 * detection silently dead — the finding simply stops appearing, with no error.
 */
export function optionDependents(question, optionValue) {
  const cfg = question?.config;
  if (!cfg || !optionValue) return [];
  if (cfg.affirmativeOption !== optionValue) return [];
  return [{
    configKey: 'affirmativeOption',
    role: optionValue,
    labelHe: 'התשובה החיובית',
    consumerHe: 'זיהוי הממצא בדו״ח הלוגיסטי (#20)',
    known: true,
  }];
}

/**
 * Which roles a structure covers — the audit view.
 *
 * `configKeys` scopes the answer to the role families this form actually owns.
 * Without it the coordination form reports every summary role as "missing" and
 * vice versa, which is noise, not a finding: a form is not incomplete for
 * lacking roles that belong to a different form.
 */
export function roleCoverage(questions = [], configKeys = OPERATIONAL_CONFIG_KEYS) {
  const scope = new Set(configKeys);
  const mapped = new Map();
  for (const q of questions) {
    for (const d of operationalDependents(q)) {
      if (!scope.has(d.configKey)) continue;
      mapped.set(`${d.configKey}:${d.role}`, { ...d, questionKey: q.key });
    }
  }
  const missing = [];
  for (const src of ROLE_SOURCES) {
    if (!scope.has(src.configKey)) continue;
    for (const r of src.roles) {
      if (!mapped.has(`${src.configKey}:${r.role}`)) {
        missing.push({ configKey: src.configKey, role: r.role, labelHe: r.labelHe, consumerHe: r.consumerHe });
      }
    }
  }
  return { mapped: [...mapped.values()], missing };
}

/** The role families each operational purpose owns. */
export const PURPOSE_ROLE_KEYS = {
  tour_summary: ['summaryRole', 'logisticsRole'],
  coordination: ['coordinationRole'],
};
