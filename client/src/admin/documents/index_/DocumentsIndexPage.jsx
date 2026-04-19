import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';

// Primary entry point for the documents module. Document-first flow:
// upload PDF → creates source+snapshot+adhoc template+draft instance
// atomically → navigate straight into the instance editor. Templates are
// no longer the default path.
export default function DocumentsIndexPage() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [instances, setInstances] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [i, t] = await Promise.all([
        api.documents.listInstances(),
        api.documents.listTemplates(),
      ]);
      setInstances(i);
      setTemplates(t);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setUploadError('יש להעלות קובץ PDF בלבד.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { instance } = await api.documents.newFromPdf(bytes, file.name);
      navigate(`/admin/documents/instances/${instance.id}`);
    } catch (err) {
      setUploadError(err.message || 'שגיאה בהעלאת הקובץ.');
    } finally {
      setUploading(false);
    }
  }

  async function createFromTemplate(tpl) {
    const defaultTitle = `${tpl.title} — ${new Date().toLocaleDateString('he-IL')}`;
    const title = window.prompt('שם המסמך החדש', defaultTitle);
    if (!title || !title.trim()) return;
    try {
      const inst = await api.documents.createInstance({
        templateId: tpl.id,
        title: title.trim(),
      });
      navigate(`/admin/documents/instances/${inst.id}`);
    } catch (e) {
      window.alert(e.message);
    }
  }

  const drafts = instances.filter((i) => i.status === 'draft');
  const finalized = instances.filter((i) => i.status === 'finalized');

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-4xl mx-auto px-5 py-6">
        <header className="mb-6">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-semibold text-gray-900">מסמכים עסקיים</h1>
              <p className="text-sm text-gray-600 mt-1">
                העלה PDF, מקם ערכים (שם חברה, תאריך, חתימות), סיים ושמור PDF סופי.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 shadow"
              >
                {uploading ? 'מעלה…' : '+ מסמך חדש (PDF)'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFile}
              />
            </div>
          </div>
          {uploadError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-800 rounded p-2 text-sm">
              {uploadError}
            </div>
          )}
        </header>

        {loading && <div className="text-center text-gray-500 py-10">טוען…</div>}
        {error && !loading && (
          <div className="text-center text-sm">
            <div className="text-red-600 mb-2">שגיאה בטעינה</div>
            <button
              onClick={refresh}
              className="text-xs border border-gray-300 rounded px-3 py-1 hover:bg-gray-50"
            >
              נסה שוב
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            <Section title="טיוטות" emptyLabel="אין טיוטות. העלה PDF כדי להתחיל." items={drafts}>
              {drafts.map((i) => (
                <InstanceRow
                  key={i.id}
                  inst={i}
                  onClick={() => navigate(`/admin/documents/instances/${i.id}`)}
                />
              ))}
            </Section>

            <Section title="סופיים" emptyLabel="אין מסמכים סופיים עדיין." items={finalized}>
              {finalized.map((i) => (
                <InstanceRow
                  key={i.id}
                  inst={i}
                  onClick={() => navigate(`/admin/documents/instances/${i.id}`)}
                />
              ))}
            </Section>

            {templates.length > 0 && (
              <section className="mt-8">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-gray-800">תבניות חוזרות</h2>
                  <button
                    onClick={() => navigate('/admin/documents/templates')}
                    className="text-[12px] text-blue-700 hover:underline"
                  >
                    כל התבניות →
                  </button>
                </div>
                <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {templates.slice(0, 5).map((t) => (
                    <li key={t.id} className="px-4 py-3 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900 truncate">
                          {t.title}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          {t.snapshot.pageCount} עמ׳ · {t._count.fields} ערכים · {t._count.instances} מסמכים
                        </div>
                      </div>
                      <button
                        onClick={() => createFromTemplate(t)}
                        className="text-[12px] bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 rounded px-3 py-1"
                      >
                        מסמך חדש מתבנית
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, items, emptyLabel, children }) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        <span className="text-[11px] text-gray-500">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-sm text-gray-500">
          {emptyLabel}
        </div>
      ) : (
        <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {children}
        </ul>
      )}
    </section>
  );
}

function InstanceRow({ inst, onClick }) {
  return (
    <li>
      <button
        onClick={onClick}
        className="w-full text-right px-4 py-3 hover:bg-gray-50 flex items-center gap-2"
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 truncate">{inst.title}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {inst.snapshotPageCount} עמ׳ · עודכן {relativeHebrew(inst.updatedAt)}
          </div>
        </div>
        <StatusPill status={inst.status} />
      </button>
    </li>
  );
}

function StatusPill({ status }) {
  const m = {
    draft: { label: 'טיוטה', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
    finalized: { label: 'סופי', cls: 'bg-green-100 text-green-800 border-green-200' },
  }[status] || { label: status, cls: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`shrink-0 text-[10px] border rounded-full px-2 py-0.5 ${m.cls}`}>
      {m.label}
    </span>
  );
}
