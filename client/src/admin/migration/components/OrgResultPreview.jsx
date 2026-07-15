import { num } from './format.js';

// "התוצאה לאחר ההעברה" — the complete post-migration result of this cluster.
// Updates live while the owner edits. Shows every source record's destination,
// including the ones leaving for another organization and the excluded ones.
export default function OrgResultPreview({ result, typeLabel }) {
  return (
    <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-900">התוצאה לאחר ההעברה</h3>
        <span className="text-[11px] text-gray-500">
          {num(result.totals.sourceRecords)} רשומות מקור · {num(result.totals.dealsAffected)} עסקאות · {num(result.totals.contactsAffected)} אנשי קשר
        </span>
      </div>

      <Section label="ארגון שייווצר / ישויך">
        {result.organization ? (
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
            <div className="text-[15px] font-semibold text-gray-900 break-words">
              {result.organization.name || <span className="text-red-500 font-normal">— חסר שם —</span>}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {typeLabel ? `סוג: ${typeLabel} · ` : ''}
              {num(result.organization.deals)} עסקאות · {num(result.organization.contacts)} אנשי קשר
              {result.organization.mergeIntoGosId ? ' · ימוזג לארגון קיים ב-GOS' : ''}
            </div>
            <div className="text-[11px] text-gray-400 mt-1 break-words">
              מרשומות: {result.organization.members.map((m) => m.name).join(' · ')}
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-gray-400">לא ייווצר ארגון מהקבוצה הזו</div>
        )}
      </Section>

      <Section label="יחידות">
        {result.units.length ? (
          <ul className="space-y-1">
            {result.units.map((u) => (
              <li key={u.key} className="bg-white border border-gray-200 rounded-lg px-3 py-2">
                <div className="text-[13px] font-medium text-gray-900 break-words">
                  • {u.name || <span className="text-red-500 font-normal">— חסר שם —</span>}
                </div>
                <div className="text-[11px] text-gray-400 break-words">
                  {num(u.deals)} עסקאות · מרשומות: {u.members.map((m) => m.name).join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="text-[12px] text-gray-400">אין יחידות</div>}
      </Section>

      {result.elsewhere.length > 0 && (
        <Section label="רשומות שממופות לארגון אחר">
          <ul className="space-y-1">
            {result.elsewhere.map((e) => (
              <li key={e.legacyId} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-[13px]">
                <span className="text-gray-900">{e.name}</span>
                <span className="text-gray-400"> → </span>
                <b className="text-blue-700">{e.targetName}</b>
                {e.targetUnitName ? <span className="text-blue-700"> / {e.targetUnitName}</span> : null}
                <span className="text-[11px] text-gray-400"> · {num(e.deals)} עסקאות</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {result.excluded.length > 0 && (
        <Section label="רשומות שלא ייווצר מהן ארגון">
          <ul className="space-y-1">
            {result.excluded.map((e) => (
              <li key={e.legacyId} className="bg-white border border-red-200 rounded-lg px-3 py-1.5">
                <div className="text-[13px] text-gray-900">{e.name}</div>
                <div className="text-[11px] text-gray-500">
                  {e.deals ? `${num(e.deals)} עסקאות → ${TREAT[e.treatment?.deals] || 'ללא יעד'}` : 'אין עסקאות'}
                  {' · '}
                  {e.contacts ? `${num(e.contacts)} אנשי קשר → ${TREAT[e.treatment?.contacts] || 'ללא יעד'}` : 'אין אנשי קשר'}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {result.emptyUnits.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
          יחידות ללא רשומות משויכות לא ייווצרו: {result.emptyUnits.map((u) => u.name || '(ללא שם)').join(' · ')}
        </p>
      )}
      {result.warnings.map((w) => (
        <p key={w} className="text-[12px] text-red-800 bg-red-50 border border-red-300 rounded px-2 py-1 mt-2 font-medium">⚠ {w}</p>
      ))}
      {result.problems.length > 0 && (
        <ul className="mt-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 space-y-0.5">
          {result.problems.map((p) => <li key={p}>• {p}</li>)}
        </ul>
      )}
    </div>
  );
}

const TREAT = {
  reassign: 'ארגון אחר',
  exceptional: 'רשומות חריגות',
  no_organization: 'ללא ארגון',
};

function Section({ label, children }) {
  return (
    <div className="mb-3">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
