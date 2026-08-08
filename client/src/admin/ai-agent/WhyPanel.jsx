// "למה?" — provenance for one proposal.
//
// This is EXECUTION CONTEXT, not reasoning. It answers "what did the agent
// actually look at", which is auditable and useful. It deliberately does NOT
// show chain-of-thought: none is requested from the model, none is stored, and
// presenting invented "reasoning" would be worse than showing nothing.

import { CONFIDENCE_LABELS, fmtDateTime } from './config.js';

const SOURCE_LABELS = {
  conversation: 'השיחה עצמה',
  contact: 'איש הקשר',
  organization: 'הארגון',
  deal: 'הדיל',
  pricing: 'תמחור',
  payment: 'מצב גבייה',
  tour: 'הסיור',
  tasks: 'משימות פתוחות',
};

export default function WhyPanel({ run }) {
  if (!run) return null;
  const pack = run.contextPack || {};
  const sources = Array.isArray(run.contextSources) ? run.contextSources : [];
  const guards = Array.isArray(run.guardFindings) ? run.guardFindings : [];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-[13px]">
      <div className="gos-detail mb-2 font-semibold text-gray-800">על מה הסוכן הסתמך</div>

      <Section title="מקורות מידע">
        {sources.length ? (
          <ul className="space-y-0.5">
            {sources.map((s) => (
              <li key={s} className="text-gray-700">• {SOURCE_LABELS[s] || s}</li>
            ))}
          </ul>
        ) : <Empty />}
      </Section>

      <Section title="נתונים קנוניים שנמסרו">
        <dl className="space-y-0.5">
          {pack.deal?.orderNo != null && <Row k="דיל" v={`#${pack.deal.orderNo}`} />}
          {pack.deal?.product && <Row k="מוצר" v={pack.deal.product} />}
          {pack.deal?.city && <Row k="עיר" v={pack.deal.city} />}
          {pack.deal?.participants != null && <Row k="משתתפים" v={String(pack.deal.participants)} />}
          {pack.tour?.date && <Row k="סיור" v={`${pack.tour.date}${pack.tour.time ? ` ${pack.tour.time}` : ''}`} />}
          {pack.tour?.meetingPoint && <Row k="נקודת מפגש" v={pack.tour.meetingPoint} />}
          {pack.pricing?.totalText && <Row k="סכום" v={pack.pricing.totalText} />}
          {pack.payment?.stateText && <Row k="גבייה" v={pack.payment.stateText} />}
        </dl>
      </Section>

      {/* The most important block on this panel: what the agent explicitly did
          NOT know. It is why an escalation happened, and it is the shopping
          list for the Knowledge screen. */}
      {pack.unknown?.length > 0 && (
        <Section title="מה לא היה ידוע לסוכן">
          <div className="flex flex-wrap gap-1">
            {[...new Set(pack.unknown)].map((u) => (
              <span key={u} className="rounded bg-amber-50 px-1.5 py-0.5 text-[12px] text-amber-800">
                {UNKNOWN_LABELS[u] || u}
              </span>
            ))}
          </div>
        </Section>
      )}

      {guards.length > 0 && (
        <Section title="בדיקות בטיחות שנכשלו">
          <ul className="space-y-0.5">
            {guards.map((g, i) => (
              <li key={`${g.code}-${i}`} className="text-rose-700">
                • {g.code}{g.detail ? ` — ${g.detail}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="גרסאות שהיו פעילות">
        <dl className="space-y-0.5">
          <Row k="מודל" v={run.model || '—'} />
          <Row k="גרסת הנחיות" v={run.promptVersion || '—'} />
          <Row k="גרסת תצורה" v={run.configSnapshotId ? run.configSnapshotId.slice(0, 8) : '—'} />
          <Row k="ודאות" v={CONFIDENCE_LABELS[run.confidence] || '—'} />
          {run.latencyMs != null && <Row k="זמן תגובה" v={`${(run.latencyMs / 1000).toFixed(1)} שנ׳`} />}
          <Row k="נוצר" v={fmtDateTime(run.createdAt)} />
        </dl>
      </Section>
    </div>
  );
}

const UNKNOWN_LABELS = {
  customer_not_linked: 'הלקוח לא משויך לכרטיס',
  deal: 'אין דיל',
  pricing: 'אין תמחור',
  payment: 'אין מצב גבייה',
  tour: 'אין סיור מאושר',
  meeting_point: 'אין נקודת מפגש',
  participant_count: 'מספר משתתפים',
};

function Section({ title, children }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="gos-meta mb-1">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex gap-2">
      <dt className="gos-meta shrink-0 w-24">{k}</dt>
      <dd className="gos-detail text-gray-800">{v}</dd>
    </div>
  );
}

function Empty() {
  return <div className="gos-meta">אין נתונים</div>;
}
