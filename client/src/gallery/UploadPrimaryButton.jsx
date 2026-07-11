// THE upload action — one component for every gallery surface (customer page,
// admin workspace) so wording, color, icon and visual weight stay identical.
// Brand teal is taken from the Grafitiyul logo underline.

export const BRAND_TEAL = '#10a99b';
export const BRAND_NAVY = '#1b2540';

export function UploadCloudIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className} aria-hidden>
      <path d="M7 17a4.5 4.5 0 0 1-.4-8.98 6 6 0 0 1 11.6 1.6A3.7 3.7 0 0 1 17.5 17" strokeLinecap="round" />
      <path d="M12 20v-7m0 0-3 3m3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function UploadPrimaryButton({ onClick, label = 'העלאת תמונות וסרטונים', className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ backgroundColor: BRAND_TEAL }}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-7 py-3 text-[15px] font-bold text-white shadow-md shadow-teal-900/10 transition hover:brightness-95 active:scale-[0.98] ${className}`}
    >
      <UploadCloudIcon className="h-5 w-5" />
      {label}
    </button>
  );
}
