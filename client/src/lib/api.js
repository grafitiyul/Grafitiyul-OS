async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
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
  },
  questionItems: {
    list: () => request('/api/items/questions'),
    get: (id) => request(`/api/items/questions/${id}`),
    usage: (id) => request(`/api/items/questions/${id}/usage`),
    create: (data) => request('/api/items/questions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) =>
      request(`/api/items/questions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/items/questions/${id}`, { method: 'DELETE' }),
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
  },
  attempts: {
    create: (flowId, learnerName) =>
      request('/api/attempts', {
        method: 'POST',
        body: JSON.stringify({ flowId, learnerName }),
      }),
    get: (id) => request(`/api/attempts/${id}`),
    answer: (id, payload) =>
      request(`/api/attempts/${id}/answer`, { method: 'POST', body: JSON.stringify(payload) }),
    advance: (id) => request(`/api/attempts/${id}/advance`, { method: 'POST' }),
    resume: (id) => request(`/api/attempts/${id}/resume`, { method: 'POST' }),
    listForFlow: (flowId) => request(`/api/attempts/flow/${flowId}`),
  },
  reviews: {
    approve: (id) => request(`/api/reviews/attempts/${id}/approve`, { method: 'POST' }),
    returnForFix: (id, note) =>
      request(`/api/reviews/attempts/${id}/return`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
  },
};
