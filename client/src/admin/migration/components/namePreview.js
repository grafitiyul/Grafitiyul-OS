// Live preview of a Name Cleanup result.
// Mirrors the server resolver (src/migration/review/nameCleanup.js), which is the
// authority: it re-resolves on save and refuses anything that would fail the
// canonical GOS rule (`!firstNameHe && !firstNameEn` → first_name_required).
const t = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

export function nameDraftFromProposal(proposal, decision = null) {
  const base = decision?.fields || proposal.proposedFields;
  return {
    treatment: decision?.treatment || proposal.treatment,
    fields: {
      firstNameHe: t(base.firstNameHe), lastNameHe: t(base.lastNameHe),
      firstNameEn: t(base.firstNameEn), lastNameEn: t(base.lastNameEn),
    },
  };
}

export function resolveNameResult(proposal, draft) {
  const fields = {
    firstNameHe: t(draft.fields.firstNameHe), lastNameHe: t(draft.fields.lastNameHe),
    firstNameEn: t(draft.fields.firstNameEn), lastNameEn: t(draft.fields.lastNameEn),
  };
  const excluded = draft.treatment === 'exclude';
  const problems = [];
  if (!excluded && !fields.firstNameHe && !fields.firstNameEn) problems.push('חובה שם פרטי — בעברית או באנגלית');

  const warnings = [];
  if (!excluded) {
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
    excluded, warnings, problems, valid: problems.length === 0,
  };
}
