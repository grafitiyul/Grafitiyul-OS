import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { evaluateCondition } from '../../../shared/questionnaire/conditions.mjs';
import { resolveLocalized, isRtl } from '../../../shared/questionnaire/localized.mjs';

// Questionnaire fill runtime — ONE renderer for every consumer: builder
// preview (Slice 1), staff fill (tour modal), public token fill. Consumers
// differ only in the chrome around it and the onSubmit/onSaveDraft handlers.
//
// Conditional visibility uses the SAME shared evaluator the server validates
// with — the client copy is advisory (live show/hide), the server is binding.
//
// props:
//   runtime      { template, version, sections }  (server runtimePayload)
//   language     display language (fallback chain via resolveLocalized)
//   initialAnswers  { [questionKey]: value } — draft answers + prefill merged
//   readOnly     render answers without inputs (completed view)
//   serverErrors [{ questionKey, code }] from a 422 — rendered inline
//   onChange(answers)          fires on every edit (draft autosave hooks)
//   onSubmit(answers) → Promise  main CTA; absent → no submit button (preview
//                                may still pass a no-op to demo the flow)
//   submitLabel / busyLabel    CTA texts
//   previewBadge boolean       show the "תצוגה מקדימה" ribbon

const OTHER_PREFIX = '__other__:';

// Client-side mirror of the server's required check (UX only).
function isEmpty(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

const ERROR_TEXT = {
  required: 'שדה חובה',
  invalid_type: 'ערך לא תקין',
  invalid_email: 'כתובת אימייל לא תקינה',
  invalid_phone: 'מספר טלפון לא תקין',
  invalid_url: 'כתובת לא תקינה',
  invalid_date: 'תאריך לא תקין',
  invalid_time: 'שעה לא תקינה',
  invalid_datetime: 'תאריך ושעה לא תקינים',
  unknown_option: 'בחירה לא תקינה',
  other_text_required: 'יש למלא טקסט חופשי',
  too_long: 'הטקסט ארוך מדי',
  too_few_selections: 'יש לבחור עוד אפשרויות',
  too_many_selections: 'נבחרו יותר מדי אפשרויות',
  out_of_range: 'ערך מחוץ לטווח',
  below_min: 'ערך נמוך מדי',
  above_max: 'ערך גבוה מדי',
  pattern_mismatch: 'פורמט לא תקין',
  not_integer: 'יש להזין מספר שלם',
};

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 bg-white';

function TextLikeInput({ q, value, onChange, type = 'text', inputMode, dir }) {
  return (
    <input
      type={type}
      inputMode={inputMode}
      dir={dir}
      className={inputCls}
      value={value ?? ''}
      placeholder={q.placeholderText || ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    />
  );
}

function NumberInput({ q, value, onChange }) {
  return (
    <input
      type="number"
      dir="ltr"
      className={`${inputCls} text-left`}
      value={value ?? ''}
      min={q.config?.min}
      max={q.config?.max}
      step={q.config?.integer ? 1 : 'any'}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === '' ? null : Number(raw));
      }}
    />
  );
}

function YesNoInput({ value, onChange }) {
  const btn = (val, label) => (
    <button
      type="button"
      onClick={() => onChange(value === val ? null : val)}
      className={`flex-1 rounded-lg border px-4 py-2.5 text-[14px] font-medium transition-colors ${
        value === val
          ? 'border-blue-500 bg-blue-50 text-blue-700'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-2">
      {btn(true, 'כן')}
      {btn(false, 'לא')}
    </div>
  );
}

function ChoicePills({ q, value, onChange, multi, lang, defLang }) {
  const selected = multi ? (Array.isArray(value) ? value : []) : value;
  const otherSelected = multi
    ? selected.some((v) => typeof v === 'string' && v.startsWith(OTHER_PREFIX))
    : typeof selected === 'string' && selected.startsWith(OTHER_PREFIX);
  const otherText = (() => {
    const v = multi
      ? selected.find((x) => typeof x === 'string' && x.startsWith(OTHER_PREFIX))
      : selected;
    return typeof v === 'string' && v.startsWith(OTHER_PREFIX) ? v.slice(OTHER_PREFIX.length) : '';
  })();

  const toggle = (optValue) => {
    if (multi) {
      const next = selected.includes(optValue)
        ? selected.filter((v) => v !== optValue)
        : [...selected, optValue];
      onChange(next.length ? next : null);
    } else {
      onChange(selected === optValue ? null : optValue);
    }
  };

  const setOther = (text) => {
    const token = `${OTHER_PREFIX}${text}`;
    if (multi) {
      const rest = selected.filter((v) => !(typeof v === 'string' && v.startsWith(OTHER_PREFIX)));
      onChange(text === undefined ? (rest.length ? rest : null) : [...rest, token]);
    } else {
      onChange(text === undefined ? null : token);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {q.options.map((o) => {
          const on = multi ? selected.includes(o.value) : selected === o.value;
          return (
            <button
              key={o.id || o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className={`rounded-full border px-3.5 py-1.5 text-[13.5px] transition-colors ${
                on
                  ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {on ? '✓ ' : ''}{resolveLocalized(o.label, lang, defLang)}
            </button>
          );
        })}
        {q.config?.allowOther ? (
          <button
            type="button"
            onClick={() => (otherSelected ? setOther(undefined) : setOther(''))}
            className={`rounded-full border px-3.5 py-1.5 text-[13.5px] transition-colors ${
              otherSelected
                ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                : 'border-dashed border-gray-400 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            אחר…
          </button>
        ) : null}
      </div>
      {otherSelected ? (
        <input
          className={inputCls}
          value={otherText}
          placeholder="פירוט…"
          onChange={(e) => setOther(e.target.value)}
        />
      ) : null}
    </div>
  );
}

function DropdownInput({ q, value, onChange, lang, defLang }) {
  return (
    <select
      className={inputCls}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">בחירה…</option>
      {q.options.map((o) => (
        <option key={o.id || o.value} value={o.value}>
          {resolveLocalized(o.label, lang, defLang)}
        </option>
      ))}
    </select>
  );
}

function ScaleInput({ q, value, onChange }) {
  const min = Number(q.config?.scaleMin ?? 1);
  const max = Number(q.config?.scaleMax ?? 10);
  const nums = [];
  for (let i = min; i <= max; i += 1) nums.push(i);
  return (
    <div className="flex flex-wrap gap-1.5" dir="ltr">
      {nums.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          className={`h-9 w-9 rounded-full border text-[13px] font-medium transition-colors ${
            value === n
              ? 'border-blue-500 bg-blue-500 text-white'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function RatingInput({ q, value, onChange }) {
  const max = Number(q.config?.ratingMax ?? 5);
  const stars = [];
  for (let i = 1; i <= max; i += 1) stars.push(i);
  return (
    <div className="flex gap-1" dir="ltr">
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          className={`text-2xl leading-none transition-transform hover:scale-110 ${
            value >= n ? 'grayscale-0' : 'grayscale opacity-40'
          }`}
          aria-label={`${n}`}
        >
          ⭐
        </button>
      ))}
    </div>
  );
}

function SliderInput({ q, value, onChange }) {
  const min = Number(q.config?.min ?? 0);
  const max = Number(q.config?.max ?? 100);
  const step = Number(q.config?.step ?? 1);
  const v = typeof value === 'number' ? value : Math.round((min + max) / 2);
  return (
    <div className="space-y-1" dir="ltr">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        className="w-full accent-blue-600"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="text-center text-[13px] font-semibold text-gray-700">
        {typeof value === 'number' ? value : '—'}
      </div>
    </div>
  );
}

function QuestionInput({ q, value, onChange, lang, defLang }) {
  switch (q.type) {
    case 'text':
      return <TextLikeInput q={q} value={value} onChange={onChange} />;
    case 'textarea':
      return (
        <textarea
          className={`${inputCls} min-h-[110px]`}
          value={value ?? ''}
          placeholder={q.placeholderText || ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
    case 'number':
      return <NumberInput q={q} value={value} onChange={onChange} />;
    case 'email':
      return <TextLikeInput q={q} value={value} onChange={onChange} type="email" inputMode="email" dir="ltr" />;
    case 'phone':
      return <TextLikeInput q={q} value={value} onChange={onChange} type="tel" inputMode="tel" dir="ltr" />;
    case 'url':
      return <TextLikeInput q={q} value={value} onChange={onChange} type="url" inputMode="url" dir="ltr" />;
    case 'date':
      return <TextLikeInput q={q} value={value} onChange={onChange} type="date" dir="ltr" />;
    case 'time':
      return <TextLikeInput q={q} value={value} onChange={onChange} type="time" dir="ltr" />;
    case 'datetime':
      return <TextLikeInput q={q} value={value} onChange={onChange} type="datetime-local" dir="ltr" />;
    case 'yesno':
      return <YesNoInput value={value} onChange={onChange} />;
    case 'choice':
      return <ChoicePills q={q} value={value} onChange={onChange} multi={false} lang={lang} defLang={defLang} />;
    case 'multi':
      return <ChoicePills q={q} value={value} onChange={onChange} multi lang={lang} defLang={defLang} />;
    case 'dropdown':
      return <DropdownInput q={q} value={value} onChange={onChange} lang={lang} defLang={defLang} />;
    case 'scale':
      return <ScaleInput q={q} value={value} onChange={onChange} />;
    case 'rating':
      return <RatingInput q={q} value={value} onChange={onChange} />;
    case 'slider':
      return <SliderInput q={q} value={value} onChange={onChange} />;
    default:
      return <div className="text-[13px] text-gray-400">סוג שאלה לא נתמך: {q.type}</div>;
  }
}

// Read-only value rendering (completed submissions / review).
function DisplayValue({ q, value, lang, defLang }) {
  if (isEmpty(value)) return <span className="text-gray-400">—</span>;
  const labelOf = (v) => {
    if (typeof v === 'string' && v.startsWith(OTHER_PREFIX)) return `אחר: ${v.slice(OTHER_PREFIX.length)}`;
    const opt = (q.options || []).find((o) => o.value === v);
    return opt ? resolveLocalized(opt.label, lang, defLang) : String(v);
  };
  if (q.type === 'yesno') return <span>{value ? 'כן' : 'לא'}</span>;
  if (Array.isArray(value)) return <span>{value.map(labelOf).join(', ')}</span>;
  if (q.options?.length) return <span>{labelOf(value)}</span>;
  return <span className="whitespace-pre-wrap">{String(value)}</span>;
}

export default function QuestionnaireRuntime({
  runtime,
  language,
  initialAnswers,
  readOnly = false,
  serverErrors = null,
  onChange,
  onSubmit,
  submitLabel = 'שליחה',
  busyLabel = 'שולח…',
  previewBadge = false,
}) {
  const defLang = runtime?.template?.defaultLanguage || 'he';
  const lang = language || defLang;
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  const [answers, setAnswers] = useState(() => ({ ...(initialAnswers || {}) }));
  const [clientErrors, setClientErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const rootRef = useRef(null);

  // Reset when a different submission/version is loaded into the runtime.
  const identity = `${runtime?.version?.id || ''}`;
  const lastIdentity = useRef(identity);
  useEffect(() => {
    if (lastIdentity.current !== identity) {
      lastIdentity.current = identity;
      setAnswers({ ...(initialAnswers || {}) });
      setClientErrors({});
    }
  }, [identity, initialAnswers]);

  const r = useCallback((map) => resolveLocalized(map, lang, defLang), [lang, defLang]);

  const getAnswer = useCallback((key) => answers[key], [answers]);

  // Live visibility — same shared evaluator the server uses.
  const visibleSections = useMemo(() => {
    const out = [];
    for (const s of runtime?.sections || []) {
      if (!evaluateCondition(s.visibleWhen, getAnswer)) continue;
      const questions = s.questions.filter((q) => evaluateCondition(q.visibleWhen, getAnswer));
      if (questions.length || r(s.description)) out.push({ ...s, questions });
    }
    return out;
  }, [runtime, getAnswer, r]);

  const setValue = (key, value) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === null || value === undefined) delete next[key];
      else next[key] = value;
      onChange?.(next);
      return next;
    });
    setClientErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const errorFor = (key) => {
    const server = (serverErrors || []).find((e) => e.questionKey === key);
    if (server) return ERROR_TEXT[server.code] || 'ערך לא תקין';
    if (clientErrors[key]) return ERROR_TEXT[clientErrors[key]] || 'ערך לא תקין';
    return null;
  };

  const handleSubmit = async () => {
    if (!onSubmit || busy) return;
    // Advisory required check before hitting the server (server re-validates).
    const missing = {};
    for (const s of visibleSections) {
      for (const q of s.questions) {
        if (q.type === 'static_text') continue;
        if (q.required && isEmpty(answers[q.key])) missing[q.key] = 'required';
      }
    }
    if (Object.keys(missing).length) {
      setClientErrors(missing);
      const firstKey = Object.keys(missing)[0];
      rootRef.current?.querySelector(`[data-qkey="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    try {
      await onSubmit(answers);
    } finally {
      setBusy(false);
    }
  };

  if (!runtime) return null;

  const intro = r(runtime.version?.intro);

  return (
    <div ref={rootRef} dir={dir} className="space-y-5">
      {previewBadge ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-800">
          תצוגה מקדימה — התשובות אינן נשמרות
        </div>
      ) : null}

      {intro ? (
        <div
          className="prose prose-sm max-w-none text-[14px] text-gray-700"
          dangerouslySetInnerHTML={{ __html: intro }}
        />
      ) : null}

      {visibleSections.map((s) => (
        <section key={s.id || s.key} className="bg-white border border-gray-200 rounded-2xl shadow-sm">
          <div className="px-4 pt-3 pb-2 border-b border-gray-100">
            <h3 className="text-[14.5px] font-semibold text-gray-900">{r(s.title)}</h3>
            {r(s.description) ? (
              <p className="text-[12.5px] text-gray-500 mt-0.5">{r(s.description)}</p>
            ) : null}
          </div>
          <div className="px-4 py-3 space-y-4">
            {s.questions.map((q) => {
              if (q.type === 'static_text') {
                return (
                  <div
                    key={q.id || q.key}
                    className="prose prose-sm max-w-none text-[13.5px] text-gray-700"
                    dangerouslySetInnerHTML={{ __html: r(q.label) }}
                  />
                );
              }
              const err = errorFor(q.key);
              const enriched = { ...q, placeholderText: r(q.placeholder) };
              return (
                <div key={q.id || q.key} data-qkey={q.key}>
                  <label className="block text-[13.5px] font-medium text-gray-800 mb-1">
                    {r(q.label)}
                    {q.required ? <span className="text-red-500 ms-1">*</span> : null}
                  </label>
                  {r(q.helpText) ? (
                    <p className="text-[12px] text-gray-500 mb-1.5">{r(q.helpText)}</p>
                  ) : null}
                  {readOnly ? (
                    <div className="text-[14px] text-gray-800 py-1">
                      <DisplayValue q={q} value={answers[q.key]} lang={lang} defLang={defLang} />
                    </div>
                  ) : (
                    <QuestionInput q={enriched} value={answers[q.key]} onChange={(v) => setValue(q.key, v)} lang={lang} defLang={defLang} />
                  )}
                  {err ? <p className="text-[12px] text-red-600 mt-1">{err}</p> : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {!readOnly && onSubmit ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={handleSubmit}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-[14px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
