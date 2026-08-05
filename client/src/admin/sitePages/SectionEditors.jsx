import React from 'react';
import RichEditor from '../../editor/RichEditor.jsx';
import TranslateButton from '../common/TranslateButton.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { makeCard, makePricingRow, makePricingLine, PRICING_LINE_KINDS, newId } from '../../../../shared/sitePage.mjs';

// Per-type section editors for "דפי אתר".
//
// One component per section type, all with the same (section, onChange) contract,
// so SitePageEditor renders whatever the shared registry says exists without a
// switch of its own to keep in sync. Adding a section type = a registry entry +
// one component here.

const L = 'block text-sm font-medium text-slate-600 mb-1';
const I =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400';

export function Field({ label, children, hint }) {
  return (
    <div className="mb-3">
      <label className={L}>{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, dir }) {
  return (
    <input
      className={I}
      value={value || ''}
      dir={dir}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * A Hebrew field and its English counterpart side by side, with the shared
 * TranslateButton between them. Bilingual editing is a first-class requirement
 * for this module, so it is ONE component rather than a per-screen pattern.
 */
function Bilingual({ label, he, en, onHe, onEn, rich = false, hint }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <label className={L + ' mb-0'}>{label}</label>
        <TranslateButton
          getSource={() => he || ''}
          getTarget={() => en || ''}
          onResult={(text) => onEn(text)}
          direction="he_to_en"
          format={rich ? 'html' : 'text'}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">עברית</p>
          {rich ? (
            <RichEditor value={he || ''} onChange={onHe} preset="lite" minContentHeight={120} ariaLabel={`${label} עברית`} />
          ) : (
            <TextInput value={he} onChange={onHe} dir="rtl" />
          )}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">English</p>
          {rich ? (
            <RichEditor value={en || ''} onChange={onEn} preset="lite" minContentHeight={120} ariaLabel={`${label} English`} />
          ) : (
            <TextInput value={en} onChange={onEn} dir="ltr" />
          )}
        </div>
      </div>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

const set = (section, onChange, patch) => onChange({ ...section, ...patch });

function ImageField({ value, onChange }) {
  return (
    <Field label="תמונה (כתובת)" hint="כתובת https מלאה. תמונות שיובאו מהאתר הישן מאוחסנות אצלנו ולכן הכתובת יציבה.">
      <TextInput value={value} onChange={onChange} dir="ltr" placeholder="https://…" />
      {value ? (
        <img src={value} alt="" className="mt-2 h-28 w-auto rounded-lg border border-slate-200 object-cover" />
      ) : null}
    </Field>
  );
}

// ── One recommendation card ────────────────────────────────────────────────
function CardRow({ card, onChange, onRemove, onDuplicate }) {
  const f = (k) => (v) => onChange({ ...card, [k]: v });
  return (
    <div className={`rounded-xl border p-3 ${card.hidden ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="cursor-grab select-none text-slate-400" title="גררו לשינוי סדר">⠿</span>
        <input
          className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm font-medium"
          value={card.name || ''}
          dir="auto"
          placeholder="שם המקום"
          onChange={(e) => f('name')(e.target.value)}
        />
        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={onDuplicate}>שכפול</button>
        <button
          type="button"
          className="text-xs text-slate-500 hover:text-slate-800"
          onClick={() => onChange({ ...card, hidden: !card.hidden })}
        >
          {card.hidden ? 'הצג' : 'הסתר'}
        </button>
        <button type="button" className="text-xs text-rose-600 hover:text-rose-800" onClick={onRemove}>מחיקה</button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Field label="כתובת"><TextInput value={card.address} onChange={f('address')} dir="rtl" /></Field>
        <Field label="טלפון"><TextInput value={card.phone} onChange={f('phone')} dir="ltr" /></Field>
        <Field label="שעות פעילות">
          <textarea className={I} rows={2} dir="rtl" value={card.hours || ''} onChange={(e) => f('hours')(e.target.value)} />
        </Field>
        <Field label="כשרות"><TextInput value={card.kosher} onChange={f('kosher')} dir="rtl" /></Field>
        <Field label="הערות"><TextInput value={card.notes} onChange={f('notes')} dir="rtl" /></Field>
        <Field label="קטגוריה"><TextInput value={card.category} onChange={f('category')} dir="rtl" /></Field>
        <Field label="אתר"><TextInput value={card.website} onChange={f('website')} dir="ltr" placeholder="https://…" /></Field>
        <Field label="קישור למפה"><TextInput value={card.mapUrl} onChange={f('mapUrl')} dir="ltr" placeholder="https://…" /></Field>
      </div>
      <ImageField value={card.image} onChange={f('image')} />
    </div>
  );
}

function CardsEditor({ section, onChange }) {
  const cards = section.cards || [];
  const replace = (next) => set(section, onChange, { cards: next });
  return (
    <>
      <Bilingual
        label="כותרת המקטע"
        he={section.headingHe}
        en={section.headingEn}
        onHe={(v) => set(section, onChange, { headingHe: v })}
        onEn={(v) => set(section, onChange, { headingEn: v })}
      />
      <Bilingual
        label="טקסט מקדים (אופציונלי)"
        he={section.noteHe}
        en={section.noteEn}
        onHe={(v) => set(section, onChange, { noteHe: v })}
        onEn={(v) => set(section, onChange, { noteEn: v })}
      />
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-slate-500">{cards.length} כרטיסים</p>
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          onClick={() => replace([...cards, makeCard()])}
        >
          + כרטיס
        </button>
      </div>
      <ReorderableList
        items={cards}
        emptyText="אין עדיין כרטיסים במקטע הזה."
        onReorder={(ids) => replace(ids.map((id) => cards.find((c) => c.id === id)))}
        renderRow={(card) => (
          <CardRow
            card={card}
            onChange={(next) => replace(cards.map((c) => (c.id === card.id ? next : c)))}
            onRemove={() => replace(cards.filter((c) => c.id !== card.id))}
            onDuplicate={() => {
              const copy = { ...card, id: newId('card') };
              const i = cards.findIndex((c) => c.id === card.id);
              replace([...cards.slice(0, i + 1), copy, ...cards.slice(i + 1)]);
            }}
          />
        )}
      />
    </>
  );
}

function FaqEditor({ section, onChange }) {
  const items = section.items || [];
  const replace = (next) => set(section, onChange, { items: next });
  return (
    <>
      <Bilingual
        label="כותרת המקטע"
        he={section.headingHe}
        en={section.headingEn}
        onHe={(v) => set(section, onChange, { headingHe: v })}
        onEn={(v) => set(section, onChange, { headingEn: v })}
      />
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-slate-500">{items.length} שאלות</p>
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          onClick={() =>
            replace([...items, { id: newId('faq'), hidden: false, questionHe: '', questionEn: '', answerHe: '', answerEn: '' }])
          }
        >
          + שאלה
        </button>
      </div>
      <ReorderableList
        items={items}
        emptyText="אין עדיין שאלות."
        onReorder={(ids) => replace(ids.map((id) => items.find((i) => i.id === id)))}
        renderRow={(item) => (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="cursor-grab text-slate-400">⠿</span>
              <span className="flex-1 text-sm font-medium text-slate-700">{item.questionHe || 'שאלה חדשה'}</span>
              <button
                type="button"
                className="text-xs text-rose-600"
                onClick={() => replace(items.filter((i) => i.id !== item.id))}
              >
                מחיקה
              </button>
            </div>
            <Bilingual
              label="שאלה"
              he={item.questionHe}
              en={item.questionEn}
              onHe={(v) => replace(items.map((i) => (i.id === item.id ? { ...i, questionHe: v } : i)))}
              onEn={(v) => replace(items.map((i) => (i.id === item.id ? { ...i, questionEn: v } : i)))}
            />
            <Bilingual
              rich
              label="תשובה"
              he={item.answerHe}
              en={item.answerEn}
              onHe={(v) => replace(items.map((i) => (i.id === item.id ? { ...i, answerHe: v } : i)))}
              onEn={(v) => replace(items.map((i) => (i.id === item.id ? { ...i, answerEn: v } : i)))}
            />
          </div>
        )}
      />
    </>
  );
}

// ── Pricing section ────────────────────────────────────────────────────────
// A row is one sellable item; its lines are STRUCTURED prices (frozen numbers,
// not free text). A row that references a Pricing Card shows a drift badge when
// the live card no longer matches — updating from the card is a deliberate
// click, and nothing changes on the live site until the next publish.

const LINE_KIND_LABELS = {
  fixed: 'מחיר לקבוצה',
  tier: 'עד X משתתפים',
  extra: 'משתתף נוסף',
  custom: 'שורה חופשית',
};

function AmountInput({ amountMinor, onChange }) {
  return (
    <input
      className={I}
      dir="ltr"
      inputMode="decimal"
      placeholder="₪"
      value={amountMinor == null ? '' : String(amountMinor / 100)}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === '') return onChange(null);
        const n = Number(raw);
        onChange(Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null);
      }}
    />
  );
}

function PricingLineRow({ line, onChange, onRemove }) {
  const patch = (p) => onChange({ ...line, ...p });
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
      <div className="w-36">
        <label className={L}>סוג שורה</label>
        <select className={I} value={line.kind} onChange={(e) => patch({ kind: e.target.value })}>
          {PRICING_LINE_KINDS.map((k) => <option key={k} value={k}>{LINE_KIND_LABELS[k]}</option>)}
        </select>
      </div>
      {line.kind === 'tier' ? (
        <div className="w-28">
          <label className={L}>עד כמה משתתפים</label>
          <input
            className={I}
            dir="ltr"
            inputMode="numeric"
            value={line.upto == null ? '' : String(line.upto)}
            onChange={(e) => {
              const n = Number(e.target.value);
              patch({ upto: Number.isInteger(n) && n > 0 ? n : null });
            }}
          />
        </div>
      ) : null}
      <div className="w-28">
        <label className={L}>מחיר בש"ח</label>
        <AmountInput amountMinor={line.amountMinor} onChange={(v) => patch({ amountMinor: v })} />
      </div>
      {line.kind === 'custom' ? (
        <>
          <div className="min-w-40 flex-1">
            <label className={L}>תיאור (עברית)</label>
            <TextInput value={line.labelHe} onChange={(v) => patch({ labelHe: v })} dir="rtl" />
          </div>
          <div className="min-w-40 flex-1">
            <label className={L}>תיאור (English)</label>
            <TextInput value={line.labelEn} onChange={(v) => patch({ labelEn: v })} dir="ltr" />
          </div>
        </>
      ) : null}
      <button type="button" className="mb-1 text-xs text-rose-600 hover:text-rose-800" onClick={onRemove}>מחיקה</button>
    </div>
  );
}

/** A row's missing-English facts — surfaced BEFORE publish, not discovered after. */
export function pricingRowMissingEnglish(row) {
  if (!row.titleEn) return true;
  return (row.lines || []).some((l) => l.kind === 'custom' && l.labelHe && !l.labelEn);
}

function PricingRowEditor({ row, onChange, onRemove, onDuplicate, drift }) {
  const patch = (p) => onChange({ ...row, ...p });
  const lines = row.lines || [];
  const replaceLines = (next) => patch({ lines: next });
  const missingEn = pricingRowMissingEnglish(row);
  return (
    <div className={`rounded-xl border p-3 ${row.hidden ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="cursor-grab select-none text-slate-400" title="גררו לשינוי סדר">⠿</span>
        <span className="flex-1 text-sm font-medium text-slate-800">{row.titleHe || 'פריט חדש'}</span>
        {missingEn ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">חסר תרגום לאנגלית</span>
        ) : null}
        {drift?.status === 'drift' ? (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">המחירון הקנוני השתנה</span>
        ) : null}
        {drift?.status === 'missing_card' ? (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">כרטיס התמחור לא נמצא</span>
        ) : null}
        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={onDuplicate}>שכפול</button>
        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => patch({ hidden: !row.hidden })}>
          {row.hidden ? 'הצג' : 'הסתר'}
        </button>
        <button type="button" className="text-xs text-rose-600 hover:text-rose-800" onClick={onRemove}>מחיקה</button>
      </div>
      {drift?.status === 'drift' && drift.live ? (
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <span>המחירים בכרטיס התמחור שונים מהמחירים שבעמוד. עדכון מחליף את השורות המובנות (שורות חופשיות נשמרות).</span>
          <button
            type="button"
            className="rounded-md border border-rose-300 bg-white px-2 py-1 font-medium hover:border-rose-400"
            onClick={() => {
              const custom = lines.filter((l) => l.kind === 'custom');
              const fresh = drift.live.lines.map((l) => ({ ...makePricingLine(l.kind), ...l, id: newId('pl') }));
              replaceLines([...fresh, ...custom]);
            }}
          >
            עדכון מהמחירון
          </button>
        </div>
      ) : null}
      <Bilingual
        label="שם הפריט"
        he={row.titleHe}
        en={row.titleEn}
        onHe={(v) => patch({ titleHe: v })}
        onEn={(v) => patch({ titleEn: v })}
      />
      <Bilingual
        label="שורת הקשר (משך / מיקום)"
        he={row.metaHe}
        en={row.metaEn}
        onHe={(v) => patch({ metaHe: v })}
        onEn={(v) => patch({ metaEn: v })}
      />
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <label className={L + ' mb-0'}>שורות מחיר</label>
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:border-slate-400"
            onClick={() => replaceLines([...lines, makePricingLine(lines.length ? 'extra' : 'tier')])}
          >
            + שורת מחיר
          </button>
        </div>
        <div className="grid gap-2">
          {lines.map((line) => (
            <PricingLineRow
              key={line.id}
              line={line}
              onChange={(next) => replaceLines(lines.map((l) => (l.id === line.id ? next : l)))}
              onRemove={() => replaceLines(lines.filter((l) => l.id !== line.id))}
            />
          ))}
          {!lines.length ? <p className="text-xs text-slate-400">אין עדיין שורות מחיר לפריט.</p> : null}
        </div>
      </div>
      <Bilingual
        label="הערות לפריט (אופציונלי)"
        he={row.notesHe}
        en={row.notesEn}
        onHe={(v) => patch({ notesHe: v })}
        onEn={(v) => patch({ notesEn: v })}
      />
      {row.cardGroupId ? (
        <p className="text-[11px] text-slate-400">
          מקושר לכרטיס תמחור קנוני — המחירים המפורסמים קפואים; שינוי במחירון יסומן כאן ולא ישתנה בעמוד עד פרסום מחדש.
        </p>
      ) : null}
    </div>
  );
}

function PricingEditor({ section, onChange, drift }) {
  const rows = section.rows || [];
  const replace = (next) => set(section, onChange, { rows: next });
  const driftFor = (rowId) => (drift || []).find((d) => d.rowId === rowId) || null;
  return (
    <>
      <Bilingual
        label="כותרת המקטע"
        he={section.headingHe}
        en={section.headingEn}
        onHe={(v) => set(section, onChange, { headingHe: v })}
        onEn={(v) => set(section, onChange, { headingEn: v })}
      />
      <Bilingual
        label="טקסט מקדים (אופציונלי)"
        he={section.noteHe}
        en={section.noteEn}
        onHe={(v) => set(section, onChange, { noteHe: v })}
        onEn={(v) => set(section, onChange, { noteEn: v })}
      />
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} פריטים</p>
        <button
          type="button"
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          onClick={() => replace([...rows, makePricingRow()])}
        >
          + פריט מחירון
        </button>
      </div>
      <ReorderableList
        items={rows}
        emptyText="אין עדיין פריטים במקטע המחירון."
        onReorder={(ids) => replace(ids.map((id) => rows.find((r) => r.id === id)))}
        renderRow={(row) => (
          <PricingRowEditor
            row={row}
            drift={driftFor(row.id)}
            onChange={(next) => replace(rows.map((r) => (r.id === row.id ? next : r)))}
            onRemove={() => replace(rows.filter((r) => r.id !== row.id))}
            onDuplicate={() => {
              const copy = {
                ...row,
                id: newId('pr'),
                lines: (row.lines || []).map((l) => ({ ...l, id: newId('pl') })),
              };
              const i = rows.findIndex((r) => r.id === row.id);
              replace([...rows.slice(0, i + 1), copy, ...rows.slice(i + 1)]);
            }}
          />
        )}
      />
    </>
  );
}

/** type key -> editor component. Mirrors SECTION_TYPES in shared/sitePage.mjs. */
export const SECTION_EDITORS = {
  hero: ({ section, onChange }) => (
    <>
      <Bilingual
        label="כותרת"
        he={section.titleHe}
        en={section.titleEn}
        onHe={(v) => set(section, onChange, { titleHe: v })}
        onEn={(v) => set(section, onChange, { titleEn: v })}
      />
      <Bilingual
        label="כותרת משנה"
        he={section.subtitleHe}
        en={section.subtitleEn}
        onHe={(v) => set(section, onChange, { subtitleHe: v })}
        onEn={(v) => set(section, onChange, { subtitleEn: v })}
      />
      <ImageField value={section.image} onChange={(v) => set(section, onChange, { image: v })} />
    </>
  ),

  richText: ({ section, onChange }) => (
    <>
      <Bilingual
        label="כותרת המקטע"
        he={section.headingHe}
        en={section.headingEn}
        onHe={(v) => set(section, onChange, { headingHe: v })}
        onEn={(v) => set(section, onChange, { headingEn: v })}
      />
      <Bilingual
        rich
        label="תוכן"
        he={section.htmlHe}
        en={section.htmlEn}
        onHe={(v) => set(section, onChange, { htmlHe: v })}
        onEn={(v) => set(section, onChange, { htmlEn: v })}
      />
    </>
  ),

  image: ({ section, onChange }) => (
    <>
      <ImageField value={section.image} onChange={(v) => set(section, onChange, { image: v })} />
      <Bilingual
        label="טקסט חלופי (נגישות)"
        he={section.altHe}
        en={section.altEn}
        onHe={(v) => set(section, onChange, { altHe: v })}
        onEn={(v) => set(section, onChange, { altEn: v })}
      />
      <Bilingual
        label="כיתוב"
        he={section.captionHe}
        en={section.captionEn}
        onHe={(v) => set(section, onChange, { captionHe: v })}
        onEn={(v) => set(section, onChange, { captionEn: v })}
      />
    </>
  ),

  imageText: ({ section, onChange }) => (
    <>
      <ImageField value={section.image} onChange={(v) => set(section, onChange, { image: v })} />
      <Field label="צד התמונה">
        <select
          className={I}
          value={section.imageSide || 'start'}
          onChange={(e) => set(section, onChange, { imageSide: e.target.value })}
        >
          <option value="start">בתחילת השורה</option>
          <option value="end">בסוף השורה</option>
        </select>
      </Field>
      <Bilingual
        label="טקסט חלופי (נגישות)"
        he={section.altHe}
        en={section.altEn}
        onHe={(v) => set(section, onChange, { altHe: v })}
        onEn={(v) => set(section, onChange, { altEn: v })}
      />
      <Bilingual
        label="כותרת"
        he={section.headingHe}
        en={section.headingEn}
        onHe={(v) => set(section, onChange, { headingHe: v })}
        onEn={(v) => set(section, onChange, { headingEn: v })}
      />
      <Bilingual
        rich
        label="תוכן"
        he={section.htmlHe}
        en={section.htmlEn}
        onHe={(v) => set(section, onChange, { htmlHe: v })}
        onEn={(v) => set(section, onChange, { htmlEn: v })}
      />
    </>
  ),

  cards: CardsEditor,
  faq: FaqEditor,
  pricing: PricingEditor,

  cta: ({ section, onChange }) => (
    <>
      <Bilingual
        label="כותרת"
        he={section.headingHe}
        en={section.headingEn}
        onHe={(v) => set(section, onChange, { headingHe: v })}
        onEn={(v) => set(section, onChange, { headingEn: v })}
      />
      <Bilingual
        label="טקסט"
        he={section.bodyHe}
        en={section.bodyEn}
        onHe={(v) => set(section, onChange, { bodyHe: v })}
        onEn={(v) => set(section, onChange, { bodyEn: v })}
      />
      <Bilingual
        label="טקסט הכפתור"
        he={section.buttonLabelHe}
        en={section.buttonLabelEn}
        onHe={(v) => set(section, onChange, { buttonLabelHe: v })}
        onEn={(v) => set(section, onChange, { buttonLabelEn: v })}
      />
      <Field label="קישור הכפתור">
        <TextInput value={section.buttonUrl} onChange={(v) => set(section, onChange, { buttonUrl: v })} dir="ltr" />
      </Field>
    </>
  ),

  divider: () => <p className="text-sm text-slate-400">קו מפריד — אין מה להגדיר.</p>,
};

export { Bilingual };
