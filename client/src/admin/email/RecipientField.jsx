import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { splitAddresses, addAddresses, isValidAddress } from './recipientParse.js';
import { dirForInput } from '../../lib/inputDirection.js';

// Gmail-style recipient field: addresses become chips, with autocomplete over
// CRM contacts + addresses already corresponded with.
//
// Entry (matches what people already expect from Gmail):
//   Enter / Tab / comma / semicolon → commit the typed address as a chip
//   paste of "a@x.com, b@y.com"     → commits each one
//   Backspace on an empty input     → edit the previous chip back into text
//   ↑ ↓ + Enter                     → pick a suggestion
//   blur                            → commits whatever was typed (no silent loss)
//
// Value is the SAME comma-joined string the composer already sends, so nothing
// downstream changes — this is purely the entry surface.

export default function RecipientField({ value, onChange, placeholder, ariaLabel, autoFocus = false }) {
  const chips = splitAddresses(value);
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const blurTimer = useRef(null);

  // Debounced suggestion lookup; stale responses are discarded.
  useEffect(() => {
    const term = draft.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const rows = await api.email.recipientSuggestions(term);
        if (!alive) return;
        const existing = new Set(chips.map((c) => c.toLowerCase()));
        const fresh = (rows || []).filter((r) => !existing.has(r.email));
        setSuggestions(fresh);
        setCursor(0);
        setOpen(fresh.length > 0);
      } catch {
        /* suggestions are a convenience — never block typing */
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => () => clearTimeout(blurTimer.current), []);

  function commit(list) {
    onChange(addAddresses(value, list));
    setDraft('');
    setSuggestions([]);
    setOpen(false);
  }

  function removeChip(i) {
    onChange(chips.filter((_, j) => j !== i).join(', '));
  }

  function onKeyDown(e) {
    if (open && suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        return setCursor((c) => (c + 1) % suggestions.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        return setCursor((c) => (c - 1 + suggestions.length) % suggestions.length);
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        return commit([suggestions[cursor].email]);
      }
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && draft.trim())) {
      if (!draft.trim()) return undefined;
      e.preventDefault();
      return commit(splitAddresses(draft));
    }
    if (e.key === 'Backspace' && !draft && chips.length) {
      // Gmail behaviour: pull the last chip back into the input for editing.
      e.preventDefault();
      setDraft(chips[chips.length - 1]);
      removeChip(chips.length - 1);
    }
    if (e.key === 'Escape') setOpen(false);
    return undefined;
  }

  return (
    // RTL shell: chips flow from the right and the placeholder starts on the
    // right, while each chip's ADDRESS stays dir="ltr" so it reads correctly.
    <div className="relative" dir="rtl">
      <div
        className="flex w-full flex-wrap items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 focus-within:border-blue-500"
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map((c, i) => {
          const valid = isValidAddress(c);
          return (
            <span
              key={`${c}-${i}`}
              dir="ltr"
              className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[12px] ring-1 ${
                valid
                  ? 'bg-blue-50 text-blue-800 ring-blue-200'
                  : 'bg-red-50 text-red-700 ring-red-200'
              }`}
              title={valid ? c : `${c} — כתובת לא תקינה`}
            >
              <span className="truncate">{c}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeChip(i);
                }}
                className="shrink-0 opacity-60 hover:opacity-100"
                aria-label={`הסרת ${c}`}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          value={draft}
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const text = e.clipboardData?.getData('text') || '';
            if (!/[,;]/.test(text)) return;
            e.preventDefault();
            commit(splitAddresses(text));
          }}
          onFocus={() => suggestions.length && setOpen(true)}
          onBlur={() => {
            // Let a suggestion click land before closing / committing.
            blurTimer.current = setTimeout(() => {
              setOpen(false);
              if (draft.trim()) commit(splitAddresses(draft));
            }, 150);
          }}
          placeholder={chips.length ? '' : placeholder}
          // Empty → RTL so the Hebrew placeholder starts on the right; once
          // typing starts the content decides (an address renders LTR).
          dir={dirForInput(draft)}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-[13px] focus:outline-none"
        />
      </div>

      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <li key={s.email}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                onMouseDown={(e) => e.preventDefault()} // keep focus; blur must not fire first
                onClick={() => {
                  clearTimeout(blurTimer.current);
                  commit([s.email]);
                  inputRef.current?.focus();
                }}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-right ${
                  i === cursor ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <span className="min-w-0">
                  {s.name && <span className="block truncate text-[13px] font-medium text-gray-900">{s.name}</span>}
                  <span className="block truncate text-[12px] text-gray-500" dir="ltr">{s.email}</span>
                </span>
                {s.source === 'contact' && (
                  <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10.5px] text-gray-500">
                    איש קשר
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
