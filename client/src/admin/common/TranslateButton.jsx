import { useState } from 'react';
import { api } from '../../lib/api.js';
import { forceBlockDirection } from '../../../../shared/textDirection.mjs';

// THE shared bilingual-field translation action — one component + one server
// service behind every settings "תרגם לאנגלית" button. Contract:
//   • fills the TARGET field via onResult — it NEVER saves; the operator
//     reviews, edits and saves through the screen's normal save flow
//   • existing target content is never overwritten without confirmation
//   • loading / success / error states are visible inline
// Props: getSource() → current source value; getTarget() → current target
// value (overwrite guard); onResult(content) → fill target; direction
// 'he_to_en' (default) | 'en_to_he'; format 'html' (default) | 'text'.

const hasText = (v) =>
  !!v && String(v).replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') !== '';

const ERROR_TEXT = {
  translation_not_configured: 'תרגום AI לא מוגדר בשרת',
  translation_tokens_changed: 'התרגום שינה משתנים — נסו שוב',
  translation_failed: 'שגיאת תרגום — נסו שוב',
  content_required: 'אין תוכן לתרגום',
};

export default function TranslateButton({
  getSource,
  getTarget,
  onResult,
  direction = 'he_to_en',
  format = 'html',
  tone,
}) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // { ok, text }
  // Overwrite guard — an INLINE two-step confirmation (never a native
  // confirm(): the common-components guard forbids browser dialogs).
  const [armed, setArmed] = useState(false);

  const label = direction === 'en_to_he' ? 'תרגם לעברית' : 'תרגם לאנגלית';

  function show(ok, text, ms) {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), ms);
  }

  async function translate() {
    setArmed(false);
    setBusy(true);
    setFlash(null);
    try {
      const out = await api.translate.field({ content: getSource?.(), direction, format, tone });
      // Direction follows the TARGET language, stamped ONCE here for every
      // screen: English opens LTR + left-aligned, Hebrew RTL + right — the
      // operator never presses the direction/align buttons after a
      // translation. Plain-text fields carry no markup, so they're passed
      // through untouched.
      const targetDir = direction === 'en_to_he' ? 'rtl' : 'ltr';
      const content = format === 'html' ? forceBlockDirection(out.content, targetDir) : out.content;
      onResult(content); // fills the field only — nothing is saved
      show(true, '✓ תורגם — בדקו וערכו לפני שמירה', 3500);
    } catch (e) {
      show(false, ERROR_TEXT[e.payload?.error] || 'שגיאת תרגום', 4000);
    } finally {
      setBusy(false);
    }
  }

  function run() {
    const source = getSource?.();
    if (!hasText(source)) return show(false, 'אין תוכן לתרגום', 2500);
    if (hasText(getTarget?.())) {
      setArmed(true);
      setTimeout(() => setArmed(false), 6000);
      return;
    }
    translate();
  }

  if (armed) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[11px] text-amber-700">להחליף את התוכן הקיים בתרגום?</span>
        <button
          type="button"
          onClick={translate}
          className="rounded-md bg-amber-600 px-2 py-1 text-[11.5px] font-medium text-white hover:bg-amber-700"
        >
          החלף
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11.5px] text-gray-600 hover:bg-gray-50"
        >
          ביטול
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {flash && (
        <span className={`text-[11px] ${flash.ok ? 'text-emerald-600' : 'text-red-600'}`}>
          {flash.text}
        </span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title="תרגום AI — ממלא את השדה לבדיקה, לא שומר"
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11.5px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? '✨ מתרגם…' : `✨ ${label}`}
      </button>
    </span>
  );
}
