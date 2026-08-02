// The stable ROLES of the coordination form.
//
// Runtime behaviour binds here and never to visible Hebrew text. The office can
// reword "צריך שנשלח להם את נקודת המפגש שוב?" into anything, translate it, move
// it, or replace the question wholesale — as long as the replacement carries the
// role, the follow-up message keeps working. Conversely, a question that merely
// LOOKS like it asks about the meeting point does nothing until someone maps it.
//
// Roles live on QuestionnaireQuestion.config.coordinationRole, the same
// mechanism tour_summary already uses (summaryRole / logisticsRole).

// A coordination call reports a real group size. Zero is not a correction (it is
// a cancellation, which has its own workflow), and four digits is a typo.
export const MIN_PARTICIPANTS = 1;
export const MAX_PARTICIPANTS = 999;

export const COORDINATION_ROLES = [
  {
    role: 'participant_count_matches',
    labelHe: 'אישור כמות משתתפים',
    labelEn: 'Participant count confirmation',
    type: 'yesno',
    descriptionHe: 'האם הכמות הרשומה היא הכמות הצפויה בפועל. תשובה "לא" חושפת את שדות ההמשך.',
  },
  {
    role: 'corrected_participant_count',
    labelHe: 'כמות משתתפים מעודכנת',
    labelEn: 'Corrected participant count',
    type: 'number',
    descriptionHe: 'נדרש רק כשהתשובה על הכמות היא "לא".',
  },
  {
    role: 'participant_count_change_note',
    labelHe: 'הערה לשינוי בכמות',
    labelEn: 'Participant change note',
    type: 'textarea',
    descriptionHe: 'הערה חופשית, לא חובה.',
  },
  {
    role: 'send_meeting_point_followup',
    labelHe: 'שליחת נקודת מפגש ללקוח',
    labelEn: 'Send the meeting point to the customer',
    type: 'yesno',
    descriptionHe: 'תשובה "כן" שולחת ללקוח של ההזמנה הזו את נקודת המפגש הקנונית.',
  },
  {
    role: 'send_restaurant_recommendations',
    labelHe: 'שליחת המלצות מסעדות ללקוח',
    labelEn: 'Send restaurant recommendations to the customer',
    type: 'yesno',
    descriptionHe: 'תשובה "כן" שולחת ללקוח של ההזמנה הזו את קישור ההמלצות.',
  },
  {
    role: 'office_notes',
    labelHe: 'הערות חשובות למשרד',
    labelEn: 'Notes for the office',
    type: 'textarea',
    descriptionHe: 'מידע שהמדריך רוצה שהמשרד יראה. אינו מפעיל שליחה.',
  },
];

export const COORDINATION_ROLE_KEYS = COORDINATION_ROLES.map((r) => r.role);

export function coordinationRoleDef(role) {
  return COORDINATION_ROLES.find((r) => r.role === role) || null;
}

/** The question carrying a role in this structure, or null. */
export function questionForRole(questions, role) {
  return (questions || []).find((q) => q?.config?.coordinationRole === role) || null;
}

/**
 * Is a yes/no role answered affirmatively?
 *
 * `yesno` stores a BOOLEAN, but a form author may also wire an option-keyed
 * choice, so the string shapes a "yes" can take are accepted too. Anything else
 * — false, blank, missing, or an unmapped role — is NOT a yes, and silence is
 * always the safe answer: these roles trigger real messages to customers.
 */
export function isAffirmative(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['true', 'yes', 'y', '1', 'כן'].includes(value.trim().toLowerCase());
}

export function roleAnswered(questions, answers, role) {
  const q = questionForRole(questions, role);
  if (!q) return { mapped: false, value: null, yes: false };
  const value = answers?.[q.key];
  return { mapped: true, questionKey: q.key, value: value ?? null, yes: isAffirmative(value) };
}

/**
 * The participant-count verdict for a submitted coordination form.
 *
 * Returns { changed, registered, corrected, note } — `changed` is true ONLY
 * when the guide said the count does not match AND gave a usable number AND
 * that number actually differs. A guide who says "לא" and then leaves the field
 * blank has reported nothing actionable, so nothing fires.
 */
export function participantVerdict({ questions, answers, registered }) {
  const match = roleAnswered(questions, answers, 'participant_count_matches');
  if (!match.mapped) return { changed: false, reason: 'unmapped' };
  // Only an explicit NO opens the workflow. Blank is not a disagreement.
  if (match.value === null || match.value === undefined || match.value === '') {
    return { changed: false, reason: 'unanswered' };
  }
  if (match.yes) return { changed: false, reason: 'matches' };

  const corrected = roleAnswered(questions, answers, 'corrected_participant_count');
  const n = Number(corrected.value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_PARTICIPANTS || n > MAX_PARTICIPANTS) {
    return { changed: false, reason: 'no_valid_count', corrected: corrected.value ?? null };
  }
  if (registered != null && n === registered) return { changed: false, reason: 'same_number' };

  const note = roleAnswered(questions, answers, 'participant_count_change_note');
  return {
    changed: true,
    registered: registered ?? null,
    corrected: n,
    delta: registered != null ? n - registered : null,
    note: typeof note.value === 'string' && note.value.trim() ? note.value.trim() : null,
  };
}

