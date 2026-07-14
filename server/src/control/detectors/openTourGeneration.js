import { registerIssueType } from '../registry.js';
import { registerDetector } from '../sweepWorker.js';
import { raiseIssue, resolveMissing } from '../issueService.js';
import { GENERATION_HEALTH_KEY } from '../../tours/generationWorker.js';

// Open-Tour generation FAILURE — the בקרה side of the scheduled generation
// worker. The worker records each tick on the GENERATION_HEALTH_KEY MaintenanceJob
// row; this detector surfaces a PERSISTENT failure (a single transient tick
// self-heals on the next run, so we require several consecutive failures before
// bothering a human). While unresolved, future occurrences may not be created —
// so nothing would generate or publish on the website.

const TYPE = 'open_tour_generation_failed';
const FAIL_THRESHOLD = 3; // consecutive failed hourly ticks (~3h) before surfacing

function isFailing(health) {
  return health?.status === 'failed' && (health?.summary?.consecutiveFailures || 0) >= FAIL_THRESHOLD;
}

registerDetector({
  key: 'open-tour-generation-failed',
  async run(client) {
    const health = await client.maintenanceJob.findUnique({ where: { key: GENERATION_HEALTH_KEY } });
    const present = new Set();
    if (isFailing(health)) {
      const fails = health.summary.consecutiveFailures;
      present.add(TYPE);
      await raiseIssue(client, {
        type: TYPE,
        severity: 'warning',
        sourceModule: 'tours',
        dedupeKey: TYPE,
        title: 'יצירת סיורים פתוחים נכשלת',
        explanation:
          `יצירת המועדים האוטומטית של הסיורים הפתוחים נכשלה ${fails} פעמים ברציפות. ` +
          'כתוצאה מכך ייתכן שמועדים עתידיים לא נוצרים — ולכן גם לא מתפרסמים באתר. ' +
          'יש לבדוק את שירות ה-GOS ואת מסד הנתונים.',
        entityRefs: [],
        data: {
          consecutiveFailures: fails,
          lastError: health.error || null,
          lastSuccessAt: health.summary?.lastSuccessAt || null,
          lastRunAt: health.summary?.lastRunAt || null,
        },
      });
    }
    await resolveMissing(client, TYPE, present);
  },
});

registerIssueType(TYPE, {
  sourceModule: 'tours',
  // No in-app fix action — a persistent generation failure is an infrastructure
  // problem (DB/service) that needs a human, not a one-click retry.
  buildActions() {
    return [];
  },
  async recheck(client) {
    const health = await client.maintenanceJob.findUnique({ where: { key: GENERATION_HEALTH_KEY } });
    return isFailing(health);
  },
});
