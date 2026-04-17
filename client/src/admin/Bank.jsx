import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Bank() {
  const [tab, setTab] = useState('content');
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h2 className="text-2xl font-semibold mb-4">Item Bank</h2>
      <div className="flex gap-2 border-b mb-4">
        <TabBtn active={tab === 'content'} onClick={() => setTab('content')}>
          Content Items
        </TabBtn>
        <TabBtn active={tab === 'question'} onClick={() => setTab('question')}>
          Question Items
        </TabBtn>
      </div>
      {tab === 'content' ? <ContentBank /> : <QuestionBank />}
    </div>
  );
}

function TabBtn({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm ${
        active ? 'border-b-2 border-blue-600 font-medium' : 'text-gray-600'
      }`}
    >
      {children}
    </button>
  );
}

function ContentBank() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  async function load() {
    setItems(await api.contentItems.list());
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing?.title.trim()) return;
    const payload = {
      title: editing.title,
      body: editing.body || '',
      internalNote: editing.internalNote || null,
    };
    if (editing.id) await api.contentItems.update(editing.id, payload);
    else await api.contentItems.create(payload);
    setEditing(null);
    load();
  }

  async function remove(id) {
    if (!confirm('Delete this item?')) return;
    try {
      await api.contentItems.remove(id);
    } catch (e) {
      alert(e.message);
      return;
    }
    setEditing(null);
    load();
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-4">
      <div className="space-y-2">
        <button
          className="w-full bg-blue-600 text-white px-3 py-2 rounded"
          onClick={() => setEditing({ title: '', body: '', internalNote: '' })}
        >
          + New Content Item
        </button>
        {items.map((i) => (
          <div
            key={i.id}
            className={`bg-white border rounded p-3 cursor-pointer hover:border-blue-500 ${
              editing?.id === i.id ? 'border-blue-500' : ''
            }`}
            onClick={() =>
              setEditing({
                id: i.id,
                title: i.title,
                body: i.body,
                internalNote: i.internalNote || '',
              })
            }
          >
            <div className="font-medium truncate">{i.title}</div>
            <div className="text-sm text-gray-500 truncate">{i.body || '—'}</div>
          </div>
        ))}
      </div>
      <div className="bg-white border rounded p-4">
        {editing ? (
          <div className="space-y-3">
            <input
              className="w-full border rounded px-3 py-2 text-lg font-medium"
              placeholder="Title"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
            <textarea
              className="w-full border rounded px-3 py-2 h-48 font-mono text-sm"
              placeholder="Body (plain text or markdown)"
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            />
            <textarea
              className="w-full border rounded px-3 py-2 h-20"
              placeholder="Internal note (not shown to learner)"
              value={editing.internalNote}
              onChange={(e) => setEditing({ ...editing, internalNote: e.target.value })}
            />
            <div className="flex gap-2">
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded"
                onClick={save}
              >
                Save
              </button>
              <button
                className="border px-4 py-2 rounded"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              {editing.id && (
                <button
                  className="border px-4 py-2 rounded text-red-700 ml-auto"
                  onClick={() => remove(editing.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-gray-500">Select an item or create a new one.</div>
        )}
      </div>
    </div>
  );
}

function QuestionBank() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  async function load() {
    setItems(await api.questionItems.list());
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing?.title.trim()) return;
    const payload = {
      title: editing.title,
      questionText: editing.questionText || '',
      answerType: editing.answerType,
      options:
        editing.answerType === 'single_choice'
          ? (editing.options || []).filter((o) => o.trim())
          : [],
      internalNote: editing.internalNote || null,
    };
    if (editing.id) await api.questionItems.update(editing.id, payload);
    else await api.questionItems.create(payload);
    setEditing(null);
    load();
  }

  async function remove(id) {
    if (!confirm('Delete this question?')) return;
    try {
      await api.questionItems.remove(id);
    } catch (e) {
      alert(e.message);
      return;
    }
    setEditing(null);
    load();
  }

  function setOption(idx, value) {
    const options = [...(editing.options || [])];
    options[idx] = value;
    setEditing({ ...editing, options });
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-4">
      <div className="space-y-2">
        <button
          className="w-full bg-blue-600 text-white px-3 py-2 rounded"
          onClick={() =>
            setEditing({
              title: '',
              questionText: '',
              answerType: 'open_text',
              options: [],
              internalNote: '',
            })
          }
        >
          + New Question
        </button>
        {items.map((i) => (
          <div
            key={i.id}
            className={`bg-white border rounded p-3 cursor-pointer hover:border-blue-500 ${
              editing?.id === i.id ? 'border-blue-500' : ''
            }`}
            onClick={() =>
              setEditing({
                id: i.id,
                title: i.title,
                questionText: i.questionText,
                answerType: i.answerType,
                options: i.options || [],
                internalNote: i.internalNote || '',
              })
            }
          >
            <div className="font-medium truncate">{i.title}</div>
            <div className="text-sm text-gray-500">
              {i.answerType === 'single_choice'
                ? `${(i.options || []).length} options`
                : 'open text'}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white border rounded p-4">
        {editing ? (
          <div className="space-y-3">
            <input
              className="w-full border rounded px-3 py-2 text-lg font-medium"
              placeholder="Title (internal)"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
            <textarea
              className="w-full border rounded px-3 py-2 h-24"
              placeholder="Question shown to learner"
              value={editing.questionText}
              onChange={(e) => setEditing({ ...editing, questionText: e.target.value })}
            />
            <select
              className="border rounded px-3 py-2"
              value={editing.answerType}
              onChange={(e) =>
                setEditing({ ...editing, answerType: e.target.value })
              }
            >
              <option value="open_text">Open text</option>
              <option value="single_choice">Single choice</option>
            </select>
            {editing.answerType === 'single_choice' && (
              <div className="space-y-2">
                {(editing.options || []).map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className="flex-1 border rounded px-3 py-2"
                      placeholder={`Option ${i + 1}`}
                      value={opt}
                      onChange={(e) => setOption(i, e.target.value)}
                    />
                    <button
                      className="border px-3 rounded"
                      onClick={() => {
                        const o = [...editing.options];
                        o.splice(i, 1);
                        setEditing({ ...editing, options: o });
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="border px-3 py-1 rounded text-sm"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      options: [...(editing.options || []), ''],
                    })
                  }
                >
                  + Add option
                </button>
              </div>
            )}
            <textarea
              className="w-full border rounded px-3 py-2 h-20"
              placeholder="Internal note"
              value={editing.internalNote}
              onChange={(e) =>
                setEditing({ ...editing, internalNote: e.target.value })
              }
            />
            <div className="flex gap-2">
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded"
                onClick={save}
              >
                Save
              </button>
              <button
                className="border px-4 py-2 rounded"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              {editing.id && (
                <button
                  className="border px-4 py-2 rounded text-red-700 ml-auto"
                  onClick={() => remove(editing.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-gray-500">Select a question or create a new one.</div>
        )}
      </div>
    </div>
  );
}
