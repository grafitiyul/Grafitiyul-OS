import { useEffect, useRef, useState } from 'react';

// Signature popup — minimal by design, mirroring the reference flow. A single
// full-name field, then three ways to sign (typed default / upload / draw), then
// the two footer actions. No intro text, no congratulations, no explanations.

const SIGN_BLUE = '#2563eb';

const L = {
  he: {
    title: (co) => (co ? `חתימה על ההצעה של ${co}` : 'חתימה על ההצעה'),
    tabs: { typed: 'הקלידו חתימה', uploaded: 'העלו חתימה', drawn: 'ציירו חתימה' },
    name: 'הקלידו את שמכם המלא',
    upload: 'העלו קובץ PNG / JPG', clear: 'ניקוי', sign: 'חתימה על ההצעה', cancel: 'ביטול',
    needName: 'נא להזין שם מלא', needImage: 'נא להוסיף חתימה', needDraw: 'נא לצייר חתימה',
    generic: 'אירעה שגיאה, נסו שוב',
  },
  en: {
    title: (co) => (co ? `Sign the proposal of ${co}` : 'Sign the proposal'),
    tabs: { typed: 'Type', uploaded: 'Upload', drawn: 'Draw' },
    name: 'Type your full name',
    upload: 'Upload a PNG / JPG', clear: 'Clear', sign: 'Sign the proposal', cancel: 'Cancel',
    needName: 'Please enter your full name', needImage: 'Please add a signature', needDraw: 'Please draw a signature',
    generic: 'Something went wrong, please try again',
  },
};

// Downscale an uploaded image to a sane width and re-encode as a PNG data URL.
function fileToDataUrl(file, maxW = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => { img.src = reader.result; };
    img.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxW / (img.width || maxW));
      const w = Math.max(1, Math.round((img.width || maxW) * scale));
      const h = Math.max(1, Math.round((img.height || 1) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    reader.readAsDataURL(file);
  });
}

function DrawPad({ onChange, clearSignal }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Size the backing store to the displayed size for crisp lines.
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  useEffect(() => {
    // Clear on demand.
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange(null);
  }, [clearSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  };
  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) onChange(canvasRef.current.toDataURL('image/png'));
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-40 w-full cursor-crosshair touch-none rounded-xl border border-gray-200 bg-white"
      onMouseDown={start}
      onMouseMove={move}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
    />
  );
}

export default function SignaturePopup({ company, lang = 'he', busy, onSubmit, onClose }) {
  const t = (L[lang] || L.he);
  const rtl = lang !== 'en';
  const [tab, setTab] = useState('typed');
  const [name, setName] = useState('');
  const [uploaded, setUploaded] = useState(null); // data URL
  const [drawn, setDrawn] = useState(null); // data URL
  const [clearSignal, setClearSignal] = useState(0);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null);
    const signerName = name.trim();
    if (!signerName) return setErr(t.needName);
    let payload;
    if (tab === 'typed') payload = { method: 'typed', signerName };
    else if (tab === 'uploaded') {
      if (!uploaded) return setErr(t.needImage);
      payload = { method: 'uploaded', signerName, signatureImage: uploaded };
    } else {
      if (!drawn) return setErr(t.needDraw);
      payload = { method: 'drawn', signerName, signatureImage: drawn };
    }
    try {
      await onSubmit(payload);
    } catch (e) {
      setErr(e?.payload?.error ? mapErr(e.payload.error, t) : t.generic);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setUploaded(await fileToDataUrl(file)); } catch { setErr(t.generic); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <div className="relative z-10 w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 text-center text-[17px] font-bold text-gray-900">{t.title(company)}</div>

        {/* Full name — the signer identity for every method. */}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.name}
          className="mb-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-[16px] outline-none focus:border-gray-400"
        />

        {/* Method tabs. */}
        <div className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1">
          {['typed', 'uploaded', 'drawn'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setErr(null); setTab(k); }}
              className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
                tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.tabs[k]}
            </button>
          ))}
        </div>

        {/* Method body. */}
        <div className="min-h-[172px]">
          {tab === 'typed' && (
            <div className="flex h-40 items-center justify-center rounded-xl border border-gray-200 bg-gray-50/60 px-4">
              <span className="text-[32px] text-gray-800" style={{ fontFamily: '"Segoe Script","Brush Script MT",cursive' }}>
                {name.trim() || ' '}
              </span>
            </div>
          )}

          {tab === 'uploaded' && (
            <div>
              {uploaded ? (
                <div className="flex h-40 items-center justify-center rounded-xl border border-gray-200 bg-white p-2">
                  <img src={uploaded} alt="" className="max-h-full max-w-full object-contain" />
                </div>
              ) : (
                <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50/60 text-sm text-gray-500 hover:bg-gray-50">
                  <span className="text-2xl">↑</span>
                  {t.upload}
                  <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={onFile} />
                </label>
              )}
              {uploaded && (
                <button type="button" onClick={() => setUploaded(null)} className="mt-2 text-[13px] text-gray-500 hover:text-gray-700">
                  {t.clear}
                </button>
              )}
            </div>
          )}

          {tab === 'drawn' && (
            <div>
              <DrawPad onChange={setDrawn} clearSignal={clearSignal} />
              <button type="button" onClick={() => setClearSignal((n) => n + 1)} className="mt-2 text-[13px] text-gray-500 hover:text-gray-700">
                {t.clear}
              </button>
            </div>
          )}
        </div>

        {err && <div className="mt-3 text-center text-[13px] text-red-600">{err}</div>}

        {/* Footer actions. */}
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-5 py-2.5 text-[14px] font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-xl px-7 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-50"
            style={{ backgroundColor: SIGN_BLUE }}
          >
            {busy ? '…' : t.sign}
          </button>
        </div>
      </div>
    </div>
  );
}

function mapErr(code, t) {
  switch (code) {
    case 'name_required': return t.needName;
    case 'image_required': return t.needImage;
    default: return t.generic;
  }
}
