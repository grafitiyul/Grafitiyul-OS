// שכר — the pay tab SHELL. There is no pay model in the system yet
// (TourAssignment carries no rates; schema comment: "Pay/attendance are a
// future phase"), so this page states that honestly instead of inventing
// numbers. The future model is documented in docs/architecture/
// guide-portal.md — per-assignment pay derived from TourAssignment +
// variant payment fields, never computed ad-hoc in the client.

export default function PayPage() {
  return (
    <div>
      <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">שכר</h1>
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mb-3 text-4xl opacity-60">💰</div>
        <div className="mb-1 text-base font-semibold text-gray-800">בקרוב</div>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-gray-500">
          נתוני השכר עדיין לא מנוהלים במערכת. כשמודל השכר ייבנה, כאן יופיע
          פירוט תשלומים לפי הסיורים שהודרכו.
        </p>
      </div>
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-gray-400">
        עד אז, שאלות על שכר — מול המשרד.
      </p>
    </div>
  );
}
