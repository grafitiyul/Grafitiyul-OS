// Confirmation Email — the composer. One pipeline for preview AND send, so the
// operator can never approve one thing and mail another (the quote-composer
// rule: preview == produced).
//
// Split like the quote composer: loadConfirmationContext() does every DB read,
// composeFromContext() is PURE (unit-tested with fixtures). The route calls
// composeConfirmationEmail() which chains both.
//
// Language (approved): the RECIPIENT contact's communicationLanguage, else
// Hebrew. Never derived from guide language or organization type. Inside a
// section there is NO cross-language fallback (the quote rule) — a gap becomes
// a warning the preview shows; the one deliberate exception is the meeting
// point, whose canonical resolver (tours/meetingPoint.js) owns its own
// fallback semantics.

import { prisma } from '../db.js';
import { resolveMeetingPoint } from '../tours/meetingPoint.js';
import { effectiveDurationHours } from '../tours/tourTime.js';
import { durationHe, durationEn } from '../../../shared/duration.mjs';
import {
  selectConfirmationTemplate,
  confirmationCtxFromDeal,
  ConfirmationTemplateError,
} from './resolveTemplate.js';
import { normalizeSections, getAutoSection } from './sections.js';
import { sanitizeEmailHtml } from '../email/sanitize.js';
import {
  normalizeFillers,
  fillersAffecting,
  getFillerKind,
  fillerSpecialTextCategory,
} from './fillers.js';
import { mergeOverrides, overrideFor } from './overrides.js';
import { getQuoteTemplate } from '../quote/quoteTemplate.js';
import {
  resolveConfirmationVariables,
  confirmationVariableByKey,
} from './variables.js';
import {
  extractTokens,
  substituteTokens,
  substituteHtmlTokens,
} from '../communication/variables.js';

const pickStrict = (he, en, lang) => (lang === 'en' ? en : he) || null;
const hasText = (html) =>
  !!html && String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') !== '';
// Media counts as content even with zero text. hasText() strips every tag, so
// an image-only section (the meeting-point photo) measured as "empty" and was
// dropped from the assembled email while still showing in the preview's
// section view — the production bug where the photo never reached the inbox.
const MEDIA_RE = /<(img|video)\b/i;
const hasRenderableContent = (html) => hasText(html) || MEDIA_RE.test(String(html || ''));

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// "YYYY-MM-DD" → localized date text (string-only, no timezone arithmetic).
function formatTourDate(dateStr, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return dateStr || null;
  const [, y, mo, d] = m;
  return lang === 'en' ? `${d}/${mo}/${y}` : `${Number(d)}.${Number(mo)}.${y}`;
}

const L = {
  he: {
    product: 'פעילות', date: 'תאריך', time: 'שעה', participants: 'משתתפים',
    groups: 'קבוצות', city: 'עיר', duration: 'משך הפעילות', customerNote: 'הערה',
    greetingNamed: (n) => `<p>היי ${esc(n)},</p>`, greetingPlain: '<p>שלום רב,</p>',
    closing: '<p>נתראה בקרוב,<br>צוות גרפיטיול</p>', meetingAlt: 'נקודת המפגש',
  },
  en: {
    product: 'Activity', date: 'Date', time: 'Time', participants: 'Participants',
    groups: 'Groups', city: 'City', duration: 'Duration', customerNote: 'Note',
    greetingNamed: (n) => `<p>Hi ${esc(n)},</p>`, greetingPlain: '<p>Hello,</p>',
    closing: '<p>See you soon,<br>The Grafitiyul team</p>', meetingAlt: 'Meeting point',
  },
};

// ── context loader (ALL db reads live here) ──────────────────────────────────

// What the duration chain needs off a booked TourEvent. openTourTemplateId is
// a loose ref — NOT a relation — so the slot-override template is loaded by
// attachSlotTemplate below, never via include.
export const TOUR_DURATION_SELECT = {
  id: true,
  openTourTemplateId: true,
  // Canonical ACTIVITY language: the booked tour's own language beats the
  // deal working copy (the {{tour_language}} variable reads this chain).
  tourLanguage: true,
  productVariant: { select: { durationHours: true } },
};

/** Attach the open-tour slot template (loose ref) so tourDurationHours can
 * read its durationHoursOverride. Returns the tour object (or null) with
 * `openTourTemplate` populated when applicable. */
export async function attachSlotTemplate(db, tour) {
  if (!tour) return null;
  if (!tour.openTourTemplateId) return tour;
  const openTourTemplate = await db.openTourTemplate.findUnique({
    where: { id: tour.openTourTemplateId },
    select: { durationHoursOverride: true },
  });
  return { ...tour, openTourTemplate };
}

// The loader's deal shape — exported so the Prisma-DMMF contract test can
// prove every field/relation actually exists (fixture tests can't catch an
// invalid include; see the openTourTemplate incident).
export const CONFIRMATION_DEAL_INCLUDE = {
  contacts: {
    include: { contact: { include: { emails: true, phones: true } } },
    orderBy: { isPrimary: 'desc' },
  },
  // Org name + type label feed the customer variable catalog; the deal-level
  // organizationType is the manual classification (no linked org).
  organization: {
    select: {
      organizationTypeId: true,
      name: true,
      organizationType: { select: { label: true, labelEn: true } },
    },
  },
  organizationType: { select: { label: true, labelEn: true } },
  product: { select: { nameHe: true, nameEn: true } },
  location: {
    select: {
      nameHe: true, nameEn: true, logisticsHe: true, logisticsEn: true,
      parentLocation: { select: { logisticsHe: true, logisticsEn: true } },
    },
  },
  bookings: {
    where: { status: 'active' },
    include: {
      // openTourTemplateId is a LOOSE ref (no FK, no Prisma relation —
      // templates are config); the template row is fetched separately by
      // attachSlotTemplate(). Selecting a relation here is an invalid
      // Prisma query that 500s at runtime while fixture tests stay green.
      tourEvent: { select: TOUR_DURATION_SELECT },
    },
  },
  confirmation: true,
};

export async function loadConfirmationContext(client, dealId, { language: langOverride } = {}) {
  const db = client || prisma;
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    include: CONFIRMATION_DEAL_INCLUDE,
  });
  if (!deal) return { error: 'deal_not_found' };

  // Template — EXACTLY ONE (throws on ambiguity; caller maps to 422).
  const templates = await db.confirmationEmailTemplate.findMany({
    where: { active: true },
    include: {
      blockLinks: {
        include: {
          sharedContent: {
            select: { id: true, type: true, internalName: true, bodyHe: true, bodyEn: true, active: true },
          },
        },
      },
    },
  });
  const { template } = selectConfirmationTemplate(templates, confirmationCtxFromDeal(deal));

  // Recipient: first (isPrimary-first) contact with an email; language: THE
  // recipient's preference → Hebrew (approved — nothing else plays a part).
  const withEmail = deal.contacts.find((dc) => (dc.contact?.emails || []).length);
  const contact = (withEmail || deal.contacts[0])?.contact || null;
  const email =
    ((contact?.emails || []).find((e) => e.isPrimary) || (contact?.emails || [])[0])?.value || null;
  const language =
    langOverride === 'he' || langOverride === 'en'
      ? langOverride
      : contact?.communicationLanguage === 'en'
        ? 'en'
        : 'he';

  const tour = await attachSlotTemplate(db, deal.bookings[0]?.tourEvent || null);
  // Duration chain needs a variant even without a booked tour.
  const pseudoTour =
    tour ||
    (deal.productId && deal.locationId
      ? {
        productVariant: await db.productVariant.findFirst({
          where: { productId: deal.productId, locationId: deal.locationId },
          select: { durationHours: true },
        }),
      }
      : null);

  const meetingPoint = tour ? await resolveMeetingPoint(tour.id, language, { db }) : null;

  const fillers = normalizeFillers(deal.confirmation?.fillers);
  // Special texts (CRM Settings — NOT the Shared Content Library): every
  // category's ★ default plus any specific option this deal chose. ONE query
  // serves cancellation, new guide and every future category.
  const SPECIAL_SELECT = {
    id: true, category: true, internalName: true, internalNote: true,
    bodyHe: true, bodyEn: true, active: true, isDefault: true,
  };
  const chosenIds = fillers.map((f) => f.specialTextId).filter(Boolean);
  const specialRows = await db.confirmationSpecialText.findMany({
    where: {
      OR: [
        { isDefault: true, active: true },
        ...(chosenIds.length ? [{ id: { in: chosenIds } }] : []),
      ],
    },
    select: SPECIAL_SELECT,
  });
  const specialTexts = {
    byId: Object.fromEntries(specialRows.map((r) => [r.id, r])),
    defaults: Object.fromEntries(
      specialRows.filter((r) => r.isDefault && r.active).map((r) => [r.category, r]),
    ),
  };

  // Variable-catalog context: primary phone, active-bookings count on the
  // booked tour, and the public brand contact (quote-template singleton).
  const contactPhone =
    ((contact?.phones || []).find((p) => p.isPrimary) || (contact?.phones || [])[0])?.value || null;
  const tourBookingsCount = tour?.id
    ? await db.booking.count({ where: { tourEventId: tour.id, status: 'active' } })
    : null;
  const brandContact = (await getQuoteTemplate(db))?.contact || null;

  return {
    deal, template, contact, email, language, tour: pseudoTour, meetingPoint,
    fillers, specialTexts, contactPhone, tourBookingsCount, brandContact,
    persistentOverrides: deal.confirmation?.overrideState || null,
  };
}

// ── pure composition ─────────────────────────────────────────────────────────

/**
 * Resolve ONE special-text filler (cancellation, new guide, any future
 * category) to its customer wording + the INTERNAL provenance the preview
 * shows the operator. `sourceLabel` is office-only — it is never rendered
 * into the email (buildEmailHtml reads html/title only).
 * Precedence: deal override → chosen predefined option → category ★ default.
 */
export function resolveSpecialTextFiller({ filler, category, specialTexts, lang }) {
  const chosen = filler?.specialTextId ? specialTexts?.byId?.[filler.specialTextId] : null;
  const fallback = specialTexts?.defaults?.[category] || null;

  if (filler?.mode === 'override') {
    return {
      html: pickStrict(filler.noteHe, filler.noteEn, lang),
      otherLang: pickStrict(filler.noteEn, filler.noteHe, lang),
      source: 'filler_override',
      sourceLabel: 'נוסח מותאם לעסקה זו',
      missing: false,
    };
  }
  if (filler?.mode === 'policy') {
    if (!chosen || chosen.active === false) {
      return { html: null, otherLang: null, source: 'filler_policy', sourceLabel: 'נוסח שנבחר — אינו זמין עוד', missing: true };
    }
    return {
      html: pickStrict(chosen.bodyHe, chosen.bodyEn, lang),
      otherLang: pickStrict(chosen.bodyEn, chosen.bodyHe, lang),
      source: 'filler_policy',
      sourceLabel: `נוסח מוגדר מראש — ${chosen.internalName}`,
      missing: false,
    };
  }
  if (!fallback) {
    return { html: null, otherLang: null, source: 'default', sourceLabel: 'לא הוגדרה ברירת מחדל', missing: true };
  }
  return {
    html: pickStrict(fallback.bodyHe, fallback.bodyEn, lang),
    otherLang: pickStrict(fallback.bodyEn, fallback.bodyHe, lang),
    source: 'default',
    sourceLabel: `ברירת מחדל — ${fallback.internalName}`,
    missing: false,
  };
}

export function composeFromContext(ctx, { overrideOverlay = null } = {}) {
  const { deal, template, contact, email, language: lang, tour, meetingPoint, fillers } = ctx;
  const specialTexts = ctx.specialTexts || { byId: {}, defaults: {} };
  const t = L[lang] || L.he;
  const warnings = [];
  const overrides = mergeOverrides(ctx.persistentOverrides, overrideOverlay);

  const blockById = Object.fromEntries(
    (template.blockLinks || []).map((l) => [l.sharedContent.id, l.sharedContent]),
  );
  const layout = normalizeSections(template.sections, Object.keys(blockById));

  // Every warning names its section (operator-facing Hebrew label) so the
  // preview can say exactly WHAT is missing, not just that something is.
  const warnMissing = (sectionId, otherHas, label) =>
    warnings.push({
      code: 'missing_content', sectionId, language: lang,
      label: label || getAutoSection(sectionId)?.labelHe || sectionId,
      otherLanguageHasContent: !!otherHas,
    });

  const firstName = pickStrict(contact?.firstNameHe, contact?.firstNameEn, lang);
  const effHours = effectiveDurationHours(deal, tour);
  const durationFiller = fillers.find((f) => f.kind === 'activity_duration');
  const cancelFiller = fillers.find((f) => f.kind === 'cancellation_policy');
  const specialFillers = fillersAffecting(fillers, 'special_terms');

  const sections = [];
  for (const entry of layout) {
    if (entry.hidden) continue;

    if (entry.kind === 'block') {
      const block = blockById[entry.sharedContentId];
      if (!block || !block.active) continue;
      const sectionId = `block:${block.id}`;
      const html = pickStrict(block.bodyHe, block.bodyEn, lang);
      const source = 'library';
      if (!hasText(html)) {
        warnMissing(sectionId, hasText(pickStrict(block.bodyEn, block.bodyHe, lang)), block.internalName);
      }
      sections.push({
        id: sectionId, kind: 'block', type: block.type,
        title: block.internalName, html, source, editable: true,
      });
      continue;
    }

    switch (entry.key) {
      case 'greeting': {
        const custom = pickStrict(template.greetingHe, template.greetingEn, lang);
        sections.push({
          id: 'greeting', kind: 'auto', key: 'greeting',
          html: hasText(custom) ? custom : firstName ? t.greetingNamed(firstName) : t.greetingPlain,
          editable: true,
        });
        break;
      }
      case 'tour_details': {
        const productName = pickStrict(deal.product?.nameHe, deal.product?.nameEn, lang) || deal.product?.nameHe;
        const cityName = pickStrict(deal.location?.nameHe, deal.location?.nameEn, lang) || deal.location?.nameHe;
        const hours = effHours;
        const rows = [
          productName && { label: t.product, value: productName },
          deal.tourDate && { label: t.date, value: formatTourDate(deal.tourDate, lang) },
          deal.tourTime && { label: t.time, value: deal.tourTime },
          deal.participants != null && { label: t.participants, value: String(deal.participants) },
          (deal.groups || 0) > 1 && { label: t.groups, value: String(deal.groups) },
          cityName && { label: t.city, value: cityName },
          { label: t.duration, value: lang === 'en' ? durationEn(hours) : durationHe(hours) },
        ].filter(Boolean);
        const noteHtmlRaw = durationFiller
          ? pickStrict(durationFiller.noteHe, durationFiller.noteEn, lang)
          : null;
        const html =
          `<p>${rows.map((r) => `<strong>${esc(r.label)}:</strong> ${esc(r.value)}`).join('<br>')}</p>` +
          (hasText(noteHtmlRaw) ? noteHtmlRaw : '');
        sections.push({
          id: 'tour_details', kind: 'auto', key: 'tour_details',
          html, data: { rows, durationHours: hours, durationOverridden: !!durationFiller },
          // INTERNAL provenance — shown in the preview only when the deal
          // actually overrode the canonical duration.
          ...(durationFiller
            ? { source: 'filler_override', sourceLabel: `משך מותאם לעסקה זו — ${lang === 'en' ? durationEn(hours) : durationHe(hours)}` }
            : {}),
          editable: false,
        });
        if (durationFiller && !hasText(noteHtmlRaw) && hasText(pickStrict(durationFiller.noteEn, durationFiller.noteHe, lang))) {
          warnMissing('tour_details', true);
        }
        break;
      }
      case 'meeting_point': {
        if (!meetingPoint) {
          warnings.push({ code: 'no_tour', sectionId: 'meeting_point', label: 'נקודת מפגש' });
          sections.push({ id: 'meeting_point', kind: 'auto', key: 'meeting_point', html: null, editable: true });
        } else {
          if (!hasText(meetingPoint.html)) warnMissing('meeting_point', false);
          sections.push({
            id: 'meeting_point', kind: 'auto', key: 'meeting_point',
            html: meetingPoint.html, source: meetingPoint.source, editable: true,
          });
        }
        break;
      }
      case 'meeting_point_image': {
        const url = meetingPoint?.image?.url || null;
        if (url) {
          // Stable PUBLIC R2 URL (never a signed/expiring one) so the photo
          // still loads days later. The inline max-width keeps it inside the
          // column on phones; `width` is the desktop/Outlook fallback.
          sections.push({
            id: 'meeting_point_image', kind: 'auto', key: 'meeting_point_image',
            html:
              `<p><img src="${esc(url)}" alt="${esc(t.meetingAlt)}" width="480" ` +
              'style="max-width:100%;height:auto;display:block;border-radius:6px"></p>',
            data: { url }, editable: false,
          });
        }
        break;
      }
      case 'location_logistics': {
        const loc = deal.location;
        const html =
          pickStrict(loc?.logisticsHe, loc?.logisticsEn, lang) ||
          pickStrict(loc?.parentLocation?.logisticsHe, loc?.parentLocation?.logisticsEn, lang);
        if (hasText(html)) {
          sections.push({ id: 'location_logistics', kind: 'auto', key: 'location_logistics', html, editable: true });
        } else if (
          hasText(pickStrict(loc?.logisticsEn, loc?.logisticsHe, lang)) ||
          hasText(pickStrict(loc?.parentLocation?.logisticsEn, loc?.parentLocation?.logisticsHe, lang))
        ) {
          warnMissing('location_logistics', true);
          sections.push({ id: 'location_logistics', kind: 'auto', key: 'location_logistics', html: null, editable: true });
        }
        break;
      }
      case 'cancellation_policy': {
        const r = resolveSpecialTextFiller({
          filler: cancelFiller, category: 'cancellation_policy', specialTexts, lang,
        });
        if (r.missing) {
          warnings.push({ code: 'missing_policy', sectionId: 'cancellation_policy', label: 'מדיניות ביטול' });
        } else if (!hasText(r.html)) {
          warnMissing('cancellation_policy', hasText(r.otherLang), 'מדיניות ביטול');
        }
        sections.push({
          id: 'cancellation_policy', kind: 'auto', key: 'cancellation_policy',
          // `title` is the INTERNAL section label (override dialog, warnings)
          // only — deliberately NOT customerTitle: the operator authors the
          // heading inside the special text itself, so the composer must not
          // inject a second one. Same in Hebrew and English.
          title: lang === 'en' ? 'Cancellation policy' : 'מדיניות ביטול',
          html: r.html, source: r.source,
          // INTERNAL provenance for the preview — never rendered to customers.
          sourceLabel: r.sourceLabel,
          editable: true,
        });
        break;
      }
      case 'special_terms': {
        if (!specialFillers.length) break; // renders NOTHING without fillers
        const items = specialFillers.map((f) => {
          const labelHe = getFillerKind(f.kind)?.labelHe || f.kind;
          const category = fillerSpecialTextCategory(f.kind);
          if (category) {
            // Same three-way resolution as cancellation (default / chosen /
            // deal override) — new guide and every future wording category.
            const r = resolveSpecialTextFiller({ filler: f, category, specialTexts, lang });
            if (r.missing) {
              warnings.push({ code: 'missing_policy', sectionId: 'special_terms', label: labelHe });
            } else if (!hasText(r.html)) {
              warnMissing('special_terms', hasText(r.otherLang), labelHe);
            }
            return { kind: f.kind, labelHe, html: r.html, source: r.source, sourceLabel: r.sourceLabel };
          }
          const html = pickStrict(f.noteHe, f.noteEn, lang);
          if (!hasText(html)) warnMissing('special_terms', hasText(pickStrict(f.noteEn, f.noteHe, lang)), labelHe);
          return { kind: f.kind, labelHe, html, source: 'filler_override', sourceLabel: 'נוסח מותאם לעסקה זו' };
        });
        sections.push({
          id: 'special_terms', kind: 'auto', key: 'special_terms',
          title: lang === 'en' ? 'Special terms agreed' : 'תנאים מיוחדים שסוכמו',
          customerTitle: true, // this title IS customer-facing (block titles are internal names)
          html: items.map((i) => i.html).filter(hasText).join('') || null,
          data: { items }, editable: true,
        });
        break;
      }
      case 'closing': {
        const custom = pickStrict(template.closingHe, template.closingEn, lang);
        sections.push({
          id: 'closing', kind: 'auto', key: 'closing',
          html: hasText(custom) ? custom : t.closing, editable: true,
        });
        break;
      }
      default:
        break;
    }
  }

  // Per-deal overrides (persistent + one-shot overlay) — applied LAST, so an
  // operator edit always wins over any computed content.
  for (const s of sections) {
    const ov = overrideFor(overrides, s.id);
    if (!ov) continue;
    if (ov.html) s.html = ov.html;
    if (ov.title) {
      s.title = ov.title;
      s.customerTitle = true; // an operator-authored title is meant for the customer
    }
    s.overridden = true;
  }

  let subject = pickStrict(template.subjectHe, template.subjectEn, lang);

  // ── Variable substitution — the ONE canonical customer catalog, applied
  // identically for preview and send (this function IS both). Runs AFTER
  // overrides so operator edits may themselves carry tokens. Unknown keys
  // stay visible (amber chip in the editor) and warn; known-but-empty keys
  // render '' and warn with their Hebrew label.
  const usedKeys = new Set(extractTokens(subject || ''));
  for (const s of sections) {
    if (s.html) for (const k of extractTokens(s.html)) usedKeys.add(k);
  }
  if (usedKeys.size) {
    const { values } = resolveConfirmationVariables({ ...ctx, effectiveDurationHours: effHours }, lang);
    for (const s of sections) {
      if (s.html) s.html = substituteHtmlTokens(s.html, values);
    }
    if (subject) subject = substituteTokens(subject, values);
    for (const k of usedKeys) {
      const def = confirmationVariableByKey(k);
      if (!def) warnings.push({ code: 'unknown_variable', key: k, label: `{{${k}}}` });
      else if (!values[k]) warnings.push({ code: 'missing_variable', key: k, label: def.labelHe });
    }
  }

  if (!subject || !subject.trim()) {
    warnings.push({
      code: 'missing_subject', language: lang, label: 'נושא המייל',
      otherLanguageHasContent: !!pickStrict(template.subjectEn, template.subjectHe, lang),
    });
  }
  if (!email) warnings.push({ code: 'no_recipient_email', label: 'נמען' });

  // The EXACT body the send will mail (assembled + sanitized here, once) —
  // the preview's "final view" renders this string, so preview == email.
  const emailHtml = sanitizeEmailHtml(buildEmailHtml({ sections })) || null;

  return {
    dealId: deal.id,
    // The confirmation email is a WON workflow — the send service gates on
    // this rather than re-reading the deal.
    dealStatus: deal.status || null,
    template: { id: template.id, internalName: template.internalName },
    language: lang,
    subject: subject || null,
    recipient: contact
      ? {
        contactId: contact.id,
        name:
          [pickStrict(contact.firstNameHe, contact.firstNameEn, lang), pickStrict(contact.lastNameHe, contact.lastNameEn, lang)]
            .filter(Boolean)
            .join(' ') || null,
        email,
        language: contact.communicationLanguage || null,
      }
      : null,
    fillers,
    hasFillers: fillers.length > 0,
    sections,
    emailHtml,
    warnings,
  };
}

/**
 * Assemble the composed sections into ONE email body HTML — used for the send
 * AND stored verbatim in the snapshot, so the archive shows exactly what was
 * mailed. Pure. Block titles are internal names and are NEVER rendered; the
 * only headings are customer-facing ones (special_terms + operator-authored
 * override titles), flagged `customerTitle` by the composer.
 */
export function buildEmailHtml(composeResult) {
  const parts = [];
  for (const s of composeResult.sections || []) {
    if (!hasRenderableContent(s.html)) continue;
    if (s.customerTitle && s.title) parts.push(`<h3>${esc(s.title)}</h3>`);
    parts.push(s.html);
  }
  return parts.join('\n');
}

/** The one entry point: load + compose. Template-resolution errors surface as
 * { error, meta } (never thrown across the route boundary). */
export async function composeConfirmationEmail(client, dealId, opts = {}) {
  let ctx;
  try {
    ctx = await loadConfirmationContext(client, dealId, opts);
  } catch (e) {
    if (e instanceof ConfirmationTemplateError) return { error: e.code, meta: e.meta };
    throw e;
  }
  if (ctx.error) return ctx;
  return composeFromContext(ctx, { overrideOverlay: opts.overrideOverlay || null });
}
