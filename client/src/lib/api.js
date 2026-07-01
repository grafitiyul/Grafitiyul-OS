async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    const err = new Error(`${res.status} ${text}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

function qs(obj) {
  if (!obj) return '';
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
    );
  return parts.length ? `?${parts.join('&')}` : '';
}

export const api = {
  contentItems: {
    list: () => request('/api/items/content'),
    get: (id) => request(`/api/items/content/${id}`),
    usage: (id) => request(`/api/items/content/${id}/usage`),
    create: (data) => request('/api/items/content', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      request(`/api/items/content/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/items/content/${id}`, { method: 'DELETE' }),
    reorder: (ids, folderId) =>
      request('/api/items/content/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids, folderId: folderId ?? null }),
      }),
    move: (id, folderId) =>
      request(`/api/items/content/${id}/move`, {
        method: 'PUT',
        body: JSON.stringify({ folderId: folderId ?? null }),
      }),
  },
  questionItems: {
    list: () => request('/api/items/questions'),
    get: (id) => request(`/api/items/questions/${id}`),
    usage: (id) => request(`/api/items/questions/${id}/usage`),
    create: (data) => request('/api/items/questions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      request(`/api/items/questions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/items/questions/${id}`, { method: 'DELETE' }),
    reorder: (ids, folderId) =>
      request('/api/items/questions/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids, folderId: folderId ?? null }),
      }),
    move: (id, folderId) =>
      request(`/api/items/questions/${id}/move`, {
        method: 'PUT',
        body: JSON.stringify({ folderId: folderId ?? null }),
      }),
  },
  bankItems: {
    // Unified cross-kind reorder. `ordered` = [{ kind, id }, ...] in the
    // desired order; mixed content + question is supported.
    reorder: (ordered, folderId) =>
      request('/api/items/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ordered, folderId: folderId ?? null }),
      }),
  },
  folders: {
    list: () => request('/api/items/folders'),
    // Recursive contents tree — used by the FlowEditor's read-only
    // preview of a folderRef block.
    contents: (id) => request(`/api/items/folders/${id}/contents`),
    create: (name, parentId = null) =>
      request('/api/items/folders', {
        method: 'POST',
        body: JSON.stringify({ name, parentId: parentId || null }),
      }),
    // update accepts { name?, parentId? } — passing parentId moves the
    // folder under a new parent (pass null for root) and appends at the
    // end of the target parent's children.
    update: (id, data) =>
      request(`/api/items/folders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) => request(`/api/items/folders/${id}`, { method: 'DELETE' }),
    reorder: (ids, parentId = null) =>
      request('/api/items/folders/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids, parentId: parentId || null }),
      }),
  },
  flows: {
    list: () => request('/api/flows'),
    get: (id) => request(`/api/flows/${id}`),
    // Live-resolved expansion for preview-mode (no attempt). Returns
    // { steps: [...] } already hydrated with content/question items.
    expansion: (id) => request(`/api/flows/${id}/expansion`),
    create: (data) => request('/api/flows', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/flows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/flows/${id}`, { method: 'DELETE' }),
    saveNodes: (id, nodes) =>
      request(`/api/flows/${id}/nodes`, {
        method: 'PUT',
        body: JSON.stringify({ nodes }),
      }),
    reorder: (ids) =>
      request('/api/flows/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      }),
    getAssignment: (id) => request(`/api/flows/${id}/assignment`),
    saveAssignment: (id, data) =>
      request(`/api/flows/${id}/assignment`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    // Admin-only: applies new flow items to every in_progress
    // attempt's expansion via additive merge. Existing steps are
    // never moved or removed; only additions slot in.
    syncAttempts: (id) =>
      request(`/api/flows/${id}/sync-attempts`, { method: 'POST' }),
  },
  teams: {
    list: () => request('/api/teams'),
    create: (data) =>
      request('/api/teams', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      request(`/api/teams/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/teams/${id}`, { method: 'DELETE' }),
  },
  recruitment: {
    snapshot: () => request('/api/recruitment'),
    people: () => request('/api/recruitment/people'),
  },
  people: {
    // Returns { people, upstream }. Sync-on-read: the server refreshes from
    // recruitment before responding. `upstream.ok=false` means the refresh
    // failed and the `people` array is the last-known local state — UI
    // should surface that.
    list: () => request('/api/people'),
    get: (id) => request(`/api/people/${id}`),
    // Retained for admin troubleshooting; the main list already syncs on
    // every read, so there's no user-facing import flow anymore.
    forceRefresh: () =>
      request('/api/people/import', { method: 'POST' }),
    update: (id, data) =>
      request(`/api/people/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateProfile: (id, data) =>
      request(`/api/people/${id}/profile`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) => request(`/api/people/${id}`, { method: 'DELETE' }),
    rotateToken: (id) =>
      request(`/api/people/${id}/portal/rotate`, { method: 'POST' }),
    setPortalEnabled: (id, enabled) =>
      request(`/api/people/${id}/portal/enabled`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      }),
    // Same semantics as setPortalEnabled but routed through the
    // domain-oriented /access endpoint. Used by the unified
    // "אנשים וגישה" admin surface.
    setAccess: (id, enabled) =>
      request(`/api/people/${id}/access`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      }),
    uploadImage: async (id, file) => {
      const q = qs({ filename: file.name });
      const res = await fetch(`/api/people/${id}/image${q}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`${res.status} ${text}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    procedures: (id) => request(`/api/people/${id}/procedures`),
  },
  attempts: {
    create: (flowId, learnerName, workerIdentifier) =>
      request('/api/attempts', {
        method: 'POST',
        body: JSON.stringify({ flowId, learnerName, workerIdentifier }),
      }),
    get: (id) => request(`/api/attempts/${id}`),
    answer: (id, payload) =>
      request(`/api/attempts/${id}/answer`, { method: 'POST', body: JSON.stringify(payload) }),
    advance: (id) => request(`/api/attempts/${id}/advance`, { method: 'POST' }),
    back: (id) => request(`/api/attempts/${id}/back`, { method: 'POST' }),
    submit: (id) => request(`/api/attempts/${id}/submit`, { method: 'POST' }),
    outstanding: (id) => request(`/api/attempts/${id}/outstanding`),
    listForFlow: (flowId) => request(`/api/attempts/flow/${flowId}`),
    // Admin reset — hard-deletes the attempt + all its FlowAnswer rows
    // (schema cascade). The guide can then re-take the flow as if they
    // never started it.
    remove: (id) => request(`/api/attempts/${id}`, { method: 'DELETE' }),
  },
  adminUsers: {
    list: () => request('/api/admin-users'),
    create: (data) =>
      request('/api/admin-users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    changePassword: (id, data) =>
      request(`/api/admin-users/${id}/password`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    setActive: (id, isActive) =>
      request(`/api/admin-users/${id}/active`, {
        method: 'PUT',
        body: JSON.stringify({ isActive }),
      }),
  },
  // ── CRM foundation (Phase 1) — reference data only ───────────────
  organizations: {
    list: () => request('/api/organizations'),
    get: (id) => request(`/api/organizations/${id}`),
    create: (data) =>
      request('/api/organizations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id, data) =>
      request(`/api/organizations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) => request(`/api/organizations/${id}`, { method: 'DELETE' }),
    addUnit: (id, data) =>
      request(`/api/organizations/${id}/units`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateUnit: (unitId, data) =>
      request(`/api/organizations/units/${unitId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    removeUnit: (unitId) =>
      request(`/api/organizations/units/${unitId}`, { method: 'DELETE' }),
  },
  organizationTypes: {
    list: () => request('/api/organization-types'),
    reorder: (ids) =>
      request('/api/organization-types/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      }),
    create: (data) =>
      request('/api/organization-types', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id, data) =>
      request(`/api/organization-types/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) =>
      request(`/api/organization-types/${id}`, { method: 'DELETE' }),
  },
  organizationSubtypes: {
    list: (organizationTypeId) =>
      request(`/api/organization-subtypes${qs({ organizationTypeId })}`),
    reorder: (ids) =>
      request('/api/organization-subtypes/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      }),
    create: (data) =>
      request('/api/organization-subtypes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id, data) =>
      request(`/api/organization-subtypes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) =>
      request(`/api/organization-subtypes/${id}`, { method: 'DELETE' }),
  },
  contacts: {
    list: () => request('/api/contacts'),
    get: (id) => request(`/api/contacts/${id}`),
    create: (data) =>
      request('/api/contacts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      request(`/api/contacts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) => request(`/api/contacts/${id}`, { method: 'DELETE' }),
    addPhone: (id, data) =>
      request(`/api/contacts/${id}/phones`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updatePhone: (phoneId, data) =>
      request(`/api/contacts/phones/${phoneId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    removePhone: (phoneId) =>
      request(`/api/contacts/phones/${phoneId}`, { method: 'DELETE' }),
    reorderPhones: (id, ids) =>
      request(`/api/contacts/${id}/phones/reorder`, { method: 'PUT', body: JSON.stringify({ ids }) }),
    addEmail: (id, data) =>
      request(`/api/contacts/${id}/emails`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateEmail: (emailId, data) =>
      request(`/api/contacts/emails/${emailId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    removeEmail: (emailId) =>
      request(`/api/contacts/emails/${emailId}`, { method: 'DELETE' }),
    reorderEmails: (id, ids) =>
      request(`/api/contacts/${id}/emails/reorder`, { method: 'PUT', body: JSON.stringify({ ids }) }),
    addOrganization: (id, data) =>
      request(`/api/contacts/${id}/organizations`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateOrganization: (linkId, data) =>
      request(`/api/contacts/organizations/${linkId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    removeOrganization: (linkId) =>
      request(`/api/contacts/organizations/${linkId}`, { method: 'DELETE' }),
  },
  // ── Deal module (commercial core) ───────────────────────────────
  dealStages: {
    list: () => request('/api/deal-stages'),
    reorder: (ids) =>
      request('/api/deal-stages/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      }),
    create: (data) =>
      request('/api/deal-stages', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id, data) =>
      request(`/api/deal-stages/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) => request(`/api/deal-stages/${id}`, { method: 'DELETE' }),
  },
  deals: {
    list: (filters) => request(`/api/deals${qs(filters)}`),
    get: (id) => request(`/api/deals/${id}`),
    create: (data) =>
      request('/api/deals', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      request(`/api/deals/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) => request(`/api/deals/${id}`, { method: 'DELETE' }),
    addContact: (id, data) =>
      request(`/api/deals/${id}/contacts`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateContact: (linkId, data) =>
      request(`/api/deals/contacts/${linkId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    removeContact: (linkId) =>
      request(`/api/deals/contacts/${linkId}`, { method: 'DELETE' }),
    // Price Builder lines — canonical QuoteVersion/QuoteLine storage (one working
    // version per deal). get ensures the version exists and returns its lines.
    getPriceLines: (id) => request(`/api/deals/${id}/price-lines`),
    savePriceLines: (id, data) =>
      request(`/api/deals/${id}/price-lines`, { method: 'PUT', body: JSON.stringify(data) }),
    // Quote Module — ensure + return the draft QuoteDocument for this deal.
    quoteDocument: (id) => request(`/api/deals/${id}/quote-document`),
  },
  // ── Quote Module (quote documents + composer preview) ───────────
  quoteDocuments: {
    get: (id) => request(`/api/quote-documents/${id}`),
    update: (id, data) =>
      request(`/api/quote-documents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    composePreview: (id) => request(`/api/quote-documents/${id}/compose-preview`),
    resetToSource: (id) =>
      request(`/api/quote-documents/${id}/reset-to-source`, { method: 'POST' }),
  },
  // ── Products & Pricing — Slice 1 (catalog + files + payment config) ──
  mediaFiles: {
    presign: (data) =>
      request('/api/media-files/presign', { method: 'POST', body: JSON.stringify(data) }),
    create: (data) =>
      request('/api/media-files', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/media-files/${id}`, { method: 'DELETE' }),
  },
  locations: {
    list: () => request('/api/locations'),
    reorder: (ids) => request('/api/locations/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
    create: (data) => request('/api/locations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/locations/${id}`, { method: 'DELETE' }),
  },
  activityTypes: {
    list: () => request('/api/activity-types'),
  },
  products: {
    list: () => request('/api/products'),
    get: (id) => request(`/api/products/${id}`),
    create: (data) => request('/api/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    // Deletion preflight: relation counts + { blockers, canHardDelete, cascades }.
    relations: (id) => request(`/api/products/${id}/relations`),
    remove: (id) => request(`/api/products/${id}`, { method: 'DELETE' }),
    addVariant: (id, data) => request(`/api/products/${id}/variants`, { method: 'POST', body: JSON.stringify(data) }),
    updateVariant: (variantId, data) => request(`/api/products/variants/${variantId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeVariant: (variantId) => request(`/api/products/variants/${variantId}`, { method: 'DELETE' }),
    addVariantImage: (variantId, mediaFileId) =>
      request(`/api/products/variants/${variantId}/images`, { method: 'POST', body: JSON.stringify({ mediaFileId }) }),
    removeVariantImage: (imageId) => request(`/api/products/variants/images/${imageId}`, { method: 'DELETE' }),
  },
  payment: {
    listTerms: () => request('/api/payment-config/terms'),
    createTerm: (data) => request('/api/payment-config/terms', { method: 'POST', body: JSON.stringify(data) }),
    updateTerm: (id, data) => request(`/api/payment-config/terms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeTerm: (id) => request(`/api/payment-config/terms/${id}`, { method: 'DELETE' }),
    listMethods: () => request('/api/payment-config/methods'),
    createMethod: (data) => request('/api/payment-config/methods', { method: 'POST', body: JSON.stringify(data) }),
    updateMethod: (id, data) => request(`/api/payment-config/methods/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeMethod: (id) => request(`/api/payment-config/methods/${id}`, { method: 'DELETE' }),
  },
  // ── Products & Pricing — Slice 2 (pricing engine + add-ons) ──
  priceLists: {
    list: () => request('/api/price-lists'),
    create: (data) => request('/api/price-lists', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/price-lists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/price-lists/${id}`, { method: 'DELETE' }),
    reorder: (ids) => request('/api/price-lists/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
    setDefault: (id) => request(`/api/price-lists/${id}/default`, { method: 'PUT' }),
  },
  priceRules: {
    list: (priceListId) => request(`/api/price-rules${qs({ priceListId })}`),
    create: (data) => request('/api/price-rules', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/price-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/price-rules/${id}`, { method: 'DELETE' }),
    // Reorder cards within a tab: cardGroupIds in display order.
    cardOrder: (cardGroupIds) => request('/api/price-rules/card-order', { method: 'PUT', body: JSON.stringify({ cardGroupIds }) }),
  },
  addons: {
    list: () => request('/api/addons'),
    create: (data) => request('/api/addons', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/addons/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/addons/${id}`, { method: 'DELETE' }),
    reorder: (ids) => request('/api/addons/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },
  addonPriceRules: {
    list: (addonId) => request(`/api/addon-price-rules${qs({ addonId })}`),
    create: (data) => request('/api/addon-price-rules', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/addon-price-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/addon-price-rules/${id}`, { method: 'DELETE' }),
  },
  pricing: {
    calculate: (input) => request('/api/pricing/calculate', { method: 'POST', body: JSON.stringify(input) }),
    preview: (input) => request('/api/pricing/preview', { method: 'POST', body: JSON.stringify(input) }),
    // Multi-line Price Builder calc (product line via the engine + per-line VAT
    // splits + totals + explanation/conflict). All math server-side.
    builder: (input) => request('/api/pricing/builder', { method: 'POST', body: JSON.stringify(input) }),
    // Group Ticket Builder — the Pricing Cards opted into Group Ticket Sales. The
    // flag is the SOLE authority; no product/city/activity filtering, server-side.
    groupCards: () => request('/api/pricing/group-cards'),
  },
  // Pricing Segments (Slice A) — the 6 business tabs + owner-set bindings.
  pricingSegments: {
    list: () => request('/api/pricing-segments'),
    update: (id, data) => request(`/api/pricing-segments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  // שעות שבת וחג — Sabbath & Holiday hours (source of truth for time detection).
  sabbathHours: {
    listWeekly: () => request('/api/sabbath-hours/weekly'),
    createWeekly: (data) => request('/api/sabbath-hours/weekly', { method: 'POST', body: JSON.stringify(data) }),
    updateWeekly: (id, data) => request(`/api/sabbath-hours/weekly/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeWeekly: (id) => request(`/api/sabbath-hours/weekly/${id}`, { method: 'DELETE' }),
    reorderWeekly: (ids) => request('/api/sabbath-hours/weekly/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
    listHolidays: (status) => request(`/api/sabbath-hours/holidays${qs({ status })}`),
    createHoliday: (data) => request('/api/sabbath-hours/holidays', { method: 'POST', body: JSON.stringify(data) }),
    updateHoliday: (id, data) => request(`/api/sabbath-hours/holidays/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    reviewHoliday: (id, action) => request(`/api/sabbath-hours/holidays/${id}/review`, { method: 'POST', body: JSON.stringify({ action }) }),
    removeHoliday: (id) => request(`/api/sabbath-hours/holidays/${id}`, { method: 'DELETE' }),
    importHolidays: (months) => request('/api/sabbath-hours/holidays/import', { method: 'POST', body: JSON.stringify({ months }) }),
    // Calendar Markers (operational; NOT pricing).
    listMarkerTypes: () => request('/api/sabbath-hours/marker-types'),
    createMarkerType: (data) => request('/api/sabbath-hours/marker-types', { method: 'POST', body: JSON.stringify(data) }),
    updateMarkerType: (id, data) => request(`/api/sabbath-hours/marker-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeMarkerType: (id) => request(`/api/sabbath-hours/marker-types/${id}`, { method: 'DELETE' }),
    listMarkers: (markerTypeId) => request(`/api/sabbath-hours/markers${qs({ markerTypeId })}`),
    createMarker: (data) => request('/api/sabbath-hours/markers', { method: 'POST', body: JSON.stringify(data) }),
    updateMarker: (id, data) => request(`/api/sabbath-hours/markers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeMarker: (id) => request(`/api/sabbath-hours/markers/${id}`, { method: 'DELETE' }),
  },
  // Ticket Types — editable catalog for the ticket_types pricing model.
  ticketTypes: {
    list: () => request('/api/ticket-types'),
    create: (data) => request('/api/ticket-types', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/ticket-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/ticket-types/${id}`, { method: 'DELETE' }),
    reorder: (ids) => request('/api/ticket-types/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },
  // ── CRM Settings — Lost Reasons & Quote Content Sections (catalog only) ──
  lostReasons: {
    list: () => request('/api/lost-reasons'),
    create: (data) => request('/api/lost-reasons', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/lost-reasons/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/lost-reasons/${id}`, { method: 'DELETE' }),
    reorder: (ids) => request('/api/lost-reasons/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },
  // ── Timeline / Activity-Feed (reusable; scoped by subjectType + subjectId) ──
  timeline: {
    list: (subjectType, subjectId) => request(`/api/timeline${qs({ subjectType, subjectId })}`),
    // Read-only aggregated feed for Contact / Organization pages: the subject's
    // own items + related deal/contact items, each tagged with sourceType/Label.
    aggregate: (subjectType, subjectId) => request(`/api/timeline/aggregate${qs({ subjectType, subjectId })}`),
    create: (data) => request('/api/timeline', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/timeline/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/timeline/${id}`, { method: 'DELETE' }),
    pin: (id, pinned) => request(`/api/timeline/${id}/pin`, { method: 'POST', body: JSON.stringify({ pinned }) }),
    reorderPins: (subjectType, subjectId, ids) =>
      request('/api/timeline/pins/reorder', { method: 'PUT', body: JSON.stringify({ subjectType, subjectId, ids }) }),
    addComment: (id, body) => request(`/api/timeline/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
    updateComment: (commentId, body) =>
      request(`/api/timeline/comments/${commentId}`, { method: 'PUT', body: JSON.stringify({ body }) }),
    removeComment: (commentId) => request(`/api/timeline/comments/${commentId}`, { method: 'DELETE' }),
  },
  dealSources: {
    list: () => request('/api/deal-sources'),
    create: (data) => request('/api/deal-sources', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/deal-sources/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/deal-sources/${id}`, { method: 'DELETE' }),
    reorder: (ids) => request('/api/deal-sources/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },
  quoteSections: {
    list: () => request('/api/quote-sections'),
    create: (data) => request('/api/quote-sections', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/quote-sections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/quote-sections/${id}`, { method: 'DELETE' }),
    reorder: (ids) => request('/api/quote-sections/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },
  // Global default quote layout (CRM → Quote Layout & Sections). Single record.
  quoteTemplate: {
    get: () => request('/api/quote-template'),
    update: (layout) => request('/api/quote-template', { method: 'PUT', body: JSON.stringify(layout) }),
  },
  reviews: {
    list: (filters) => request(`/api/reviews/attempts${qs(filters)}`),
    get: (id) => request(`/api/reviews/attempts/${id}`),
    approveQuestion: (id, flowNodeId) =>
      request(`/api/reviews/attempts/${id}/questions/${flowNodeId}/approve`, {
        method: 'POST',
      }),
    rejectQuestion: (id, flowNodeId, comment) =>
      request(`/api/reviews/attempts/${id}/questions/${flowNodeId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ comment }),
      }),
  },
  businessFields: {
    list: () => request('/api/business-fields'),
    create: (data) =>
      request('/api/business-fields', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id, data) =>
      request(`/api/business-fields/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) =>
      request(`/api/business-fields/${id}`, { method: 'DELETE' }),
  },
  signers: {
    list: () => request('/api/signers'),
    get: (id) => request(`/api/signers/${id}`),
    create: (data) =>
      request('/api/signers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      request(`/api/signers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) => request(`/api/signers/${id}`, { method: 'DELETE' }),
    listAssets: (id) => request(`/api/signers/${id}/assets`),
    assetPngUrl: (personId, assetId) =>
      `/api/signers/${personId}/assets/${assetId}/png`,
    createDrawAsset: (personId, dataUrl, label) =>
      request(`/api/signers/${personId}/assets/draw`, {
        method: 'POST',
        body: JSON.stringify({ dataUrl, label }),
      }),
    createStampAsset: (personId, dataUrl, stampConfig, label) =>
      request(`/api/signers/${personId}/assets/stamp`, {
        method: 'POST',
        body: JSON.stringify({ dataUrl, stampConfig, label }),
      }),
    createCombinedAsset: (personId, dataUrl, layout, label) =>
      request(`/api/signers/${personId}/assets/combined`, {
        method: 'POST',
        body: JSON.stringify({ dataUrl, layout, label }),
      }),
    updateAsset: (personId, assetId, patch) =>
      request(`/api/signers/${personId}/assets/${assetId}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    uploadImageAsset: async (personId, bytes, assetType, label) => {
      const q = qs({ assetType, label });
      const res = await fetch(`/api/signers/${personId}/assets/image${q}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'image/png' },
        body: bytes,
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json();
    },
    removeAsset: (personId, assetId) =>
      request(`/api/signers/${personId}/assets/${assetId}`, {
        method: 'DELETE',
      }),
  },
  documents: {
    uploadPdf: async (bytes, filename) => {
      const q = qs({ filename });
      const res = await fetch(`/api/documents/sources${q}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/pdf' },
        body: bytes,
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`${res.status} ${text}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    // Document-first upload: atomic creation of source + snapshot + adhoc
    // template + draft instance. Client navigates straight to the returned
    // instance id. Used as the primary entry point.
    newFromPdf: async (bytes, filename) => {
      const q = qs({ filename });
      const res = await fetch(`/api/documents/new${q}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/pdf' },
        body: bytes,
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`${res.status} ${text}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    saveInstanceFields: (id, fields) =>
      request(`/api/documents/instances/${id}/fields`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
      }),
    saveInstanceAnnotations: (id, annotations) =>
      request(`/api/documents/instances/${id}/annotations`, {
        method: 'PUT',
        body: JSON.stringify({ annotations }),
      }),
    saveInstanceAsTemplate: (id, title, description) =>
      request(`/api/documents/instances/${id}/save-as-template`, {
        method: 'POST',
        body: JSON.stringify({ title, description }),
      }),
    snapshotPdfUrl: (snapshotId) => `/api/documents/snapshots/${snapshotId}/pdf`,
    listTemplates: () => request('/api/documents/templates'),
    createTemplate: (data) =>
      request('/api/documents/templates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getTemplate: (id) => request(`/api/documents/templates/${id}`),
    updateTemplate: (id, data) =>
      request(`/api/documents/templates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    removeTemplate: (id) =>
      request(`/api/documents/templates/${id}`, { method: 'DELETE' }),
    saveTemplateFields: (id, fields) =>
      request(`/api/documents/templates/${id}/fields`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
      }),
    listInstances: (filters) =>
      request(`/api/documents/instances${qs(filters)}`),
    createInstance: (data) =>
      request('/api/documents/instances', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getInstance: (id) => request(`/api/documents/instances/${id}`),
    removeInstance: (id) =>
      request(`/api/documents/instances/${id}`, { method: 'DELETE' }),
    instancePdfUrl: (id) => `/api/documents/instances/${id}/pdf`,
    instanceFinalPdfUrl: (id) => `/api/documents/instances/${id}/final`,
    setOverrideText: (id, snapshotFieldId, textValue) =>
      request(
        `/api/documents/instances/${id}/overrides/${snapshotFieldId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ textValue }),
        },
      ),
    setOverrideImage: async (id, snapshotFieldId, bytes) => {
      const res = await fetch(
        `/api/documents/instances/${id}/overrides/${snapshotFieldId}/image`,
        {
          method: 'PUT',
          cache: 'no-store',
          headers: { 'Content-Type': 'image/png' },
          body: bytes,
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return true;
    },
    clearOverride: (id, snapshotFieldId) =>
      request(
        `/api/documents/instances/${id}/overrides/${snapshotFieldId}`,
        { method: 'DELETE' },
      ),
    finalize: (id) =>
      request(`/api/documents/instances/${id}/finalize`, { method: 'POST' }),
  },
};
