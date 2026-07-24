import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import FileEntryList from '../../common/files/FileEntryList.jsx';

// Deal Files tab — upload (picker + drag & drop, multiple), plus the unified
// canonical files list (uploaded DealFiles + system-generated files such as
// the agent reservation summary) via the ONE FileEntryList renderer.
// Downloads go through the authed scoped endpoints; no public URLs.

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

  // Each source has its own scoped download door (association re-verified
  // server-side per request).
  const downloadHref = (f) =>
    f.source === 'reservation_summary'
      ? api.dealFiles.reservationDocumentUrl(dealId, f.id)
      : api.dealFiles.downloadUrl(dealId, f.id);

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
        <FileEntryList files={files} downloadHref={downloadHref} onRemove={remove} userMap={userMap} />
      )}
    </div>
  );
}
