// Live preview of a Name Cleanup result — names, phones and effective emails.
// MIRRORS the server resolvers (src/migration/review/nameCleanup.js +
// namePhones.js + contactIdentity.js), which are the authority: the server
// re-resolves on save with the same rules plus the live claimed-phone index, and
// refuses anything invalid. Nothing here is a second interpretation — a drift
// between this mirror and the server surfaces as a 400 with the server's reasons.
const t = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

// ── countries (mirror of server namePhones.js) ───────────────────────────────
export const COUNTRIES = [
  { code: 'IL', dial: '972', label: 'ישראל (+972)', nationalLen: [8, 9] },
  { code: 'US', dial: '1', label: 'ארה"ב / קנדה (+1)', nationalLen: [10, 10] },
  { code: 'GB', dial: '44', label: 'בריטניה (+44)', nationalLen: [9, 10] },
  { code: 'FR', dial: '33', label: 'צרפת (+33)', nationalLen: [9, 9] },
  { code: 'DE', dial: '49', label: 'גרמניה (+49)', nationalLen: [9, 11] },
  { code: 'NL', dial: '31', label: 'הולנד (+31)', nationalLen: [9, 9] },
  { code: 'BE', dial: '32', label: 'בלגיה (+32)', nationalLen: [8, 9] },
  { code: 'ES', dial: '34', label: 'ספרד (+34)', nationalLen: [9, 9] },
  { code: 'IT', dial: '39', label: 'איטליה (+39)', nationalLen: [8, 11] },
  { code: 'CH', dial: '41', label: 'שווייץ (+41)', nationalLen: [9, 9] },
  { code: 'AT', dial: '43', label: 'אוסטריה (+43)', nationalLen: [8, 11] },
  { code: 'RU', dial: '7', label: 'רוסיה (+7)', nationalLen: [10, 10] },
  { code: 'UA', dial: '380', label: 'אוקראינה (+380)', nationalLen: [9, 9] },
  { code: 'PL', dial: '48', label: 'פולין (+48)', nationalLen: [9, 9] },
  { code: 'GR', dial: '30', label: 'יוון (+30)', nationalLen: [10, 10] },
  { code: 'TR', dial: '90', label: 'טורקיה (+90)', nationalLen: [10, 10] },
  { code: 'AU', dial: '61', label: 'אוסטרליה (+61)', nationalLen: [9, 9] },
  { code: 'ZA', dial: '27', label: 'דרום אפריקה (+27)', nationalLen: [9, 9] },
  { code: 'BR', dial: '55', label: 'ברזיל (+55)', nationalLen: [10, 11] },
  { code: 'MX', dial: '52', label: 'מקסיקו (+52)', nationalLen: [10, 10] },
  { code: 'AR', dial: '54', label: 'ארגנטינה (+54)', nationalLen: [10, 10] },
  { code: 'IN', dial: '91', label: 'הודו (+91)', nationalLen: [10, 10] },
  { code: 'AE', dial: '971', label: 'איחוד האמירויות (+971)', nationalLen: [8, 9] },
  { code: 'OTHER', dial: null, label: 'מדינה אחרת / לא ידוע', nationalLen: null },
];
const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
const byDialDesc = COUNTRIES.filter((c) => c.dial).sort((a, b) => b.dial.length - a.dial.length);
const digitsOf = (raw) => String(raw || '').replace(/\D/g, '');
const statedIntl = (raw) => {
  const d = digitsOf(raw);
  if (/^\s*\+/.test(String(raw || ''))) return d;
  if (d.startsWith('00')) return d.slice(2);
  return null;
};

export function suggestCountry(raw) {
  const intl = statedIntl(raw);
  if (intl) {
    const hit = byDialDesc.find((c) => intl.startsWith(c.dial));
    return hit ? hit.code : 'OTHER';
  }
  const d = digitsOf(raw);
  if (d.startsWith('0') && !d.startsWith('00') && (d.length === 9 || d.length === 10)) return 'IL';
  if (!d.startsWith('0') && d.length >= 11 && d.length <= 15) {
    const hit = byDialDesc.find((c) => d.startsWith(c.dial));
    if (hit) return hit.code;
  }
  return 'OTHER';
}

export function normalizeForCountry(value, countryCode) {
  const raw = String(value || '').trim();
  if (!raw) return { normalized: null, problems: ['מספר ריק'], requiresConfirmation: false };
  const country = byCode.get(countryCode);
  if (!country) return { normalized: null, problems: [`מדינה לא מוכרת: ${countryCode}`], requiresConfirmation: false };
  const stated = statedIntl(raw);
  if (country.code === 'OTHER') {
    const hit = stated ? byDialDesc.find((c) => stated.startsWith(c.dial)) : null;
    return {
      normalized: stated && stated.length >= 8 && stated.length <= 15 ? stated : null,
      problems: hit ? [`המספר מציין קידומת ${hit.label} — בחר את המדינה הזו במקום "לא ידוע"`] : [],
      requiresConfirmation: true,
    };
  }
  let intl;
  if (stated) {
    if (!stated.startsWith(country.dial)) {
      const actual = byDialDesc.find((c) => stated.startsWith(c.dial));
      return {
        normalized: null,
        problems: [`המספר מציין קידומת ${actual ? actual.label : '+' + stated.slice(0, 3)} אבל נבחרה ${country.label}`],
        requiresConfirmation: false,
      };
    }
    intl = stated;
  } else {
    let d = digitsOf(raw);
    if (d.startsWith(country.dial) && d.length >= country.dial.length + 6 && !d.startsWith('0')) intl = d;
    else {
      if (d.startsWith('0')) d = d.slice(1);
      intl = `${country.dial}${d}`;
    }
  }
  const problems = [];
  const national = intl.slice(country.dial.length);
  if (national.startsWith('0')) problems.push('ספרת 0 מיותרת אחרי הקידומת');
  if (country.nationalLen) {
    const [min, max] = country.nationalLen;
    if (national.length < min || national.length > max) {
      problems.push(`אורך לא תקין ל${country.label}: ${national.length} ספרות אחרי הקידומת (צפוי ${min === max ? min : `${min}–${max}`})`);
    }
  }
  if (intl.length > 15) problems.push('ארוך מדי למספר טלפון בינלאומי');
  return { normalized: problems.length ? null : intl, problems, requiresConfirmation: false };
}

export const defaultPhoneRow = (original, index) => ({
  original: String(original || ''), country: suggestCountry(original),
  value: String(original || ''), remove: false, isPrimary: index === 0, confirmUnverified: false,
});

export function resolvePhoneRow(row) {
  if (row.remove) return { ...row, normalized: null, problems: [], importable: false };
  const { normalized, problems, requiresConfirmation } = normalizeForCountry(row.value, row.country);
  const out = { ...row, normalized, problems: [...problems], importable: false };
  if (requiresConfirmation && !row.confirmUnverified) {
    out.problems.push('מדינה לא ידועה — המספר ייובא כפי שהוא רק לאחר אישור מפורש');
  }
  out.importable = out.problems.length === 0;
  return out;
}

// Effective emails after the person's identity correction (mirror of
// contactIdentity.applyIdentityEdit for the email half).
export function effectiveEmails(sourceEmails, identityEdit) {
  const emails = (sourceEmails || []).map((e) => t(e));
  if (!identityEdit) return emails;
  const rm = (identityEdit.removeEmails || []).map((e) => t(e));
  const add = (identityEdit.addEmails || []).map((a) => t(a?.value ?? a));
  const kept = emails.filter((e) => !rm.includes(e));
  return [...kept, ...add.filter((e) => !kept.includes(e))];
}

// ── draft + resolve (mirror of server nameCleanup.js) ────────────────────────
export function nameDraftFromProposal(proposal, decision = null) {
  const base = decision?.fields || proposal.proposedFields;
  const sourcePhones = proposal?.context?.phones || [];
  const phones = Array.isArray(decision?.phones)
    ? decision.phones.map((p) => ({ ...defaultPhoneRow(p.original, 0), ...p }))
    : sourcePhones.map((raw, i) => defaultPhoneRow(raw, i));
  return {
    treatment: decision?.treatment || proposal.treatment,
    fields: {
      firstNameHe: t(base.firstNameHe), lastNameHe: t(base.lastNameHe),
      firstNameEn: t(base.firstNameEn), lastNameEn: t(base.lastNameEn),
    },
    phones,
    // THE BUSINESS RULE: an organisation with zero deals defaults to NOT imported;
    // the owner may override explicitly. Deals > 0 defaults to creating it.
    organization: decision?.organization
      ? { ...decision.organization }
      : {
          create: (proposal?.context?.dealCount || 0) > 0,
          name: t(proposal.displayName) || t(proposal.original?.name) || '',
          targetOrganizationKey: null,
          targetLabel: null,
        },
  };
}

// ctx: { identityEdit, claimedPhones: {normalized:{label,ownerIds:[]}}, selfLegacyId }
export function resolveNameResult(proposal, draft, ctx = {}) {
  const fields = {
    firstNameHe: t(draft.fields.firstNameHe), lastNameHe: t(draft.fields.lastNameHe),
    firstNameEn: t(draft.fields.firstNameEn), lastNameEn: t(draft.fields.lastNameEn),
  };
  const excluded = draft.treatment === 'exclude';
  const isOrg = draft.treatment === 'organization';
  const problems = [];
  const warnings = [];
  if (!excluded && !isOrg && !fields.firstNameHe && !fields.firstNameEn) problems.push('חובה שם פרטי — בעברית או באנגלית');

  let organization = null;
  if (isOrg) {
    const o = draft.organization || {};
    const deals = proposal.context?.dealCount || 0;
    organization = { create: !!o.create, name: t(o.name), targetOrganizationKey: o.targetOrganizationKey || null, targetLabel: o.targetLabel || null };
    if (organization.create) {
      if (!organization.targetOrganizationKey && !organization.name) problems.push('חובה שם לארגון שייווצר');
      if (deals === 0) warnings.push('חריגה מכלל העסק: נוצר ארגון בלי אף עסקה — החלטה מפורשת שלך');
    } else if (deals > 0) {
      warnings.push(`הרשומה לא תיובא למרות ${deals} עסקאות מקושרות — העסקאות יישארו ללא יעד`);
    }
  }

  let phones = null;
  if (!excluded && !isOrg && Array.isArray(draft.phones)) {
    phones = draft.phones.map((row) => resolvePhoneRow(row));
    const kept = phones.filter((p) => !p.remove);
    for (const p of kept) for (const prob of p.problems) problems.push(`טלפון ${p.value || p.original}: ${prob}`);
    const seen = new Set();
    for (const p of kept) {
      if (!p.normalized) continue;
      if (seen.has(p.normalized)) problems.push(`המספר ${p.normalized} מופיע פעמיים באיש הקשר`);
      seen.add(p.normalized);
    }
    for (const p of kept) {
      if (!p.normalized) continue;
      const claim = ctx.claimedPhones?.[p.normalized];
      if (claim && !(claim.ownerIds || []).includes(ctx.selfLegacyId)) {
        problems.push(`המספר ${p.normalized} כבר שויך להחלטה אחרת (${claim.label}) — הסר אותו מאחד הצדדים`);
      }
    }
    if (kept.filter((p) => p.isPrimary).length > 1) problems.push('סומן יותר מטלפון מועדף אחד');
    const removed = phones.filter((p) => p.remove);
    if (removed.length) warnings.push(`${removed.length} מספרים לא ייובאו — הם נשארים בצילום ובארכיון`);
  }

  const emails = excluded || isOrg ? [] : effectiveEmails(proposal.context?.emails, ctx.identityEdit);

  if (!excluded && !isOrg) {
    const orig = `${proposal.original.first_name} ${proposal.original.last_name}`.trim();
    const now = [fields.firstNameHe, fields.lastNameHe, fields.firstNameEn, fields.lastNameEn].filter(Boolean).join(' ');
    if (orig && now && orig !== now) warnings.push(`השם שונה מהמקור: "${orig}" ← "${now}"`);
  }
  if (excluded && proposal.context.dealCount > 0) {
    warnings.push(`הרשומה מוחרגת למרות ${proposal.context.dealCount} עסקאות מקושרות — העסקאות יישארו ללא איש קשר`);
  }
  return {
    treatment: draft.treatment, fields,
    displayHe: `${fields.firstNameHe} ${fields.lastNameHe}`.trim(),
    displayEn: `${fields.firstNameEn} ${fields.lastNameEn}`.trim(),
    phones, emails, organization, excluded, warnings, problems, valid: problems.length === 0,
  };
}
