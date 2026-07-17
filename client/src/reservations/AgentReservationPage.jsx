import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import logo from '../public/assets/home/photos/logo.png';
import GroupCard, { emptyGroup, groupComplete } from './GroupCard.jsx';
import SignatureBox from './SignatureBox.jsx';
import { L } from './strings.js';
import { PREVIEW_BOOT } from './previewFixture.js';

// Design preview (/r/__preview): fixture catalogue, nothing persisted —
// submit is a no-op. `__` is not in the token alphabet, so this can never
// shadow a real link.
const PREVIEW_TOKEN = '__preview';

// PUBLIC travel-agent reservation form — /r/:token. Premium B2B booking
// portal per the approved mockup: clean white cards, generous spacing, subtle
// borders, two-column desktop layout (groups + sticky request summary),
// collapsible group cards, city-first flow over the owner-configured channel
// catalogue. No login: the permanent AgentReservationLink token is the whole
// capability. Bilingual (he RTL / en LTR — switching mirrors the layout).
//
// Draft resilience: sessionStorage (tab-scoped — never device-global, per the
// token-security invariant); the client-minted submissionKey rides the draft,
// making a retried submit idempotent server-side.

const DRAFT_VERSION = 2; // v2: city-first (cityKey), single confirmation
const POLL_MS = 5000;

const draftKey = (token) => `gos.resv.draft.${token}`;

function loadDraft(token) {
  try {
    const raw = sessionStorage.getItem(draftKey(token));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d?.v === DRAFT_VERSION ? d : null;
  } catch {
    return null;
  }
}

export default function AgentReservationPage() {
  const { token } = useParams();
  const [boot, setBoot] = useState(null);
  const [blocked, setBlocked] = useState(null); // 'notFound' | 'inactive'
  const [lang, setLang] = useState(null);
  const [groups, setGroups] = useState([emptyGroup()]);
  const [collapsedKeys, setCollapsedKeys] = useState(() => new Set());
  const [confirmations, setConfirmations] = useState({});
  // Invoice delivery — org-centric: when the agency already has a finance
  // contact it shows read-only; otherwise the entered details persist onto
  // the Organization (canonical finance fields, shared with GOS Deals).
  const [invoice, setInvoice] = useState({ sendToFinance: false, financeName: '', financeEmail: '' });
  const [signature, setSignature] = useState({ method: 'typed', signerName: '', image: null });
  const [submissionKey] = useState(() => loadDraft(token)?.submissionKey || crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [serverProblems, setServerProblems] = useState(null);
  const [result, setResult] = useState(null);
  const pollTimer = useRef(null);

  const t = L[lang || 'he'];

  // ── bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (token === PREVIEW_TOKEN) {
      setBoot(PREVIEW_BOOT);
      setLang('he');
      return undefined;
    }
    let alive = true;
    (async () => {
      try {
        const payload = await api.publicReservations.bootstrap(token);
        if (!alive) return;
        setBoot(payload);
        const draft = loadDraft(token);
        setLang(draft?.lang || payload.defaultLanguage || 'he');
        if (draft?.groups?.length) setGroups(draft.groups.map((g) => ({ ...emptyGroup(), ...g })));
      } catch (e) {
        if (!alive) return;
        setBlocked(e?.status === 403 ? 'inactive' : 'notFound');
      }
    })();
    return () => {
      alive = false;
      clearTimeout(pollTimer.current);
    };
  }, [token]);

  // ── draft persistence (signature image deliberately excluded) ─────────────
  useEffect(() => {
    if (!boot || result) return;
    try {
      sessionStorage.setItem(
        draftKey(token),
        JSON.stringify({ v: DRAFT_VERSION, submissionKey, lang, groups }),
      );
    } catch {
      /* storage full/blocked — draft is best-effort */
    }
  }, [token, boot, result, submissionKey, lang, groups]);

  const totals = useMemo(() => {
    const total = groups.reduce((a, g) => a + (Number(g.participants) || 0), 0);
    const activityNames = [
      ...new Set(
        groups
          .map((g) => boot?.catalog.variants.find((v) => v.id === g.productVariantId))
          .filter(Boolean)
          .map((v) => (lang === 'en' ? v.nameEn : v.nameHe)),
      ),
    ];
    return { total, activityNames };
  }, [groups, boot, lang]);

  const problemsByGroup = useMemo(() => {
    const map = {};
    for (const p of serverProblems || []) {
      const m = /^groups\.(\d+)\.(.+)$/.exec(p.path);
      if (m) (map[Number(m[1])] ||= {})[m[2]] = t.problems[p.code] || t.problems.invalid;
    }
    return map;
  }, [serverProblems, t]);

  if (blocked) {
    return (
      <div className="min-h-screen bg-[#f6f8fb] px-6 py-24 text-center">
        <div className="mx-auto max-w-md space-y-3 rounded-2xl border border-gray-200 bg-white p-8">
          <div className="text-3xl">🔒</div>
          <div dir="rtl" className="text-[15px] font-medium text-gray-800">{L.he.blocked[blocked]}</div>
          <div dir="ltr" className="text-[13px] text-gray-500">{L.en.blocked[blocked]}</div>
        </div>
      </div>
    );
  }
  if (!boot || !lang) {
    return <div className="min-h-screen bg-[#f6f8fb] p-10 text-center text-sm text-gray-400">…</div>;
  }

  const agentName = lang === 'en' ? boot.agent.nameEn || boot.agent.nameHe : boot.agent.nameHe;

  // ── group operations ───────────────────────────────────────────────────────
  const updateGroup = (i, g) => setGroups((gs) => gs.map((x, j) => (j === i ? g : x)));
  const removeGroup = (i) => setGroups((gs) => gs.filter((_, j) => j !== i));
  const toggleCollapse = (key) =>
    setCollapsedKeys((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  function addGroup() {
    // Completed cards fold away so the new group gets the stage (fast flow).
    setCollapsedKeys((s) => {
      const next = new Set(s);
      for (const g of groups) if (groupComplete(g)) next.add(g.key);
      return next;
    });
    setGroups((gs) => [...gs, emptyGroup()]);
  }

  // ── submit ─────────────────────────────────────────────────────────────────
  const allComplete = groups.length > 0 && groups.every(groupComplete);
  const allConfirmed = (boot?.requiredConfirmations || []).every((k) => confirmations[k]);
  const orgHasFinance = !!boot?.organization?.financeEmail;
  const invoiceOk =
    !invoice.sendToFinance ||
    orgHasFinance ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice.financeEmail.trim());
  const signatureOk =
    (signature.signerName || '').trim() &&
    (signature.method === 'typed' || !!signature.image);

  async function submit() {
    if (token === PREVIEW_TOKEN) {
      alert('תצוגה מקדימה — הטופס אינו נשלח.');
      return;
    }
    setFormError(null);
    setServerProblems(null);
    if (!allComplete) {
      setCollapsedKeys(new Set()); // reveal what's missing
      return setFormError(t.problems.form);
    }
    if (!allConfirmed) return setFormError(t.problems.confirmations);
    if (!invoiceOk) return setFormError(t.problems.financeEmail);
    if (!signatureOk) return setFormError(t.problems.signature);
    setSubmitting(true);
    try {
      const body = {
        submissionKey,
        language: lang,
        groups: groups.map((g) => ({
          groupName: g.groupName,
          productVariantId: g.productVariantId,
          tourDate: g.tourDate,
          tourTime: g.tourTime,
          participants: Number(g.participants),
          onSiteContactName: g.onSiteContactName || null,
          onSiteContactPhone: g.onSiteContactPhone || null,
          notes: g.notes || null,
        })),
        signature: {
          signerName: signature.signerName.trim(),
          method: signature.method,
          image: signature.method === 'drawn' ? signature.image : undefined,
        },
        confirmations: (boot.requiredConfirmations || []).map((k) => ({
          key: k,
          accepted: !!confirmations[k],
        })),
        invoice: {
          sendToFinance: invoice.sendToFinance,
          // Editable details are sent only in the "לאיש כספים אחר" mode —
          // with a saved org contact the server uses the canonical values.
          ...(invoice.sendToFinance && !orgHasFinance
            ? { financeName: invoice.financeName || null, financeEmail: invoice.financeEmail.trim() }
            : {}),
        },
      };
      const r = await api.publicReservations.submit(token, body);
      sessionStorage.removeItem(draftKey(token));
      setResult(r.session);
      window.scrollTo({ top: 0 });
      schedulePoll();
    } catch (e) {
      if (e?.status === 422 && e.payload?.problems) {
        setServerProblems(e.payload.problems);
        setCollapsedKeys(new Set());
        setFormError(t.problems.form);
      } else {
        setFormError(t.problems.network);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(async () => {
      try {
        const r = await api.publicReservations.status(token, submissionKey);
        setResult(r.session);
        if (r.session.groups.some((g) => !g.orderNo)) schedulePoll();
      } catch {
        /* transient — the numbers arrive on the next successful poll */
      }
    }, POLL_MS);
  }

  // ── thank-you ──────────────────────────────────────────────────────────────
  if (result) {
    return (
      <Shell t={t} lang={lang} onLang={setLang}>
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center">
            <div className="text-4xl">🎉</div>
            <h1 className="mt-2 text-xl font-bold text-gray-900">{t.thanks.title}</h1>
            <div className="mt-1 text-[14px] text-gray-500">{t.thanks.subtitle(result.sessionNo)}</div>
            <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-gray-600">{t.thanks.note}</p>
          </div>
          <div className="mt-4 space-y-2">
            {result.groups.map((g) => (
              <div key={g.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-gray-900">{g.groupName}</div>
                  <div className="text-[12px] text-gray-500">
                    {[g.productLabel, g.locationLabel, g.tourDate, g.tourTime, t.thanks.participants(g.participants)]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {g.orderNo ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-[13px] font-bold text-emerald-700" dir="ltr">
                    {t.thanks.orderNo(g.orderNo)}
                  </span>
                ) : (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] text-blue-700">{t.thanks.received}</span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <a
              href={`/api/public/reservations/${token}/session/${submissionKey}/pdf`}
              className="w-full rounded-xl bg-gray-900 px-6 py-2.5 text-center text-[14px] font-semibold text-white hover:brightness-110 sm:w-auto"
            >
              {t.thanks.downloadPdf}
            </a>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-xl border border-gray-300 bg-white px-6 py-2.5 text-[14px] font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
            >
              {t.thanks.newReservation}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── form ───────────────────────────────────────────────────────────────────
  return (
    <Shell t={t} lang={lang} onLang={setLang}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column — the groups. */}
        <div>
          <h2 className="mb-3 text-[17px] font-bold text-gray-900">{t.groupsTitle}</h2>
          <div className="space-y-4">
            {groups.map((g, i) => (
              <GroupCard
                key={g.key}
                index={i}
                group={g}
                catalog={boot.catalog}
                lang={lang}
                t={t}
                problems={problemsByGroup[i]}
                collapsed={collapsedKeys.has(g.key)}
                onToggleCollapse={() => toggleCollapse(g.key)}
                onChange={(next) => updateGroup(i, next)}
                onRemove={() => removeGroup(i)}
                canRemove={groups.length > 1}
              />
            ))}
          </div>

          {groups.length < (boot.maxGroups || 30) && (
            <button
              type="button"
              onClick={addGroup}
              className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-2xl border border-gray-200/80 bg-white py-4 text-[14px] font-semibold text-gray-700 transition hover:border-blue-200 hover:text-blue-700"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </span>
              {t.addGroup}
            </button>
          )}

          {/* Flexible-cancellation acknowledgement — mandatory, before the
              signature. Acceptance + timestamp are frozen on the session. */}
          <div className="mt-6 rounded-2xl border border-gray-200/80 bg-white p-5">
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-gray-700">
              <input
                type="checkbox"
                checked={!!confirmations.flexible_cancellation}
                onChange={(e) =>
                  setConfirmations((c) => ({ ...c, flexible_cancellation: e.target.checked }))
                }
                className="mt-0.5"
              />
              <span>
                <span className="text-red-500">* </span>
                {t.cancellation.lines.map((line, i) => (
                  <span key={i} className={i === 0 ? 'font-medium text-gray-800' : 'block'}>
                    {line}{i === 0 ? <br /> : null}
                  </span>
                ))}
              </span>
            </label>
          </div>

          {/* Invoice delivery — org-centric finance contact. */}
          <div className="mt-4 rounded-2xl border border-gray-200/80 bg-white p-5">
            <div className="mb-3 text-[14px] font-semibold text-gray-900">{t.invoice.title}</div>
            <div className="space-y-2.5">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-gray-700">
                <input
                  type="radio"
                  name="invoiceTarget"
                  checked={!invoice.sendToFinance}
                  onChange={() => setInvoice((v) => ({ ...v, sendToFinance: false }))}
                />
                {t.invoice.toMe}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-gray-700">
                <input
                  type="radio"
                  name="invoiceTarget"
                  checked={invoice.sendToFinance}
                  onChange={() => setInvoice((v) => ({ ...v, sendToFinance: true }))}
                />
                {orgHasFinance ? t.invoice.toFinance : t.invoice.toOtherFinance}
              </label>
              {invoice.sendToFinance && orgHasFinance && (
                // Saved organization finance contact — read-only display.
                <div className="ms-6 rounded-xl bg-gray-50/80 px-3.5 py-2.5 text-[13px]">
                  {boot.organization.financeContactName && (
                    <div className="font-medium text-gray-800">{boot.organization.financeContactName}</div>
                  )}
                  <div className="text-gray-600" dir="ltr">{boot.organization.financeEmail}</div>
                </div>
              )}
              {invoice.sendToFinance && !orgHasFinance && (
                <div className="ms-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <span className="mb-1 block text-[12px] font-medium text-gray-600">{t.invoice.financeName}</span>
                    <input
                      value={invoice.financeName}
                      onChange={(e) => setInvoice((v) => ({ ...v, financeName: e.target.value }))}
                      className="h-10 w-full rounded-lg border border-gray-200 px-3 text-[14px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-[12px] font-medium text-gray-600">
                      <span className="text-red-500">* </span>
                      {t.invoice.financeEmail}
                    </span>
                    <input
                      value={invoice.financeEmail}
                      onChange={(e) => setInvoice((v) => ({ ...v, financeEmail: e.target.value }))}
                      dir="ltr"
                      inputMode="email"
                      className={`h-10 w-full rounded-lg border px-3 text-[14px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ${
                        formError === t.problems.financeEmail ? 'border-red-300' : 'border-gray-200'
                      }`}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Signature (one per request — session-wide) + confirmation + submit. */}
          <div className="mt-4 space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5">
            <div>
              <div className="mb-2 text-[14px] font-semibold text-gray-900">{t.footer.signatureTitle}</div>
              <SignatureBox t={t} value={signature} onChange={setSignature} error={formError === t.problems.signature} />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-[13px] text-gray-700">
              <input
                type="checkbox"
                checked={!!confirmations.reservation_request}
                onChange={(e) =>
                  setConfirmations((c) => ({ ...c, reservation_request: e.target.checked }))
                }
                className="mt-0.5"
              />
              <span>
                <span className="text-red-500">* </span>
                {t.footer.confirm_reservation_request}
              </span>
            </label>
            {formError && <div className="text-center text-[13px] font-medium text-red-600">{formError}</div>}
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-[16px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? t.footer.submitting : t.footer.submit}
            </button>
          </div>
        </div>

        {/* Sidebar — live request summary + booking-contact identity. */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
            <h3 className="text-[15px] font-bold text-gray-900">{t.summary.title}</h3>
            <dl className="mt-3 divide-y divide-gray-100">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[13px] text-gray-500">{t.summary.groups}</dt>
                <dd className="text-[18px] font-bold text-gray-900">{groups.length}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[13px] text-gray-500">{t.summary.participants}</dt>
                <dd className="text-[18px] font-bold text-gray-900">{totals.total}</dd>
              </div>
            </dl>
            {totals.activityNames.length > 0 && (
              <div className="mt-2">
                <div className="text-[12px] font-medium text-gray-500">{t.summary.activities}</div>
                <ul className="mt-1 space-y-1">
                  {totals.activityNames.map((n) => (
                    <li key={n} className="flex items-start gap-1.5 text-[12px] text-gray-700">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800">
              {t.summary.approvalNote}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
            <h3 className="flex items-center gap-2 text-[15px] font-bold text-gray-900">
              <span className="text-blue-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </span>
              {t.agentCard.title}
            </h3>
            <dl className="mt-3 space-y-2.5 text-[13px]">
              <IdRow label={t.agentCard.name} value={agentName} />
              {boot.agent.phone && <IdRow label={t.agentCard.phone} value={boot.agent.phone} ltr />}
              {boot.agent.email && <IdRow label={t.agentCard.email} value={boot.agent.email} ltr />}
              <IdRow label={t.agentCard.company} value={boot.organization.name} />
            </dl>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function IdRow({ label, value, ltr }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd
        className="mt-0.5 rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2 text-gray-800"
        dir={ltr ? 'ltr' : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

// Page chrome per the mockup: brand row (logo leading, language pills
// trailing), centered title + subtitle, calm off-white canvas. Direction
// flips at the root so RTL/EN mirror correctly.
function Shell({ t, lang, onLang, children }) {
  return (
    <div dir={t.dir} className="min-h-screen bg-[#f6f8fb] text-gray-900">
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-5 sm:px-6">
        <header className="mb-8">
          <div className="flex items-center justify-between gap-3">
            <img src={logo} alt="Grafitiyul" className="h-10 w-auto sm:h-12" />
            <div className="flex items-center gap-1.5" dir="ltr">
              {[
                ['en', 'English'],
                ['he', 'עברית'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => onLang(k)}
                  className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
                    lang === k
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-[28px]">{t.title}</h1>
            <p className="mx-auto mt-2 max-w-lg text-[14px] leading-relaxed text-gray-500">{t.intro}</p>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
