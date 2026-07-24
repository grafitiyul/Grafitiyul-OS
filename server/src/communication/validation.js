// Publication validation — a message may only go live when its configuration
// can actually deliver. Errors are human-readable Hebrew (never raw IDs), and
// publication is blocked while any exist. The same checks power the editor's
// inline warnings (GET returns them for draft messages too).

import { prisma } from '../db.js';
import { bridgeUrlMap } from '../whatsapp/bridgeClient.js';
import { triggerByType, CHANNELS, AUDIENCE_TYPES } from './triggers.js';
import { variableByKey, extractTokens } from './variables.js';
import { documentKind } from './documents.js';

const hasText = (v) => !!String(v ?? '').replace(/<[^>]*>/g, '').trim();

export async function validateMessageForPublish(message, event) {
  const errors = [];
  const draft = message.draftContent || {};
  const trigger = triggerByType(event.triggerType);
  const contexts = new Set([...(trigger?.contexts || []), 'contact']);

  if (!CHANNELS.includes(message.channel)) errors.push('ערוץ לא תקין');

  // ── content ──
  const heOk = hasText(draft.he?.body);
  const enOk = hasText(draft.en?.body);
  if (message.languagePolicy === 'he_only' && !heOk) errors.push('חסר תוכן בעברית');
  else if (message.languagePolicy === 'en_only' && !enOk) errors.push('חסר תוכן באנגלית');
  else if (message.languagePolicy === 'auto' && !heOk && !enOk) errors.push('חסר תוכן — יש למלא לפחות שפה אחת');
  if (message.channel === 'email') {
    if (heOk && !hasText(draft.he?.subject)) errors.push('חסרה שורת נושא בעברית');
    if (enOk && !hasText(draft.en?.subject)) errors.push('חסרה שורת נושא באנגלית');
  }

  // ── variables must be known AND available for this trigger ──
  const allText = [draft.he?.subject, draft.he?.body, draft.en?.subject, draft.en?.body]
    .map((s) => String(s ?? '')).join('\n');
  for (const key of extractTokens(allText)) {
    const def = variableByKey(key);
    if (!def) errors.push(`משתנה לא מוכר: {{${key}}}`);
    else if (!def.contexts.some((c) => contexts.has(c))) {
      errors.push(`המשתנה "${def.labelHe}" אינו זמין עבור הטריגר שנבחר`);
    }
  }

  // ── documents ──
  for (const token of Array.isArray(message.attachments) ? message.attachments : []) {
    const kind = documentKind(token.kind);
    if (!kind) { errors.push(`סוג מסמך לא מוכר: ${token.kind}`); continue; }
    if (!kind.modes.includes(token.mode || 'attach')) {
      errors.push(`המסמך "${kind.labelHe}" תומך רק ב: ${kind.modes.join(', ')}`);
    }
    if (!kind.contexts.some((c) => contexts.has(c))) {
      errors.push(`המסמך "${kind.labelHe}" אינו זמין עבור הטריגר שנבחר`);
    }
  }

  // ── audience ──
  if (message.channel === 'whatsapp' && message.waDestinationType === 'group') {
    // group destination — handled below
  } else if (!AUDIENCE_TYPES.includes(message.audienceType) || message.audienceType === 'wa_group') {
    errors.push('לא הוגדר נמען למסר');
  } else if (message.audienceType === 'explicit_contact') {
    if (!message.audienceContactId) errors.push('לא נבחר איש קשר');
    else if (!(await prisma.contact.findUnique({ where: { id: message.audienceContactId }, select: { id: true } }))) {
      errors.push('איש הקשר שנבחר אינו קיים עוד');
    }
  } else if (message.audienceType === 'explicit_staff') {
    if (!message.audiencePersonRefId) errors.push('לא נבחר איש צוות');
    else if (!(await prisma.personRef.findUnique({ where: { id: message.audiencePersonRefId }, select: { id: true } }))) {
      errors.push('איש הצוות שנבחר אינו קיים עוד');
    }
  } else if (message.audienceType === 'assigned_guides' && !contexts.has('tour')) {
    errors.push('הטריגר שנבחר אינו כולל סיור — לא ניתן לשלוח למדריכים');
  } else if (message.audienceType === 'field_contact' && !contexts.has('deal')) {
    errors.push('הטריגר שנבחר אינו כולל דיל — אין נציג בשטח');
  }

  // ── WhatsApp sender + destination ──
  if (message.channel === 'whatsapp') {
    const bridges = bridgeUrlMap();
    if (!message.waAccountId) {
      errors.push('לא נבחר חשבון WhatsApp שולח');
    } else {
      const account = await prisma.whatsAppAccount.findUnique({ where: { id: message.waAccountId } });
      const knownToBridge = !!bridges[message.waAccountId];
      if (!account && !knownToBridge) errors.push('חשבון ה-WhatsApp שנבחר אינו קיים עוד');
      else if (account && account.active === false) errors.push('חשבון ה-WhatsApp שנבחר מושבת');
    }
    if (!message.waDestinationType) {
      errors.push('לא נבחר סוג יעד (שיחה פרטית / קבוצה)');
    } else if (message.waDestinationType === 'group') {
      if (!message.waGroupChatId) {
        errors.push('לא נבחרה קבוצת WhatsApp');
      } else {
        const chat = await prisma.whatsAppChat.findUnique({
          where: { id: message.waGroupChatId },
          select: { id: true, type: true, accountId: true, providerDeletedAt: true, groupSubject: true },
        });
        if (!chat || chat.type !== 'group') errors.push('הקבוצה שנבחרה אינה קיימת עוד');
        else if (chat.providerDeletedAt) errors.push('הקבוצה שנבחרה נמחקה ב-WhatsApp');
        else if (message.waAccountId && chat.accountId !== message.waAccountId) {
          errors.push('הקבוצה שנבחרה אינה נגישה לחשבון השולח שנבחר — בחרו קבוצה של אותו חשבון');
        }
      }
    }
  }

  // ── sending window ──
  if (message.windowEnabled) {
    if (!message.sendingWindowId) errors.push('סומן "כפוף לחלון שליחה" אך לא נבחר חלון');
    else if (!(await prisma.communicationSendingWindow.findUnique({ where: { id: message.sendingWindowId }, select: { id: true } }))) {
      errors.push('חלון השליחה שנבחר אינו קיים עוד');
    }
  }

  return errors;
}

export function validateEventForActivation(event) {
  const errors = [];
  if (!String(event.internalName || '').trim()) errors.push('חסר שם לאירוע');
  if (!triggerByType(event.triggerType)) errors.push('טריגר לא תקין');
  const trigger = triggerByType(event.triggerType);
  if (trigger && !trigger.anchors.includes(event.anchorType)) {
    errors.push('עוגן הזמן שנבחר אינו נתמך עבור הטריגר');
  }
  if (event.timingMode === 'before' && event.anchorType === 'trigger_time') {
    errors.push('"לפני" אפשרי רק ביחס למועד הסיור, לא לרגע האירוע');
  }
  if (event.timingMode !== 'immediate') {
    if (!event.timingAmount || event.timingAmount < 1) errors.push('חסר ערך זמן לתזמון');
    if (!['minutes', 'hours', 'days', 'weeks', 'months'].includes(event.timingUnit)) errors.push('חסרה יחידת זמן לתזמון');
  }
  if (['include', 'exclude'].includes(event.activityMode) && !(event.activityTypes || []).length) {
    errors.push('נבחר סינון סוגי פעילות אך לא נבחרו סוגים');
  }
  return errors;
}
