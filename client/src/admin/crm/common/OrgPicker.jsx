import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';

const OP_INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

// Shared organization picker — THE one org combobox (deals list filter,
// contact create/edit dialogs, contact page memberships). ONE free-typed field
// with autocomplete over organizations. Pick a suggestion (or type an exact
// existing name) → existing org, its type shown read-only (it stays the source
// of truth). Type a fresh name → a NEW org (requires a type; optional subtype
// when `showSubtype`), or open the compact "+ צור ארגון חדש" dialog for a
// fuller creation (finance/identity fields) via the SAME canonical create API.
//
// Modes:
//   • orgs (array)        — client-side filtering over a preloaded list.
//   • serverSearch (bool) — debounced, capped GET /api/organizations?q= —
//                           for surfaces that must not preload the catalog.
//
// The component is presentation + resolution only: it reports its current
// resolution via `onResolve` and the PARENT persists it (link to a deal or a
// contact) with `resolveOrganization()` below — so there is no duplicate
// organization logic and no second source of truth. `onResolve` must be stable
// (pass a useState setter or a useCallback).
export function OrgPicker({
  orgs = [],
  types,
  subtypes = [],
  showSubtype = false,
  serverSearch = false,
  allowCreateDialog = false,
  onResolve,
}) {
  const [orgName, setOrgName] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [existingOrgType, setExistingOrgType] = useState(null);
  const [orgFocused, setOrgFocused] = useState(false);
  const [orgTypeId, setOrgTypeId] = useState('');
  const [subtypeId, setSubtypeId] = useState('');
  const [remote, setRemote] = useState([]); // serverSearch suggestions
  const [activeIndex, setActiveIndex] = useState(-1);
  const [createOpen, setCreateOpen] = useState(false);
  const debounceRef = useRef(null);

  const typedOrg = orgName.trim();
  const pool = serverSearch ? remote : orgs;
  const exactMatch = typedOrg
    ? pool.find((o) => (o.name || '').trim().toLowerCase() === typedOrg.toLowerCase())
    : null;
  const existingOrgId = selectedOrgId || (exactMatch ? exactMatch.id : '');
  const isExisting = !!existingOrgId;
  const isNew = !!typedOrg && !existingOrgId;
  const orgSuggestions =
    typedOrg && !selectedOrgId
      ? serverSearch
        ? remote
        : orgs
            .filter((o) => (o.name || '').toLowerCase().includes(typedOrg.toLowerCase()))
            .slice(0, 6)
      : [];
  const scopedSubtypes = subtypes.filter(
    (s) => !orgTypeId || !s.organizationTypeId || s.organizationTypeId === orgTypeId,
  );
  const invalid = isNew && !orgTypeId; // a new org must have a type

  // Server-side type-ahead — debounced, capped, case-insensitive (server).
  useEffect(() => {
    if (!serverSearch) return undefined;
    if (!typedOrg || selectedOrgId) {
      setRemote([]);
      return undefined;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.organizations
        .list({ q: typedOrg })
        .then((rows) => setRemote(rows || []))
        .catch(() => setRemote([]));
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [serverSearch, typedOrg, selectedOrgId]);

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
    setActiveIndex(-1);
  }

  function clearSelection() {
    setSelectedOrgId('');
    setOrgName('');
    setRemote([]);
    setActiveIndex(-1);
  }

  const showNoResults = orgFocused && typedOrg && !selectedOrgId && orgSuggestions.length === 0;
  const showCreateRow = allowCreateDialog && orgFocused && !selectedOrgId;
  const listOpen = orgFocused && !selectedOrgId && (orgSuggestions.length > 0 || showNoResults || showCreateRow);
  // Keyboard rows: suggestions + (optional) the create row at the end.
  const rowCount = orgSuggestions.length + (showCreateRow ? 1 : 0);

  function onKeyDown(e) {
    if (!listOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(1, rowCount));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? rowCount - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (activeIndex < 0) return;
      e.preventDefault();
      if (activeIndex < orgSuggestions.length) chooseOrg(orgSuggestions[activeIndex]);
      else if (showCreateRow) setCreateOpen(true);
    } else if (e.key === 'Escape') {
      setOrgFocused(false);
      setActiveIndex(-1);
    }
  }

  // "type · address · units" context line so similarly-named orgs disambiguate.
  function contextLine(o) {
    return [
      o.organizationType?.label,
      o.address,
      o._count?.units ? `${o._count.units} יחידות` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">ארגון</span>
          <span className="relative block">
            <input
              value={orgName}
              onChange={(e) => { setOrgName(e.target.value); setSelectedOrgId(''); setActiveIndex(-1); }}
              onFocus={() => setOrgFocused(true)}
              onBlur={() => setTimeout(() => setOrgFocused(false), 120)}
              onKeyDown={onKeyDown}
              placeholder="הקלידו שם ארגון…"
              autoComplete="off"
              className={OP_INPUT + (selectedOrgId ? ' pe-8' : '')}
            />
            {selectedOrgId && (
              <button
                type="button"
                onClick={clearSelection}
                title="נקה בחירה"
                className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            )}
          </span>
        </label>
        {listOpen && (
          <ul className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-56 overflow-y-auto">
            {orgSuggestions.map((o, i) => (
              <li key={o.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseOrg(o)}
                  className={`block w-full text-right px-3 py-2 text-sm ${
                    i === activeIndex ? 'bg-blue-50' : 'hover:bg-blue-50'
                  }`}
                >
                  <span className="block text-gray-900">{o.name}</span>
                  {contextLine(o) && (
                    <span className="block text-[11px] text-gray-400">{contextLine(o)}</span>
                  )}
                </button>
              </li>
            ))}
            {showNoResults && (
              <li className="px-3 py-2 text-[12px] text-gray-400">לא נמצאו ארגונים תואמים.</li>
            )}
            {showCreateRow && (
              <li className="border-t border-gray-100">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setCreateOpen(true)}
                  className={`block w-full text-right px-3 py-2 text-sm font-medium text-blue-700 ${
                    activeIndex === orgSuggestions.length ? 'bg-blue-50' : 'hover:bg-blue-50'
                  }`}
                >
                  + צור ארגון חדש{typedOrg ? ` — "${typedOrg}"` : ''}
                </button>
              </li>
            )}
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

      {createOpen && (
        <CreateOrgDialog
          types={types}
          initialName={typedOrg}
          onClose={() => setCreateOpen(false)}
          onCreated={(org) => {
            setCreateOpen(false);
            chooseOrg(org);
          }}
        />
      )}
    </div>
  );
}

// Compact create-organization dialog — the SAME canonical create API
// (POST /api/organizations: name/type/notes + whitelisted finance fields);
// no second creation service. Opened from the picker's "+ צור ארגון חדש" row;
// on success the new org is handed back and selected in place.
function CreateOrgDialog({ types, initialName, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: initialName || '',
    organizationTypeId: '',
    financePhone: '',
    financeEmail: '',
    taxId: '',
    address: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (f, v) => setForm((s) => ({ ...s, [f]: v }));
  const valid = form.name.trim() && form.organizationTypeId;

  async function submit(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const org = await api.organizations.create({
        name: form.name.trim(),
        organizationTypeId: form.organizationTypeId,
        financePhone: form.financePhone.trim() || null,
        financeEmail: form.financeEmail.trim() || null,
        taxId: form.taxId.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      });
      onCreated(org);
    } catch (err) {
      setError(err?.payload?.error || err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-[15px] font-bold text-gray-900">ארגון חדש</h3>
        <Field label="שם הארגון *">
          <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} className={OP_INPUT} />
        </Field>
        <Field label="סוג ארגון *">
          <select
            value={form.organizationTypeId}
            onChange={(e) => set('organizationTypeId', e.target.value)}
            className={`${OP_INPUT} bg-white`}
          >
            <option value="">— בחר סוג —</option>
            {types.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="טלפון">
            <input value={form.financePhone} onChange={(e) => set('financePhone', e.target.value)} dir="ltr" className={OP_INPUT} />
          </Field>
          <Field label="אימייל (כספים)">
            <input value={form.financeEmail} onChange={(e) => set('financeEmail', e.target.value)} dir="ltr" className={OP_INPUT} />
          </Field>
          <Field label="ח.פ / עוסק">
            <input value={form.taxId} onChange={(e) => set('taxId', e.target.value)} dir="ltr" className={OP_INPUT} />
          </Field>
          <Field label="עיר / כתובת">
            <input value={form.address} onChange={(e) => set('address', e.target.value)} className={OP_INPUT} />
          </Field>
        </div>
        <Field label="הערות">
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </Field>
        {error && (
          <div className="text-[12px] text-red-600">
            שגיאה: <span dir="ltr" className="font-mono">{error}</span>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
            ביטול
          </button>
          <button type="submit" disabled={!valid || busy} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'יוצר…' : 'צור ארגון'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-gray-500">{label}</span>
      {children}
    </label>
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
