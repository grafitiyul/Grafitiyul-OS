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
    create: (name) =>
      request('/api/items/folders', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    update: (id, data) =>
      request(`/api/items/folders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (id) => request(`/api/items/folders/${id}`, { method: 'DELETE' }),
    reorder: (ids) =>
      request('/api/items/folders/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      }),
  },
  flows: {
    list: () => request('/api/flows'),
    get: (id) => request(`/api/flows/${id}`),
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
    list: () => request('/api/people'),
    get: (id) => request(`/api/people/${id}`),
    create: (data) =>
      request('/api/people', { method: 'POST', body: JSON.stringify(data) }),
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
    submit: (id) => request(`/api/attempts/${id}/submit`, { method: 'POST' }),
    outstanding: (id) => request(`/api/attempts/${id}/outstanding`),
    listForFlow: (flowId) => request(`/api/attempts/flow/${flowId}`),
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
