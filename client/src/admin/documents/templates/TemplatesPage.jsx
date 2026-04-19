import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Outlet } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { relativeHebrew } from '../../../lib/relativeTime.js';

// Templates tab: list pane + outlet for editor / instance detail.
export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const { id } = useParams();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const t = await api.documents.listTemplates();
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
      const { source, snapshot } = await api.documents.uploadPdf(bytes, file.name);
      const title = stripExt(file.name) || 'תבנית חדשה';
      const template = await api.documents.createTemplate({
        title,
        snapshotId: snapshot.id,
      });
      await refresh();
      navigate(`/admin/documents/templates/${template.id}`);
    } catch (e2) {
      setUploadError(e2.message);
    } finally {
      setUploading(false);
    }
  }

  const inChild = !!id;
  const listCls = inChild
    ? 'hidden lg:flex w-full lg:w-[320px] lg:shrink-0 bg-white border-l border-gray-200 flex-col min-h-0'
    : 'flex w-full lg:w-[320px] lg:shrink-0 bg-white border-l border-gray-200 flex-col min-h-0';
  const workCls = inChild
    ? 'flex flex-1 bg-gray-50 min-h-0'
    : 'hidden lg:flex flex-1 bg-gray-50 min-h-0';

  return (
    <div className="h-full flex">
      <aside className={listCls}>
        <div className="p-3 border-b border-gray-200 bg-white space-y-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {uploading ? 'מעלה…' : '+ תבנית חדשה (PDF)'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFile}
          />
          {uploadError && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 text-xs">
              {uploadError}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-center text-sm text-gray-500">טוען…</div>}
          {error && !loading && (
            <div className="p-6 text-center text-sm">
              <div className="text-red-600 mb-2">שגיאה בטעינה</div>
              <button
                onClick={refresh}
                className="text-xs border border-gray-300 rounded px-3 py-1 hover:bg-gray-50"
              >
                נסה שוב
              </button>
            </div>
          )}
          {!loading && !error && templates.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              אין תבניות. העלה PDF כדי להתחיל.
            </div>
          )}
          {!loading && !error && templates.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => navigate(`/admin/documents/templates/${t.id}`)}
                    className={`w-full text-right px-3 py-3 hover:bg-gray-50 transition block ${
                      id === t.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="font-medium text-gray-900 truncate">
                      {t.title}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      {t.snapshot.pageCount} עמ׳ • {t._count.fields} שדות • {t._count.instances} מסמכים
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {relativeHebrew(t.createdAt)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className={workCls}>
        {id ? (
          <Outlet context={{ refresh }} />
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center p-10">
            <div className="text-center max-w-sm">
              <div className="text-5xl mb-4 opacity-40">📄</div>
              <div className="text-lg font-semibold text-gray-800 mb-1">
                העלה PDF חדש או בחר תבנית
              </div>
              <div className="text-sm text-gray-500">
                בתבנית תוכל למקם שדות על ה-PDF ולקבוע מאיפה כל שדה לוקח את הערך שלו.
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function stripExt(name) {
  return String(name || '').replace(/\.[^.]+$/, '').trim();
}
