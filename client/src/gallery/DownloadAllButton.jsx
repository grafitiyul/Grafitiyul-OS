import { useEffect, useRef, useState } from 'react';

// "Download all" — honest async UX over the export job. Click → the server
// queues (or reuses) a ZIP build → we poll until ready → the browser
// downloads via presigned redirect. No fake instant ZIPs, no frozen tabs.
//
// endpoints: {
//   request(): Promise<{ id, status }>,
//   status(id): Promise<{ id, status }>,   // status: pending|running|preparing|ready|failed|expired
//   downloadHref(id): string,
// }

const POLL_MS = 3000;

export default function DownloadAllButton({ endpoints, className = '', readyAutoDownload = true }) {
  const [job, setJob] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | preparing | ready | failed
  const timerRef = useRef(null);
  const downloadedRef = useRef(false);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function isPreparing(status) {
    return ['pending', 'running', 'preparing'].includes(status);
  }

  async function poll(id) {
    try {
      const j = await endpoints.status(id);
      setJob(j);
      if (isPreparing(j.status)) {
        timerRef.current = setTimeout(() => poll(id), POLL_MS);
      } else if (j.status === 'ready') {
        setPhase('ready');
        if (readyAutoDownload && !downloadedRef.current) {
          downloadedRef.current = true;
          window.location.assign(endpoints.downloadHref(id));
        }
      } else {
        setPhase('failed');
      }
    } catch {
      setPhase('failed');
    }
  }

  async function start() {
    if (phase === 'preparing') return;
    if (phase === 'ready' && job) {
      window.location.assign(endpoints.downloadHref(job.id));
      return;
    }
    setPhase('preparing');
    downloadedRef.current = false;
    try {
      const j = await endpoints.request();
      setJob(j);
      if (j.status === 'ready') {
        setPhase('ready');
        window.location.assign(endpoints.downloadHref(j.id));
      } else if (isPreparing(j.status)) {
        timerRef.current = setTimeout(() => poll(j.id), POLL_MS);
      } else {
        setPhase('failed');
      }
    } catch (e) {
      setPhase(e?.status === 409 || e?.payload?.error === 'gallery_empty' ? 'idle' : 'failed');
    }
  }

  const label =
    phase === 'preparing'
      ? 'מכינים את הקובץ…'
      : phase === 'ready'
        ? '⬇ הקובץ מוכן — הורדה'
        : phase === 'failed'
          ? 'ההכנה נכשלה — נסו שוב'
          : '⬇ הורדת הכול (ZIP)';

  return (
    <button type="button" onClick={start} disabled={phase === 'preparing'} className={className}>
      {phase === 'preparing' && (
        <span
          className="me-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-middle"
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}
