import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';

// Deal Files tab — upload (picker + drag & drop, multiple), list, open/download
// (via the authed signed-redirect endpoint), delete. Reuses the existing private
// R2 infra; no public URLs are ever produced.

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fileEmoji(mime) {
  const m = String(mime || '');
  if (m.startsWith('image/')) return '🖼️';
  if (m === 'application/pdf') return '📕';
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (m.includes('word') || m.includes('document')) return '📄';
  if (m.includes('sheet') || m.includes('excel')) return '📊';
  if (m.includes('zip') || m.includes('compressed')) return '🗜️';
  return '📎';
}

export default function DealFilesTab({ dealId, onChanged }) {
  const [files, setFiles] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState([]); // filenames in flight
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  async function load() {
    try {
      setFiles(await api.dealFiles.list(dealId));
    } catch (e) {
      setError(e.payload?.error || e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // /api/admin-users returns { users: [...] } (envelope) — normalize to an array.
    api.adminUsers
      .list()
      .then((res) => {
        const arr = Array.isArray(res) ? res : res?.users || [];
        setUserMap(Object.fromEntries(arr.map((u) => [u.id, u.username])));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function handleFiles(fileList) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    setError(null);
    setUploading((u) => [...u, ...arr.map((f) => f.name)]);
    for (const f of arr) {
      try {
        await api.dealFiles.upload(dealId, f);
      } catch (e) {
        setError(`שגיאה בהעלאת ${f.name}: ${e.payload?.error || e.message}`);
      } finally {
        setUploading((u) => {
          const i = u.indexOf(f.name);
          if (i === -1) return u;
          const next = u.slice();
          next.splice(i, 1);
          return next;
        });
      }
    }
    await load();
    onChanged?.(); // surface the new upload event(s) in the Deal history now
  }

  async function remove(file) {
    if (!confirm(`למחוק את הקובץ "${file.filename}"?`)) return;
    try {
      await api.dealFiles.remove(dealId, file.id);
      setFiles((fs) => fs.filter((x) => x.id !== file.id));
      onChanged?.(); // surface the delete event in the Deal history now
    } catch (e) {
      alert('שגיאה במחיקה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <div className="space-y-3" dir="rtl">
      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition ${
          dragOver ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 bg-gray-50 text-gray-500 hover:border-gray-400'
        }`}
      >
        גררו קבצים לכאן או לחצו לבחירה
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {uploading.length > 0 && (
        <div className="text-[12.5px] text-blue-600">מעלה: {uploading.join(', ')}…</div>
      )}
      {error && <div className="text-[12.5px] text-red-600">{error}</div>}

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">טוען…</div>
      ) : files.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
          אין עדיין קבצים בדיל.
        </div>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => {
            // Canonical reservation-summary documents are filed by DERIVED
            // association (never uploaded here) — read-only entries with
            // their own download door; system documents cannot be deleted.
            const isReservationDoc = f.source === 'reservation_summary';
            const href = isReservationDoc
              ? api.dealFiles.reservationDocumentUrl(dealId, f.id)
              : api.dealFiles.downloadUrl(dealId, f.id);
            return (
              <li key={f.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <span aria-hidden className="text-[18px] leading-none">{fileEmoji(f.mimeType)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-gray-800">{f.filename}</span>
                    {isReservationDoc && (
                      <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                        סיכום הזמנת סוכן
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-gray-500">
                    {fmtSize(f.sizeBytes)}
                    {' · '}
                    {new Date(f.createdAt).toLocaleDateString('he-IL')}
                    {f.uploadedById && userMap[f.uploadedById] ? ` · ${userMap[f.uploadedById]}` : ''}
                    {isReservationDoc && f.sessionNo ? ` · בקשה #${f.sessionNo}` : ''}
                  </div>
                </div>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[12.5px] text-gray-700 hover:bg-gray-50"
                >
                  פתיחה
                </a>
                {!isReservationDoc && (
                  <button
                    type="button"
                    onClick={() => remove(f)}
                    className="rounded-lg px-2 py-1 text-[12.5px] text-red-600 hover:bg-red-50"
                  >
                    מחיקה
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
