import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import SafetyPanel from './SafetyPanel.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import { MODE_LABELS, MODE_STYLE, RISK_LABELS, RISK_STYLE } from './config.js';

const MODE_ORDER = { disabled: 0, shadow: 1, approval: 2, auto: 3 };
const MODE_LIST = ['disabled', 'shadow', 'approval', 'auto'];

const READINESS_TONE = {
  ready: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  gathering: 'bg-sky-50 text-sky-800 border-sky-200',
  no_evidence: 'bg-gray-50 text-gray-600 border-gray-200',
  not_observing: 'bg-gray-50 text-gray-600 border-gray-200',
  not_good_enough: 'bg-amber-50 text-amber-900 border-amber-200',
  at_ceiling: 'bg-slate-50 text-slate-700 border-slate-200',
};

// הרשאות — where authority is granted, with the evidence for the decision on
// the same screen as the decision itself.
//
// Three things changed from the first version, all of them about comprehension:
//   • the 16 rows are grouped, and each group says what it is and why its
//     members are capped where they are;
//   • each row carries its readiness verdict IN WORDS with real counts, so
//     "not ready" explains itself;
//   • changing a mode shows what will actually happen and asks for confirmation
//     — the impact sentence comes from the server, so it cannot drift from what
//     the authority resolver really does.
export default function AgentAuthority() {
  const [params, setParams] = useSearchParams();
  const modeFilter = params.get('mode');
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [pending, setPending] = useState(null); // { key, labelHe, mode, impactHe }
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([api.aiAgent.capabilities(), api.aiAgent.settings()]);
      setData(c);
      setSettings(s.settings);
      setMeta({ providerConfigured: s.providerConfigured, tools: s.tools, guardCodes: s.guardCodes });
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Ask the SERVER what a mode change means, then confirm. Nothing is written
  // until the operator accepts the sentence they were shown.
  async function requestMode(cap, mode) {
    if (cap.mode === mode) return;
    setError(null);
    try {
      const impact = await api.aiAgent.capabilityImpact(cap.key, mode);
      setPending({ key: cap.key, labelHe: cap.labelHe, mode, impactHe: impact.impactHe });
    } catch (e) {
      setError(e?.payload?.message || e?.payload?.error || 'לא ניתן להציג את משמעות השינוי');
    }
  }

  async function confirmMode() {
    if (!pending) return;
    setBusyKey(pending.key);
    try {
      await api.aiAgent.setCapabilityMode(pending.key, { mode: pending.mode });
      setPending(null);
      await load();
    } catch (e) {
      setError(e?.payload?.message || e?.payload?.error || 'העדכון נכשל');
      setPending(null);
    } finally {
      setBusyKey(null);
    }
  }

  async function saveSettings(patch) {
    setBusyKey('settings');
    try {
      const res = await api.aiAgent.saveSettings(patch);
      setSettings(res.settings);
      await load();
    } catch (e) {
      setError(e?.payload?.error || 'העדכון נכשל');
    } finally { setBusyKey(null); }
  }

  if (error && !data) return <div className="p-4 text-rose-700">{error}</div>;
  if (!data || !settings) return <div className="p-4 gos-meta">טוען…</div>;

  const caps = modeFilter ? data.capabilities.filter((c) => c.mode === modeFilter) : data.capabilities;

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="gos-title mb-4 text-[18px]">הרשאות</h1>
      {error && <div className="mb-3 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}

      {/* ── The kill switch, stated for what it is ─────────────────────── */}
      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="gos-detail font-semibold text-gray-900">הפעלת הסוכן</h2>
            <p className="gos-meta mt-1 max-w-2xl">
              המתג הזה קובע רק אם הסוכן <strong>קורא</strong> שיחות. הוא לא נותן שום סמכות:
              כל קטגוריה למטה נשארת במצב שלה, ואף הודעה לא נשלחת בלי אישור שלך.
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveSettings({ enabled: !settings.enabled })}
            disabled={busyKey === 'settings' || !meta.providerConfigured}
            className={`shrink-0 rounded-lg px-4 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
              settings.enabled ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {settings.enabled ? 'כבה את הסוכן' : 'הדלק את הסוכן'}
          </button>
        </div>
        {!meta.providerConfigured && (
          <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-900">
            לא ניתן להדליק: חסר <code dir="ltr" className="font-mono text-[12px]">ANTHROPIC_API_KEY</code> בסביבת השרת.
          </div>
        )}
      </section>

      <div className="mb-4"><SafetyPanel safety={data.safety} /></div>

      {/* ── Mode legend ────────────────────────────────────────────────── */}
      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="gos-detail mb-2 font-semibold text-gray-900">ארבע רמות סמכות</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(data.modes || []).map((m) => (
            <div key={m.key} className={`rounded-lg border p-2 ${MODE_STYLE[m.key]}`}>
              <div className="gos-detail font-semibold">{m.labelHe}</div>
              <div className="gos-meta mt-0.5 opacity-90">{m.helpHe}</div>
            </div>
          ))}
        </div>
      </section>

      {modeFilter && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2">
          <span className="gos-detail text-blue-900">
            מציג רק קטגוריות במצב "{MODE_LABELS[modeFilter]}" ({caps.length})
          </span>
          <button
            type="button"
            onClick={() => setParams({}, { replace: true })}
            className="gos-meta ms-auto text-blue-800 underline"
          >
            הצג הכל
          </button>
        </div>
      )}

      {/* ── Grouped capabilities ───────────────────────────────────────── */}
      {(data.groups || []).map((g) => {
        const rows = caps.filter((c) => c.group === g.key);
        if (!rows.length) return null;
        return (
          <section key={g.key} className="mb-4">
            <div className="mb-2">
              <h2 className="gos-title-sm text-gray-900">{g.labelHe}</h2>
              <p className="gos-meta">{g.summaryHe}</p>
              <p className="gos-meta mt-0.5 text-gray-500">{g.promotionHe}</p>
            </div>
            <div className="space-y-2">
              {rows.map((c) => (
                <CapabilityRow
                  key={c.key}
                  cap={c}
                  busy={busyKey === c.key}
                  onRequestMode={(mode) => requestMode(c, mode)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* ── Operational settings, folded away by default ────────────────── */}
      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="flex w-full items-center gap-2 text-start"
        >
          <span className="gos-detail font-semibold text-gray-900">הגדרות מתקדמות</span>
          <span className="gos-meta ms-auto">{showSettings ? 'הסתר' : 'הצג'}</span>
        </button>
        {showSettings && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <NumberField
              label="הודעות אחרונות שהסוכן קורא"
              hint="כמה הודעות מהשיחה נמסרות לו כהקשר. יותר = הבנה טובה יותר, אבל יקר יותר."
              value={settings.recentMessageCount} min={4} max={60}
              onSave={(v) => saveSettings({ recentMessageCount: v })}
            />
            <NumberField
              label="ניתוחים לכל סבב (60 שניות)"
              hint="תקרה קשיחה שמגנה מפני גל הודעות שמייצר עלות בלתי צפויה."
              value={settings.maxRunsPerSweep} min={1} max={100}
              onSave={(v) => saveSettings({ maxRunsPerSweep: v })}
            />
            <NumberField
              label="גיל הודעה מקסימלי (דקות)"
              hint="הודעות ישנות יותר לא מנותחות — כך סנכרון היסטוריה לא מייצר אלפי ניתוחים."
              value={settings.maxMessageAgeMinutes} min={5} max={10080}
              onSave={(v) => saveSettings({ maxMessageAgeMinutes: v })}
            />
            <label className="block">
              <span className="gos-detail mb-0.5 block font-medium text-gray-800">עומק חשיבה</span>
              <span className="gos-meta mb-1 block">איזון בין איכות לעלות ומהירות.</span>
              <select
                value={settings.effort}
                onChange={(e) => saveSettings({ effort: e.target.value })}
                className="rounded-lg border border-gray-300 p-2 text-[14px]"
              >
                <option value="low">נמוך — הכי מהיר וזול</option>
                <option value="medium">בינוני — ברירת המחדל</option>
                <option value="high">גבוה</option>
                <option value="xhigh">גבוה מאוד</option>
                <option value="max">מקסימלי — הכי איכותי ויקר</option>
              </select>
            </label>
            <div className="sm:col-span-2 gos-meta">
              מודל: <code dir="ltr" className="font-mono text-[12px]">{settings.model}</code>
              {' · '}שיחות קבוצתיות: {settings.includeGroups ? 'נכללות' : 'לא נכללות'}
            </div>
          </div>
        )}
      </section>

      {/* ── Guards + tools, reference material ──────────────────────────── */}
      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="gos-detail mb-1 font-semibold text-gray-900">הגנות שתמיד פעילות</h2>
        <p className="gos-meta mb-2">
          רצות על כל טיוטה, בכל מצב, ואי אפשר לכבות אותן. אם אחת נכשלת — הטיוטה לא מוצעת
          לשליחה והמקרה עובר אליך.
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {(meta.guardCodes || []).map((g) => (
            <li key={g.code} className="gos-detail text-gray-700">• {g.textHe}</li>
          ))}
        </ul>
      </section>

      {/* ── Confirmation ───────────────────────────────────────────────── */}
      {pending && (
        <ModeConfirm
          pending={pending}
          busy={!!busyKey}
          onCancel={() => setPending(null)}
          onConfirm={confirmMode}
        />
      )}
    </div>
  );
}

function CapabilityRow({ cap, busy, onRequestMode }) {
  const [open, setOpen] = useState(false);
  const r = cap.readiness || {};
  const capped = cap.maxMode !== 'auto';

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="gos-title-sm text-gray-900">{cap.labelHe}</span>
            <span className={`rounded px-1.5 py-0.5 text-[11px] ${RISK_STYLE[cap.risk]}`}>{RISK_LABELS[cap.risk]}</span>
          </div>
          <div className="gos-detail mt-0.5 text-gray-600">{cap.purposeHe}</div>
          {cap.exampleHe && <div className="gos-meta mt-0.5">לדוגמה: {cap.exampleHe}</div>}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {MODE_LIST.map((m) => {
            const blocked = MODE_ORDER[m] > MODE_ORDER[cap.maxMode];
            const active = cap.mode === m;
            return (
              <button
                key={m}
                type="button"
                disabled={blocked || busy}
                title={blocked ? 'לא זמין לקטגוריה הזו — ראה הסבר למטה' : undefined}
                onClick={() => onRequestMode(m)}
                className={`rounded-md border px-2.5 py-1 text-[12px] transition ${
                  active ? `${MODE_STYLE[m]} font-semibold` : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                } ${blocked ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                {MODE_LABELS[m]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Readiness — the verdict in words, with real counts. */}
      <div className={`mt-2 rounded-lg border px-3 py-2 ${READINESS_TONE[r.state] || 'border-gray-200 bg-gray-50'}`}>
        <div className="gos-detail">{r.reasonHe}</div>
        {r.handled > 0 && (
          <div className="gos-meta mt-1">
            {r.handled} מקרים הוכרעו: {r.unchanged} נשלחו כמו שהם · {r.edited} נערכו · {r.rejected + r.bypassed} לא שימשו
          </div>
        )}
      </div>

      {capped && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="gos-meta mt-1.5 inline-flex items-center gap-1 text-gray-500 underline"
        >
          🔒 יש תקרה לקטגוריה הזו — {open ? 'הסתר' : 'למה?'}
        </button>
      )}
      {capped && open && (
        <p className="gos-detail mt-1 rounded-lg bg-gray-50 px-3 py-2 text-gray-700">
          {cap.ceilingHe} <span className="gos-meta">(המקסימום האפשרי: {MODE_LABELS[cap.maxMode]})</span>
        </p>
      )}
    </article>
  );
}

// The confirmation. It shows the SERVER's sentence about what will change, so
// the operator is never asked to approve something the UI paraphrased.
// Rendered through the canonical ConfirmDialog — same portal, same layering and
// same escape/backdrop behaviour as every other confirmation in GOS.
function ModeConfirm({ pending, busy, onCancel, onConfirm }) {
  const dangerous = pending.mode === 'auto';
  return (
    <ConfirmDialog
      open
      danger={dangerous}
      title={`לשנות את "${pending.labelHe}" ל־${MODE_LABELS[pending.mode]}?`}
      confirmLabel={busy ? 'משנה…' : 'כן, שנה'}
      onCancel={onCancel}
      onConfirm={onConfirm}
      body={(
        <div>
          <p className="gos-detail text-gray-800">{pending.impactHe}</p>
          {dangerous && (
            <p className="gos-detail mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-semibold text-rose-900">
              זו הרמה היחידה שבה נשלחות הודעות ללקוחות בלי שתראה אותן מראש.
            </p>
          )}
        </div>
      )}
    />
  );
}

function NumberField({ label, hint, value, min, max, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="gos-detail mb-0.5 block font-medium text-gray-800">{label}</span>
      <span className="gos-meta mb-1 block">{hint}</span>
      <input
        type="number" min={min} max={max} value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { const n = Number(v); if (Number.isFinite(n) && n !== value) onSave(n); }}
        className="w-32 rounded-lg border border-gray-300 p-2 text-[14px]"
      />
    </label>
  );
}
