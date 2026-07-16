import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import {
  SettingsCard,
  SortableList,
  TextInput,
  PrimaryButton,
  CountChip,
  Pill,
} from './catalogKit.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import { PaymentTermsButton } from './OrgTypePaymentTermsModal.jsx';

const FIELD_LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

// Quote content owned by the org classification (rich He/En). Shared by both the
// Types and Subtypes edit forms via catalogKit's editPanel hook. Reuses the
// shared RichEditor (with its RTL/LTR controls). NOT wired to Quotes yet —
// stored for future automatic insertion into quotes by type/subtype.
function QuoteContentEditor({ draft, setDraft }) {
  return (
    <div className="w-full space-y-3 pt-1">
      <div>
        <span className={FIELD_LABEL}>תוכן להצעת מחיר</span>
        <RichEditor
          value={draft.quoteContentHe || ''}
          onChange={(v) => setDraft((d) => ({ ...d, quoteContentHe: v }))}
          ariaLabel="תוכן להצעת מחיר בעברית"
          placeholder="תוכן שיופיע בהצעות מחיר…"
          minContentHeight={140}
        />
        <p className="text-[11px] text-gray-400 mt-1">
          יופיע בהמשך אוטומטית בהצעות מחיר לפי סוג/תת־סוג הארגון.
        </p>
      </div>
      <div>
        <span className={FIELD_LABEL}>Quote content</span>
        <RichEditor
          value={draft.quoteContentEn || ''}
          onChange={(v) => setDraft((d) => ({ ...d, quoteContentEn: v }))}
          ariaLabel="Quote content (EN)"
          placeholder="Content for quotes…"
          minContentHeight={140}
        />
        <p className="text-[11px] text-gray-400 mt-1" dir="ltr">
          Will later appear automatically in quotes based on the organization type/subtype.
        </p>
      </div>
    </div>
  );
}

// catalogKit edit hooks — identical for Types and Subtypes.
const quoteSeed = (item) => ({
  quoteContentHe: item.quoteContentHe || '',
  quoteContentEn: item.quoteContentEn || '',
});
const quoteToPatch = (draft) => ({
  quoteContentHe: draft.quoteContentHe || null,
  quoteContentEn: draft.quoteContentEn || null,
});
const quotePanel = (draft, setDraft) => (
  <QuoteContentEditor draft={draft} setDraft={setDraft} />
);

// Type-only edit hooks: quote content + the Travel Agency Reservations
// capability flag (logic reads the flag, never the Hebrew label — toggled on
// for "סוכנויות תיירות ונסיעות"). Turning it off immediately blocks every
// dependent agent link (eligibility re-checks live on each open).
const typeSeed = (item) => ({
  ...quoteSeed(item),
  agentReservations: !!item.agentReservations,
});
const typeToPatch = (draft) => ({
  ...quoteToPatch(draft),
  agentReservations: !!draft.agentReservations,
});
const typePanel = (draft, setDraft) => (
  <div className="w-full space-y-3">
    <QuoteContentEditor draft={draft} setDraft={setDraft} />
    <label className="flex items-start gap-2 pt-1 cursor-pointer">
      <input
        type="checkbox"
        checked={!!draft.agentReservations}
        onChange={(e) =>
          setDraft((d) => ({ ...d, agentReservations: e.target.checked }))
        }
        className="mt-0.5"
      />
      <span>
        <span className="block text-[13px] font-medium text-gray-800">
          קישורי הזמנות לסוכנים
        </span>
        <span className="block text-[12px] text-gray-500">
          אנשי קשר של ארגונים מסוג זה יכולים לקבל קישור הזמנות קבוע (טופס
          הזמנות לסוכני נסיעות). כיבוי חוסם מיידית את כל הקישורים התלויים.
        </span>
      </span>
    </label>
  </div>
);

// CRM settings → Organization Types & Subtypes.
//
// Types belong to the Organization; Subtypes belong to the Deal (e.g. School →
// Teachers / Students). Deal Stages live on a separate settings screen now.
// Hebrew name is required; English label is optional; the internal key is never
// shown and never regenerated on rename.
export default function CrmSettingsPage() {
  const [types, setTypes] = useState([]);
  const [subtypes, setSubtypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [t, s] = await Promise.all([
        api.organizationTypes.list(),
        api.organizationSubtypes.list(),
      ]);
      setTypes(t);
      setSubtypes(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          סוגי ארגון ותת-סוגים
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          קטלוג סוגי הארגון ותת-הסוגים. שם בעברית הוא שדה החובה; שם באנגלית
          אופציונלי.
        </p>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <div className="space-y-8">
          <TypesSection types={types} onChange={refresh} />
          <SubtypesSection subtypes={subtypes} types={types} onChange={refresh} />
        </div>
      )}
    </div>
  );
}

function TypesSection({ types, onChange }) {
  async function reorder(ids) {
    try { await api.organizationTypes.reorder(ids); }
    catch (e) { alert('שגיאה בעדכון הסדר: ' + e.message); }
    finally { onChange(); }
  }
  async function save(item, patch) {
    await api.organizationTypes.update(item.id, patch);
    await onChange();
  }
  async function remove(item) {
    if (!confirm(`למחוק את "${item.label}"? ארגונים מקושרים יישארו ללא סוג.`)) return;
    try { await api.organizationTypes.remove(item.id); await onChange(); }
    catch (e) { alert('שגיאה במחיקה: ' + e.message); }
  }

  return (
    <SettingsCard
      title="סוגי ארגון"
      description="לדוגמה: בתי ספר, חברות, רשויות מקומיות. ישפיע בהמשך על תמחור, נוסח הצעות מחיר ותבניות."
      footer={<AddTypeForm onChange={onChange} />}
    >
      <SortableList
        items={types}
        onReorder={reorder}
        onSave={save}
        onRemove={remove}
        emptyText="עדיין אין סוגי ארגון. הוסיפו את הראשון למטה."
        renderMeta={(t) => (
          <span className="flex items-center gap-1.5">
            {t.agentReservations && <Pill>הזמנות סוכנים</Pill>}
            <CountChip n={t._count?.organizations ?? 0} noun="ארגונים" />
          </span>
        )}
        rowActions={(t) => <PaymentTermsButton type={t} onSaved={onChange} />}
        editSeed={typeSeed}
        editPanel={typePanel}
        editToPatch={typeToPatch}
      />
    </SettingsCard>
  );
}

function SubtypesSection({ subtypes, types, onChange }) {
  async function reorder(ids) {
    try { await api.organizationSubtypes.reorder(ids); }
    catch (e) { alert('שגיאה בעדכון הסדר: ' + e.message); }
    finally { onChange(); }
  }
  async function save(item, patch) {
    await api.organizationSubtypes.update(item.id, patch);
    await onChange();
  }
  async function remove(item) {
    if (!confirm(`למחוק את תת-הסוג "${item.label}"?`)) return;
    try { await api.organizationSubtypes.remove(item.id); await onChange(); }
    catch (e) { alert('שגיאה במחיקה: ' + e.message); }
  }

  return (
    <SettingsCard
      title="תת-סוגים"
      description="תת-סוג שייך לדיל, לא לארגון (לדוגמה: בית ספר → מורים / תלמידים). מוכן כקטלוג — ייכנס לשימוש כשייבנה מודול הדילים."
      footer={<AddSubtypeForm types={types} onChange={onChange} />}
    >
      <SortableList
        items={subtypes}
        onReorder={reorder}
        onSave={save}
        onRemove={remove}
        emptyText="עדיין אין תת-סוגים."
        renderMeta={(s) =>
          s.organizationType ? (
            <Pill>{s.organizationType.label}</Pill>
          ) : (
            <span className="shrink-0 text-[12px] text-gray-400">כללי</span>
          )
        }
        editExtra={(draft, setDraft) => (
          <select
            value={draft.organizationTypeId || ''}
            onChange={(e) => setDraft((d) => ({ ...d, organizationTypeId: e.target.value }))}
            className="h-10 flex-1 min-w-[7rem] sm:max-w-[12rem] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          >
            <option value="">כללי</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        )}
        editSeed={quoteSeed}
        editPanel={quotePanel}
        editToPatch={quoteToPatch}
      />
    </SettingsCard>
  );
}

function AddTypeForm({ onChange }) {
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.organizationTypes.create({ label: label.trim(), labelEn: labelEn.trim() || null });
      setLabel(''); setLabelEn('');
      await onChange();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
      <TextInput value={label} onChange={setLabel} placeholder="שם סוג ארגון" className="flex-1" />
      <TextInput value={labelEn} onChange={setLabelEn} placeholder="Label (EN) — אופציונלי" ltr className="sm:w-52" />
      <PrimaryButton disabled={busy || !label.trim()}>{busy ? 'מוסיף…' : 'הוסף סוג'}</PrimaryButton>
    </form>
  );
}

function AddSubtypeForm({ types, onChange }) {
  const [label, setLabel] = useState('');
  const [typeId, setTypeId] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.organizationSubtypes.create({ label: label.trim(), organizationTypeId: typeId || null });
      setLabel(''); setTypeId('');
      await onChange();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
      <TextInput value={label} onChange={setLabel} placeholder="שם תת-סוג" className="flex-1" />
      <select
        value={typeId}
        onChange={(e) => setTypeId(e.target.value)}
        className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 sm:w-52"
      >
        <option value="">שייך לסוג ארגון — כללי</option>
        {types.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
      </select>
      <PrimaryButton disabled={busy || !label.trim()}>{busy ? 'מוסיף…' : 'הוסף תת-סוג'}</PrimaryButton>
    </form>
  );
}
