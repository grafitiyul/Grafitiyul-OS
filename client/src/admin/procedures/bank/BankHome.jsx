import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import BankListPane from './BankListPane.jsx';

// Bank tab layout: list pane on the leading edge (right in RTL), work area
// on the main edge (left in RTL). On mobile, only one of them is shown at
// a time — the list at the index route, the editor at nested routes.
export default function BankHome() {
  const { pathname } = useLocation();
  const inEditor =
    pathname !== '/admin/procedures/bank' &&
    pathname !== '/admin/procedures/bank/';

  const [content, setContent] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [c, q] = await Promise.all([
        api.contentItems.list(),
        api.questionItems.list(),
      ]);
      setContent(c);
      setQuestions(q);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const listCls = inEditor
    ? 'hidden lg:flex w-full lg:w-[360px] lg:shrink-0 lg:border-l lg:border-gray-200 bg-white flex-col min-h-0'
    : 'flex w-full lg:w-[360px] lg:shrink-0 lg:border-l lg:border-gray-200 bg-white flex-col min-h-0';

  const workCls = inEditor
    ? 'flex flex-1 bg-gray-50 min-h-0'
    : 'hidden lg:flex flex-1 bg-gray-50 min-h-0';

  return (
    <div className="h-full flex">
      <aside className={listCls}>
        <BankListPane
          content={content}
          questions={questions}
          loading={loading}
          error={error}
          onRetry={refresh}
        />
      </aside>
      <section className={workCls}>
        <Outlet context={{ refresh }} />
      </section>
    </div>
  );
}
