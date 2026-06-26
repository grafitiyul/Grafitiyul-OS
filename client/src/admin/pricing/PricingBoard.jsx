import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import BackButton from '../common/BackButton.jsx';
import { SettingsCard } from '../crm/settings/catalogKit.jsx';
import { formatMinor, toMinor, minorToInput } from '../../lib/money.js';

// Business-facing Pricing editor (Slice B). The PRIMARY pricing experience:
//   version (PriceList) → tab (PricingSegment) → cards → model + numbers + preview.
// Raw Price Rules / priority / specificity / model enum names are NOT shown here;
// the advanced engine view stays at /settings/crm/pricing/advanced.
//
// A "card" is an authoring concept: a set of sibling PriceRules that share a
// `cardGroupId`, one per chosen location (ProductVariant), all carrying identical
// model + numbers + tiers and the tab's activity/subtype binding. The engine is
// untouched — it still resolves per rule.

const INPUT =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';
const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';

// Friendly model labels — the priceModel enum names are never shown.
const MODELS = [
  { value: 'tiered_group', name: 'מדרגות מחיר + משתתף נוסף' },
  { value: 'per_head', name: 'מחיר לאדם' },
  { value: 'fixed', name: 'מחיר קבוע' },
];
const modelName = (m) => MODELS.find((x) => x.value === m)?.name || m;

function newCardGroupId() {
  const rnd =
    (globalThis.crypto && globalThis.crypto.randomUUID && globalThis.crypto.randomUUID()) ||
    `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `card_${rnd}`;
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}
    </label>
  );
}

function Select({ value, onChange, options, className = '' }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${INPUT} ${className}`}>
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>{o.name}</option>
      ))}
    </select>
  );
}

function Money({ minor, onChange, placeholder }) {
  return (
    <input
      dir="ltr"
      inputMode="decimal"
      value={minorToInput(minor)}
      onChange={(e) => onChange(toMinor(e.target.value))}
      placeholder={placeholder || '0'}
      className={`${INPUT} text-left`}
    />
  );
}

function IntInput({ value, onChange, placeholder }) {
  return (
    <input
      dir="ltr"
      inputMode="numeric"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))}
      placeholder={placeholder || '0'}
      className={`${INPUT} text-left`}
    />
  );
}

// ─────────────────────────────── Root ──────────────────────────────────────

export default function PricingBoard() {
  const [lists, setLists] = useState([]);
  const [segments, setSegments] = useState([]);
  const [products, setProducts] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [orgSubtypes, setOrgSubtypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [versionId, setVersionId] = useState(null);
  const [segmentId, setSegmentId] = useState(null);

  const loadRef = useCallback(async () => {
    const [seg, p, at, os] = await Promise.all([
      api.pricingSegments.list(),
      api.products.list(),
      api.activityTypes.list(),
      api.organizationSubtypes.list(),
    ]);
    setSegments(seg);
    setProducts(p);
    setActivityTypes(at);
    setOrgSubtypes(os);
    if (!segmentId && seg.length) setSegmentId(seg[0].id);
  }, [segmentId]);

  const loadLists = useCallback(async () => {
    const l = await api.priceLists.list();
    setLists(l);
    setVersionId((cur) => {
      if (cur && l.some((x) => x.id === cur)) return cur;
      const active = l.filter((x) => x.active);
      const def = active.find((x) => x.isDefault) || active[0] || l[0];
      return def?.id || null;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    setError(null);
    try {
      await Promise.all([loadLists(), loadRef()]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [loadLists, loadRef]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  const version = lists.find((l) => l.id === versionId) || null;
  const segment = segments.find((s) => s.id === segmentId) || null;

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <BackButton to="/admin/settings/crm" label="חזרה להגדרות CRM" />
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 mt-1">תמחור</h1>
          <p className="text-[15px] text-gray-500 mt-1.5">
            בחרו גרסת תמחור, עברו בין הלשוניות, והוסיפו כרטיסי תמחור לכל מוצר ומיקום.
          </p>
        </div>
        <Link to="/admin/settings/crm/pricing/advanced"
          className="shrink-0 mt-1 text-[12px] text-gray-400 hover:text-gray-600 underline">
          מצב מתקדם
        </Link>
      </header>

      {error && <div className="text-sm text-red-600">שגיאה: {error}</div>}

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : (
        <>
          <VersionBar lists={lists} versionId={versionId} onSelect={setVersionId} onChanged={loadLists} />

          {version ? (
            <>
              <TabBar segments={segments} segmentId={segmentId} onSelect={setSegmentId} />
              {segment && (
                <SegmentPanel
                  key={`${version.id}:${segment.id}`}
                  version={version}
                  segment={segment}
                  products={products}
                  activityTypes={activityTypes}
                  orgSubtypes={orgSubtypes}
                  onSegmentChanged={loadRef}
                />
              )}
            </>
          ) : (
            <div className="text-sm text-gray-500">אין גרסאות תמחור פעילות. צרו גרסה חדשה למעלה.</div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────── Version selector ──────────────────────────────

function VersionBar({ lists, versionId, onSelect, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const active = lists.filter((l) => l.active);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await api.priceLists.create({ nameHe: name.trim() });
      setName(''); setAdding(false);
      await onChanged();
      if (created?.id) onSelect(created.id);
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  return (
    <SettingsCard
      title="גרסת תמחור"
      description="כל גרסה היא מחירון נפרד. אפשר שכמה גרסאות יהיו פעילות במקביל; בהמשך, בהצעות מחיר/דילים, תבחרו איזו גרסה פעילה להשתמש."
    >
      <div className="p-2 flex flex-wrap items-center gap-2">
        {active.length === 0 && <span className="text-[13px] text-gray-400">אין גרסאות פעילות.</span>}
        {active.map((l) => (
          <button key={l.id} onClick={() => onSelect(l.id)}
            className={`h-10 rounded-lg px-4 text-sm font-medium transition ${
              versionId === l.id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}>
            {l.nameHe}
            {l.isDefault && <span className="ms-2 text-[10px] opacity-80">ברירת מחדל</span>}
          </button>
        ))}
        {adding ? (
          <form onSubmit={create} className="flex items-center gap-1.5">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }}
              placeholder="שם גרסה" className={`${INPUT} w-40`} />
            <button type="submit" disabled={busy || !name.trim()}
              className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? '…' : 'צור'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} className="h-10 rounded-lg border border-dashed border-gray-300 px-4 text-sm text-gray-500 hover:bg-gray-50">+ גרסה חדשה</button>
        )}
      </div>
    </SettingsCard>
  );
}

// ─────────────────────────────── Tab bar ───────────────────────────────────

function TabBar({ segments, segmentId, onSelect }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-px">
      {segments.map((s) => (
        <button key={s.id} onClick={() => onSelect(s.id)}
          className={`h-10 rounded-t-lg px-4 text-sm font-medium transition ${
            segmentId === s.id
              ? 'bg-white text-blue-700 ring-1 ring-gray-200 ring-b-0 -mb-px'
              : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
          }`}>
          {s.nameHe}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────── Segment panel ───────────────────────────────

function SegmentPanel({ version, segment, products, activityTypes, orgSubtypes, onSegmentChanged }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productCache, setProductCache] = useState({}); // productId -> product (with variants)
  const [adding, setAdding] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);

  const bound = Boolean(segment.activityTypeId || segment.organizationSubtypeId);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.priceRules.list(version.id);
      setRules(all.filter((r) => r.pricingSegmentId === segment.id && r.cardGroupId));
    } finally {
      setLoading(false);
    }
  }, [version.id, segment.id]);
  useEffect(() => { refresh(); }, [refresh]);

  // Group sibling rules into cards by cardGroupId.
  const cards = useMemo(() => groupCards(rules), [rules]);

  // Prefetch product details (variants → location names) for products in cards.
  useEffect(() => {
    const ids = [...new Set(cards.map((c) => c.productId).filter(Boolean))];
    const missing = ids.filter((id) => !productCache[id]);
    if (!missing.length) return;
    let alive = true;
    Promise.all(missing.map((id) => api.products.get(id).catch(() => null))).then((loaded) => {
      if (!alive) return;
      setProductCache((prev) => {
        const next = { ...prev };
        loaded.forEach((p) => { if (p) next[p.id] = p; });
        return next;
      });
    });
    return () => { alive = false; };
  }, [cards, productCache]);

  if (!bound) {
    return (
      <BindingNotice
        segment={segment}
        activityTypes={activityTypes}
        orgSubtypes={orgSubtypes}
        onSaved={onSegmentChanged}
      />
    );
  }

  return (
    <div className="space-y-3">
      <BindingSummary segment={segment} activityTypes={activityTypes} orgSubtypes={orgSubtypes}
        onChange={onSegmentChanged} />

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">טוען כרטיסים…</div>
      ) : (
        <>
          {cards.length === 0 && !adding && (
            <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
              אין עדיין כרטיסי תמחור בלשונית הזו.
            </div>
          )}

          {cards.map((card) =>
            editingCardId === card.cardGroupId ? (
              <CardEditor key={card.cardGroupId} version={version} segment={segment}
                products={products} productCache={productCache} setProductCache={setProductCache}
                card={card} onClose={() => setEditingCardId(null)}
                onSaved={() => { setEditingCardId(null); refresh(); }} />
            ) : (
              <CardView key={card.cardGroupId} version={version} card={card}
                productCache={productCache}
                onEdit={() => setEditingCardId(card.cardGroupId)}
                onChanged={refresh} />
            ),
          )}

          {adding ? (
            <CardEditor version={version} segment={segment}
              products={products} productCache={productCache} setProductCache={setProductCache}
              onClose={() => setAdding(false)}
              onSaved={() => { setAdding(false); refresh(); }} />
          ) : (
            <button onClick={() => setAdding(true)}
              className="h-11 w-full rounded-xl border border-dashed border-blue-300 text-sm font-medium text-blue-600 hover:bg-blue-50">
              + כרטיס תמחור חדש
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Group flat sibling rules into card objects keyed by cardGroupId.
function groupCards(rules) {
  const byGroup = new Map();
  for (const r of rules) {
    if (!byGroup.has(r.cardGroupId)) byGroup.set(r.cardGroupId, []);
    byGroup.get(r.cardGroupId).push(r);
  }
  const cards = [];
  for (const [cardGroupId, siblings] of byGroup) {
    const rep = siblings[0];
    cards.push({
      cardGroupId,
      productId: rep.productId,
      priceModel: rep.priceModel,
      adultPriceMinor: rep.adultPriceMinor ?? null,
      childPriceMinor: rep.childPriceMinor ?? null,
      basePriceMinor: rep.basePriceMinor ?? null,
      baseParticipants: rep.baseParticipants ?? null,
      perAdditionalParticipantMinor: rep.perAdditionalParticipantMinor ?? null,
      fixedPriceMinor: rep.fixedPriceMinor ?? null,
      tiers: (rep.tiers || []).map((t) => ({
        uptoParticipants: Number(t.uptoParticipants),
        totalPriceMinor: Number(t.totalPriceMinor),
      })),
      variantIds: siblings.map((s) => s.productVariantId).filter(Boolean),
      rules: siblings.map((s) => ({ id: s.id, productVariantId: s.productVariantId })),
    });
  }
  return cards;
}

// ──────────────────────── Segment binding (config) ─────────────────────────

function BindingNotice({ segment, activityTypes, orgSubtypes, onSaved }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3">
      <div className="flex items-start gap-2">
        <span className="text-lg">⚠️</span>
        <div>
          <div className="font-semibold text-amber-900 text-[15px]">הלשונית "{segment.nameHe}" עדיין לא ממופה</div>
          <p className="text-[13px] text-amber-800 mt-1 leading-relaxed">
            כדי להוסיף כרטיסי תמחור, חברו את הלשונית לסוג פעילות ו/או לתת-סוג ארגון קיים.
            המיפוי קובע מתי התמחור של הלשונית הזו יחול. אין מיפוי קשיח — אתם בוחרים.
          </p>
        </div>
      </div>
      <BindingEditor segment={segment} activityTypes={activityTypes} orgSubtypes={orgSubtypes} onSaved={onSaved} />
    </div>
  );
}

function BindingSummary({ segment, activityTypes, orgSubtypes, onChange }) {
  const [open, setOpen] = useState(false);
  const at = activityTypes.find((a) => a.id === segment.activityTypeId);
  const os = orgSubtypes.find((s) => s.id === segment.organizationSubtypeId);
  const parts = [];
  if (at) parts.push(`סוג פעילות: ${at.nameHe}`);
  if (os) parts.push(`תת-סוג ארגון: ${os.label}`);
  return (
    <div className="rounded-lg bg-gray-50 ring-1 ring-gray-100 px-3 py-2 text-[12px] text-gray-600 flex items-center gap-2">
      <span className="text-gray-400">מיפוי:</span>
      <span className="flex-1">{parts.join(' · ') || 'ללא'}</span>
      <button onClick={() => setOpen((v) => !v)} className="text-blue-600 hover:underline">{open ? 'סגור' : 'שנה'}</button>
      {open && (
        <div className="basis-full w-full pt-2">
          <BindingEditor segment={segment} activityTypes={activityTypes} orgSubtypes={orgSubtypes}
            onSaved={() => { setOpen(false); onChange(); }} />
        </div>
      )}
    </div>
  );
}

function BindingEditor({ segment, activityTypes, orgSubtypes, onSaved }) {
  const [activityTypeId, setActivityTypeId] = useState(segment.activityTypeId || '');
  const [organizationSubtypeId, setOrganizationSubtypeId] = useState(segment.organizationSubtypeId || '');
  const [busy, setBusy] = useState(false);

  const atOpts = [{ value: '', name: '— ללא —' }, ...activityTypes.map((a) => ({ value: a.id, name: a.nameHe }))];
  const osOpts = [{ value: '', name: '— ללא —' }, ...orgSubtypes.map((s) => ({ value: s.id, name: s.label }))];

  async function save() {
    setBusy(true);
    try {
      await api.pricingSegments.update(segment.id, {
        activityTypeId: activityTypeId || null,
        organizationSubtypeId: organizationSubtypeId || null,
      });
      onSaved();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
      <Field label="סוג פעילות"><Select value={activityTypeId} onChange={setActivityTypeId} options={atOpts} /></Field>
      <Field label="תת-סוג ארגון"><Select value={organizationSubtypeId} onChange={setOrganizationSubtypeId} options={osOpts} /></Field>
      <button onClick={save} disabled={busy || (!activityTypeId && !organizationSubtypeId)}
        className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'שומר…' : 'שמור מיפוי'}
      </button>
    </div>
  );
}

// ──────────────────────────────── Card view ────────────────────────────────

function CardView({ version, card, productCache, onEdit, onChanged }) {
  const product = productCache[card.productId];
  const productName = product?.nameHe || '—';
  const variantNames = card.variantIds.map((vid) => {
    const v = product?.variants?.find((x) => x.id === vid);
    return v?.location?.nameHe || '—';
  });

  async function duplicate() {
    try {
      const cardGroupId = newCardGroupId();
      const base = {
        priceListId: version.id,
        pricingSegmentId: undefined, // keep same segment via existing rules' value
      };
      // Re-read one sibling to copy its segment/scope bindings exactly.
      const rules = await api.priceRules.list(version.id);
      const src = rules.find((r) => r.id === card.rules[0]?.id);
      if (!src) return;
      for (const vid of card.variantIds) {
        await api.priceRules.create({
          ...base,
          pricingSegmentId: src.pricingSegmentId,
          productId: src.productId,
          productVariantId: vid,
          activityTypeId: src.activityTypeId,
          organizationSubtypeId: src.organizationSubtypeId,
          cardGroupId,
          priceModel: card.priceModel,
          adultPriceMinor: card.adultPriceMinor,
          childPriceMinor: card.childPriceMinor,
          basePriceMinor: card.basePriceMinor,
          baseParticipants: card.baseParticipants,
          perAdditionalParticipantMinor: card.perAdditionalParticipantMinor,
          fixedPriceMinor: card.fixedPriceMinor,
          tiers: card.tiers,
          active: true,
        });
      }
      onChanged();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
  }

  async function remove() {
    if (!confirm('למחוק את כרטיס התמחור?')) return;
    try {
      for (const r of card.rules) await api.priceRules.remove(r.id);
      onChanged();
    } catch (e) { alert('שגיאה: ' + (e.payload?.error || e.message)); }
  }

  return (
    <div className="rounded-xl bg-white ring-1 ring-gray-200 shadow-sm p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-semibold text-gray-900">{productName}</div>
          <div className="text-[12px] text-gray-500 mt-0.5">
            {variantNames.length ? variantNames.join(' · ') : 'ללא מיקומים'}
          </div>
          <span className="inline-block mt-2 text-[11px] rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-0.5 ring-1 ring-indigo-100">
            {modelName(card.priceModel)}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} title="עריכה" className="text-amber-500 hover:bg-amber-50 rounded-md p-1.5">✎</button>
          <button onClick={duplicate} title="שכפול" className="text-gray-500 hover:bg-gray-100 rounded-md p-1.5">⧉</button>
          <button onClick={remove} title="מחיקה" className="text-red-500 hover:bg-red-50 rounded-md p-1.5">🗑</button>
        </div>
      </div>

      <CardNumbers card={card} />
      <CardPreview version={version} card={card} />
    </div>
  );
}

// Read-only summary of the card's numbers (human, not enum/scope).
function CardNumbers({ card }) {
  if (card.priceModel === 'fixed') {
    return <div className="text-[13px] text-gray-700">מחיר קבוע כולל: <b>{formatMinor(card.fixedPriceMinor)}</b></div>;
  }
  if (card.priceModel === 'per_head') {
    return <div className="text-[13px] text-gray-700">מחיר למשתתף: <b>{formatMinor(card.adultPriceMinor)}</b></div>;
  }
  // tiered_group
  const sorted = [...card.tiers].sort((a, b) => a.uptoParticipants - b.uptoParticipants);
  return (
    <div className="text-[13px] text-gray-700 space-y-0.5">
      {sorted.map((t, i) => (
        <div key={i}>עד {t.uptoParticipants} משתתפים = <b>{formatMinor(t.totalPriceMinor)}</b></div>
      ))}
      {sorted.length > 0 && card.perAdditionalParticipantMinor != null && (
        <div>כל משתתף נוסף מעל {sorted[sorted.length - 1].uptoParticipants} = <b>{formatMinor(card.perAdditionalParticipantMinor)}</b></div>
      )}
    </div>
  );
}

// ─────────────────────────── Per-card preview ──────────────────────────────

function CardPreview({ version, card }) {
  const [count, setCount] = useState(10);
  const [groupCount, setGroupCount] = useState(1);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.pricing.preview({
        priceModel: card.priceModel,
        adultPriceMinor: card.adultPriceMinor,
        childPriceMinor: card.childPriceMinor,
        basePriceMinor: card.basePriceMinor,
        baseParticipants: card.baseParticipants,
        perAdditionalParticipantMinor: card.perAdditionalParticipantMinor,
        fixedPriceMinor: card.fixedPriceMinor,
        tiers: card.tiers,
        vatMode: version.defaultVatMode,
        vatRate: version.defaultVatRate,
        participantCount: Number(count) || 0,
        adultCount: Number(count) || 0, // per_head treats participants as one price
        childCount: 0,
        groupCount: Number(groupCount) || 1,
      });
      setRes(r);
    } catch (e) { setRes({ ok: false, error: e.message }); }
    finally { setBusy(false); }
  }, [card, version, count, groupCount]);

  // Auto-run on mount + when inputs change (debounced lightly via effect).
  useEffect(() => { run(); }, [run]);

  const cur = version.currency;
  return (
    <div className="rounded-lg bg-gray-50 ring-1 ring-gray-100 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[12px] text-gray-500">תצוגה מקדימה:</span>
        <label className="flex items-center gap-1 text-[12px] text-gray-600">
          משתתפים
          <input dir="ltr" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
            className="h-8 w-16 rounded border border-gray-300 px-2 text-center text-sm" />
        </label>
        <label className="flex items-center gap-1 text-[12px] text-gray-600">
          קבוצות
          <input dir="ltr" value={groupCount} onChange={(e) => setGroupCount(e.target.value.replace(/\D/g, ''))}
            className="h-8 w-14 rounded border border-gray-300 px-2 text-center text-sm" />
        </label>
        {busy && <span className="text-[11px] text-gray-400">מחשב…</span>}
      </div>

      {res && res.ok ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <PreviewStat label="נטו" value={formatMinor(res.netMinor, cur)} />
          <PreviewStat label='מע״מ' value={formatMinor(res.vatMinor, cur)} />
          <PreviewStat label="סה״כ" value={formatMinor(res.grossMinor, cur)} strong />
        </div>
      ) : res ? (
        <div className="text-[12px] text-red-600">{previewError(res.error)}</div>
      ) : null}
      <div className="text-[11px] text-gray-400 mt-1.5">
        {version.defaultVatMode === 'included' ? 'מחירים כוללים מע״מ' : 'מחירים ללא מע״מ'} · {version.defaultVatRate}%
      </div>
    </div>
  );
}

function PreviewStat({ label, value, strong }) {
  return (
    <div className="rounded-md bg-white p-2 shadow-sm">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`mt-0.5 ${strong ? 'text-[15px] font-bold text-gray-900' : 'text-[13px] text-gray-800'}`}>{value}</div>
    </div>
  );
}

function previewError(code) {
  return {
    rule_incomplete: 'חסרים שדות מחיר — מלאו את הערכים כדי לראות תצוגה מקדימה.',
    unknown_price_model: 'מודל תמחור לא מוכר.',
  }[code] || ('שגיאה: ' + code);
}

// ────────────────────────────── Card editor ────────────────────────────────

function CardEditor({ version, segment, products, productCache, setProductCache, card, onClose, onSaved }) {
  const [productId, setProductId] = useState(card?.productId || '');
  const [variantIds, setVariantIds] = useState(card?.variantIds || []);
  const [priceModel, setPriceModel] = useState(card?.priceModel || 'tiered_group');
  const [adultPriceMinor, setAdult] = useState(card?.adultPriceMinor ?? null);
  const [fixedPriceMinor, setFixed] = useState(card?.fixedPriceMinor ?? null);
  const [perAdd, setPerAdd] = useState(card?.perAdditionalParticipantMinor ?? null);
  const [tiers, setTiers] = useState(
    card?.tiers?.length ? card.tiers.map((t) => ({ ...t })) : [{ uptoParticipants: null, totalPriceMinor: null }],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const product = productCache[productId];

  // Load the chosen product's variants (locations) if not cached.
  useEffect(() => {
    if (!productId || productCache[productId]) return;
    let alive = true;
    api.products.get(productId).then((p) => {
      if (alive && p) setProductCache((prev) => ({ ...prev, [p.id]: p }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [productId, productCache, setProductCache]);

  const variants = product?.variants || [];

  function toggleVariant(id) {
    setVariantIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function setTier(i, key, val) {
    setTiers((cur) => cur.map((t, idx) => (idx === i ? { ...t, [key]: val } : t)));
  }
  function addTier() { setTiers((cur) => [...cur, { uptoParticipants: null, totalPriceMinor: null }]); }
  function removeTier(i) { setTiers((cur) => cur.filter((_, idx) => idx !== i)); }

  function validate() {
    if (!productId) return 'בחרו מוצר.';
    if (variantIds.length === 0) return 'בחרו לפחות מיקום אחד.';
    if (priceModel === 'fixed' && fixedPriceMinor == null) return 'מלאו מחיר קבוע.';
    if (priceModel === 'per_head' && adultPriceMinor == null) return 'מלאו מחיר למשתתף.';
    if (priceModel === 'tiered_group') {
      const valid = tiers.filter((t) => t.uptoParticipants != null && t.totalPriceMinor != null);
      if (valid.length === 0) return 'הוסיפו לפחות מדרגת מחיר אחת.';
    }
    return null;
  }

  // The fields the engine reads for this model (others nulled so stale values
  // from a model switch never leak into resolution).
  function modelPayload() {
    if (priceModel === 'fixed') {
      return { fixedPriceMinor, adultPriceMinor: null, childPriceMinor: null, basePriceMinor: null, baseParticipants: null, perAdditionalParticipantMinor: null, tiers: [] };
    }
    if (priceModel === 'per_head') {
      return { adultPriceMinor, childPriceMinor: adultPriceMinor, fixedPriceMinor: null, basePriceMinor: null, baseParticipants: null, perAdditionalParticipantMinor: null, tiers: [] };
    }
    // tiered_group
    const cleanTiers = tiers
      .filter((t) => t.uptoParticipants != null && t.totalPriceMinor != null)
      .sort((a, b) => a.uptoParticipants - b.uptoParticipants)
      .map((t, i) => ({ uptoParticipants: t.uptoParticipants, totalPriceMinor: t.totalPriceMinor, sortOrder: i }));
    return { perAdditionalParticipantMinor: perAdd, tiers: cleanTiers, adultPriceMinor: null, childPriceMinor: null, fixedPriceMinor: null, basePriceMinor: null, baseParticipants: null };
  }

  async function save() {
    const v = validate();
    if (v) { setErr(v); return; }
    setErr(null); setBusy(true);
    try {
      const mp = modelPayload();
      const common = {
        priceListId: version.id,
        pricingSegmentId: segment.id,
        productId,
        activityTypeId: segment.activityTypeId || null,
        organizationSubtypeId: segment.organizationSubtypeId || null,
        priceModel,
        vatMode: null, vatRate: null, // inherit the version's VAT
        active: true,
        ...mp,
      };

      if (card) {
        // Edit: diff sibling rules by variant — update kept, create added, remove dropped.
        const cardGroupId = card.cardGroupId;
        const existingByVariant = new Map(card.rules.map((r) => [r.productVariantId, r.id]));
        for (const vid of variantIds) {
          if (existingByVariant.has(vid)) {
            await api.priceRules.update(existingByVariant.get(vid), { ...common, cardGroupId, productVariantId: vid });
          } else {
            await api.priceRules.create({ ...common, cardGroupId, productVariantId: vid });
          }
        }
        for (const r of card.rules) {
          if (!variantIds.includes(r.productVariantId)) await api.priceRules.remove(r.id);
        }
      } else {
        // Create: one rule per selected location, sharing a fresh cardGroupId.
        const cardGroupId = newCardGroupId();
        for (const vid of variantIds) {
          await api.priceRules.create({ ...common, cardGroupId, productVariantId: vid });
        }
      }
      onSaved();
    } catch (e) { setErr(e.payload?.error || e.message); }
    finally { setBusy(false); }
  }

  const productOpts = [{ value: '', name: '— בחרו מוצר —' }, ...products.map((p) => ({ value: p.id, name: p.nameHe }))];

  return (
    <div className="rounded-xl bg-blue-50/40 ring-1 ring-blue-100 p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="מוצר">
          <Select value={productId} onChange={(v) => { setProductId(v); setVariantIds([]); }} options={productOpts} />
        </Field>
        <Field label="מודל תמחור">
          <Select value={priceModel} onChange={setPriceModel} options={MODELS} />
        </Field>
      </div>

      {productId && (
        <Field label="מיקומים (בחרו אחד או יותר)">
          {variants.length === 0 ? (
            <div className="text-[12px] text-gray-400">למוצר הזה אין עדיין וריאציות/מיקומים. הוסיפו אותם במסך המוצרים.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {variants.map((vrt) => (
                <button type="button" key={vrt.id} onClick={() => toggleVariant(vrt.id)}
                  className={`h-9 rounded-lg px-3 text-[13px] transition ring-1 ${
                    variantIds.includes(vrt.id)
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                  }`}>
                  {vrt.location?.nameHe || vrt.id}
                </button>
              ))}
            </div>
          )}
        </Field>
      )}

      {/* Model-specific pricing fields */}
      {priceModel === 'fixed' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="מחיר קבוע כולל"><Money minor={fixedPriceMinor} onChange={setFixed} /></Field>
        </div>
      )}
      {priceModel === 'per_head' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="מחיר למשתתף"><Money minor={adultPriceMinor} onChange={setAdult} /></Field>
        </div>
      )}
      {priceModel === 'tiered_group' && (
        <div className="space-y-2">
          <span className={LABEL}>מדרגות מחיר (מחיר כולל לקבוצה, לא לאדם)</span>
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[13px] text-gray-500 shrink-0">עד</span>
              <input dir="ltr" inputMode="numeric" value={t.uptoParticipants ?? ''}
                onChange={(e) => setTier(i, 'uptoParticipants', e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                placeholder="משתתפים" className={`${INPUT} w-28 text-left`} />
              <span className="text-[13px] text-gray-500 shrink-0">משתתפים =</span>
              <div className="flex-1"><Money minor={t.totalPriceMinor} onChange={(v) => setTier(i, 'totalPriceMinor', v)} placeholder="מחיר קבוצה" /></div>
              <button type="button" onClick={() => removeTier(i)} className="text-red-500 hover:bg-red-50 rounded-md p-1.5 shrink-0" title="הסר מדרגה">✕</button>
            </div>
          ))}
          <button type="button" onClick={addTier} className="text-[13px] text-blue-600 hover:underline">+ הוסף מדרגה</button>
          <Field label="כל משתתף נוסף מעל המדרגה האחרונה">
            <div className="max-w-[12rem]"><Money minor={perAdd} onChange={setPerAdd} /></div>
          </Field>
        </div>
      )}

      {err && <div className="text-[13px] text-red-600">{typeof err === 'string' ? err : 'שגיאה'}</div>}

      <div className="flex gap-1.5">
        <button onClick={save} disabled={busy}
          className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'שומר…' : 'שמור כרטיס'}
        </button>
        <button onClick={onClose} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50">ביטול</button>
      </div>
    </div>
  );
}
