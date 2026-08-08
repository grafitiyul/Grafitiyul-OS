import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { AGENT_TABS } from './config.js';

// סוכן AI — module shell. Mirrors CrmLayout / PeopleLayout so the tab row,
// spacing and mobile behaviour are the ones operators already know.
//
// The state strip is not decoration: this module governs something that can
// eventually message customers, so "is it on, is it configured, is anything
// waiting for me" must be answerable without navigating anywhere.
export default function AiAgentLayout() {
  const { pathname } = useLocation();
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [settings, proposals] = await Promise.all([
          api.aiAgent.settings(),
          api.aiAgent.proposals({ status: 'open', limit: 100 }),
        ]);
        if (!cancelled) {
          setState({
            enabled: settings.settings?.enabled,
            providerConfigured: settings.providerConfigured,
            pending: proposals.proposals?.length || 0,
          });
        }
      } catch {
        if (!cancelled) setState(null);
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [pathname]);

  const activeKey =
    [...AGENT_TABS]
      .filter((t) => t.path)
      .sort((a, b) => b.path.length - a.path.length)
      .find((t) => pathname.startsWith(`/admin/ai-agent/${t.path}`))?.key || 'overview';

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 bg-white overflow-x-auto">
        {AGENT_TABS.map((tab) => (
          <Link
            key={tab.key}
            to={`/admin/ai-agent${tab.path ? `/${tab.path}` : ''}`}
            className={`relative px-3 py-1.5 text-[13px] rounded-md transition ${
              activeKey === tab.key
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab.label}
            {tab.key === 'review' && state?.pending > 0 && (
              <span className="ms-1.5 inline-flex min-w-[18px] justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold text-white">
                {state.pending}
              </span>
            )}
          </Link>
        ))}
        <div className="ms-auto flex shrink-0 items-center gap-2">
          <AgentStateChip state={state} />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
        <Outlet />
      </div>
    </div>
  );
}

// The one-glance answer to "what is the agent doing right now". Deliberately
// blunt about the two states that matter most: not configured (nothing can
// work) and off (nothing is happening).
function AgentStateChip({ state }) {
  if (!state) return null;
  if (!state.providerConfigured) {
    return (
      <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[12px] font-medium text-rose-800">
        לא מוגדר בשרת
      </span>
    );
  }
  if (!state.enabled) {
    return (
      <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-[12px] font-medium text-gray-600">
        כבוי
      </span>
    );
  }
  return (
    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-800">
      פעיל — מצב צל
    </span>
  );
}
