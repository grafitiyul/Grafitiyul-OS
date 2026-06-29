import { useEffect, useRef, useState } from 'react';

// Searchable contact picker. Reuses the contacts list payload (which already
// includes the primary org / email / phone) so each result shows enough to tell
// similar people apart. Matches the query against name, organization, email and
// phone. Controlled: `value` = selected contact id; `onChange(id)`.
function cName(c) { return c?.fullNameHe || c?.fullNameEn || c?.id || ''; }
function cOrg(c) { return c?.orgLinks?.[0]?.organization?.name || ''; }
function cEmail(c) { return c?.emails?.[0]?.value || ''; }
function cPhone(c) { return c?.phones?.[0]?.value || ''; }

export default function ContactPicker({ contacts, value, onChange, placeholder = 'חיפוש לפי שם / ארגון / אימייל / טלפון…' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = contacts.find((c) => c.id === value);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (selected) {
    return (
      <div className="flex-1 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50/50 px-2.5 h-9 text-sm min-w-0">
        <span className="font-medium text-gray-900 truncate">{cName(selected)}</span>
        <span className="text-[11px] text-gray-500 truncate" dir="ltr">
          {[cOrg(selected), cEmail(selected), cPhone(selected)].filter(Boolean).join(' · ')}
        </span>
        <button type="button" onClick={() => { onChange(''); setQuery(''); }} className="ms-auto shrink-0 text-gray-400 hover:text-gray-700" title="נקה">
          ✕
        </button>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const results = (q
    ? contacts.filter((c) => `${cName(c)} ${cOrg(c)} ${cEmail(c)} ${cPhone(c)}`.toLowerCase().includes(q))
    : contacts
  ).slice(0, 40);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full h-9 rounded-md border border-gray-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-gray-400">לא נמצאו אנשי קשר</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false); setQuery(''); }}
                className="w-full text-right px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
              >
                <div className="text-sm font-medium text-gray-900 truncate">{cName(c)}</div>
                <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-2" dir="ltr">
                  {cOrg(c) && <span>{cOrg(c)}</span>}
                  {cEmail(c) && <span>{cEmail(c)}</span>}
                  {cPhone(c) && <span>{cPhone(c)}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
