import RichText from '../editor/RichText.jsx';

// THE shared learner-facing Station renderer — used by the admin preview
// (/preview/tour-station/:id) AND the Guide Portal מערכי הדרכה page, so the
// two surfaces can never drift (product rule: no duplicated Station
// presentation logic). Pure presentation:
//
//   { tourTitle, title, description, heroImageUrl, parts: [{ title, body }],
//     media: [{ assetType, title, url }] }
//
// Rich bodies render through the canonical RichText path (CLAUDE.md §16).

const ASSET_ICONS = { link: '🔗', file: '📄', video: '▶', image: '🖼' };

export default function StationContentView({
  tourTitle,
  title,
  description,
  heroImageUrl,
  parts = [],
  media = [],
}) {
  return (
    <div>
      {tourTitle && <div className="mb-1 text-[12px] text-gray-400">{tourTitle}</div>}
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      {heroImageUrl && (
        <img
          src={heroImageUrl}
          alt=""
          className="mb-5 w-full rounded-2xl border border-gray-200 object-cover"
          style={{ aspectRatio: '16/9' }}
        />
      )}
      {description && <p className="mb-6 text-gray-600">{description}</p>}

      <div className="space-y-5">
        {parts.length === 0 && (
          <div className="py-8 text-center text-gray-400">אין חלקים בתחנה זו.</div>
        )}
        {parts.map((p, i) => (
          <section
            key={i}
            className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-blue-600 text-[12px] font-bold tabular-nums text-white">
                {i + 1}
              </span>
              <h2 className="text-[16px] font-semibold">{p.title || ''}</h2>
            </div>
            {p.body ? (
              <RichText html={p.body} className="text-gray-800" />
            ) : (
              <p className="text-gray-400">— ללא תוכן —</p>
            )}
          </section>
        ))}
      </div>

      {media.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[15px] font-semibold text-gray-700">מדיה וקישורים</h2>
          <ul className="space-y-2">
            {media.map((a, i) => (
              <li key={i}>
                {a.assetType === 'image' && a.url ? (
                  <img
                    src={a.url}
                    alt={a.title || ''}
                    className="max-h-64 rounded-xl border border-gray-200"
                  />
                ) : (
                  <a
                    href={a.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 hover:border-blue-300"
                  >
                    <span className="text-lg" aria-hidden>
                      {ASSET_ICONS[a.assetType] || '🔗'}
                    </span>
                    <span className="font-medium text-blue-700">{a.title}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
