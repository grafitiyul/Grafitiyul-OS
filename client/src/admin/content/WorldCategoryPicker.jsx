// THE world-first organisation control.
//
// The operator's mental model, enforced by the UI shape itself:
//   1. לאיזה עולם תוכן זה שייך?
//   2. באילו קטגוריות בתוך אותו עולם?
//
// Categories are NEVER shown as one flat list. They appear grouped under the
// world they belong to, and only for worlds that are actually selected — so
// "הרצאות" under GOS and "הרצאות" under CHALLENGE can never be confused, and a
// category from an unselected world simply is not offerable.
//
// The server enforces the same rule (worlds.js): UI filtering is convenience,
// never the guarantee.

function Chip({ on, children, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        on ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600 hover:border-gray-400'
      }`}
    >
      {children}
    </button>
  );
}

export default function WorldCategoryPicker({
  worlds = [],
  categories = [],
  selectedWorldIds = [],
  selectedCategoryIds = [],
  onWorldsChange,
  onCategoriesChange,
  // Categories that would be dropped by the pending world change — shown as a
  // warning so removing a world never silently discards them.
  pendingLoss = [],
  compact = false,
}) {
  const selected = new Set(selectedWorldIds);

  function toggleWorld(id) {
    const next = selected.has(id)
      ? selectedWorldIds.filter((w) => w !== id)
      : [...selectedWorldIds, id];
    onWorldsChange(next);
    // Drop category selections that no longer belong to any selected world, so
    // the visible state can never contradict what the server would accept.
    const stillValid = new Set(next);
    onCategoriesChange(
      selectedCategoryIds.filter((cid) => {
        const cat = categories.find((c) => c.id === cid);
        return cat && stillValid.has(cat.worldId);
      }),
    );
  }

  function toggleCategory(id) {
    onCategoriesChange(
      selectedCategoryIds.includes(id)
        ? selectedCategoryIds.filter((c) => c !== id)
        : [...selectedCategoryIds, id],
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="block text-sm font-medium text-gray-700">עולם תוכן</span>
        {!compact && (
          <span className="mt-0.5 block text-xs text-gray-500">
            הבחירה הראשונה. אפשר לשייך פריט ליותר מעולם אחד.
          </span>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {worlds.map((w) => (
            <Chip key={w.id} on={selected.has(w.id)} onClick={() => toggleWorld(w.id)}>
              {w.nameHe}
            </Chip>
          ))}
          {worlds.length === 0 && <span className="text-sm text-gray-500">אין עולמות תוכן.</span>}
        </div>
      </div>

      {pendingLoss.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          הסרת העולם תסיר גם את הקטגוריות שלו מהפריט:{' '}
          <strong>{pendingLoss.map((c) => c.nameHe).join(', ')}</strong>
        </p>
      )}

      {selectedWorldIds.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
          בחרו עולם תוכן כדי לראות את הקטגוריות שלו.
        </p>
      ) : (
        <div className="space-y-3">
          <span className="block text-sm font-medium text-gray-700">קטגוריות</span>
          {selectedWorldIds.map((wid) => {
            const world = worlds.find((w) => w.id === wid);
            const cats = categories.filter((c) => c.worldId === wid);
            if (!world) return null;
            return (
              <div key={wid} className="rounded-lg border border-gray-200 p-3">
                {/* The world label stays visible above its own categories, so a
                    two-world item is never ambiguous about which is which. */}
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {world.nameHe}
                </div>
                {cats.length === 0 ? (
                  <p className="text-xs text-gray-400">אין עדיין קטגוריות בעולם הזה.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {cats.map((c) => (
                      <Chip
                        key={c.id}
                        on={selectedCategoryIds.includes(c.id)}
                        onClick={() => toggleCategory(c.id)}
                      >
                        {c.nameHe}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
