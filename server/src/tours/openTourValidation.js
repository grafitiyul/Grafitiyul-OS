// Pure validation + normalization for the Open Tours admin API. No IO, so the
// rules are unit-tested in isolation and the route stays thin.

import { DATE_RE, TIME_RE, TOUR_LANGS } from './requiredFields.js';

export const EXCEPTION_TYPES = ['add', 'cancel', 'time_override'];

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

// Build the scalar patch for an OpenTourTemplate from a request body. `partial`
// (PUT) only touches provided keys; a create (partial=false) requires nameHe.
// Returns { data } or { error }.
export function buildTemplatePatch(body, { partial = false } = {}) {
  const b = body || {};
  const data = {};
  if (!partial || b.nameHe !== undefined) {
    if (isBlank(b.nameHe)) return { error: 'invalid_name' };
    data.nameHe = String(b.nameHe).trim();
  }
  if (b.nameEn !== undefined) data.nameEn = isBlank(b.nameEn) ? null : String(b.nameEn).trim();
  if (b.locationId !== undefined) data.locationId = isBlank(b.locationId) ? null : String(b.locationId);
  if (b.meetingPoint !== undefined) data.meetingPoint = isBlank(b.meetingPoint) ? null : String(b.meetingPoint);
  if (b.tourLanguage !== undefined) {
    if (!TOUR_LANGS.includes(b.tourLanguage)) return { error: 'invalid_language' };
    data.tourLanguage = b.tourLanguage;
  }
  if (b.durationHoursOverride !== undefined) {
    if (isBlank(b.durationHoursOverride)) {
      data.durationHoursOverride = null;
    } else {
      const n = Number(b.durationHoursOverride);
      if (!Number.isFinite(n) || n <= 0 || n > 24) return { error: 'invalid_duration' };
      data.durationHoursOverride = n;
    }
  }
  if (b.capacity !== undefined) {
    if (isBlank(b.capacity)) {
      data.capacity = null;
    } else {
      const n = Number(b.capacity);
      if (!Number.isInteger(n) || n < 1) return { error: 'invalid_capacity' };
      data.capacity = n;
    }
  }
  if (b.registrationCloseMinutes !== undefined) {
    if (isBlank(b.registrationCloseMinutes)) {
      data.registrationCloseMinutes = null;
    } else {
      const n = Number(b.registrationCloseMinutes);
      if (!Number.isInteger(n) || n < 0) return { error: 'invalid_close_minutes' };
      data.registrationCloseMinutes = n;
    }
  }
  if (b.defaultLeadGuides !== undefined) {
    const n = Number(b.defaultLeadGuides);
    if (!Number.isInteger(n) || n < 0 || n > 20) return { error: 'invalid_lead_guides' };
    data.defaultLeadGuides = n;
  }
  if (b.active !== undefined) data.active = b.active === true;
  return { data };
}

// A schedule rule patch. Create requires weekday + startTime.
export function buildRulePatch(body, { partial = false } = {}) {
  const b = body || {};
  const data = {};
  if (!partial || b.weekday !== undefined) {
    const n = Number(b.weekday);
    if (!Number.isInteger(n) || n < 0 || n > 6) return { error: 'invalid_weekday' };
    data.weekday = n;
  }
  if (!partial || b.startTime !== undefined) {
    if (!TIME_RE.test(String(b.startTime || ''))) return { error: 'invalid_time' };
    data.startTime = b.startTime;
  }
  for (const key of ['validFrom', 'validUntil']) {
    if (b[key] !== undefined) {
      if (isBlank(b[key])) {
        data[key] = null;
      } else if (!DATE_RE.test(String(b[key]))) {
        return { error: `invalid_${key}` };
      } else {
        data[key] = b[key];
      }
    }
  }
  if (data.validFrom && data.validUntil && data.validFrom > data.validUntil) {
    return { error: 'invalid_validity_range' };
  }
  if (b.season !== undefined) data.season = isBlank(b.season) ? null : String(b.season).trim();
  if (b.active !== undefined) data.active = b.active === true;
  return { data };
}

// An exception. Always needs date + type; add/time_override need a time.
export function buildExceptionPatch(body) {
  const b = body || {};
  if (!DATE_RE.test(String(b.date || ''))) return { error: 'invalid_date' };
  if (!EXCEPTION_TYPES.includes(b.type)) return { error: 'invalid_type' };
  const data = { date: b.date, type: b.type };
  if (b.type === 'cancel') {
    data.time = null;
  } else {
    if (!TIME_RE.test(String(b.time || ''))) return { error: 'invalid_time' };
    data.time = b.time;
  }
  data.note = isBlank(b.note) ? null : String(b.note).trim();
  return { data };
}

// Normalize the offered-products array for replace-sync. Enforces at most one
// default and coerces sort order. Returns { rows } or { error }.
export function normalizeTemplateProducts(list) {
  if (!Array.isArray(list)) return { error: 'invalid_products' };
  const rows = [];
  let defaults = 0;
  list.forEach((p, i) => {
    if (isBlank(p?.productVariantId)) return; // skip empty rows
    const isDefault = p.isDefault === true;
    if (isDefault) defaults += 1;
    rows.push({
      productVariantId: String(p.productVariantId),
      priceRuleId: isBlank(p.priceRuleId) ? null : String(p.priceRuleId),
      cardGroupId: isBlank(p.cardGroupId) ? null : String(p.cardGroupId),
      isDefault,
      sortOrder: Number.isInteger(p.sortOrder) ? p.sortOrder : i,
    });
  });
  if (defaults > 1) return { error: 'multiple_defaults' };
  // Exactly one default when any products exist — pick the first if none flagged.
  if (rows.length && defaults === 0) rows[0].isDefault = true;
  return { rows };
}
