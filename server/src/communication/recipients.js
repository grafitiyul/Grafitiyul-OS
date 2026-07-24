// Server-side recipient resolution — the ONE policy for turning a message's
// audience configuration into concrete deliverable recipients, shared by the
// live engine, the worker's pre-send re-check, and the preview.
//
// Documented multi-recipient policy: a source that resolves to multiple people
// (assigned_guides) creates ONE DELIVERY PER RECIPIENT — never a silent pick.
// A source that resolves to nobody yields zero recipients and the engine
// records a 'skipped' delivery with skipReason 'missing_recipient' (visible in
// the log — never a silent drop).
//
// Language: recipient's canonical communication language (Contact.
// communicationLanguage) under languagePolicy 'auto', with the message's
// explicit fallbackLanguage when unknown; he_only/en_only force one language.
// Phones/emails are read fresh at resolution time — never copied into the
// template — so contact-data edits made while a delivery waits are honored at
// send time (the worker re-resolves before sending).

import { prisma } from '../db.js';
import { contactPhone, contactEmail, contactFullName } from './context.js';

function contactRecipient(contact, channel) {
  if (!contact) return null;
  const phone = contactPhone(contact);
  const email = contactEmail(contact);
  return {
    key: `contact:${contact.id}`,
    contactId: contact.id,
    name: contactFullName(contact) || contactFullName(contact, 'en'),
    phone,
    email,
    language: contact.communicationLanguage || null,
    missing: channel === 'whatsapp' ? !phone : !email,
  };
}

function personRecipient(person, channel) {
  if (!person) return null;
  return {
    key: `person:${person.id}`,
    personRefId: person.id,
    name: person.displayName,
    phone: person.phone || null,
    email: person.email || null,
    language: 'he', // staff communications are Hebrew-canonical
    missing: channel === 'whatsapp' ? !person.phone : !person.email,
  };
}

/**
 * Resolve a message's recipients against a loaded context.
 * Returns { recipients: [...], group: {...}|null, error? }.
 * WhatsApp group destination resolves the group (fresh — availability +
 * account-membership re-checked) instead of person recipients.
 */
export async function resolveRecipients(message, ctx) {
  if (message.channel === 'whatsapp' && message.waDestinationType === 'group') {
    if (!message.waGroupChatId) return { recipients: [], group: null, error: 'לא נבחרה קבוצת WhatsApp' };
    const chat = await prisma.whatsAppChat.findUnique({
      where: { id: message.waGroupChatId },
      select: {
        id: true, accountId: true, externalChatId: true, type: true,
        groupSubject: true, providerDeletedAt: true, hiddenAt: true,
      },
    });
    if (!chat || chat.type !== 'group') return { recipients: [], group: null, error: 'הקבוצה שנבחרה אינה קיימת עוד' };
    if (chat.providerDeletedAt) return { recipients: [], group: chatGroup(chat), error: 'הקבוצה נמחקה ב-WhatsApp' };
    if (message.waAccountId && chat.accountId !== message.waAccountId) {
      // A group belongs to the account that synced it — never silently send
      // through an account that is not a member.
      return { recipients: [], group: chatGroup(chat), error: 'הקבוצה אינה נגישה לחשבון השולח שנבחר' };
    }
    return {
      recipients: [{
        key: `group:${chat.id}`,
        groupChatId: chat.id,
        groupJid: chat.externalChatId,
        name: chat.groupSubject || 'קבוצת WhatsApp',
        language: 'he',
        missing: false,
      }],
      group: chatGroup(chat),
    };
  }

  switch (message.audienceType) {
    case 'primary_contact': {
      const r = contactRecipient(ctx.contact, message.channel);
      return { recipients: r ? [r] : [], group: null };
    }
    case 'field_contact': {
      const r = contactRecipient(ctx.fieldContact, message.channel);
      return { recipients: r ? [r] : [], group: null };
    }
    case 'assigned_guides': {
      // One delivery per assigned guide (documented policy above).
      const list = (ctx.tour?.assignments || [])
        .map((a) => personRecipient(a.personRef, message.channel))
        .filter(Boolean);
      // Dedup (a person may hold two roles on the same tour).
      const seen = new Set();
      const unique = list.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
      return { recipients: unique, group: null };
    }
    case 'explicit_contact': {
      if (!message.audienceContactId) return { recipients: [], group: null, error: 'לא נבחר איש קשר' };
      const contact = await prisma.contact.findUnique({
        where: { id: message.audienceContactId },
        include: { phones: true, emails: true },
      });
      const r = contactRecipient(contact, message.channel);
      return { recipients: r ? [r] : [], group: null, error: contact ? undefined : 'איש הקשר שנבחר אינו קיים עוד' };
    }
    case 'explicit_staff': {
      if (!message.audiencePersonRefId) return { recipients: [], group: null, error: 'לא נבחר איש צוות' };
      const person = await prisma.personRef.findUnique({ where: { id: message.audiencePersonRefId } });
      const r = personRecipient(person, message.channel);
      return { recipients: r ? [r] : [], group: null, error: person ? undefined : 'איש הצוות שנבחר אינו קיים עוד' };
    }
    default:
      return { recipients: [], group: null, error: `סוג נמען לא מוכר: ${message.audienceType}` };
  }
}

function chatGroup(chat) {
  return chat
    ? { id: chat.id, accountId: chat.accountId, jid: chat.externalChatId, subject: chat.groupSubject }
    : null;
}

/** Effective language for a recipient under the message's language policy. */
export function resolveLanguage(message, recipient) {
  if (message.languagePolicy === 'he_only') return 'he';
  if (message.languagePolicy === 'en_only') return 'en';
  const lang = recipient?.language;
  if (lang === 'he' || lang === 'en') return lang;
  return message.fallbackLanguage === 'en' ? 'en' : 'he';
}
