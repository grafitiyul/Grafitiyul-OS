import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import LanguageSwitcher from '../questionnaire/LanguageSwitcher.jsx';
import GroupCard, { emptyGroup, groupComplete } from './GroupCard.jsx';
import SignatureBox from './SignatureBox.jsx';
import { L } from './strings.js';

// PUBLIC travel-agent reservation form — /r/:token. No login: the permanent
// AgentReservationLink token is the whole capability. Mobile-first, calm,
// bilingual (he RTL / en LTR — switching mirrors the layout). One submission =
// one ReservationSession; every group becomes its own booking downstream.
//
// Draft resilience: the in-progress form persists to sessionStorage (tab-
// scoped — never device-global, per the token-security invariant) so a
// refresh mid-fill loses nothing. The client-minted submissionKey rides the
// draft, making a retried submit idempotent server-side.

const DRAFT_VERSION = 1;
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
  const [confirmations, setConfirmations] = useState({});
  const [signature, setSignature] = useState({ method: 'typed', signerName: '', image: null });
  const [submissionKey] = useState(() => loadDraft(token)?.submissionKey || crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [serverProblems, setServerProblems] = useState(null); // raw [{path, code}]
  const [result, setResult] = useState(null); // public session DTO after submit
  const pollTimer = useRef(null);

  const t = L[lang || 'he'];

  // ── bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const payload = await api.publicReservations.bootstrap(token);
        if (!alive) return;
        setBoot(payload);
        const draft = loadDraft(token);
        setLang(draft?.lang || payload.defaultLanguage || 'he');
        if (draft?.groups?.length) {
          setGroups(draft.groups.map((g) => ({ ...emptyGroup(), ...g })));
          setConfirmations(draft.confirmations || {});
        }
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
        JSON.stringify({ v: DRAFT_VERSION, submissionKey, lang, groups, confirmations }),
      );
    } catch {
      /* storage full/blocked — draft is best-effort */
    }
  }, [token, boot, result, submissionKey, lang, groups, confirmations]);

  // ── live header summary ────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const per = groups.map((g) => Number(g.participants) || 0);
    return { perGroup: per, total: per.reduce((a, b) => a + b, 0) };
  }, [groups]);

  // Map raw server problems (groups.<i>.<field> / signature.* / confirmations.*)
  // to per-card field messages in the ACTIVE language.
  const problemsByGroup = useMemo(() => {
    const map = {};
    for (const p of serverProblems || []) {
      const m = /^groups\.(\d+)\.(.+)$/.exec(p.path);
      if (m) (map[Number(m[1])] ||= {})[m[2]] = t.problems[p.code] || t.problems.invalid;
    }
    return map;
  }, [serverProblems, t]);

  if (blocked) {
    const tb = L.he.blocked[blocked];
    const eb = L.en.blocked[blocked];
    return (
      <div className="min-h-screen bg-gray-50 px-6 py-24 text-center">
        <div className="mx-auto max-w-md space-y-3 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="text-3xl">🔒</div>
          <div dir="rtl" className="text-[15px] font-medium text-gray-800">{tb}</div>
          <div dir="ltr" className="text-[13px] text-gray-500">{eb}</div>
        </div>
      </div>
    );
  }
  if (!boot || !lang) {
    return <div className="min-h-screen bg-gray-50 p-10 text-center text-sm text-gray-400">…</div>;
  }

  const agentName = lang === 'en' ? boot.agent.nameEn || boot.agent.nameHe : boot.agent.nameHe;

  // ── group operations ───────────────────────────────────────────────────────
  const updateGroup = (i, g) => setGroups((gs) => gs.map((x, j) => (j === i ? g : x)));
  const addGroup = () => setGroups((gs) => [...gs, emptyGroup()]);
  const duplicateGroup = (i) =>
    setGroups((gs) => {
      const copy = { ...gs[i], key: crypto.randomUUID(), tourDate: '', tourTime: '' };
      return [...gs.slice(0, i + 1), copy, ...gs.slice(i + 1)];
    });
  const removeGroup = (i) => setGroups((gs) => gs.filter((_, j) => j !== i));

  // ── submit ─────────────────────────────────────────────────────────────────
  const allComplete = groups.length > 0 && groups.every(groupComplete);
  const allConfirmed = (boot.requiredConfirmations || []).every((k) => confirmations[k]);
  const signatureOk =
    (signature.signerName || '').trim() &&
    (signature.method === 'typed' || !!signature.image);

  async function submit() {
    setFormError(null);
    setServerProblems(null);
    if (!allComplete) return setFormError(t.problems.form);
    if (!allConfirmed) return setFormError(t.problems.confirmations);
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
          tourLanguage: g.tourLanguage || null,
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
      };
      const r = await api.publicReservations.submit(token, body);
      sessionStorage.removeItem(draftKey(token));
      setResult(r.session);
      window.scrollTo({ top: 0 });
      schedulePoll();
    } catch (e) {
      if (e?.status === 422 && e.payload?.problems) {
        setServerProblems(e.payload.problems);
        setFormError(t.problems.form);
      } else {
        setFormError(t.problems.network);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Thank-You page live upgrade: entries flip from "received" to a GOS number
  // as the processor (Slice 3) lands them. Polling stops once nothing pends.
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
      <Shell dir={t.dir} lang={lang} onLang={setLang} title={t.title}>
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
          <div className="text-4xl">🎉</div>
          <h1 className="mt-2 text-xl font-bold text-gray-900">{t.thanks.title}</h1>
          <div className="mt-1 text-[14px] text-gray-500">{t.thanks.subtitle(result.sessionNo)}</div>
          <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-gray-600">{t.thanks.note}</p>
        </div>
        <div className="mt-4 space-y-2">
          {result.groups.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-gray-900">{g.groupName}</div>
                <div className="text-[12px] text-gray-500">
                  {[g.locationLabel, g.tourDate, g.tourTime, t.summary.participants(g.participants)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              {g.orderNo ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[13px] font-bold text-emerald-700" dir="ltr">
                  {t.thanks.orderNo(g.orderNo)}
                </span>
              ) : (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] text-blue-700">
                  {t.thanks.received}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          {/* Official reservation copy — direct download from the canonical
              Documents engine (BINDING #7/#8). */}
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
      </Shell>
    );
  }

  // ── form ───────────────────────────────────────────────────────────────────
  return (
    <Shell dir={t.dir} lang={lang} onLang={setLang} title={t.title}>
      {/* Session header — live summary. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-[15px] font-bold text-gray-900">
          {t.greeting(agentName, boot.organization.name)}
        </div>
        <p className="mt-1 text-[13px] text-gray-500">{t.intro}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
            {t.summary.groups(groups.length)}
          </span>
          {totals.perGroup.map((n, i) =>
            n > 0 ? (
              <span key={groups[i].key} className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                {t.summary.participants(n)}
              </span>
            ) : null,
          )}
          {totals.total > 0 && (
            <span className="rounded-full bg-gray-900 px-2.5 py-1 font-semibold text-white">
              {t.summary.total(totals.total)}
            </span>
          )}
        </div>
      </div>

      {/* Group cards. */}
      <div className="mt-4 space-y-4">
        {groups.map((g, i) => (
          <GroupCard
            key={g.key}
            index={i}
            group={g}
            catalog={boot.catalog}
            lang={lang}
            t={t}
            problems={problemsByGroup[i]}
            onChange={(next) => updateGroup(i, next)}
            onDuplicate={() => duplicateGroup(i)}
            onRemove={() => removeGroup(i)}
            canRemove={groups.length > 1}
          />
        ))}
      </div>

      {groups.length < (boot.maxGroups || 30) && (
        <button
          type="button"
          onClick={addGroup}
          className="mt-4 w-full rounded-2xl border-2 border-dashed border-gray-300 bg-white/60 py-3 text-[14px] font-medium text-gray-600 hover:border-gray-400 hover:text-gray-800"
        >
          {t.addGroup}
        </button>
      )}

      {/* Session footer — confirmations + ONE signature. */}
      <div className="mt-6 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div>
          <div className="mb-2 text-[14px] font-semibold text-gray-900">{t.footer.confirmationsTitle}</div>
          <div className="space-y-2">
            {(boot.requiredConfirmations || []).map((k) => (
              <label key={k} className="flex cursor-pointer items-start gap-2 text-[13px] text-gray-700">
                <input
                  type="checkbox"
                  checked={!!confirmations[k]}
                  onChange={(e) => setConfirmations((c) => ({ ...c, [k]: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>{t.footer[`confirm_${k}`] || k}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[14px] font-semibold text-gray-900">{t.footer.signatureTitle}</div>
          <SignatureBox t={t} value={signature} onChange={setSignature} error={formError === t.problems.signature} />
        </div>

        <div className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
          {t.requestNote}
        </div>

        {formError && <div className="text-center text-[13px] font-medium text-red-600">{formError}</div>}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="w-full rounded-xl bg-blue-600 py-3.5 text-[16px] font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-50"
        >
          {submitting ? t.footer.submitting : t.footer.submit}
        </button>
      </div>
    </Shell>
  );
}

// Page chrome: calm centered column (guide-portal conventions), language pill
// forcing its own LTR, direction flip at the root so RTL/EN mirror correctly.
function Shell({ dir, lang, onLang, title, children }) {
  return (
    <div dir={dir} className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-[13px] font-semibold tracking-tight text-gray-400">{title}</div>
          <LanguageSwitcher languages={['he', 'en']} value={lang} onChange={onLang} />
        </div>
        {children}
      </div>
    </div>
  );
}
