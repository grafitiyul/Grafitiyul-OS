import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import HoverCard from '../common/HoverCard.jsx';
import LostDealDialog from './LostDealDialog.jsx';
import DealSalesScript from './DealSalesScript.jsx';
import DealContactsDialog from './DealContactsDialog.jsx';
import OrganizationEditDialog from './OrganizationEditDialog.jsx';
import WorkspaceLayout from '../../shell/WorkspaceLayout.jsx';
import TimelineFeed from '../common/timeline/TimelineFeed.jsx';
import { minorToInput, toMinor } from '../../lib/money.js';
import { useDirtyForm, useDirtyWhen } from '../../lib/dirtyForms.js';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  ROLE_LABELS,
  contactNameHe,
} from './config.js';

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

// Per-status visual theme. OPEN is intentionally a muted/soft blue (not strong),
// WON green, LOST red. Used for the status buttons and the header pipeline.
const STATUS_THEME = {
  open: {
    solid: 'bg-blue-500 hover:bg-blue-600 text-white',
    soft: 'bg-blue-50 text-blue-600 ring-blue-100',
  },
  won: {
    solid: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    soft: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  lost: {
    solid: 'bg-red-600 hover:bg-red-700 text-white',
    soft: 'bg-red-50 text-red-700 ring-red-200',
  },
};

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}

// Deal detail — a 3-column sales WORKSPACE (WorkspaceLayout), not a big form.
//   • LEFT panel  : sales script (collapsible/resizable, placeholder for now)
//   • CENTER      : the working surfaces — hero header (title + actions +
//                   full-width pipeline), contacts, activity, notes
//   • RIGHT panel : deal properties (overview / organization / commercial /
//                   dates / LOST details / metadata)
// The title is inline-editable in the hero; every property section saves itself
// with its own local שמור button (no global header save). Side-panel width and
// open/closed state persist in localStorage via WorkspaceLayout.
export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [deal, setDeal] = useState(null);
  const [stages, setStages] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [subtypes, setSubtypes] = useState([]);
  const [types, setTypes] = useState([]);
  const [orgType, setOrgType] = useState(null);
  const [form, setForm] = useState(null);
  const [originalForm, setOriginalForm] = useState(null); // baseline for dirty check
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingSection, setSavingSection] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);
  // Header editing surfaces.
  const [contactsDialogOpen, setContactsDialogOpen] = useState(false);
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [d, s, o, st, ty] = await Promise.all([
        api.deals.get(id),
        api.dealStages.list(),
        api.organizations.list(),
        api.organizationSubtypes.list(),
        api.organizationTypes.list(),
      ]);
      setDeal(d);
      setStages(s);
      setOrgs(o);
      setSubtypes(st);
      setTypes(ty);
      const init = {
        title: d.title || '',
        value: minorToInput(d.valueMinor),
        discount: minorToInput(d.discountMinor),
        currency: d.currency || 'ILS',
        paymentTerms: d.paymentTerms || '',
        source: d.source || '',
        dealStageId: d.dealStageId || '',
        expectedCloseDate: d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '',
        notes: d.notes || '',
        organizationId: d.organizationId || '',
        organizationUnitId: d.organizationUnitId || '',
        organizationSubtypeId: d.organizationSubtypeId || '',
      };
      setForm(init);
      setOriginalForm(init);
      // The header's org hover card needs the org's type label.
      if (d.organizationId) {
        const full = await api.organizations.get(d.organizationId);
        setOrgType(full.organizationType || null);
      } else {
        setOrgType(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function set(field, v) {
    setForm((f) => ({ ...f, [field]: v }));
  }

  // Unsaved-work guard (auto-update). Two independent buffers on this page:
  //   • the right-panel properties form (all section saves share it) vs. its
  //     loaded baseline — clears on revert and after any section save (refresh
  //     resets the baseline);
  //   • the inline title editor while open and changed.
  useDirtyWhen(form, originalForm, { active: !!form && !!originalForm });
  useDirtyForm(editingTitle && titleDraft.trim() !== (deal?.title || ''));

  // No global header save anymore — each section saves itself with a local
  // button. saveSection sends ONLY that section's fields, then refreshes.
  async function saveSection(key, payload) {
    setSavingSection(key);
    try {
      await api.deals.update(id, payload);
      await refresh();
    } catch (e) {
      alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setSavingSection(null);
    }
  }

  async function setStatus(status) {
    // LOST goes through the in-system modal (required reason + optional notes).
    if (status === 'lost') {
      setLostOpen(true);
      return;
    }
    try {
      await api.deals.update(id, { status });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  // Clicking a pipeline stage moves the deal there immediately — same update
  // path as the Stage dropdown (single source of truth), then refresh.
  async function setStage(stageId) {
    if (!stageId || stageId === deal.dealStageId) return;
    try {
      await api.deals.update(id, { dealStageId: stageId });
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  // Generic single-field deal update used by the header meta chips
  // (activityType / org type / subtype). One update path, then refresh.
  async function updateDeal(payload) {
    try {
      await api.deals.update(id, payload);
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  async function copyDealUrl() {
    const url = `${window.location.origin}/admin/crm/deals/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API blocked (e.g. insecure context) — fall back to a prompt.
      window.prompt('העתיקו את הקישור לדיל:', url);
    }
  }

  async function confirmLost({ lostReasonId, lostNotes }) {
    try {
      await api.deals.update(id, { status: 'lost', lostReasonId, lostNotes });
      setLostOpen(false);
      await refresh();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  // Inline title editing — saves the title field only, preserving all other
  // saved values. The card field + hero stay in sync via refresh().
  function startTitleEdit() {
    setTitleDraft(deal.title || '');
    setEditingTitle(true);
  }

  async function saveTitle() {
    const t = titleDraft.trim();
    if (!t || t === deal.title) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    try {
      await api.deals.update(id, { title: t });
      await refresh();
      setEditingTitle(false);
    } catch (e) {
      alert('שגיאה בשמירת הכותרת: ' + (e.payload?.error || e.message));
    } finally {
      setSavingTitle(false);
    }
  }

  async function removeDeal() {
    try {
      await api.deals.remove(id);
      navigate('/admin/crm/deals');
    } catch (e) {
      alert('שגיאה במחיקה: ' + e.message);
    }
  }

  async function duplicateDeal() {
    try {
      const copy = await api.deals.create({
        title: `${deal.title} (עותק)`,
        dealStageId: deal.dealStageId || undefined,
        activityType: deal.activityType || null,
        organizationTypeId: deal.organizationTypeId || null,
        organizationId: deal.organizationId || null,
        organizationUnitId: deal.organizationUnitId || null,
        organizationSubtypeId: deal.organizationSubtypeId || null,
        valueMinor: minorToInput(deal.valueMinor),
        discountMinor: minorToInput(deal.discountMinor),
        currency: deal.currency || 'ILS',
        paymentTerms: deal.paymentTerms || null,
        source: deal.source || null,
        expectedCloseDate: deal.expectedCloseDate || null,
        notes: deal.notes || null,
      });
      navigate(`/admin/crm/deals/${copy.id}`);
    } catch (e) {
      alert('שגיאה בשכפול: ' + (e.payload?.error || e.message));
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">טוען…</div>;
  if (error)
    return (
      <div className="p-8 text-sm text-red-600">
        שגיאה: <span dir="ltr" className="font-mono">{error}</span>
      </div>
    );
  if (!deal || !form) return null;

  // Right panel — deal properties (config / finance / dates / meta). These are
  // the "what the deal is" surfaces; the center holds the working surfaces.
  const dealProperties = (
    <div className="space-y-4">
      <Card
        variant="panel"
        title="מסחרי"
        action={
          <SaveBtn
            busy={savingSection === 'commercial'}
            onClick={() =>
              saveSection('commercial', {
                valueMinor: toMinor(form.value) ?? 0,
                discountMinor: toMinor(form.discount),
                paymentTerms: form.paymentTerms,
                currency: form.currency,
              })
            }
          />
        }
      >
        <div className="space-y-3">
          <FieldBox label="שווי (₪)">
            <input value={form.value} onChange={(e) => set('value', e.target.value)} inputMode="decimal" dir="ltr"
              className={`${INPUT} text-[15px] font-semibold`} />
          </FieldBox>
          <FieldBox label="הנחה (₪)">
            <input value={form.discount} onChange={(e) => set('discount', e.target.value)} inputMode="decimal" dir="ltr" className={INPUT} />
          </FieldBox>
          <FieldBox label="תנאי תשלום">
            <input value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="שוטף + 30 וכו'" className={INPUT} />
          </FieldBox>
          <FieldBox label="מטבע">
            <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={`${INPUT} bg-white`}>
              <option value="ILS">₪ ILS</option>
              <option value="USD">$ USD</option>
              <option value="EUR">€ EUR</option>
            </select>
          </FieldBox>
        </div>
      </Card>

      <Card variant="panel" title="תאריכים">
        <dl className="space-y-2 text-sm">
          <Row label="צפי סגירה" value={fmtDate(deal.expectedCloseDate)} />
          {deal.wonAt && <Row label="נסגר בהצלחה" value={fmtDate(deal.wonAt)} />}
          {deal.lostAt && <Row label="תאריך LOST" value={fmtDate(deal.lostAt)} />}
        </dl>
      </Card>

      {deal.status === 'lost' && (
        <Card variant="panel" title="פרטי LOST">
          <dl className="space-y-2 text-sm">
            <Row
              label="סיבת LOST"
              value={deal.lostReasonRef?.nameHe || deal.lostReason || '—'}
            />
          </dl>
          {deal.lostNotes && (
            <div className="mt-3">
              <div className="text-[11px] text-gray-500 mb-1">הערות LOST</div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{deal.lostNotes}</p>
            </div>
          )}
          {!deal.lostReasonRef && deal.lostReason && (
            <div className="mt-2 text-[11px] text-gray-400">
              טקסט LOST קודם (legacy) — נשמר לתצוגה עד עדכון הסטטוס מחדש.
            </div>
          )}
        </Card>
      )}

      <Card variant="panel" title="מטא-דאטה">
        <dl className="space-y-2 text-sm">
          <Row label="נוצר" value={fmtDate(deal.createdAt)} />
          <Row label="עודכן" value={fmtDate(deal.updatedAt)} />
        </dl>
      </Card>
    </div>
  );

  return (
    <WorkspaceLayout
      storageKey="gos.workspace.deal"
      right={{ title: 'פרטי הדיל', content: dealProperties, defaultWidth: 380, minWidth: 300, maxWidth: 620 }}
      left={{ title: 'תסריט מכירה', content: <DealSalesScript />, defaultWidth: 300, minWidth: 220, maxWidth: 460 }}
    >
      {/* Hero header — title + actions, then a full-width pipeline bar.
          Lives in the center stack, so its width matches the cards. */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 lg:p-5">
        {/* 1 — Title + identity badge + status / actions */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex items-center flex-wrap gap-x-3 gap-y-2">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveTitle();
                  } else if (e.key === 'Escape') {
                    setEditingTitle(false);
                  }
                }}
                disabled={savingTitle}
                className="text-2xl lg:text-3xl font-bold tracking-tight text-gray-900 border-b-2 border-blue-400 focus:outline-none px-0.5 min-w-[12rem] disabled:opacity-60"
              />
            ) : (
              <h1
                onClick={startTitleEdit}
                title="לחצו לעריכת הכותרת"
                className="text-2xl lg:text-3xl font-bold tracking-tight text-gray-900 cursor-text rounded px-1 -mx-1 hover:bg-gray-50"
              >
                {deal.title}
              </h1>
            )}
            {/* Single identity badge — the activity classification at a glance.
                Display only; clicking opens the editing popover. */}
            <ActivityBadge
              deal={deal}
              types={types}
              subtypes={subtypes}
              onActivityType={(v) => updateDeal({ activityType: v || null })}
              // Changing the org type ALWAYS clears the previous subtype — a
              // subtype must belong to the currently selected type (no stale
              // "<new type> <old subtype>" badge).
              onDealOrgType={(v) => updateDeal({ organizationTypeId: v || null, organizationSubtypeId: null })}
              onSubtype={(v) => updateDeal({ organizationSubtypeId: v || null })}
              onOpenOrgDialog={() => setOrgDialogOpen(true)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* OPEN → offer WON / LOST. WON or LOST → a single white REOPEN.
                All three route through the one setStatus() flow. */}
            {deal.status === 'open' ? (
              <>
                <button onClick={() => setStatus('won')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${STATUS_THEME.won.solid}`}>
                  WON
                </button>
                <button onClick={() => setStatus('lost')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${STATUS_THEME.lost.solid}`}>
                  LOST
                </button>
              </>
            ) : (
              <button onClick={() => setStatus('open')}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                REOPEN
              </button>
            )}
            <button
              ref={menuBtnRef}
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="פעולות נוספות"
              className="h-10 w-10 rounded-lg border border-gray-300 text-gray-500 hover:text-gray-800 hover:bg-gray-50 text-lg leading-none"
            >
              ⋮
            </button>
            <AnchoredMenu anchorRef={menuBtnRef} open={menuOpen} onClose={() => setMenuOpen(false)} width={184}>
              <button
                onClick={() => { setMenuOpen(false); duplicateDeal(); }}
                className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
              >
                שכפל דיל
              </button>
              <button
                onClick={() => { setMenuOpen(false); copyDealUrl(); }}
                className="block w-full text-right px-3 py-2 text-sm hover:bg-gray-50"
              >
                העתק URL של דיל
              </button>
              <button
                disabled
                title="בקרוב"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-gray-400 cursor-not-allowed"
              >
                <span>איחוד דילים</span>
                <span className="text-[10px] rounded bg-gray-100 px-1.5 py-0.5">בקרוב</span>
              </button>
              <div className="my-1 border-t border-gray-100" />
              <button
                onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                className="block w-full text-right px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                מחק דיל
              </button>
            </AnchoredMenu>
          </div>
        </div>

        {/* 2 — Pipeline (full width). Click a stage to move the deal there. */}
        <div className="mt-4">
          <StagePipeline
            stages={stages}
            currentStageId={deal.dealStageId}
            status={deal.status}
            onSelect={setStage}
          />
        </div>

        {/* 3 — Relationship row: primary contact + organization, with hovercards.
            Chips are clickable → open editing dialogs. */}
        <RelationshipRow
          deal={deal}
          orgType={orgType}
          onManageContacts={() => setContactsDialogOpen(true)}
          onOrgClick={() => setOrgDialogOpen(true)}
        />
      </div>

      {/* Timeline — the reusable Activity Feed (notes V1). Scoped to this deal;
          the exact same component will later mount on Contact / Organization.
          Contacts live in the header relationship row now (no separate card). */}
      <TimelineFeed subjectType="deal" subjectId={deal.id} />

      <LostDealDialog
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        onSubmit={confirmLost}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="מחיקת דיל"
        body="למחוק את הדיל? אנשי הקשר המקושרים יוסרו מהדיל."
        confirmLabel="מחק"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); removeDeal(); }}
      />

      {/* Header editing dialogs */}
      <DealContactsDialog
        deal={deal}
        open={contactsDialogOpen}
        onClose={() => setContactsDialogOpen(false)}
        onChanged={refresh}
      />
      <OrganizationEditDialog
        deal={deal}
        orgs={orgs}
        types={types}
        subtypes={subtypes}
        open={orgDialogOpen}
        onClose={() => setOrgDialogOpen(false)}
        onSaved={refresh}
      />

      {/* Tiny transient confirmation for "copy URL" (no global toast infra yet). */}
      {copied && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
          הקישור הועתק ✓
        </div>
      )}

    </WorkspaceLayout>
  );
}

// ── Atoms ───────────────────────────────────────────────────────────

// Horizontal pipeline bar (Pipedrive-style), RTL: stages read right→left as a
// row of connected chevron segments. Every stage up to and including the current
// one is filled in the deal's status color (OPEN muted blue / WON green / LOST
// red); future stages are gray. A closed deal still shows where it sat.
const PIPE_FILL = {
  open: { done: 'bg-blue-100 text-blue-700', current: 'bg-blue-500 text-white' },
  won: { done: 'bg-emerald-100 text-emerald-700', current: 'bg-emerald-500 text-white' },
  lost: { done: 'bg-red-100 text-red-700', current: 'bg-red-500 text-white' },
};
// Each segment is a left-pointing chevron (progress flows toward the left in
// RTL): outward point on the left edge, matching notch cut into the right edge.
const CHEVRON = 'polygon(100% 0, 12px 0, 0 50%, 12px 100%, 100% 100%, calc(100% - 12px) 50%)';
// The first (rightmost) segment keeps a flat right edge — no notch at the start.
const CHEVRON_FIRST = 'polygon(100% 0, 12px 0, 0 50%, 12px 100%, 100% 100%)';

function StagePipeline({ stages, currentStageId, status, onSelect }) {
  if (!stages?.length) return null;
  const fill = PIPE_FILL[status] || PIPE_FILL.open;
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);
  return (
    // Full-width bar: every stage segment flexes to an equal share, so the bar
    // stretches edge-to-edge and adapts automatically to any number of stages
    // (no hardcoded widths — stage count will come from Settings later).
    // Clicking a segment moves the deal to that stage immediately.
    <div className="flex w-full items-stretch text-[12px] font-medium leading-none">
      {stages.map((s, i) => {
        const isCurrent = i === currentIndex;
        const isDone = currentIndex >= 0 && i < currentIndex;
        const cls = isCurrent ? fill.current : isDone ? fill.done : 'bg-gray-100 text-gray-400';
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect?.(s.id)}
            title={s.label}
            className={`${cls} ${i === 0 ? '' : '-ms-3'} flex flex-1 min-w-0 items-center justify-center whitespace-nowrap py-2.5 ps-5 pe-4 transition-[filter] hover:brightness-95 ${
              isCurrent ? 'cursor-default' : 'cursor-pointer'
            }`}
            style={{ clipPath: i === 0 ? CHEVRON_FIRST : CHEVRON }}
          >
            <span className="truncate">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Local section save button (replaces the old global header save).
function SaveBtn({ onClick, busy }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {busy ? 'שומר…' : 'שמור'}
    </button>
  );
}

// ── Relationship row (under the pipeline) ───────────────────────────
// Primary contact + organization, each opening a hover card. Hover never
// navigates — the card carries an explicit "open" link instead.

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-gray-400">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-gray-400">
      <path d="M3 21h18" />
      <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <path d="M19 21V11a2 2 0 0 0-2-2h-2" />
      <path d="M9 7h2M9 11h2M9 15h2" />
    </svg>
  );
}

// Per-activity badge colour. The badge itself carries the colour (no dot):
// business = green, private = red, group = amber. Soft, modern, tasteful.
const ACTIVITY_BADGE_TONE = {
  business: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-200/60',
  private: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200 hover:bg-rose-200/60',
  group: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-200/60',
};
const ACTIVITY_BADGE_NEUTRAL =
  'bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200 border border-dashed border-gray-300 hover:bg-gray-100';
// Selected-option styling inside the editor popover.
const ACTIVITY_OPTION_ON = {
  business: 'bg-emerald-600 text-white border-emerald-600',
  private: 'bg-rose-600 text-white border-rose-600',
  group: 'bg-amber-500 text-white border-amber-500',
};
// The single identity badge that sits next to the deal title. It is DISPLAY ONLY
// — it shows the most specific classification at a glance and never exposes a
// form. Clicking opens a small popover that holds all the editing controls.
//
//   • no activity type → neutral "+ בחר סוג פעילות"
//   • private          → red "פרטי"
//   • group            → amber "קבוצתי"
//   • business         → green, showing the most specific label available:
//                        "<org type> <subtype>" (e.g. "בית ספר יסודי"),
//                        or just the org type, or "עסקי" when none is set yet.
function ActivityBadge({ deal, types, subtypes, onActivityType, onDealOrgType, onSubtype, onOpenOrgDialog }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);

  const at = deal.activityType;
  const hasOrg = !!deal.organization;
  const effTypeId = hasOrg
    ? deal.organization.organizationTypeId || ''
    : deal.organizationTypeId || '';
  const effTypeLabel = hasOrg
    ? deal.organization.organizationType?.label
    : deal.organizationType?.label;
  const subtypeLabel = deal.organizationSubtype?.label;

  let label;
  if (!at) label = '+ בחר סוג פעילות';
  else if (at === 'private') label = 'פרטי';
  else if (at === 'group') label = 'קבוצתי';
  else label = [effTypeLabel, subtypeLabel].filter(Boolean).join(' ') || 'עסקי';

  const tone = at ? ACTIVITY_BADGE_TONE[at] : ACTIVITY_BADGE_NEUTRAL;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="סוג פעילות"
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold transition ${tone}`}
      >
        <span className="truncate max-w-[16rem]">{label}</span>
        <span className="text-[10px] opacity-60">▾</span>
      </button>
      <AnchoredMenu anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={252}>
        <ActivityEditor
          deal={deal}
          types={types}
          subtypes={subtypes}
          effTypeId={effTypeId}
          effTypeLabel={effTypeLabel}
          hasOrg={hasOrg}
          onActivityType={onActivityType}
          onDealOrgType={onDealOrgType}
          onSubtype={onSubtype}
          onOpenOrgDialog={onOpenOrgDialog}
          close={() => setOpen(false)}
        />
      </AnchoredMenu>
    </>
  );
}

// Editing controls for the activity badge — one continuous, progressive flow
// inside the popover (no reopening, no exposed dropdowns):
//
//   activity ─click "עסקי"→ orgType ─click a type→ subtype ─click→ done (close)
//
// Group/Private finish in one click. For business, choosing a type that has no
// subtypes finishes immediately. Changing the type clears any previous subtype
// (so an invalid "<new type> <old subtype>" can never occur). The popover
// remounts on open, so we always start at the first step.
function ActivityEditor({ deal, types, subtypes, effTypeId, effTypeLabel, hasOrg, onActivityType, onDealOrgType, onSubtype, onOpenOrgDialog, close }) {
  const [step, setStep] = useState('activity'); // 'activity' | 'orgType' | 'subtype' | 'orgLocked'
  const [typeId, setTypeId] = useState(effTypeId); // type the subtype list is scoped to

  // Subtypes valid for a given type: scoped to that type, plus generic (type-less).
  const subtypesFor = (tId) =>
    subtypes.filter((s) => !s.organizationTypeId || s.organizationTypeId === tId);

  function pickActivity(v) {
    if (v === 'business') {
      if (deal.activityType !== 'business') onActivityType('business');
      // Advance immediately to the next step — never reopen.
      if (hasOrg) {
        const tId = deal.organization.organizationTypeId || '';
        if (tId && subtypesFor(tId).length) { setTypeId(tId); setStep('subtype'); }
        else setStep('orgLocked');
      } else {
        setStep('orgType');
      }
      return;
    }
    // Group / Private — toggle and finish in one click.
    onActivityType(deal.activityType === v ? '' : v);
    close();
  }

  function pickType(t) {
    if (t.id !== effTypeId) onDealOrgType(t.id); // changing type clears old subtype
    if (subtypesFor(t.id).length) { setTypeId(t.id); setStep('subtype'); }
    else close(); // no subtypes for this type → done
  }

  function pickSubtype(id) {
    onSubtype(id);
    close();
  }

  if (step === 'orgType') {
    return (
      <StepShell title="סוג ארגון" onBack={() => setStep('activity')}>
        {types.length === 0 && <div className="px-2.5 py-2 text-[12px] text-gray-400">אין סוגי ארגון</div>}
        {types.map((t) => (
          <RowBtn key={t.id} onClick={() => pickType(t)} selected={t.id === effTypeId}>{t.label}</RowBtn>
        ))}
      </StepShell>
    );
  }

  if (step === 'subtype') {
    const list = subtypesFor(typeId);
    return (
      <StepShell title="תת-סוג" onBack={() => setStep(hasOrg ? 'activity' : 'orgType')}>
        <RowBtn onClick={() => pickSubtype('')} muted selected={!deal.organizationSubtypeId}>— ללא תת-סוג —</RowBtn>
        {list.map((s) => (
          <RowBtn key={s.id} onClick={() => pickSubtype(s.id)} selected={s.id === deal.organizationSubtypeId}>{s.label}</RowBtn>
        ))}
      </StepShell>
    );
  }

  if (step === 'orgLocked') {
    return (
      <div className="p-3 min-w-[200px]" dir="rtl">
        <div className="text-[11px] text-gray-400">סוג ארגון</div>
        <div className="mt-0.5 text-sm font-medium text-gray-800">{effTypeLabel || '—'}</div>
        <p className="text-[10px] text-gray-400 mt-0.5">נקבע על הארגון (מקור אמת יחיד).</p>
        <button
          type="button"
          onClick={() => { close(); onOpenOrgDialog(); }}
          className="mt-2 text-[12px] text-blue-700 hover:underline"
        >
          ערוך ארגון ←
        </button>
      </div>
    );
  }

  // step === 'activity'
  return (
    <div className="p-2" dir="rtl">
      <div className="px-1 pt-0.5 pb-1 text-[11px] font-semibold text-gray-400">סוג פעילות</div>
      <div className="flex gap-1.5 px-1">
        {ACTIVITY_TYPES.map((v) => {
          const on = deal.activityType === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => pickActivity(v)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-[12px] font-medium border transition ${
                on ? ACTIVITY_OPTION_ON[v] : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {ACTIVITY_TYPE_LABELS[v]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// A step in the progressive activity editor — a back arrow + title, then a
// scrollable option list.
function StepShell({ title, onBack, children }) {
  return (
    <div className="p-1.5 min-w-[200px]" dir="rtl">
      <div className="flex items-center gap-1 px-1.5 pt-0.5 pb-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="חזרה"
          className="text-gray-400 hover:text-gray-700 text-base leading-none px-1"
        >
          ›
        </button>
        <span className="text-[11px] font-semibold text-gray-400">{title}</span>
      </div>
      <div className="max-h-64 overflow-y-auto">{children}</div>
    </div>
  );
}

function RowBtn({ onClick, selected, muted, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-right rounded-md px-2.5 py-1.5 text-sm transition hover:bg-blue-50 ${
        selected ? 'font-semibold text-indigo-700 bg-indigo-50/50' : muted ? 'text-gray-500' : 'text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

// Header relationship row. ALL of the deal's contacts are shown as compact chips
// side-by-side (primary marked, role shown subtly), then the organization slot.
// Every chip / affordance opens the same in-place dialog — no navigation. The row
// wraps gracefully and collapses overflow into a "+N" chip past a sane cap so the
// header never breaks.
const MAX_CONTACT_CHIPS = 6;

function RelationshipRow({ deal, orgType, onManageContacts, onOrgClick }) {
  const contacts = deal.contacts || [];
  const shown = contacts.slice(0, MAX_CONTACT_CHIPS);
  const overflow = contacts.length - shown.length;
  const org = deal.organization;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {/* Contacts — one chip each, or an actionable empty slot */}
      {contacts.length === 0 ? (
        <IdentitySlot icon={<UserIcon />} onClick={onManageContacts}>
          הוסף איש קשר
        </IdentitySlot>
      ) : (
        <>
          {shown.map((dc) => (
            <ContactChip key={dc.id} dc={dc} onClick={onManageContacts} />
          ))}
          {overflow > 0 && (
            <button
              type="button"
              onClick={onManageContacts}
              className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[12px] text-gray-500 hover:bg-gray-100"
              title="עוד אנשי קשר"
            >
              +{overflow}
            </button>
          )}
          {/* Always-visible manage affordance */}
          <button
            type="button"
            onClick={onManageContacts}
            title="נהל אנשי קשר"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          >
            +
          </button>
        </>
      )}

      {/* Subtle separator before the organization slot */}
      {(org || contacts.length > 0) && <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden />}

      {/* Organization slot — always present */}
      {org ? (
        <HoverCard
          trigger={
            <IdentitySlot icon={<BuildingIcon />} onClick={onOrgClick} filled>
              <span className="truncate max-w-[16rem]">{org.name}</span>
            </IdentitySlot>
          }
        >
          <OrgHoverCard org={org} orgTypeLabel={orgType?.label} subtypeLabel={deal.organizationSubtype?.label} onEdit={onOrgClick} />
        </HoverCard>
      ) : (
        <IdentitySlot icon={<BuildingIcon />} onClick={onOrgClick}>
          הוסף ארגון
        </IdentitySlot>
      )}
    </div>
  );
}

// A single contact chip in the header row. The primary contact is marked with a
// subtle star + tinted border (not huge); the contact's first deal-role shows
// subtly inline, with full details (incl. all roles) in the hover card. Clicking
// opens the deal-contacts management dialog.
function ContactChip({ dc, onClick }) {
  const c = dc.contact;
  const name =
    contactNameHe(c) || `${c?.firstNameEn || ''} ${c?.lastNameEn || ''}`.trim() || '—';
  const roleLabel = (dc.roles || []).map((r) => ROLE_LABELS[r] || r)[0];
  return (
    <HoverCard
      trigger={
        <button
          type="button"
          onClick={onClick}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
            dc.isPrimary
              ? 'border border-blue-200 bg-blue-50/60 text-gray-800 hover:bg-blue-50'
              : 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
          }`}
        >
          {dc.isPrimary ? (
            <span className="text-amber-500 text-[12px] leading-none" title="איש קשר ראשי">★</span>
          ) : (
            <UserIcon />
          )}
          <span className="truncate max-w-[12rem]">{name}</span>
          {roleLabel && <span className="text-[10px] text-gray-400">· {roleLabel}</span>}
        </button>
      }
    >
      <ContactHoverCard
        contactId={dc.contactId}
        fallbackName={name}
        roles={dc.roles}
        onEdit={onClick}
      />
    </HoverCard>
  );
}

// A single header identity slot (contact or organization). `filled` switches
// between the solid "has a value" look and the dashed "actionable empty" look.
function IdentitySlot({ icon, children, onClick, filled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
        filled
          ? 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
          : 'border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function ContactHoverCard({ contactId, fallbackName, roles, onEdit }) {
  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.contacts
      .get(contactId)
      .then((d) => { if (live) setC(d); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [contactId]);

  const name = (c && contactNameHe(c)) || fallbackName || '—';
  const phones = c?.phones || [];
  const emails = c?.emails || [];

  const roleLabels = (roles || []).map((r) => ROLE_LABELS[r] || r);

  return (
    <div className="space-y-2.5">
      <div className="text-sm font-semibold text-gray-900">{name}</div>
      {roleLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {roleLabels.map((rl) => (
            <span key={rl} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{rl}</span>
          ))}
        </div>
      )}
      {loading ? (
        <div className="text-[12px] text-gray-400">טוען…</div>
      ) : phones.length || emails.length ? (
        <div className="space-y-1.5">
          {phones.length > 0 && (
            <div className="space-y-0.5">
              {phones.map((p) => (
                <div key={p.id} dir="ltr" className="text-right text-[12px] text-gray-600">
                  {p.value}{p.label ? ` · ${p.label}` : ''}
                </div>
              ))}
            </div>
          )}
          {emails.length > 0 && (
            <div className="space-y-0.5">
              {emails.map((em) => (
                <div key={em.id} dir="ltr" className="text-right text-[12px] text-gray-600">
                  {em.value}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[12px] text-gray-400">אין פרטי קשר</div>
      )}
      <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
        {/* Primary daily action: manage the deal's contacts in-place (no navigation). */}
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
        >
          נהל אנשי קשר
        </button>
        {/* Secondary: open the full contact page. */}
        <Link to={`/admin/crm/contacts/${contactId}`} className="text-[12px] text-gray-500 hover:text-gray-700 hover:underline">
          פתח איש קשר ←
        </Link>
      </div>
    </div>
  );
}

function OrgHoverCard({ org, orgTypeLabel, subtypeLabel, onEdit }) {
  return (
    <div className="space-y-2.5">
      <div className="text-sm font-semibold text-gray-900">{org.name}</div>
      <dl className="space-y-1 text-[12px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-gray-400">סוג ארגון</dt>
          <dd className="text-gray-700">{orgTypeLabel || '—'}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-gray-400">תת-סוג</dt>
          <dd className="text-gray-700">{subtypeLabel || '—'}</dd>
        </div>
      </dl>
      <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
        {/* Primary daily action: edit in-place (no navigation). */}
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
        >
          ערוך ארגון
        </button>
        {/* Secondary: open the full organization page. */}
        <Link to={`/admin/crm/organizations/${org.id}`} className="text-[12px] text-gray-500 hover:text-gray-700 hover:underline">
          פתח ארגון ←
        </Link>
      </div>
    </div>
  );
}

// variant: 'default' = elevated card for the center workspace; 'panel' = lighter
// card that sits calmly inside a side panel (no shadow, tighter padding).
function Card({ title, action, children, variant = 'default' }) {
  const panel = variant === 'panel';
  return (
    <section
      className={`bg-white border border-gray-200 ${panel ? 'rounded-xl' : 'rounded-2xl shadow-sm'}`}
    >
      <div
        className={`flex items-center justify-between gap-2 border-b border-gray-100 ${
          panel ? 'px-4 pt-3 pb-2.5' : 'px-5 pt-4 pb-3'
        }`}
      >
        <h2 className={`font-semibold text-gray-900 ${panel ? 'text-[13px]' : 'text-[15px]'}`}>
          {title}
        </h2>
        {action}
      </div>
      <div className={panel ? 'p-4' : 'p-5'}>{children}</div>
    </section>
  );
}
function FieldBox({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 tabular-nums" dir="ltr">{value}</dd>
    </div>
  );
}
