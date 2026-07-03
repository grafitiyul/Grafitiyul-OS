// Small shared UI helpers + vocab for the Tour Content admin module.
// Hebrew labels live here (client-side); the server stores stable English keys.

export const STATION_KINDS = [
  { value: 'location', label: 'מקום פיזי' },
  { value: 'artwork', label: 'יצירת אמנות' },
  { value: 'printed_material', label: 'חומר מודפס / קלסר' },
  { value: 'content_stop', label: 'תחנת תוכן' },
];

export const ASSET_TYPES = [
  { value: 'image', label: 'תמונה' },
  { value: 'video', label: 'וידאו' },
  { value: 'file', label: 'קובץ' },
  { value: 'link', label: 'קישור' },
];

export const stationKindLabel = (v) =>
  STATION_KINDS.find((k) => k.value === v)?.label || v || '—';
export const assetTypeLabel = (v) =>
  ASSET_TYPES.find((t) => t.value === v)?.label || v || '—';

// Optional, soft role label for a part (from the imported roleHint). NOT a
// structural taxonomy — purely a friendly display chip when a hint exists.
const ROLE_LABELS = {
  build_up: 'בילד־אפ',
  curiosity_hook: 'סקרנות',
  content: 'תוכן',
  punchline: 'פואנטה',
  media: 'מדיה',
};
export const roleLabel = (v) => (v ? ROLE_LABELS[v] || v : null);
export const MEDIA_ROLE = 'media';

// Strip HTML → short plain-text preview for a part row.
export function textPreview(html, max = 90) {
  if (!html) return '';
  const t = String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// Detect the source of an asset for a small label (R2 / YouTube / Vimeo / …).
export function assetSourceLabel(a) {
  if (a?.mediaId || a?.media) return 'R2';
  const u = String(a?.url || '');
  if (/youtube\.com|youtu\.be/i.test(u)) return 'YouTube';
  if (/vimeo\.com/i.test(u)) return 'Vimeo';
  if (/drive\.google\.com|docs\.google\.com/i.test(u)) return 'Drive';
  if (/^https?:\/\//i.test(u)) return 'קישור';
  return null;
}

// Active / archived pill — matches the Products/CRM convention.
export function ActiveBadge({ active }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> פעיל
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[12px] font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
      בארכיון
    </span>
  );
}

// Section header used across the detail pages.
export function SectionTitle({ children, count, action }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h2 className="text-[15px] font-semibold text-gray-900">{children}</h2>
      {count != null && <span className="text-[12px] text-gray-400">({count})</span>}
      <div className="flex-1" />
      {action}
    </div>
  );
}

export function Loading() {
  return <div className="px-3 py-12 text-center text-sm text-gray-400">טוען…</div>;
}

export function ErrorBox({ message }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
      שגיאה בטעינה: {message}
    </div>
  );
}

// Standard error alert — surfaces the backend error code when present.
export function alertError(prefix, e) {
  alert(prefix + ': ' + (e?.payload?.error || e?.message || 'שגיאה'));
}

const inputCls =
  'h-10 w-full rounded-xl border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

export function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[12px] text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

export function TextInput(props) {
  return <input {...props} className={inputCls + ' ' + (props.className || '')} />;
}

export const primaryBtn =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50';
export const ghostBtn =
  'rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50';
export const dangerBtn =
  'rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50';
