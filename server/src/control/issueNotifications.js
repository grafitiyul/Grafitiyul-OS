import { sendSimpleEmail } from '../email/simpleSend.js';
import { sendWhatsAppText } from '../whatsapp/send.js';
import { refreshIssueClosure } from './issueRequirements.js';

// Part 4 customer-notification flow. Per (requirement × recipient × channel) send
// audit reusing the EXISTING email (sendSimpleEmail) and WhatsApp
// (sendWhatsAppText) pipelines — no parallel sender. Retrying updates the SAME
// row (dedup), appending to retryHistory. The customer_notification requirement
// completes only when EVERY required recipient has a successful send.

function fmtWhen(date, startTime) {
  if (!date) return 'ללא תאריך';
  const [y, m, d] = String(date).split('-');
  return `${d}.${m}.${y}${startTime ? ' ' + startTime : ''}`;
}

// Default editable message describing the exact before → after change.
export function defaultMessage(issue) {
  const d = issue.data || {};
  const before = fmtWhen(d.before?.date, d.before?.startTime);
  const after = fmtWhen(d.after?.date, d.after?.startTime);
  if (d.impactType === 'tour_cancelled') {
    return {
      subject: 'עדכון לגבי הסיור שלך — ביטול מועד',
      body: `שלום,\nרצינו לעדכן שהסיור שתוכנן ל-${before} בוטל.\nנשמח לסייע בקביעת מועד חלופי.\nתודה, צוות גרפיטיול`,
    };
  }
  return {
    subject: 'עדכון לגבי מועד הסיור שלך',
    body: `שלום,\nרצינו לעדכן ששעת/מועד הסיור עודכן.\nמקודם: ${before}\nעכשיו: ${after}\nנתראה בסיור!\nצוות גרפיטיול`,
  };
}

// Recipients from the canonical impact customers[] (registration/deal derived).
export function recipientsFor(issue) {
  return (issue.data?.customers || []).map((c) => ({
    recipientKey: c.registrationId || c.dealId || c.email || c.phone || 'unknown',
    name: c.name,
    email: c.email,
    phone: c.phone,
    dealId: c.dealId || null,
  }));
}

function sanitizeProvider(result, error) {
  if (error) return { error };
  if (result && typeof result === 'object') {
    try {
      return JSON.parse(JSON.stringify(result));
    } catch {
      return { ok: true };
    }
  }
  return { ok: true };
}

// Send ONE notification. deps.sendEmail/sendWhatsApp are injectable for tests.
export async function sendNotification(client, { requirement, recipient, channel, subject, body, deps = {} }) {
  const key = {
    requirementId_recipientKey_channel: { requirementId: requirement.id, recipientKey: recipient.recipientKey, channel },
  };
  const existing = await client.issueNotification.findUnique({ where: key });
  const attempts = (existing?.attempts || 0) + 1;

  let status = 'sent';
  let result = null;
  let error = null;
  try {
    if (channel === 'email') {
      if (!recipient.email) throw new Error('no_email_address');
      const send = deps.sendEmail || sendSimpleEmail;
      result = await send({ to: recipient.email, subject, bodyText: body, dealId: recipient.dealId || null });
    } else {
      if (!recipient.phone) throw new Error('no_phone');
      const send = deps.sendWhatsApp || sendWhatsAppText;
      result = await send(recipient.phone, body, {});
    }
  } catch (e) {
    status = 'failed';
    error = e.message;
  }

  const entry = { status, error: error || null, attempt: attempts };
  const retryHistory = [...(existing?.retryHistory || []), entry];
  const row = await client.issueNotification.upsert({
    where: key,
    create: {
      requirementId: requirement.id,
      recipientKey: recipient.recipientKey,
      recipientName: recipient.name || null,
      address: recipient.email || null,
      phone: recipient.phone || null,
      channel,
      subject,
      body,
      status,
      sentAt: status === 'sent' ? new Date() : null,
      attempts,
      providerResult: sanitizeProvider(result, error),
      retryHistory,
    },
    update: {
      subject,
      body,
      status,
      sentAt: status === 'sent' ? new Date() : existing?.sentAt ?? null,
      attempts,
      providerResult: sanitizeProvider(result, error),
      retryHistory,
    },
  });
  return row;
}

// Re-evaluate the customer_notification requirement after sends. Completes only
// when EVERY required recipient has at least one successful send; partial → stays
// in_progress (issue stays OPEN). Then refresh parent closure.
export async function evaluateCustomerNotification(client, requirementId) {
  const req = await client.issueRequirement.findUnique({
    where: { id: requirementId },
    include: { issue: true, notifications: true },
  });
  if (!req) return;
  const recipients = recipientsFor(req.issue);
  const sentKeys = new Set(req.notifications.filter((n) => n.status === 'sent').map((n) => n.recipientKey));
  const allSent = recipients.length > 0 && recipients.every((r) => sentKeys.has(r.recipientKey));
  const anySent = sentKeys.size > 0;
  const nextState = allSent ? 'completed' : anySent ? 'in_progress' : req.state;
  if (nextState !== req.state && !['completed', 'waived'].includes(req.state)) {
    await client.issueRequirement.update({
      where: { id: requirementId },
      data: { state: nextState, ...(allSent ? { resolvedAt: new Date(), resolvedByName: 'auto' } : {}) },
    });
  }
  await refreshIssueClosure(client, req.issueId);
}
