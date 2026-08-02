// Live values shown WITH a question, computed at render time.
//
// The participant-count question has to say a number: "כמות המשתתפים הרשומה
// היא 13. האם זו הכמות הצפויה בפועל?" — and that number is canonical data.
//
// Writing it into the question's label would copy a live value into
// questionnaire content, which is exactly what this whole design refuses to do:
// the number would be frozen at authoring time, wrong for every other booking,
// and silently stale forever. So the STORED question stays generic and the
// number arrives beside it as a hint, resolved per booking, per render.
//
// Keyed by ROLE, so the hint follows the question wherever it moves and whatever
// it is called. A form with no participant-count question simply gets no hint.

import { prisma } from '../db.js';
import { loadCoordinationScope } from './coordinationContext.js';
import { bookingSeatCount } from './contextCatalog.js';
import { questionForRole } from './coordinationRoles.js';

/** Every question in a runtime payload, flattened out of its sections. */
function runtimeQuestions(runtime) {
  return (runtime?.sections || []).flatMap((s) => s.questions || []);
}

/**
 * { [questionKey]: hintText } for one booking's coordination form.
 * Best-effort: a missing hint costs a number on screen, never the form.
 */
export async function coordinationHints(bookingId, runtime, lang = 'he', { db = prisma } = {}) {
  try {
    const questions = runtimeQuestions(runtime);
    const q = questionForRole(questions, 'participant_count_matches');
    if (!q) return {};

    const scope = await loadCoordinationScope(bookingId, { db });
    const registered = scope ? bookingSeatCount(scope.booking) : null;
    // No known count → no claim. Better a bare question than "הרשומה היא —".
    if (registered === null || registered === undefined) return {};

    return {
      [q.key]: lang === 'en'
        ? `${registered} participants are registered.`
        : `כמות המשתתפים הרשומה היא ${registered}.`,
    };
  } catch {
    return {};
  }
}
