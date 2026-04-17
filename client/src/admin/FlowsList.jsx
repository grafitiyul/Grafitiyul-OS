import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function FlowsList() {
  const [flows, setFlows] = useState([]);
  const [title, setTitle] = useState('');
  const navigate = useNavigate();

  async function load() {
    setFlows(await api.flows.list());
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!title.trim()) return;
    const f = await api.flows.create({ title });
    navigate(`/admin/flows/${f.id}/edit`);
  }

  async function remove(id) {
    if (!confirm('Delete this flow and all its attempts?')) return;
    await api.flows.remove(id);
    load();
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h2 className="text-2xl font-semibold mb-6">Flows</h2>
      <div className="bg-white border rounded p-4 mb-6 flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder="New flow title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          disabled={!title.trim()}
          onClick={create}
        >
          Create
        </button>
      </div>
      <div className="space-y-2">
        {flows.map((f) => (
          <div
            key={f.id}
            className="bg-white border rounded p-4 flex items-center justify-between"
          >
            <div>
              <Link
                to={`/admin/flows/${f.id}/edit`}
                className="font-medium text-blue-700 hover:underline"
              >
                {f.title}
              </Link>
              <div className="text-sm text-gray-500">
                {f.status} · {f._count.nodes} nodes · {f._count.attempts} attempts
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                to={`/admin/flows/${f.id}/review`}
                className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
              >
                Review
              </Link>
              <Link
                to={`/admin/flows/${f.id}/edit`}
                className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
              >
                Edit
              </Link>
              <button
                onClick={() => remove(f.id)}
                className="px-3 py-1.5 border rounded text-red-700 hover:bg-red-50 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {!flows.length && (
          <div className="text-gray-500 italic">No flows yet — create one above.</div>
        )}
      </div>
    </div>
  );
}
