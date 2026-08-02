// THE meeting-point resolver — text + image, for one tour.
//
// ── Why this file exists ─────────────────────────────────────────────────────
// The meeting point was resolved in two different places with two different
// answers: the quote composer reads Shared Content first and falls back to the
// variant then the location columns; the communication variable read the
// variant columns ONLY. A customer could therefore be sent a meeting point that
// contradicted the one printed on their own quote. Sending it to a customer
// over WhatsApp made that divergence unacceptable, so the composer's (fuller,
// correct) precedence is extracted here and both callers use it.
//
// Precedence, highest first:
//   1. Shared Content linked to the variant (an explicit override)
//   2. the Location's Shared Content default (inherited)
//   3. the legacy ProductVariant.meetingPointHe/En columns
//   4. the legacy Location.meetingPointHe/En columns
// This is exactly the composer's dual-read, so a quote and a WhatsApp message
// can no longer disagree.
//
// The IMAGE follows its own chain (variant image → location image) because a
// variant may override the text without having its own picture.

import { prisma } from '../db.js';
import { resolveVariantSharedContent } from '../shared-content/sharedContent.js';
import { htmlToWhatsApp } from '../../../shared/waMarkup.mjs';

const pickLang = (he, en, lang) => (lang === 'en' ? en || he : he || en) || null;

const TOUR_SELECT = {
  id: true,
  productVariantId: true,
  productVariant: {
    select: {
      id: true, locationId: true,
      meetingPointHe: true, meetingPointEn: true,
      meetingPointImage: { select: { r2Key: true, mimeType: true, filename: true, kind: true, sizeBytes: true } },
      location: {
        select: {
          nameHe: true, nameEn: true,
          meetingPointHe: true, meetingPointEn: true,
          meetingPointImage: { select: { r2Key: true, mimeType: true, filename: true, kind: true, sizeBytes: true } },
        },
      },
    },
  },
  location: {
    select: {
      nameHe: true, nameEn: true,
      meetingPointHe: true, meetingPointEn: true,
      meetingPointImage: { select: { r2Key: true, mimeType: true, filename: true, kind: true, sizeBytes: true } },
    },
  },
};

/** Rich HTML → the plain text a WhatsApp message can actually carry. */
export function meetingPointPlainText(html) {
  if (!html) return null;
  const text = htmlToWhatsApp(String(html)).trim();
  return text || null;
}

/**
 * Resolve the meeting point for a tour.
 *
 * Returns { html, text, image, source, eligible }:
 *   html      the rich content as authored
 *   text      the same content flattened for WhatsApp — this is what decides
 *             eligibility, because HTML that renders to nothing is not content
 *   image     { r2Key, mimeType, fileName, kind } | null
 *   source    which rung of the chain answered ('shared_content' | 'variant' |
 *             'location' | null) — shown in the settings UI, never guessed
 *   eligible  TEXT exists. An image alone never qualifies: "היי, הנה שוב נקודת
 *             המפגש:" followed by a bare photo is not an instruction, and the
 *             owner rule is explicit that an image alone does not enable this.
 */
export async function resolveMeetingPoint(tourEventId, lang = 'he', { db = prisma } = {}) {
  const tour = await db.tourEvent.findUnique({ where: { id: tourEventId }, select: TOUR_SELECT });
  if (!tour) return { html: null, text: null, image: null, source: null, eligible: false };

  const variant = tour.productVariant;
  const location = variant?.location || tour.location;

  // 1-2. Shared Content (variant link → location default), the same call the
  // quote composer makes.
  let html = null;
  let source = null;
  if (tour.productVariantId) {
    const { block } = await resolveVariantSharedContent(db, tour.productVariantId, 'meeting_point');
    if (block) {
      html = pickLang(block.bodyHe, block.bodyEn, lang);
      if (html) source = 'shared_content';
    }
  }
  // 3. Legacy variant columns.
  if (!html && variant) {
    html = pickLang(variant.meetingPointHe, variant.meetingPointEn, lang);
    if (html) source = 'variant';
  }
  // 4. Legacy location columns.
  if (!html && location) {
    html = pickLang(location.meetingPointHe, location.meetingPointEn, lang);
    if (html) source = 'location';
  }

  const img = variant?.meetingPointImage || location?.meetingPointImage || null;
  const image = img?.r2Key
    ? {
      key: img.r2Key,
      mimeType: img.mimeType || 'image/jpeg',
      fileName: img.filename || 'meeting-point',
      kind: 'image',
    }
    : null;

  const text = meetingPointPlainText(html);
  return { html, text, image, source, eligible: !!text };
}
