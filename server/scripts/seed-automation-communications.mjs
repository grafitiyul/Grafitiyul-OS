#!/usr/bin/env node
// Seed the Communication Center rules for the questionnaire automations.
//
// ── Why seeding is the right move, not a shortcut ────────────────────────────
// The architecture says the Communication Center OWNS outbound content. The
// consequence is that a freshly deployed automation has nothing to send until
// somebody writes a message — which is exactly the "infrastructure complete,
// workflow not working" state this is meant to end.
//
// So the content ships as DATA, in the place that owns it: real
// CommunicationEvent + CommunicationMessage rows the operator can open and edit
// like any other message. Nothing is hardcoded in the send path; changing the
// wording is an edit in the UI, not a deploy.
//
// Rules this script holds itself to:
//   * IDEMPOTENT. Keyed on the automation trigger type — re-running finds the
//     existing event and leaves it alone.
//   * NEVER OVERWRITES. An event that already exists is never touched, so an
//     operator's edits can't be clobbered by a redeploy.
//   * BILINGUAL. Hebrew and English are written together, and languagePolicy
//     'auto' means each recipient gets their own language.
//   * DRAFT BY DEFAULT for the destination. Every message is created with its
//     content published, but the EVENT stays 'draft' until an operator picks
//     the destination — a message with no destination must not silently fail.
//
// Usage:
//   node scripts/seed-automation-communications.mjs            # dry run
//   node scripts/seed-automation-communications.mjs --execute

import { prisma } from '../src/db.js';
import '../src/automations/definitions/index.js';
import { listAutomations, automationTriggerType } from '../src/automations/registry.js';

const EXECUTE = process.argv.includes('--execute');

// Variables come from the canonical Communication Center vocabulary; the
// automation triggers declare deal/contact/org/tour contexts, so these resolve.
const SEEDS = {
  'AUT-001': {
    eventName: 'התקבל תשלום בסיכום סיור — התראה למנהלים',
    channel: 'whatsapp',
    messageName: 'התראת תשלום למנהלים',
    he: [
      '💰 התקבל תשלום 💰',
      '',
      'לקוח: {{customer_full_name}}',
      'ארגון: {{org_name}}',
      'מדריך: {{guide_names}}',
      'מועד הסיור: {{tour_date}} {{tour_time}}',
      'יתרה לתשלום: {{payment_balance}}',
      '',
      'לינק לדיל: {{deal_link}}',
    ].join('\n'),
    en: [
      '💰 Payment received 💰',
      '',
      'Customer: {{customer_full_name}}',
      'Organization: {{org_name}}',
      'Guide: {{guide_names}}',
      'Tour: {{tour_date}} {{tour_time}}',
      'Outstanding balance: {{payment_balance}}',
      '',
      'Deal: {{deal_link}}',
    ].join('\n'),
  },

  'AUT-002': {
    eventName: 'סיכום סיור הוגש — התראה למנהלים',
    channel: 'whatsapp',
    messageName: 'סיכום סיור חדש לקריאה',
    he: [
      '📝 סיכום סיור חדש 📝',
      '',
      'מדריך: {{guide_names}}',
      'לקוח: {{customer_full_name}}',
      'ארגון: {{org_name}}',
      'מוצר: {{tour_product}}',
      'מועד הסיור: {{tour_date}} {{tour_time}}',
      '',
      'לקריאה ואישור במשימות הנהלה.',
    ].join('\n'),
    en: [
      '📝 New tour summary 📝',
      '',
      'Guide: {{guide_names}}',
      'Customer: {{customer_full_name}}',
      'Organization: {{org_name}}',
      'Product: {{tour_product}}',
      'Tour: {{tour_date}} {{tour_time}}',
      '',
      'Ready for review in Management Tasks.',
    ].join('\n'),
  },

  'AUT-003': {
    eventName: 'דו״ח לוגיסטי — התראה לאחראית הלוגיסטיקה',
    channel: 'whatsapp',
    messageName: 'התראת דו״ח לוגיסטי',
    he: [
      '⚠ דו״ח לוגיסטי חדש ⚠',
      '',
      'מדריך: {{guide_names}}',
      'מועד הסיור: {{tour_date}} {{tour_time}}',
      'מוצר: {{tour_product}}',
      '',
      'הפירוט המלא נמצא בכרטיס הלוגיסטי במשימות הנהלה.',
    ].join('\n'),
    en: [
      '⚠ New logistics report ⚠',
      '',
      'Guide: {{guide_names}}',
      'Tour: {{tour_date}} {{tour_time}}',
      'Product: {{tour_product}}',
      '',
      'Full details are on the logistics card in Management Tasks.',
    ].join('\n'),
  },
};

async function seedOne(def, seed) {
  const triggerType = automationTriggerType(def.id);
  const existing = await prisma.communicationEvent.findFirst({
    where: { triggerType },
    include: { messages: true },
  });
  if (existing) {
    console.log(`  = ${def.id} — event already exists ("${existing.internalName}", ${existing.messages.length} messages) — untouched`);
    return { created: false };
  }
  if (!EXECUTE) {
    console.log(`  + ${def.id} — would create "${seed.eventName}" with 1 ${seed.channel} message (he+en)`);
    return { created: false };
  }

  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.communicationEvent.create({
      data: {
        internalName: seed.eventName,
        description: def.descriptionHe,
        triggerType,
        // DRAFT: the event goes live only once an operator chooses the
        // destination. Activating with no destination would produce skipped
        // deliveries that look like failures.
        status: 'draft',
        anchorType: 'trigger_time',
        timingMode: 'immediate',
      },
    });

    const message = await tx.communicationMessage.create({
      data: {
        eventId: event.id,
        internalName: seed.messageName,
        channel: seed.channel,
        status: 'active',
        // Internal notification → the office WhatsApp group. The operator picks
        // WHICH group; until then the event stays draft.
        audienceType: 'wa_group',
        waDestinationType: seed.channel === 'whatsapp' ? 'group' : undefined,
        // 'auto' = each recipient gets their own language (staff preferred
        // language now feeds this — see communication/recipients.js).
        languagePolicy: 'auto',
        fallbackLanguage: 'he',
        draftContent: {
          he: { body: seed.he },
          en: { body: seed.en, enState: 'seeded' },
        },
      },
    });

    // Publish the CONTENT immediately: the wording is ready, only the
    // destination is missing. A published version is what deliveries freeze.
    const version = await tx.communicationMessageVersion.create({
      data: {
        messageId: message.id,
        versionNo: 1,
        content: {
          he: { body: seed.he },
          en: { body: seed.en, enState: 'seeded' },
          attachments: [],
          channelConfig: {
            channel: seed.channel,
            audienceType: 'wa_group',
            languagePolicy: 'auto',
            fallbackLanguage: 'he',
          },
        },
        note: 'נוצר אוטומטית עם האוטומציה — ניתן לערוך כאן ככל מסר אחר',
      },
    });
    await tx.communicationMessage.update({
      where: { id: message.id },
      data: { publishedVersionId: version.id },
    });
    return event;
  }, { timeout: 20_000 });

  console.log(`  + ${def.id} — created event "${seed.eventName}" (draft) + 1 published ${seed.channel} message (he+en)`);
  return { created: true, eventId: created.id };
}

async function run() {
  console.log(EXECUTE ? '=== EXECUTING ===' : '=== DRY RUN ===');
  let created = 0;
  for (const def of listAutomations()) {
    const seed = SEEDS[def.id];
    if (!seed) {
      console.log(`  ? ${def.id} — no seed defined, skipped`);
      continue;
    }
    const r = await seedOne(def, seed);
    if (r.created) created++;
  }
  console.log(`\ncreated=${created}`);
  console.log(
    EXECUTE
      ? '\nNEXT STEP FOR THE OPERATOR: open each event in מרכז התקשורת, choose the\n'
        + 'WhatsApp group (or switch the message to email), then set the event to פעיל.'
      : '\nDry run — nothing written. Re-run with --execute.',
  );
  await prisma.$disconnect();
}

run().catch(async (e) => {
  console.error('FAILED:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
