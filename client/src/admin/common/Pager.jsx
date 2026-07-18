// Shared pager footer for the server-paginated CRM list screens. Pure
// presentation: the parent owns `page`/`total`/`pageSize` and refetches when
// `page` changes. Shows the current range ("11-20 מתוך 240") and prev/next.
export default function Pager({ page, pageSize, total, onPage, children }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-gray-100 text-[13px] text-gray-600">
      <span className="tabular-nums">
        {from}-{to} מתוך {total}
      </span>
      <div className="flex items-center gap-3">
        {children}
        <div className="flex items-center gap-1">
          <PagerBtn disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</PagerBtn>
          <span className="px-2 tabular-nums">{page} / {pageCount}</span>
          <PagerBtn disabled={page >= pageCount} onClick={() => onPage(page + 1)}>›</PagerBtn>
        </div>
      </div>
    </div>
  );
}

function PagerBtn({ children, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
