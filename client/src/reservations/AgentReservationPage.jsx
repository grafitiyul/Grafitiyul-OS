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
  // Invoice delivery — MULTI-recipient (organizer and/or finance contact, at
  // least one). Org-centric: a saved agency finance contact shows read-only;
  // otherwise the entered details persist onto the Organization (canonical
  // finance fields, shared with GOS Deals).
  const [invoice, setInvoice] = useState({
    toOrganizer: true,
    toFinance: false,
    replaceFinance: false,
    financeName: '',
    financeEmail: '',
    financePhone: '',
  });
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
  const savedFinance = boot?.organization?.financeContact || null;
  const orgHasFinance = !!savedFinance;
  const anyRecipient = invoice.toOrganizer || invoice.toFinance;
  // Nominating = defining a (first or replacement) finance person — name,
  // email and phone are all required; the saved contact itself is never
  // editable from the public form.
  const nominating = invoice.toFinance && (!orgHasFinance || invoice.replaceFinance);
  const financeDetailsOk =
    !nominating ||
    (invoice.financeName.trim() &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice.financeEmail.trim()) &&
      invoice.financePhone.replace(/\D/g, '').length >= 8);
  // EITHER method alone satisfies the signature: a drawn signature needs no
  // typed name; a typed signature is the full name. (Server rule mirrored.)
  const signatureOk =
    signature.method === 'drawn'
      ? !!signature.image
      : !!(signature.signerName || '').trim();

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
    if (!anyRecipient) return setFormError(t.problems.recipients);
    if (!financeDetailsOk) return setFormError(t.problems.financeDetails);
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
          // "מספר מדריכים" — the card's pricing group count. The server
          // REQUIRES it (intake validation); omitting it fails every submit.
          groups: Number(g.groups),
          // שפת הסיור — canonical key (defaults to English); server freezes it
          // on the group, the snapshot, the PDF and the created Deal.
          tourLanguage: g.tourLanguage || null,
          onSiteContactName: g.onSiteContactName || null,
          onSiteContactPhone: g.onSiteContactPhone || null,
          notes: g.notes || null,
        })),
        signature: {
          signerName: signature.signerName.trim() || undefined,
          method: signature.method,
          image: signature.method === 'drawn' ? signature.image : undefined,
        },
        confirmations: (boot.requiredConfirmations || []).map((k) => ({
          key: k,
          accepted: !!confirmations[k],
        })),
        invoice: {
          toOrganizer: invoice.toOrganizer,
          toFinance: invoice.toFinance,
          replaceFinance: invoice.replaceFinance,
          // Nomination details are sent only when defining a first/replacement
          // finance person — the saved contact is server-side canonical.
          ...(nominating
            ? {
                financeName: invoice.financeName.trim(),
                financeEmail: invoice.financeEmail.trim(),
                financePhone: invoice.financePhone.trim(),
              }
            : {}),
        },
      };
      const r = await api.publicReservations.submit(token, body);
      sessionStorage.removeItem(draftKey(token));
      setResult(r.session);
      window.scrollTo({ top: 0 });
      if (r.session.groups.some((g) => !g.orderNo) || !r.session.documentReady) schedulePoll();
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
        // Keep polling until every group has its GOS number AND the canonical
        // summary PDF is stored (documentReady gates the download button).
        if (r.session.groups.some((g) => !g.orderNo) || !r.session.documentReady) schedulePoll();
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
            {result.documentReady ? (
              <a
                href={`/api/public/reservations/${token}/session/${submissionKey}/pdf`}
                className="w-full rounded-xl bg-gray-900 px-6 py-2.5 text-center text-[14px] font-semibold text-white hover:brightness-110 sm:w-auto"
              >
                {t.thanks.downloadPdf}
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="w-full cursor-wait rounded-xl bg-gray-400 px-6 py-2.5 text-center text-[14px] font-semibold text-white sm:w-auto"
              >
                {t.thanks.preparingPdf}
              </button>
            )}
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
      <div className="mx-auto max-w-3xl">
        {/* Booker details (פרטי המזמין) — a normal full-width section near the
            top of the form (read-only identity from the link token). */}
        <section className="mb-6 rounded-2xl border border-gray-200/80 bg-white p-5">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-gray-900">
            <span className="text-blue-600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            {t.agentCard.title}
          </h3>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            <IdRow label={t.agentCard.name} value={agentName} />
            {boot.agent.phone && <IdRow label={t.agentCard.phone} value={boot.agent.phone} ltr />}
            {boot.agent.email && <IdRow label={t.agentCard.email} value={boot.agent.email} ltr />}
            <IdRow label={t.agentCard.company} value={boot.organization.name} />
          </dl>
        </section>

        {/* The groups. */}
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
                token={token}
                isPreview={token === PREVIEW_TOKEN}
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

          {/* Invoice delivery — independent recipients: organizer and/or the
              finance contact (both allowed; at least one required). */}
          <div className="mt-4 rounded-2xl border border-gray-200/80 bg-white p-5">
            <div className="mb-3 text-[14px] font-semibold text-gray-900">{t.invoice.title}</div>
            <div className="space-y-2.5">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-gray-700">
                <input
                  type="checkbox"
                  checked={invoice.toOrganizer}
                  onChange={(e) => setInvoice((v) => ({ ...v, toOrganizer: e.target.checked }))}
                />
                {t.invoice.toMe}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-gray-700">
                <input
                  type="checkbox"
                  checked={invoice.toFinance}
                  onChange={(e) => setInvoice((v) => ({ ...v, toFinance: e.target.checked }))}
                />
                {orgHasFinance ? t.invoice.toFinance : t.invoice.toOtherFinance}
              </label>
              {invoice.toFinance && orgHasFinance && !invoice.replaceFinance && (
                // Saved organization finance contact — read-only; the public
                // form can only NOMINATE a replacement, never edit this person.
                <div className="ms-6 rounded-xl bg-gray-50/80 px-3.5 py-2.5 text-[13px]">
                  {savedFinance.name && (
                    <div className="font-medium text-gray-800">{savedFinance.name}</div>
                  )}
                  {savedFinance.email && (
                    <div className="text-gray-600" dir="ltr">{savedFinance.email}</div>
                  )}
                  {savedFinance.phone && (
                    <div className="text-gray-600" dir="ltr">{savedFinance.phone}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => setInvoice((v) => ({ ...v, replaceFinance: true }))}
                    className="mt-1.5 text-[12px] font-medium text-blue-700 hover:underline"
                  >
                    {t.invoice.replaceAction}
                  </button>
                </div>
              )}
              {invoice.toFinance && orgHasFinance && invoice.replaceFinance && (
                <div className="ms-6 -mb-1 text-[12px] text-gray-500">
                  {t.invoice.replacingNote}{' '}
                  <button
                    type="button"
                    onClick={() =>
                      setInvoice((v) => ({ ...v, replaceFinance: false, financeName: '', financeEmail: '', financePhone: '' }))
                    }
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {t.invoice.keepSaved}
                  </button>
                </div>
              )}
              {nominating && (
                <div className="ms-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <span className="mb-1 block text-[12px] font-medium text-gray-600">
                      <span className="text-red-500">* </span>
                      {t.invoice.financeName}
                    </span>
                    <input
                      value={invoice.financeName}
                      onChange={(e) => setInvoice((v) => ({ ...v, financeName: e.target.value }))}
                      className={`h-10 w-full rounded-lg border px-3 text-[14px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ${
                        formError === t.problems.financeDetails ? 'border-red-300' : 'border-gray-200'
                      }`}
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
                        formError === t.problems.financeDetails ? 'border-red-300' : 'border-gray-200'
                      }`}
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-[12px] font-medium text-gray-600">
                      <span className="text-red-500">* </span>
                      {t.invoice.financePhone}
                    </span>
                    <input
                      value={invoice.financePhone}
                      onChange={(e) => setInvoice((v) => ({ ...v, financePhone: e.target.value }))}
                      dir="ltr"
                      inputMode="tel"
                      className={`h-10 w-full rounded-lg border px-3 text-[14px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ${
                        formError === t.problems.financeDetails ? 'border-red-300' : 'border-gray-200'
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
