import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';

const OP_INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

// Shared organization picker — ONE free-typed field with autocomplete over
// existing orgs. Pick a suggestion (or type an exact existing name) → existing
// org, its type shown read-only (it stays the source of truth). Type a fresh
// name → a NEW org (requires a type; optional subtype when `showSubtype`).
//
// The component is presentation + resolution only: it reports its current
// resolution via `onResolve` and the PARENT persists it (link to a deal or a
// contact) with `resolveOrganization()` below — so there is no duplicate
// organization logic and no second source of truth. `onResolve` must be stable
// (pass a useState setter or a useCallback).
export function OrgPicker({ orgs, types, subtypes = [], showSubtype = false, onResolve }) {
  const [orgName, setOrgName] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [existingOrgType, setExistingOrgType] = useState(null);
  const [orgFocused, setOrgFocused] = useState(false);
  const [orgTypeId, setOrgTypeId] = useState('');
  const [subtypeId, setSubtypeId] = useState('');

  const typedOrg = orgName.trim();
  const exactMatch = typedOrg
    ? orgs.find((o) => (o.name || '').trim().toLowerCase() === typedOrg.toLowerCase())
    : null;
  const existingOrgId = selectedOrgId || (exactMatch ? exactMatch.id : '');
  const isExisting = !!existingOrgId;
  const isNew = !!typedOrg && !existingOrgId;
  const orgSuggestions =
    typedOrg && !selectedOrgId
      ? orgs.filter((o) => (o.name || '').toLowerCase().includes(typedOrg.toLowerCase())).slice(0, 6)
      : [];
  const scopedSubtypes = subtypes.filter(
    (s) => !orgTypeId || !s.organizationTypeId || s.organizationTypeId === orgTypeId,
  );
  const invalid = isNew && !orgTypeId; // a new org must have a type

  // Existing org → fetch its type for read-only display (source of truth).
  useEffect(() => {
    if (!existingOrgId) {
      setExistingOrgType(null);
      return;
    }
    let live = true;
    api.organizations
      .get(existingOrgId)
      .then((full) => { if (live) setExistingOrgType(full.organizationType || null); })
      .catch(() => { if (live) setExistingOrgType(null); });
    return () => { live = false; };
  }, [existingOrgId]);

  // Report the resolution upward whenever it changes.
  useEffect(() => {
    onResolve({
      isExisting,
      isNew,
      invalid,
      existingOrgId,
      newOrgName: isNew ? typedOrg : '',
      orgTypeId: isNew ? orgTypeId : '',
      subtypeId: showSubtype && isNew ? subtypeId : '',
    });
  }, [onResolve, isExisting, isNew, invalid, existingOrgId, typedOrg, orgTypeId, subtypeId, showSubtype]);

  function chooseOrg(o) {
    setSelectedOrgId(o.id);
    setOrgName(o.name);
    setOrgTypeId('');
    setSubtypeId('');
    setOrgFocused(false);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">ארגון</span>
          <input
            value={orgName}
            onChange={(e) => { setOrgName(e.target.value); setSelectedOrgId(''); }}
            onFocus={() => setOrgFocused(true)}
            onBlur={() => setTimeout(() => setOrgFocused(false), 120)}
            placeholder="הקלידו שם ארגון…"
            autoComplete="off"
            className={OP_INPUT}
          />
        </label>
        {orgFocused && orgSuggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-44 overflow-y-auto">
            {orgSuggestions.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseOrg(o)}
                  className="block w-full text-right px-3 py-2 text-sm hover:bg-blue-50"
                >
                  {o.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isExisting ? (
        <div className="rounded-lg bg-white border border-gray-200 px-3 py-2">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-gray-400">סוג ארגון</span>
            <span className="font-medium text-gray-700">{existingOrgType?.label || '—'}</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">הארגון הקיים הוא מקור האמת.</p>
        </div>
      ) : isNew ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">סוג ארגון *</span>
            <select value={orgTypeId} onChange={(e) => { setOrgTypeId(e.target.value); setSubtypeId(''); }} className={`${OP_INPUT} bg-white`}>
              <option value="">— בחר סוג —</option>
              {types.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
            </select>
          </label>
          {showSubtype && orgTypeId && scopedSubtypes.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-500">תת-סוג</span>
              <select value={subtypeId} onChange={(e) => setSubtypeId(e.target.value)} className={`${OP_INPUT} bg-white`}>
                <option value="">— ללא —</option>
                {scopedSubtypes.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
              </select>
            </label>
          )}
        </>
      ) : null}
    </div>
  );
}

// Persist a resolved organization, reusing the existing organizations API.
// Returns { organizationId } — creating a NEW org first when needed. The caller
// links it (to a deal or a contact) and reads `resolution.subtypeId` separately
// when it needs the deal-level subtype.
export async function resolveOrganization(resolution) {
  if (!resolution) return { organizationId: null };
  if (resolution.isExisting) return { organizationId: resolution.existingOrgId };
  if (resolution.isNew && resolution.newOrgName) {
    const org = await api.organizations.create({
      name: resolution.newOrgName,
      organizationTypeId: resolution.orgTypeId || null,
    });
    return { organizationId: org.id };
  }
  return { organizationId: null };
}
