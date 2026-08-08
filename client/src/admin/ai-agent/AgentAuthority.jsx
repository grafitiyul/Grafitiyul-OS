import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { MODE_LABELS, MODE_STYLE, RISK_LABELS, RISK_STYLE } from './config.js';

// הרשאות — the authority matrix and the operational settings.
//
// The screen the whole module exists to make safe. Two ideas it must convey
// without a manual:
//
//   1. Authority is PER SITUATION, not one switch. Each row is a kind of
//      customer message, and each has its own mode.
//   2. Some rows have a CEILING that configuration cannot exceed. A refund can
//      never become automatic — not because nobody ticked the box, but because
//      the code refuses. That is shown, not hidden.
export default function AgentAuthority() {
  const [caps, setCaps] = useState(null);
  const [settings, setSettings] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([api.aiAgent.capabilities(), api.aiAgent.settings()]);
      setCaps(c.capabilities || []);
      setSettings(s.settings);
      setMeta({ modes: s.modes, providerConfigured: s.providerConfigured, tools: s.tools, guardCodes: s.guardCodes });
      setError(null);
    } catch (e) {
      setError(e?.payload?.error || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setMode(key, mode) {
    setBusyKey(key);
    setError(null);
    try {
      const res = await api.aiAgent.setCapabilityMode(key, { mode });
      setCaps(res.capabilities);
    } catch (e) {
      setError(e?.payload?.message || e?.payload?.error || 'העדכון נכשל');
    } finally {
      setBusyKey(null);
    }
  }

  async function saveSettings(patch) {
    setBusyKey('settings');
    try {
      const res = await api.aiAgent.saveSettings(patch);
      setSettings(res.settings);
    } catch (e) {
      setError(e?.payload?.error || 'העדכון נכשל');
    } finally {
      setBusyKey(null);
    }
  }

  if (error && !caps) return <div className="p-4 text-rose-700">{error}</div>;
  if (!caps || !settings) return <div className="p-4 gos-meta">טוען…</div>;

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="gos-title mb-4 text-[18px]">הרשאות והגדרות</h1>

      {error && <div className="mb-3 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}

      {/* ── The kill switch. Explicitly NOT an authority control. ───────── */}
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="gos-detail font-semibold text-gray-900">הפעלת הסוכן</h2>
            <p className="gos-meta mt-1 max-w-2xl">
              המתג הזה קובע רק אם הסוכן <strong>מנתח</strong> שיחות. הוא לא נותן לו שום סמכות:
              גם כשהוא דלוק, כל קטגוריה עדיין כפופה למצב שלה בטבלה למטה, ואף הודעה לא נשלחת
              ללקוח בלי אישור אנושי מפורש.
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveSettings({ enabled: !settings.enabled })}
            disabled={busyKey === 'settings' || !meta.providerConfigured}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
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

      {/* ── The matrix ─────────────────────────────────────────────────── */}
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="gos-detail mb-1 font-semibold text-gray-900">סמכות לפי סוג מצב</h2>
        <p className="gos-meta mb-3">
          כל שורה היא סוג של פנייה מלקוח. שנו את המצב כדי לקבוע מה הסוכן רשאי לעשות בה.
        </p>

        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(meta.modes || []).map((m) => (
            <div key={m.key} className={`rounded-lg border p-2 ${MODE_STYLE[m.key]}`}>
              <div className="gos-detail font-semibold">{m.labelHe}</div>
              <div className="gos-meta mt-0.5 opacity-90">{m.helpHe}</div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {caps.map((c) => (
            <article key={c.key} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-[200px] flex-1">
                  <div className="gos-title-sm text-gray-900">{c.labelHe}</div>
                  <div className="gos-detail mt-0.5 text-gray-600">{c.purposeHe}</div>
                  <div className="gos-meta mt-1">
                    <span className={`me-2 rounded px-1.5 py-0.5 ${RISK_STYLE[c.risk]}`}>{RISK_LABELS[c.risk]}</span>
                    {c.riskHe}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {['disabled', 'shadow', 'approval', 'auto'].map((m) => {
                    const blocked = MODE_ORDER[m] > MODE_ORDER[c.maxMode];
                    const active = c.mode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={blocked || busyKey === c.key}
                        title={blocked ? `הקטגוריה הזו לא יכולה לעבור למצב "${MODE_LABELS[m]}" — חסום בקוד` : undefined}
                        onClick={() => setMode(c.key, m)}
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
              {c.maxMode !== 'auto' && (
                <div className="gos-meta mt-2 text-gray-500">
                  🔒 תקרה: {MODE_LABELS[c.maxMode]}. גם אם תרצו — המערכת לא תאפשר יותר מזה בקטגוריה הזו.
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* ── Operational settings ───────────────────────────────────────── */}
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="gos-detail mb-3 font-semibold text-gray-900">הגדרות תפעוליות</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="הודעות אחרונות שהסוכן קורא"
            hint="כמה הודעות מהשיחה נמסרות לו כהקשר. יותר = הבנה טובה יותר, אבל יקר יותר."
            value={settings.recentMessageCount}
            min={4} max={60}
            onSave={(v) => saveSettings({ recentMessageCount: v })}
          />
          <NumberField
            label="ניתוחים לכל סבב (60 שניות)"
            hint="תקרה קשיחה. מגנה מפני גל הודעות שמייצר עלות בלתי צפויה."
            value={settings.maxRunsPerSweep}
            min={1} max={100}
            onSave={(v) => saveSettings({ maxRunsPerSweep: v })}
          />
          <NumberField
            label="גיל הודעה מקסימלי (דקות)"
            hint="הודעות ישנות יותר לא מנותחות — כך סנכרון היסטוריה לא מייצר אלפי ניתוחים."
            value={settings.maxMessageAgeMinutes}
            min={5} max={10080}
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
        </div>
        <div className="gos-meta mt-3">
          מודל: <code dir="ltr" className="font-mono text-[12px]">{settings.model}</code>
          {' · '}שיחות קבוצתיות: {settings.includeGroups ? 'נכללות' : 'לא נכללות'}
        </div>
      </section>

      {/* ── What the code protects regardless of configuration ─────────── */}
      <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="gos-detail mb-1 font-semibold text-gray-900">הגנות שתמיד פעילות</h2>
        <p className="gos-meta mb-3">
          הבדיקות האלה רצות על כל טיוטה, בכל מצב, ולא ניתן לכבות אותן. אם אחת מהן נכשלת —
          הטיוטה לא מוצעת לשליחה והמקרה עובר לאדם.
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {(meta.guardCodes || []).map((g) => (
            <li key={g.code} className="gos-detail text-gray-700">• {g.textHe}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="gos-detail mb-1 font-semibold text-gray-900">פעולות שהסוכן מכיר</h2>
        <p className="gos-meta mb-3">
          פעולה משנה נתונים במערכת ולכן תמיד דורשת אישור נפרד, עם תצוגה מקדימה של מה ישתנה.
        </p>
        <ul className="space-y-1">
          {(meta.tools || []).map((t) => (
            <li key={t.key} className="gos-detail text-gray-700">
              • <strong>{t.labelHe}</strong> — {t.purposeHe}{' '}
              <span className={`rounded px-1.5 py-0.5 text-[12px] ${RISK_STYLE[t.risk]}`}>{RISK_LABELS[t.risk]}</span>
              {!t.implemented && <span className="ms-1 gos-meta">(מוגדר, עדיין לא ממומש)</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const MODE_ORDER = { disabled: 0, shadow: 1, approval: 2, auto: 3 };

function NumberField({ label, hint, value, min, max, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="gos-detail mb-0.5 block font-medium text-gray-800">{label}</span>
      <span className="gos-meta mb-1 block">{hint}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { const n = Number(v); if (Number.isFinite(n) && n !== value) onSave(n); }}
        className="w-32 rounded-lg border border-gray-300 p-2 text-[14px]"
      />
    </label>
  );
}
