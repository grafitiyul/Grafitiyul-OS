import { useEffect, useRef, useState } from 'react';

// Inline session-footer signature — ONE signature for the whole reservation
// (BINDING: session-wide). Two methods, typed (default) and drawn; the pad is
// the quote SignaturePopup DrawPad recipe (mouse + touch, PNG data URL out).
// Emits { signerName, method, image } upward on every change; the page owns
// validation.

function DrawPad({ onChange, clearSignal }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange(null);
  }, [clearSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
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

export default function SignatureBox({ t, value, onChange, error }) {
  const [clearSignal, setClearSignal] = useState(0);
  const method = value.method || 'typed';

  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div>
      <div className="mb-2 flex gap-1.5 rounded-xl bg-gray-100 p-1">
        {[
          ['typed', t.footer.signTyped],
          ['drawn', t.footer.signDrawn],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => set({ method: k })}
            className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
              method === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        value={value.signerName || ''}
        onChange={(e) => set({ signerName: e.target.value })}
        placeholder={t.footer.signerNamePh}
        className={`w-full rounded-xl border px-4 py-3 text-[15px] outline-none focus:border-gray-400 ${
          error ? 'border-red-300' : 'border-gray-200'
        }`}
      />

      {method === 'typed' ? (
        <div className="mt-3 flex h-28 items-center justify-center rounded-xl border border-gray-200 bg-gray-50/60 px-4">
          <span
            className="text-[30px] leading-none text-gray-800"
            style={{ fontFamily: '"Segoe Script","Brush Script MT",cursive' }}
          >
            {(value.signerName || '').trim() || ' '}
          </span>
        </div>
      ) : (
        <div className="mt-3">
          <DrawPad onChange={(image) => set({ image })} clearSignal={clearSignal} />
          <button
            type="button"
            onClick={() => setClearSignal((n) => n + 1)}
            className="mt-2 text-[13px] text-gray-500 hover:text-gray-700"
          >
            {t.footer.clear}
          </button>
        </div>
      )}
    </div>
  );
}
