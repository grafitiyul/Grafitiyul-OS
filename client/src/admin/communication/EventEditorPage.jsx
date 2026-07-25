import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { registerDynamicFields } from '../../lib/dynamicFields.js';
import { useDirtyWhen, valuesEqual } from '../../lib/dirtyForms.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import Dialog from '../common/Dialog.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import SearchSelect from './SearchSelect.jsx';
import WhatsAppBodyEditor from './WhatsAppBodyEditor.jsx';
import EmailBodyEditor from './EmailBodyEditor.jsx';
import SimulatorPanel, { DealPicker } from './SimulatorPanel.jsx';
import { toEventForm, isEventFormDirty, reconcileEventForm } from './eventFormState.js';
import {
  STATUS_LABELS, STATUS_TONES, CHANNEL_LABELS, AUDIENCE_LABELS,
  ACTIVITY_LABELS, timingLabel, StatusChip, ChannelBadge,
} from './commLabels.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// The Communication Event editor — a dedicated full-width route (not a cramped
// modal): event settings (trigger/timing/applicability) + the child messages,
// each with its own channel config, WhatsApp sender/destination, language
// tabs, rich editors, documents, sending-window toggle, preview & test-send.
// ─────────────────────────────────────────────────────────────────────────────

const card = 'rounded-xl border border-gray-200 bg-white shadow-sm';
const label12 = 'text-[12.5px] font-semibold text-gray-700';
const selectCls = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';
const inputCls = 'rounded-lg border border-gray-300 px-3 py-1.5 text-[13.5px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

export default function EventEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  // Server snapshot vs the user's editable form — SEPARATE states. A refresh
  // (initial fetch resolving late, or any child action reloading) rehydrates
  // the form ONLY while it is clean; typed-but-unsaved content is never
  // overwritten (eventFormState.js — the תיאור-קצר data-loss fix).
  const [event, setEvent] = useState(null);
  const [form, setForm] = useState(null);
  const serverRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [simDraft, setSimDraft] = useState(null);
  const [testCtx, setTestCtx] = useState(null); // {dealId?} | {synthetic?} — opens the test-send dialog

  const load = useCallback(async ({ forceHydrate = false } = {}) => {
    try {
      const [m, e] = await Promise.all([api.communication.meta(), api.communication.event(id)]);
      registerDynamicFields(m.variables.map((v) => ({ key: v.key, label: v.labelHe, description: v.labelEn })));
      setMeta(m);
      setEvent(e);
      setForm((prev) => reconcileEventForm(prev, serverRef.current, e, { force: forceHydrate }));
      serverRef.current = e;
      setSelectedMessageId((cur) => cur && e.messages.some((x) => x.id === cur) ? cur : e.messages[0]?.id || null);
    } catch (err) {
      setError(err?.payload?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const eventDirty = isEventFormDirty(form, event);
  useDirtyWhen(form || {}, event ? toEventForm(event) : {});

  const patchEvent = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function saveEvent() {
    setSaving(true);
    try {
      await api.communication.updateEvent(id, form);
      await load({ forceHydrate: true });
    } catch (err) {
      alert(`שמירה נכשלה: ${err?.payload?.error || err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function eventAction(action) {
    try {
      await api.communication.eventAction(id, action);
      await load();
    } catch (err) {
      const errors = err?.payload?.errors;
      alert(errors?.length ? `לא ניתן להפעיל:\n• ${errors.join('\n• ')}` : `הפעולה נכשלה: ${err?.payload?.error || err.message}`);
    }
  }

  async function addMessage(channel) {
    const created = await api.communication.createMessage(id, { channel });
    await load();
    setSelectedMessageId(created.id);
  }

  if (loading) return <div className="px-8 py-10 text-sm text-gray-400">טוען…</div>;
  if (error || !event || !form) {
    return (
      <div className="px-8 py-10">
        <SettingsChrome />
        <div className="text-sm text-red-600">שגיאה: <span className="font-mono">{error || 'not_found'}</span></div>
      </div>
    );
  }

  const trigger = meta.triggers.find((t) => t.type === form.triggerType);
  const selectedMessage = event.messages.find((m) => m.id === selectedMessageId) || null;
  const businessRelevant = form.activityMode === 'all'
    || (form.activityMode === 'include' && form.activityTypes.includes('business'))
    || (form.activityMode === 'exclude' && !form.activityTypes.includes('business'));
  const tourAnchorSupported = (trigger?.anchors || []).includes('tour_datetime');
  const beforeInvalid = form.timingMode === 'before' && form.anchorType !== 'tour_datetime';

  return (
    <div dir="rtl" className="mx-auto max-w-[1600px] px-5 pb-16 lg:px-8">
      <SettingsChrome currentLabel={event.internalName} />

      {/* header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-xl text-white shadow-sm">💬</div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight text-gray-900">{event.internalName}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-gray-500">
            <StatusChip status={event.status} />
            <span>{trigger?.labelHe}</span>
            <span>·</span>
            <span>{timingLabel(form)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {eventDirty && (
            <button type="button" onClick={saveEvent} disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'שומר…' : 'שמור שינויים'}
            </button>
          )}
          {event.status !== 'active' ? (
            <button type="button" onClick={() => eventAction('activate')}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-700">
              הפעל אירוע
            </button>
          ) : (
            <button type="button" onClick={() => eventAction('disable')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
              השבת אירוע
            </button>
          )}
          <button type="button" onClick={() => navigate('/admin/settings/communication')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-600 hover:bg-gray-50">
            חזרה לרשימה
          </button>
        </div>
      </div>

      {event.activationErrors?.length > 0 && event.status !== 'active' && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <div className="font-semibold">להפעלת האירוע נדרש:</div>
          <ul className="mt-1 list-inside list-disc">{event.activationErrors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {/* event settings */}
      <div className={`${card} mb-6 p-5`}>
        <h2 className="mb-4 text-[15px] font-bold text-gray-900">הגדרות האירוע</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label className={label12}>שם פנימי</label>
              <input type="text" value={form.internalName} onChange={(e) => patchEvent({ internalName: e.target.value })}
                className={`${inputCls} mt-1 w-full`} />
            </div>
            <div>
              <label className={label12}>תיאור קצר</label>
              <input type="text" value={form.description || ''} onChange={(e) => patchEvent({ description: e.target.value })}
                className={`${inputCls} mt-1 w-full`} placeholder="למה האירוע הזה קיים…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label12}>טריגר</label>
                <select value={form.triggerType}
                  onChange={(e) => {
                    const next = meta.triggers.find((t) => t.type === e.target.value);
                    const anchors = next?.anchors || ['trigger_time'];
                    patchEvent({
                      triggerType: e.target.value,
                      anchorType: anchors.includes(form.anchorType) ? form.anchorType : 'trigger_time',
                    });
                  }}
                  className={`${selectCls} mt-1 w-full`}>
                  {meta.triggers.map((t) => <option key={t.type} value={t.type}>{t.labelHe}</option>)}
                </select>
              </div>
              <div>
                <label className={label12}>עוגן זמן</label>
                <select value={form.anchorType} onChange={(e) => patchEvent({ anchorType: e.target.value })}
                  className={`${selectCls} mt-1 w-full`}>
                  {(trigger?.anchors || ['trigger_time']).map((a) => (
                    <option key={a} value={a}>{a === 'trigger_time' ? 'רגע האירוע' : 'מועד הסיור'}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={label12}>תזמון</label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <select
                  value={form.timingMode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    // "לפני" is only meaningful relative to the tour anchor —
                    // auto-switch when the trigger supports it, otherwise the
                    // inline validation below explains what to change.
                    if (mode === 'before' && form.anchorType !== 'tour_datetime' && tourAnchorSupported) {
                      patchEvent({ timingMode: 'before', anchorType: 'tour_datetime' });
                    } else {
                      patchEvent({ timingMode: mode });
                    }
                  }}
                  className={selectCls}>
                  <option value="immediate">מיידי</option>
                  <option value="before">לפני</option>
                  <option value="after">אחרי</option>
                </select>
                {form.timingMode !== 'immediate' && (
                  <>
                    <input type="number" min={1} value={form.timingAmount || ''} onChange={(e) => patchEvent({ timingAmount: Number(e.target.value) || null })}
                      className={`${inputCls} w-20`} />
                    <select value={form.timingUnit || ''} onChange={(e) => patchEvent({ timingUnit: e.target.value })} className={selectCls}>
                      <option value="" disabled>יחידה…</option>
                      <option value="minutes">דקות</option>
                      <option value="hours">שעות</option>
                      <option value="days">ימים</option>
                      <option value="weeks">שבועות</option>
                      <option value="months">חודשים</option>
                    </select>
                    <span className="text-[12px] text-gray-500">
                      {form.timingMode === 'before' ? 'לפני מועד הסיור' : form.anchorType === 'tour_datetime' ? 'אחרי מועד הסיור' : 'אחרי האירוע'}
                    </span>
                  </>
                )}
              </div>
              {beforeInvalid && (
                <p className="mt-1 text-[12px] font-medium text-red-600">
                  "לפני" אפשרי רק ביחס למועד הסיור{tourAnchorSupported
                    ? ' — בחרו עוגן זמן "מועד הסיור".'
                    : ' — הטריגר שנבחר אינו כולל מועד סיור, בחרו "מיידי" או "אחרי".'}
                </p>
              )}
              {form.timingMode === 'before' && !beforeInvalid && (
                <p className="mt-1 text-[11.5px] text-gray-400">
                  המועד המחושב המדויק מוצג בסימולטור עבור כל דיל/הקשר.
                </p>
              )}
            </div>
          </div>

          {/* applicability */}
          <div className="space-y-3">
            <div>
              <label className={label12}>סוגי פעילות</label>
              <div className="mt-1 flex items-center gap-2">
                <select value={form.activityMode} onChange={(e) => patchEvent({ activityMode: e.target.value })} className={selectCls}>
                  <option value="all">כל הסוגים</option>
                  <option value="include">רק הסוגים שנבחרו</option>
                  <option value="exclude">כל הסוגים חוץ מהנבחרים</option>
                </select>
                {form.activityMode !== 'all' && (
                  <div className="flex gap-1.5">
                    {meta.activityTypes.map((t) => {
                      const on = form.activityTypes.includes(t);
                      return (
                        <button key={t} type="button"
                          onClick={() => patchEvent({ activityTypes: on ? form.activityTypes.filter((x) => x !== t) : [...form.activityTypes, t] })}
                          className={`rounded-full px-3 py-1 text-[12px] font-medium ring-1 transition-colors ${
                            on ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50'
                          }`}>
                          {ACTIVITY_LABELS[t]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            {businessRelevant && (
              <div className="grid grid-cols-2 gap-3">
                <MultiPick label="סוגי ארגון (עסקי)" options={meta.orgTypes.map((t) => ({ id: t.id, label: t.label }))}
                  value={form.orgTypeIds} onChange={(v) => patchEvent({ orgTypeIds: v })} emptyLabel="כל הסוגים" />
                <MultiPick label="תת-סוגי ארגון" options={meta.orgSubtypes.map((t) => ({ id: t.id, label: t.label }))}
                  value={form.orgSubtypeIds} onChange={(v) => patchEvent({ orgSubtypeIds: v })} emptyLabel="כל תת-הסוגים" />
              </div>
            )}
            <ConditionsEditor meta={meta} conditions={form.conditions || []} onChange={(c) => patchEvent({ conditions: c })} />
          </div>
        </div>
      </div>

      {/* messages */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-gray-900">מסרים באירוע ({event.messages.length})</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => addMessage('whatsapp')}
            className="rounded-lg bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-700">
            + מסר WhatsApp
          </button>
          <button type="button" onClick={() => addMessage('email')}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700">
            + מסר מייל
          </button>
        </div>
      </div>

      {event.messages.length === 0 ? (
        <div className={`${card} px-6 py-12 text-center`}>
          <div className="text-3xl">📭</div>
          <div className="mt-2 text-[14px] font-medium text-gray-700">עדיין אין מסרים באירוע</div>
          <div className="mt-1 text-[12.5px] text-gray-500">הוסיפו מסר WhatsApp או מייל — כל מסר מקבל מספר קבוע (#) ומוגדר בנפרד.</div>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[260px,minmax(0,1fr)] 2xl:grid-cols-[260px,minmax(0,1fr),400px]">
          {/* message rail */}
          <div className={`${card} sticky top-4 overflow-hidden`}>
            {event.messages.map((m) => (
              <button key={m.id} type="button" onClick={() => setSelectedMessageId(m.id)}
                className={`block w-full border-b border-gray-100 px-3.5 py-3 text-right transition-colors last:border-0 ${
                  m.id === selectedMessageId ? 'bg-blue-50/70' : 'hover:bg-gray-50'
                }`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold text-gray-400">#{m.publicNumber}</span>
                  <ChannelBadge channel={m.channel} />
                  <StatusChip status={m.status} small />
                </div>
                <div className="mt-1 truncate text-[13px] font-medium text-gray-800">
                  {m.internalName || `${CHANNEL_LABELS[m.channel]} — ${AUDIENCE_LABELS[m.audienceType] || ''}`}
                </div>
                {m.validationErrors?.length > 0 && (
                  <div className="mt-0.5 text-[11px] text-amber-600">⚠ {m.validationErrors.length} דברים להשלמה</div>
                )}
              </button>
            ))}
          </div>

          {selectedMessage && (
            <MessageEditor
              key={selectedMessage.id}
              meta={meta}
              event={event}
              message={selectedMessage}
              onChanged={load}
              onConfirm={setConfirm}
              onDraftChange={setSimDraft}
              onOpenTest={() => setTestCtx({})}
            />
          )}

          {/* simulator — third column on wide desktops (the previously unused
              left side in RTL), stacked below the editor on narrower screens */}
          {selectedMessage && (
            <div className="2xl:sticky 2xl:top-4">
              <SimulatorPanel
                meta={meta}
                message={selectedMessage}
                draft={simDraft}
                onOpenTest={(ctx) => setTestCtx(ctx || {})}
              />
            </div>
          )}
        </div>
      )}

      {testCtx && selectedMessage && (
        <TestSendDialog
          message={selectedMessage}
          meta={meta}
          draft={simDraft}
          initialContext={testCtx}
          onClose={() => setTestCtx(null)}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.message}
        confirmLabel={confirm?.confirmLabel || 'אישור'}
        danger={confirm?.danger}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { confirm?.action?.(); setConfirm(null); }}
      />
    </div>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────────

function MultiPick({ label, options, value, onChange, emptyLabel }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <label className={label12}>{label}</label>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={`${inputCls} mt-1 w-full text-right ${value.length ? 'text-gray-900' : 'text-gray-400'}`}>
        {value.length ? `${value.length} נבחרו` : emptyLabel}
      </button>
      {open && (
        <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1.5 shadow-sm">
          {options.map((o) => {
            const on = value.includes(o.id);
            return (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-gray-50">
                <input type="checkbox" checked={on}
                  onChange={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} />
                {o.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

const OP_LABELS = {
  eq: 'שווה ל־', neq: 'שונה מ־', any_of: 'אחד מ־', none_of: 'אף אחד מ־', exists: 'קיים', not_exists: 'לא קיים',
};

function ConditionsEditor({ meta, conditions, onChange }) {
  const refOptions = (ref) => {
    if (ref === 'product') return meta.products.map((p) => ({ id: p.id, label: p.nameHe }));
    if (ref === 'productVariant') return meta.variants;
    if (ref === 'location') return meta.locations.map((l) => ({ id: l.id, label: l.nameHe }));
    if (ref === 'dealSource') return meta.dealSources.map((s) => ({ id: s.id, label: s.label }));
    if (ref === 'tourLanguage') return [['he', 'עברית'], ['en', 'אנגלית'], ['es', 'ספרדית'], ['fr', 'צרפתית'], ['ru', 'רוסית']].map(([id, label]) => ({ id, label }));
    if (ref === 'language') return [['he', 'עברית'], ['en', 'אנגלית']].map(([id, label]) => ({ id, label }));
    if (ref === 'paymentStatus') return [['no_amount', 'ללא סכום'], ['unpaid', 'לא שולם'], ['partial', 'שולם חלקית'], ['paid', 'שולם במלואו']].map(([id, label]) => ({ id, label }));
    return null;
  };
  const update = (i, patch) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div>
      <label className={label12}>תנאים נוספים</label>
      <div className="mt-1 space-y-2">
        {conditions.map((c, i) => {
          const field = meta.conditionFields.find((f) => f.key === c.field);
          const opts = field ? refOptions(field.ref) : null;
          const valueOps = field?.ref === 'flag' ? ['exists', 'not_exists'] : meta.conditionOps;
          const needsValues = !['exists', 'not_exists'].includes(c.op);
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
              <select value={c.field} onChange={(e) => update(i, { field: e.target.value, op: 'eq', values: [] })} className={selectCls}>
                {meta.conditionFields.map((f) => <option key={f.key} value={f.key}>{f.labelHe}</option>)}
              </select>
              <select value={c.op} onChange={(e) => update(i, { op: e.target.value })} className={selectCls}>
                {valueOps.map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
              </select>
              {needsValues && (opts ? (
                <div className="flex flex-wrap gap-1">
                  {opts.map((o) => {
                    const on = (c.values || []).map(String).includes(String(o.id));
                    return (
                      <button key={o.id} type="button"
                        onClick={() => update(i, {
                          values: on ? (c.values || []).filter((v) => String(v) !== String(o.id)) : [...(c.values || []), o.id],
                        })}
                        className={`rounded-full px-2.5 py-0.5 text-[11.5px] ring-1 ${on ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-gray-600 ring-gray-300'}`}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input type="text" value={(c.values || [])[0] ?? ''} onChange={(e) => update(i, { values: [e.target.value] })}
                  className={`${inputCls} w-28`} />
              ))}
              <button type="button" onClick={() => onChange(conditions.filter((_, j) => j !== i))}
                className="mr-auto rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" title="הסר תנאי">✕</button>
            </div>
          );
        })}
        <button type="button"
          onClick={() => onChange([...conditions, { field: meta.conditionFields[0].key, op: 'eq', values: [] }])}
          className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-[12.5px] text-gray-500 hover:border-blue-300 hover:text-blue-600">
          + הוסף תנאי
        </button>
      </div>
    </div>
  );
}

// ── message editor ───────────────────────────────────────────────────────────

function MessageEditor({ meta, event, message, onChanged, onConfirm, onDraftChange, onOpenTest }) {
  const [form, setForm] = useState(() => toForm(message));
  const [savedForm, setSavedForm] = useState(() => toForm(message));
  const [lang, setLang] = useState('he');
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [validationErrors, setValidationErrors] = useState(message.validationErrors || []);
  const [dialog, setDialog] = useState(null); // 'versions' | 'docs'

  const dirty = !valuesEqual(form, savedForm);
  useDirtyWhen(form, savedForm);

  // Feed the simulator the CURRENT (possibly unsaved) draft — it simulates
  // live via draftOverride without persisting anything.
  useEffect(() => {
    onDraftChange?.({ draftContent: form.draftContent, attachments: form.attachments });
  }, [form.draftContent, form.attachments]); // eslint-disable-line react-hooks/exhaustive-deps

  function toForm(m) {
    return {
      internalName: m.internalName || '',
      audienceType: m.audienceType,
      audienceContactId: m.audienceContactId,
      audienceContactLabel: m.audienceContactLabel || null,
      audiencePersonRefId: m.audiencePersonRefId,
      audiencePersonLabel: m.audiencePersonLabel || null,
      waAccountId: m.waAccountId,
      waDestinationType: m.waDestinationType || (m.channel === 'whatsapp' ? 'private' : null),
      waGroupChatId: m.waGroupChatId,
      waGroupLabel: m.waGroupLabel || null,
      windowEnabled: !!m.windowEnabled,
      sendingWindowId: m.sendingWindowId,
      languagePolicy: m.languagePolicy,
      fallbackLanguage: m.fallbackLanguage,
      attachments: m.attachments || [],
      draftContent: m.draftContent || { he: { subject: '', body: '' }, en: { subject: '', body: '' }, enState: null },
    };
  }
  const patch = (p) => setForm((f) => ({ ...f, ...p }));
  const patchContent = (l, p) => setForm((f) => ({
    ...f,
    draftContent: { ...f.draftContent, [l]: { ...(f.draftContent?.[l] || {}), ...p } },
  }));

  async function save() {
    setSaving(true);
    try {
      const updated = await api.communication.updateMessage(message.id, {
        internalName: form.internalName || null,
        audienceType: form.audienceType,
        audienceContactId: form.audienceContactId,
        audiencePersonRefId: form.audiencePersonRefId,
        waAccountId: form.waAccountId,
        waDestinationType: form.waDestinationType,
        waGroupChatId: form.waGroupChatId,
        windowEnabled: form.windowEnabled,
        sendingWindowId: form.sendingWindowId,
        languagePolicy: form.languagePolicy,
        fallbackLanguage: form.fallbackLanguage,
        attachments: form.attachments,
        draftContent: form.draftContent,
      });
      setValidationErrors(updated.validationErrors || []);
      setSavedForm({ ...form });
      onChanged();
      return true;
    } catch (err) {
      alert(`שמירה נכשלה: ${err?.payload?.error || err.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (dirty && !(await save())) return;
    try {
      await api.communication.publishMessage(message.id);
      onChanged();
    } catch (err) {
      const errors = err?.payload?.errors;
      alert(errors?.length ? `לא ניתן לפרסם:\n• ${errors.join('\n• ')}` : `פרסום נכשל: ${err?.payload?.error || err.message}`);
    }
  }

  async function translate() {
    const run = async () => {
      setTranslating(true);
      try {
        if (dirty && !(await save())) return;
        const updated = await api.communication.translate(message.id, {});
        setForm((f) => ({ ...f, draftContent: updated.draftContent }));
        setSavedForm((f) => ({ ...f, draftContent: updated.draftContent }));
        setLang('en');
        onChanged();
      } catch (err) {
        const code = err?.payload?.error;
        alert(code === 'translation_not_configured'
          ? 'תרגום AI אינו מוגדר (חסר ANTHROPIC_API_KEY בסביבת השרת).'
          : code === 'translation_tokens_changed'
            ? 'התרגום שינה משתנים ולכן נדחה — נסו שוב.'
            : `תרגום נכשל: ${code || err.message}`);
      } finally {
        setTranslating(false);
      }
    };
    const hasEn = !!String(form.draftContent?.en?.body || '').replace(/<[^>]*>/g, '').trim();
    const manualEn = hasEn && form.draftContent?.enState !== 'ai_draft';
    if (hasEn) {
      onConfirm({
        title: 'יצירת גרסה באנגלית',
        message: manualEn
          ? 'קיימת כבר גרסה אנגלית שנערכה ידנית. יצירה מחדש תחליף אותה. להמשיך?'
          : 'קיימת טיוטת AI קודמת. יצירה מחדש תחליף אותה (כולל עריכות ידניות שנעשו בה). להמשיך?',
        confirmLabel: 'צור מחדש',
        danger: true,
        action: run,
      });
    } else {
      run();
    }
  }

  const isWa = message.channel === 'whatsapp';
  const content = form.draftContent?.[lang] || {};
  const waAccount = meta.waAccounts.find((a) => a.id === form.waAccountId) || null;
  const activeWindow = meta.windows.find((w) => w.id === form.sendingWindowId) || null;

  const audienceOptions = [
    { id: 'primary_contact', label: AUDIENCE_LABELS.primary_contact, subtitle: 'איש הקשר הראשי של הדיל / ההזמנה' },
    { id: 'field_contact', label: AUDIENCE_LABELS.field_contact, subtitle: 'איש הקשר בתפקיד "נציג בשטח"' },
    ...(event.anchorType === 'tour_datetime' || (meta.triggers.find((t) => t.type === event.triggerType)?.contexts || []).includes('tour')
      ? [{ id: 'assigned_guides', label: AUDIENCE_LABELS.assigned_guides, subtitle: 'משלוח נפרד לכל מדריך משובץ' }]
      : []),
    { id: 'explicit_contact', label: AUDIENCE_LABELS.explicit_contact, subtitle: 'בחירת איש קשר קבוע' },
    { id: 'explicit_staff', label: AUDIENCE_LABELS.explicit_staff, subtitle: 'בחירת איש צוות קבוע' },
  ];

  const enState = form.draftContent?.enState;

  return (
    <div className="space-y-4">
      {/* message header */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-gray-900 px-2.5 py-1 font-mono text-[14px] font-bold text-white">#{message.publicNumber}</span>
          <ChannelBadge channel={message.channel} large />
          <StatusChip status={message.status} />
          {message.publishedVersionId ? (
            <span className="text-[11.5px] text-gray-400">פורסם{dirty || !valuesEqual(form.draftContent, savedForm.draftContent) ? ' · יש שינויים שלא פורסמו' : ''}</span>
          ) : (
            <span className="text-[11.5px] text-gray-400">טרם פורסם</span>
          )}
          <input
            type="text" value={form.internalName} onChange={(e) => patch({ internalName: e.target.value })}
            placeholder="שם פנימי למסר (למשל: וואטסאפ ללקוח על סגירה)"
            className={`${inputCls} min-w-[220px] flex-1`}
          />
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => onOpenTest?.()}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50">
              שלח אליי בדיקה
            </button>
            <button type="button" onClick={() => setDialog('versions')}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50">
              היסטוריית גרסאות
            </button>
            <MessageKebab message={message} onChanged={onChanged} onConfirm={onConfirm} />
          </div>
        </div>
        {validationErrors.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <span className="font-semibold">להשלמה לפני פרסום: </span>
            {validationErrors.join(' · ')}
          </div>
        )}
      </div>

      {/* recipient + sender config */}
      <div className={`${card} p-4`}>
        <h3 className="mb-3 text-[13.5px] font-bold text-gray-900">{isWa ? 'שולח ונמען' : 'נמען'}</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isWa && (
            <div>
              <label className={label12}>חשבון WhatsApp שולח</label>
              <div className="mt-1">
                <SearchSelect
                  value={waAccount ? {
                    id: waAccount.id,
                    label: waAccount.label,
                    subtitle: waAccount.status === 'connected' ? 'מחובר' : `סטטוס: ${waAccount.status}`,
                  } : null}
                  onSelect={(item) => patch({ waAccountId: item?.id || null, waGroupChatId: null, waGroupLabel: null })}
                  search={async (q) => meta.waAccounts
                    .filter((a) => !q || a.label.includes(q) || a.id.includes(q))
                    .map((a) => ({
                      id: a.id,
                      label: a.label,
                      icon: '📱',
                      subtitle: a.status === 'connected' ? 'מחובר' : `סטטוס: ${a.status}`,
                      disabled: a.active === false,
                      disabledReason: 'חשבון מושבת',
                    }))}
                  placeholder="בחרו חשבון שולח…"
                />
              </div>
            </div>
          )}
          {isWa && (
            <div>
              <label className={label12}>סוג יעד</label>
              <div className="mt-1 flex gap-1.5">
                {[['private', 'שיחה פרטית', '👤'], ['group', 'קבוצת WhatsApp', '👥']].map(([v, l, icon]) => (
                  <button key={v} type="button"
                    onClick={() => patch({ waDestinationType: v })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
                      form.waDestinationType === v
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                    }`}>
                    {icon} {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isWa && form.waDestinationType === 'group' ? (
            <div>
              <label className={label12}>קבוצת WhatsApp</label>
              <div className="mt-1">
                <SearchSelect
                  value={form.waGroupChatId ? { id: form.waGroupChatId, label: form.waGroupLabel || savedGroupLabel(message, form) || 'קבוצה נבחרה' } : null}
                  onSelect={(item) => patch({ waGroupChatId: item?.id || null, waGroupLabel: item?.label || null })}
                  search={async (q) => {
                    const rows = await api.communication.waGroups({ q, accountId: form.waAccountId || undefined });
                    return rows.map((g) => ({
                      id: g.id, label: g.subject, avatar: g.avatar,
                      subtitle: `${g.accountLabel}${g.lastMessageAt ? ` · פעילות אחרונה ${new Date(g.lastMessageAt).toLocaleDateString('he-IL')}` : ''}`,
                    }));
                  }}
                  placeholder={form.waAccountId ? 'חיפוש קבוצה…' : 'בחרו קודם חשבון שולח'}
                  disabled={!form.waAccountId}
                />
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className={label12}>מקור הנמען</label>
                <div className="mt-1">
                  <SearchSelect
                    value={audienceOptions.find((o) => o.id === form.audienceType) || null}
                    onSelect={(item) => item && patch({ audienceType: item.id, audienceContactId: null, audiencePersonRefId: null })}
                    search={async (q) => audienceOptions.filter((o) => !q || o.label.includes(q))}
                    placeholder="בחרו נמען…"
                  />
                </div>
              </div>
              {form.audienceType === 'explicit_contact' && (
                <div>
                  <label className={label12}>איש קשר</label>
                  <div className="mt-1">
                    <SearchSelect
                      value={form.audienceContactId ? { id: form.audienceContactId, label: form.audienceContactLabel || 'איש קשר נבחר' } : null}
                      onSelect={(item) => patch({ audienceContactId: item?.id || null, audienceContactLabel: item?.label || null })}
                      search={async (q) => {
                        if (!q.trim()) return [];
                        const rows = await api.communication.contactsSearch(q);
                        return rows.map((c) => ({ id: c.id, label: c.name, subtitle: [c.phone, c.email].filter(Boolean).join(' · ') }));
                      }}
                      placeholder="חיפוש לפי שם / טלפון / מייל…"
                      emptySearch={false}
                    />
                  </div>
                </div>
              )}
              {form.audienceType === 'explicit_staff' && (
                <div>
                  <label className={label12}>איש צוות</label>
                  <div className="mt-1">
                    <SearchSelect
                      value={form.audiencePersonRefId ? { id: form.audiencePersonRefId, label: form.audiencePersonLabel || 'איש צוות נבחר' } : null}
                      onSelect={(item) => patch({ audiencePersonRefId: item?.id || null, audiencePersonLabel: item?.label || null })}
                      search={async (q) => {
                        const rows = await api.communication.staffSearch(q);
                        return rows.map((p) => ({ id: p.id, label: p.name, subtitle: [p.phone, p.email].filter(Boolean).join(' · ') }));
                      }}
                      placeholder="חיפוש איש צוות…"
                    />
                  </div>
                </div>
              )}
              {form.audienceType === 'assigned_guides' && (
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-[12px] text-blue-800 self-end">
                  ייווצר משלוח נפרד לכל מדריך המשובץ לסיור.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* language + content */}
      <div className={`${card} p-4`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-[13.5px] font-bold text-gray-900">תוכן</h3>
            <div className="flex overflow-hidden rounded-lg border border-gray-200">
              {['he', 'en'].map((l) => {
                const has = !!String(form.draftContent?.[l]?.body || '').replace(/<[^>]*>/g, '').trim();
                return (
                  <button key={l} type="button" onClick={() => setLang(l)}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium ${
                      lang === l ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}>
                    {l === 'he' ? 'עברית' : 'English'}
                    <span className={`h-1.5 w-1.5 rounded-full ${has ? (l === 'en' && enState === 'ai_draft' ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-gray-300'}`} />
                  </button>
                );
              })}
            </div>
            <select value={form.languagePolicy} onChange={(e) => patch({ languagePolicy: e.target.value })} className={selectCls}>
              <option value="auto">שפה לפי הנמען</option>
              <option value="he_only">עברית בלבד</option>
              <option value="en_only">אנגלית בלבד</option>
            </select>
            {form.languagePolicy === 'auto' && (
              <select value={form.fallbackLanguage} onChange={(e) => patch({ fallbackLanguage: e.target.value })} className={selectCls}>
                <option value="he">ברירת מחדל: עברית</option>
                <option value="en">ברירת מחדל: אנגלית</option>
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lang === 'en' && enState === 'ai_draft' && (
              <>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11.5px] font-semibold text-amber-800 ring-1 ring-amber-200">
                  ✨ נוצר על-ידי AI — ממתין לאישור
                </span>
                <button type="button"
                  onClick={() => patch({ draftContent: { ...form.draftContent, enState: 'reviewed' } })}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700">
                  אושר לאחר בדיקה
                </button>
              </>
            )}
            <button type="button" onClick={translate} disabled={translating || !meta.translationConfigured}
              className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[12.5px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50">
              {translating ? 'מתרגם…' : '✨ צור גרסה באנגלית'}
            </button>
          </div>
        </div>

        {!meta.translationConfigured && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <span className="font-semibold">תרגום ה-AI אינו מוגדר בסביבה.</span>{' '}
            כדי להפעיל את "✨ צור גרסה באנגלית" יש להוסיף את משתנה הסביבה{' '}
            <code className="rounded bg-amber-100 px-1 font-mono text-[11px]" dir="ltr">ANTHROPIC_API_KEY</code>{' '}
            לשירות <span className="font-medium" dir="ltr">Grafitiyul-OS</span> ב-Railway. שאר עורך התוכן פועל כרגיל.
          </div>
        )}

        <div dir={lang === 'en' ? 'ltr' : 'rtl'}>
          {isWa ? (
            <WhatsAppBodyEditor
              key={lang}
              value={content.body || ''}
              onChange={(html) => patchContent(lang, { body: html })}
              variables={meta.variables}
              categories={meta.variableCategories}
              onInsertDocument={() => setDialog('docs')}
              documents={(form.attachments || []).map((a) => ({ ...a, labelHe: meta.documentKinds.find((k) => k.kind === a.kind)?.labelHe || a.kind }))}
            />
          ) : (
            <EmailBodyEditor
              key={lang}
              subject={content.subject || ''}
              body={content.body || ''}
              onSubjectChange={(v) => patchContent(lang, { subject: v })}
              onBodyChange={(v) => patchContent(lang, { body: v })}
              variables={meta.variables}
              categories={meta.variableCategories}
              onInsertDocument={() => setDialog('docs')}
            />
          )}
        </div>

        {/* attachments summary */}
        {(form.attachments || []).length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-gray-500">מסמכים:</span>
            {form.attachments.map((a) => {
              const kind = meta.documentKinds.find((k) => k.kind === a.kind);
              return (
                <span key={a.kind} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-[12px] text-gray-700 ring-1 ring-gray-200">
                  📄 {kind?.labelHe || a.kind}
                  <span className="text-gray-400">({a.mode === 'link' ? 'קישור' : a.mode === 'both' ? 'צירוף + קישור' : 'צירוף'})</span>
                  <button type="button" onClick={() => patch({ attachments: form.attachments.filter((x) => x.kind !== a.kind) })}
                    className="text-gray-400 hover:text-red-600">✕</button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* sending window + save/publish */}
      <div className={`${card} flex flex-wrap items-center gap-4 p-4`}>
        <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-medium text-gray-800">
          <input type="checkbox" checked={form.windowEnabled}
            onChange={(e) => patch({ windowEnabled: e.target.checked })} className="h-4 w-4" />
          כפוף לחלון שליחה
        </label>
        {form.windowEnabled && (
          <div className="w-64">
            <SearchSelect
              value={activeWindow ? { id: activeWindow.id, label: activeWindow.name } : null}
              onSelect={(item) => patch({ sendingWindowId: item?.id || null })}
              search={async (q) => meta.windows.filter((w) => !q || w.name.includes(q)).map((w) => ({ id: w.id, label: w.name, icon: '🕐' }))}
              placeholder="בחרו חלון שליחה…"
            />
          </div>
        )}
        {!form.windowEnabled && (
          <span className="text-[12px] text-gray-400">המסר יישלח מיד במועד המחושב (חסימות גלובליות עדיין חלות).</span>
        )}
        <div className="mr-auto flex items-center gap-2">
          <button type="button" onClick={save} disabled={saving || !dirty}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            {saving ? 'שומר…' : 'שמור טיוטה'}
          </button>
          <button type="button" onClick={publish}
            className="rounded-lg bg-blue-600 px-5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-blue-700">
            {message.publishedVersionId ? 'פרסם גרסה חדשה' : 'פרסם'}
          </button>
        </div>
      </div>

      {dialog === 'docs' && (
        <DocumentsDialog
          meta={meta} attachments={form.attachments || []}
          onChange={(a) => patch({ attachments: a })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'versions' && (
        <VersionsDialog message={message} onRestored={onChanged} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function savedGroupLabel() { return null; }

function MessageKebab({ message, onChanged, onConfirm }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const act = async (fn) => { setOpen(false); await fn(); onChanged(); };
  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[13px] text-gray-500 hover:bg-gray-50">⋯</button>
      {open && (
        <div dir="rtl" className="absolute left-0 top-full z-30 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          <button type="button" onClick={() => act(() => api.communication.messageAction(message.id, 'duplicate'))}
            className="block w-full px-3.5 py-2 text-right text-[13px] text-gray-700 hover:bg-gray-50">שכפל מסר (מספר חדש)</button>
          {message.status !== 'disabled' && message.publishedVersionId && (
            <button type="button" onClick={() => act(() => api.communication.messageAction(message.id, 'disable'))}
              className="block w-full px-3.5 py-2 text-right text-[13px] text-gray-700 hover:bg-gray-50">השבת</button>
          )}
          {message.status === 'disabled' && (
            <button type="button" onClick={() => act(() => api.communication.messageAction(message.id, 'enable'))}
              className="block w-full px-3.5 py-2 text-right text-[13px] text-gray-700 hover:bg-gray-50">הפעל מחדש</button>
          )}
          {!message.publishedVersionId && (
            <button type="button"
              onClick={() => {
                setOpen(false);
                onConfirm({
                  title: 'מחיקת טיוטה',
                  message: `למחוק את מסר #${message.publicNumber}? פעולה זו אפשרית רק לטיוטה שלא פורסמה.`,
                  confirmLabel: 'מחק',
                  danger: true,
                  action: async () => { await api.communication.deleteMessage(message.id); onChanged(); },
                });
              }}
              className="block w-full px-3.5 py-2 text-right text-[13px] text-red-600 hover:bg-red-50">מחק טיוטה</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── documents dialog ─────────────────────────────────────────────────────────

function DocumentsDialog({ meta, attachments, onChange, onClose }) {
  return (
    <Dialog open onClose={onClose} title="מסמכים מצורפים" size="md">
      <div dir="rtl" className="space-y-3 p-1">
        <p className="text-[12.5px] leading-relaxed text-gray-500">
          מסמך מצורף מפנה תמיד לקובץ הקנוני הקיים — לעולם לא נוצר PDF חדש עבור ההודעה.
        </p>
        {meta.documentKinds.map((kind) => {
          const current = attachments.find((a) => a.kind === kind.kind) || null;
          return (
            <div key={kind.kind} className="flex items-center gap-3 rounded-xl border border-gray-200 px-3.5 py-3">
              <label className="flex flex-1 cursor-pointer items-center gap-2.5">
                <input type="checkbox" checked={!!current}
                  onChange={(e) => onChange(e.target.checked
                    ? [...attachments, { kind: kind.kind, mode: kind.modes[0] }]
                    : attachments.filter((a) => a.kind !== kind.kind))}
                  className="h-4 w-4" />
                <span>
                  <span className="block text-[13.5px] font-medium text-gray-900">📄 {kind.labelHe}</span>
                  <span className="block text-[11.5px] text-gray-400">
                    {kind.kind === 'reservation_pdf'
                      ? 'ה-PDF הקנוני והקבוע של הזמנת הסוכן (נשלח כקובץ)'
                      : 'קישור להצעת המחיר המופקת (הגרסה הקנונית של הדיל)'}
                  </span>
                </span>
              </label>
              {current && kind.modes.length > 1 && (
                <select value={current.mode}
                  onChange={(e) => onChange(attachments.map((a) => (a.kind === kind.kind ? { ...a, mode: e.target.value } : a)))}
                  className={selectCls}>
                  {kind.modes.includes('attach') && <option value="attach">צירוף קובץ</option>}
                  {kind.modes.includes('link') && <option value="link">קישור</option>}
                  {kind.modes.includes('attach') && kind.modes.includes('link') && <option value="both">קובץ + קישור</option>}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

// ── test-send dialog ─────────────────────────────────────────────────────────
// Sends the CURRENT draft (draftOverride — same content the simulator shows)
// through the real channel adapter, to an explicitly chosen safe destination
// only. Context comes from the simulator (real deal or synthetic fields) or a
// deal picked here; the resolved customer recipient is NEVER used.

function TestSendDialog({ message, meta, draft, initialContext, onClose }) {
  const [deal, setDeal] = useState(null);
  const [lang, setLang] = useState('he');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [testAccount, setTestAccount] = useState(
    message.waAccountId
      ? { id: message.waAccountId, label: meta.waAccounts.find((a) => a.id === message.waAccountId)?.label || message.waAccountId }
      : null,
  );
  const [testGroup, setTestGroup] = useState(null);
  const [mode, setMode] = useState('phone'); // phone | group
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const synthetic = initialContext?.synthetic || null;
  const fixedDealId = initialContext?.dealId || null;

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const body = {
        language: lang,
        draftOverride: draft ? { ...draft.draftContent, attachments: draft.attachments } : undefined,
      };
      if (synthetic) body.synthetic = synthetic;
      else body.dealId = fixedDealId || deal?.id || null;
      if (message.channel === 'whatsapp') {
        body.testAccountId = testAccount?.id || null;
        if (mode === 'group') body.testGroupChatId = testGroup?.id || null;
        else body.testPhone = phone;
      } else {
        body.testEmail = email;
      }
      const r = await api.communication.testSend(message.id, body);
      setResult({ ok: true, destination: r.destination });
    } catch (err) {
      setResult({ ok: false, error: err?.payload?.detail || err?.payload?.error || err.message });
    } finally {
      setSending(false);
    }
  }

  const isWa = message.channel === 'whatsapp';
  const canSend = isWa ? (testAccount && (mode === 'group' ? testGroup : phone.trim())) : email.trim();

  return (
    <Dialog open onClose={onClose} title={`שלח אליי בדיקה — מסר #${message.publicNumber}`} size="md-wide">
      <div dir="rtl" className="space-y-3.5 p-1">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-[12px] text-blue-800">
          הבדיקה נשלחת אך ורק ליעד שתבחרו כאן — לעולם לא לנמען האמיתי. היא מסומנת כבדיקה ולא נרשמת בהיסטוריית הלקוח.
        </div>
        {synthetic ? (
          <div className="rounded-lg bg-violet-50 px-3 py-2 text-[12px] text-violet-800">
            ההקשר: נתוני הבדיקה הסינתטיים מהסימולטור.
          </div>
        ) : fixedDealId ? (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
            ההקשר: הדיל שנבחר בסימולטור (קריאה בלבד).
          </div>
        ) : (
          <div>
            <label className={label12}>הקשר לנתונים (דיל אמיתי, אופציונלי)</label>
            <div className="mt-1"><DealPicker value={deal} onSelect={setDeal} /></div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <label className={label12}>שפה:</label>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className={selectCls}>
            <option value="he">עברית</option>
            <option value="en">English</option>
          </select>
        </div>
        {isWa ? (
          <>
            <div>
              <label className={label12}>חשבון שולח לבדיקה</label>
              <div className="mt-1">
                <SearchSelect
                  value={testAccount}
                  onSelect={setTestAccount}
                  search={async (q) => meta.waAccounts.filter((a) => !q || a.label.includes(q)).map((a) => ({ id: a.id, label: a.label, icon: '📱', subtitle: a.status === 'connected' ? 'מחובר' : a.status }))}
                  placeholder="בחרו חשבון…"
                />
              </div>
            </div>
            <div className="flex gap-1.5">
              {[['phone', 'למספר בדיקה'], ['group', 'לקבוצת בדיקה']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setMode(v)}
                  className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium ${mode === v ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-gray-300 text-gray-600'}`}>
                  {l}
                </button>
              ))}
            </div>
            {mode === 'phone' ? (
              <div>
                <label className={label12}>מספר טלפון לבדיקה</label>
                <input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="050-1234567" className={`${inputCls} mt-1 w-full`} />
              </div>
            ) : (
              <div>
                <label className={label12}>קבוצת בדיקה</label>
                <div className="mt-1">
                  <SearchSelect
                    value={testGroup}
                    onSelect={setTestGroup}
                    search={async (q) => {
                      const rows = await api.communication.waGroups({ q, accountId: testAccount?.id || undefined });
                      return rows.map((g) => ({ id: g.id, label: g.subject, avatar: g.avatar, subtitle: g.accountLabel }));
                    }}
                    placeholder="חיפוש קבוצה…"
                    disabled={!testAccount}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div>
            <label className={label12}>כתובת מייל לבדיקה</label>
            <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="me@example.com" className={`${inputCls} mt-1 w-full`} />
          </div>
        )}
        {result && (
          <div className={`rounded-lg px-3 py-2 text-[13px] ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {result.ok ? `✓ נשלח לבדיקה (${result.destination})` : `שליחת הבדיקה נכשלה: ${result.error}`}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] text-gray-700">סגור</button>
          <button type="button" onClick={send} disabled={sending || !canSend}
            className="rounded-lg bg-blue-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            {sending ? 'שולח…' : '🧪 שלח בדיקה'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}


// ── versions dialog ──────────────────────────────────────────────────────────

function VersionsDialog({ message, onRestored, onClose }) {
  const [versions, setVersions] = useState(null);
  useEffect(() => {
    api.communication.versions(message.id).then(setVersions).catch(() => setVersions([]));
  }, [message.id]);

  async function restore(v) {
    await api.communication.restoreVersion(message.id, v.id);
    onRestored();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={`היסטוריית גרסאות — מסר #${message.publicNumber}`} size="lg">
      <div dir="rtl" className="p-1">
        {!versions && <div className="py-6 text-center text-[13px] text-gray-400">טוען…</div>}
        {versions?.length === 0 && <div className="py-6 text-center text-[13px] text-gray-400">אין עדיין גרסאות שפורסמו.</div>}
        <div className="space-y-2">
          {(versions || []).map((v) => (
            <div key={v.id} className="flex items-center gap-3 rounded-xl border border-gray-200 px-3.5 py-2.5">
              <span className="rounded-lg bg-gray-100 px-2 py-1 font-mono text-[12px] font-bold text-gray-600">v{v.versionNo}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-gray-800">
                  {new Date(v.createdAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {v.note && <span className="text-gray-500"> · {v.note}</span>}
                </div>
                <div className="text-[11.5px] text-gray-400">
                  {['he', 'en'].filter((l) => String(v.content?.[l]?.body || '').trim()).map((l) => (l === 'he' ? 'עברית' : 'אנגלית')).join(' + ') || '—'}
                </div>
              </div>
              {v.isPublished && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">פעילה</span>
              )}
              {!v.isPublished && (
                <button type="button" onClick={() => restore(v)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
                  שחזר כטיוטה
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
