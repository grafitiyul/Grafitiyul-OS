// Signed audit panel — the permanent status card shown once the proposal is
// signed (replaces the "pending signature" state). White premium card, rounded,
// soft shadow, clean icons. Screen chrome only (not printed). Data comes straight
// from the QuoteSignature audit record.

const L = {
  he: {
    signed: 'ההצעה נחתמה',
    date: 'תאריך', time: 'שעה', name: 'שם', org: 'ארגון', ip: 'כתובת IP', device: 'מכשיר', method: 'אופן חתימה',
    methods: { typed: 'הוקלדה', uploaded: 'הועלתה', drawn: 'צוירה' },
  },
  en: {
    signed: 'Proposal signed',
    date: 'Date', time: 'Time', name: 'Name', org: 'Organization', ip: 'IP address', device: 'Device', method: 'Signed via',
    methods: { typed: 'Typed', uploaded: 'Uploaded', drawn: 'Drawn' },
  },
};

const I = {
  check: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>),
  calendar: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" /></svg>),
  clock: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
  user: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>),
  building: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></svg>),
  globe: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></svg>),
  monitor: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>),
  pen: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>),
};

function fmt(v, lang) {
  if (!v) return { date: null, time: null };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { date: String(v), time: null };
  const loc = lang === 'en' ? 'en-GB' : 'he-IL';
  try {
    return { date: d.toLocaleDateString(loc), time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) };
  } catch { return { date: String(v), time: null }; }
}

// Friendly "Browser · OS" from a user-agent string (best-effort, never throws).
function parseUA(ua) {
  if (!ua) return null;
  let browser = '';
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/opr|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';
  let os = '';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ios/i.test(ua)) os = 'iOS';
  else if (/mac os|macintosh/i.test(ua)) os = 'macOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';
  return [browser, os].filter(Boolean).join(' · ') || null;
}

function Row({ icon: Ic, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Ic className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      <div className="min-w-0">
        <div className="text-[11px] text-gray-400">{label}</div>
        <div dir="auto" className="truncate text-[13px] font-medium text-gray-800">{value}</div>
      </div>
    </div>
  );
}

export default function SignedStatusPanel({ signature, header = {}, lang = 'he', className = '' }) {
  if (!signature) return null;
  const t = L[lang] || L.he;
  const { date, time } = fmt(signature.signedAt, lang);
  const device = parseUA(signature.userAgent);

  return (
    <div className={`w-64 max-w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl ${className}`}>
      <div className="flex items-center gap-2 border-b border-gray-100 bg-emerald-50/60 px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
          <I.check className="h-3.5 w-3.5" />
        </span>
        <span className="text-[14px] font-bold text-emerald-800">{t.signed}</span>
      </div>
      <div className="px-4 py-2">
        <Row icon={I.user} label={t.name} value={signature.signerName} />
        <Row icon={I.building} label={t.org} value={header.organizationName} />
        <Row icon={I.calendar} label={t.date} value={date} />
        <Row icon={I.clock} label={t.time} value={time} />
        <Row icon={I.pen} label={t.method} value={t.methods[signature.method] || signature.method} />
        <Row icon={I.globe} label={t.ip} value={signature.ipAddress} />
        <Row icon={I.monitor} label={t.device} value={device} />
      </div>
    </div>
  );
}
