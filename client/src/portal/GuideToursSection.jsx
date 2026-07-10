import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// "הסיורים שלי" — the guide's assigned tours (recent + upcoming) with gallery
// access. Fails quiet: the task feed is the portal's core and must not break
// when tours can't load. Operational fields only — no commercial data.

const ROLE_LABELS = {
  lead_guide: 'מדריך ראשי',
  guide: 'מדריך',
  workshop_assistant: 'עוזר סדנה',
};

function fmtDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd;
}

export default function GuideToursSection({ token }) {
  const [tours, setTours] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/portal/${encodeURIComponent(token)}/tours`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive) setTours(data?.tours || []);
      })
      .catch(() => {
        if (alive) setTours([]);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (!tours || tours.length === 0) return null;

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-[13px] font-bold text-gray-500">הסיורים שלי</h2>
      <div className="space-y-2">
        {tours.map((t) => (
          <Link
            key={t.id}
            to={`/p/${encodeURIComponent(token)}/tour/${encodeURIComponent(t.id)}`}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 shadow-sm transition hover:border-gray-300 active:bg-gray-50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-lg" aria-hidden>
              🧭
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-gray-900">
                {t.productName}
              </span>
              <span className="mt-0.5 block text-[12px] text-gray-500">
                {fmtDate(t.date)} · <span dir="ltr" className="tabular-nums">{t.startTime}</span>
                {t.locationName && ` · ${t.locationName}`}
                {ROLE_LABELS[t.role] && ` · ${ROLE_LABELS[t.role]}`}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-gray-500">
              {t.mediaCount > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
                  📸 {t.mediaCount}
                </span>
              )}
              <span className="text-gray-300">‹</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
