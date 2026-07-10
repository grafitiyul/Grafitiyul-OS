import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { evaluateCondition } from '../../../shared/questionnaire/conditions.mjs';
import { resolveLocalized, isRtl } from '../../../shared/questionnaire/localized.mjs';
import { uiStrings, errorText } from '../../../shared/questionnaire/uiStrings.mjs';
import RichText from '../editor/RichText.jsx';

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
      placeholder={q.placeholderText || ''}
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

function YesNoInput({ value, onChange, s }) {
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
      {btn(true, s.yes)}
      {btn(false, s.no)}
    </div>
  );
}

// Multi-select — a vertical CHECKBOX list (professional-form feel, not tag
// chips). Native <input type="checkbox"> inside a full-row <label> is the GOS
// checkbox idiom (see QuoteLayoutSettings etc.) — no custom checkbox: native
// gives Space-to-toggle keyboard behavior and screen-reader checkbox
// semantics for free. Green accent when checked; text stays normal; only a
// whisper of row highlight. Selection logic/answer model untouched.
function MultiCheckboxList({ q, value, onChange, lang, defLang, s }) {
  const selected = Array.isArray(value) ? value : [];
  const otherToken = selected.find((v) => typeof v === 'string' && v.startsWith(OTHER_PREFIX));
  const otherSelected = otherToken !== undefined;
  const otherText = otherSelected ? otherToken.slice(OTHER_PREFIX.length) : '';

  const toggle = (optValue) => {
    const next = selected.includes(optValue)
      ? selected.filter((v) => v !== optValue)
      : [...selected, optValue];
    onChange(next.length ? next : null);
  };

  const setOther = (text) => {
    const rest = selected.filter((v) => !(typeof v === 'string' && v.startsWith(OTHER_PREFIX)));
    if (text === undefined) return onChange(rest.length ? rest : null);
    return onChange([...rest, `${OTHER_PREFIX}${text}`]);
  };

  const rowCls = (on) =>
    `flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
      on ? 'bg-emerald-50/50' : 'hover:bg-gray-50'
    }`;
  const boxCls = 'h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-emerald-600';

  return (
    <div role="group" aria-label={resolveLocalized(q.label, lang, defLang)} className="space-y-0.5 -mx-3">
      {q.options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <label key={o.id || o.value} className={rowCls(on)}>
            <input
              type="checkbox"
              className={boxCls}
              checked={on}
              onChange={() => toggle(o.value)}
            />
            <span className="text-[14px] text-gray-800">{resolveLocalized(o.label, lang, defLang)}</span>
          </label>
        );
      })}
      {q.config?.allowOther ? (
        <>
          <label className={rowCls(otherSelected)}>
            <input
              type="checkbox"
              className={boxCls}
              checked={otherSelected}
              onChange={() => (otherSelected ? setOther(undefined) : setOther(''))}
            />
            <span className="text-[14px] text-gray-800">{s.other}</span>
          </label>
          {otherSelected ? (
            <div className="px-3 pb-1 ps-9">
              <input
                className={inputCls}
                value={otherText}
                placeholder={s.otherDetail}
                onChange={(e) => setOther(e.target.value)}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// Single-choice pills (choice type only — multi moved to MultiCheckboxList).
function ChoicePills({ q, value, onChange, lang, defLang, s }) {
  const selected = value;
  const otherSelected = typeof selected === 'string' && selected.startsWith(OTHER_PREFIX);
  const otherText = otherSelected ? selected.slice(OTHER_PREFIX.length) : '';

  const toggle = (optValue) => {
    onChange(selected === optValue ? null : optValue);
  };

  const setOther = (text) => {
    onChange(text === undefined ? null : `${OTHER_PREFIX}${text}`);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {q.options.map((o) => {
          const on = selected === o.value;
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
            {s.other}
          </button>
        ) : null}
      </div>
      {otherSelected ? (
        <input
          className={inputCls}
          value={otherText}
          placeholder={s.otherDetail}
          onChange={(e) => setOther(e.target.value)}
        />
      ) : null}
    </div>
  );
}

function DropdownInput({ q, value, onChange, lang, defLang, s }) {
  return (
    <select
      className={inputCls}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">{s.choose}</option>
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

// Upload input (image_upload / file_upload). `uploader(file) → Promise<value>`
// comes from the host surface (staff dialog / public page) so the runtime
// stays transport-agnostic; preview passes none → uploads disabled with note.
function UploadInput({ q, value, onChange, uploader, imageOnly, s }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!uploader) {
    return <div className="text-[12.5px] text-gray-400">העלאת קבצים אינה זמינה בתצוגה מקדימה</div>;
  }
  if (value?.assetId) {
    const isImage = (value.mime || '').startsWith('image/');
    return (
      <div className="flex items-center gap-3">
        {isImage ? (
          <img src={value.url} alt={value.name} className="h-20 w-20 rounded-lg border border-gray-200 object-cover" />
        ) : (
          <a href={value.url} target="_blank" rel="noreferrer noopener" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-blue-700 hover:underline" dir="ltr">
            📎 {value.name}
          </a>
        )}
        <button type="button" onClick={() => onChange(null)} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50">
          ✕ הסרה
        </button>
      </div>
    );
  }
  return (
    <div>
      <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-400 px-4 py-2.5 text-[13px] text-gray-600 hover:bg-gray-50 ${busy ? 'opacity-50' : ''}`}>
        <span aria-hidden>{imageOnly ? '📷' : '📎'}</span>
        {busy ? '…' : imageOnly ? s.uploadImage || 'העלאת תמונה' : s.uploadFile || 'העלאת קובץ'}
        <input
          type="file"
          accept={imageOnly ? 'image/*' : 'image/*,application/pdf'}
          className="hidden"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true);
            setFailed(false);
            try {
              onChange(await uploader(file));
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {failed ? <p className="mt-1 text-[12px] text-red-600">{s.uploadFailed || 'ההעלאה נכשלה'}</p> : null}
    </div>
  );
}

// Drawn signature — canvas pad → PNG data URL (same convention as the public
// quote signing flow). Pointer events cover mouse + touch.
function SignatureInput({ value, onChange, s }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e) => {
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1f2937';
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvasRef.current;
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    onChange(null);
  };

  if (value && typeof value === 'string' && value.startsWith('data:image/png')) {
    return (
      <div className="flex items-center gap-3">
        <img src={value} alt="חתימה" className="h-20 rounded-lg border border-gray-200 bg-white" />
        <button type="button" onClick={clear} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50">
          {s.signAgain || 'חתימה מחדש'}
        </button>
      </div>
    );
  }
  return (
    <div>
      <canvas
        ref={canvasRef}
        width={320}
        height={130}
        className="w-full max-w-[320px] touch-none rounded-lg border border-gray-300 bg-white"
        style={{ touchAction: 'none' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <p className="mt-1 text-[11.5px] text-gray-400">{s.signHere || 'חתמו כאן בעזרת האצבע או העכבר'}</p>
    </div>
  );
}

function QuestionInput({ q, value, onChange, lang, defLang, s, uploader }) {
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
      return <YesNoInput value={value} onChange={onChange} s={s} />;
    case 'choice':
      return <ChoicePills q={q} value={value} onChange={onChange} lang={lang} defLang={defLang} s={s} />;
    case 'multi':
      return <MultiCheckboxList q={q} value={value} onChange={onChange} lang={lang} defLang={defLang} s={s} />;
    case 'dropdown':
      return <DropdownInput q={q} value={value} onChange={onChange} lang={lang} defLang={defLang} s={s} />;
    case 'scale':
      return <ScaleInput q={q} value={value} onChange={onChange} />;
    case 'rating':
      return <RatingInput q={q} value={value} onChange={onChange} />;
    case 'slider':
      return <SliderInput q={q} value={value} onChange={onChange} />;
    case 'image_upload':
      return <UploadInput q={q} value={value} onChange={onChange} uploader={uploader} imageOnly s={s} />;
    case 'file_upload':
      return <UploadInput q={q} value={value} onChange={onChange} uploader={uploader} s={s} />;
    case 'signature':
      return <SignatureInput value={value} onChange={onChange} s={s} />;
    default:
      return <div className="text-[13px] text-gray-400">סוג שאלה לא נתמך: {q.type}</div>;
  }
}

// Read-only value rendering (completed submissions / review).
function DisplayValue({ q, value, lang, defLang, s }) {
  if (isEmpty(value)) return <span className="text-gray-400">—</span>;
  const labelOf = (v) => {
    if (typeof v === 'string' && v.startsWith(OTHER_PREFIX)) {
      return `${s.other.replace('…', '')}: ${v.slice(OTHER_PREFIX.length)}`;
    }
    const opt = (q.options || []).find((o) => o.value === v);
    return opt ? resolveLocalized(opt.label, lang, defLang) : String(v);
  };
  if (q.type === 'yesno') return <span>{value ? s.yes : s.no}</span>;
  if (q.type === 'signature' && typeof value === 'string' && value.startsWith('data:image/')) {
    return <img src={value} alt="חתימה" className="h-16 rounded border border-gray-200 bg-white" />;
  }
  if ((q.type === 'image_upload' || q.type === 'file_upload') && value?.assetId) {
    return (value.mime || '').startsWith('image/') ? (
      <img src={value.url} alt={value.name} className="h-20 rounded-lg border border-gray-200 object-cover" />
    ) : (
      <a href={value.url} target="_blank" rel="noreferrer noopener" className="text-blue-700 hover:underline" dir="ltr">
        📎 {value.name}
      </a>
    );
  }
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
  submitLabel,
  busyLabel,
  previewBadge = false,
  uploader = null,
}) {
  const defLang = runtime?.template?.defaultLanguage || 'he';
  const lang = language || defLang;
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  // Named `ui` (not `s`) — the sections .map((s) => …) below would shadow it.
  const ui = uiStrings(lang);
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
    if (server) return errorText(lang, server.code);
    if (clientErrors[key]) return errorText(lang, clientErrors[key]);
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

  // Flat visible steps (question + its section) — powers step-by-step mode
  // and the progress indicator. Conditions may add/remove steps live.
  const flatSteps = useMemo(
    () => visibleSections.flatMap((sec) => sec.questions.map((q) => ({ q, section: sec }))),
    [visibleSections],
  );
  const answerable = flatSteps.filter(({ q }) => q.type !== 'static_text');
  const answeredCount = answerable.filter(({ q }) => !isEmpty(answers[q.key])).length;

  const stepMode = runtime?.version?.displayMode === 'step_by_step' && !readOnly && !!onSubmit;
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    // Visibility changes can shrink the step list — clamp, never crash.
    if (stepIdx > 0 && stepIdx >= flatSteps.length) setStepIdx(Math.max(0, flatSteps.length - 1));
  }, [flatSteps.length, stepIdx]);

  if (!runtime) return null;

  const intro = r(runtime.version?.intro);

  // ONE question renderer for both layouts.
  const renderQuestion = (q) => {
    if (q.type === 'static_text') {
      // Canonical renderer (editor↔display parity invariant) — never a
      // hand-rolled innerHTML with ad-hoc typography classes.
      return <RichText key={q.id || q.key} html={r(q.label)} dir={dir} />;
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
            <DisplayValue q={q} value={answers[q.key]} lang={lang} defLang={defLang} s={ui} />
          </div>
        ) : (
          <QuestionInput q={enriched} value={answers[q.key]} onChange={(v) => setValue(q.key, v)} lang={lang} defLang={defLang} s={ui} uploader={uploader} />
        )}
        {err ? <p className="text-[12px] text-red-600 mt-1">{err}</p> : null}
      </div>
    );
  };

  const progressBar = !readOnly && answerable.length > 0 ? (
    <div>
      <div className="flex items-center justify-between text-[11.5px] text-gray-500">
        <span>{answeredCount} / {answerable.length}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${Math.round((answeredCount / answerable.length) * 100)}%` }}
        />
      </div>
    </div>
  ) : null;

  // ── step-by-step layout: one question per screen, back/next, validated ────
  if (stepMode) {
    const current = flatSteps[Math.min(stepIdx, Math.max(0, flatSteps.length - 1))];
    const isLast = stepIdx >= flatSteps.length - 1;
    const goNext = async () => {
      if (!current) return;
      const { q } = current;
      if (q.type !== 'static_text' && q.required && isEmpty(answers[q.key])) {
        setClientErrors((prev) => ({ ...prev, [q.key]: 'required' }));
        return;
      }
      if (isLast) await handleSubmit();
      else setStepIdx((i) => i + 1);
    };
    return (
      <div ref={rootRef} dir={dir} className="space-y-4">
        {previewBadge ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-800">
            {ui.previewNote}
          </div>
        ) : null}
        {stepIdx === 0 ? <RichText html={intro} dir={dir} /> : null}
        {progressBar}
        {current ? (
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm">
            <div className="px-4 pt-3 pb-2 border-b border-gray-100">
              <h3 className="text-[12.5px] font-medium text-gray-400">{r(current.section.title)}</h3>
            </div>
            <div className="px-4 py-5">{renderQuestion(current.q)}</div>
          </section>
        ) : null}
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={stepIdx === 0 || busy}
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            className="rounded-lg border border-gray-300 px-4 py-2 text-[13.5px] text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {ui.back}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={goNext}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-[14px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLast ? (busy ? (busyLabel || ui.submitting) : (submitLabel || ui.submit)) : ui.next}
          </button>
        </div>
      </div>
    );
  }

  // ── full-list layout ─────────────────────────────────────────────────────
  return (
    <div ref={rootRef} dir={dir} className="space-y-5">
      {previewBadge ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-800">
          {ui.previewNote}
        </div>
      ) : null}

      <RichText html={intro} dir={dir} />

      {progressBar}

      {visibleSections.map((s) => (
        <section key={s.id || s.key} className="bg-white border border-gray-200 rounded-2xl shadow-sm">
          <div className="px-4 pt-3 pb-2 border-b border-gray-100">
            <h3 className="text-[14.5px] font-semibold text-gray-900">{r(s.title)}</h3>
            {r(s.description) ? (
              <p className="text-[12.5px] text-gray-500 mt-0.5">{r(s.description)}</p>
            ) : null}
          </div>
          <div className="px-4 py-3 space-y-4">
            {s.questions.map((q) => renderQuestion(q))}
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
            {busy ? (busyLabel || ui.submitting) : (submitLabel || ui.submit)}
          </button>
        </div>
      ) : null}
    </div>
  );
}
