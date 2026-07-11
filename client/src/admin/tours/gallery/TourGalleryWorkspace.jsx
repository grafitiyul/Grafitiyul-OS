import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import { createGalleryUploader, getGalleryUploader } from '../../../lib/galleryUpload.js';
import GalleryGrid from '../../../gallery/GalleryGrid.jsx';
import GalleryLightbox from '../../../gallery/GalleryLightbox.jsx';
import UploadQueuePanel from '../../../gallery/UploadQueuePanel.jsx';
import DownloadAllButton from '../../../gallery/DownloadAllButton.jsx';
import UploadPrimaryButton from '../../../gallery/UploadPrimaryButton.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';

// Full staff gallery workspace — a large modal ABOVE the Tour page (z-[70]).
// Grid + lightbox + multi-select + bulk delete + cover + customer-link
// management + the live upload queue. The queue itself lives in a module
// registry (lib/galleryUpload.js) so closing this modal never kills a batch.

function galleryLinkUrl(token) {
  return `${window.location.origin}/g/${token}`;
}

function ToolbarButton({ onClick, children, danger = false, disabled = false, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition disabled:opacity-40 ${
        danger
          ? 'border-red-200 bg-white text-red-600 hover:bg-red-50'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

// Sequential downloads through the presigned-redirect endpoint. Browsers may
// ask "allow multiple downloads" — that is the honest native behavior.
function triggerDownloads(paths) {
  paths.forEach((p, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = p;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 350);
  });
}

export default function TourGalleryWorkspace({ tourEventId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [filter, setFilter] = useState('all'); // all | image | video | customer
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [queueSnap, setQueueSnap] = useState(null);
  const fileInputRef = useRef(null);

  const uploader = useMemo(
    () =>
      getGalleryUploader(`admin:${tourEventId}`, () =>
        createGalleryUploader({
          endpoints: {
            initiate: (files) => api.tourGallery.initiateUploads(tourEventId, files),
            urls: (mediaId, body) => api.tourGallery.uploadUrls(tourEventId, mediaId, body),
            complete: (mediaId, body) => api.tourGallery.completeUpload(tourEventId, mediaId, body),
            abort: (mediaId) => api.tourGallery.abortUpload(tourEventId, mediaId),
          },
        }),
      ),
    [tourEventId],
  );

  const load = useCallback(async () => {
    try {
      setData(await api.tourGallery.get(tourEventId));
      setError(null);
    } catch (e) {
      setError(e.payload?.error || e.message);
    }
  }, [tourEventId]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh the grid when uploads finish (debounced on done-count changes).
  const doneRef = useRef(0);
  useEffect(() => {
    let timer = null;
    const unsub = uploader.subscribe((snap) => {
      setQueueSnap(snap);
      if ((snap.totals.done || 0) !== doneRef.current) {
        doneRef.current = snap.totals.done || 0;
        clearTimeout(timer);
        timer = setTimeout(() => {
          load();
          onChanged?.();
        }, 600);
      }
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [uploader, load, onChanged]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && lightboxIndex === null) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, lightboxIndex]);

  const media = useMemo(() => {
    const all = data?.media || [];
    if (filter === 'image' || filter === 'video') return all.filter((m) => m.mediaType === filter);
    if (filter === 'customer') return all.filter((m) => m.uploadedByType === 'customer');
    return all;
  }, [data, filter]);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runDelete() {
    setConfirmDelete(false);
    try {
      await api.tourGallery.deleteMedia(tourEventId, [...selected]);
      setSelected(new Set());
      setLightboxIndex(null);
      await load();
      onChanged?.();
    } catch (e) {
      alert('שגיאה במחיקה: ' + (e.payload?.error || e.message));
    }
  }

  async function setCover(mediaId) {
    try {
      await api.tourGallery.setCover(tourEventId, mediaId);
      await load();
      onChanged?.();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  async function copyLink() {
    setLinkBusy(true);
    try {
      const link = data?.link || (await api.tourGallery.ensureLink(tourEventId));
      await navigator.clipboard.writeText(galleryLinkUrl(link.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (!data?.link) await load();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setLinkBusy(false);
    }
  }

  async function rotateLink() {
    if (!window.confirm('להחליף את קישור הלקוח? הקישור הישן יפסיק לעבוד מיידית.')) return;
    setLinkBusy(true);
    try {
      await api.tourGallery.rotateLink(tourEventId);
      await load();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    } finally {
      setLinkBusy(false);
    }
  }

  async function revokeLink() {
    if (!window.confirm('לבטל את קישור הלקוח? לקוחות עם הקישור יאבדו גישה.')) return;
    setLinkBusy(true);
    try {
      await api.tourGallery.revokeLink(tourEventId);
      await load();
    } finally {
      setLinkBusy(false);
    }
  }

  function pickFiles() {
    fileInputRef.current?.click();
  }

  function onFiles(list) {
    if (list?.length) uploader.addFiles(list);
  }

  const canUpload = data && data.tourStatus !== 'cancelled';
  const lightboxMedia = lightboxIndex != null ? media[lightboxIndex] : null;

  const FILTERS = [
    ['all', 'הכל'],
    ['image', 'תמונות'],
    ['video', 'סרטונים'],
    ['customer', 'העלאות לקוח'],
  ];

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="גלריית הסיור"
      className="fixed inset-0 z-[70] flex justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[calc(100vh-3rem)] sm:max-w-[1200px] sm:rounded-2xl ${
          dragOver ? 'ring-4 ring-inset ring-blue-400' : ''
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          if (canUpload) {
            e.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (canUpload) onFiles(e.dataTransfer.files);
        }}
      >
        {/* Header */}
        <header className="shrink-0 border-b border-gray-200 px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-gray-400">📸 גלריית הסיור</div>
              <h1 className="mt-0.5 truncate text-lg font-bold tracking-tight text-gray-900">
                {data?.title || '…'}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-gray-500">
                <span>{data?.imageCount ?? 0} תמונות</span>
                <span className="text-gray-300">·</span>
                <span>{data?.videoCount ?? 0} סרטונים</span>
                {data?.cleanup && (
                  <span className="font-semibold text-red-600">
                    ניקוי אחסון בתהליך{data.cleanup.lastError ? ' — יש שגיאה, ראו לוג' : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* SAME primary upload button as the customer gallery — one
                  component, identical wording/color/icon/weight. */}
              {canUpload && <UploadPrimaryButton onClick={pickFiles} />}
              <button
                type="button"
                onClick={onClose}
                aria-label="סגירה"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Toolbar: filters + link management / selection actions */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                    filter === key
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {selected.size > 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-semibold text-blue-700">{selected.size} נבחרו</span>
                <ToolbarButton
                  onClick={() =>
                    triggerDownloads(
                      [...selected].map((id) => api.tourGallery.downloadPath(tourEventId, id)),
                    )
                  }
                >
                  ⬇ הורדה
                </ToolbarButton>
                {selected.size === 1 && (
                  <ToolbarButton onClick={() => setCover([...selected][0])}>★ קבע קאבר</ToolbarButton>
                )}
                <ToolbarButton danger onClick={() => setConfirmDelete(true)}>
                  🗑 מחיקה
                </ToolbarButton>
                <ToolbarButton onClick={() => setSelected(new Set())}>ביטול בחירה</ToolbarButton>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {(data?.imageCount || 0) + (data?.videoCount || 0) > 0 && (
                  <DownloadAllButton
                    className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                    endpoints={{
                      request: () => api.tourGallery.requestExport(tourEventId),
                      status: (id) => api.tourGallery.exportStatus(tourEventId, id),
                      downloadHref: (id) => api.tourGallery.exportDownloadPath(tourEventId, id),
                    }}
                  />
                )}
                <ToolbarButton onClick={copyLink} disabled={linkBusy || data?.tourStatus === 'cancelled'}>
                  {copied ? '✓ הועתק' : '🔗 העתק קישור ללקוח'}
                </ToolbarButton>
                {data?.link && (
                  <>
                    <ToolbarButton onClick={rotateLink} disabled={linkBusy} title="מחליף את הקישור — הישן נחסם">
                      ↻ החלפת קישור
                    </ToolbarButton>
                    <ToolbarButton danger onClick={revokeLink} disabled={linkBusy}>
                      ביטול קישור
                    </ToolbarButton>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
          {error ? (
            <div className="p-6 text-sm text-red-600">
              שגיאה: <span dir="ltr" className="font-mono">{error}</span>
            </div>
          ) : !data ? (
            <div className="p-6 text-sm text-gray-400">טוען…</div>
          ) : (
            <GalleryGrid
              media={media}
              coverMediaId={data.coverMediaId}
              selectable
              selected={selected}
              onToggleSelect={toggleSelect}
              onOpen={(i) => setLightboxIndex(i)}
              emptyText={
                canUpload
                  ? 'אין עדיין מדיה — גררו לכאן קבצים או לחצו על ״העלאת תמונות וסרטונים״'
                  : 'אין מדיה בגלריה'
              }
            />
          )}
        </div>

        {/* Upload queue — sticky above the bottom edge */}
        {queueSnap?.totals?.total > 0 && (
          <div className="shrink-0 border-t border-gray-100 p-2.5">
            <UploadQueuePanel snapshot={queueSnap} uploader={uploader} />
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {lightboxMedia && (
        <GalleryLightbox
          media={media}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          showUploader
          actions={
            <>
              <a
                href={api.tourGallery.downloadPath(tourEventId, lightboxMedia.id)}
                className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-white/20"
              >
                ⬇ הורדה
              </a>
              <button
                type="button"
                onClick={() => setCover(lightboxMedia.id)}
                className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-white/20"
              >
                ★ קאבר
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(new Set([lightboxMedia.id]));
                  setConfirmDelete(true);
                }}
                className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-red-300 hover:bg-red-500/30"
              >
                🗑 מחיקה
              </button>
            </>
          }
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="מחיקת מדיה"
        body={`למחוק ${selected.size === 1 ? 'פריט אחד' : `${selected.size} פריטים`} מהגלריה? הקבצים יימחקו מהאחסון ולא ניתן לשחזר אותם.`}
        confirmLabel="מחק"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={runDelete}
      />
    </div>
  );
}
