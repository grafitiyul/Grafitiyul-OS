// THE automation runtime. Small on purpose.
//
// Order of operations, and why each step is where it is:
//
//   1. firstSubmit gate   — an edited answer is not a new business event.
//   2. enabled?           — disabled produces NO run row: a switched-off
//                           automation should leave no trace, not a log full of
//                           "skipped because off".
//   3. claim idempotency  — AutomationRun.create with a unique key. P2002 means
//                           this exact business event was already handled, so we
//                           stop. This is the ONE mechanism preventing a
//                           re-submitted form from sending twice.
//   4. dependencies       — a broken automation records WHY instead of failing
//                           mysteriously downstream.
//   5. condition          — evaluated against FROZEN answers, by stable key.
//   6. actions in order   — each reports; none throws into the caller.
//   7. finalise           — status + Hebrew reason + per-action results.
//
// Steps 4-6 all write a run row, so "why didn't it fire?" is always answerable
// on the registry screen instead of in the logs. Only steps 1-2 are silent.
//
// The runtime NEVER retries: a failed decision is a bug or a data problem, and
// silently retrying hides both. Retry belongs to the transport (the
// Communication Center owns delivery retries).

import { prisma } from '../db.js';
import { evaluateCondition } from '../../../shared/questionnaire/conditions.mjs';
import { resolveDependencies } from './dependencies.js';
import { resolveEnabled } from './health.js';
import { actionExecutor } from './actions/index.js';

/** Run states, mirrored by the registry screen. */
export const RUN_STATUS = { ran: 'ran', skipped: 'skipped', failed: 'failed' };

/**
 * Execute ONE automation for ONE event.
 *
 * Returns { recorded, status, runId } — `recorded: false` means nothing was
 * written (disabled, not a first submit, or an idempotency hit).
 */
export async function runAutomation(def, event, { db = prisma, log = console } = {}) {
  const { submission, answers = {}, refs = {}, firstSubmit = true } = event;

  // 1. An edit is not a new business event.
  const firstOnly = def.trigger?.firstSubmitOnly !== false;
  if (firstOnly && !firstSubmit) return { recorded: false, status: 'not_first_submit' };

  // 2. Disabled leaves no trace.
  const state = await db.automationState.findUnique({ where: { autId: def.id } });
  if (!resolveEnabled(def, state)) return { recorded: false, status: 'disabled' };

  // 3. Idempotency claim — the row IS the lock.
  const idempotencyKey = def.idempotency({ ...refs, submissionId: submission.id, answers });
  const startedAt = new Date();
  let run;
  try {
    run = await db.automationRun.create({
      data: {
        autId: def.id,
        idempotencyKey,
        status: RUN_STATUS.ran, // provisional; finalised below
        input: {
          submissionId: submission.id,
          templateKey: submission.template?.key || null,
          purpose: submission.purpose,
          // Only the answers the automation actually reads are frozen — a full
          // answer dump would put questionnaire content into an audit table.
          answers: relevantAnswers(def, answers),
          refs,
        },
        dealId: refs.dealId || null,
        tourEventId: refs.tourEventId || null,
        submissionId: submission.id,
        startedAt,
      },
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      // Already handled. This is the duplicate-send guard doing its job.
      log.info?.(`[automations] ${def.id} idempotency hit for ${idempotencyKey}`);
      return { recorded: false, status: 'duplicate' };
    }
    throw err;
  }

  const finish = (status, reasonHe, stoppedAt, actionResults) => db.automationRun.update({
    where: { id: run.id },
    data: {
      status,
      reasonHe: reasonHe ? String(reasonHe).slice(0, 500) : null,
      stoppedAt: stoppedAt || null,
      actionResults: actionResults ?? undefined,
      durationMs: Date.now() - startedAt.getTime(),
      finishedAt: new Date(),
    },
  });

  try {
    // 4. Dependencies — a broken automation says which one and why.
    const deps = await resolveDependencies(def, { db });
    const hardFail = deps.find((d) => !d.ok && d.severity === 'hard');
    if (hardFail) {
      await finish(RUN_STATUS.skipped, `תלות חסרה: ${hardFail.detailHe}`, 'dependency');
      return { recorded: true, status: RUN_STATUS.skipped, runId: run.id };
    }

    // 5. The answer condition, by stable key against frozen answers.
    if (def.when) {
      const matched = evaluateCondition(def.when, (key) => answers[key]);
      if (!matched) {
        await finish(RUN_STATUS.skipped, 'תנאי התשובות לא התקיים', 'condition');
        return { recorded: true, status: RUN_STATUS.skipped, runId: run.id };
      }
    }

    // 6. Actions, in declared order.
    const results = [];
    for (const action of def.actions) {
      const exec = actionExecutor(action.kind);
      if (!exec) {
        results.push({ kind: action.kind, ok: false, error: 'action_kind_not_implemented' });
        continue;
      }
      const res = await exec(action, { def, event, refs, answers, log, db });
      results.push({ kind: action.kind, ...res });
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      await finish(
        RUN_STATUS.failed,
        failed.map((f) => `${f.kind}: ${f.error || 'נכשל'}`).join(' · '),
        'action',
        results,
      );
      return { recorded: true, status: RUN_STATUS.failed, runId: run.id };
    }

    await finish(
      RUN_STATUS.ran,
      results.map((r) => r.detailHe).filter(Boolean).join(' · ') || null,
      null,
      results,
    );
    return { recorded: true, status: RUN_STATUS.ran, runId: run.id };
  } catch (err) {
    // Any unexpected throw still ends as an auditable failed run, never as a
    // half-finished row stuck in its provisional state.
    await finish(RUN_STATUS.failed, `שגיאה: ${err?.message || err}`, 'action').catch(() => {});
    log.error?.(`[automations] ${def.id} failed: ${err?.message || err}`);
    return { recorded: true, status: RUN_STATUS.failed, runId: run.id };
  }
}

/** The answers this definition's condition actually reads (frozen into the run). */
function relevantAnswers(def, answers) {
  const keys = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (Array.isArray(node.all)) return node.all.forEach(walk);
    if (Array.isArray(node.any)) return node.any.forEach(walk);
    if (node.not !== undefined) return walk(node.not);
    if (typeof node.q === 'string') keys.add(node.q);
  };
  walk(def.when);
  for (const dep of def.dependsOn || []) {
    if (dep.kind === 'questionnaire_question' && dep.questionKey) keys.add(dep.questionKey);
    if (dep.kind === 'questionnaire_option' && dep.questionKey) keys.add(dep.questionKey);
  }
  return Object.fromEntries([...keys].map((k) => [k, answers[k] ?? null]));
}
