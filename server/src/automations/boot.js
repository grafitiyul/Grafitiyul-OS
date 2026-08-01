// Boot-time definition-drift detection.
//
// This is what makes the registry's "updated" date and change history FACTS
// ABOUT THE CODE rather than prose someone has to remember to maintain. At
// startup every definition's declared behaviour is hashed; if the hash moved
// since the last recorded one, a `definition_changed` row is written
// automatically.
//
// The hash covers trigger, condition, action shape, dependencies and the
// idempotency rule — but NOT nameHe/descriptionHe/notesHe, so rewording
// documentation never shows up as a behaviour change (which would fill the log
// with noise and make it meaningless).
//
// Never fatal: a registry bookkeeping failure must not take down the business
// system it merely describes.

import { prisma } from '../db.js';
import { listAutomations, definitionHash } from './registry.js';

export async function syncAutomationChanges(log = console, { db = prisma } = {}) {
  try {
    for (const def of listAutomations()) {
      const hash = definitionHash(def);
      const last = await db.automationChange.findFirst({
        where: { autId: def.id, kind: { in: ['registered', 'definition_changed'] } },
        orderBy: { createdAt: 'desc' },
        select: { toHash: true },
      });

      if (!last) {
        await db.automationChange.create({
          data: {
            autId: def.id,
            kind: 'registered',
            summaryHe: `האוטומציה נרשמה במערכת (${def.nameHe})`,
            toHash: hash,
          },
        });
        log.log?.(`[automations] registered ${def.id}`);
        continue;
      }

      if (last.toHash !== hash) {
        await db.automationChange.create({
          data: {
            autId: def.id,
            kind: 'definition_changed',
            summaryHe: 'הגדרת האוטומציה שונתה בקוד (טריגר / תנאי / פעולות / תלויות)',
            fromHash: last.toHash,
            toHash: hash,
          },
        });
        log.log?.(`[automations] definition changed: ${def.id}`);
      }
    }
  } catch (err) {
    log.warn?.(`[automations] change sync failed: ${err?.message || err}`);
  }
}
