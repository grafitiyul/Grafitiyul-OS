import React from 'react';
import RichEditor from '../../editor/RichEditor.jsx';
import TranslateButton from '../common/TranslateButton.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { makeCard, newId } from '../../../../shared/sitePage.mjs';

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
