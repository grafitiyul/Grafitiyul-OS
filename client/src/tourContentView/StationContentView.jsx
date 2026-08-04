import { useState } from 'react';
import RichText from '../editor/RichText.jsx';

// THE shared learner-facing Station renderer — used by the admin preview
// (/preview/tour-station/:id) AND the Guide Portal מערכי הדרכה page, so the
// two surfaces can never drift (product rule: no duplicated Station
// presentation logic). Pure presentation:
//
//   { tourTitle, title, description, heroImageUrl,
//     parts: [{ roleHint, title, body }], media: [{ assetType, title, url }] }
//
// Parts are grouped by roleHint into four accordion sections (בילד־אפ /
// סקרנות / תוכן / פואנטה), all COLLAPSED by default — the guide opens only
// what they need right now. Parts without a hint land under תוכן. The part
// rendering itself (numbered heading + canonical RichText, CLAUDE.md §16) is
// unchanged — the accordion is a grouping wrapper only.

const ASSET_ICONS = { link: '🔗', file: '📄', video: '▶', image: '🖼' };

// Same vocabulary as the admin editor's role chips (tour-content kit). ORDER
// and icons are structure; the words come from `labels` so the shared renderer
// serves the Hebrew admin preview and an English guide from one implementation.
const ROLE_GROUPS = [
  { key: 'build_up', icon: '🧱' },
  { key: 'curiosity_hook', icon: '✨' },
  { key: 'content', icon: '📖' },
  { key: 'punchline', icon: '🎯' },
];

const DEFAULT_LABELS = {
  noParts: 'אין חלקים בתחנה זו.',
  partsOne: 'חלק אחד',
  partsMany: (n) => `${n} חלקים`,
  noContent: '— ללא תוכן —',
  mediaAndLinks: 'מדיה וקישורים',
  groups: {
    build_up: 'בילד־אפ',
    curiosity_hook: 'סקרנות',
    content: 'תוכן',
    punchline: 'פואנטה',
  },
};

function groupKeyFor(roleHint) {
  return ROLE_GROUPS.some((g) => g.key === roleHint) ? roleHint : 'content';
}

export default function StationContentView({
  tourTitle,
  title,
  description,
  heroImageUrl,
  parts = [],
  media = [],
  labels = DEFAULT_LABELS,
  // The collapsed glyph points INTO the reading direction; the default is the
  // RTL one every existing caller already renders.
  collapseGlyphs = { open: '▾', closed: '◂' },
}) {
  const [openGroups, setOpenGroups] = useState(() => new Set()); // all collapsed

  const grouped = new Map(ROLE_GROUPS.map((g) => [g.key, []]));
  for (const p of parts) grouped.get(groupKeyFor(p.roleHint)).push(p);

  function toggle(key) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

      <div className="space-y-3">
        {parts.length === 0 && (
          <div className="py-8 text-center text-gray-400">{labels.noParts}</div>
        )}
        {ROLE_GROUPS.map((g) => {
          const groupParts = grouped.get(g.key);
          if (!groupParts || groupParts.length === 0) return null;
          const open = openGroups.has(g.key);
          return (
            <section
              key={g.key}
              className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
            >
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={open}
                className="flex w-full items-center gap-2.5 px-5 py-3.5 text-start hover:bg-gray-50"
              >
                <span className="text-lg" aria-hidden>
                  {g.icon}
                </span>
                <span className="flex-1 text-[15.5px] font-bold text-gray-900">
                  {labels.groups[g.key]}
                </span>
                <span className="text-[11.5px] font-medium text-gray-400">
                  {groupParts.length === 1 ? labels.partsOne : labels.partsMany(groupParts.length)}
                </span>
                <span className="text-gray-400" aria-hidden>
                  {open ? collapseGlyphs.open : collapseGlyphs.closed}
                </span>
              </button>
              {open && (
                <div className="space-y-5 border-t border-gray-100 p-5 sm:p-6">
                  {groupParts.map((p, i) => (
                    <section key={i}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-blue-600 text-[12px] font-bold tabular-nums text-white">
                          {i + 1}
                        </span>
                        <h2 className="text-[16px] font-semibold">{p.title || ''}</h2>
                      </div>
                      {p.body ? (
                        <RichText html={p.body} className="text-gray-800" />
                      ) : (
                        <p className="text-gray-400">{labels.noContent}</p>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {media.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[15px] font-semibold text-gray-700">{labels.mediaAndLinks}</h2>
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
