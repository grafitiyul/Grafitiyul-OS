import { useEffect, useState, useCallback, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { migrationApi } from '../api.js';
import { num, dateTime } from '../components/format.js';
import SourceRecord from '../components/SourceRecord.jsx';
import { nameDraftFromProposal, resolveNameResult, COUNTRIES, zeroDealOrgDefault } from '../components/namePreview.js';

const SECTIONS = [
  { key: 'critical', emoji: '🔥', label: 'קריטי לפני ייבוא', cls: 'bg-red-50 border-red-200 text-red-800' },
  { key: 'recent', emoji: '🟠', label: 'עסקים אחרונים', cls: 'bg-orange-50 border-orange-200 text-orange-800' },
  { key: 'historical', emoji: '🟡', label: 'היסטוריה עסקית', cls: 'bg-amber-50 border-amber-200 text-amber-800' },
  { key: 'low', emoji: '⚪', label: 'עדיפות נמוכה', cls: 'bg-gray-50 border-gray-200 text-gray-700' },
  { key: 'none', emoji: '⚫', label: 'לא נדרשת הכרעה', cls: 'bg-gray-100 border-gray-300 text-gray-500' },
];
const STATUS = {
  pending: { label: 'ממתין', cls: 'bg-gray-100 text-gray-600' },
  approved: { label: 'אושר', cls: 'bg-green-50 text-green-700' },
  edited: { label: 'אושר בעריכה', cls: 'bg-green-50 text-green-700' },
  rejected: { label: 'נשמר כמקור', cls: 'bg-blue-50 text-blue-700' },
  deferred: { label: 'נדחה למועד אחר', cls: 'bg-amber-50 text-amber-800' },
};
const FIELDS = [
  ['firstNameHe', 'שם פרטי (עברית)'],
  ['lastNameHe', 'שם משפחה (עברית)'],
  ['firstNameEn', 'שם פרטי (אנגלית)'],
  ['lastNameEn', 'שם משפחה (אנגלית)'],
];

export default function NameCleanupTab() {
  const { reload } = useOutletContext() || {};
  const [section, setSection] = useState('critical');
  // The mandatory view: only rows whose import would FAIL (the readiness-gate
  // blocker). Spans sections, so it replaces the section filter while active.
  const [mustOnly, setMustOnly] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState('');
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  // Existing-organisation targets (the same registry the Organizations tab uses),
  // loaded once on first entering "זה ארגון" mode.
  const [orgTargets, setOrgTargets] = useState(null);

  async function enterOrgMode() {
    // THE BUSINESS RULE: "this is an organization" + zero deals (and zero
    // participant links) defaults to DELETION, not to an org and not to
    // "do not import". The delete panel offers the explicit keep-override.
    const zeroDeal = selected && zeroDealOrgDefault(selected.proposal);
    setDraft((dr) => {
      if (dr.treatment === 'organization' || dr.treatment === 'deleted') return { ...dr, treatment: 'import' };
      return zeroDeal ? { ...dr, treatment: 'deleted' } : { ...dr, treatment: 'organization' };
    });
    if (!orgTargets) {
      try { setOrgTargets(await migrationApi.orgTargets()); } catch { setOrgTargets({ proposals: [], gos: [] }); }
    }
  }
  function enterDeleteMode() {
    setDraft((dr) => ({ ...dr, treatment: dr.treatment === 'deleted' ? 'import' : 'deleted' }));
  }
  function keepAsOrgAnyway() {
    // The explicit override of the zero-deal rule: keep it, as an organisation.
    setDraft((dr) => ({ ...dr, treatment: 'organization', organization: { ...dr.organization, create: true } }));
  }

  const load = useCallback(async () => {
    try {
      setData(await migrationApi.queue('name_cleanup', showResolved ? null : 'unresolved', mustOnly ? null : section));
      setError(null);
    } catch { setError('טעינת התור נכשלה'); }
  }, [section, showResolved, mustOnly]);
  useEffect(() => { load(); }, [load]);

  const shown = mustOnly
    ? (data?.decisions || []).filter((d) => d.proposal.blocking)
    : data?.decisions || [];
  const selected = shown.find((d) => d.id === openId) || null;
  // The mirror resolves with the same context the server will use on save: the
  // person's identity correction and the shared claimed-phone index.
  const result = useMemo(
    () => (selected && draft
      ? resolveNameResult(selected.proposal, draft, {
          identityEdit: selected.identityEdit,
          claimedPhones: data?.claimedPhones || {},
          selfLegacyId: selected.proposal.legacyId,
        })
      : null),
    [selected, draft, data],
  );
  const counts = data?.sectionCounts || {};
  const batchable = data?.batchApprovable ?? 0;

  function select(d) {
    setOpenId(d.id); setSource(null); setNote(d.note || '');
    setDraft(nameDraftFromProposal(d.proposal, d.decision));
  }
  function setPhone(i, patch) {
    setDraft((dr) => {
      const phones = dr.phones.map((p, j) => {
        if (j !== i) return p;
        const next = { ...p, ...patch };
        // Changing country resets the confirmation — it belonged to the OLD choice.
        if (patch.country && patch.country !== p.country) next.confirmUnverified = false;
        return next;
      });
      // At most one preferred phone: setting one clears the others.
      if (patch.isPrimary) for (let j = 0; j < phones.length; j++) if (j !== i) phones[j] = { ...phones[j], isPrimary: false };
      return { ...dr, phones };
    });
  }
  async function act(action, decisionOverride = null) {
    setBusy(true);
    try {
      await migrationApi.decide(selected.id, {
        action,
        decision: ['approve', 'edit'].includes(action) ? (decisionOverride || draft) : null,
        note: note || null,
      });
      await load(); reload?.();
      setOpenId(null); setDraft(null);
    } catch (e) { setError(e?.body?.problems?.join(' · ') || 'שמירת ההחלטה נכשלה'); }
    setBusy(false);
  }
  async function batchApprove() {
    setBusy(true);
    try {
      const r = await migrationApi.batchApproveSafe('name_cleanup');
      setMsg(`אושרו ${num(r.approved)} תיקונים דטרמיניסטיים. ${num(r.skipped)} נותרו להכרעה פרטנית.`);
      await load(); reload?.();
    } catch { setError('האישור הקבוצתי נכשל'); }
    setBusy(false);
  }

  if (error) return <div className="p-4"><div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div></div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">טוען…</div>;
  if (!data.counts.all) {
    return (
      <div className="p-6">
        <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">✍️</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">אין הצעות עדיין</h2>
          <p className="text-sm text-gray-500">ההצעות נבנות מהצילום בתהליך נפרד.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-3">
        <p className="text-[13px] text-gray-700">
          כאן מופיעות <b>רק</b> רשומות שהשם שלהן לא נכנס נקי למודל של GOS.
          שם פרטי בלי שם משפחה הוא <b>תקין לגמרי</b> ולא מופיע כאן.
        </p>
        <p className="text-[11px] text-gray-400 mt-1">
          הכלל הקנוני של GOS: חייב שם פרטי — בעברית או באנגלית. שם משפחה יכול להישאר ריק.
        </p>
        {batchable > 0 && (
          <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-gray-100">
            <div className="text-[13px] text-gray-700">
              <b>{num(batchable)}</b> תיקונים דטרמיניסטיים — אותו טקסט בדיוק, רק בשדה הנכון. הזהות לא משתנה.
            </div>
            <button type="button" disabled={busy} onClick={batchApprove}
              className="text-[13px] px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 mr-auto">
              אשר את כל {num(batchable)} התיקונים הדטרמיניסטיים
            </button>
          </div>
        )}
        {msg && <div className="mt-2 text-[12px] text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1">{msg}</div>}
      </div>

      <div className="flex flex-wrap gap-1 mb-1">
        {/* The MANDATORY work — the exact rows keeping the readiness gate red.
            A validation dimension, not a business-impact section: the same rows
            also live inside historical/low, and this chip cuts across them. */}
        <button type="button"
          onClick={() => { setMustOnly(!mustOnly); setOpenId(null); setDraft(null); }}
          className={`text-[12px] px-2.5 py-1.5 rounded-lg border transition font-semibold ${
            mustOnly ? 'bg-red-600 border-red-600 text-white' : (data.blockingUnresolved ? 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100' : 'bg-green-50 border-green-200 text-green-800')}`}>
          ⛔ חובה לפני ייבוא — הייבוא ייכשל ({num(data.blockingUnresolved ?? 0)})
        </button>
        {SECTIONS.map((s) => (
          <button key={s.key} type="button"
            onClick={() => { setMustOnly(false); setSection(s.key); setOpenId(null); setDraft(null); }}
            className={`text-[12px] px-2.5 py-1.5 rounded-lg border transition ${!mustOnly && section === s.key ? `${s.cls} font-semibold` : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {s.emoji} {s.label} <span className="opacity-70">({num(counts[s.key] ?? 0)})</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="flex items-center gap-1.5 text-[12px] text-gray-500">
          <input type="checkbox" checked={showResolved} onChange={(e) => { setShowResolved(e.target.checked); setOpenId(null); }} />
          הצג גם רשומות שכבר הוכרעו
        </label>
        <span className="text-[12px] text-gray-400">{num(shown.length)} מוצגות</span>
        {mustOnly && (
          <span className="text-[12px] text-red-700">
            אלה הרשומות היחידות שעדיין חוסמות את ייבוא הזהויות — כל השאר רשות.
          </span>
        )}
      </div>

      {section === 'none' && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 mb-3 text-[12px] text-gray-600">
          לרשומות האלה אין אף עסקה, פעילות, הערה או קובץ — הן לא ייווצרו כאנשי קשר ב-GOS, ולכן
          <b> אין מה להכריע בשמות שלהן</b>. מוצג לשקיפות בלבד.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[22rem_1fr] gap-3">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
            {shown.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => select(d)} className={`w-full text-right px-3 py-2.5 hover:bg-gray-50 ${openId === d.id ? 'bg-blue-50' : ''}`}>
                  <div className="text-[13px] font-medium text-gray-900 truncate mb-1">{d.proposal.displayName}</div>
                  <div className="flex flex-wrap items-center gap-1">
                    {d.proposal.blocking && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">הייבוא ייכשל</span>}
                    {d.proposal.batchApprovable && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">דטרמיניסטי</span>}
                    {!d.proposal.batchApprovable && d.proposal.decisionRequired && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">לא חד-משמעי</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS[d.status]?.cls}`}>{STATUS[d.status]?.label}</span>
                    <span className="text-[10px] text-gray-400 truncate">{d.proposal.issueLabels[0]}</span>
                  </div>
                </button>
              </li>
            ))}
            {!shown.length && (
              <li className="px-3 py-8 text-center text-[13px] text-gray-400">
                {mustOnly
                  ? '✓ אין יותר רשומות שחוסמות את ייבוא הזהויות'
                  : section === 'critical' ? '✓ אין כאן כלום — אף שם בעייתי לא נוגע לתפעול חי' : 'אין פריטים בסינון הזה'}
              </li>
            )}
          </ul>
        </div>

        <div className="min-w-0">
          {!selected || !draft ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-[13px] text-gray-400">בחר רשומה מהרשימה</div>
          ) : (
            <div className="space-y-3">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">מה לא תקין</h3>
                  {selected.proposal.issueLabels.map((l) => (
                    <span key={l} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">{l}</span>
                  ))}
                </div>
                <p className="text-[13px] text-gray-600 leading-relaxed">{selected.proposal.reason}</p>
                {!selected.proposal.validationBefore.valid && (
                  <p className="mt-2 text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">
                    ללא תיקון הייבוא ייכשל: {selected.proposal.validationBefore.problems.join(' · ')}
                  </p>
                )}
              </div>

              {/* EXACT source fields — always shown, never rewritten. */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex justify-between items-baseline mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">שדות המקור המדויקים ב-Pipedrive</h3>
                  <button type="button" onClick={() => setSource(selected.proposal.source)} className="text-[11px] text-blue-700 hover:underline">רשומת מקור →</button>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px]">
                  <Field label="name" value={selected.proposal.original.name} />
                  <Field label="first_name" value={selected.proposal.original.first_name} />
                  <Field label="last_name" value={selected.proposal.original.last_name} />
                </dl>
                <div className="mt-2 pt-2 border-t border-gray-100 text-[12px] text-gray-500 space-y-0.5">
                  {selected.proposal.context.phones.length > 0 && <div>טלפון: {selected.proposal.context.phones.join(' · ')}</div>}
                  {selected.proposal.context.emails.length > 0 && <div>אימייל: {selected.proposal.context.emails.join(' · ')}</div>}
                  {selected.proposal.context.orgName && <div>ארגון: {selected.proposal.context.orgName}</div>}
                  <div>
                    {num(selected.proposal.context.dealCount)} עסקאות
                    {selected.proposal.context.openDealCount ? <b className="text-red-700"> · {num(selected.proposal.context.openDealCount)} פתוחות</b> : null}
                    {selected.proposal.context.futureTourDeals ? <b className="text-blue-700"> · {num(selected.proposal.context.futureTourDeals)} סיור עתידי</b> : null}
                    {selected.proposal.context.activityCount ? ` · ${num(selected.proposal.context.activityCount)} פעילויות` : ''}
                  </div>
                </div>
              </div>

              {source && (
                <div className="bg-white border border-gray-200 rounded-xl p-3">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold text-gray-900">רשומת מקור מלאה</h3>
                    <button type="button" onClick={() => setSource(null)} className="text-[12px] text-gray-500 hover:underline">סגור</button>
                  </div>
                  <SourceRecord entity={source.entity} id={source.id} onOpenRef={setSource} />
                </div>
              )}

              {/* "זו שטות מוחלטת" — the binding destructive decision. ONE inline
                  confirmation (never a native dialog); blockers render in place. */}
              {draft.treatment === 'deleted' && (
                <div className="bg-white border-2 border-red-300 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-red-800 mb-1">🗑️ זו שטות מוחלטת — מחק את הרשומה</h3>
                  {zeroDealOrgDefault(selected.proposal) && (
                    <p className="text-[12px] text-gray-600 mb-2">
                      זו ברירת המחדל לפי כלל העסק: ארגון בלי אף עסקה ובלי קישורי משתתפים לא נשמר.
                    </p>
                  )}
                  <div className="text-[12px] text-gray-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 mb-2">
                    הרשומה לא תיווצר ב-GOS ולא תופיע כישות בארכיון המערכת הקודמת.
                    צילום המקור הגולמי נשמר רק לצורכי ביקורת.
                  </div>
                  <div className="text-[11px] text-gray-500 mb-2">
                    בדיקת בטיחות: עסקאות {num(selected.proposal.context.dealCount)} ·
                    קישורי משתתף משני {selected.proposal.context.participantCount ?? '?'} ·
                    (פעילויות {num(selected.proposal.context.activityCount)}, הערות {num(selected.proposal.context.noteCount)} — אינן חוסמות)
                  </div>
                  {result?.problems?.map((p) => (
                    <p key={p} className="text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1 mb-1">{p}</p>
                  ))}
                  {result?.warnings?.map((w) => (
                    <p key={w} className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">{w}</p>
                  ))}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button type="button" disabled={busy || !result?.valid} onClick={() => act('edit', draft)}
                      className="text-[13px] px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 font-semibold">
                      מחק סופית — אני מאשר
                    </button>
                    <button type="button" disabled={busy} onClick={keepAsOrgAnyway}
                      className="text-[13px] px-3 py-1.5 rounded-md border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                      בכל זאת השאר — צור/שייך ארגון
                    </button>
                    <button type="button" disabled={busy} onClick={() => setDraft({ ...draft, treatment: 'import' })}
                      className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      ביטול
                    </button>
                  </div>
                </div>
              )}

              {/* "This is an Organization" — the business rule made visible. */}
              {draft.treatment === 'organization' && (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">זה ארגון — לא איש קשר</h3>
                  <div className={`text-[12px] rounded-lg border px-2.5 py-2 mb-3 ${selected.proposal.context.dealCount > 0 ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                    {selected.proposal.context.dealCount > 0
                      ? <>לרשומה <b>{num(selected.proposal.context.dealCount)} עסקאות</b> — לפי כלל העסק ייווצר ארגון ב-GOS (אפשר לבטל).</>
                      : <>לרשומה <b>אפס עסקאות</b> — לפי כלל העסק היא <b>לא תיובא</b>. פעילויות והערות ישנות אינן סיבה מספקת לארגון. אפשר לעקוף במפורש.</>}
                  </div>
                  <label className="flex items-center gap-2 text-[13px] mb-2">
                    <input type="checkbox" checked={draft.organization.create}
                      onChange={(e) => setDraft({ ...draft, organization: { ...draft.organization, create: e.target.checked } })} />
                    צור ארגון ב-GOS
                  </label>
                  {draft.organization.create && (
                    <div className="space-y-2 pr-5">
                      <label className="flex items-center gap-2 text-[12px]">
                        <input type="radio" name={`orgmode-${selected.id}`} checked={!draft.organization.targetOrganizationKey}
                          onChange={() => setDraft({ ...draft, organization: { ...draft.organization, targetOrganizationKey: null, targetLabel: null } })} />
                        ארגון חדש בשם:
                        <input type="text" value={draft.organization.name} disabled={!!draft.organization.targetOrganizationKey}
                          onChange={(e) => setDraft({ ...draft, organization: { ...draft.organization, name: e.target.value } })}
                          className="text-[13px] border border-gray-200 rounded-md px-2 py-1 bg-white flex-1 disabled:bg-gray-50" />
                      </label>
                      <label className="flex items-center gap-2 text-[12px]">
                        <input type="radio" name={`orgmode-${selected.id}`} checked={!!draft.organization.targetOrganizationKey}
                          onChange={() => { /* selecting from the dropdown activates this */ }} disabled={!orgTargets} />
                        שייך לארגון קיים:
                        <select
                          value={draft.organization.targetOrganizationKey || ''}
                          onChange={(e) => {
                            const key = e.target.value || null;
                            const all = [...(orgTargets?.proposals || []), ...(orgTargets?.gos || [])];
                            const hit = all.find((x) => x.key === key);
                            setDraft({ ...draft, organization: { ...draft.organization, targetOrganizationKey: key, targetLabel: hit?.name || null } });
                          }}
                          className="text-[12px] border border-gray-200 rounded-md px-1.5 py-1 bg-white flex-1">
                          <option value="">{orgTargets ? '— בחר ארגון —' : 'טוען…'}</option>
                          {(orgTargets?.proposals || []).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                          {(orgTargets?.gos || []).map((x) => <option key={x.key} value={x.key}>{x.name} (קיים ב-GOS)</option>)}
                        </select>
                      </label>
                      <p className="text-[11px] text-gray-400">
                        שיוך לארגון קיים מונע כפילות — אם "{selected.proposal.displayName}" כבר קיים בתור הארגונים, בחר אותו כאן.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Editable final fields — the owner's values are binding. */}
              {draft.treatment !== 'organization' && draft.treatment !== 'deleted' && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">השדות הסופיים ב-GOS</h3>
                <p className="text-[11px] text-gray-400 mb-3">
                  מה שתשמור כאן הוא מה שייווצר בייבוא הזהויות. מלא רק את השדות הרלוונטיים — שדה ריק נשאר ריק,
                  ועברית לא מועתקת לאנגלית (ולהפך) אוטומטית.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {FIELDS.map(([k, label]) => {
                    // The per-field ORIGINAL: what this GOS field would hold with no
                    // cleanup at all (the default script split of the Pipedrive name).
                    const orig = selected.proposal.currentMapping?.[k] || '';
                    const changed = (draft.fields[k] || '') !== orig;
                    return (
                      <label key={k} className="block">
                        <span className="flex items-baseline justify-between text-[11px] mb-0.5">
                          <span className="text-gray-500">{label}</span>
                          <span className={changed ? 'text-amber-700' : 'text-gray-400'}>
                            מקור: {orig || 'ריק'}
                          </span>
                        </span>
                        <input
                          type="text" value={draft.fields[k]} disabled={draft.treatment === 'exclude'}
                          onChange={(e) => setDraft({ ...draft, fields: { ...draft.fields, [k]: e.target.value } })}
                          className={`w-full text-[13px] border rounded-md px-2 py-1.5 bg-white disabled:bg-gray-50 disabled:text-gray-400 ${changed ? 'border-amber-300' : 'border-gray-200'}`}
                        />
                      </label>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button"
                    onClick={() => setDraft({ ...nameDraftFromProposal({ ...selected.proposal, proposedFields: selected.proposal.currentMapping, treatment: 'import' }, null), phones: draft.phones })}
                    className="text-[12px] px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
                    השאר את המקור כמו שהוא
                  </button>
                  <button type="button" onClick={() => setDraft(nameDraftFromProposal(selected.proposal, null))}
                    className="text-[12px] px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
                    חזור להצעה
                  </button>
                </div>
              </div>
              )}

              {/* Phones — country drives normalization; nothing is guessed. */}
              {!['exclude', 'organization', 'deleted'].includes(draft.treatment) && draft.phones.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">טלפונים</h3>
                  <p className="text-[11px] text-gray-400 mb-3">
                    המדינה קובעת את הנרמול. הסרת מספר לא מוחקת אותו מהארכיון — הוא פשוט לא ייובא.
                  </p>
                  <div className="space-y-2">
                    {draft.phones.map((p, i) => {
                      const r = result?.phones?.[i];
                      return (
                        <div key={`${p.original}-${i}`} className={`border rounded-lg p-2.5 ${p.remove ? 'border-gray-200 bg-gray-50 opacity-70' : r?.problems?.length ? 'border-red-200 bg-red-50/30' : 'border-gray-200'}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-[11px] ${p.value !== p.original ? 'text-amber-700' : 'text-gray-400'}`}>
                              מקור: <b dir="ltr">{p.original}</b>
                            </span>
                            <label className="flex items-center gap-1 text-[11px] text-gray-500 mr-auto">
                              <input type="checkbox" checked={p.remove} onChange={(e) => setPhone(i, { remove: e.target.checked })} />
                              הסר
                            </label>
                          </div>
                          {!p.remove && (
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              <select value={p.country} onChange={(e) => setPhone(i, { country: e.target.value })}
                                className="text-[12px] border border-gray-200 rounded-md px-1.5 py-1 bg-white">
                                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                              </select>
                              <input type="text" dir="ltr" value={p.value} onChange={(e) => setPhone(i, { value: e.target.value })}
                                className={`text-[13px] border rounded-md px-2 py-1 bg-white w-44 ${p.value !== p.original ? 'border-amber-300' : 'border-gray-200'}`} />
                              <label className="flex items-center gap-1 text-[11px] text-gray-500">
                                <input type="radio" name={`primary-${selected.id}`} checked={p.isPrimary} onChange={() => setPhone(i, { isPrimary: true })} />
                                מועדף
                              </label>
                              {r?.normalized && (
                                <span className="text-[11px] text-green-700">ייובא להשוואה כ־<b dir="ltr">+{r.normalized}</b></span>
                              )}
                            </div>
                          )}
                          {!p.remove && p.country === 'OTHER' && (
                            <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-amber-800">
                              <input type="checkbox" checked={p.confirmUnverified} onChange={(e) => setPhone(i, { confirmUnverified: e.target.checked })} />
                              אני מאשר לייבא את המספר כפי שהוא, ללא נרמול
                            </label>
                          )}
                          {!p.remove && r?.problems?.map((prob) => (
                            <p key={prob} className="mt-1 text-[11px] text-red-700">{prob}</p>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* The final imported Contact, exactly as GOS will create it. */}
              {result && (
                <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">
                    {result.deleted || result.organization ? 'התוצאה ב-GOS' : 'איש הקשר שייווצר ב-GOS'}
                  </h3>
                  {result.deleted ? (
                    <p className="text-[13px] text-red-800 bg-white border border-red-200 rounded-lg px-3 py-2">
                      🗑️ <b>נמחק.</b> לא ייווצר איש קשר ולא ארגון, הרשומה לא תופיע בארכיון,
                      ואף החלטה אחרת לא תוכל לאחד או למפות אותה. צילום המקור נשמר לביקורת בלבד.
                    </p>
                  ) : result.organization ? (
                    result.organization.create ? (
                      <p className="text-[13px] text-gray-900 bg-white border border-gray-200 rounded-lg px-3 py-2">
                        {result.organization.targetOrganizationKey
                          ? <>ישויך לארגון הקיים: <b>{result.organization.targetLabel || result.organization.targetOrganizationKey}</b></>
                          : <>ייווצר ארגון: <b>{result.organization.name || '(ללא שם)'}</b></>}
                        <span className="block text-[11px] text-gray-500 mt-0.5">לא ייווצר איש קשר.</span>
                      </p>
                    ) : (
                      <p className="text-[13px] text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2">
                        זה ארגון, אבל <b>הוא לא ייובא</b> — אפס עסקאות. נשמר בצילום ובארכיון לתמיד.
                      </p>
                    )
                  ) : result.excluded ? (
                    <p className="text-[13px] text-red-800">הרשומה לא תיווצר כאיש קשר ב-GOS. היא נשמרת בצילום ובארכיון.</p>
                  ) : (
                    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 space-y-1.5">
                      <div>
                        {result.displayHe && <div className="text-[14px] font-semibold text-gray-900">{result.displayHe}</div>}
                        {result.displayEn && <div className="text-[13px] text-gray-700" dir="ltr">{result.displayEn}</div>}
                        {!result.displayHe && !result.displayEn && <div className="text-[13px] text-red-700">ללא שם</div>}
                      </div>
                      {result.phones?.filter((p) => !p.remove).length > 0 && (
                        <div className="text-[12px] text-gray-600 border-t border-gray-100 pt-1.5">
                          {result.phones.filter((p) => !p.remove).map((p) => (
                            <div key={p.original} dir="ltr" className="text-left">
                              {p.value}{p.normalized ? ` → +${p.normalized}` : ' (ללא נרמול)'}{p.isPrimary ? ' ★' : ''}
                            </div>
                          ))}
                        </div>
                      )}
                      {result.emails.length > 0 && (
                        <div className="text-[12px] text-gray-600 border-t border-gray-100 pt-1.5" dir="ltr">
                          {result.emails.join(' · ')}
                        </div>
                      )}
                      {selected.identityEdit && (
                        <p className="text-[11px] text-blue-800">כולל תיקון נתוני מקור שכבר נרשם</p>
                      )}
                      {selected.orgDestination && (
                        <div className="text-[12px] text-gray-600 border-t border-gray-100 pt-1.5">
                          ארגון: <b>{selected.orgDestination.label}</b>
                          {selected.orgDestination.pending && <span className="text-[11px] text-amber-700"> (טרם הוכרע בתור הארגונים)</span>}
                        </div>
                      )}
                    </div>
                  )}
                  {result.warnings.map((w) => (
                    <p key={w} className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{w}</p>
                  ))}
                  {result.problems.map((p) => (
                    <p key={p} className="mt-2 text-[12px] text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1">{p}</p>
                  ))}
                </div>
              )}

              <div className="bg-white border border-gray-200 rounded-xl p-4">
                {(selected.resolved || selected.status === 'deferred') && (
                  <p className="text-[11px] text-gray-400 mb-2">
                    {STATUS[selected.status]?.label} · {selected.decidedByName || '—'} · {dateTime(selected.decidedAt)}
                  </p>
                )}
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערת החלטה (לא חובה)"
                  className="w-full text-[13px] border border-gray-200 rounded-md px-2 py-1.5 bg-white mb-2" />
                <div className="flex flex-wrap gap-2">
                  {draft.treatment !== 'deleted' && (
                    <button type="button" disabled={busy || !result?.valid || draft.treatment === 'exclude'}
                      onClick={() => act('edit', draft.treatment === 'organization' ? draft : { ...draft, treatment: 'import' })}
                      className="text-[13px] px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                      {draft.treatment === 'organization' ? 'זה ארגון — אשר' : 'זה אדם — אשר'}
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={enterOrgMode}
                    className={`text-[13px] px-3 py-1.5 rounded-md border disabled:opacity-50 ${draft.treatment === 'organization' ? 'bg-blue-50 border-blue-300 text-blue-800 font-semibold' : 'border-blue-200 text-blue-700 hover:bg-blue-50'}`}>
                    {draft.treatment === 'organization' ? '← חזור לעריכת אדם' : 'זה ארגון'}
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => act('edit', { treatment: 'exclude', fields: draft.fields })}
                    className="text-[13px] px-3 py-1.5 rounded-md border border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-50">זה לא איש קשר</button>
                  <button type="button" disabled={busy} onClick={enterDeleteMode}
                    className={`text-[13px] px-3 py-1.5 rounded-md border disabled:opacity-50 ${draft.treatment === 'deleted' ? 'bg-red-600 border-red-600 text-white font-semibold' : 'border-red-300 text-red-700 hover:bg-red-50'}`}>
                    🗑️ זו שטות מוחלטת — מחק את הרשומה
                  </button>
                  <button type="button" disabled={busy} onClick={() => act('defer')}
                    className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">דחה לבדיקה</button>
                </div>
                {/* The permanent architecture note the owner asked for — always visible. */}
                <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 mt-2">
                  🔒 <b>הצילום המקורי לעולם לא משתנה.</b> השינויים כאן משפיעים רק על רשומת ה-GOS
                  שתיווצר בייבוא — הערכים המקוריים נשארים בצילום ובארכיון לתמיד.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
      <dt className="text-[10px] text-gray-400 font-mono">{label}</dt>
      <dd className="text-[13px] text-gray-900 break-all">{value || <span className="text-gray-300">ריק</span>}</dd>
    </div>
  );
}
