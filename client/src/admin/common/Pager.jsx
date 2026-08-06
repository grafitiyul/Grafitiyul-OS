import { pageCountOf } from './listState.js';

// Shared pager footer for the server-paginated CRM list screens. Pure
// presentation: the parent owns `page`/`total`/`pageSize` and refetches when
// `page` changes. Shows the current range ("11-20 מתוך 240") and
// first / prev / next / last.
//
// "עבור לסוף" (last page) is a real one-hop jump: it sets the page straight to
// the computed last page, so exactly ONE fetch happens — no walking through the
// intermediate pages — and the active search / filters / sort are untouched
// because they live in the URL, not in this component.
//
// RTL note: DOM order is [first, prev, page, next, last]; under the RTL flex
// row that puts first/prev on the RIGHT, which is where "backwards" is in a
// right-to-left reading order. The glyphs keep the existing convention
// (‹ = previous), doubled for the jump-to-end controls.
export default function Pager({ page, pageSize, total, onPage, children }) {
  const pageCount = pageCountOf(total, pageSize);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const atFirst = page <= 1;
  const atLast = page >= pageCount;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-gray-100 text-[13px] text-gray-600">
      <span className="tabular-nums">
        {from}-{to} מתוך {total}
      </span>
      <div className="flex items-center gap-3">
        {children}
        <div className="flex items-center gap-1">
          <PagerBtn disabled={atFirst} onClick={() => onPage(1)} label="עבור לתחילת הרשימה">
            ‹‹
          </PagerBtn>
          <PagerBtn disabled={atFirst} onClick={() => onPage(page - 1)} label="העמוד הקודם">
            ‹
          </PagerBtn>
          <span className="px-2 tabular-nums">{page} / {pageCount}</span>
          <PagerBtn disabled={atLast} onClick={() => onPage(page + 1)} label="העמוד הבא">
            ›
          </PagerBtn>
          <PagerBtn disabled={atLast} onClick={() => onPage(pageCount)} label="עבור לסוף">
            ››
          </PagerBtn>
        </div>
      </div>
    </div>
  );
}

function PagerBtn({ children, disabled, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="h-8 w-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-default"
    >
      {children}
    </button>
  );
}
