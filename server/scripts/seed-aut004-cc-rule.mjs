// Seed the Communication Center rule for AUT-004 (new external lead → manager
// WhatsApp alert): one event on trigger automation:AUT-004 + one WhatsApp
// message with Hebrew and English side by side, published and activated.
//
// Fully editable afterwards in the Communication Center UI — this script only
// authors the initial content, exactly as an operator would through the editor.
//
// Destination: copied from the Manager Reports WhatsApp configuration
// (AdminReportConfig — the configured manager destination), never hardcoded.
// If no manager destination is configured the message stays a DRAFT with the
// validation errors printed, and the automation shows "ממתינה לתלות" until an
// operator picks a destination in the UI. Idempotent: an existing event on the
// trigger is updated, never duplicated.
//
// Run (from server/):  DB_URL=<postgres url> node scripts/seed-aut004-cc-rule.mjs [--dry-run]

const dbUrl = process.env.DB_URL || process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('No DB_URL provided.');
  process.exit(1);
}
process.env.DATABASE_URL = dbUrl;
const dryRun = process.argv.includes('--dry-run');

// Registers AUT definitions → derives the automation:AUT-004 trigger in the
// catalog, so the canonical validators recognize it.
await import('../src/automations/definitions/index.js');
const { prisma } = await import('../src/db.js');
const { validateMessageForPublish, validateEventForActivation } = await import('../src/communication/validation.js');

const TRIGGER = 'automation:AUT-004';

// Compact WhatsApp-friendly bodies. The optional whole-line variables
// (lead_org_line / lead_interest_line) carry their own label + trailing line
// break and render as NOTHING when absent — no empty labels, no blank lines.
const HE_BODY =
  '<p>🆕 ליד חדש מ־{{lead_source}}</p>'
  + '<p>שם: {{customer_full_name}}<br>טלפון: {{customer_phone}}<br>{{lead_org_line}}{{lead_interest_line}}דיל:<br>{{deal_link}}</p>'
  + '<p>בהצלחה 💪</p>';
const EN_BODY =
  '<p>🆕 New lead from {{lead_source}}</p>'
  + '<p>Name: {{customer_full_name}}<br>Phone: {{customer_phone}}<br>{{lead_org_line}}{{lead_interest_line}}Deal:<br>{{deal_link}}</p>'
  + '<p>Good luck 💪</p>';

async function main() {
  // The configured manager WhatsApp destination (Manager Reports config).
  const managerCfg = await prisma.adminReportConfig.findFirst({
    where: { enabled: true, channel: 'whatsapp', waChatId: { not: null } },
    select: { waAccountId: true, waChatId: true, reportNumber: true },
    orderBy: { reportNumber: 'asc' },
  });
  console.log('[seed] manager WhatsApp destination:', managerCfg
    ? `account ${managerCfg.waAccountId} · chat ${managerCfg.waChatId} (from report #${managerCfg.reportNumber})`
    : 'NOT CONFIGURED — message will stay draft (automation waits)');

  let event = await prisma.communicationEvent.findFirst({
    where: { triggerType: TRIGGER },
    include: { messages: true },
  });
  if (!event) {
    console.log('[seed] creating event on', TRIGGER);
    if (!dryRun) {
      event = await prisma.communicationEvent.create({
        data: {
          internalName: 'ליד חדש — עדכון מנהלים',
          description:
            'הודעת ווטסאפ למנהלים על כל ליד חדש אמיתי ממקור חיצוני (AUT-004). '
            + 'התוכן, היעד ושעות השליחה נשלטים כאן; ההפעלה עצמה — ברישום האוטומציות.',
          triggerType: TRIGGER,
          anchorType: 'trigger_time',
          timingMode: 'immediate',
          activityMode: 'all',
          status: 'draft',
        },
      });
      event = { ...event, messages: [] };
    } else {
      console.log('[seed] dry-run — stopping before writes');
      return;
    }
  } else {
    console.log(`[seed] event exists (${event.id}, status ${event.status}) — updating in place`);
  }

  let message = event.messages.find((m) => m.channel === 'whatsapp') || null;
  const messageData = {
    audienceType: 'wa_group',
    waDestinationType: 'group',
    waAccountId: managerCfg?.waAccountId || null,
    waGroupChatId: managerCfg?.waChatId || null,
    // Manager-report language policy: managers receive Hebrew; the English
    // version is stored side-by-side in the editor (enState reviewed).
    languagePolicy: 'he_only',
    fallbackLanguage: 'he',
    // No per-message window — the manager×whatsapp audience policy governs
    // timing (sendingPolicy precedence), configured on the Queue screen.
    windowEnabled: false,
    draftContent: {
      he: { body: HE_BODY },
      en: { body: EN_BODY },
      enState: 'reviewed',
    },
  };
  if (!message) {
    console.log('[seed] creating WhatsApp message');
    message = await prisma.communicationMessage.create({
      data: { eventId: event.id, channel: 'whatsapp', status: 'draft', ...messageData },
    });
  } else {
    console.log(`[seed] message exists (#${message.publicNumber}) — refreshing content/destination`);
    message = await prisma.communicationMessage.update({
      where: { id: message.id },
      data: messageData,
    });
  }

  // The SAME validator the publish endpoint runs — never a private copy.
  const errors = await validateMessageForPublish(message, event);
  if (errors.length) {
    console.log('[seed] NOT publishing — validation errors (message stays draft, automation waits):');
    for (const e of errors) console.log('   ·', e);
    return;
  }

  // Publish: freeze an immutable version and point live at it (the exact
  // transaction the publish endpoint performs).
  const draft = message.draftContent || {};
  await prisma.$transaction(async (tx) => {
    const last = await tx.communicationMessageVersion.aggregate({
      where: { messageId: message.id }, _max: { versionNo: true },
    });
    const version = await tx.communicationMessageVersion.create({
      data: {
        messageId: message.id,
        versionNo: (last._max.versionNo || 0) + 1,
        content: {
          he: draft.he || null,
          en: draft.en || null,
          enState: draft.enState || null,
          attachments: message.attachments || [],
          channelConfig: {
            channel: message.channel,
            audienceType: message.audienceType,
            waAccountId: message.waAccountId,
            waDestinationType: message.waDestinationType,
            waGroupChatId: message.waGroupChatId,
            languagePolicy: message.languagePolicy,
            fallbackLanguage: message.fallbackLanguage,
            windowEnabled: message.windowEnabled,
            sendingWindowId: message.sendingWindowId,
          },
        },
        note: 'seed: AUT-004 new-lead manager alert',
      },
    });
    await tx.communicationMessage.update({
      where: { id: message.id },
      data: { publishedVersionId: version.id, status: 'active' },
    });
  });
  console.log(`[seed] published message #${message.publicNumber}`);

  const fresh = await prisma.communicationEvent.findUnique({ where: { id: event.id }, include: { messages: true } });
  const actErrors = validateEventForActivation(fresh);
  if (actErrors.length) {
    console.log('[seed] event NOT activated:', actErrors.join(' · '));
    return;
  }
  await prisma.communicationEvent.update({ where: { id: event.id }, data: { status: 'active' } });
  console.log('[seed] event ACTIVE — AUT-004 is live end-to-end');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
