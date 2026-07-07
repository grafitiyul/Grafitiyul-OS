import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import HoverCard from '../common/HoverCard.jsx';
import LostDealDialog from './LostDealDialog.jsx';
import DealSalesScript from './DealSalesScript.jsx';
import DealContactsDialog from './DealContactsDialog.jsx';
import OrganizationEditDialog from './OrganizationEditDialog.jsx';
import PriceBuilderDialog from './PriceBuilderDialog.jsx';
import Dialog from '../common/Dialog.jsx';
import GroupTicketBuilderDialog from './GroupTicketBuilderDialog.jsx';
import WorkspaceLayout from '../../shell/WorkspaceLayout.jsx';
import TimelineFeed from '../common/timeline/TimelineFeed.jsx';
import WhatsAppDock from '../whatsapp/WhatsAppDock.jsx';
import { minorToInput } from '../../lib/money.js';
import { useDirtyForm, useDirtyWhen, valuesEqual } from '../../lib/dirtyForms.js';
import { contactNamesFromParts } from '../../lib/nameSplit.js';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_BADGE_TONE,
  ACTIVITY_BADGE_NEUTRAL,
  resolveActivityLabel,
  ROLE_LABELS,
  TOUR_LANGS,
  contactNameHe,
  FINANCE_WORKSPACE,
  resolveFinanceWorkspace,
} from './config.js';
import RichEditor from '../../editor/RichEditor.jsx';
import { InlineEditScope } from '../common/inline/InlineEditScope.jsx';
import InlineField from '../common/inline/InlineField.jsx';
import { InlineDatePicker, InlineTimePicker } from '../common/inline/InlinePickers.jsx';
import ProduceDocumentModal from './icount/ProduceDocumentModal.jsx';
import CustomPaymentLinkModal from './icount/CustomPaymentLinkModal.jsx';
import CollapsibleNote from '../common/inline/CollapsibleNote.jsx';

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
// `dealId` prop overrides the route param — lets the WhatsApp inbox (and any
// future surface) embed the full deal workspace inside a drawer.
export default function DealDetail({ dealId: dealIdProp = null }) {
  const { id: routeId } = useParams();
  const id = dealIdProp || routeId;
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
  // Product/pricing (Tour Details). Catalog lists load once; `variants` holds the
  // selected product's Product×Location options ("cities"). The base price is now
  // owned by the Price Builder modal (opened from the base-price summary).
  const [products, setProducts] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [variants, setVariants] = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [priceBuilderOpen, setPriceBuilderOpen] = useState(false);

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
        source: d.source || '',
        dealStageId: d.dealStageId || '',
        expectedCloseDate: d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '',
        notes: d.notes || '',
        organizationId: d.organizationId || '',
        organizationUnitId: d.organizationUnitId || '',
        organizationSubtypeId: d.organizationSubtypeId || '',
        // "פרטי הסיור" working fields.
        activityType: d.activityType || '',
        tourDate: d.tourDate || '',
        tourTime: d.tourTime || '',
        participants: d.participants ?? '',
        // Auto-fill defaults (suggestion only): empty → Hebrew. Applied at load
        // when empty; the baseline below is set to the SAME value, so a default is
        // never flagged as an unsaved change and never silently re-applied after
        // the user overrides it.
        tourLanguage: d.tourLanguage || 'he',
        customerInfo: d.customerInfo || '',
        quoteEmailIntro: d.quoteEmailIntro || '',
        // Operational product/location selection. Base pricing lives in the
        // Price Builder (Deal.priceLines); the field here is a read-only summary.
        productId: d.productId || '',
        productVariantId: d.productVariantId || '',
        locationId: d.locationId || '',
      };
      setForm(init);
      setOriginalForm(init);
      // City options for the already-selected product (no auto-fill on load).
      if (d.productId) {
        try {
          const p = await api.products.get(d.productId);
          setVariants(p.variants || []);
          // Legacy deals saved before Deal.locationId existed: derive the city from
          // the saved variant so the selector isn't blank (patch baseline too → not dirty).
          if (!d.locationId && d.productVariantId) {
            const v = (p.variants || []).find((x) => x.id === d.productVariantId);
            const locId = v ? v.location?.id || v.locationId : '';
            if (locId) {
              setForm((f) => ({ ...f, locationId: locId }));
              setOriginalForm((o) => (o ? { ...o, locationId: locId } : o));
            }
          }
        } catch {
          setVariants([]);
        }
      } else {
        setVariants([]);
      }
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

  // Catalogs for the Product selector + activity-type mapping. Loaded once.
  useEffect(() => {
    api.products.list().then(setProducts).catch(() => {});
    api.activityTypes.list().then(setActivityTypes).catch(() => {});
    api.locations.list().then(setAllLocations).catch(() => {});
  }, []);

  // Map the Deal's activityType (group|private|business) to the pricing
  // ActivityType catalog (public|private|business). 'group' → 'public' — the
  // catalog's public row is labelled "קבוצתי". One mapping, no forked logic.
  function resolveActivityTypeId(actKey) {
    if (!actKey) return null;
    const mapped = actKey === 'group' ? 'public' : actKey;
    return activityTypes.find((a) => a.key === mapped)?.id || null;
  }

  // Pick a product → load its city/location options and auto-fill the city
  // (one → it; many → the first/default). Operational selection; pricing now lives
  // in the Price Builder, which reads this as context.
  async function chooseProduct(productId) {
    if (!productId) {
      setVariants([]);
      setForm((f) => ({ ...f, productId: '', productVariantId: '', locationId: '' }));
      return;
    }
    setForm((f) => ({ ...f, productId }));
    try {
      const p = await api.products.get(productId);
      const vs = p.variants || [];
      setVariants(vs);
      // Auto-fill the city to the first/default variant's location (recommended).
      const first = vs[0];
      setForm((f) => ({
        ...f,
        productVariantId: first ? first.id : '',
        locationId: first ? first.location?.id || first.locationId || '' : '',
      }));
    } catch {
      setVariants([]);
      setForm((f) => ({ ...f, productVariantId: '', locationId: '' }));
    }
  }

  // Choose a location (city). Resolve the matching ProductVariant for the current
  // product when one exists; otherwise leave productVariantId empty (a non-variant
  // "other" location — pricing resolves without a variant, see the inline hint).
  function chooseLocation(locationId) {
    const v = variants.find((x) => (x.location?.id || x.locationId) === locationId);
    setForm((f) => ({ ...f, locationId, productVariantId: v ? v.id : '' }));
  }

  // Pricing context handed to the Price Builder (it owns the calculation now).
  const priceContext = useMemo(
    () =>
      form
        ? {
            productId: form.productId || null,
            productVariantId: form.productVariantId || null,
            activityTypeId: resolveActivityTypeId(form.activityType),
            // Deal classification wins: the deal's own type overrides the linked
            // organization's default (same precedence the quote composer uses).
            organizationTypeId: deal?.organizationTypeId || orgType?.id || null,
            organizationSubtypeId: deal?.organizationSubtypeId || null,
            participantCount: form.participants === '' ? 0 : Number(form.participants),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      form?.productId,
      form?.productVariantId,
      form?.activityType,
      form?.participants,
      orgType?.id,
      deal?.organizationTypeId,
      deal?.organizationSubtypeId,
      activityTypes,
    ],
  );

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
        paymentTermId: deal.paymentTermId || null,
        paymentMethodId: deal.paymentMethodId || null,
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

  // Right panel — TWO cards. Card 1 "פרטי הסיור" (operational, all activity types)
  // holds how the tour happens INCLUDING its base price. Card 2 "הצעת מחיר"
  // Pipeline-stage Display Mode → Read First (click to edit) vs Edit First (open).
  const stage = stages.find((s) => s.id === deal.dealStageId);
  const editFirst = stage?.displayMode === 'edit';

  // Location options: recommended = the product's variant locations; other = every
  // remaining CRM location (never hidden). Reuses variant + Location data.
  const recLocIds = new Set(variants.map((v) => v.location?.id || v.locationId).filter(Boolean));
  const recommendedLocs = variants
    .map((v) => ({ value: v.location?.id || v.locationId, label: v.location?.nameHe || '—' }))
    .filter((o) => o.value);
  const otherLocs = allLocations.filter((l) => !recLocIds.has(l.id)).map((l) => ({ value: l.id, label: l.nameHe }));
  const cityOptions = [];
  if (recommendedLocs.length) cityOptions.push({ label: 'מומלץ למוצר זה', options: recommendedLocs });
  cityOptions.push({ label: recommendedLocs.length ? 'מיקומים נוספים' : 'מיקומים', options: otherLocs });
  const productOptions = products.map((p) => ({ value: p.id, label: p.nameHe }));
  const tourLangOptions = TOUR_LANGS.map((l) => ({ value: l.key, label: l.label }));
  const locNotConfigured = !!deal.productId && !!deal.locationId && !recLocIds.has(deal.locationId);
  // Visual-only reminder: a home location is configured AND this deal's city is a
  // different one. Never blocks/warns/affects pricing — just paints the City red.
  const homeLocation = allLocations.find((l) => l.isHomeLocation) || null;
  const cityIsNonHome = !!(homeLocation && deal.locationId && deal.locationId !== homeLocation.id);
  // Group deals derive participants from the Group Ticket Builder ticket quantities,
  // so the panel field is locked (read-only). Business/Private stay editable. Uses
  // the single routing source of truth (no scattered activityType checks).
  const isGroup = resolveFinanceWorkspace(deal) === FINANCE_WORKSPACE.TICKET_BUILDER;
  // Full-color emoji field icons — secondary to the values, small but clearly
  // recognisable. The value remains the strongest visual element.
  const FIELD_EMOJI = 'text-[14px] leading-none';

  // Per-field inline save: persist ONLY that field, then refresh → back to read.
  const saveField = (patch) => api.deals.update(id, patch).then(refresh);
  async function saveProduct(productId) {
    if (!productId) return saveField({ productId: null, productVariantId: null, locationId: null });
    const p = await api.products.get(productId);
    const first = (p.variants || [])[0];
    return saveField({
      productId,
      productVariantId: first ? first.id : null,
      locationId: first ? first.location?.id || first.locationId : null,
    });
  }
  function saveLocation(locationId) {
    const v = variants.find((x) => (x.location?.id || x.locationId) === locationId);
    return saveField({ locationId: locationId || null, productVariantId: v ? v.id : null });
  }

  const dealProperties = (
    <InlineEditScope>
      <div className="space-y-4">
        {/* ── Card 1 — פרטי הסיור (operational). Inline read-first editing. ── */}
        <Card variant="panel" title="פרטי הסיור">
          <div className="space-y-3.5">
            {/* Strict 3-column grid: every field has a FIXED position — the layout
                never floats with content. Each field is an emoji ICON (its visual
                identifier; hover = field name) tightly attached to its clickable
                value. Clicking the value edits inline exactly as before; the icon is
                not clickable.
                  Row 1: Product (cols 1-2) · Price (col 3)
                  Row 2: Date · Time · Participants
                  Row 3: City · Tour Language · (empty) */}
            <div className="grid grid-cols-[1.9fr_1fr_1fr] gap-x-2 gap-y-3">
              {/* Row 1 */}
              <div className="col-span-2">
                <InlineField id="f-product" iconInline icon={<span className={FIELD_EMOJI}>📦</span>} label="מוצר"
                  type="dropdown" value={deal.productId || ''} options={productOptions} editFirst={editFirst}
                  placeholder="בחר מוצר" onSave={(v) => saveProduct(v)} />
              </div>
              <div className="flex items-center gap-1 min-w-0">
                <span title="מחיר" className={`shrink-0 inline-flex cursor-default ${FIELD_EMOJI}`}>💰</span>
                <button
                  type="button"
                  onClick={() => setPriceBuilderOpen(true)}
                  title="פתח בונה מחיר"
                  className="flex-1 min-w-0 text-right rounded-md px-1 min-h-[34px] flex items-center transition-colors hover:bg-gray-50"
                >
                  <span className="text-[15px] font-bold text-gray-900" dir="ltr">{deal.valueMinor ? `₪${minorToInput(deal.valueMinor)}` : '—'}</span>
                </button>
              </div>

              {/* Row 2 */}
              <InlineDatePicker id="f-date" icon={<span className={FIELD_EMOJI}>📅</span>} label="תאריך"
                value={deal.tourDate || ''} placeholder="בחר תאריך"
                onSave={(v) => saveField({ tourDate: v || null })} />
              <InlineTimePicker id="f-time" icon={<span className={FIELD_EMOJI}>🕒</span>} label="שעה"
                value={deal.tourTime || ''} placeholder="בחר שעה"
                onSave={(v) => saveField({ tourTime: v || null })} />
              <InlineField id="f-participants" iconInline icon={<span className={FIELD_EMOJI}>👥</span>} label="משתתפים"
                type="number" numeric value={deal.participants ?? ''} editFirst={editFirst}
                readOnly={isGroup}
                readOnlyHint="מספר המשתתפים בדיל קבוצתי נגזר מכמות הכרטיסים בבונה הכרטיסים הקבוצתי"
                onSave={(v) => saveField({ participants: v === '' ? null : Number(v) })} />

              {/* Row 3 — col 3 intentionally empty. City value turns red as a
                  visual-only reminder when the city differs from the Home Location. */}
              <InlineField id="f-city" iconInline icon={<span className={FIELD_EMOJI}>📍</span>} label="עיר"
                type="dropdown" value={deal.locationId || ''} options={cityOptions} editFirst={editFirst}
                placeholder="בחר עיר"
                valueClassName={cityIsNonHome ? 'text-[15px] font-semibold text-red-600' : undefined}
                onSave={(v) => saveLocation(v)} />
              <InlineField id="f-tourlang" iconInline icon={<span className={FIELD_EMOJI}>🌍</span>} label="שפת הסיור"
                type="dropdown" value={deal.tourLanguage || ''} options={tourLangOptions} editFirst={editFirst}
                placeholder="ללא" onSave={(v) => saveField({ tourLanguage: v || null })} />
            </div>
            {locNotConfigured && (
              <p className="text-[12px] text-amber-600">
                העיר שנבחרה אינה מוגדרת כוריאנט של המוצר. ייתכן שיידרש תיאום מחיר ידני בבונה המחיר.
              </p>
            )}

            {/* Operational action bar — payment-link actions are live (permanent
                /pay URL); the other actions are still placeholders. */}
            <DealActionRow
              deal={deal}
              productName={products.find((p) => p.id === deal.productId)?.nameHe || deal.title}
              onOpenPriceBuilder={() => setPriceBuilderOpen(true)}
              onRefresh={refresh}
            />

            {/* Important customer information — sits BELOW the action bar. Collapsed to
                ~3 formatted lines by default, with a "show more" control. */}
            <CollapsibleNote id="f-customerInfo" label="מידע חשוב על הלקוח" value={deal.customerInfo || ''} rich
              placeholder="הוסיפו מידע פנימי חשוב לשיחה…"
              onSave={(v) => saveField({ customerInfo: v || null })} />
          </div>
        </Card>

        {/* Quote Module (Slice 3) — entry point to the Quote Preview Canvas
            (internal admin draft workspace). Ensures a draft QuoteDocument and
            opens the canvas. Public page / PDF / signature are built later. */}
        <Card variant="panel" title="הצעת מחיר">
          <p className="mb-3 text-[12px] text-gray-500">בנייה ועיצוב של מסמך הצעת המחיר ללקוח.</p>
          <Link
            to={`/admin/quote/${deal.id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            📄 הצעת מחיר (בטא)
          </Link>
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

        <SystemInfo deal={deal} />
      </div>
    </InlineEditScope>
  );

  return (
    <WorkspaceLayout
      storageKey="gos.workspace.deal"
      right={{ title: 'פרטי הדיל', content: dealProperties, defaultWidth: 460, minWidth: 360, maxWidth: 720 }}
      left={{ title: 'תסריט מכירה', content: <DealSalesScript />, defaultWidth: 300, minWidth: 220, maxWidth: 460 }}
      seamLeft={<WhatsAppDock subjectType="deal" subjectId={deal.id} />}
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
              // Selecting a subtype also stamps its parent Organization Type, so the
              // deal's type/subtype can never diverge. For an org-linked deal the
              // server is the SSOT and force-nulls Deal.organizationTypeId, so this
              // parent write is safely ignored there — no duplicate source of truth.
              onSubtype={(v, parentTypeId) =>
                updateDeal({
                  organizationSubtypeId: v || null,
                  ...(parentTypeId ? { organizationTypeId: parentTypeId } : {}),
                })
              }
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
          Contacts live in the header relationship row now (no separate card).
          WhatsApp lives in the floating dock (below), NOT as a timeline tab —
          the chat must not permanently consume the deal workspace. */}
      <TimelineFeed subjectType="deal" subjectId={deal.id} showWhatsApp={false} />

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
      {/* Which finance workspace opens is resolved in ONE place (config.js) so the
          rule is swappable for the future "Activity Type → Finance Workspace" CRM
          setting — no scattered activityType checks. Routing only: it never filters
          which Pricing Cards appear (the card's flag is the sole authority). */}
      {resolveFinanceWorkspace(deal) === FINANCE_WORKSPACE.TICKET_BUILDER ? (
        <GroupTicketBuilderDialog
          deal={deal}
          context={priceContext}
          open={priceBuilderOpen}
          onClose={() => setPriceBuilderOpen(false)}
          onSaved={refresh}
        />
      ) : (
        <PriceBuilderDialog
          deal={deal}
          context={priceContext}
          open={priceBuilderOpen}
          onClose={() => setPriceBuilderOpen(false)}
          onSaved={refresh}
        />
      )}

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
// Manual save with a clear unsaved-changes state (no autosave). Disabled + muted
// when clean; emphasized + an explicit "unsaved changes" hint when dirty.
function SaveBtn({ onClick, busy, dirty }) {
  return (
    <div className="flex items-center gap-2">
      {dirty && !busy && (
        <span className="text-[11px] font-medium text-amber-600">יש שינויים שלא נשמרו</span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !dirty}
        className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${
          dirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400'
        }`}
      >
        {busy ? 'שומר…' : 'שמור'}
      </button>
    </div>
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

// Selected-option styling inside the editor popover. (Badge tone maps live in
// deals/config.js — shared with the WhatsApp inbox badge, one source only.)
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
  // The deal's effective classification: its OWN organization type if set (the
  // per-deal override), otherwise the linked organization's default. The selector
  // can freely change it for THIS deal, regardless of the linked organization.
  const effTypeId = deal.organizationTypeId || deal.organization?.organizationTypeId || '';
  const effTypeLabel = deal.organizationType?.label || deal.organization?.organizationType?.label;
  const subtypeLabel = deal.organizationSubtype?.label;

  // Shared resolver — the WhatsApp inbox badge uses the exact same function.
  const label =
    resolveActivityLabel({ activityType: at, orgTypeLabel: effTypeLabel, subtypeLabel }) ||
    '+ בחר סוג פעילות';

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
//   activity ─click "עסקי"→ orgType ⇄ subtype   (back always returns to orgType)
//
// Group/Private finish in one click. For business it always lands on the type step:
//   • deal-level (no org) → the deal owns the type, so the full type list is
//     selectable; picking a type clears the old subtype, then goes to its subtypes.
//   • org-linked → the ORGANIZATION owns the type (SSOT): the step shows it
//     read-only with an edit-org link, plus a shortcut into the deal-owned subtype.
// Because back from 'subtype' returns to 'orgType' (never to 'activity'), a subtype
// never traps the user — the parent type is always reachable. The popover remounts
// on open, so we always start at the first step.
function ActivityEditor({ deal, types, subtypes, effTypeId, effTypeLabel, hasOrg, onActivityType, onDealOrgType, onSubtype, onOpenOrgDialog, close }) {
  const [step, setStep] = useState('activity'); // 'activity' | 'orgType' | 'subtype'
  const [typeId, setTypeId] = useState(effTypeId); // type the subtype list is scoped to

  // Subtypes valid for a given type: scoped to that type, plus generic (type-less).
  const subtypesFor = (tId) =>
    subtypes.filter((s) => !s.organizationTypeId || s.organizationTypeId === tId);

  function pickActivity(v) {
    if (v === 'business') {
      if (deal.activityType !== 'business') onActivityType('business');
      // Always advance to the FULL, editable type list — for every deal, org-linked
      // or not. The type chosen here is THIS deal's quote classification (it may
      // differ from the linked organization's default), so the parent type is always
      // reachable and a subtype can never trap the user in subtype-only.
      setStep('orgType');
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

  function pickSubtype(id, subtype) {
    // Stamp the subtype's parent type too, so type + subtype never diverge.
    onSubtype(id, subtype?.organizationTypeId || null);
    close();
  }

  if (step === 'orgType') {
    // The FULL Organization Type list, always selectable — this sets THIS deal's
    // classification. A linked organization does NOT restrict the choice; its own
    // type is only a default. (Master org data is edited elsewhere, not here.)
    return (
      <StepShell title="סוג ארגון (לצורך ההצעה)" onBack={() => setStep('activity')}>
        {types.length === 0 && <div className="px-2.5 py-2 text-[12px] text-gray-400">אין סוגי ארגון</div>}
        {types.map((t) => (
          <RowBtn key={t.id} onClick={() => pickType(t)} selected={t.id === effTypeId}>{t.label}</RowBtn>
        ))}
      </StepShell>
    );
  }

  if (step === 'subtype') {
    const list = subtypesFor(typeId);
    // Back ALWAYS returns to the type step (never straight to 'activity'), so from a
    // subtype the user can always reach — and change — the parent type.
    return (
      <StepShell title="תת-סוג" onBack={() => setStep('orgType')}>
        <RowBtn onClick={() => pickSubtype('')} muted selected={!deal.organizationSubtypeId}>— ללא תת-סוג —</RowBtn>
        {list.map((s) => (
          <RowBtn key={s.id} onClick={() => pickSubtype(s.id, s)} selected={s.id === deal.organizationSubtypeId}>{s.label}</RowBtn>
        ))}
      </StepShell>
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
// Operational action bar under the Tour Details fields. The PRIMARY action varies
// by Activity Type; "תשלום" and "פעולות" are shared. The payment-link actions are
// LIVE; the rest are placeholders. When tour bookings exist, a Group deal's
// primary will switch from "שבץ לסיור" to "החלף סיור" based on assignment.
function dealPrimaryAction(activityType, groupAssigned) {
  if (activityType === 'private') return 'צור סיור';
  if (activityType === 'group') return groupAssigned ? 'החלף סיור' : 'שבץ לסיור';
  return 'הפק הצעת מחיר'; // business + default
}
// Prefill contact — mirror of the server's pick (dealPayment.js): first contact
// flagged to receive payment links, else the primary/first contact.
function pickPaymentContact(contacts) {
  const list = contacts || [];
  return list.find((dc) => dc.receivePaymentLinks) || list[0] || null;
}
function waHref(phone, text) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
const DLG_FIELD = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full';
const EMPTY_DLG_FORM = { first: '', last: '', phone: '', email: '' };

// A customer detail that already exists — shown read-only (calm gray box with
// a check) so the dialog reads as "review & complete the customer's details".
// The subtle pencil turns JUST that field editable, so outdated info can be
// fixed inline without leaving the payment flow or opening the full editor.
function DlgKnownValue({ children, dir, onEdit }) {
  return (
    <div className="group flex items-center justify-between gap-2 rounded-md bg-gray-50 border border-gray-200 px-3 py-1.5">
      <span dir={dir} className="text-sm text-gray-800 truncate">{children}</span>
      <span className="shrink-0 inline-flex items-center gap-1">
        <span className="text-[12px] text-emerald-600">✓</span>
        <button
          type="button"
          onClick={onEdit}
          title="ערוך"
          aria-label="ערוך"
          className="rounded p-0.5 text-gray-300 group-hover:text-gray-400 hover:!text-gray-600 hover:bg-gray-200/60 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>
      </span>
    </div>
  );
}

function DealActionRow({ deal, productName, onOpenPriceBuilder, onRefresh }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  // No tour-assignment model yet → a Group deal is always "before assignment".
  const groupAssigned = false;
  const soon = 'בקרוב';

  // ── Payment link (permanent GOS /pay URL — the ONLY URL customers get) ────
  // "תשלום" OPENS the link; copy / WhatsApp live in the actions menu. All are
  // instant — no confirmation popup on success. A dialog appears only when
  // data is missing: amount is REQUIRED (blocks; iCount needs a priced item),
  // customer details are OPTIONAL and completed INLINE in the dialog — saved
  // to the real Contact record (never a payment-only copy), then the original
  // action continues automatically.
  const [payBusy, setPayBusy] = useState(false);
  const [payFeedback, setPayFeedback] = useState(null);
  const [missingDialog, setMissingDialog] = useState(null); // { action, kind: 'amount'|'details', needName, needPhone, needEmail }
  // iCount accounting: "הפק מסמך" + "קישור לתשלום מותאם אישית".
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [customLinkOpen, setCustomLinkOpen] = useState(false);
  const [dlgForm, setDlgForm] = useState(EMPTY_DLG_FORM);
  // Pencil-edit state: an EXISTING value the user chose to correct inline.
  const [dlgEdit, setDlgEdit] = useState({ name: false, phone: false, email: false });
  const feedbackTimer = useRef(null);

  const contact = pickPaymentContact(deal.contacts)?.contact || null;
  const contactName =
    contactNameHe(contact) || `${contact?.firstNameEn || ''} ${contact?.lastNameEn || ''}`.trim();
  const contactPhone = contact?.phones?.[0]?.value || '';
  const contactEmail = contact?.emails?.[0]?.value || '';
  const amountMinor = Number(deal.valueMinor || 0);

  function flash(msg) {
    setPayFeedback(msg);
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setPayFeedback(null), 2500);
  }

  async function runPayAction(action, over = {}) {
    setMissingDialog(null);
    setPayBusy(true);
    try {
      // Token is permanent — every call returns the SAME URL for this deal.
      const { paymentUrl } = await api.deals.ensurePaymentToken(deal.id);
      if (action === 'copy') {
        await navigator.clipboard.writeText(paymentUrl);
        flash('✓ קישור התשלום הועתק');
      } else if (action === 'open') {
        window.open(paymentUrl, '_blank', 'noopener');
      } else if (action === 'wa') {
        const name = over.name ?? contactName;
        const text = `שלום${name ? ` ${name}` : ''}, מצורף קישור לתשלום עבור ${productName}: ${paymentUrl}`;
        const wa = waHref(over.phone ?? contactPhone, text);
        if (wa) window.open(wa, '_blank', 'noopener');
      }
    } catch {
      flash('פעולת קישור התשלום נכשלה — נסו שוב');
    } finally {
      setPayBusy(false);
    }
  }

  function payAction(action) {
    setMenuOpen(false);
    if (amountMinor <= 0) return setMissingDialog({ action, kind: 'amount' });
    const needName = !contactName;
    const needPhone = !contactPhone;
    const needEmail = !contactEmail;
    if (needName || needPhone || needEmail) {
      setDlgForm(EMPTY_DLG_FORM);
      setDlgEdit({ name: false, phone: false, email: false });
      return setMissingDialog({ action, kind: 'details', needName, needPhone, needEmail });
    }
    runPayAction(action);
  }

  // Pencil click: seed the form with the current value and make ONLY that
  // field editable.
  function startDlgEdit(field) {
    if (field === 'name') {
      setDlgForm((s) => ({
        ...s,
        first: contact?.firstNameHe || contact?.firstNameEn || '',
        last: contact?.lastNameHe || contact?.lastNameEn || '',
      }));
    } else if (field === 'phone') {
      setDlgForm((s) => ({ ...s, phone: contactPhone }));
    } else if (field === 'email') {
      setDlgForm((s) => ({ ...s, email: contactEmail }));
    }
    setDlgEdit((s) => ({ ...s, [field]: true }));
  }

  // Save the filled fields to their real source of truth — the Contact record
  // (creating + linking a primary contact when the deal has none; pencil-edited
  // existing values update their existing phone/email rows) — then continue
  // the original action with the fresh values.
  async function saveDetailsAndContinue() {
    const { action, needName, needPhone, needEmail } = missingDialog;
    const first = dlgForm.first.trim();
    const last = dlgForm.last.trim();
    const phone = dlgForm.phone.trim();
    const email = dlgForm.email.trim();
    setPayBusy(true);
    try {
      if (!contact) {
        // No contact on the deal — a name is required to create one (enforced
        // by the disabled save button).
        const created = await api.contacts.create(contactNamesFromParts(first, last));
        if (phone) await api.contacts.addPhone(created.id, { value: phone, isPrimary: true });
        if (email) await api.contacts.addEmail(created.id, { value: email, isPrimary: true });
        await api.deals.addContact(deal.id, { contactId: created.id, isPrimary: true });
      } else {
        // A field is written only when it was editable (missing OR pencil-
        // edited), non-empty, and actually changed. Existing rows are UPDATED
        // in place — never duplicated.
        const fullName = [first, last].filter(Boolean).join(' ');
        if ((needName || dlgEdit.name) && first && fullName !== contactName) {
          await api.contacts.update(contact.id, contactNamesFromParts(first, last));
        }
        if ((needPhone || dlgEdit.phone) && phone && phone !== contactPhone) {
          const row = contact.phones?.[0];
          if (row) await api.contacts.updatePhone(row.id, { value: phone });
          else await api.contacts.addPhone(contact.id, { value: phone, isPrimary: true });
        }
        if ((needEmail || dlgEdit.email) && email && email !== contactEmail) {
          const row = contact.emails?.[0];
          if (row) await api.contacts.updateEmail(row.id, { value: email });
          else await api.contacts.addEmail(contact.id, { value: email, isPrimary: true });
        }
      }
    } catch (e) {
      setPayBusy(false);
      flash(`שמירת הפרטים נכשלה: ${e?.payload?.error || e?.message || ''}`);
      return;
    }
    onRefresh?.(); // background — the action itself doesn't depend on it
    await runPayAction(action, {
      phone: phone || contactPhone,
      name: [first, last].filter(Boolean).join(' ') || contactName,
    });
  }

  const PAY_MENU_ACTIONS = [
    { key: 'copy', label: 'העתק קישור לתשלום' },
    { key: 'wa', label: 'שלח קישור בוואטסאפ' },
  ];
  const PLACEHOLDER_ACTIONS = ['הסר הרשמה מסיור', 'שליחת מייל אישור'];

  const dlg = missingDialog;
  // Effective values after the form: what the action would actually run with.
  const effPhone = dlgForm.phone.trim() || contactPhone;
  // Creating a brand-new contact requires a name; WhatsApp requires a phone.
  const canSave =
    !payBusy &&
    (contact ? true : !!dlgForm.first.trim()) &&
    (dlg?.action !== 'wa' || !!effPhone);
  const canSkip = !payBusy && (dlg?.action !== 'wa' || !!contactPhone);
  const dlgBtn = (label, onClick, { primary = false, disabled = false } = {}) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? 'text-sm text-white rounded px-4 py-1.5 font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
          : 'text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100 disabled:opacity-50'
      }
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
      <button type="button" title={soon}
        className="rounded-lg bg-blue-600 text-white text-sm font-semibold px-4 py-2 hover:bg-blue-700">
        {dealPrimaryAction(deal.activityType, groupAssigned)}
      </button>
      <button type="button" disabled={payBusy} onClick={() => payAction('open')}
        title="פתח את קישור התשלום הקבוע של העסקה"
        className="rounded-lg border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 hover:bg-gray-50 disabled:opacity-50">
        תשלום
      </button>
      <button ref={menuRef} type="button" onClick={() => setMenuOpen((o) => !o)}
        aria-haspopup="menu" aria-expanded={menuOpen}
        className="rounded-lg border border-gray-300 text-gray-700 text-sm font-medium px-3 py-2 hover:bg-gray-50 inline-flex items-center gap-1">
        פעולות <span className="text-[9px] text-gray-400">▼</span>
      </button>
      {payFeedback && <span className="text-[12px] text-gray-500">{payFeedback}</span>}
      <AnchoredMenu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} width={216} align="start">
        {PAY_MENU_ACTIONS.map((a) => (
          <button key={a.key} type="button" disabled={payBusy} onClick={() => payAction(a.key)}
            className="block w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {a.label}
          </button>
        ))}
        <div className="my-1 border-t border-gray-100" />
        <button type="button" onClick={() => { setMenuOpen(false); setDocModalOpen(true); }}
          className="block w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          הפק מסמך
        </button>
        <button type="button" onClick={() => { setMenuOpen(false); setCustomLinkOpen(true); }}
          className="block w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          קישור לתשלום מותאם אישית
        </button>
        <div className="my-1 border-t border-gray-100" />
        {PLACEHOLDER_ACTIONS.map((label) => (
          <button key={label} type="button" onClick={() => setMenuOpen(false)} title={soon}
            className="block w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            {label}
          </button>
        ))}
      </AnchoredMenu>

      <ProduceDocumentModal dealId={deal.id} open={docModalOpen} onClose={() => setDocModalOpen(false)} />
      <CustomPaymentLinkModal dealId={deal.id} open={customLinkOpen} onClose={() => setCustomLinkOpen(false)} />

      {/* Missing-data dialog — the only popup in the payment flow. Details are
          completed INLINE and saved to the Contact, then the action continues. */}
      <Dialog
        open={dlg !== null}
        onClose={() => (payBusy ? null : setMissingDialog(null))}
        title={dlg?.kind === 'amount' ? 'חסר מחיר לעסקה' : 'השלמת פרטי לקוח'}
        size={dlg?.kind === 'details' ? 'lg' : 'md'}
        footer={
          dlg?.kind === 'amount' ? (
            <>
              {dlgBtn('ביטול', () => setMissingDialog(null))}
              {dlgBtn('פתח בונה מחיר', () => { setMissingDialog(null); onOpenPriceBuilder(); }, { primary: true })}
            </>
          ) : (
            <>
              {dlgBtn('ביטול', () => setMissingDialog(null), { disabled: payBusy })}
              {dlgBtn('המשך בלי הפרטים', () => runPayAction(dlg.action), { disabled: !canSkip })}
              {dlgBtn(payBusy ? 'שומר…' : 'שמור והמשך', saveDetailsAndContinue, { primary: true, disabled: !canSave })}
            </>
          )
        }
      >
        {dlg?.kind === 'amount' && (
          <p className="text-sm text-gray-800">
            לא ניתן ליצור קישור תשלום ללא סכום — אייקאונט דורש פריט עם מחיר.
            קבעו מחיר לעסקה בבונה המחיר ונסו שוב.
          </p>
        )}
        {dlg?.kind === 'details' && (
          <div className="space-y-5 py-1">
            <p className="text-sm text-gray-800">
              {contact
                ? 'אלה פרטי הלקוח שימולאו מראש בעמוד התשלום. השלימו את החסר — ואפשר גם לתקן פרט קיים בלחיצה על העיפרון. הכל נשמר על איש הקשר של הדיל.'
                : 'לדיל אין עדיין איש קשר. מלאו את הפרטים כאן — ייווצר איש קשר ראשי לדיל וישמש לעמוד התשלום.'}
            </p>
            <div className="space-y-4">
              {/* The full known picture: existing values read-only (pencil turns
                  just that field editable), missing ones editable from the start. */}
              <FieldBox label={dlg.needName && !contact ? 'שם *' : 'שם'}>
                {dlg.needName || dlgEdit.name ? (
                  <div className="grid grid-cols-2 gap-3">
                    <input autoFocus placeholder="שם פרטי" value={dlgForm.first} className={DLG_FIELD}
                      onChange={(e) => setDlgForm((s) => ({ ...s, first: e.target.value }))} />
                    <input placeholder="שם משפחה" value={dlgForm.last} className={DLG_FIELD}
                      onChange={(e) => setDlgForm((s) => ({ ...s, last: e.target.value }))} />
                  </div>
                ) : (
                  <DlgKnownValue onEdit={() => startDlgEdit('name')}>{contactName}</DlgKnownValue>
                )}
              </FieldBox>
              <FieldBox label={dlg.needPhone && dlg.action === 'wa' ? 'טלפון *' : 'טלפון'}>
                {dlg.needPhone || dlgEdit.phone ? (
                  <input autoFocus={dlgEdit.phone || !dlg.needName} placeholder="050-0000000"
                    value={dlgForm.phone} dir="ltr" className={DLG_FIELD}
                    onChange={(e) => setDlgForm((s) => ({ ...s, phone: e.target.value }))} />
                ) : (
                  <DlgKnownValue dir="ltr" onEdit={() => startDlgEdit('phone')}>{contactPhone}</DlgKnownValue>
                )}
              </FieldBox>
              <FieldBox label="אימייל">
                {dlg.needEmail || dlgEdit.email ? (
                  <input autoFocus={dlgEdit.email || (!dlg.needName && !dlg.needPhone)} placeholder="name@example.com"
                    value={dlgForm.email} dir="ltr" className={DLG_FIELD}
                    onChange={(e) => setDlgForm((s) => ({ ...s, email: e.target.value }))} />
                ) : (
                  <DlgKnownValue dir="ltr" onEdit={() => startDlgEdit('email')}>{contactEmail}</DlgKnownValue>
                )}
              </FieldBox>
            </div>
            <p className="text-[12px] text-gray-500">
              אפשר גם להמשיך בלי הפרטים — הלקוח ישלים אותם בעמוד התשלום של אייקאונט.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// Rarely-needed technical timestamps — collapsed by default so they never take
// up workspace. Replaces the old always-open "תאריכים" + "מטא-דאטה" cards.
function SystemInfo({ deal }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-white border border-gray-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5"
      >
        <span className="text-[13px] font-semibold text-gray-700">מידע מערכת</span>
        <span className="text-gray-400 text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <dl className="px-4 pb-3 space-y-2 text-sm">
          <Row label="נוצר" value={fmtDate(deal.createdAt)} />
          <Row label="עודכן" value={fmtDate(deal.updatedAt)} />
          <Row label="צפי סגירה" value={fmtDate(deal.expectedCloseDate)} />
          {deal.wonAt && <Row label="נסגר בהצלחה" value={fmtDate(deal.wonAt)} />}
          {deal.lostAt && <Row label="תאריך LOST" value={fmtDate(deal.lostAt)} />}
        </dl>
      )}
    </section>
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
