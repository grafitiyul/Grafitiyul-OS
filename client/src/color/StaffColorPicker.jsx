import { STAFF_COLORS, staffColorHex } from '../../../shared/staffColors.mjs';

// THE shared staff-color picker — profile editor, table inline editing and
// bulk editing all render this one grid (product rule: no second picker).
// Pure component: value (palette key | null) in, onPick(key | null) out.

export function StaffColorSwatch({ colorKey, className = 'h-5 w-5' }) {
  const hex = staffColorHex(colorKey);
  if (!hex) {
    return (
      <span
        className={`${className} inline-block shrink-0 rounded-md border border-dashed border-gray-300 bg-white`}
        title="ללא צבע"
        aria-label="ללא צבע"
      />
    );
  }
  return (
    <span
      className={`${className} inline-block shrink-0 rounded-md border border-black/10`}
      style={{ backgroundColor: hex }}
      title={colorKey}
    />
  );
}

export default function StaffColorPicker({ value, onPick, compact = false }) {
  return (
    <div dir="rtl" className={compact ? 'w-64' : 'w-72'}>
      <div className="grid grid-cols-8 gap-1.5">
        {STAFF_COLORS.map((c) => {
          const selected = value === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onPick(c.key)}
              title={c.nameHe}
              aria-label={c.nameHe}
              aria-pressed={selected}
              className={`relative h-7 w-7 rounded-lg border transition ${
                selected
                  ? 'border-gray-900 ring-2 ring-gray-900/30'
                  : 'border-black/10 hover:scale-110'
              }`}
              style={{ backgroundColor: c.hex }}
            >
              {selected && (
                <span className="absolute inset-0 grid place-items-center text-[13px] font-bold text-white drop-shadow">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onPick(null)}
        className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12.5px] font-medium ${
          !value
            ? 'border-gray-900 text-gray-900'
            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
        }`}
      >
        <span className="inline-block h-4 w-4 rounded border border-dashed border-gray-400 bg-white" aria-hidden />
        ללא צבע
      </button>
    </div>
  );
}
