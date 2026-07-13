import { emitTourChanged } from '../admin/tours/tourEvents.js';

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

// THE single seam that ties every tour mutation to the one canonical
// tour-changed signal. Any API call that changes a TourEvent's visible state
// is wrapped here, so on success it emits emitTourChanged() exactly once and
// every open Tours surface (table / calendar / drawer, incl. other tabs)
// re-fetches — with ZERO per-component wiring. One event, one mechanism, every
// mutation path covered. Failures never emit (the promise rejects through).
function tourMutation(promise) {
  return promise.then((res) => {
    emitTourChanged();
    return res;
  });
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
    // Lifecycle status is GOS-owned: explicit 'trainee'|'staff'|'former'|'none'.
    setLifecycle: (id, lifecycle) =>
      request(`/api/people/${id}/lifecycle`, {
        method: 'PUT',
        body: JSON.stringify({ lifecycle }),
      }),
    // Reject a trainee during training. GOS triggers recruitment (sole recorder);
    // on success GOS revokes access + deletes the PersonRef.
    rejectTraining: (id) =>
      request(`/api/people/${id}/reject-training`, { method: 'POST' }),
    // Accept a trainee to team (official business event). GOS triggers recruitment
    // (recorder); recruitment emits the single accepted_to_team event, which flips
    // this person to staff. NOT a plain lifecycle edit.
    acceptToTeam: (id) =>
      request(`/api/people/${id}/accept-to-team`, { method: 'POST' }),
    // (Re)generate the evaluator ("פורטל ממשב") portal link for a guide. GOS
    // triggers recruitment (token store); returns { ok, url } with the fresh link.
    rotateEvaluatorToken: (id) =>
      request(`/api/people/${id}/evaluator-portal/rotate`, { method: 'POST' }),
    // Step 1 of the shared crop flow — stores the untouched original only.
    uploadImageOriginal: async (id, file) => {
      const q = qs({ filename: file.name });
      const res = await fetch(`/api/people/${id}/image/original${q}`, {
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
    uploadImage: async (id, file, { filename, originalUrl, crop } = {}) => {
      const q = qs({
        filename: filename || file.name || 'avatar.webp',
        ...(originalUrl ? { originalUrl } : {}),
        ...(crop ? { crop: JSON.stringify(crop) } : {}),
      });
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
    // Canonical Tour-assignment eligibility list (active guides/trainees).
    assignable: () => request('/api/people/assignable'),
    // Guide → training-Station permissions (chips UI).
    stationAccess: (id) => request(`/api/people/${id}/station-access`),
    updateStationAccess: (id, body) =>
      request(`/api/people/${id}/station-access`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    // Immutable profile change history + restore (timeline kind='change').
    changes: (id) => request(`/api/people/${id}/changes`),
    restoreChange: (id, entryId, fieldKey) =>
      request(`/api/people/${id}/changes/${entryId}/restore`, {
        method: 'POST',
        body: JSON.stringify({ fieldKey }),
      }),
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
    update: (id, data) => {
      const p = request(`/api/deals/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      // A deal status change (WON creates/joins a tour · LOST cancels it ·
      // WON→open reopens/cancels it) or a slot assignment mutates a tour;
      // plain field/stage edits do not. Emit only for the tour-affecting ones.
      return data && (data.status !== undefined || data.tourEventId !== undefined)
        ? tourMutation(p)
        : p;
    },
    remove: (id) => request(`/api/deals/${id}`, { method: 'DELETE' }),
    // Pending Tour Update — apply (the ONE tour-update orchestration, which
    // mutates the tour → emits) / discard (restores deal fields to the
    // currently-applied tour values → NOT a tour change, no emit).
    applyTourUpdate: (id) =>
      tourMutation(request(`/api/deals/${id}/apply-tour-update`, { method: 'POST', body: '{}' })),
    discardTourUpdate: (id) =>
      request(`/api/deals/${id}/discard-tour-update`, { method: 'POST', body: '{}' }),
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
    // Group registration completion (the progressive modal's actions). All
    // idempotent; the server builds on the shipped lifecycle primitives.
    registerPaymentUrl: (id) =>
      request(`/api/deals/${id}/register/payment-url`, { method: 'POST', body: '{}' }),
    registerHold: (id, data) =>
      tourMutation(request(`/api/deals/${id}/register/hold`, { method: 'POST', body: JSON.stringify(data) })),
    registerSendLink: (id, data) =>
      tourMutation(request(`/api/deals/${id}/register/send-link`, { method: 'POST', body: JSON.stringify(data) })),
    registerNoPayment: (id, data) =>
      tourMutation(request(`/api/deals/${id}/register/no-payment`, { method: 'POST', body: JSON.stringify(data) })),
    settleRegistrationPayment: (id, data = {}) =>
      tourMutation(request(`/api/deals/${id}/register/settle-payment`, { method: 'POST', body: JSON.stringify(data) })),
    cancelRegistrationHold: (id) =>
      tourMutation(request(`/api/deals/${id}/register/cancel-hold`, { method: 'POST', body: '{}' })),
    // Quote Module — ensure + return the draft QuoteDocument for this deal.
    quoteDocument: (id) => request(`/api/deals/${id}/quote-document`),
    quoteDocuments: (id) => request(`/api/deals/${id}/quote-documents`),
    sendQuoteEmail: (id, data) =>
      request(`/api/deals/${id}/send-quote-email`, { method: 'POST', body: JSON.stringify(data) }),
    createQuoteOffer: (id) => request(`/api/deals/${id}/quote-offers`, { method: 'POST' }),
    activateQuoteOffer: (id, offerId) =>
      request(`/api/deals/${id}/quote-offers/${offerId}/activate`, { method: 'POST' }),
    setPrimaryQuoteOffer: (id, offerId) =>
      request(`/api/deals/${id}/quote-offers/${offerId}/primary`, { method: 'PUT' }),
    removeQuoteOffer: (id, offerId) =>
      request(`/api/deals/${id}/quote-offers/${offerId}`, { method: 'DELETE' }),
    unarchiveQuoteOffer: (id, offerId) =>
      request(`/api/deals/${id}/quote-offers/${offerId}/unarchive`, { method: 'POST' }),
    updateQuoteOfferContext: (id, offerId, data) =>
      request(`/api/deals/${id}/quote-offers/${offerId}/context`, { method: 'PUT', body: JSON.stringify(data) }),
    // Permanent customer payment URL — ensures the deal's payment token and
    // returns { token, paymentUrl } (always the SAME URL for a deal). The
    // underlying iCount link is generated/refreshed lazily by GET /pay/:token.
    ensurePaymentToken: (id) =>
      request(`/api/deals/${id}/payment-token`, { method: 'POST', body: JSON.stringify({}) }),
    // iCount document production ("הפק מסמך") — prefill defaults, previous
    // documents (GOS + live iCount), issue (idempotent via idempotencyKey).
    icountDefaults: (id) => request(`/api/deals/${id}/icount/defaults`),
    icountDocuments: (id) => request(`/api/deals/${id}/icount/documents`),
    issueIcountDocument: (id, data) =>
      request(`/api/deals/${id}/icount/documents`, { method: 'POST', body: JSON.stringify(data) }),
    // Base-document prefill: the selected base's REAL lines + total from iCount.
    icountBaseDocument: (id, doctype, docnum) =>
      request(`/api/deals/${id}/icount/base-document${qs({ doctype, docnum })}`),
    // External document linking ("שייך מסמך אחר מאייקאונט").
    icountSearchDocuments: (id, q, doctype) =>
      request(`/api/deals/${id}/icount/search-documents${qs({ q, doctype })}`),
    icountLinkDocument: (id, data) =>
      request(`/api/deals/${id}/icount/link-document`, { method: 'POST', body: JSON.stringify(data) }),
    // Custom-description payment links (/pay/c/<token>).
    customPaymentLinks: (id) => request(`/api/deals/${id}/custom-payment-links`),
    createCustomPaymentLink: (id, data) =>
      request(`/api/deals/${id}/custom-payment-links`, { method: 'POST', body: JSON.stringify(data) }),
    // Collection (גבייה) — the server-computed financial summary (total /
    // paid / balance / payment rows). The client never derives these itself.
    collection: (id) => request(`/api/deals/${id}/collection`),
    // Cardcom tourist payment links (/payment/cardcom/<token>).
    touristPayment: (id) => request(`/api/deals/${id}/tourist-payment`),
    createTouristPayment: (id, data) =>
      request(`/api/deals/${id}/tourist-payment`, { method: 'POST', body: JSON.stringify(data) }),
    editTouristPayment: (id, reqId, data) =>
      request(`/api/deals/${id}/tourist-payment/${reqId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    cancelTouristPayment: (id, reqId) =>
      request(`/api/deals/${id}/tourist-payment/${reqId}/cancel`, { method: 'POST' }),
    // Send an issued iCount document to a customer by email (שלח ללקוח → אימייל).
    // On iCount failure the error payload carries a Gmail proposal — approved
    // (possibly edited) sends go through sendIcountDocumentGmail.
    sendIcountDocument: (id, data) =>
      request(`/api/deals/${id}/icount/send-document`, { method: 'POST', body: JSON.stringify(data) }),
    sendIcountDocumentGmail: (id, data) =>
      request(`/api/deals/${id}/icount/send-document-gmail`, { method: 'POST', body: JSON.stringify(data) }),
  },
  // ── CRM Task Types (configurable catalog behind the Deal task composer) ──
  taskTypes: {
    list: (activeOnly = false) => request(`/api/task-types${activeOnly ? '?activeOnly=1' : ''}`),
    create: (data) => request('/api/task-types', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/task-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/task-types/${id}`, { method: 'DELETE' }),
    reorder: (ids) => request('/api/task-types/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },
  // ── Tours catalogs (Settings → Tours) ────────────────────────────
  activityComponents: {
    list: (activeOnly = false) =>
      request(`/api/activity-components${activeOnly ? '?activeOnly=1' : ''}`),
    create: (data) => request('/api/activity-components', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      request(`/api/activity-components/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/activity-components/${id}`, { method: 'DELETE' }),
    reorder: (ids) =>
      request('/api/activity-components/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },
  workshopLocations: {
    list: (activeOnly = false) =>
      request(`/api/workshop-locations${activeOnly ? '?activeOnly=1' : ''}`),
    create: (data) => request('/api/workshop-locations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      request(`/api/workshop-locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/workshop-locations/${id}`, { method: 'DELETE' }),
    reorder: (ids) =>
      request('/api/workshop-locations/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },
  // ── Deal Tasks (משימות) — future actions on a deal ───────────────
  dealTasks: {
    list: (dealId, status) => request(`/api/deals/${dealId}/tasks${qs({ status })}`),
    create: (dealId, data) => request(`/api/deals/${dealId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
    update: (dealId, taskId, data) =>
      request(`/api/deals/${dealId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    complete: (dealId, taskId) =>
      request(`/api/deals/${dealId}/tasks/${taskId}/complete`, { method: 'POST', body: JSON.stringify({}) }),
    cancel: (dealId, taskId) =>
      request(`/api/deals/${dealId}/tasks/${taskId}/cancel`, { method: 'POST', body: JSON.stringify({}) }),
    sendNow: (dealId, taskId) =>
      request(`/api/deals/${dealId}/tasks/${taskId}/send-now`, { method: 'POST', body: JSON.stringify({}) }),
  },
  // ── Deal Files (private, R2-backed; download via signed redirect) ──
  dealFiles: {
    list: (dealId) => request(`/api/deals/${dealId}/files`),
    presign: (dealId, data) =>
      request(`/api/deals/${dealId}/files/presign`, { method: 'POST', body: JSON.stringify(data) }),
    create: (dealId, data) =>
      request(`/api/deals/${dealId}/files`, { method: 'POST', body: JSON.stringify(data) }),
    remove: (dealId, fileId) => request(`/api/deals/${dealId}/files/${fileId}`, { method: 'DELETE' }),
    downloadUrl: (dealId, fileId) => `/api/deals/${dealId}/files/${fileId}/download`,
    // Full upload: presign → PUT bytes straight to R2 → persist the row.
    upload: async (dealId, file) => {
      const { uploadUrl, key } = await request(`/api/deals/${dealId}/files/presign`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream' }),
      });
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) throw new Error(`upload_failed ${put.status}`);
      return request(`/api/deals/${dealId}/files`, {
        method: 'POST',
        body: JSON.stringify({
          key,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });
    },
  },
  // ── Deal Tour PLANNING (pre-WON) — internal planning layer; the WON
  // transition materializes it into the real tour. Shapes mirror api.tours so
  // the shared editors (TourTeamEditor / TourComponents) drive either surface.
  dealTourPlan: {
    get: (dealId) => request(`/api/deals/${dealId}/tour-plan`),
    update: (dealId, data) =>
      request(`/api/deals/${dealId}/tour-plan`, { method: 'PUT', body: JSON.stringify(data) }),
    addAssignment: (dealId, data) =>
      request(`/api/deals/${dealId}/tour-plan/assignments`, { method: 'POST', body: JSON.stringify(data) }),
    updateAssignment: (assignmentId, data) =>
      request(`/api/deals/tour-plan/assignments/${assignmentId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeAssignment: (assignmentId) =>
      request(`/api/deals/tour-plan/assignments/${assignmentId}`, { method: 'DELETE' }),
    addComponent: (dealId, data) =>
      request(`/api/deals/${dealId}/tour-plan/components`, { method: 'POST', body: JSON.stringify(data) }),
    reorderComponents: (dealId, ids) =>
      request(`/api/deals/${dealId}/tour-plan/components/reorder`, { method: 'PUT', body: JSON.stringify({ ids }) }),
    setComponentLocation: (rowId, workshopLocationId) =>
      request(`/api/deals/tour-plan/components/${rowId}`, {
        method: 'PUT',
        body: JSON.stringify({ workshopLocationId }),
      }),
    removeComponent: (rowId) =>
      request(`/api/deals/tour-plan/components/${rowId}`, { method: 'DELETE' }),
    reseedComponents: (dealId) =>
      request(`/api/deals/${dealId}/tour-plan/components/reseed`, { method: 'POST', body: '{}' }),
    resetComponents: (dealId) =>
      request(`/api/deals/${dealId}/tour-plan/components`, { method: 'DELETE' }),
  },
  auth: {
    status: () => request('/api/auth/status'),
  },
  // ── Collection (גבייה) — WON deals that still require collection ──
  collection: {
    deals: () => request('/api/collection/deals'),
  },
  // ── Payroll (שכר צוות) — day screen + activity drawer ─────────────
  // All numbers are server-computed (payroll engine); the client never
  // does financial math.
  payroll: {
    day: (date) => request(`/api/payroll/day?date=${encodeURIComponent(date)}`),
    activity: (id) => request(`/api/payroll/activities/${id}`),
    updateLine: (id, data) =>
      request(`/api/payroll/lines/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    // Bulk "אשר שכר" — approves every currently-unapproved VALID entry
    // (optionally a subset via entryIds). Entry-level truth on the server.
    approveActivity: (id, entryIds = null) =>
      request(`/api/payroll/activities/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(entryIds ? { entryIds } : {}),
      }),
    officeApproveEntry: (id) =>
      request(`/api/payroll/entries/${id}/office-approve`, { method: 'POST' }),
    officeUnapproveEntry: (id) =>
      request(`/api/payroll/entries/${id}/office-unapprove`, { method: 'POST' }),
    // Focused single-entry editor (Reports flow) — payroll corrections only.
    entry: (id) => request(`/api/payroll/entries/${id}`),
    updateEntry: (id, data) =>
      request(`/api/payroll/entries/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    replyEntry: (id, text) =>
      request(`/api/payroll/entries/${id}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),
    acceptInquiry: (id) =>
      request(`/api/payroll/entries/${id}/inquiry/accept`, { method: 'POST' }),
    rejectInquiry: (id, note) =>
      request(`/api/payroll/entries/${id}/inquiry/reject`, { method: 'POST', body: JSON.stringify({ note }) }),
    changeEntryGuide: (id, externalPersonId) =>
      request(`/api/payroll/entries/${id}/change-guide`, {
        method: 'POST',
        body: JSON.stringify({ externalPersonId }),
      }),
    setEntryPayrollContext: (id, productVariantId) =>
      request(`/api/payroll/entries/${id}/payroll-context`, {
        method: 'POST',
        body: JSON.stringify({ productVariantId }),
      }),
    updateActivitySchedule: (id, data) =>
      request(`/api/payroll/activities/${id}/schedule`, { method: 'PATCH', body: JSON.stringify(data) }),
    voidEntry: (id, reason) =>
      request(`/api/payroll/entries/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    voidActivity: (id, reason) =>
      request(`/api/payroll/activities/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    report: (months, guides = []) =>
      request(
        `/api/payroll/report?months=${encodeURIComponent(months.join(','))}${
          guides.length ? `&guides=${encodeURIComponent(guides.join(','))}` : ''
        }`,
      ),
    createGeneralActivity: (data) =>
      request('/api/payroll/general-activities', { method: 'POST', body: JSON.stringify(data) }),
    components: {
      list: () => request('/api/payroll/components'),
      create: (data) => request('/api/payroll/components', { method: 'POST', body: JSON.stringify(data) }),
      update: (id, data) =>
        request(`/api/payroll/components/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      remove: (id) => request(`/api/payroll/components/${id}`, { method: 'DELETE' }),
      reorder: (ids) =>
        request('/api/payroll/components/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
    },
    activityTypes: {
      list: () => request('/api/payroll/activity-types'),
      create: (data) =>
        request('/api/payroll/activity-types', { method: 'POST', body: JSON.stringify(data) }),
      update: (id, data) =>
        request(`/api/payroll/activity-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      remove: (id) => request(`/api/payroll/activity-types/${id}`, { method: 'DELETE' }),
      reorder: (ids) =>
        request('/api/payroll/activity-types/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
    },
  },
  // ── WhatsApp module — connections admin (Slice 1) ────────────────
  // Accounts come from the DB; live status/actions proxy to the
  // per-number bridge services.
  whatsapp: {
    accounts: () => request('/api/whatsapp/accounts'),
    updateAccount: (id, data) =>
      request(`/api/whatsapp/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    accountStatus: (id) => request(`/api/whatsapp/accounts/${id}/status`),
    diagnose: (id) => request(`/api/whatsapp/accounts/${id}/diagnose`),
    restartSocket: (id) =>
      request(`/api/whatsapp/accounts/${id}/restart-socket`, { method: 'POST', body: JSON.stringify({}) }),
    hardResetSession: (id) =>
      request(`/api/whatsapp/accounts/${id}/hard-reset-session`, { method: 'POST', body: JSON.stringify({}) }),
    signOut: (id) =>
      request(`/api/whatsapp/accounts/${id}/sign-out`, { method: 'POST', body: JSON.stringify({}) }),
    // Chat mirror (Slices 2-3): chats linked to a CRM subject + thread pages.
    contextChats: (subjectType, subjectId) =>
      request(`/api/whatsapp/context-chats${qs({ subjectType, subjectId })}`),
    chatMessages: (chatId, params) =>
      request(`/api/whatsapp/chats/${chatId}/messages${qs(params)}`),
    // Inbox workflow state (pin / snooze) + message bookmarks (star)
    chatState: (chatId, data) =>
      request(`/api/whatsapp/chats/${chatId}/state`, { method: 'PUT', body: JSON.stringify(data) }),
    starMessage: (messageId, starred) =>
      request(`/api/whatsapp/messages/${messageId}/star`, { method: 'PUT', body: JSON.stringify({ starred }) }),
    chatStarred: (chatId) => request(`/api/whatsapp/chats/${chatId}/starred`),
    sendMessage: (chatId, data) =>
      request(`/api/whatsapp/chats/${chatId}/send`, { method: 'POST', body: JSON.stringify(data) }),
    sendVoice: (chatId, data) =>
      request(`/api/whatsapp/chats/${chatId}/send-voice`, { method: 'POST', body: JSON.stringify(data) }),
    sendMedia: (chatId, data) =>
      request(`/api/whatsapp/chats/${chatId}/send-media`, { method: 'POST', body: JSON.stringify(data) }),
    // Active inbox + manual linking + WhatsApp→Deal navigation (Slice 8)
    inboxChats: (params) => request(`/api/whatsapp/inbox-chats${qs(params)}`),
    linkChat: (chatId, contactId) =>
      request(`/api/whatsapp/chats/${chatId}/link`, { method: 'PUT', body: JSON.stringify({ contactId }) }),
    dealResolution: (chatId) => request(`/api/whatsapp/chats/${chatId}/deal-resolution`),
    openDealFromChat: (chatId, data) =>
      request(`/api/whatsapp/chats/${chatId}/open-deal`, { method: 'POST', body: JSON.stringify(data || {}) }),
    // Scheduled messages (Slice 7)
    scheduledList: (chatId) => request(`/api/whatsapp/chats/${chatId}/scheduled`),
    scheduleMessage: (chatId, data) =>
      request(`/api/whatsapp/chats/${chatId}/scheduled`, { method: 'POST', body: JSON.stringify(data) }),
    cancelScheduled: (id) =>
      request(`/api/whatsapp/scheduled/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) }),
    updateScheduled: (id, data) =>
      request(`/api/whatsapp/scheduled/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  // ── Email module — Gmail integration ─────────────────────────────
  // Read-only mirror + send. Read/unread state is GOS-side only; Gmail is
  // never mutated (no archive/label/mark-read) during the Make transition.
  email: {
    accounts: () => request('/api/email/accounts'),
    connectStart: () => request('/api/email/connect/start'),
    syncAccount: (id) => request(`/api/email/accounts/${id}/sync`, { method: 'POST', body: JSON.stringify({}) }),
    updateAccount: (id, data) =>
      request(`/api/email/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    disconnectAccount: (id) =>
      request(`/api/email/accounts/${id}/disconnect`, { method: 'POST', body: JSON.stringify({}) }),
    inbox: (params) => request(`/api/email/inbox${qs(params)}`),
    threadsByDeal: (dealId) => request(`/api/email/by-deal/${dealId}`),
    threadsByContact: (contactId) => request(`/api/email/by-contact/${contactId}`),
    thread: (id) => request(`/api/email/threads/${id}`),
    markThreadRead: (id) => request(`/api/email/threads/${id}/read`, { method: 'POST', body: JSON.stringify({}) }),
    markThreadUnread: (id) => request(`/api/email/threads/${id}/unread`, { method: 'POST', body: JSON.stringify({}) }),
    archiveThread: (id) => request(`/api/email/threads/${id}/archive`, { method: 'POST', body: JSON.stringify({}) }),
    unarchiveThread: (id) => request(`/api/email/threads/${id}/unarchive`, { method: 'POST', body: JSON.stringify({}) }),
    bulkThreadAction: (ids, action) =>
      request('/api/email/threads/bulk-action', { method: 'POST', body: JSON.stringify({ ids, action }) }),
    pinThread: (id, pinned) =>
      request(`/api/email/threads/${id}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) }),
    linkContact: (id, contactId) =>
      request(`/api/email/threads/${id}/link-contact`, { method: 'PUT', body: JSON.stringify({ contactId }) }),
    linkDeal: (id, dealId) =>
      request(`/api/email/threads/${id}/link-deal`, { method: 'PUT', body: JSON.stringify({ dealId }) }),
    dealResolution: (id) => request(`/api/email/threads/${id}/deal-resolution`),
    openDealFromThread: (id, data) =>
      request(`/api/email/threads/${id}/open-deal`, { method: 'POST', body: JSON.stringify(data || {}) }),
    send: (data) => request('/api/email/send', { method: 'POST', body: JSON.stringify(data) }),
    attachmentDownload: (attachmentId) => request(`/api/email/attachments/${attachmentId}/download`),
  },
  // ── Quote Module (quote documents + composer preview) ───────────
  quoteDocuments: {
    get: (id) => request(`/api/quote-documents/${id}`),
    update: (id, data) =>
      request(`/api/quote-documents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    composePreview: (id) => request(`/api/quote-documents/${id}/compose-preview`),
    composePreviewWith: (id, body) =>
      request(`/api/quote-documents/${id}/compose-preview`, { method: 'POST', body: JSON.stringify(body || {}) }),
    produce: (id, body) =>
      request(`/api/quote-documents/${id}/produce`, { method: 'POST', body: JSON.stringify(body || {}) }),
    resetToSource: (id) =>
      request(`/api/quote-documents/${id}/reset-to-source`, { method: 'POST' }),
  },
  // ── Public customer quote page (token-gated, no auth) ────────────
  publicQuote: {
    get: (token) => request(`/api/public/quote/${encodeURIComponent(token)}`),
    sign: (token, body) =>
      request(`/api/public/quote/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
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
    // Shared Content defaults (Location Defaults slice).
    sharedDefaults: (id) => request(`/api/locations/${id}/shared-defaults`),
    setSharedDefault: (id, type, sharedContentId) =>
      request(`/api/locations/${id}/shared-defaults`, { method: 'PUT', body: JSON.stringify({ type, sharedContentId }) }),
    consolidationSuggestions: (id, type) => request(`/api/locations/${id}/consolidation-suggestions?type=${type}`),
    consolidate: (id, type, sharedContentId) =>
      request(`/api/locations/${id}/consolidate`, { method: 'POST', body: JSON.stringify({ type, sharedContentId }) }),
  },
  activityTypes: {
    list: () => request('/api/activity-types'),
  },
  products: {
    list: () => request('/api/products'),
    // Flat variant list (id + product/location labels) for the video variant picker.
    variantOptions: () => request('/api/products/variant-options'),
    get: (id) => request(`/api/products/${id}`),
    create: (data) => request('/api/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    // Deletion preflight: relation counts + { blockers, canHardDelete, cascades }.
    relations: (id) => request(`/api/products/${id}/relations`),
    remove: (id) => request(`/api/products/${id}`, { method: 'DELETE' }),
    addVariant: (id, data) => request(`/api/products/${id}/variants`, { method: 'POST', body: JSON.stringify(data) }),
    updateVariant: (variantId, data) => request(`/api/products/variants/${variantId}`, { method: 'PUT', body: JSON.stringify(data) }),
    // Default activity components for a VARIANT — replace-all, ordered. body { componentIds }.
    setVariantActivityComponents: (variantId, componentIds) =>
      request(`/api/products/variants/${variantId}/activity-components`, {
        method: 'PUT',
        body: JSON.stringify({ componentIds }),
      }),
    removeVariant: (variantId) => request(`/api/products/variants/${variantId}`, { method: 'DELETE' }),
    // Quote Image Library references — replace-all per variant.
    // positions: { hero: [quoteImageId…], slot1: […], slot2: […] } (order = display order).
    setVariantQuoteImages: (variantId, positions) =>
      request(`/api/products/variants/${variantId}/quote-images`, { method: 'PUT', body: JSON.stringify({ positions }) }),
  },
  // Quote Image Library — independent reusable quote images (single source of
  // truth). Variants only reference these; see products.setVariantQuoteImages.
  quoteImages: {
    list: () => request('/api/quote-images'),
    create: (data) => request('/api/quote-images', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/quote-images/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/quote-images/${id}`, { method: 'DELETE' }),
  },
  // Shared Content Library — reusable content referenced by variants (and, later,
  // other consumers). Everything is by reference; only `fork` copies.
  sharedContent: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.type) q.set('type', params.type);
      if (params.locationId) q.set('locationId', params.locationId);
      if (params.active != null) q.set('active', String(params.active));
      if (params.q) q.set('q', params.q);
      const s = q.toString();
      return request('/api/shared-content' + (s ? `?${s}` : ''));
    },
    get: (id) => request(`/api/shared-content/${id}`),
    create: (data) => request('/api/shared-content', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/shared-content/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/shared-content/${id}`, { method: 'DELETE' }),
    whereUsed: (id, lang = 'he') => request(`/api/shared-content/${id}/where-used?lang=${lang}`),
    linkCandidates: (id, lang = 'he') => request(`/api/shared-content/${id}/link-candidates?lang=${lang}`),
    // replace=true is required to overwrite a variant's existing single-type link.
    link: (id, variantId, replace = false) =>
      request(`/api/shared-content/${id}/link`, { method: 'POST', body: JSON.stringify({ variantId, replace }) }),
    fork: (id, variantId) => request(`/api/shared-content/${id}/fork`, { method: 'POST', body: JSON.stringify({ variantId }) }),
    variantState: (variantId) => request(`/api/shared-content/variant/${variantId}`),
    createForVariant: (variantId, data) => request(`/api/shared-content/variant/${variantId}`, { method: 'POST', body: JSON.stringify(data) }),
    convert: (variantId, type) => request(`/api/shared-content/variant/${variantId}/convert`, { method: 'POST', body: JSON.stringify({ type }) }),
    detach: (variantId, type) => request(`/api/shared-content/variant/${variantId}/${type}`, { method: 'DELETE' }),
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

  // Israeli bank catalog — static bundled dataset (bank codes/names for the
  // profile bank-details autocomplete; public, shared with the guide portal).
  bankCatalog: {
    get: () => request('/api/bank-catalog'),
  },

  // Guide Portal permissions — server-backed singleton (Settings → Tours →
  // הרשאות מדריכים). Enforced by the /api/portal guide routes.
  guidePortalSettings: {
    get: () => request('/api/guide-portal-settings'),
    update: (data) =>
      request('/api/guide-portal-settings', { method: 'PUT', body: JSON.stringify(data) }),
  },

  // Tour Gallery — per-TourEvent media on R2 (staff surface). Uploads go
  // DIRECTLY to R2; these endpoints only authorize/record/verify.
  tourGallery: {
    settings: () => request('/api/tour-gallery/settings'),
    updateSettings: (data) =>
      request('/api/tour-gallery/settings', { method: 'PUT', body: JSON.stringify(data) }),
    summary: (tourEventId) => request(`/api/tour-gallery/${tourEventId}/summary`),
    get: (tourEventId) => request(`/api/tour-gallery/${tourEventId}`),
    ensureLink: (tourEventId) =>
      request(`/api/tour-gallery/${tourEventId}/link`, { method: 'POST', body: '{}' }),
    rotateLink: (tourEventId) =>
      request(`/api/tour-gallery/${tourEventId}/link/rotate`, { method: 'POST', body: '{}' }),
    revokeLink: (tourEventId) =>
      request(`/api/tour-gallery/${tourEventId}/link`, { method: 'DELETE' }),
    setCover: (tourEventId, mediaId) =>
      request(`/api/tour-gallery/${tourEventId}/cover`, {
        method: 'PUT',
        body: JSON.stringify({ mediaId }),
      }),
    initiateUploads: (tourEventId, files) =>
      request(`/api/tour-gallery/${tourEventId}/uploads`, {
        method: 'POST',
        body: JSON.stringify({ files }),
      }),
    uploadUrls: (tourEventId, mediaId, body) =>
      request(`/api/tour-gallery/${tourEventId}/uploads/${mediaId}/urls`, {
        method: 'POST',
        body: JSON.stringify(body || {}),
      }),
    completeUpload: (tourEventId, mediaId, body) =>
      request(`/api/tour-gallery/${tourEventId}/uploads/${mediaId}/complete`, {
        method: 'POST',
        body: JSON.stringify(body || {}),
      }),
    abortUpload: (tourEventId, mediaId) =>
      request(`/api/tour-gallery/${tourEventId}/uploads/${mediaId}/abort`, {
        method: 'POST',
        body: '{}',
      }),
    deleteMedia: (tourEventId, ids) =>
      request(`/api/tour-gallery/${tourEventId}/media/delete`, {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    downloadPath: (tourEventId, mediaId) =>
      `/api/tour-gallery/${tourEventId}/media/${mediaId}/download`,
    // "Download all" async export job.
    requestExport: (tourEventId) =>
      request(`/api/tour-gallery/${tourEventId}/export`, { method: 'POST', body: '{}' }),
    exportStatus: (tourEventId, exportId) =>
      request(`/api/tour-gallery/${tourEventId}/export/${exportId}`),
    exportDownloadPath: (tourEventId, exportId) =>
      `/api/tour-gallery/${tourEventId}/export/${exportId}/download`,
  },

  // Tours OPERATIONAL module ("סיורים") — TourEvent/Booking. Distinct from
  // tourContent below (training/route content).
  // Open Tours — recurring tour TEMPLATES (the "what") + weekly schedule rules
  // (the "when") + one-off exceptions. Mutations materialize/adjust group slots
  // → wrapped in tourMutation() so open surfaces refresh.
  openTours: {
    list: () => request('/api/open-tours'),
    get: (id) => request(`/api/open-tours/${id}`),
    sellableProducts: () => request('/api/open-tours/sellable-products'),
    create: (data) =>
      tourMutation(request('/api/open-tours', { method: 'POST', body: JSON.stringify(data) })),
    update: (id, data) =>
      tourMutation(request(`/api/open-tours/${id}`, { method: 'PUT', body: JSON.stringify(data) })),
    remove: (id) => tourMutation(request(`/api/open-tours/${id}`, { method: 'DELETE' })),
    setProducts: (id, products) =>
      tourMutation(request(`/api/open-tours/${id}/products`, { method: 'PUT', body: JSON.stringify({ products }) })),
    createRule: (id, data) =>
      tourMutation(request(`/api/open-tours/${id}/rules`, { method: 'POST', body: JSON.stringify(data) })),
    updateRule: (ruleId, data) =>
      tourMutation(request(`/api/open-tours/rules/${ruleId}`, { method: 'PUT', body: JSON.stringify(data) })),
    // Dry-run impact preview of a proposed rule edit (before saving).
    ruleImpact: (ruleId, data) =>
      request(`/api/open-tours/rules/${ruleId}/impact`, { method: 'POST', body: JSON.stringify(data) }),
    // Raw update that surfaces the 409 confirm-required response to the caller.
    updateRuleRaw: (ruleId, data) =>
      request(`/api/open-tours/rules/${ruleId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeRule: (ruleId) => tourMutation(request(`/api/open-tours/rules/${ruleId}`, { method: 'DELETE' })),
    createException: (id, data) =>
      tourMutation(request(`/api/open-tours/${id}/exceptions`, { method: 'POST', body: JSON.stringify(data) })),
    exceptionImpact: (exceptionId, data) =>
      request(`/api/open-tours/exceptions/${exceptionId}/impact`, { method: 'POST', body: JSON.stringify(data) }),
    updateExceptionRaw: (exceptionId, data) =>
      request(`/api/open-tours/exceptions/${exceptionId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeException: (exceptionId) =>
      tourMutation(request(`/api/open-tours/exceptions/${exceptionId}`, { method: 'DELETE' })),
    // Occurrence override: manually pin a generated slot's operational product
    // (suspends registration-driven derivation) or release the pin to re-derive.
    pinProduct: (tourEventId, productVariantId) =>
      tourMutation(
        request(`/api/open-tours/occurrences/${tourEventId}/product`, {
          method: 'POST',
          body: JSON.stringify({ productVariantId }),
        }),
      ),
    clearProduct: (tourEventId) =>
      tourMutation(request(`/api/open-tours/occurrences/${tourEventId}/product`, { method: 'DELETE' })),
    // WooCommerce product mappings (sellable card → Woo Variable Product).
    wooMappings: () => request('/api/open-tours/woo/mappings'),
    setWooMapping: (cardGroupId, data) =>
      request(`/api/open-tours/woo/mappings/${cardGroupId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeWooMapping: (cardGroupId) =>
      request(`/api/open-tours/woo/mappings/${cardGroupId}`, { method: 'DELETE' }),
    // Read-only: inspect a live Woo product's attributes/terms to build a config.
    wooProductStructure: (productId) =>
      request(`/api/open-tours/woo/products/${productId}/structure`),
    // Auto-build the mapping config (real ticketTypeIds + exact store encoding).
    wooSuggestConfig: (cardGroupId, productId, activity) =>
      request(
        `/api/open-tours/woo/suggest-config/${cardGroupId}?productId=${productId}` +
          (activity ? `&activity=${encodeURIComponent(activity)}` : ''),
      ),
    // Controlled activation: gate status, candidate slots, single-occurrence sync.
    wooGate: () => request('/api/open-tours/woo/gate'),
    wooCandidates: (cardGroupId, limit = 20) =>
      request(`/api/open-tours/woo/candidates/${cardGroupId}?limit=${limit}`),
    wooSyncOne: (tourEventId) =>
      request(`/api/open-tours/woo/sync-one/${tourEventId}`, { method: 'POST' }),
  },
  tours: {
    // Every mutation below is wrapped in tourMutation() so a success emits the
    // ONE canonical tour-changed signal (see the helper above). READS (list /
    // calendar / get / scheduling / orphans / completionState) are NOT wrapped.
    // "שבץ לסיור" / "החלף סיור" — attach a WON group deal to a slot (replaces
    // its current booking when one exists). Lives on the deals router.
    assignDeal: (dealId, tourEventId, allowOverbook = false) =>
      tourMutation(
        request(`/api/deals/${dealId}/tour-booking`, {
          method: 'POST',
          body: JSON.stringify({ tourEventId, allowOverbook }),
        }),
      ),
    list: (params = {}) => request('/api/tours' + qs(params)),
    // Calendar view — lean date-range DTO (same TourEvents, no Deal payloads).
    calendar: (params = {}) => request('/api/tours/calendar' + qs(params)),
    // Scheduling GLOBALS (Settings → Tours): the shared TourSettings singleton
    // (defaultCapacity + generateDaysAhead horizon). The legacy per-rule
    // endpoints were retired — recurring generation lives in api.openTours.
    scheduling: () => request('/api/tours/scheduling'),
    updateSchedulingSettings: (data) =>
      tourMutation(request('/api/tours/scheduling/settings', { method: 'PUT', body: JSON.stringify(data) })),
    // Orphaned bookings — tours intentionally kept when their deal left WON.
    orphans: () => request('/api/tours/orphans'),
    orphansCount: () => request('/api/tours/orphans/count'),
    reconnectOrphan: (bookingId) =>
      tourMutation(request(`/api/tours/orphans/${bookingId}/reconnect`, { method: 'POST', body: '{}' })),
    cancelOrphan: (bookingId) =>
      tourMutation(request(`/api/tours/orphans/${bookingId}/cancel`, { method: 'POST', body: '{}' })),
    get: (id) => request(`/api/tours/${id}`),
    // Explicit tour completion: dialog payload (missing required summaries)
    // + the manual "סמן סיור כהסתיים" transition.
    completionState: (id) => request(`/api/tours/${id}/completion-state`),
    complete: (id) => tourMutation(request(`/api/tours/${id}/complete`, { method: 'POST', body: '{}' })),
    // Completion reversal ("החזר לעתידי") — completed → scheduled while the
    // tour's date is still today/future.
    reopen: (id) => tourMutation(request(`/api/tours/${id}/reopen`, { method: 'POST', body: '{}' })),
    // Guide assignments (role lives on the assignment; switching = update).
    addAssignment: (tourId, data) =>
      tourMutation(request(`/api/tours/${tourId}/assignments`, { method: 'POST', body: JSON.stringify(data) })),
    updateAssignment: (assignmentId, data) =>
      tourMutation(request(`/api/tours/assignments/${assignmentId}`, { method: 'PUT', body: JSON.stringify(data) })),
    removeAssignment: (assignmentId) =>
      tourMutation(request(`/api/tours/assignments/${assignmentId}`, { method: 'DELETE' })),
    // Activity components (per tour; seeded from the product, then tour-owned).
    addComponent: (tourId, data) =>
      tourMutation(request(`/api/tours/${tourId}/components`, { method: 'POST', body: JSON.stringify(data) })),
    reorderComponents: (tourId, ids) =>
      tourMutation(request(`/api/tours/${tourId}/components/reorder`, { method: 'PUT', body: JSON.stringify({ ids }) })),
    setComponentLocation: (rowId, workshopLocationId) =>
      tourMutation(
        request(`/api/tours/components/${rowId}`, {
          method: 'PUT',
          body: JSON.stringify({ workshopLocationId }),
        }),
      ),
    removeComponent: (rowId) => tourMutation(request(`/api/tours/components/${rowId}`, { method: 'DELETE' })),
    reseedComponents: (tourId) =>
      tourMutation(request(`/api/tours/${tourId}/components/reseed`, { method: 'POST', body: '{}' })),
    // Creates a group Tour Slot (private/business tours are created only by
    // the deal WON transition, never from here).
    create: (data) => tourMutation(request('/api/tours', { method: 'POST', body: JSON.stringify(data) })),
    update: (id, data) => tourMutation(request(`/api/tours/${id}`, { method: 'PUT', body: JSON.stringify(data) })),
    remove: (id) => tourMutation(request(`/api/tours/${id}`, { method: 'DELETE' })),
  },

  // Tour Content (GOS source of truth). Tour → Station → ordered Step →
  // (reference) → ContentBlock → BlockAsset, plus admin-only StationNotes.
  // Media is R2/MediaFile only. Reorder endpoints take { order: [ids] }.
  tourContent: {
    // Tours
    listTours: (params = {}) => request('/api/tour-content/tours' + qs(params)),
    getTour: (id) => request(`/api/tour-content/tours/${id}`),
    createTour: (data) =>
      request('/api/tour-content/tours', { method: 'POST', body: JSON.stringify(data) }),
    updateTour: (id, data) =>
      request(`/api/tour-content/tours/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeTour: (id) => request(`/api/tour-content/tours/${id}`, { method: 'DELETE' }),
    reorderTours: (order) =>
      request('/api/tour-content/tours/reorder', { method: 'PUT', body: JSON.stringify({ order }) }),
    // Stations
    listStations: (tourId) => request(`/api/tour-content/tours/${tourId}/stations`),
    getStation: (id) => request(`/api/tour-content/stations/${id}`),
    createStation: (tourId, data) =>
      request(`/api/tour-content/tours/${tourId}/stations`, { method: 'POST', body: JSON.stringify(data) }),
    updateStation: (id, data) =>
      request(`/api/tour-content/stations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeStation: (id) => request(`/api/tour-content/stations/${id}`, { method: 'DELETE' }),
    reorderStations: (tourId, order) =>
      request(`/api/tour-content/tours/${tourId}/stations/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
    // Content blocks (reusable library)
    listBlocks: (params = {}) => request('/api/tour-content/blocks' + qs(params)),
    getBlock: (id) => request(`/api/tour-content/blocks/${id}`),
    createBlock: (data) =>
      request('/api/tour-content/blocks', { method: 'POST', body: JSON.stringify(data) }),
    updateBlock: (id, data) =>
      request(`/api/tour-content/blocks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeBlock: (id) => request(`/api/tour-content/blocks/${id}`, { method: 'DELETE' }),
    blockWhereUsed: (id) => request(`/api/tour-content/blocks/${id}/where-used`),
    // Steps (ordered placement of a block into a station)
    listSteps: (stationId) => request(`/api/tour-content/stations/${stationId}/steps`),
    createStep: (stationId, data) =>
      request(`/api/tour-content/stations/${stationId}/steps`, { method: 'POST', body: JSON.stringify(data) }),
    updateStep: (id, data) =>
      request(`/api/tour-content/steps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeStep: (id) => request(`/api/tour-content/steps/${id}`, { method: 'DELETE' }),
    reorderSteps: (stationId, order) =>
      request(`/api/tour-content/stations/${stationId}/steps/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
    // Block assets
    listAssets: (blockId) => request(`/api/tour-content/blocks/${blockId}/assets`),
    createAsset: (blockId, data) =>
      request(`/api/tour-content/blocks/${blockId}/assets`, { method: 'POST', body: JSON.stringify(data) }),
    updateAsset: (id, data) =>
      request(`/api/tour-content/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeAsset: (id) => request(`/api/tour-content/assets/${id}`, { method: 'DELETE' }),
    reorderAssets: (blockId, order) =>
      request(`/api/tour-content/blocks/${blockId}/assets/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
    // Station notes (admin-only)
    listNotes: (stationId) => request(`/api/tour-content/stations/${stationId}/notes`),
    createNote: (stationId, data) =>
      request(`/api/tour-content/stations/${stationId}/notes`, { method: 'POST', body: JSON.stringify(data) }),
    updateNote: (id, data) =>
      request(`/api/tour-content/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeNote: (id) => request(`/api/tour-content/notes/${id}`, { method: 'DELETE' }),
    reorderNotes: (stationId, order) =>
      request(`/api/tour-content/stations/${stationId}/notes/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
  },

  // Questionnaire Engine — generic templates/versions/sections/questions +
  // submissions (blueprint: docs/architecture/questionnaire-engine-design.md).
  questionnaires: {
    list: (params) => request(`/api/questionnaires${qs(params)}`),
    get: (id) => request(`/api/questionnaires/${id}`),
    create: (data) => request('/api/questionnaires', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/questionnaires/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/questionnaires/${id}`, { method: 'DELETE' }),
    purposes: () => request('/api/questionnaires/purposes'),
    setPurposeConfig: (purpose, templateId) =>
      request(`/api/questionnaires/purpose-config/${purpose}`, { method: 'PUT', body: JSON.stringify({ templateId }) }),
    // Versions (draft-only writes; publish freezes)
    getVersion: (versionId) => request(`/api/questionnaires/versions/${versionId}`),
    updateVersion: (versionId, data) =>
      request(`/api/questionnaires/versions/${versionId}`, { method: 'PUT', body: JSON.stringify(data) }),
    publishVersion: (versionId) =>
      request(`/api/questionnaires/versions/${versionId}/publish`, { method: 'POST' }),
    createNextDraft: (templateId) =>
      request(`/api/questionnaires/${templateId}/versions`, { method: 'POST' }),
    updateLayout: (versionId, layout) =>
      request(`/api/questionnaires/versions/${versionId}/layout`, { method: 'PUT', body: JSON.stringify(layout) }),
    // Structure
    createSection: (versionId, data) =>
      request(`/api/questionnaires/versions/${versionId}/sections`, { method: 'POST', body: JSON.stringify(data) }),
    updateSection: (sectionId, data) =>
      request(`/api/questionnaires/sections/${sectionId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeSection: (sectionId) => request(`/api/questionnaires/sections/${sectionId}`, { method: 'DELETE' }),
    createQuestion: (sectionId, data) =>
      request(`/api/questionnaires/sections/${sectionId}/questions`, { method: 'POST', body: JSON.stringify(data) }),
    updateQuestion: (questionId, data) =>
      request(`/api/questionnaires/questions/${questionId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeQuestion: (questionId) => request(`/api/questionnaires/questions/${questionId}`, { method: 'DELETE' }),
    createOption: (questionId, data) =>
      request(`/api/questionnaires/questions/${questionId}/options`, { method: 'POST', body: JSON.stringify(data) }),
    updateOption: (optionId, data) =>
      request(`/api/questionnaires/options/${optionId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeOption: (optionId) => request(`/api/questionnaires/options/${optionId}`, { method: 'DELETE' }),
    reorderOptions: (questionId, ids) =>
      request(`/api/questionnaires/questions/${questionId}/options/reorder`, { method: 'PUT', body: JSON.stringify({ ids }) }),
    // Submissions (staff flows; public token flows arrive in Slice 3)
    listSubmissions: (params) => request(`/api/questionnaires/submissions${qs(params)}`),
    startSubmission: (data) =>
      request('/api/questionnaires/submissions/start', { method: 'POST', body: JSON.stringify(data) }),
    getSubmission: (id) => request(`/api/questionnaires/submissions/${id}`),
    saveAnswers: (id, answers) =>
      request(`/api/questionnaires/submissions/${id}/answers`, { method: 'PUT', body: JSON.stringify({ answers }) }),
    submit: (id, answers) =>
      request(`/api/questionnaires/submissions/${id}/submit`, { method: 'POST', body: JSON.stringify({ answers }) }),
    voidSubmission: (id) => request(`/api/questionnaires/submissions/${id}/void`, { method: 'POST' }),
    // Public links (operator side) — get-or-create the ONE active link per
    // (subject, purpose); rotate revokes and mints a fresh token.
    getOrCreateLink: (data) =>
      request('/api/questionnaires/links', { method: 'POST', body: JSON.stringify(data) }),
    rotateLink: (linkId) => request(`/api/questionnaires/links/${linkId}/rotate`, { method: 'POST' }),
    // Answer uploads (images/PDF, raw body — NOT the JSON request helper).
    uploadAnswerFile: async (file) => {
      const res = await fetch(`/api/questionnaires/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        cache: 'no-store',
        body: file,
      });
      if (!res.ok) {
        const err = new Error(`upload failed (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    // Public fill (no auth — token IS the capability; used by /form/:token).
    publicForm: {
      get: (token) => request(`/api/public/form/${token}`),
      saveAnswers: (token, answers) =>
        request(`/api/public/form/${token}/answers`, { method: 'PUT', body: JSON.stringify({ answers }) }),
      submit: (token, answers, language) =>
        request(`/api/public/form/${token}/submit`, { method: 'POST', body: JSON.stringify({ answers, language }) }),
      upload: async (token, file) => {
        const res = await fetch(`/api/public/form/${token}/upload?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          cache: 'no-store',
          body: file,
        });
        if (!res.ok) {
          const err = new Error(`upload failed (${res.status})`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      },
    },
  },
  // בקרה (Operations Control) — the canonical operational-issue surface.
  // Mutations that already have endpoints (whatsapp.scheduledCancel,
  // deals.applyTourUpdate…) are called directly by the dashboard's action
  // runner, followed by recheck() so the card resolves immediately.
  control: {
    issues: () => request('/api/control/issues'),
    acknowledge: (id) => request(`/api/control/issues/${id}/acknowledge`, { method: 'POST' }),
    unacknowledge: (id) => request(`/api/control/issues/${id}/unacknowledge`, { method: 'POST' }),
    recheck: (id) => request(`/api/control/issues/${id}/recheck`, { method: 'POST' }),
    action: (id, key, data) =>
      request(`/api/control/issues/${id}/actions/${key}`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
  },
};
