import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import TourGalleryWorkspace from './TourGalleryWorkspace.jsx';
import AlertDialog from '../../common/AlertDialog.jsx';

// Compact gallery card for the Tour page — the operational summary stays
// dense: cover thumb, counts, last upload, and the three actions (open /
// upload / copy customer link). The heavy grid lives in the workspace modal.

const STATUS_LABELS = {
  empty: 'ריקה',
  uploading: 'העלאה בתהליך',
  ready: 'מוכנה',
  cleanup_pending: 'ניקוי אחסון בתהליך',
};

function fmtWhen(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TourGalleryCard({ tourEventId, tourStatus }) {
  const [summary, setSummary] = useState(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [alertMsg, setAlertMsg] = useState(null); // system AlertDialog, never window.alert

  const load = useCallback(async () => {
    try {
      setSummary(await api.tourGallery.summary(tourEventId));
    } catch {
      setSummary(null); // the card is quiet on errors — the tour page stays usable
    }
  }, [tourEventId]);

  useEffect(() => {
    load();
  }, [load]);

  async function copyLink() {
    try {
      const link = summary?.link || (await api.tourGallery.ensureLink(tourEventId));
      await navigator.clipboard.writeText(`${window.location.origin}/g/${link.token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (!summary?.link) load();
    } catch (e) {
      setAlertMsg('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  const total = (summary?.imageCount || 0) + (summary?.videoCount || 0);
  const cancelled = tourStatus === 'cancelled';

  return (
    <section className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        {/* Cover / placeholder */}
        <button
          type="button"
          onClick={() => setWorkspaceOpen(true)}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100"
          aria-label="פתיחת הגלריה"
        >
          {summary?.coverThumbUrl ? (
            <img src={summary.coverThumbUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xl text-gray-300">📸</span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <h2 className="text-[11px] font-semibold tracking-wide text-gray-400">גלריית הסיור</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-gray-700">
            {total === 0 ? (
              <span className="text-gray-400">
                {summary ? STATUS_LABELS[summary.status] || '' : '…'}
              </span>
            ) : (
              <>
                <span className="font-semibold">{summary.imageCount} תמונות</span>
                {summary.videoCount > 0 && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="font-semibold">{summary.videoCount} סרטונים</span>
                  </>
                )}
                {summary.lastUploadAt && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-500">עדכון אחרון {fmtWhen(summary.lastUploadAt)}</span>
                  </>
                )}
              </>
            )}
            {summary?.pendingCount > 0 && (
              <span className="font-medium text-amber-600">{summary.pendingCount} בהעלאה</span>
            )}
            {summary?.cleanup && (
              <span className="font-semibold text-red-600">{STATUS_LABELS.cleanup_pending}</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!cancelled && (
            <button
              type="button"
              onClick={copyLink}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
            >
              {copied ? '✓ הועתק' : '🔗 קישור ללקוח'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setWorkspaceOpen(true)}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            {cancelled || total > 0 ? 'פתיחת הגלריה' : '⬆ העלאה ראשונה'}
          </button>
        </div>
      </div>

      {workspaceOpen && (
        <TourGalleryWorkspace
          tourEventId={tourEventId}
          onClose={() => {
            setWorkspaceOpen(false);
            load();
          }}
          onChanged={load}
        />
      )}
      <AlertDialog open={!!alertMsg} body={alertMsg} onClose={() => setAlertMsg(null)} />
    </section>
  );
}
