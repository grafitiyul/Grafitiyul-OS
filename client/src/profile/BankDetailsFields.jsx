import { useEffect, useMemo, useRef, useState } from 'react';

// Shared structured bank-details form — used by BOTH the admin person card
// and the Guide Portal profile page. Pure presentation: value in, patches
// out; the host wires loading the catalog and saving.
//
// value shape (the server-normalized SSOT):
//   { beneficiary, bankCode, bankName, branchCode, branchName, accountNumber }
//
// Bank: ONE combobox searchable by number or name; options render "10 — בנק
// לאומי"; picking stores BOTH the code and a name snapshot. Branch: ONE
// field, enabled after a bank is chosen; suggestions (when the catalog has
// them, filtered to the selected bank) search by number/name/city and store
// code + name snapshot; manual typing simply stores the branch number — the
// catalog is an accelerator, never a gate, and there are no duplicate
// number/name inputs.

export default function BankDetailsFields({ value, onChange, banks = [], disabled = false }) {
  const v = value || {};
  const bank = useMemo(
    () => banks.find((b) => b.code === v.bankCode) || null,
    [banks, v.bankCode],
  );
  return (
    <div className="space-y-3">
      <Field label="שם המוטב (בעל החשבון)">
        <input
          type="text"
          value={v.beneficiary || ''}
          disabled={disabled}
          onChange={(e) => onChange({ beneficiary: e.target.value })}
          className={inputCls}
        />
      </Field>

      <Field label="בנק">
        <BankCombobox
          banks={banks}
          code={v.bankCode}
          name={v.bankName}
          disabled={disabled}
          onPick={(b) => onChange({ bankCode: b?.code || null, bankName: b?.name || null })}
          onManual={(text) =>
            /^\d{1,4}$/.test(text)
              ? onChange({ bankCode: text, bankName: null })
              : onChange({ bankName: text || null, ...(text ? {} : { bankCode: null }) })
          }
        />
      </Field>

      <Field label="סניף">
        <BranchCombobox
          branches={bank?.branches || []}
          code={v.branchCode}
          name={v.branchName}
          disabled={disabled || !v.bankCode}
          onPick={(br) => onChange({ branchCode: br.code, branchName: br.name || null })}
          onManual={(digits) =>
            onChange({ branchCode: digits || null, branchName: null })
          }
        />
      </Field>
      {!v.bankCode && (
        <p className="-mt-1.5 text-[11.5px] text-gray-400">בחרו בנק כדי למלא את הסניף.</p>
      )}

      <Field label="מספר חשבון">
        <input
          type="text"
          inputMode="numeric"
          dir="ltr"
          value={v.accountNumber || ''}
          disabled={disabled}
          onChange={(e) => onChange({ accountNumber: e.target.value })}
          className={inputCls}
        />
      </Field>
    </div>
  );
}

const inputCls =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-[14px] text-gray-900 focus:border-blue-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-semibold text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function bankLabel(code, name) {
  return [code, name].filter(Boolean).join(' — ');
}

// ── bank combobox ────────────────────────────────────────────────────

function BankCombobox({ banks, code, name, disabled, onPick, onManual }) {
  const [text, setText] = useState(bankLabel(code, name));
  const [openList, setOpenList] = useState(false);
  const boxRef = useRef(null);

  // Keep the input in sync when the value changes from outside.
  useEffect(() => {
    setText(bankLabel(code, name));
  }, [code, name]);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpenList(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = text.trim();
  const matches = useMemo(() => {
    if (!q) return banks;
    return banks.filter(
      (b) => b.code.startsWith(q.replace(/^0+/, '')) || b.name.includes(q) || bankLabel(b.code, b.name).includes(q),
    );
  }, [banks, q]);

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={text}
        disabled={disabled}
        placeholder="מספר או שם בנק…"
        onChange={(e) => {
          setText(e.target.value);
          setOpenList(true);
        }}
        onFocus={() => setOpenList(true)}
        onBlur={() => {
          // Manual fallback: unmatched free text still saves (digits → code).
          const t = text.trim();
          if (t && t !== bankLabel(code, name) && !banks.some((b) => bankLabel(b.code, b.name) === t)) {
            onManual(t);
          } else if (!t && (code || name)) {
            onPick(null);
          }
        }}
        className={inputCls}
      />
      {openList && !disabled && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {matches.map((b) => (
            <li key={b.code}>
              <button
                type="button"
                // mousedown so the pick wins over the input's blur handler
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(b);
                  setText(bankLabel(b.code, b.name));
                  setOpenList(false);
                }}
                className="w-full px-3 py-2 text-right text-[13.5px] text-gray-800 hover:bg-blue-50"
              >
                <span className="tabular-nums font-semibold">{b.code}</span> — {b.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── branch combobox (ONE field) ──────────────────────────────────────
//
// Displays "936 — פלורנטין" when picked from the catalog; free typing stores
// the branch NUMBER only (digits extracted on blur, no name snapshot).

function branchLabel(code, name) {
  return [code, name].filter(Boolean).join(' — ');
}

function BranchCombobox({ branches, code, name, disabled, onPick, onManual }) {
  const [text, setText] = useState(branchLabel(code, name));
  const [openList, setOpenList] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    setText(branchLabel(code, name));
  }, [code, name]);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpenList(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = text.trim();
  const matches = useMemo(() => {
    if (!branches.length) return [];
    if (!q) return branches.slice(0, 30);
    return branches
      .filter(
        (br) =>
          String(br.code).startsWith(q) ||
          (br.name || '').includes(q) ||
          (br.city || '').includes(q) ||
          branchLabel(br.code, br.name).includes(q),
      )
      .slice(0, 30);
  }, [branches, q]);

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={text}
        disabled={disabled}
        placeholder="מספר סניף…"
        onChange={(e) => {
          setText(e.target.value);
          setOpenList(true);
        }}
        onFocus={() => setOpenList(true)}
        onBlur={() => {
          const t = text.trim();
          if (t === branchLabel(code, name)) return; // untouched
          const digits = (t.match(/\d+/) || [null])[0];
          onManual(digits); // number only; empty/no digits clears the branch
        }}
        className={inputCls}
      />
      {openList && !disabled && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {matches.map((br) => (
            <li key={br.code}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(br);
                  setText(branchLabel(br.code, br.name));
                  setOpenList(false);
                }}
                className="w-full px-3 py-2 text-right text-[13.5px] text-gray-800 hover:bg-blue-50"
              >
                <span className="tabular-nums font-semibold">{br.code}</span>
                {br.name ? ` — ${br.name}` : ''}
                {br.city ? <span className="text-gray-400"> · {br.city}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
