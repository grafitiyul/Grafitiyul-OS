import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import BackButton from '../../common/BackButton.jsx';
import {
  SettingsCard,
  SortableList,
  TextInput,
  PrimaryButton,
  CountChip,
} from './catalogKit.jsx';

// CRM settings → Deal Stages. The sales pipeline. The order defines a deal's
// progression. WON / LOST is the deal's status, separate from the stage.
// Hebrew name is required; English label optional; internal key never shown.
export default function DealStagesSettings() {
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setStages(await api.dealStages.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function reorder(ids) {
    try { await api.dealStages.reorder(ids); }
    catch (e) { alert('שגיאה בעדכון הסדר: ' + e.message); }
    finally { refresh(); }
  }
  async function save(item, patch) {
    await api.dealStages.update(item.id, patch);
    await refresh();
  }
  async function remove(item) {
    if (!confirm(`למחוק את השלב "${item.label}"?`)) return;
    try {
      await api.dealStages.remove(item.id);
      await refresh();
    } catch (e) {
      if (e.payload?.error === 'stage_in_use') {
        alert('לא ניתן למחוק שלב שמשויכים אליו דילים. העבירו אותם לשלב אחר תחילה.');
      } else {
        alert('שגיאה במחיקה: ' + e.message);
      }
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-3xl mx-auto">
      <header className="mb-8">
        <BackButton to="/admin/settings/crm" label="חזרה להגדרות CRM" />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">
          שלבי דיל
        </h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          צינור המכירות (Pipeline). הסדר קובע את התקדמות הדיל. WON / LOST הוא
          סטטוס של הדיל — נפרד מהשלב.
        </p>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <SettingsCard
          title="שלבי הצינור"
          description="גררו לשינוי הסדר. ניתן לערוך שם, להוסיף ולהסיר שלבים."
          footer={<AddStageForm onChange={refresh} />}
        >
          <SortableList
            items={stages}
            onReorder={reorder}
            onSave={save}
            onRemove={remove}
            emptyText="טוען שלבי ברירת מחדל…"
            renderMeta={(s) => <CountChip n={s._count?.deals ?? 0} noun="דילים" />}
          />
        </SettingsCard>
      )}
    </div>
  );
}

function AddStageForm({ onChange }) {
  const [label, setLabel] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.dealStages.create({ label: label.trim(), labelEn: labelEn.trim() || null });
      setLabel(''); setLabelEn('');
      await onChange();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
      <TextInput value={label} onChange={setLabel} placeholder="שם שלב" className="flex-1" />
      <TextInput value={labelEn} onChange={setLabelEn} placeholder="Label (EN) — אופציונלי" ltr className="sm:w-52" />
      <PrimaryButton disabled={busy || !label.trim()}>{busy ? 'מוסיף…' : 'הוסף שלב'}</PrimaryButton>
    </form>
  );
}
