import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog from '../common/Dialog.jsx';
import { api } from '../../lib/api.js';

// Choose / edit the Deal's organization binding from the header — a focused
// chooser, NOT a second organization editor. It reuses the existing org + deal
// APIs and links out to the full Organization page for deep editing (units,
// finance, contacts).
//
// Source-of-truth rules (mirrored on the backend):
//   • Organization type
//       – org linked  → edits the ORGANIZATION's own type (api.organizations.update);
//                        every deal of that org reflects it. (No deal-level copy.)
//       – no org      → stored on the DEAL (Deal.organizationTypeId).
//   • Subtype  → always on the Deal (Deal.organizationSubtypeId).
//   • Unit     → on the Deal (Deal.organizationUnitId).
//
// Nothing autosaves — there is one explicit "שמור" button.
const FIELD = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white w-full';

export default function OrganizationEditDialog({ deal, orgs, types, subtypes, open, onClose, onSaved }) {
  const [orgId, setOrgId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [typeId, setTypeId] = useState(''); // effective org type (org's, or deal's when no org)
  const [subtypeId, setSubtypeId] = useState('');
  const [orgFull, setOrgFull] = useState(null); // fetched org (units + current type)
  const [busy, setBusy] = useState(false);

  // Initialise from the deal whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    const initialOrgId = deal.organizationId || '';
    setOrgId(initialOrgId);
    setUnitId(deal.organizationUnitId || '');
    setSubtypeId(deal.organizationSubtypeId || '');
    setOrgFull(null);
    if (initialOrgId) {
      api.organizations
        .get(initialOrgId)
        .then((full) => {
          setOrgFull(full);
          setTypeId(full.organizationTypeId || '');
        })
        .catch(() => setTypeId(''));
    } else {
      // No org → the deal owns the type.
      setTypeId(deal.organizationType?.id || deal.organizationTypeId || '');
    }
  }, [open, deal]);

  async function chooseOrg(value) {
    setOrgId(value);
    setUnitId('');
    setOrgFull(null);
    if (value) {
      try {
        const full = await api.organizations.get(value);
        setOrgFull(full);
        setTypeId(full.organizationTypeId || '');
      } catch {
        setTypeId('');
      }
    }
    // When clearing the org, keep the current typeId as the deal's own type.
  }

  const units = orgFull?.units || [];
  // Subtypes are scoped to the effective type (plus generic, type-less subtypes).
  const scopedSubtypes = subtypes.filter(
    (s) => !typeId || !s.organizationTypeId || s.organizationTypeId === typeId,
  );

  async function save() {
    setBusy(true);
    try {
      const finalOrgId = orgId || null;
      const dealPayload = {
        organizationId: finalOrgId,
        organizationUnitId: unitId || null,
        organizationSubtypeId: subtypeId || null,
      };
      // Deal owns the type ONLY when there is no organization.
      if (!finalOrgId) dealPayload.organizationTypeId = typeId || null;
      await api.deals.update(deal.id, dealPayload);

      // When an org is linked, the org is the source of truth for its type.
      if (finalOrgId && typeId !== (orgFull?.organizationTypeId || '')) {
        await api.organizations.update(finalOrgId, { organizationTypeId: typeId || null });
      }
      await onSaved?.();
      onClose?.();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="ארגון, סוג ותת-סוג"
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-1.5 hover:bg-gray-50"
          >
            ביטול
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="bg-blue-600 text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50"
          >
            {busy ? 'שומר…' : 'שמור'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="ארגון">
          <select value={orgId} onChange={(e) => chooseOrg(e.target.value)} className={FIELD}>
            <option value="">— ללא ארגון —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </Field>

        {orgId && (
          <Field label="יחידה (אופציונלי)">
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={!units.length}
              className={`${FIELD} disabled:bg-gray-100`}
            >
              <option value="">— ללא —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="סוג ארגון">
          <select value={typeId} onChange={(e) => { setTypeId(e.target.value); setSubtypeId(''); }} className={FIELD}>
            <option value="">— ללא —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">
            {orgId
              ? 'נשמר על הארגון — ישפיע על כל הדילים של אותו ארגון.'
              : 'נשמר על הדיל עד שיקושר ארגון.'}
          </p>
        </Field>

        <Field label="תת-סוג (של הדיל)">
          <select value={subtypeId} onChange={(e) => setSubtypeId(e.target.value)} className={FIELD}>
            <option value="">— ללא —</option>
            {scopedSubtypes.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          {typeId && scopedSubtypes.length === 0 && (
            <p className="text-[11px] text-gray-400 mt-1">לסוג זה אין תת-סוגים מוגדרים.</p>
          )}
        </Field>

        {orgId && (
          <div className="pt-1">
            <Link to={`/admin/crm/organizations/${orgId}`} className="text-[13px] text-blue-700 hover:underline">
              פתח את כרטיס הארגון המלא (יחידות, כספים, אנשי קשר) ←
            </Link>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}
