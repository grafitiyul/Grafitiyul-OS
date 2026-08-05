// The automatic WhatsApp reply to a genuinely new EXTERNAL lead.
//
// ── What decides "external" ─────────────────────────────────────────────────
// Nothing in this file. The origin rule is WHO CALLS IT, exactly as it already
// is for the manager new-lead report: adminReports/newLeadEvent.js is the ONE
// fan-out point, and its only callers are
//   • ingress/pipeline.js  — outcome 'created_deal' of kind 'lead' (website
//     forms, Meta Lead Ads, and every adapter added later)
//   • mirror/creators.js   — the Pipedrive create-only lead bridge, guarded by
//     atomicCreate's alreadyExisted check
// Manual creation, deals opened from a WhatsApp or Email conversation,
// duplication, migration imports, repair scripts, Woo/payment/order flows and
// every internal admin API simply never reach that fan-out. There is no flag to
// get wrong and no title or name heuristic anywhere in the decision.
//
// ── Exactly once ────────────────────────────────────────────────────────────
// The deal id is the immutable creation identity shared by both intake paths.
// The ledger row is CLAIMED (unique insert) before any work happens, so a
// webhook retried 27 times produces one row and one message: the 2nd..27th
// attempts lose the insert race and stop immediately. Ingress retries resolve
// to the same deal; a duplicate ingress event never reaches 'created_deal' at
// all, so it never gets here in the first place.
//
// ── No silent failures ──────────────────────────────────────────────────────
// EVERY attempt ends as a NewLeadAutoReply row with an explicit status and
// reason — including the deliberate skips (no starred template, unusable phone,
// unknown country, missing language content, WhatsApp unavailable). "Nothing
// happened" is never an acceptable outcome to leave unrecorded.

import { prisma } from '../db.js';
import { loadTriggerContext, contactPhone } from '../communication/context.js';
import { resolveTemplateBody } from './templateResolve.js';
import { getStarredTemplate, templateLanguages, newLeadAccountIdOf } from './newLeadTemplate.js';
import { leadSendLanguage } from './leadLanguage.js';
import { enqueueCustomerWhatsApp } from './customerQueue.js';
import { listSelectableAccounts, configuredAccounts } from './senderAccount.js';

/** The idempotency identity of one automatic reply. */
export const autoReplyKey = (dealId) => `new_lead_auto_reply:${dealId}`;

// Operator-facing skip reasons. Codes are stable (queried/reported on); the
// Hebrew text is what a human reads in the ledger.
export const SKIP_TEXT = Object.freeze({
  no_starred_template: 'לא סומן נוסח ברירת מחדל לליד חדש — לא נשלחה תשובה אוטומטית',
  no_deal: 'לא נמצא דיל',
  no_contact: 'לא נמצא איש קשר בדיל',
  missing_phone: 'אין מספר טלפון לליד',
  invalid_phone: 'מספר הטלפון אינו תקין או שלא ניתן לזהות את המדינה',
  missing_he_content: 'לליד ישראלי נדרש נוסח בעברית — לנוסח שסומן אין תוכן בעברית',
  missing_en_content: 'לליד זר נדרש נוסח באנגלית — לנוסח שסומן אין תוכן באנגלית',
  empty_render: 'הנוסח התרוקן אחרי מילוי המשתנים — לא נשלח',
  no_account: 'אין חשבון WhatsApp זמין לשליחה',
  // The account the operator CHOSE cannot send right now. Never silently
  // replaced by the other number — the customer would receive a first message
  // from a business line the office did not pick.
  account_unknown: 'החשבון שנבחר לשליחה אינו קיים יותר — יש לבחור חשבון בהגדרות הנוסחים',
  account_not_configured: 'החשבון שנבחר לשליחה אינו מוגדר בשרת — לא נשלחה הודעה',
  account_disconnected: 'החשבון שנבחר לשליחה מנותק כרגע — לא נשלחה הודעה ולא הוחלף חשבון',
  empty_content: 'אין תוכן לשליחה',
  duplicate: 'האירוע כבר טופל — לא נשלחה הודעה נוספת',
});

/** Close the ledger row with a final status. Never throws into the caller. */
async function finish(db, id, data, log) {
  try {
    await db.newLeadAutoReply.update({ where: { id }, data });
  } catch (err) {
    log.error?.(`[new-lead-reply] ledger update failed: ${err?.message || err}`);
  }
}

/**
 * Attempt ONE automatic reply for one newly created external lead.
 *
 * Never throws: an automatic courtesy message must never be able to fail lead
 * creation, a webhook response or a Pipedrive sync.
 *
 * @returns {{ status:'queued'|'skipped'|'failed'|'duplicate', reason?:string }}
 */
export async function sendNewLeadAutoReply(
  { dealId, origin = null, ingressEventId = null },
  log = console,
  // `loadContext` is the ONLY injected dependency, and only because the
  // canonical context loader reaches straight for the real prisma client.
  // The queue write is deliberately NOT injected: a test must prove that a
  // real WhatsAppScheduledMessage row is created with the customer shape,
  // not that a stub was called.
  { db = prisma, loadContext = loadTriggerContext } = {},
) {
  if (!dealId) return { status: 'skipped', reason: 'no_deal' };
  const idempotencyKey = autoReplyKey(dealId);

  // ── Claim ────────────────────────────────────────────────────────────────
  // Before ANY work, so concurrent deliveries of the same event cannot both
  // proceed. Losing this insert is the normal, correct outcome for a retry.
  let ledger;
  try {
    ledger = await db.newLeadAutoReply.create({
      data: { idempotencyKey, origin, ingressEventId, dealId, status: 'pending' },
      select: { id: true },
    });
  } catch (err) {
    if (err?.code === 'P2002') return { status: 'duplicate', reason: 'duplicate' };
    log.error?.(`[new-lead-reply] claim failed: ${err?.message || err}`);
    return { status: 'failed', reason: 'claim_failed' };
  }

  const skip = async (reason, extra = {}) => {
    await finish(db, ledger.id, { status: 'skipped', reason: SKIP_TEXT[reason] || reason, ...extra }, log);
    log.info?.(`[new-lead-reply] skipped deal=${dealId} (${reason})`);
    return { status: 'skipped', reason };
  };

  try {
    // ── The starred template ────────────────────────────────────────────────
    // Read FIRST: no star means no automatic reply at all, and that is a
    // perfectly valid configuration the operator chose.
    const template = await getStarredTemplate(db);
    if (!template) return skip('no_starred_template');

    // ── Canonical context ──────────────────────────────────────────────────
    // The same loader every real communication uses; ctx.contact IS the deal's
    // primary contact. Nothing about the customer is re-derived here.
    const ctx = await loadContext({ dealId });
    if (!ctx?.deal) return skip('no_deal');
    if (!ctx.contact) return skip('no_contact');

    // ── Language, from the phone and only the phone ─────────────────────────
    const phone = contactPhone(ctx.contact);
    const { language, phoneIntl, reason: langReason } = leadSendLanguage(phone);
    if (!language) return skip(langReason, { phoneIntl });

    // ── The right language's content must exist ─────────────────────────────
    // No cross-language fallback, ever: a foreign lead does not receive Hebrew
    // because English was left empty. The lead stays intact and the gap is
    // reported so the operator can fill it.
    const langs = templateLanguages(template);
    if (!langs[language]) {
      return skip(language === 'he' ? 'missing_he_content' : 'missing_en_content', {
        phoneIntl,
        language,
        templateId: template.id,
        templateName: template.nameHe,
      });
    }

    // ── Render through the canonical resolver ───────────────────────────────
    // Same path the Deal composer uses: chips/HTML → WhatsApp markup → variable
    // substitution. A missing value resolves to EMPTY and the spacing is
    // normalized — a raw {{token}} can never reach a customer.
    const bodyHtml = language === 'en' ? template.bodyEnHtml : template.bodyHeHtml;
    const { text, missing } = resolveTemplateBody(bodyHtml, ctx, language);
    if (!text.trim()) {
      return skip('empty_render', {
        phoneIntl, language, templateId: template.id, templateName: template.nameHe,
      });
    }
    if (missing?.length) {
      log.info?.(`[new-lead-reply] deal=${dealId} unresolved variables: ${missing.join(', ')}`);
    }

    // ── Which number sends it ───────────────────────────────────────────────
    // The operator's choice on the starred template, never an environment
    // variable and never a guess. Validated against the CANONICAL account list
    // (the same one every sending surface reads) before anything is queued.
    //
    // The critical rule: if the chosen account cannot send, we DO NOT send from
    // the other one. A customer's very first impression must come from the
    // number the office picked, so an unavailable account is a recorded skip —
    // never a silent substitution.
    const accountId = newLeadAccountIdOf(template);
    const accounts = await listSelectableAccounts(db);
    const account = accounts.find((a) => a.id === accountId) || null;
    const accountNote = {
      phoneIntl, language, templateId: template.id, templateName: template.nameHe,
      renderedText: text, accountId,
    };
    if (!account) return skip('account_unknown', accountNote);
    // Addressability is checked against the bridge map DIRECTLY, not through
    // listSelectableAccounts' `bridgeConfigured` flag: that flag deliberately
    // reads an EMPTY bridge map as "addressing unconfigured, not broken" so a
    // local dev box does not show every number as failed. For a real automatic
    // send to a real stranger, "we have no bridge at all" is not sendable — it
    // is a skip with a reason, not an optimistic queue row.
    if (!configuredAccounts().includes(accountId)) return skip('account_not_configured', accountNote);
    if (!account.connected) return skip('account_disconnected', accountNote);

    // ── Send through the canonical customer queue ───────────────────────────
    // Sending windows, connection deferral, retries, pacing, delivery logging
    // and message history all belong to the queue. Baileys is never called from
    // here. The account is passed EXPLICITLY, which short-circuits the canonical
    // resolver's fallback chain — so WHATSAPP_SYSTEM_ACCOUNT is never consulted
    // for this flow, while other server-initiated sends keep it unchanged.
    const queued = await enqueueCustomerWhatsApp(db, {
      phone: phoneIntl,
      text,
      explicitAccountId: accountId,
      createdById: `new-lead-auto-reply:${template.id}`,
    });

    if (!queued.ok) return skip(queued.reason, accountNote);

    await finish(db, ledger.id, {
      status: 'queued',
      contactId: ctx.contact.id || null,
      phoneIntl,
      language,
      templateId: template.id,
      templateName: template.nameHe,
      // Frozen: a later edit to the template must not rewrite what was sent.
      renderedText: text,
      accountId: queued.accountId,
      scheduledMessageId: queued.scheduledMessageId,
      reason: null,
    }, log);
    log.info?.(
      `[new-lead-reply] queued deal=${dealId} lang=${language} template=${template.id} `
      + `account=${queued.accountId} msg=${queued.scheduledMessageId}`,
    );
    return { status: 'queued', scheduledMessageId: queued.scheduledMessageId, language };
  } catch (err) {
    await finish(db, ledger.id, {
      status: 'failed',
      reason: String(err?.message || err).slice(0, 400),
    }, log);
    log.error?.(`[new-lead-reply] failed deal=${dealId}: ${err?.message || err}`);
    return { status: 'failed', reason: 'error' };
  }
}

/**
 * Fire-and-forget entry point, mirroring fireNewLeadReport. Never awaited by
 * the intake path and never able to fail it.
 */
export function fireNewLeadAutoReply(payload, log = console) {
  setImmediate(() => {
    sendNewLeadAutoReply(payload, log).catch((err) => {
      log.error?.(`[new-lead-reply] unhandled: ${err?.message || err}`);
    });
  });
}
